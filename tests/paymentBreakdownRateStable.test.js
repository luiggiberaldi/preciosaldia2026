// Los % de «Medios de pago» no deben moverse al cambiar la tasa de hoy:
// cada pago en USD pesa con la tasa de SU venta (bsAtSale); solo lo que no la
// trae (registros legacy) usa la tasa vigente.
import { describe, expect, it } from 'vitest';
import { FinancialEngine } from '../src/core/FinancialEngine';
import { buildPaymentBreakdownRows, toBsEquivalent } from '../src/utils/paymentBreakdownView';

const venta = (id, rate, payments) => ({ id, tipo: 'VENTA', status: 'COMPLETADA', rate, totalUsd: 0, totalBs: 0, payments });
const usd = (amountUsd) => ({ methodId: 'efectivo_usd', currency: 'USD', amountUsd, amountBs: 0 });
const bs = (amountBs) => ({ methodId: 'efectivo_bs', currency: 'BS', amountBs, amountUsd: 0 });

const pctOf = (breakdown, rate) => {
    const { methods } = buildPaymentBreakdownRows(breakdown, { bcvRate: rate });
    return Object.fromEntries(methods.map((m) => [m.key, m.pct]));
};

describe('% de medios de pago estables ante cambios de tasa', () => {
    const sales = [
        venta('a', 800, [usd(10)]),
        venta('b', 800, [bs(8000)]),
        venta('c', 900, [usd(8)]),
    ];
    const breakdown = FinancialEngine.calculatePaymentBreakdown(sales);

    it('el motor registra el peso en Bs de cada pago en USD con su tasa', () => {
        expect(breakdown.efectivo_usd).toMatchObject({ total: 18, usdAtSale: 18, bsAtSale: 15200 });
        expect(breakdown.efectivo_bs.total).toBe(8000);
    });

    it('con tasa de hoy 1, 889 o 1500 los porcentajes son los mismos', () => {
        const base = pctOf(breakdown, 889.26);
        expect(base.efectivo_usd).toBeCloseTo(65.52, 1); // 15200 / 23200
        expect(base.efectivo_bs).toBeCloseTo(34.48, 1);
        expect(pctOf(breakdown, 1)).toEqual(base);
        expect(pctOf(breakdown, 1500)).toEqual(base);
    });

    it('registros legacy sin tasa de venta siguen usando la tasa vigente', () => {
        const legacy = FinancialEngine.calculatePaymentBreakdown([
            { id: 'x', tipo: 'VENTA', status: 'COMPLETADA', totalUsd: 10, totalBs: 0, payments: [usd(10)] },
        ]);
        expect(legacy.efectivo_usd.bsAtSale).toBeUndefined();
        expect(toBsEquivalent(legacy.efectivo_usd, { bcvRate: 500 })).toBe(5000);
        expect(toBsEquivalent(legacy.efectivo_usd, { bcvRate: 600 })).toBe(6000);
    });

    it('mezcla: lo con tasa conserva la suya y el resto usa la de hoy', () => {
        const mixed = FinancialEngine.calculatePaymentBreakdown([
            venta('a', 800, [usd(10)]),
            { id: 'x', tipo: 'VENTA', status: 'COMPLETADA', totalUsd: 5, totalBs: 0, payments: [usd(5)] },
        ]);
        expect(toBsEquivalent(mixed.efectivo_usd, { bcvRate: 1000 })).toBe(8000 + 5000);
    });
});
