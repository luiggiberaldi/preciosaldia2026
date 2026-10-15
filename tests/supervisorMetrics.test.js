import { describe, expect, it } from 'vitest';
import {
    calculateInventoryMetrics,
    calculateInventoryMovementMetrics,
    calculateSalesProfit,
} from '../src/services/supervisorMetrics';

describe('Supervisor metrics contract', () => {
    it('usa costUsd y priceUsd para valorar inventario', () => {
        const result = calculateInventoryMetrics([
            { id: 'p1', stock: 10, costUsd: 2, priceUsd: 5, lowStockAlert: 2 },
        ]);

        expect(result.totalCost).toBe(20);
        expect(result.totalRetail).toBe(50);
        expect(result.expectedProfit).toBe(30);
        expect(result.totalQty).toBe(10);
    });

    it('acepta costPrice/priceUsdt solamente como fallback legacy', () => {
        const result = calculateInventoryMetrics([
            { id: 'p1', stock: 2, costPrice: 3, priceUsdt: 7, minStock: 3 },
        ]);

        expect(result.totalCost).toBe(6);
        expect(result.totalRetail).toBe(14);
        expect(result.lowStockCount).toBe(1);
    });

    it('calcula ganancia por items usando el producto asociado', () => {
        const result = calculateSalesProfit([
            {
                totalUsd: 20,
                items: [{ productId: 'p1', qty: 2 }],
            },
        ], [
            { id: 'p1', costUsd: 4 },
        ]);

        expect(result.revenueUsd).toBe(20);
        expect(result.costUsd).toBe(8);
        expect(result.profitUsd).toBe(12);
    });

    it('tolera payloads incompletos sin producir NaN', () => {
        const inventory = calculateInventoryMetrics([null, { id: 'p2' }]);
        const sales = calculateSalesProfit([{ items: [{ productId: 'missing', qty: 'x' }] }], []);

        expect(inventory.totalCost).toBe(0);
        expect(inventory.totalRetail).toBe(0);
        expect(sales.revenueUsd).toBe(0);
        expect(sales.costUsd).toBe(0);
        expect(Number.isNaN(sales.profitUsd)).toBe(false);
    });
});

describe('calculateInventoryMovementMetrics', () => {
    it('separa ingresos y egresos y ordena los movimientos recientes', () => {
        const metrics = calculateInventoryMovementMetrics([
            { tipo: 'AJUSTE_ENTRADA', timestamp: '2026-01-01T10:00:00Z', unitsDelta: 12 },
            { tipo: 'VENTA', timestamp: '2026-01-01T12:00:00Z', unitsDelta: 99 },
            { tipo: 'AJUSTE_SALIDA', timestamp: '2026-01-01T11:00:00Z', unitsDelta: 2 },
        ]);
        expect(metrics.total).toBe(2);
        expect(metrics.incomeUnits).toBe(12);
        expect(metrics.egressUnits).toBe(2);
        expect(metrics.recent[0].tipo).toBe('AJUSTE_SALIDA');
    });
});
