/**
 * tests/gastosInternosService.test.js — Nómina F0: Gastos internos reforzados.
 * Plan: docs/plans/2026-11-14-plan-nomina-simple-bodega.md
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/utils/storageService', () => ({ storageService: {} }));

import { buildGastoInternoRecord, canVoidGastoFromList, CAJA_CERRADA_MSG, PAYROLL_VOID_ELSEWHERE_MSG } from '../src/utils/gastoInterno.js';
import { saveGastoInterno, voidGastoInterno, saveAutoconsumo, SALES_KEY, PRODUCTS_KEY } from '../src/services/gastosInternosService.js';
import { FinancialEngine } from '../src/core/FinancialEngine.js';
import { calcularEfectivoEsperado } from '../src/utils/cajaEsperada.js';
import { findOpenCashShift, isShiftCashMovement } from '../src/utils/cashShift.js';

const now = new Date('2026-11-14T15:00:00.000Z');
const ana = { id: 'u1', nombre: 'Ana' };

function memoryStorage(initial = {}) {
    const data = new Map(Object.entries(initial).map(([k, v]) => [k, structuredClone(v)]));
    return {
        data,
        async getItem(key, def = null) { return data.has(key) ? structuredClone(data.get(key)) : def; },
        async setItem(key, value) { data.set(key, structuredClone(value)); },
    };
}

// Candado en memoria que de verdad serializa (como navigator.locks).
function makeLock() {
    let chain = Promise.resolve();
    return (name, fn) => {
        const run = chain.then(fn, fn);
        chain = run.catch(() => {});
        return run;
    };
}

const apertura = { id: 'ap1', tipo: 'APERTURA_CAJA', timestamp: '2026-11-14T12:00:00.000Z', openingUsd: 50, openingBs: 0, cajaCerrada: false };

function efectivoEsperadoUsd(sales) {
    const opening = findOpenCashShift(sales);
    const shift = sales.filter(s => isShiftCashMovement(s, opening));
    return calcularEfectivoEsperado(FinancialEngine.calculatePaymentBreakdown(shift)).expectedUsd;
}

const gastoUsd = (over = {}) => buildGastoInternoRecord({
    description: 'Hielo', category: 'insumos', amountUsd: 10, methodId: 'efectivo_usd', currency: 'USD',
    bcvRate: 487.1234, usuario: ana, now, id: 'g1', ...over,
});

describe('buildGastoInternoRecord', () => {
    it('redondea, guarda montos negativos y anota quién lo hizo', () => {
        const rec = buildGastoInternoRecord({
            description: '  Luz ', category: 'servicios', amountUsd: 10.005, methodId: 'efectivo_usd',
            currency: 'USD', bcvRate: 487.1234, usuario: ana, now, id: 'x',
        });
        expect(rec.totalUsd).toBe(-10.01);
        expect(rec.totalBs).toBe(-4876.11);
        expect(rec.payments[0]).toMatchObject({ methodId: 'efectivo_usd', amountUsd: -10.01, currency: 'USD' });
        expect(rec.description).toBe('Luz');
        expect(rec.actor).toBe('Ana');
        expect(rec.actorId).toBe('u1');
        expect(rec.afectaCaja).toBe(true);
    });

    it('en Bs calcula el $ con la tasa y redondea', () => {
        const rec = buildGastoInternoRecord({
            description: 'Gas', amountBs: 1000, methodId: 'pago_movil', currency: 'BS', bcvRate: 300, now, id: 'y',
        });
        expect(rec.totalBs).toBe(-1000);
        expect(rec.totalUsd).toBe(-3.33);
        expect(rec.payments[0].amountBs).toBe(-1000);
        expect(rec.actor).toBe('Sin sesión');
    });

    it('rechaza datos que no sirven', () => {
        expect(() => buildGastoInternoRecord({ description: '', amountUsd: 1, methodId: 'efectivo_usd' })).toThrow(/descripción/);
        expect(() => buildGastoInternoRecord({ description: 'x', amountUsd: 0, methodId: 'efectivo_usd' })).toThrow(/mayor a cero/);
        expect(() => buildGastoInternoRecord({ description: 'x', amountUsd: -5, methodId: 'efectivo_usd' })).toThrow(/negativo/);
        expect(() => buildGastoInternoRecord({ description: 'x', amountUsd: 5 })).toThrow(/método/);
    });
});

describe('saveGastoInterno', () => {
    it('sin caja abierta rechaza el efectivo y acepta el pago móvil', async () => {
        const storage = memoryStorage({ [SALES_KEY]: [] });
        await expect(saveGastoInterno(gastoUsd(), { storage, lock: makeLock() })).rejects.toThrow(CAJA_CERRADA_MSG);
        const movil = buildGastoInternoRecord({ description: 'Internet', amountBs: 500, methodId: 'pago_movil', currency: 'BS', bcvRate: 400, now, id: 'pm' });
        const saved = await saveGastoInterno(movil, { storage, lock: makeLock() });
        expect(saved.map(s => s.id)).toEqual(['pm']);
    });

    it('lee la lista fresca: un gasto no pisa una venta guardada al mismo tiempo', async () => {
        const storage = memoryStorage({ [SALES_KEY]: [apertura] });
        const lock = makeLock();
        const venta = { id: 'v1', tipo: 'VENTA', timestamp: now.toISOString(), payments: [{ methodId: 'efectivo_usd', amountUsd: 5, currency: 'USD' }] };
        await Promise.all([
            saveGastoInterno(gastoUsd(), { storage, lock }),
            lock('pos_write_lock', async () => {
                const s = await storage.getItem(SALES_KEY, []);
                await storage.setItem(SALES_KEY, [venta, ...s]);
            }),
        ]);
        const ids = (await storage.getItem(SALES_KEY)).map(s => s.id).sort();
        expect(ids).toEqual(['ap1', 'g1', 'v1']);
    });

    it('un gasto de $10 baja el efectivo esperado $10 y al anularlo vuelve', async () => {
        const storage = memoryStorage({ [SALES_KEY]: [apertura] });
        const lock = makeLock();
        expect(efectivoEsperadoUsd(await storage.getItem(SALES_KEY))).toBe(50);
        await saveGastoInterno(gastoUsd(), { storage, lock });
        expect(efectivoEsperadoUsd(await storage.getItem(SALES_KEY))).toBe(40);
        const { gasto } = await voidGastoInterno('g1', { storage, lock, usuario: ana, now });
        expect(gasto).toMatchObject({ status: 'ANULADA', voidedBy: 'Ana' });
        expect(efectivoEsperadoUsd(await storage.getItem(SALES_KEY))).toBe(50);
        // No se crea un movimiento al revés.
        expect((await storage.getItem(SALES_KEY)).length).toBe(2);
    });

    it('si el almacenamiento no guarda, avisa en vez de dar por bueno el gasto', async () => {
        const storage = memoryStorage({ [SALES_KEY]: [apertura] });
        storage.setItem = async () => {}; // escritura «tragada»
        await expect(saveGastoInterno(gastoUsd(), { storage, lock: makeLock() })).rejects.toThrow(/no se confirmó/);
    });
});

describe('voidGastoInterno / canVoidGastoFromList', () => {
    it('no anula desde la lista un gasto de nómina, uno cerrado ni uno ya anulado', async () => {
        expect(canVoidGastoFromList({ isPayroll: true })).toEqual({ ok: false, reason: PAYROLL_VOID_ELSEWHERE_MSG });
        expect(canVoidGastoFromList({ cajaCerrada: true }).ok).toBe(false);
        expect(canVoidGastoFromList({ status: 'ANULADA' }).ok).toBe(false);
        const nomina = { ...gastoUsd(), isPayroll: true };
        const storage = memoryStorage({ [SALES_KEY]: [nomina, apertura] });
        await expect(voidGastoInterno('g1', { storage, lock: makeLock() })).rejects.toThrow(PAYROLL_VOID_ELSEWHERE_MSG);
    });

    it('autoconsumo: baja el stock al guardar y lo devuelve al anular', async () => {
        const storage = memoryStorage({ [SALES_KEY]: [], [PRODUCTS_KEY]: [{ id: 'p1', stock: 10 }] });
        const lock = makeLock();
        const gasto = { id: 'a1', tipo: 'GASTO_INTERNO', isAutoconsumo: true, afectaCaja: false, paymentMethod: 'autoconsumo', items: [{ id: 'p1', qty: 3 }] };
        await saveAutoconsumo(gasto, [{ id: 'p1', qty: 3 }], { storage, lock });
        expect((await storage.getItem(PRODUCTS_KEY))[0].stock).toBe(7);
        await voidGastoInterno('a1', { storage, lock, now });
        expect((await storage.getItem(PRODUCTS_KEY))[0].stock).toBe(10);
    });
});
