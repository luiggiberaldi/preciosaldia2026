// tests/stockDeltaReconciliation.test.js
//
// Fase 1 del plan docs/plans/2026-10-21-plan-stock-delta-en-doc-de-venta.md:
// reconciliación PURA del stock visible desde los efectos embebidos en la
// familia de ventas (idempotente, insensible al orden, re-derivable desde cero).

import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/supabaseCloud', () => ({
    supabaseCloud: {
        from: () => ({ upsert: async () => ({ data: null, error: null }) }),
        channel: () => ({ on: () => ({ subscribe: () => {} }) }),
        removeChannel: () => {},
        rpc: async () => ({ data: null, error: null }),
    },
    supabaseCloudUrl: 'https://test.supabase.co',
}));

import {
    collectStockEffectsDeltas,
    reconcileStockFromEffects,
} from '../src/hooks/useCloudSync';

const AS_OF = '2026-10-21T12:00:00.000Z';

const product = (id, stock, extra = {}) => ({ id, name: id, stock, packagingType: 'suelto', unit: 'unidad', ...extra });
const saleRecord = (id, at, stockEffects) => ({ id, tipo: 'VENTA', status: 'COMPLETADA', timestamp: at, stockEffects });

describe('reconcileStockFromEffects (plan de stock delta)', () => {
    it('pliega sobre el baseline solo los efectos posteriores a stockAsOf', () => {
        const products = [product('p1', 10), product('p2', 4)];
        const sales = [
            saleRecord('v1', '2026-10-21T11:59:00.000Z', [{ productId: 'p1', delta: -3, at: '2026-10-21T11:59:00.000Z' }]), // ya en el baseline
            saleRecord('v2', '2026-10-21T12:05:00.000Z', [{ productId: 'p1', delta: -2, at: '2026-10-21T12:05:00.000Z' }]),
            saleRecord('v3', '2026-10-21T12:06:00.000Z', [{ productId: 'p2', delta: -1, at: '2026-10-21T12:06:00.000Z' }]),
        ];

        const derived = reconcileStockFromEffects(products, sales, AS_OF);
        expect(derived.map(p => p.stock)).toEqual([8, 3]);
    });

    it('una venta anulada (log append-only) deja el neto en cero', () => {
        const products = [product('p1', 10)];
        const at1 = '2026-10-21T12:05:00.000Z';
        const at2 = '2026-10-21T12:30:00.000Z';
        const voided = saleRecord('v1', at1, [
            { productId: 'p1', delta: -4, at: at1 },
            { productId: 'p1', delta: 4, at: at2 }, // efecto inverso de la anulación
        ]);

        expect(reconcileStockFromEffects(products, [voided], AS_OF)[0].stock).toBe(10);
    });

    it('la anulación de una venta ANTERIOR al baseline aplica su efecto inverso', () => {
        // El cobro ya está en el baseline (stock 7 = 10 − 3); la anulación
        // restaura +3 y su efecto sí debe plegarse.
        const products = [product('p1', 7)];
        const voided = saleRecord('v1', '2026-10-21T10:00:00.000Z', [
            { productId: 'p1', delta: -3, at: '2026-10-21T10:00:00.000Z' }, // ≤ stockAsOf: no cuenta
            { productId: 'p1', delta: 3, at: '2026-10-21T12:05:00.000Z' }, // posterior: cuenta
        ]);

        expect(reconcileStockFromEffects(products, [voided], AS_OF)[0].stock).toBe(10);
    });

    it('es idempotente e insensible al orden (re-derivable desde cero)', () => {
        const products = [product('p1', 10), product('p2', 5), product('p3', 1)];
        const sales = [
            saleRecord('v1', '2026-10-21T12:01:00.000Z', [{ productId: 'p1', delta: -1, at: '2026-10-21T12:01:00.000Z' }]),
            saleRecord('v2', '2026-10-21T12:02:00.000Z', [{ productId: 'p1', delta: -2, at: '2026-10-21T12:02:00.000Z' }]),
            saleRecord('v3', '2026-10-21T12:03:00.000Z', [{ productId: 'p2', delta: -5, at: '2026-10-21T12:03:00.000Z' }]),
        ];

        const forward = reconcileStockFromEffects(products, sales, AS_OF);
        const reversed = reconcileStockFromEffects(products, [...sales].reverse(), AS_OF);
        const twice = reconcileStockFromEffects(forward, [], AS_OF);

        expect(reversed.map(p => p.stock)).toEqual(forward.map(p => p.stock));
        expect(twice.map(p => p.stock)).toEqual(forward.map(p => p.stock));
        expect(forward.map(p => p.stock)).toEqual([7, 0, 1]);
    });

    it('pliega los movimientos de lote del supervisor (stockBefore/stockAfter)', () => {
        const products = [product('p1', 10)];
        const movement = {
            id: 'supervisor-cmd-1-line-a',
            movementId: 'supervisor-cmd-1-line-a',
            tipo: 'AJUSTE_ENTRADA',
            productId: 'p1',
            unitsDelta: 48,
            stockBefore: 10,
            stockAfter: 58,
            timestamp: '2026-10-21T12:10:00.000Z',
        };

        expect(reconcileStockFromEffects(products, [movement], AS_OF)[0].stock).toBe(58);
    });

    it('granel conserva 3 decimales al sumar efectos', () => {
        const granel = product('queso', 2, { packagingType: 'granel', granelUnit: 'kg', isWeight: true });
        const sales = [
            saleRecord('v1', '2026-10-21T12:05:00.000Z', [{ productId: 'queso', delta: -0.35, at: '2026-10-21T12:05:00.000Z' }]),
            saleRecord('v2', '2026-10-21T12:06:00.000Z', [{ productId: 'queso', delta: -0.125, at: '2026-10-21T12:06:00.000Z' }]),
        ];

        expect(reconcileStockFromEffects([granel], sales, AS_OF)[0].stock).toBe(1.525);
    });

    it('sin stockAsOf válido no pliega nada (escritores legacy)', () => {
        const products = [product('p1', 10)];
        const sales = [saleRecord('v1', '2026-10-21T12:05:00.000Z', [{ productId: 'p1', delta: -2, at: '2026-10-21T12:05:00.000Z' }])];

        expect(reconcileStockFromEffects(products, sales, null)[0].stock).toBe(10);
        expect(reconcileStockFromEffects(products, sales, 'basura')[0].stock).toBe(10);
    });

    it('efectos sin `at` válido o sin delta finito se ignoran (nunca doble cuentan)', () => {
        const products = [product('p1', 10)];
        const sales = [saleRecord('v1', '2026-10-21T12:05:00.000Z', [
            { productId: 'p1', delta: -2 },                       // sin at
            { productId: 'p1', delta: -2, at: 'no-fecha' },       // at inválido
            { productId: 'p1', delta: 'x', at: '2026-10-21T12:05:00.000Z' }, // delta no numérico
            { productId: 'p1', delta: 0, at: '2026-10-21T12:05:00.000Z' },   // sin efecto
        ])];

        expect(reconcileStockFromEffects(products, sales, AS_OF)[0].stock).toBe(10);
        expect(collectStockEffectsDeltas(sales, AS_OF).size).toBe(0);
    });
});
