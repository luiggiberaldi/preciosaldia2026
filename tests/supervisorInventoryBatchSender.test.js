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
        // El ACK aplicado queda como terminal para deduplicar reintentos ciegos.
        expect(store.load()).toEqual(expect.objectContaining({ commandId: COMMAND_ID, terminal: true }));
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
        // El ACK aplicado queda como terminal para deduplicar reintentos ciegos.
        expect(store.load()).toEqual(expect.objectContaining({ commandId: COMMAND_ID, terminal: true }));
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

describe('reintento idempotente y base estampada (regresión: "aplicado" sin cambio / falso "stock cambió")', () => {
    function makeStampedDraft(quantityInput = 8) {
        let draft = createInventoryDraft('ingreso', { reason: 'Ajuste de stock' });
        // Línea compuesta cuando el stock visible (creído) era 22: +8 → objetivo 30.
        draft = addInventoryDraftLine(draft, {
            productId: 'a',
            inputUnit: 'unidades',
            quantityInput,
            unitsPerPackage: 1,
            baseStock: 22,
        }).draft;
        return draft;
    }

    // Stock sincronizado viejo: la caja ya tiene 30 pero el documento remoto
    // aún refleja 22 (aplicado sin sincronizar).
    const STALE_PRODUCTS = [{ id: 'a', stock: 22 }];

    function appliedSendMock() {
        return vi.fn().mockResolvedValue({
            ok: true,
            status: 'pending',
            commandId: COMMAND_ID,
            ackPromise: Promise.resolve(terminalAck('applied', { ack: { stockAfter: 30 } })),
        });
    }

    it('expectedStock sale de la base estampada al componer la línea, no del stock sincronizado', async () => {
        const sendCommand = appliedSendMock();
        await sendSupervisorInventoryBatch({
            draft: makeStampedDraft(),
            // El sync ya trajo 30, pero la línea se compuso contra 22.
            products: [{ id: 'a', stock: 30 }],
            targetDeviceId: 'device-1',
            sendCommand,
            commandStore: makeStore(),
            commandIdFactory: () => COMMAND_ID,
        });

        expect(sendCommand.mock.calls[0][0].payload.lines[0].expectedStock).toBe(22);
    });

    it('envía líneas de productos en saldo negativo (expectedStock negativo pasa el contrato)', async () => {
        // Regresión: el contrato batch v2 rechazaba expectedStock < 0 con
        // "El lote no cumple el contrato batch v2" y el ajuste jamás se enviaba.
        const sendCommand = vi.fn().mockResolvedValue({
            ok: true,
            status: 'pending',
            commandId: COMMAND_ID,
            ackPromise: Promise.resolve(terminalAck('applied', { ack: { stockAfter: 0 } })),
        });
        let draft = createInventoryDraft('ingreso', { reason: 'Ajuste de stock' });
        draft = addInventoryDraftLine(draft, {
            productId: 'a',
            inputUnit: 'unidades',
            quantityInput: 2,
            unitsPerPackage: 1,
            baseStock: -2,
        }).draft;

        const result = await sendSupervisorInventoryBatch({
            draft,
            products: [{ id: 'a', stock: -2 }],
            targetDeviceId: 'device-1',
            sendCommand,
            commandStore: makeStore(),
            commandIdFactory: () => COMMAND_ID,
        });

        expect(result.status).not.toBe('invalid');
        expect(sendCommand).toHaveBeenCalledTimes(1);
        expect(sendCommand.mock.calls[0][0].payload.lines[0].expectedStock).toBe(-2);
    });

    it('un reintento ciego del mismo lote ya aplicado devuelve el ACK guardado sin crear otro comando', async () => {
        const store = makeStore();
        const sendCommand = appliedSendMock();

        const first = await sendSupervisorInventoryBatch({
            draft: makeStampedDraft(),
            products: STALE_PRODUCTS,
            targetDeviceId: 'device-1',
            sendCommand,
            commandStore: store,
            commandIdFactory: () => COMMAND_ID,
        });
        expect(first.ok).toBe(true);
        expect(sendCommand).toHaveBeenCalledTimes(1);

        const retry = await sendSupervisorInventoryBatch({
            draft: makeStampedDraft(),
            products: STALE_PRODUCTS,
            targetDeviceId: 'device-1',
            sendCommand,
            commandStore: store,
            commandIdFactory: () => 'cmd-fijo-0002',
        });

        // Ni un segundo comando: el ACK aplicado se deduplica por payloadKey.
        // Sin esto, el reintento del movimiento ya aplicado lo duplicaría.
        expect(sendCommand).toHaveBeenCalledTimes(1);
        expect(retry.ok).toBe(true);
        expect(retry.status).toBe('applied');
        expect(retry.alreadyApplied).toBe(true);
        expect(retry.commandId).toBe(COMMAND_ID);
    });

    it('un lote distinto tras uno aplicado sí crea un comando nuevo', async () => {
        const store = makeStore();
        const sendCommand = appliedSendMock();

        await sendSupervisorInventoryBatch({
            draft: makeStampedDraft(8),
            products: STALE_PRODUCTS,
            targetDeviceId: 'device-1',
            sendCommand,
            commandStore: store,
            commandIdFactory: () => COMMAND_ID,
        });
        const second = await sendSupervisorInventoryBatch({
            draft: makeStampedDraft(5),
            products: STALE_PRODUCTS,
            targetDeviceId: 'device-1',
            sendCommand,
            commandStore: store,
            commandIdFactory: () => 'cmd-fijo-0002',
        });

        expect(sendCommand).toHaveBeenCalledTimes(2);
        expect(second.alreadyApplied).toBe(false);
    });

    it('un lote rechazado NO se deduplica: reintentarlo vuelve a enviar (era seguro: nada se aplicó)', async () => {
        const store = makeStore();
        const sendCommand = vi.fn()
            .mockResolvedValueOnce({
                ok: true,
                status: 'pending',
                commandId: COMMAND_ID,
                ackPromise: Promise.resolve(terminalAck('rejected', { error: 'La caja rechazó el lote' })),
            })
            .mockResolvedValue({
                ok: true,
                status: 'pending',
                commandId: 'cmd-fijo-0002',
                ackPromise: Promise.resolve({
                    ...terminalAck('applied', { ack: { stockAfter: 30 } }),
                    commandId: 'cmd-fijo-0002',
                }),
            });

        const first = await sendSupervisorInventoryBatch({
            draft: makeStampedDraft(),
            products: STALE_PRODUCTS,
            targetDeviceId: 'device-1',
            sendCommand,
            commandStore: store,
            commandIdFactory: () => COMMAND_ID,
        });
        expect(first.status).toBe('rejected');

        const retry = await sendSupervisorInventoryBatch({
            draft: makeStampedDraft(),
            products: STALE_PRODUCTS,
            targetDeviceId: 'device-1',
            sendCommand,
            commandStore: store,
            commandIdFactory: () => 'cmd-fijo-0002',
        });
        expect(sendCommand).toHaveBeenCalledTimes(2);
        expect(retry.status).toBe('applied');
        expect(retry.alreadyApplied).toBe(false);
    });
});

describe('semántica de objetivo: idempotencia de raíz en el envío', () => {
    function makeTargetDraft(targetStock = 30, quantityInput = 8) {
        return addInventoryDraftLine(createInventoryDraft('ingreso', { reason: 'Ajuste de stock' }), {
            productId: 'a',
            inputUnit: 'unidades',
            quantityInput,
            unitsPerPackage: 1,
            baseStock: 22,
            targetStock,
        }).draft;
    }

    it('reintentar un lote de objetivo ya aplicado es un no-op aplicado: no se crea ningún comando', async () => {
        const sendCommand = vi.fn();
        const result = await sendSupervisorInventoryBatch({
            draft: makeTargetDraft(30),
            products: [{ id: 'a', stock: 30 }], // ya está en el objetivo
            targetDeviceId: 'device-1',
            sendCommand,
            commandStore: makeStore(),
            commandIdFactory: () => COMMAND_ID,
        });

        expect(sendCommand).not.toHaveBeenCalled();
        expect(result.ok).toBe(true);
        expect(result.status).toBe('applied');
        expect(result.alreadyApplied).toBe(true);
        expect(result.results[0].status).toBe('applied');
    });

    it('las líneas satisfechas no viajan en el payload y el objetivo se deriva del stock actual', async () => {
        const sendCommand = vi.fn().mockResolvedValue({
            ok: true,
            status: 'pending',
            commandId: COMMAND_ID,
            ackPromise: Promise.resolve(terminalAck('applied', { ack: { stockAfter: 33 } })),
        });
        let draft = makeTargetDraft(30); // 'a' ya está en 30 → satisfecha
        draft = addInventoryDraftLine(draft, {
            productId: 'b', inputUnit: 'unidades', quantityInput: 5, unitsPerPackage: 1, baseStock: 5, targetStock: 10,
        }).draft;

        const result = await sendSupervisorInventoryBatch({
            draft,
            products: [{ id: 'a', stock: 30 }, { id: 'b', stock: 7 }],
            targetDeviceId: 'device-1',
            sendCommand,
            commandStore: makeStore(),
            commandIdFactory: () => COMMAND_ID,
        });

        expect(sendCommand).toHaveBeenCalledTimes(1);
        const lines = sendCommand.mock.calls[0][0].payload.lines;
        expect(lines).toHaveLength(1);
        expect(lines[0].productId).toBe('b');
        expect(lines[0].expectedStock).toBe(7); // stock actual, no el estampado (5)
        expect(lines[0].quantityInput).toBe(3); // objetivo 10 − actual 7
        expect(result.results.find(item => item.line.productId === 'a').status).toBe('applied');
        expect(result.results.find(item => item.line.productId === 'b').status).toBe('applied');
    });

    it('varias líneas del mismo producto viajan con el MISMO expectedStock (contrato v2)', async () => {
        const sendCommand = vi.fn().mockResolvedValue({
            ok: true,
            status: 'pending',
            commandId: COMMAND_ID,
            ackPromise: Promise.resolve(terminalAck('applied')),
        });
        let draft = makeTargetDraft(30, 8); // a: 22 → 30
        draft = addInventoryDraftLine(draft, {
            productId: 'a', inputUnit: 'cajas', quantityInput: 1, unitsPerPackage: 3, baseStock: 22, targetStock: 25,
        }).draft; // acumula: 22 → 33

        await sendSupervisorInventoryBatch({
            draft,
            products: [{ id: 'a', stock: 22 }],
            targetDeviceId: 'device-1',
            sendCommand,
            commandStore: makeStore(),
            commandIdFactory: () => COMMAND_ID,
        });

        const lines = sendCommand.mock.calls[0][0].payload.lines;
        expect(lines).toHaveLength(2);
        expect(lines[0].expectedStock).toBe(22);
        expect(lines[1].expectedStock).toBe(22);
        expect(lines[0].quantityInput).toBe(8);
        expect(lines[1].quantityInput).toBe(1); // 1 caja × 3 = +3 (22→30→33)
    });
});
