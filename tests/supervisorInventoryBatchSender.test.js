import { describe, expect, it, vi } from 'vitest';
import { createInventoryDraft, addInventoryDraftLine } from '../src/services/supervisorInventoryDraft';
import { createBatchCommandStore, sendSupervisorInventoryBatch } from '../src/services/supervisorInventoryBatchSender';

const COMMAND_ID = 'cmd-fijo-0001';

function memoryStorage() {
    const map = new Map();
    return {
        getItem: key => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => { map.set(key, String(value)); },
        removeItem: key => { map.delete(key); },
    };
}

function makeStore() {
    return createBatchCommandStore(memoryStorage(), 'tests');
}

function makeDraft() {
    let draft = createInventoryDraft('ingreso', { reason: 'Recepción del día' });
    draft = addInventoryDraftLine(draft, { productId: 'a', inputUnit: 'unidades', quantityInput: 4, unitsPerPackage: 1 }).draft;
    draft = addInventoryDraftLine(draft, { productId: 'b', inputUnit: 'cajas', quantityInput: 2, unitsPerPackage: 6 }).draft;
    return draft;
}

function makeEgressDraftWithInsufficientStock() {
    let draft = createInventoryDraft('egreso', { reason: 'Merma del día', reasonCategory: 'merma' });
    draft = addInventoryDraftLine(draft, { productId: 'a', inputUnit: 'unidades', quantityInput: 99, unitsPerPackage: 1 }).draft;
    return draft;
}

const PRODUCTS = [{ id: 'a', stock: 10 }, { id: 'b', stock: 2 }];

function terminalAck(status, { error = null, ack = { stockAfter: 12 } } = {}) {
    return {
        ok: status === 'applied' || status === 'applied_with_warnings',
        status,
        commandId: COMMAND_ID,
        ack,
        error,
    };
}

const TIMEOUT_ACK = { ok: false, status: 'timeout', error: 'La caja no confirmó la orden a tiempo' };

describe('sendSupervisorInventoryBatch (contrato batch v2: un comando + ACK global)', () => {
    it('envía TODO el lote como UN solo comando batch v2 con expectedStock del cálculo del draft', async () => {
        const sendCommand = vi.fn().mockResolvedValue({
            ok: true,
            status: 'pending',
            commandId: COMMAND_ID,
            ackPromise: Promise.resolve(terminalAck('applied')),
        });

        const result = await sendSupervisorInventoryBatch({
            draft: makeDraft(),
            products: PRODUCTS,
            targetDeviceId: 'device-1',
            sendCommand,
            commandStore: makeStore(),
            commandIdFactory: () => COMMAND_ID,
        });

        expect(sendCommand).toHaveBeenCalledTimes(1);
        const call = sendCommand.mock.calls[0][0];
        expect(call.type).toBe('supervisor.inventory.batch.adjust');
        expect(call.commandId).toBe(COMMAND_ID);
        expect(call.payload.batchVersion).toBe(2);
        expect(call.payload.direction).toBe('ingreso');
        expect(call.payload.lines).toHaveLength(2);

        const lineA = call.payload.lines.find(line => line.productId === 'a');
        const lineB = call.payload.lines.find(line => line.productId === 'b');
        // expectedStock basado en el cálculo del draft (stock actual del producto).
        expect(lineA.expectedStock).toBe(10);
        expect(lineB.expectedStock).toBe(2);
        // unitsPerPackage solo viaja para cajas/bultos; las unidades van planas.
        expect(lineA.unitsPerPackage).toBeUndefined();
        expect(lineB.unitsPerPackage).toBe(6);

        expect(result.ok).toBe(true);
        expect(result.status).toBe('applied');
        expect(result.uncertain).toBe(false);
        expect(result.applied).toHaveLength(2);
        expect(result.results.every(item => item.status === 'applied' && item.commandId === COMMAND_ID)).toBe(true);
    });

    it('reporta el ACK global "applied_with_warnings" sin marcarlo como timeout ni fallo', async () => {
        const sendCommand = vi.fn().mockResolvedValue({
            ok: true,
            status: 'pending',
            commandId: COMMAND_ID,
            ackPromise: Promise.resolve(terminalAck('applied_with_warnings', {
                error: 'Stock de b quedó por debajo de lo esperado',
                ack: { stockAfter: 12, warnings: [{ lineId: 'line-2', error: 'stock recalculado por la caja' }] },
            })),
        });

        const result = await sendSupervisorInventoryBatch({
            draft: makeDraft(),
            products: PRODUCTS,
            targetDeviceId: 'device-1',
            sendCommand,
            commandStore: makeStore(),
            commandIdFactory: () => COMMAND_ID,
        });

        expect(result.ok).toBe(true);
        expect(result.status).toBe('applied_with_warnings');
        expect(result.uncertain).toBe(false);
        expect(result.applied).toHaveLength(2);
    });

    it('un ACK rechazado es conclusión cierta: nada aplicado, todo pendiente y sin sugerir reenvío', async () => {
        const store = makeStore();
        const sendCommand = vi.fn().mockResolvedValue({
            ok: true,
            status: 'pending',
            commandId: COMMAND_ID,
            ackPromise: Promise.resolve(terminalAck('rejected', { error: 'La caja rechazó el lote' })),
        });

        const result = await sendSupervisorInventoryBatch({
            draft: makeDraft(),
            products: PRODUCTS,
            targetDeviceId: 'device-1',
            sendCommand,
            commandStore: store,
            commandIdFactory: () => COMMAND_ID,
        });

        expect(result.ok).toBe(false);
        expect(result.status).toBe('rejected');
        expect(result.uncertain).toBe(false);
        expect(result.applied).toHaveLength(0);
        expect(result.pending).toHaveLength(2);
        expect(store.load()).toBeNull();
    });

    it('timeout del ACK global: estado incierto y conserva el commandId para reconciliar', async () => {
        const store = makeStore();
        const sendCommand = vi.fn().mockResolvedValue({
            ok: true,
            status: 'pending',
            commandId: COMMAND_ID,
            ackPromise: Promise.resolve(TIMEOUT_ACK),
        });

        const result = await sendSupervisorInventoryBatch({
            draft: makeDraft(),
            products: PRODUCTS,
            targetDeviceId: 'device-1',
            sendCommand,
            commandStore: store,
            commandIdFactory: () => COMMAND_ID,
        });

        expect(result.ok).toBe(false);
        expect(result.status).toBe('timeout');
        expect(result.uncertain).toBe(true);
        expect(result.commandId).toBe(COMMAND_ID);
        // El comando persistido NO se limpia: el próximo intento lo reconcilia.
        expect(store.load()).toEqual(expect.objectContaining({ commandId: COMMAND_ID }));
    });

    it('el reintento tras timeout reconcilia el MISMO commandId sin crear otro comando', async () => {
        const store = makeStore();
        const sendCommand = vi.fn().mockResolvedValue({
            ok: true,
            status: 'pending',
            commandId: COMMAND_ID,
            ackPromise: Promise.resolve(TIMEOUT_ACK),
        });
        const inspectCommandState = vi.fn().mockResolvedValue({ state: 'active', commandId: COMMAND_ID, ack: null });
        const awaitCommandAck = vi.fn().mockResolvedValue(terminalAck('applied'));
        const firstEvents = [];
        const secondEvents = [];

        const first = await sendSupervisorInventoryBatch({
            draft: makeDraft(),
            products: PRODUCTS,
            targetDeviceId: 'device-1',
            sendCommand,
            inspectCommandState,
            awaitCommandAck,
            commandStore: store,
            commandIdFactory: () => COMMAND_ID,
            onProgress: event => firstEvents.push(event),
        });
        expect(first.uncertain).toBe(true);
        expect(firstEvents).toEqual([{ commandId: COMMAND_ID, status: 'sent' }]);

        const second = await sendSupervisorInventoryBatch({
            draft: makeDraft(),
            products: PRODUCTS,
            targetDeviceId: 'device-1',
            sendCommand,
            inspectCommandState,
            awaitCommandAck,
            commandStore: store,
            commandIdFactory: () => 'cmd-nuevo-nunca-debe-usarse',
            onProgress: event => secondEvents.push(event),
        });

        // NO se crea un segundo comando: se reconcilia el mismo commandId.
        expect(sendCommand).toHaveBeenCalledTimes(1);
        expect(secondEvents).toEqual([{ commandId: COMMAND_ID, status: 'reconciling' }]);
        expect(second.ok).toBe(true);
        expect(second.status).toBe('applied');
        expect(second.commandId).toBe(COMMAND_ID);
        expect(store.load()).toBeNull();
    });

    it('si el comando anterior ya terminó, reporta el ACK global real sin crear otro', async () => {
        const store = makeStore();
        const sendCommand = vi.fn().mockResolvedValue({
            ok: true,
            status: 'pending',
            commandId: COMMAND_ID,
            ackPromise: Promise.resolve(TIMEOUT_ACK),
        });
        const inspectCommandState = vi.fn().mockResolvedValue({
            state: 'terminal',
            commandId: COMMAND_ID,
            ack: terminalAck('applied'),
        });

        await sendSupervisorInventoryBatch({
            draft: makeDraft(),
            products: PRODUCTS,
            targetDeviceId: 'device-1',
            sendCommand,
            commandStore: store,
            commandIdFactory: () => COMMAND_ID,
        });

        const result = await sendSupervisorInventoryBatch({
            draft: makeDraft(),
            products: PRODUCTS,
            targetDeviceId: 'device-1',
            sendCommand,
            inspectCommandState,
            commandStore: store,
            commandIdFactory: () => 'cmd-nuevo-nunca-debe-usarse',
        });

        expect(sendCommand).toHaveBeenCalledTimes(1);
        expect(result.ok).toBe(true);
        expect(result.status).toBe('applied');
        expect(result.commandId).toBe(COMMAND_ID);
        expect(store.load()).toBeNull();
    });

    it('con otro lote activo distinto bloquea el envío sin crear otro comando', async () => {
        const store = makeStore();
        const sendCommand = vi.fn().mockResolvedValue({
            ok: true,
            status: 'pending',
            commandId: COMMAND_ID,
            ackPromise: Promise.resolve(TIMEOUT_ACK),
        });
        const inspectCommandState = vi.fn().mockResolvedValue({ state: 'active', commandId: COMMAND_ID, ack: null });
        const awaitCommandAck = vi.fn();

        await sendSupervisorInventoryBatch({
            draft: makeDraft(),
            products: PRODUCTS,
            targetDeviceId: 'device-1',
            sendCommand,
            commandStore: store,
            commandIdFactory: () => COMMAND_ID,
        });

        // Lote distinto (otro contenido) mientras el primero sigue sin confirmar.
        let otherDraft = createInventoryDraft('ingreso', { reason: 'Recepción del día' });
        otherDraft = addInventoryDraftLine(otherDraft, { productId: 'a', inputUnit: 'unidades', quantityInput: 9, unitsPerPackage: 1 }).draft;

        const result = await sendSupervisorInventoryBatch({
            draft: otherDraft,
            products: PRODUCTS,
            targetDeviceId: 'device-1',
            sendCommand,
            inspectCommandState,
            awaitCommandAck,
            commandStore: store,
            commandIdFactory: () => 'cmd-nuevo-nunca-debe-usarse',
        });

        expect(sendCommand).toHaveBeenCalledTimes(1);
        expect(awaitCommandAck).not.toHaveBeenCalled();
        expect(result.ok).toBe(false);
        expect(result.status).toBe('timeout');
        expect(result.uncertain).toBe(true);
        expect(result.error).toMatch(/lote anterior sin confirmar/i);
    });

    it('si la orden anterior expiró en la caja, el reintento lo reporta sin aplicar nada', async () => {
        const store = makeStore();
        const sendCommand = vi.fn().mockResolvedValue({
            ok: true,
            status: 'pending',
            commandId: COMMAND_ID,
            ackPromise: Promise.resolve(TIMEOUT_ACK),
        });
        const inspectCommandState = vi.fn().mockResolvedValue({ state: 'expired', commandId: COMMAND_ID, ack: null });

        await sendSupervisorInventoryBatch({
            draft: makeDraft(),
            products: PRODUCTS,
            targetDeviceId: 'device-1',
            sendCommand,
            commandStore: store,
            commandIdFactory: () => COMMAND_ID,
        });

        const result = await sendSupervisorInventoryBatch({
            draft: makeDraft(),
            products: PRODUCTS,
            targetDeviceId: 'device-1',
            sendCommand,
            inspectCommandState,
            commandStore: store,
            commandIdFactory: () => 'cmd-nuevo-nunca-debe-usarse',
        });

        expect(sendCommand).toHaveBeenCalledTimes(1);
        expect(result.ok).toBe(false);
        expect(result.status).toBe('expired');
        expect(result.uncertain).toBe(false);
        expect(store.load()).toBeNull();
    });

    it('con líneas inválidas no se crea ningún comando (todo-o-nada)', async () => {
        const sendCommand = vi.fn();
        const result = await sendSupervisorInventoryBatch({
            draft: makeEgressDraftWithInsufficientStock(),
            products: PRODUCTS,
            targetDeviceId: 'device-1',
            sendCommand,
            commandStore: makeStore(),
            commandIdFactory: () => COMMAND_ID,
        });

        expect(sendCommand).not.toHaveBeenCalled();
        expect(result.ok).toBe(false);
        expect(result.status).toBe('invalid');
        expect(result.uncertain).toBe(false);
        expect(result.error).toBe('Revisa las líneas marcadas antes de enviar');
    });
});
