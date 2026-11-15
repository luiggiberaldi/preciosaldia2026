/**
 * tests/payrollService.test.js — Nómina F2: el servicio que guarda.
 * Plan: docs/plans/2026-11-14-plan-nomina-simple-bodega.md
 * Cada prueba marcada E1/E2/E3/E4 demuestra que no vuelve un error de Donde Juancho.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/utils/storageService', () => ({ storageService: {} }));

import {
    saveEmployee, setEmployeeActive, registerEntry, voidEntry, recoverPayroll, loadPayroll,
} from '../src/services/payrollService.js';
import { EMPLOYEES_KEY, PAYROLL_ENTRIES_KEY, computePeriodBalance } from '../src/utils/payrollModel.js';
import { SALES_KEY } from '../src/services/gastosInternosService.js';
import { FinancialEngine } from '../src/core/FinancialEngine.js';
import { calcularEfectivoEsperado } from '../src/utils/cajaEsperada.js';
import { findOpenCashShift, isShiftCashMovement } from '../src/utils/cashShift.js';
import { IDB_KEYS } from '../src/config/backupKeys.js';

function memoryStorage(initial = {}) {
    const data = new Map(Object.entries(initial).map(([k, v]) => [k, structuredClone(v)]));
    return {
        data,
        async getItem(key, def = null) { return data.has(key) ? structuredClone(data.get(key)) : def; },
        async setItem(key, value) { data.set(key, structuredClone(value)); },
    };
}
function makeLock() {
    let chain = Promise.resolve();
    return (name, fn) => { const run = chain.then(fn, fn); chain = run.catch(() => {}); return run; };
}

const ADMIN = { id: 1, nombre: 'Administrador', rol: 'ADMIN' };
const authorize = async (pin) => (pin === '123456' ? { success: true, user: ADMIN } : { success: false, error: 'PIN de administrador incorrecto' });
const apertura = { id: 'ap1', tipo: 'APERTURA_CAJA', timestamp: '2026-11-16T12:00:00.000Z', openingUsd: 100, openingBs: 0, cajaCerrada: false };

function setup({ sales = [apertura], now = '2026-11-18T15:00:00.000Z', rate = 400 } = {}) {
    const storage = memoryStorage({ [SALES_KEY]: sales, [EMPLOYEES_KEY]: [], [PAYROLL_ENTRIES_KEY]: [] });
    let seq = 0;
    const audit = vi.fn();
    const ctx = {
        storage, lock: makeLock(), authorize, pin: '123456', audit,
        now: () => new Date(now), getRate: () => rate, newId: (p) => `${p}_${++seq}`,
    };
    return { storage, ctx, audit };
}

const efectivoUsd = async (storage) => {
    const sales = await storage.getItem(SALES_KEY, []);
    const opening = findOpenCashShift(sales);
    const shift = sales.filter(s => isShiftCashMovement(s, opening));
    return calcularEfectivoEsperado(FinancialEngine.calculatePaymentBreakdown(shift)).expectedUsd;
};

let k = 0;
const mov = (employeeId, over) => ({ employeeId, idempotencyKey: `key${++k}`, moneda: 'USD', metodoId: 'efectivo_usd', ...over });

describe('empleados', () => {
    it('crea, edita y desactiva; nunca borra', async () => {
        const { ctx, storage } = setup();
        const e = await saveEmployee({ nombre: 'María', sueldoUsd: 100, frecuencia: 'quincenal', cedula: 'V-1' }, ctx);
        expect(e).toMatchObject({ id: 'emp_1', activo: true, creadoPor: 'Administrador', fechaIngreso: '2026-11-18' });
        await saveEmployee({ ...e, sueldoUsd: 120 }, ctx);
        await setEmployeeActive(e.id, false, ctx);
        const list = await storage.getItem(EMPLOYEES_KEY);
        expect(list).toHaveLength(1);
        expect(list[0]).toMatchObject({ sueldoUsd: 120, activo: false });
        await expect(saveEmployee({ nombre: 'Otra', sueldoUsd: 50, cedula: 'V-1' }, ctx)).resolves.toBeTruthy(); // la anterior está inactiva
    });

    it('no cambia la frecuencia con el periodo en curso a medio pagar', async () => {
        const { ctx } = setup();
        const e = await saveEmployee({ nombre: 'María', sueldoUsd: 100, frecuencia: 'quincenal' }, ctx);
        await registerEntry(mov(e.id, { tipo: 'ADELANTO', monto: 10 }), ctx);
        await expect(saveEmployee({ ...e, frecuencia: 'semanal' }, ctx)).rejects.toThrow(/frecuencia/);
    });

    it('E4: sin PIN correcto no se crea ni se paga nada', async () => {
        const { ctx, storage } = setup();
        await expect(saveEmployee({ nombre: 'X', sueldoUsd: 10 }, { ...ctx, pin: '000000' })).rejects.toThrow(/PIN/);
        await expect(saveEmployee({ nombre: 'X', sueldoUsd: 10 }, { ...ctx, authorize: undefined })).rejects.toThrow(/autorización/);
        expect(await storage.getItem(EMPLOYEES_KEY)).toEqual([]);
    });
});

describe('movimientos', () => {
    it('E2: adelanto de $10 en efectivo baja la gaveta $10; al anularlo vuelve, sin movimiento al revés', async () => {
        const { ctx, storage } = setup();
        const e = await saveEmployee({ nombre: 'María', sueldoUsd: 100, frecuencia: 'quincenal' }, ctx);
        expect(await efectivoUsd(storage)).toBe(100);
        const r = await registerEntry(mov(e.id, { tipo: 'ADELANTO', monto: 10 }), ctx);
        expect(r.movement).toMatchObject({ tipo: 'GASTO_INTERNO', category: 'nomina', isPayroll: true, payrollEntryId: r.entry.id, afectaCaja: true, totalUsd: -10 });
        expect(r.entry.saleDeGaveta).toBe(true);
        expect(r.entry).toMatchObject({ periodoId: 'Q-2026-11-2', sueldoPeriodoUsd: 100, movimientoCajaId: r.movement.id, saldoAntesUsd: 100 });
        expect(await efectivoUsd(storage)).toBe(90);

        await voidEntry(r.entry.id, ctx);
        expect(await efectivoUsd(storage)).toBe(100);
        const sales = await storage.getItem(SALES_KEY);
        expect(sales).toHaveLength(2);
        expect(sales.find(s => s.id === r.movement.id).status).toBe('ANULADA');
        expect((await storage.getItem(PAYROLL_ENTRIES_KEY))[0].status).toBe('ANULADO');
    });

    it('E1: pagar a dos empleados en dos periodos no toca los renglones del otro', async () => {
        const { ctx, storage } = setup();
        const a = await saveEmployee({ nombre: 'Ana', sueldoUsd: 100, frecuencia: 'quincenal' }, ctx);
        const b = await saveEmployee({ nombre: 'Beto', sueldoUsd: 60, frecuencia: 'semanal' }, ctx);
        await registerEntry(mov(a.id, { tipo: 'ADELANTO', monto: 10 }), ctx);
        await registerEntry(mov(b.id, { tipo: 'BONO', monto: 5 }), ctx);
        // Otro periodo (semana siguiente) para Beto.
        await registerEntry(mov(b.id, { tipo: 'ADELANTO', monto: 20 }), { ...ctx, now: () => new Date('2026-11-25T15:00:00.000Z') });
        await registerEntry(mov(a.id, { tipo: 'PAGO', monto: 90 }), ctx);
        const entries = await storage.getItem(PAYROLL_ENTRIES_KEY);
        expect(entries).toHaveLength(4);
        expect(entries.every(x => x.status === 'ACTIVO')).toBe(true);
        expect(computePeriodBalance(entries, b, 'S-2026-W47').saldoUsd).toBe(65);
        expect(computePeriodBalance(entries, b, 'S-2026-W48').saldoUsd).toBe(40);
        expect(computePeriodBalance(entries, a, 'Q-2026-11-2')).toMatchObject({ saldoUsd: 0, estado: 'PAGADO' });
    });

    it('doble clic: la misma llave crea un solo renglón y un solo movimiento', async () => {
        const { ctx, storage } = setup();
        const e = await saveEmployee({ nombre: 'María', sueldoUsd: 100, frecuencia: 'quincenal' }, ctx);
        const input = mov(e.id, { tipo: 'ADELANTO', monto: 10 });
        const [r1, r2] = await Promise.all([registerEntry(input, ctx), registerEntry(input, ctx)]);
        expect(r1.duplicate).toBe(false);
        expect(r2.duplicate).toBe(true);
        expect(await storage.getItem(PAYROLL_ENTRIES_KEY)).toHaveLength(1);
        expect((await storage.getItem(SALES_KEY)).filter(s => s.isPayroll)).toHaveLength(1);
    });

    it('sin caja abierta: el efectivo se rechaza y el pago móvil se acepta sin tocar la gaveta', async () => {
        const { ctx, storage } = setup({ sales: [] });
        const e = await saveEmployee({ nombre: 'María', sueldoUsd: 100, frecuencia: 'quincenal' }, ctx);
        await expect(registerEntry(mov(e.id, { tipo: 'ADELANTO', monto: 10 }), ctx)).rejects.toThrow(/Abre la caja/);
        expect(await storage.getItem(PAYROLL_ENTRIES_KEY)).toEqual([]);
        const r = await registerEntry(mov(e.id, { tipo: 'PAGO', moneda: 'BS', monto: 40000, metodoId: 'pago_movil' }), ctx);
        expect(r.entry).toMatchObject({ montoUsd: 100, montoBs: 40000, tasa: 400, saleDeGaveta: false });
        // E8: el pago móvil cuenta en el cierre como gasto, pero no toca la gaveta.
        expect(r.movement).toMatchObject({ afectaCaja: true, category: 'nomina', paymentMethod: 'pago_movil' });
        const breakdown = FinancialEngine.calculatePaymentBreakdown(await storage.getItem(SALES_KEY));
        expect(breakdown.pago_movil.total).toBe(-40000);
        expect(calcularEfectivoEsperado(breakdown)).toMatchObject({ expectedUsd: 0, expectedBs: 0 });
    });

    it('E3: en Bs la tasa la pone el servicio, y pagar el saldo completo en Bs deja el periodo en 0', async () => {
        const { ctx, storage } = setup({ rate: 487.1234 });
        const e = await saveEmployee({ nombre: 'María', sueldoUsd: 100, frecuencia: 'quincenal' }, ctx);
        await registerEntry(mov(e.id, { tipo: 'ADELANTO', monto: 33.33 }), ctx);
        // Saldo $66,67 × 487,1234 = Bs 32.477,12
        const r = await registerEntry(mov(e.id, { tipo: 'PAGO', moneda: 'BS', monto: 32477.12, metodoId: 'pago_movil', tasa: 1 }), ctx);
        expect(r.entry).toMatchObject({ montoUsd: 66.67, tasa: 487.1234 });
        const entries = await storage.getItem(PAYROLL_ENTRIES_KEY);
        expect(computePeriodBalance(entries, e, 'Q-2026-11-2')).toMatchObject({ saldoUsd: 0, estado: 'PAGADO' });
    });

    it('pasarse del saldo: pide confirmar y deja la deuda en el periodo siguiente; anular quita las dos', async () => {
        const { ctx, storage } = setup();
        const e = await saveEmployee({ nombre: 'María', sueldoUsd: 100, frecuencia: 'quincenal' }, ctx);
        const input = mov(e.id, { tipo: 'PAGO', monto: 120 });
        await expect(registerEntry(input, ctx)).rejects.toMatchObject({ code: 'EXCEDE_SALDO', excedenteUsd: 20 });
        expect((await storage.getItem(SALES_KEY)).filter(s => s.isPayroll)).toHaveLength(0);
        const r = await registerEntry({ ...input, confirmarExceso: true }, ctx);
        expect(r.arrastre).toMatchObject({ periodoId: 'Q-2026-12-1', tipo: 'DESCUENTO', origen: 'ARRASTRE', montoUsd: 20 });
        let entries = await storage.getItem(PAYROLL_ENTRIES_KEY);
        expect(computePeriodBalance(entries, e, 'Q-2026-11-2').saldoUsd).toBe(0);
        expect(computePeriodBalance(entries, e, 'Q-2026-12-1').saldoUsd).toBe(80);
        await voidEntry(r.entry.id, ctx);
        entries = await storage.getItem(PAYROLL_ENTRIES_KEY);
        expect(entries.every(x => x.status === 'ANULADO')).toBe(true);
        expect(computePeriodBalance(entries, e, 'Q-2026-12-1').saldoUsd).toBe(100);
    });

    it('D5: dinero de una caja ya cerrada no se anula', async () => {
        const { ctx, storage } = setup();
        const e = await saveEmployee({ nombre: 'María', sueldoUsd: 100, frecuencia: 'quincenal' }, ctx);
        const r = await registerEntry(mov(e.id, { tipo: 'ADELANTO', monto: 10 }), ctx);
        const sales = await storage.getItem(SALES_KEY);
        await storage.setItem(SALES_KEY, sales.map(s => ({ ...s, cajaCerrada: true })));
        await expect(voidEntry(r.entry.id, ctx)).rejects.toThrow(/caja ya cerrada/);
    });

    it('empleado desactivado no recibe movimientos', async () => {
        const { ctx } = setup();
        const e = await saveEmployee({ nombre: 'María', sueldoUsd: 100, frecuencia: 'quincenal' }, ctx);
        await setEmployeeActive(e.id, false, ctx);
        await expect(registerEntry(mov(e.id, { tipo: 'BONO', monto: 1 }), ctx)).rejects.toThrow(/desactivado/);
    });
});

describe('recuperación y respaldo', () => {
    it('si falla el guardado del renglón, el dinero se vuelve atrás en el acto', async () => {
        const { ctx, storage } = setup();
        const e = await saveEmployee({ nombre: 'María', sueldoUsd: 100, frecuencia: 'quincenal' }, ctx);
        const realSet = storage.setItem;
        storage.setItem = async (key, value) => { if (key !== PAYROLL_ENTRIES_KEY) return realSet(key, value); };
        await expect(registerEntry(mov(e.id, { tipo: 'ADELANTO', monto: 10 }), ctx)).rejects.toThrow(/No se registró nada/);
        storage.setItem = realSet;
        expect(await efectivoUsd(storage)).toBe(100);
    });

    it('recoverPayroll anula movimientos sin renglón y renglones sin movimiento', async () => {
        const huerfano = { id: 'g9', tipo: 'GASTO_INTERNO', isPayroll: true, payrollEntryId: 'nada', paymentMethod: 'efectivo_usd', afectaCaja: true, timestamp: '2026-11-18T13:00:00.000Z', payments: [{ methodId: 'efectivo_usd', amountUsd: -15, currency: 'USD' }] };
        const { ctx, storage } = setup({ sales: [apertura, huerfano] });
        await storage.setItem(PAYROLL_ENTRIES_KEY, [{ id: 'r1', employeeId: 'x', periodoId: 'Q-2026-11-2', tipo: 'PAGO', montoUsd: 5, status: 'ACTIVO', movimientoCajaId: 'no-existe' }]);
        expect(await efectivoUsd(storage)).toBe(85);
        expect(await recoverPayroll(ctx)).toEqual({ movimientosAnulados: 1, renglonesAnulados: 1 });
        expect(await efectivoUsd(storage)).toBe(100);
        expect((await storage.getItem(PAYROLL_ENTRIES_KEY))[0].status).toBe('ANULADO');
        expect(await recoverPayroll(ctx)).toEqual({ movimientosAnulados: 0, renglonesAnulados: 0 });
    });

    it('las dos claves nuevas van en el respaldo', async () => {
        expect(IDB_KEYS).toContain(EMPLOYEES_KEY);
        expect(IDB_KEYS).toContain(PAYROLL_ENTRIES_KEY);
        const { ctx } = setup();
        expect(await loadPayroll(ctx)).toEqual({ employees: [], entries: [] });
    });
});
