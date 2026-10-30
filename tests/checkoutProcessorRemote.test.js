// H4 — processSaleTransaction con venta remota: id fijo idempotente y etiqueta.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const _memoryStore = new Map();

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (key, defaultValue = null) => (_memoryStore.has(key) ? _memoryStore.get(key) : defaultValue)),
        setItem: vi.fn(async (key, value) => { _memoryStore.set(key, JSON.parse(JSON.stringify(value))); }),
    },
}));
vi.mock('../src/services/auditService', () => ({ logEvent: vi.fn(() => Promise.resolve()) }));
vi.mock('../src/hooks/store/useAuthStore', () => ({
    useAuthStore: { getState: () => ({ usuarioActivo: { id: 'u', nombre: 'Cajera', rol: 'ADMIN' } }) },
}));

import { processSaleTransaction } from '../src/utils/checkoutProcessor';
import { logEvent } from '../src/services/auditService';
import { buildRemoteCartLine, buildRemoteSalePayload, planRemoteSale } from '../src/services/supervisorSaleCommand';

const SALE_ID = '9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d';
const PRODUCTS = [{ id: 'harina', name: 'Harina', priceUsdt: 1.5, stock: 10, costUsd: 1 }];
const SHIFT = { id: 'ap', tipo: 'APERTURA_CAJA', timestamp: '2026-10-29T08:00:00.000Z', cajaCerrada: false };

function plannedInput() {
    const cart = [buildRemoteCartLine(PRODUCTS[0], { qty: 2 }, { effectiveRate: 40 })];
    const payload = buildRemoteSalePayload({
        saleId: SALE_ID,
        seller: { name: 'Tienda 2', deviceId: 'mon-1' },
        cart,
        payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 5, amountBs: 0 }],
        changeBreakdown: { changeUsdGiven: 2 },
        totals: { totalUsd: 3, totalBs: 120 },
        rate: 40,
    });
    const plan = planRemoteSale(payload, {
        products: PRODUCTS,
        sales: [SHIFT],
        paymentMethods: [{ id: 'efectivo_usd', label: 'Efectivo en Dólares', currency: 'USD' }],
        effectiveRate: 40,
    });
    expect(plan.status).toBe('apply');
    return { ...plan.saleInput, granelUnitMode: 'kg_lt', remoteSale: { ...plan.saleInput.remoteSale, commandId: 'cmd-1' } };
}

beforeEach(() => {
    _memoryStore.clear();
    _memoryStore.set('bodega_sales_v1', [SHIFT]);
    _memoryStore.set('bodega_products_v1', PRODUCTS);
    logEvent.mockClear();
});

describe('venta remota en processSaleTransaction', () => {
    it('registra con el id del monitor, la etiqueta remota y descuenta stock', async () => {
        const result = await processSaleTransaction(plannedInput());
        expect(result.success).toBe(true);
        expect(result.sale).toMatchObject({
            id: SALE_ID,
            tipo: 'VENTA',
            totalUsd: 3,
            changeUsd: 2,
            saleNumber: 1,
            remoteSale: { sellerName: 'Tienda 2', monitorDeviceId: 'mon-1', commandId: 'cmd-1' },
        });
        expect(_memoryStore.get('bodega_products_v1')[0].stock).toBe(8);
        expect(logEvent).toHaveBeenCalledWith('VENTA', 'VENTA_REMOTA', expect.stringContaining('remota (Tienda 2)'), expect.anything(), expect.objectContaining({ saleId: SALE_ID }));
    });

    it('G2: la misma venta dos veces registra una sola y no descuenta stock de nuevo', async () => {
        const first = await processSaleTransaction(plannedInput());
        const second = await processSaleTransaction(plannedInput());
        expect(second).toMatchObject({ success: true, duplicate: true });
        expect(second.sale.id).toBe(first.sale.id);
        expect(second.sale.saleNumber).toBe(1);
        const sales = _memoryStore.get('bodega_sales_v1').filter((s) => s.id === SALE_ID);
        expect(sales).toHaveLength(1);
        expect(_memoryStore.get('bodega_products_v1')[0].stock).toBe(8);
    });

    it('las ventas normales siguen sin etiqueta remota y con id aleatorio', async () => {
        const { saleId: _saleId, remoteSale: _remoteSale, ...normal } = plannedInput();
        const result = await processSaleTransaction(normal);
        expect(result.success).toBe(true);
        expect(result.sale.id).not.toBe(SALE_ID);
        expect(result.sale).not.toHaveProperty('remoteSale');
        expect(logEvent).toHaveBeenCalledWith('VENTA', 'VENTA_COMPLETADA', expect.any(String), expect.anything(), expect.anything());
    });
});
