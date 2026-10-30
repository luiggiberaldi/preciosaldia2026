// H1 — núcleo puro de ventas remotas (supervisor.sale.create).
import { describe, expect, it } from 'vitest';
import {
    REMOTE_SALE_LIMITS,
    buildRemoteCartLine,
    buildRemoteSalePayload,
    planRemoteSale,
    validateRemoteSalePayload,
} from '../src/services/supervisorSaleCommand.js';
import { buildCashAdvanceCartLine } from '../src/utils/cashAdvance.js';

const SALE_ID = '2f1b6a3c-8d4e-4f5a-9b6c-1d2e3f4a5b6c';
const RATE = 40;

const PRODUCTS = [
    { id: 'harina', name: 'Harina', priceUsdt: 1.5, stock: 10, costUsd: 1 },
    { id: 'refresco', name: 'Refresco', priceUsdt: 2, stock: 3, costUsd: 1.2, sellByUnit: true, unitPriceUsd: 0.5, unitsPerPackage: 6, packagingType: 'lote' },
    { id: 'queso', name: 'Queso', priceUsdt: 8, stock: 2.5, packagingType: 'granel', unit: 'kg', granelUnit: 'kg' },
];
const METHODS = [
    { id: 'efectivo_usd', label: 'Efectivo en Dólares', currency: 'USD' },
    { id: 'pago_movil', label: 'Pago Móvil', currency: 'BS' },
    { id: 'punto_venta', label: 'Punto de Venta', currency: 'BS', isEnabled: false },
];
const OPEN_SHIFT = [{ id: 'ap', tipo: 'APERTURA_CAJA', timestamp: '2026-10-29T08:00:00.000Z', cajaCerrada: false }];

const line = (productId, qty, mode = 'package', products = PRODUCTS) =>
    buildRemoteCartLine(products.find((p) => p.id === productId), { mode, qty }, { effectiveRate: RATE });

function payload({ cart = [line('harina', 2)], payments, totalUsd, ...over } = {}) {
    const total = totalUsd ?? cart.reduce((s, l) => s + l.priceUsd * l.qty, 0);
    return buildRemoteSalePayload({
        saleId: SALE_ID,
        seller: { name: 'Tienda 2 - María', deviceId: 'monitor-1' },
        cart,
        payments: payments ?? [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: total, amountBs: 0 }],
        changeBreakdown: {},
        totals: { totalUsd: total, totalBs: total * RATE },
        rate: RATE,
        ...over,
    });
}

const ctx = (over = {}) => ({
    products: PRODUCTS,
    sales: OPEN_SHIFT,
    paymentMethods: METHODS,
    effectiveRate: RATE,
    ...over,
});

describe('validateRemoteSalePayload', () => {
    it('acepta un payload bien formado', () => {
        expect(validateRemoteSalePayload(payload())).toEqual({ ok: true });
    });

    it.each([
        ['saleId no uuid', (p) => ({ ...p, saleId: 'abc' }), 'Identificador'],
        ['sin vendedor', (p) => ({ ...p, seller: { name: '  ' } }), 'vendedor'],
        ['sin productos', (p) => ({ ...p, items: [] }), 'no tiene productos'],
        ['demasiados productos', (p) => ({ ...p, items: Array(REMOTE_SALE_LIMITS.MAX_ITEMS + 1).fill(p.items[0]) }), 'Máximo'],
        ['cantidad cero', (p) => ({ ...p, items: [{ ...p.items[0], qty: 0 }] }), 'Cantidad'],
        ['venta libre', (p) => ({ ...p, items: [{ ...p.items[0], productId: 'custom_1' }] }), 'ventas libres'],
        ['fiado', (p) => ({ ...p, payments: [{ ...p.payments[0], methodId: 'fiado' }] }), 'contado'],
        ['saldo a favor', (p) => ({ ...p, payments: [{ ...p.payments[0], methodId: 'saldo_favor' }] }), 'contado'],
        ['monto negativo', (p) => ({ ...p, payments: [{ ...p.payments[0], amountUsd: -1 }] }), 'Monto'],
        ['moneda rara', (p) => ({ ...p, payments: [{ ...p.payments[0], currency: 'EUR' }] }), 'Moneda'],
        ['versión', (p) => ({ ...p, v: 2 }), 'Versión'],
    ])('rechaza: %s', (_, mutate, message) => {
        const result = validateRemoteSalePayload(mutate(payload()));
        expect(result.ok).toBe(false);
        expect(result.error).toContain(message);
    });
});

describe('planRemoteSale', () => {
    it('venta feliz: re-precia con la caja y deja el input listo para registrar', () => {
        const plan = planRemoteSale(payload(), ctx());
        expect(plan.status).toBe('apply');
        expect(plan.warnings).toEqual([]);
        expect(plan.saleInput).toMatchObject({
            cartTotalUsd: 3,
            cartTotalBs: 120,
            saleId: SALE_ID,
            selectedCustomerId: null,
            discountData: null,
            remoteSale: { sellerName: 'Tienda 2 - María', monitorDeviceId: 'monitor-1' },
            changeBreakdown: { esCredito: false, vueltoCredito: false },
        });
        expect(plan.saleInput.cart[0]).toMatchObject({ _originalId: 'harina', qty: 2, priceUsd: 1.5 });
        expect(plan.saleInput.payments[0].methodLabel).toBe('Efectivo en Dólares');
    });

    it('G2: si la venta ya existe devuelve already_applied sin re-planificar', () => {
        const existing = { id: SALE_ID, saleNumber: 7 };
        expect(planRemoteSale(payload(), ctx({ sales: [...OPEN_SHIFT, existing] })))
            .toEqual({ status: 'already_applied', sale: existing });
    });

    it('G4: sin turno abierto rechaza', () => {
        const plan = planRemoteSale(payload(), ctx({ sales: [{ ...OPEN_SHIFT[0], cajaCerrada: true }] }));
        expect(plan).toMatchObject({ status: 'rejected', code: 'CASH_CLOSED' });
    });

    it('G1: si el precio cambió en la caja rechaza con el total nuevo', () => {
        const repriced = PRODUCTS.map((p) => (p.id === 'harina' ? { ...p, priceUsdt: 1.75 } : p));
        const plan = planRemoteSale(payload(), ctx({ products: repriced }));
        expect(plan).toMatchObject({ status: 'rejected', code: 'PRICE_CHANGED', newTotalUsd: 3.5 });
        expect(plan.priceChanges).toEqual([{ productId: 'harina', name: 'Harina', from: 1.5, to: 1.75 }]);
        expect(plan.error).toContain('3.50');
    });

    it('producto borrado en la caja → rechazo', () => {
        expect(planRemoteSale(payload(), ctx({ products: PRODUCTS.filter((p) => p.id !== 'harina') })))
            .toMatchObject({ status: 'rejected', code: 'PRODUCT_MISSING' });
    });

    it('G5: método inactivo o desconocido en la caja → rechazo', () => {
        const total = 3;
        const inactive = payload({ payments: [{ methodId: 'punto_venta', currency: 'BS', amountUsd: total, amountBs: total * RATE }] });
        expect(planRemoteSale(inactive, ctx())).toMatchObject({ status: 'rejected', code: 'METHOD_NOT_ALLOWED' });
        const unknown = payload({ payments: [{ methodId: 'zelle', currency: 'USD', amountUsd: total, amountBs: 0 }] });
        expect(planRemoteSale(unknown, ctx())).toMatchObject({ status: 'rejected', code: 'METHOD_NOT_ALLOWED' });
        const wrongCurrency = payload({ payments: [{ methodId: 'pago_movil', currency: 'USD', amountUsd: total, amountBs: 0 }] });
        expect(planRemoteSale(wrongCurrency, ctx())).toMatchObject({ status: 'rejected', code: 'METHOD_CURRENCY' });
    });

    it('G6: pago incompleto → rechazo (no hay fiado remoto)', () => {
        const underpaid = payload({ payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 2, amountBs: 0 }] });
        expect(planRemoteSale(underpaid, ctx())).toMatchObject({ status: 'rejected', code: 'UNDERPAID' });
    });

    it('acepta pago mixto USD + Bs que cubre el total', () => {
        const mixed = payload({ payments: [
            { methodId: 'efectivo_usd', currency: 'USD', amountUsd: 1, amountBs: 0 },
            { methodId: 'pago_movil', currency: 'BS', amountUsd: 2, amountBs: 80 },
        ] });
        expect(planRemoteSale(mixed, ctx()).status).toBe('apply');
    });

    it('G7: sin existencia y sin stock negativo → rechazo; con negativo → aviso', () => {
        const tooMany = payload({ cart: [line('refresco', 4)] }); // 4 bultos × 6 = 24 > 3
        expect(planRemoteSale(tooMany, ctx())).toMatchObject({ status: 'rejected', code: 'NO_STOCK' });
        const allowed = planRemoteSale(tooMany, ctx({ allowNegativeStock: true }));
        expect(allowed.status).toBe('apply');
        expect(allowed.warnings[0]).toContain('Refresco');
    });

    it('venta por unidad solo si el producto lo permite', () => {
        const unit = payload({ cart: [line('refresco', 2, 'unit')] });
        const plan = planRemoteSale(unit, ctx());
        expect(plan.status).toBe('apply');
        expect(plan.saleInput.cart[0]).toMatchObject({ id: 'refresco_unit', name: 'Refresco (Ud.)', priceUsd: 0.5, _mode: 'unit' });
        const harinaUnit = payload({ cart: [{ ...line('harina', 1), _mode: 'unit' }] });
        expect(planRemoteSale(harinaUnit, ctx())).toMatchObject({ status: 'rejected', code: 'UNIT_NOT_ALLOWED' });
    });

    it('granel admite decimales; por unidad exige enteros', () => {
        expect(planRemoteSale(payload({ cart: [line('queso', 0.25)] }), ctx()).status).toBe('apply');
        const fractional = payload({ cart: [line('harina', 1.5)] });
        expect(planRemoteSale(fractional, ctx())).toMatchObject({ status: 'rejected', code: 'QTY_NOT_INTEGER' });
    });

    it('aplica IVA de la caja al recalcular el total', () => {
        const ivaOpts = { enabled: true, resolveRate: () => 16 };
        const withIva = payload({ totalUsd: 3.48 });
        const plan = planRemoteSale(withIva, ctx({ ivaOpts }));
        expect(plan.status).toBe('apply');
        expect(plan.saleInput).toMatchObject({ cartTotalUsd: 3.48, cartBaseUsd: 3, cartIvaUsd: 0.48 });
        // El mismo carrito sin el IVA visto por el vendedor no coincide.
        expect(planRemoteSale(payload(), ctx({ ivaOpts }))).toMatchObject({ code: 'PRICE_CHANGED' });
    });

    it('sin tasa en la caja → rechazo', () => {
        expect(planRemoteSale(payload(), ctx({ effectiveRate: 0 }))).toMatchObject({ status: 'rejected', code: 'NO_RATE' });
    });
});

describe('G12 · avances de efectivo remotos', () => {
    const advance = (over = {}) => buildCashAdvanceCartLine({ currency: 'BS', montoEfectivo: 400, comisionPct: 10, ...over }, RATE, 'advance_x');

    it('el payload separa productos y avances; una venta sin avances no lleva la clave', () => {
        expect(payload()).not.toHaveProperty('cashAdvances');
        const p = payload({ cart: [line('harina', 1), advance()] });
        expect(p.items).toHaveLength(1);
        expect(p.cashAdvances).toEqual([{ currency: 'BS', montoEfectivo: 400, comisionPct: 10 }]);
        expect(validateRemoteSalePayload(p)).toEqual({ ok: true });
    });

    it('acepta una venta que solo es un avance, y valida moneda, monto y comisión', () => {
        const only = payload({ cart: [advance()] });
        expect(only.items).toEqual([]);
        expect(validateRemoteSalePayload(only)).toEqual({ ok: true });
        expect(validateRemoteSalePayload({ ...only, cashAdvances: [{ currency: 'COP', montoEfectivo: 1, comisionPct: 0 }] }).ok).toBe(false);
        expect(validateRemoteSalePayload({ ...only, cashAdvances: [{ currency: 'BS', montoEfectivo: 0, comisionPct: 0 }] }).ok).toBe(false);
        expect(validateRemoteSalePayload({ ...only, cashAdvances: [{ currency: 'BS', montoEfectivo: 10, comisionPct: 101 }] }).ok).toBe(false);
        expect(validateRemoteSalePayload({ ...only, cashAdvances: Array(REMOTE_SALE_LIMITS.MAX_CASH_ADVANCES + 1).fill(only.cashAdvances[0]) }).ok).toBe(false);
    });

    it('con avances desactivados en la caja → rechazo', () => {
        const plan = planRemoteSale(payload({ cart: [advance()] }), ctx());
        expect(plan).toMatchObject({ status: 'rejected', code: 'CASH_ADVANCE_DISABLED' });
    });

    it('con avances activos: la caja re-arma la línea con su fórmula y no toca stock', () => {
        const p = payload({
            cart: [line('harina', 1), advance()],
            payments: [{ methodId: 'pago_movil', currency: 'BS', amountUsd: 12.5, amountBs: 500 }],
        });
        const plan = planRemoteSale(p, ctx({ allowCashAdvance: true }));
        expect(plan.status).toBe('apply');
        const adv = plan.saleInput.cart.find((l) => l.isCashAdvance);
        expect(adv).toMatchObject({ id: `advance_${SALE_ID}_0`, currency: 'BS', montoEfectivo: 400, montoComision: 40, exactBs: 440, qty: 1 });
        expect(plan.saleInput.cartTotalUsd).toBeCloseTo(12.5, 2);
    });

    it('avance en USD cobra su total en dólares (no dividido por la tasa)', () => {
        const usd = advance({ currency: 'USD', montoEfectivo: 10, comisionPct: 10 });
        expect(usd.priceUsd).toBe(11);
        expect(usd.exactBs).toBeNull();
    });
});
