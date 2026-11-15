/**
 * tests/payrollGoods.test.js — Nómina F6: mercancía que se lleva el empleado.
 * Plan: docs/plans/2026-11-14-plan-nomina-simple-bodega.md (F6) · P-012.
 * Decisiones del dueño (15-11-2026): el precio sale de Ajustes (costo o venta) y pide PIN.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/utils/storageService', () => ({ storageService: {} }));

import { saveEmployee, registerGoods, registerEntry, voidEntry, recoverPayroll } from '../src/services/payrollService.js';
import {
    EMPLOYEES_KEY, PAYROLL_ENTRIES_KEY, GOODS_VALUATION_KEY, computePeriodBalance, evaluateGoods,
    readGoodsValuation, goodsSummary, canVoidEntry,
} from '../src/utils/payrollModel.js';
import { SALES_KEY, PRODUCTS_KEY } from '../src/services/gastosInternosService.js';
import { FinancialEngine } from '../src/core/FinancialEngine.js';
import { calcularEfectivoEsperado } from '../src/utils/cajaEsperada.js';
import { findOpenCashShift, isShiftCashMovement } from '../src/utils/cashShift.js';
import { canVoidGastoFromList } from '../src/utils/gastoInterno.js';

function memoryStorage(initial = {}) {
    const data = new Map(Object.entries(initial).map(([key, v]) => [key, structuredClone(v)]));
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
const PRODUCTS = [
    { id: 'harina', name: 'Harina PAN', stock: 10, costUsd: 0.8, priceUsd: 1.2 },
    { id: 'aceite', name: 'Aceite', stock: 2, costUsd: 2.5, priceUsd: 3.5 },
    { id: 'queso', name: 'Queso', stock: 3.5, costUsd: 4, priceUsd: 6, unitType: 'kg' },
    { id: 'gratis', name: 'Muestra', stock: 5, costUsd: 0, priceUsd: 0 },
];

function setup({ valuation = 'costo', allowNegative = false, sales = [apertura] } = {}) {
    const storage = memoryStorage({ [SALES_KEY]: sales, [EMPLOYEES_KEY]: [], [PAYROLL_ENTRIES_KEY]: [], [PRODUCTS_KEY]: PRODUCTS });
    let seq = 0;
    const ctx = {
        storage, lock: makeLock(), authorize, pin: '123456', audit: vi.fn(),
        now: () => new Date('2026-11-18T15:00:00.000Z'), getRate: () => 400, newId: (p) => `${p}_${++seq}`,
        getValuation: () => valuation, allowNegative: () => allowNegative,
    };
    return { storage, ctx };
}

let n = 0;
const goods = (employeeId, items, over = {}) => ({ employeeId, tipo: 'MERCANCIA', items, idempotencyKey: `g${++n}`, ...over });
const stockOf = async (storage, id) => (await storage.getItem(PRODUCTS_KEY)).find(p => p.id === id).stock;
const efectivoUsd = async (storage) => {
    const sales = await storage.getItem(SALES_KEY, []);
    const opening = findOpenCashShift(sales);
    return calcularEfectivoEsperado(FinancialEngine.calculatePaymentBreakdown(sales.filter(s => isShiftCashMovement(s, opening)))).expectedUsd;
};
async function withEmployee(opts) {
    const s = setup(opts);
    const e = await saveEmployee({ nombre: 'María', sueldoUsd: 100, frecuencia: 'quincenal' }, s.ctx);
    return { ...s, e };
}

describe('evaluateGoods (puro)', () => {
    const base = { balance: { saldoUsd: 100 }, tasa: 400, products: PRODUCTS };

    it('a costo y a venta, según Ajustes', () => {
        const input = goods('e', [{ id: 'harina', qty: 2 }, { id: 'aceite', qty: 1 }]);
        expect(evaluateGoods({ ...base, input, valuation: 'costo' })).toMatchObject({ montoUsd: 4.1, montoBs: 1640, valoracion: 'costo' });
        expect(evaluateGoods({ ...base, input, valuation: 'venta' })).toMatchObject({ montoUsd: 5.9, valoracion: 'venta' });
    });

    it('granel con decimales', () => {
        expect(evaluateGoods({ ...base, input: goods('e', [{ id: 'queso', qty: 0.25 }]) }).montoUsd).toBe(1);
    });

    it('rechaza sin stock, sin precio, repetidos, cantidades raras y productos que no existen', () => {
        expect(() => evaluateGoods({ ...base, input: goods('e', [{ id: 'aceite', qty: 3 }]) })).toThrow(/No hay suficiente Aceite/);
        expect(() => evaluateGoods({ ...base, input: goods('e', [{ id: 'aceite', qty: 3 }]), allowNegative: true })).not.toThrow();
        expect(() => evaluateGoods({ ...base, input: goods('e', [{ id: 'gratis', qty: 1 }]) })).toThrow(/no tiene costo/);
        expect(() => evaluateGoods({ ...base, input: goods('e', [{ id: 'harina', qty: 1 }, { id: 'harina', qty: 1 }]) })).toThrow(/repetido/);
        expect(() => evaluateGoods({ ...base, input: goods('e', [{ id: 'harina', qty: 0 }]) })).toThrow(/Cantidad/);
        expect(() => evaluateGoods({ ...base, input: goods('e', [{ id: 'nada', qty: 1 }]) })).toThrow(/ya no existe/);
        expect(() => evaluateGoods({ ...base, input: goods('e', []) })).toThrow(/al menos un producto/);
    });

    it('si se pasa del saldo pide confirmar (D6), como un adelanto', () => {
        const input = goods('e', [{ id: 'harina', qty: 10 }]);
        expect(() => evaluateGoods({ ...base, balance: { saldoUsd: 5 }, input })).toThrow(expect.objectContaining({ code: 'EXCEDE_SALDO', excedenteUsd: 3 }));
        expect(evaluateGoods({ ...base, balance: { saldoUsd: 5 }, input: { ...input, confirmarExceso: true } }).excedenteUsd).toBe(3);
    });

    it('la opción de Ajustes vale «costo» si no hay nada o es rara', () => {
        const store = (v) => ({ getItem: (key) => (key === GOODS_VALUATION_KEY ? v : null) });
        expect(readGoodsValuation(store(null))).toBe('costo');
        expect(readGoodsValuation(store('venta'))).toBe('venta');
        expect(readGoodsValuation(store('regalado'))).toBe('costo');
    });

    it('resumen corto de los productos', () => {
        expect(goodsSummary([{ qty: 2, name: 'Harina' }, { qty: 1, name: 'Aceite' }])).toBe('2 × Harina, 1 × Aceite');
        expect(goodsSummary([1, 2, 3, 4, 5].map(i => ({ qty: 1, name: `P${i}` })), 3)).toBe('1 × P1, 1 × P2, 1 × P3 y 2 más');
    });
});

describe('registerGoods (servicio)', () => {
    it('baja el stock, resta del saldo y NO toca la gaveta', async () => {
        const { storage, ctx, e } = await withEmployee();
        const antes = await efectivoUsd(storage);
        const res = await registerGoods(goods(e.id, [{ id: 'harina', qty: 2 }, { id: 'aceite', qty: 1 }]), ctx);

        expect(res.entry).toMatchObject({ tipo: 'MERCANCIA', montoUsd: 4.1, valoracion: 'costo', saleDeGaveta: false, actor: 'Administrador' });
        expect(res.movement).toMatchObject({ tipo: 'GASTO_INTERNO', category: 'nomina', isAutoconsumo: true, isPayroll: true, afectaCaja: false, totalUsd: -4.1 });
        expect(await stockOf(storage, 'harina')).toBe(8);
        expect(await stockOf(storage, 'aceite')).toBe(1);
        expect(await efectivoUsd(storage)).toBe(antes);

        const entries = await storage.getItem(PAYROLL_ENTRIES_KEY);
        const bal = computePeriodBalance(entries, e, res.entry.periodoId);
        expect(bal).toMatchObject({ mercanciaUsd: 4.1, saldoUsd: 95.9 });
    });

    it('usa el precio de venta si Ajustes lo dice', async () => {
        const { ctx, e } = await withEmployee({ valuation: 'venta' });
        const res = await registerGoods(goods(e.id, [{ id: 'harina', qty: 2 }]), ctx);
        expect(res.entry).toMatchObject({ montoUsd: 2.4, valoracion: 'venta' });
    });

    it('E4: sin PIN correcto no baja stock ni registra nada', async () => {
        const { storage, ctx, e } = await withEmployee();
        await expect(registerGoods(goods(e.id, [{ id: 'harina', qty: 1 }]), { ...ctx, pin: '000000' })).rejects.toThrow(/PIN/);
        expect(await stockOf(storage, 'harina')).toBe(10);
        expect(await storage.getItem(PAYROLL_ENTRIES_KEY)).toHaveLength(0);
    });

    it('doble clic: la misma llave no descuenta dos veces', async () => {
        const { storage, ctx, e } = await withEmployee();
        const input = goods(e.id, [{ id: 'harina', qty: 1 }]);
        await registerGoods(input, ctx);
        const again = await registerGoods(input, ctx);
        expect(again.duplicate).toBe(true);
        expect(await stockOf(storage, 'harina')).toBe(9);
        expect((await storage.getItem(SALES_KEY)).filter(s => s.isPayroll)).toHaveLength(1);
    });

    it('si se pasa del saldo y se confirma, la deuda pasa al periodo siguiente', async () => {
        const { storage, ctx, e } = await withEmployee();
        await registerEntry({ employeeId: e.id, tipo: 'ADELANTO', moneda: 'USD', monto: 99, metodoId: 'efectivo_usd', idempotencyKey: 'ad1' }, ctx);
        await expect(registerGoods(goods(e.id, [{ id: 'aceite', qty: 1 }]), ctx)).rejects.toMatchObject({ code: 'EXCEDE_SALDO' });
        expect(await stockOf(storage, 'aceite')).toBe(2); // nada se movió
        const res = await registerGoods(goods(e.id, [{ id: 'aceite', qty: 1 }], { confirmarExceso: true }), ctx);
        expect(res.arrastre).toMatchObject({ tipo: 'DESCUENTO', origen: 'ARRASTRE', montoUsd: 1.5, arrastreDe: res.entry.id });
    });

    it('si no se pudo guardar el renglón, devuelve el stock y anula el movimiento', async () => {
        const { storage, ctx, e } = await withEmployee();
        const real = storage.setItem.bind(storage);
        storage.setItem = async (key, value) => {
            if (key === PAYROLL_ENTRIES_KEY) throw new Error('disco lleno');
            return real(key, value);
        };
        await expect(registerGoods(goods(e.id, [{ id: 'harina', qty: 3 }]), ctx)).rejects.toThrow(/No se registró nada/);
        storage.setItem = real;
        expect(await stockOf(storage, 'harina')).toBe(10);
        const mov = (await storage.getItem(SALES_KEY)).find(s => s.isPayroll);
        expect(mov).toMatchObject({ status: 'ANULADA', stockDevuelto: true });
    });
});

describe('recibo de mercancía', () => {
    it('lista los productos, el precio usado y pide firma', async () => {
        const { buildPayrollReceiptData } = await import('../src/utils/payrollReceipt.js');
        const { ctx, e } = await withEmployee({ valuation: 'venta' });
        const res = await registerGoods(goods(e.id, [{ id: 'harina', qty: 2 }]), ctx);
        const data = buildPayrollReceiptData({ entry: res.entry, employee: e, saldoDespuesUsd: 97.6, business: { name: 'B' } });
        expect(data.titulo).toBe('Recibo de mercancía');
        expect(data.rows).toEqual(expect.arrayContaining([['Precio', 'Precio de venta'], ['2 × Harina PAN', '$2.40']]));
        expect(data.firma).toBe(true);
    });
});

describe('anular y recuperar mercancía', () => {
    it('anular devuelve el stock y tacha el renglón y el movimiento', async () => {
        const { storage, ctx, e } = await withEmployee();
        const res = await registerGoods(goods(e.id, [{ id: 'harina', qty: 4 }]), ctx);
        await voidEntry(res.entry.id, ctx);
        expect(await stockOf(storage, 'harina')).toBe(10);
        expect((await storage.getItem(SALES_KEY)).find(s => s.id === res.movement.id)).toMatchObject({ status: 'ANULADA', stockDevuelto: true });
        const entries = await storage.getItem(PAYROLL_ENTRIES_KEY);
        expect(computePeriodBalance(entries, e, res.entry.periodoId).saldoUsd).toBe(100);
        await expect(voidEntry(res.entry.id, ctx)).rejects.toThrow(/ya estaba anulado/);
        expect(await stockOf(storage, 'harina')).toBe(10); // no devuelve dos veces
    });

    it('no se anula desde la lista de Gastos internos (se anula en Nómina)', async () => {
        const { ctx, e } = await withEmployee();
        const res = await registerGoods(goods(e.id, [{ id: 'harina', qty: 1 }]), ctx);
        expect(canVoidGastoFromList(res.movement).ok).toBe(false);
    });

    it('no se anula si su caja ya se cerró', () => {
        const entry = { id: 'n1', tipo: 'MERCANCIA', status: 'ACTIVO', origen: 'MANUAL', periodoId: 'Q-2026-11-2' };
        const check = canVoidEntry(entry, { movement: { status: 'COMPLETADA', cajaCerrada: true }, isInOpenShift: () => false });
        expect(check).toMatchObject({ ok: false });
        expect(check.reason).toMatch(/caja ya cerrada/);
    });

    it('recuperación: un movimiento de mercancía sin renglón se anula y devuelve el stock', async () => {
        const { storage, ctx, e } = await withEmployee();
        const res = await registerGoods(goods(e.id, [{ id: 'harina', qty: 2 }]), ctx);
        // Simula el corte: el renglón no llegó a guardarse.
        await storage.setItem(PAYROLL_ENTRIES_KEY, []);
        const rec = await recoverPayroll(ctx);
        expect(rec.movimientosAnulados).toBe(1);
        expect(await stockOf(storage, 'harina')).toBe(10);
        expect((await storage.getItem(SALES_KEY)).find(s => s.id === res.movement.id)).toMatchObject({ status: 'ANULADA', stockDevuelto: true });
        expect((await recoverPayroll(ctx)).movimientosAnulados).toBe(0); // idempotente
        void e;
    });
});
