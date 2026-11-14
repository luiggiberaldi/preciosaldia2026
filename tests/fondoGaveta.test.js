// CAJA-FONDO-001/002: efectivo en gaveta para el cobro y aviso de efectivo insuficiente.
import { describe, expect, it } from 'vitest';
import { calcularFondoEnGaveta, evaluarFondoParaVuelto } from '../src/utils/fondoGaveta.js';
import { isShiftCashMovement } from '../src/utils/cashShift.js';

const RATE = 914;
const apertura = (over = {}) => ({
    id: 'apertura_1', tipo: 'APERTURA_CAJA',
    openingUsd: 20, openingBs: 500, openingCop: 0,
    timestamp: '2026-11-12T22:00:00.000Z', cajaCerrada: false, ...over,
});
// Venta de $4 pagada con $10 en efectivo; vuelto $6 en billetes.
const venta = (over = {}) => ({
    id: 'v1', tipo: 'VENTA', totalUsd: 4, totalBs: 4 * RATE, rate: RATE,
    payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 10, amountBs: 10 * RATE }],
    changeUsd: 6, changeBs: 0,
    timestamp: '2026-11-13T02:00:00.000Z', cajaCerrada: false, ...over,
});

describe('calcularFondoEnGaveta', () => {
    it('resta los vueltos ya entregados (antes los ignoraba)', () => {
        const fondo = calcularFondoEnGaveta([apertura(), venta()], '2026-11-13');
        // 20 fondo + 10 cobrados - 6 de vuelto
        expect(fondo.usd).toBe(24);
        expect(fondo.bs).toBe(500);
    });

    it('no olvida el fondo de la apertura después de medianoche', () => {
        // Apertura de "ayer"; hoy es otro día del calendario.
        const fondo = calcularFondoEnGaveta([apertura()], '2026-11-14');
        expect(fondo).toEqual({ usd: 20, bs: 500, cop: 0 });
    });

    it('ignora lo ya cerrado y las ventas anuladas', () => {
        const records = [
            apertura({ id: 'vieja', cajaCerrada: true, timestamp: '2026-11-10T10:00:00.000Z' }),
            apertura(),
            venta({ id: 'anulada', status: 'ANULADA' }),
            venta({ id: 'cerrada', cajaCerrada: true }),
        ];
        expect(calcularFondoEnGaveta(records, '2026-11-13')).toEqual({ usd: 20, bs: 500, cop: 0 });
    });

    it('vuelto en Bs sin fondo en Bs deja la gaveta en negativo (caso real del −2.159,35 Bs)', () => {
        const fondo = calcularFondoEnGaveta([
            apertura({ openingBs: 0 }),
            venta({ changeUsd: 3.64, changeBs: 2159.35 }),
        ], '2026-11-13');
        expect(fondo.bs).toBe(-2159.35);
    });
});

describe('isShiftCashMovement', () => {
    it('excluye egresos que no afectan la caja', () => {
        const gasto = { id: 'g', tipo: 'GASTO_INTERNO', afectaCaja: false, timestamp: '2026-11-13T03:00:00.000Z' };
        expect(isShiftCashMovement(gasto, apertura(), '2026-11-13')).toBe(false);
    });

    it('sin caja abierta solo cuenta lo de hoy sin cerrar', () => {
        const hoy = venta({ timestamp: new Date(2026, 10, 13, 10).toISOString() });
        const ayer = venta({ timestamp: new Date(2026, 10, 12, 10).toISOString() });
        expect(isShiftCashMovement(hoy, null, '2026-11-13')).toBe(true);
        expect(isShiftCashMovement(ayer, null, '2026-11-13')).toBe(false);
    });
});

describe('evaluarFondoParaVuelto', () => {
    it('avisa cuando el vuelto en Bs supera lo que hay', () => {
        const r = evaluarFondoParaVuelto({ usdGiven: '3', bsGiven: '2159.35', floatUsd: 24, floatBs: 0 });
        expect(r.alcanza).toBe(false);
        expect(r.faltaBs).toBe(2159.35);
        expect(r.faltaUsd).toBe(0);
    });

    it('respeta las tolerancias ($0,05 y Bs 1)', () => {
        expect(evaluarFondoParaVuelto({ usdGiven: 10.04, bsGiven: 100.5, floatUsd: 10, floatBs: 100 }).alcanza).toBe(true);
        expect(evaluarFondoParaVuelto({ usdGiven: 10.1, bsGiven: 0, floatUsd: 10, floatBs: 100 }).faltaUsd).toBe(0.1);
    });

    it('con el fondo desconocido (venta remota) no avisa', () => {
        const r = evaluarFondoParaVuelto({ usdGiven: 50, bsGiven: 9000, floatUsd: null, floatBs: undefined });
        expect(r.evaluado).toBe(false);
    });
});
