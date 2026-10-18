import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    SUPERVISOR_COMMAND_QUEUE_KEY,
    countQueuedSupervisorCommands,
    discardAllQueuedSupervisorCommands,
    discardQueuedSupervisorCommand,
    enqueueSupervisorCommand,
    flushSupervisorCommandQueue,
    flushSupervisorCommandQueueWrite,
    getQueuedSupervisorCommands,
    isConnectivityError,
    productIdsOf,
    queuedProductIds,
    resetSupervisorCommandQueue,
    sendOrQueueSupervisorCommand,
    subscribeSupervisorCommandQueue,
} from '../src/services/supervisorCommandQueue';

function makeStorage() {
    const values = {};
    return {
        values,
        getItem(key) { return values[key] ?? null; },
        setItem(key, value) { values[key] = String(value); },
        removeItem(key) { delete values[key]; },
    };
}

beforeEach(() => {
    resetSupervisorCommandQueue();
});

describe('productIdsOf: qué productos toca cada orden', () => {
    it('inventario: línea única o varias líneas, sin repetidos', () => {
        expect(productIdsOf('supervisor.inventory.batch.adjust', { productId: 'p1' })).toEqual(['p1']);
        expect(productIdsOf('supervisor.inventory.batch.adjust', {
            lines: [{ productId: 'p1' }, { productId: 'p2' }, { productId: 'p1' }],
        })).toEqual(['p1', 'p2']);
    });

    it('productos: create/update/delete devuelven su id; otros tipos ninguno', () => {
        expect(productIdsOf('supervisor.product.create', { product: { id: 'p9' } })).toEqual(['p9']);
        expect(productIdsOf('supervisor.product.update', { productId: 'p3' })).toEqual(['p3']);
        expect(productIdsOf('supervisor.product.delete', { productId: 'p4' })).toEqual(['p4']);
        expect(productIdsOf('supervisor.rate.set', { rateMode: 'bcv' })).toEqual([]);
    });
});

describe('la cola guarda los cambios sin subir', () => {
    it('encolar, contar y ver los productos afectados', () => {
        const entry = enqueueSupervisorCommand({
            kind: 'stock',
            type: 'supervisor.inventory.batch.adjust',
            payload: { direction: 'ingreso', productId: 'p1', quantityInput: 8 },
            label: 'Ajuste de stock',
        });
        expect(entry.productIds).toEqual(['p1']);
        expect(countQueuedSupervisorCommands()).toBe(1);
        expect([...queuedProductIds()]).toEqual(['p1']);
    });

    it('persiste en storage y sobrevive a una "recarga"', async () => {
        const storage = makeStorage();
        resetSupervisorCommandQueue({ storage });
        enqueueSupervisorCommand({ type: 'supervisor.product.delete', payload: { productId: 'p1' } });
        await flushSupervisorCommandQueueWrite();
        expect(JSON.parse(storage.values[SUPERVISOR_COMMAND_QUEUE_KEY])).toHaveLength(1);

        resetSupervisorCommandQueue({ storage, clearStorage: false }); // recarga: memoria vacía, storage intacto
        expect(countQueuedSupervisorCommands()).toBe(1);
        expect(getQueuedSupervisorCommands()[0].productIds).toEqual(['p1']);
    });

    it('descartar una entrada o toda la cola, con aviso a suscriptores', () => {
        const listener = vi.fn();
        subscribeSupervisorCommandQueue(listener);
        const first = enqueueSupervisorCommand({ type: 'supervisor.product.delete', payload: { productId: 'p1' } });
        enqueueSupervisorCommand({ type: 'supervisor.product.delete', payload: { productId: 'p2' } });
        expect(listener).toHaveBeenCalled();

        expect(discardQueuedSupervisorCommand(first.id)).toBe(true);
        expect(countQueuedSupervisorCommands()).toBe(1);
        expect(discardQueuedSupervisorCommand('desconocida')).toBe(false);

        expect(discardAllQueuedSupervisorCommands()).toBe(1);
        expect(countQueuedSupervisorCommands()).toBe(0);
    });

    it('el unsubscribe deja de avisar', () => {
        const listener = vi.fn();
        const unsubscribe = subscribeSupervisorCommandQueue(listener);
        unsubscribe();
        enqueueSupervisorCommand({ type: 'supervisor.product.delete', payload: { productId: 'p1' } });
        expect(listener).not.toHaveBeenCalled();
    });
});

describe('flushSupervisorCommandQueue: reenvío en orden, sin saltos', () => {
    it('envía en orden, borra las confirmadas y se detiene en el primer fallo', async () => {
        const a = enqueueSupervisorCommand({ type: 'supervisor.product.delete', payload: { productId: 'p1' }, label: 'a' });
        const b = enqueueSupervisorCommand({ type: 'supervisor.product.delete', payload: { productId: 'p2' }, label: 'b' });
        const c = enqueueSupervisorCommand({ type: 'supervisor.product.delete', payload: { productId: 'p3' }, label: 'c' });

        const sent = [];
        const send = vi.fn(async (entry) => {
            sent.push(entry.label);
            return entry.label === 'b'
                ? { ok: false, error: 'La caja está desconectada' }
                : { ok: true, commandId: `cmd-${entry.label}` };
        });

        const summary = await flushSupervisorCommandQueue({ send });

        expect(sent).toEqual(['a', 'b']); // 'c' jamás se salta a 'b'
        expect(summary).toMatchObject({ sent: 1, failed: 1 });
        const remaining = getQueuedSupervisorCommands();
        expect(remaining.map(entry => entry.id)).toEqual([b.id, c.id]);
        expect(remaining[0]).toMatchObject({ attempts: 1, lastError: 'La caja está desconectada' });
        expect(remaining.some(entry => entry.id === a.id)).toBe(false);
    });

    it('un throw del send cuenta como fallo y conserva la entrada', async () => {
        enqueueSupervisorCommand({ type: 'supervisor.rate.set', payload: { rateMode: 'bcv' } });
        const summary = await flushSupervisorCommandQueue({
            send: async () => { throw new Error('fetch falló'); },
        });
        expect(summary).toMatchObject({ sent: 0, failed: 1 });
        expect(countQueuedSupervisorCommands()).toBe(1);
    });
});

describe('sendOrQueueSupervisorCommand: guardar en vez de perder', () => {
    const sendArgs = {
        type: 'supervisor.product.delete',
        payload: { productId: 'p1' },
        label: 'Baja de producto',
    };

    it('sin conexión, el cambio se guarda en la cola (ok con queued)', async () => {
        const send = vi.fn();
        const result = await sendOrQueueSupervisorCommand({ ...sendArgs, canSend: false, send });
        expect(send).not.toHaveBeenCalled();
        expect(result).toMatchObject({ ok: true, queued: true });
        expect(countQueuedSupervisorCommands()).toBe(1);
    });

    it('enviado de verdad, NO queda en cola', async () => {
        const send = vi.fn(async () => ({ ok: true, commandId: 'cmd-1', ackPromise: Promise.resolve() }));
        const result = await sendOrQueueSupervisorCommand({ ...sendArgs, canSend: true, send });
        expect(result).toMatchObject({ ok: true, commandId: 'cmd-1' });
        expect(result.queued).toBeUndefined();
        expect(countQueuedSupervisorCommands()).toBe(0);
    });

    it('un fallo de conectividad al enviar también guarda en cola', async () => {
        const send = vi.fn(async () => ({ ok: false, error: 'Network error: fetch failed' }));
        const result = await sendOrQueueSupervisorCommand({ ...sendArgs, canSend: true, send });
        expect(result).toMatchObject({ ok: true, queued: true });
        expect(countQueuedSupervisorCommands()).toBe(1);
    });

    it('un rechazo del servidor (no conectividad) NO se encola: se reporta', async () => {
        const send = vi.fn(async () => ({ ok: false, error: 'Payload inválido' }));
        const result = await sendOrQueueSupervisorCommand({ ...sendArgs, canSend: true, send });
        expect(result).toMatchObject({ ok: false, error: 'Payload inválido' });
        expect(countQueuedSupervisorCommands()).toBe(0);
    });

    it('isConnectivityError distingue "ahora no" de "esto no vale"', () => {
        expect(isConnectivityError('La caja está desconectada; no se puede enviar la orden')).toBe(true);
        expect(isConnectivityError('Network error')).toBe(true);
        expect(isConnectivityError('sin conexión')).toBe(true);
        expect(isConnectivityError('Tipo de comando no permitido')).toBe(false);
        expect(isConnectivityError('El producto ya no existe')).toBe(false);
    });
});
