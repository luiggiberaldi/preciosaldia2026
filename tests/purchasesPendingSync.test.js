// Compras confirmadas por la caja que aún no llegan de la nube (Supervisor).
import { describe, expect, it } from 'vitest';
import { computeUnsyncedPurchases, PURCHASE_SYNC_STALE_MS } from '../src/utils/purchasesPendingSync';

const T0 = Date.parse('2026-10-31T12:44:00Z');
const purchase = (id, updatedAt, extra = {}) => ({ id, date: '2026-10-01', supplier: `P-${id}`, amountUsd: 10, updatedAt, ...extra });
const upsert = (id, p, at, status = 'applied_with_warnings') => ({
    command_id: `c-${id}-${at}`, command_type: 'supervisor.purchase.upsert', status,
    issued_at: new Date(at).toISOString(), payload: { v: 1, purchase: p },
});
const del = (id, at) => ({
    command_id: `d-${id}-${at}`, command_type: 'supervisor.purchase.delete', status: 'applied',
    issued_at: new Date(at).toISOString(), payload: { v: 1, purchaseId: id, supplier: `P-${id}` },
});

describe('computeUnsyncedPurchases', () => {
    it('lista las compras aplicadas que no están en la lista sincronizada', () => {
        const p1 = purchase('a', '2026-10-31T12:44:00.000Z');
        const p2 = purchase('b', '2026-10-31T12:50:00.000Z');
        const r = computeUnsyncedPurchases([upsert('a', p1, T0), upsert('b', p2, T0 + 60_000)], [p1], T0 + 120_000);
        expect(r.items.map((i) => i.purchase.id)).toEqual(['b']);
        expect(r.stale).toBe(false);
    });

    it('una corrección pendiente sigue listada hasta que llega su versión', () => {
        const old = purchase('a', '2026-10-31T12:44:00.000Z');
        const edited = purchase('a', '2026-10-31T13:00:00.000Z', { amountUsd: 20 });
        const r = computeUnsyncedPurchases([upsert('a', old, T0), upsert('a', edited, T0 + 60_000)], [old], T0 + 90_000);
        expect(r.items).toHaveLength(1);
        expect(r.items[0].purchase.amountUsd).toBe(20);
        expect(computeUnsyncedPurchases([upsert('a', edited, T0)], [edited], T0).items).toEqual([]);
    });

    it('un borrado queda pendiente mientras la compra siga en la nube', () => {
        const p = purchase('a', '2026-10-31T12:44:00.000Z');
        const commands = [upsert('a', p, T0), del('a', T0 + 60_000)];
        const pending = computeUnsyncedPurchases(commands, [p], T0 + 90_000);
        expect(pending.items).toEqual([expect.objectContaining({ kind: 'delete' })]);
        expect(computeUnsyncedPurchases(commands, [], T0 + 90_000).items).toEqual([]);
    });

    it('ignora órdenes no aplicadas y avisa cuando la espera pasa el umbral', () => {
        const p = purchase('a', '2026-10-31T12:44:00.000Z');
        expect(computeUnsyncedPurchases([upsert('a', p, T0, 'pending'), upsert('a', p, T0, 'rejected')], []).items).toEqual([]);
        const r = computeUnsyncedPurchases([upsert('a', p, T0)], [], T0 + PURCHASE_SYNC_STALE_MS + 1);
        expect(r.stale).toBe(true);
        expect(r.oldestAt).toBe(T0);
    });
});
