/**
 * tests/payrollModel.test.js — Nómina F1: cálculos puros.
 * Plan: docs/plans/2026-11-14-plan-nomina-simple-bodega.md
 */
import { describe, expect, it } from 'vitest';
import {
    periodIdFor, periodRange, nextPeriodId, previousPeriodId, periodLabel, parsePeriodId,
    normalizeEmployeeInput, computePeriodBalance, evaluateEntry, canVoidEntry, canChangeFrequency,
    frozenSalaryUsd,
} from '../src/utils/payrollModel.js';

const emp = { id: 'e1', nombre: 'María', sueldoUsd: 100, frecuencia: 'quincenal' };
let n = 0;
const entry = (over) => ({
    id: `r${++n}`, employeeId: 'e1', periodoId: 'Q-2026-11-2', sueldoPeriodoUsd: 100, origen: 'MANUAL',
    status: 'ACTIVO', timestamp: `2026-11-16T1${n % 10}:00:00.000Z`, montoUsd: 0, ...over,
});

describe('periodos (hora de Caracas)', () => {
    it('semanal: lunes a domingo, con id ISO', () => {
        // Martes 10-11-2026 a mediodía en Caracas.
        expect(periodIdFor('2026-11-10T16:00:00.000Z', 'semanal')).toBe('S-2026-W46');
        expect(periodRange('S-2026-W46')).toEqual({
            inicio: '2026-11-09T04:00:00.000Z', // lunes 00:00 en Caracas
            fin: '2026-11-16T04:00:00.000Z',
        });
        // Domingo 15-11 a las 23:30 de Caracas = lunes 03:30 UTC: sigue en la semana 46.
        expect(periodIdFor('2026-11-16T03:30:00.000Z', 'semanal')).toBe('S-2026-W46');
        expect(periodIdFor('2026-11-16T04:00:00.000Z', 'semanal')).toBe('S-2026-W47');
    });

    it('semana que cruza de año', () => {
        expect(periodIdFor('2027-01-01T16:00:00.000Z', 'semanal')).toBe('S-2026-W53');
        expect(nextPeriodId('S-2026-W53')).toBe('S-2027-W01');
        expect(previousPeriodId('S-2027-W01')).toBe('S-2026-W53');
    });

    it('quincenal: el 15 y el 16 caen en quincenas distintas', () => {
        expect(periodIdFor('2026-11-15T20:00:00.000Z', 'quincenal')).toBe('Q-2026-11-1');
        expect(periodIdFor('2026-11-16T20:00:00.000Z', 'quincenal')).toBe('Q-2026-11-2');
        expect(periodRange('Q-2026-11-2').fin).toBe('2026-12-01T04:00:00.000Z');
        expect(nextPeriodId('Q-2026-12-2')).toBe('Q-2027-01-1');
        expect(previousPeriodId('Q-2026-11-1')).toBe('Q-2026-10-2');
    });

    it('mensual: febrero de año bisiesto y no bisiesto', () => {
        expect(periodRange('M-2028-02').fin).toBe('2028-03-01T04:00:00.000Z');
        expect(periodLabel('Q-2027-02-2')).toBe('2.ª quincena de febrero de 2027 (16–28)');
        expect(periodLabel('M-2026-11')).toBe('Noviembre de 2026');
        expect(periodLabel('S-2026-W46')).toBe('Semana del 9 al 15 de noviembre de 2026');
    });

    it('rechaza ids y frecuencias que no existen', () => {
        expect(() => parsePeriodId('X-1')).toThrow();
        expect(() => periodIdFor(new Date(), 'diaria')).toThrow();
    });
});

describe('normalizeEmployeeInput', () => {
    it('limpia y redondea', () => {
        expect(normalizeEmployeeInput({ nombre: ' Ana ', sueldoUsd: '80.555', frecuencia: 'semanal' }))
            .toMatchObject({ nombre: 'Ana', sueldoUsd: 80.56, frecuencia: 'semanal' });
    });
    it('rechaza nombre vacío, sueldo cero y frecuencia rara', () => {
        expect(() => normalizeEmployeeInput({ nombre: '', sueldoUsd: 10 })).toThrow(/nombre/);
        expect(() => normalizeEmployeeInput({ nombre: 'A', sueldoUsd: 0 })).toThrow(/sueldo/);
        expect(() => normalizeEmployeeInput({ nombre: 'A', sueldoUsd: 5, frecuencia: 'diaria' })).toThrow(/semanal/);
    });
});

describe('computePeriodBalance', () => {
    it('sueldo + bono − descuento − adelanto − pago; lo anulado no cuenta', () => {
        const entries = [
            entry({ tipo: 'BONO', montoUsd: 10 }),
            entry({ tipo: 'DESCUENTO', montoUsd: 5 }),
            entry({ tipo: 'ADELANTO', montoUsd: 30 }),
            entry({ tipo: 'ADELANTO', montoUsd: 20, status: 'ANULADO' }),
            entry({ tipo: 'PAGO', montoUsd: 25 }),
        ];
        const bal = computePeriodBalance(entries, emp, 'Q-2026-11-2');
        expect(bal).toMatchObject({ sueldoPeriodoUsd: 100, bonosUsd: 10, descuentosUsd: 5, adelantosUsd: 30, pagosUsd: 25, saldoUsd: 50, estado: 'EN_CURSO' });
    });

    it('cambio de sueldo a mitad de periodo: vale la foto', () => {
        const entries = [entry({ tipo: 'ADELANTO', montoUsd: 10, sueldoPeriodoUsd: 100 })];
        const subio = { ...emp, sueldoUsd: 150 };
        expect(frozenSalaryUsd(entries, subio, 'Q-2026-11-2')).toBe(100);
        expect(computePeriodBalance(entries, subio, 'Q-2026-11-2').saldoUsd).toBe(90);
        // El periodo siguiente, sin renglones, ya usa el sueldo nuevo.
        expect(computePeriodBalance(entries, subio, 'Q-2026-12-1').saldoUsd).toBe(150);
    });

    it('arrastre: el periodo que se pasó queda en 0 y el siguiente debe la diferencia', () => {
        const pago = entry({ tipo: 'PAGO', montoUsd: 110 });
        const arrastre = entry({ tipo: 'DESCUENTO', origen: 'ARRASTRE', montoUsd: 10, periodoId: 'Q-2026-12-1', periodoOrigenId: 'Q-2026-11-2', arrastreDe: pago.id });
        const entries = [pago, arrastre];
        expect(computePeriodBalance(entries, emp, 'Q-2026-11-2')).toMatchObject({ saldoUsd: 0, estado: 'PAGADO', arrastreEnviadoUsd: 10 });
        expect(computePeriodBalance(entries, emp, 'Q-2026-12-1')).toMatchObject({ saldoUsd: 90, arrastreRecibidoUsd: 10 });
    });

    it('redondeo: tres adelantos de $33,33 dejan $0,01, sin centavos fantasma', () => {
        const entries = [1, 2, 3].map(() => entry({ tipo: 'ADELANTO', montoUsd: 33.33 }));
        expect(computePeriodBalance(entries, emp, 'Q-2026-11-2').saldoUsd).toBe(0.01);
    });
});

describe('evaluateEntry', () => {
    const balance = { saldoUsd: 100 };
    const base = { employeeId: 'e1', idempotencyKey: 'k1', metodoId: 'efectivo_usd' };
    const isCash = (id) => String(id).startsWith('efectivo_');

    it('en $: calcula Bs con la tasa y marca si sale de la gaveta', () => {
        const r = evaluateEntry({ input: { ...base, tipo: 'ADELANTO', moneda: 'USD', monto: 10 }, balance, tasa: 487.1234, isCashMethod: isCash });
        expect(r).toMatchObject({ montoUsd: 10, montoBs: 4871.23, tasa: 487.1234, excedenteUsd: 0, saleDeGaveta: true });
    });

    it('en Bs: pagar exactamente el saldo en Bs da exactamente el saldo en $', () => {
        const tasa = 487.1234;
        const saldoBs = 48712.34; // 100 × 487,1234
        const r = evaluateEntry({ input: { ...base, metodoId: 'pago_movil', tipo: 'PAGO', moneda: 'BS', monto: saldoBs }, balance, tasa, isCashMethod: isCash });
        expect(r).toMatchObject({ montoUsd: 100, montoBs: 48712.34, excedenteUsd: 0, saleDeGaveta: false });
    });

    it('pasarse del saldo exige confirmación', () => {
        const input = { ...base, tipo: 'PAGO', moneda: 'USD', monto: 120 };
        expect(() => evaluateEntry({ input, balance, tasa: 400 })).toThrow(/Se pasa del saldo por \$20[.,]00/);
        const r = evaluateEntry({ input: { ...input, confirmarExceso: true }, balance, tasa: 400 });
        expect(r.excedenteUsd).toBe(20);
    });

    it('un bono nunca es exceso; sin tasa no se paga en Bs', () => {
        expect(evaluateEntry({ input: { ...base, tipo: 'BONO', moneda: 'USD', monto: 500 }, balance, tasa: 0 }).excedenteUsd).toBe(0);
        expect(() => evaluateEntry({ input: { ...base, tipo: 'PAGO', moneda: 'BS', monto: 10 }, balance, tasa: 0 })).toThrow(/tasa/);
    });

    it('rechaza montos, tipos, llave o método faltantes', () => {
        expect(() => evaluateEntry({ input: { ...base, tipo: 'PAGO', moneda: 'USD', monto: 0 }, balance, tasa: 1 })).toThrow(/mayor a cero/);
        expect(() => evaluateEntry({ input: { ...base, tipo: 'OTRO', moneda: 'USD', monto: 1 }, balance, tasa: 1 })).toThrow(/Tipo/);
        expect(() => evaluateEntry({ input: { ...base, idempotencyKey: '', tipo: 'PAGO', moneda: 'USD', monto: 1 }, balance, tasa: 1 })).toThrow(/llave/);
        expect(() => evaluateEntry({ input: { ...base, metodoId: '', tipo: 'PAGO', moneda: 'USD', monto: 1 }, balance, tasa: 1 })).toThrow(/cómo se paga/);
    });
});

describe('canVoidEntry y canChangeFrequency', () => {
    it('dinero de una caja cerrada no se anula; del turno abierto sí', () => {
        const adelanto = entry({ tipo: 'ADELANTO', montoUsd: 10, movimientoCajaId: 'm1' });
        const mov = { id: 'm1', cajaCerrada: true };
        expect(canVoidEntry(adelanto, { employee: emp, movement: mov, isInOpenShift: () => false }).ok).toBe(false);
        expect(canVoidEntry(adelanto, { employee: emp, movement: { id: 'm1' }, isInOpenShift: () => true }).ok).toBe(true);
    });

    it('un bono de un periodo pagado no se anula, y el arrastre tampoco directo', () => {
        const bono = entry({ tipo: 'BONO', montoUsd: 10 });
        const pago = entry({ tipo: 'PAGO', montoUsd: 110 });
        expect(canVoidEntry(bono, { entries: [bono, pago], employee: emp }).ok).toBe(false);
        expect(canVoidEntry(entry({ tipo: 'DESCUENTO', origen: 'ARRASTRE', montoUsd: 1 }), { employee: emp }).ok).toBe(false);
    });

    it('la frecuencia solo cambia con el periodo en curso vacío o pagado', () => {
        const now = new Date('2026-11-20T15:00:00.000Z');
        expect(canChangeFrequency([], emp, now).ok).toBe(true);
        expect(canChangeFrequency([entry({ tipo: 'ADELANTO', montoUsd: 5 })], emp, now).ok).toBe(false);
    });
});
