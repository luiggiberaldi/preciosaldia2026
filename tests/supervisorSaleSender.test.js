// G9 — espera del resultado de una venta remota en el monitor: nunca se da por
// registrada sin ACK, la caducidad se cancela en el servidor y el vendedor solo
// puede cancelar mientras la caja no la haya tomado.
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/supabaseCloud.js', () => ({ supabaseCloud: null }));

const { toRemoteSaleOutcome, waitRemoteSaleOutcome } = await import('../src/services/supervisorSaleSender.js');

const APPLIED = { status: 'applied', ack: { saleNumber: 7, sale: { id: 's1' } } };
const states = (...list) => {
    let i = 0;
    return vi.fn(async () => list[Math.min(i++, list.length - 1)]);
};
const base = (over = {}) => ({
    commandId: 'cmd-1',
    sleep: async () => {},
    pollMs: 0,
    ...over,
});

describe('waitRemoteSaleOutcome', () => {
    it('ACK en vivo aplicado → registrada con número de venta', async () => {
        const out = await waitRemoteSaleOutcome(base({ ackPromise: Promise.resolve(APPLIED), inspect: vi.fn() }));
        expect(out).toMatchObject({ phase: 'registered', saleNumber: 7 });
    });

    it('la caja no la toma a tiempo → se cancela en el servidor y no se registra', async () => {
        const cancel = vi.fn(async () => ({ ok: true }));
        const out = await waitRemoteSaleOutcome(base({ inspect: states({ state: 'expired' }), cancel }));
        expect(cancel).toHaveBeenCalledWith('cmd-1');
        expect(out.phase).toBe('not_registered');
        expect(out.error).toMatch(/no tomó la venta a tiempo/);
    });

    it('el vendedor cancela mientras está pendiente → anulada por el vendedor', async () => {
        const cancel = vi.fn(async () => ({ ok: true }));
        const out = await waitRemoteSaleOutcome(base({
            inspect: states({ state: 'active', row: { status: 'pending' } }),
            cancel,
            isCancelRequested: () => true,
        }));
        expect(cancel).toHaveBeenCalledWith('cmd-1', expect.stringMatching(/cancelada por el vendedor/));
        expect(out).toMatchObject({ phase: 'not_registered' });
        expect(out.error).toMatch(/Cancelaste la venta/);
    });

    it('si la caja ya la tomó, cancelar se rechaza y se espera el resultado real', async () => {
        const onProgress = vi.fn();
        const cancel = vi.fn(async () => ({ ok: false, status: 'received' }));
        const out = await waitRemoteSaleOutcome(base({
            inspect: states({ state: 'active', row: { status: 'received' } }, { state: 'terminal', ack: APPLIED }),
            cancel,
            onProgress,
            isCancelRequested: () => true,
        }));
        expect(cancel).toHaveBeenCalledTimes(1);
        expect(onProgress).toHaveBeenCalledWith('cancel_refused');
        expect(out).toMatchObject({ phase: 'registered', saleNumber: 7 });
    });

    it('un pedido de cancelar no espera los 10 s del ACK en vivo', async () => {
        const cancel = vi.fn(async () => ({ ok: true }));
        const never = new Promise(() => {});
        const started = Date.now();
        const out = await waitRemoteSaleOutcome(base({
            ackPromise: never,
            inspect: states({ state: 'active', row: { status: 'pending' } }),
            cancel,
            isCancelRequested: () => true,
        }));
        expect(out.phase).toBe('not_registered');
        expect(Date.now() - started).toBeLessThan(2000);
    });

    it('orden ausente en el servidor → falló, no registrada', async () => {
        const out = await waitRemoteSaleOutcome(base({ inspect: states({ state: 'absent' }) }));
        expect(out.phase).toBe('failed');
    });
});

describe('toRemoteSaleOutcome', () => {
    it('caja vieja (tipo no soportado) → pide actualizar', () => {
        expect(toRemoteSaleOutcome({ status: 'failed', error: 'Tipo de comando no soportado' }).error).toMatch(/Actualízala/);
    });
});
