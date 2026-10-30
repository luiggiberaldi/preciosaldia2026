// H5 — receptor de ventas remotas en la caja con el pipeline REAL de cobro
// (processSaleTransaction) sobre un storage en memoria.
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

import { storageService } from '../src/utils/storageService';
import { processSaleTransaction } from '../src/utils/checkoutProcessor';
import { applyRemoteSaleOnCaja } from '../src/services/supervisorSaleReceiver';
import { buildRemoteCartLine, buildRemoteSalePayload } from '../src/services/supervisorSaleCommand';

const SALE_ID = '0c1d2e3f-4a5b-4c6d-8e7f-a0b1c2d3e4f5';
const PRODUCTS = [{ id: 'harina', name: 'Harina', priceUsdt: 1.5, stock: 10, costUsd: 1 }];
const SHIFT = { id: 'ap', tipo: 'APERTURA_CAJA', timestamp: '2026-10-29T08:00:00.000Z', cajaCerrada: false };
const METHODS = [{ id: 'efectivo_usd', label: 'Efectivo en Dólares', currency: 'USD' }];

const payload = (qty = 2, totalUsd = 3) => buildRemoteSalePayload({
    saleId: SALE_ID,
    seller: { name: 'Tienda 2', deviceId: 'mon-1' },
    cart: [buildRemoteCartLine(PRODUCTS[0], { qty }, { effectiveRate: 40 })],
    payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: totalUsd, amountBs: 0 }],
    changeBreakdown: {},
    totals: { totalUsd, totalBs: totalUsd * 40 },
    rate: 40,
});

const deps = (over = {}) => ({
    payload: payload(),
    commandId: 'cmd-1',
    enabled: true,
    storage: storageService,
    getPaymentMethods: async () => METHODS,
    readContext: () => ({ effectiveRate: 40, tasaCop: 0, copEnabled: false, useAutoRate: true, ivaOpts: null, allowNegativeStock: false }),
    processSale: processSaleTransaction,
    ...over,
});

const salesWithId = () => (_memoryStore.get('bodega_sales_v1') || []).filter((s) => s.id === SALE_ID);

beforeEach(() => {
    _memoryStore.clear();
    _memoryStore.set('bodega_sales_v1', [SHIFT]);
    _memoryStore.set('bodega_products_v1', PRODUCTS);
    storageService.setItem.mockClear();
});

describe('applyRemoteSaleOnCaja', () => {
    it('registra la venta y el ACK trae número, totales y la venta para el ticket', async () => {
        const ack = await applyRemoteSaleOnCaja(deps());
        expect(ack).toMatchObject({ commandId: 'cmd-1', status: 'applied', saleId: SALE_ID, saleNumber: 1, totalUsd: 3, duplicate: false });
        expect(ack.sale).toMatchObject({ id: SALE_ID, saleNumber: 1, remoteSale: { sellerName: 'Tienda 2', commandId: 'cmd-1' } });
        expect(ack.sale.items[0]).toMatchObject({ name: 'Harina', qty: 2, priceUsd: 1.5 });
        expect(_memoryStore.get('bodega_products_v1')[0].stock).toBe(8);
    });

    it('G2: doble entrega (o reenvío con otra orden) = una sola venta y un solo descuento', async () => {
        const first = await applyRemoteSaleOnCaja(deps());
        const again = await applyRemoteSaleOnCaja(deps({ commandId: 'cmd-2' }));
        expect(again).toMatchObject({ status: 'applied', duplicate: true, saleNumber: first.saleNumber });
        expect(salesWithId()).toHaveLength(1);
        expect(_memoryStore.get('bodega_products_v1')[0].stock).toBe(8);
    });

    it('G2 bajo carrera: dos entregas simultáneas registran una sola venta', async () => {
        const [a, b] = await Promise.all([applyRemoteSaleOnCaja(deps()), applyRemoteSaleOnCaja(deps({ commandId: 'cmd-2' }))]);
        expect([a.duplicate, b.duplicate].filter(Boolean)).toHaveLength(1);
        expect(salesWithId()).toHaveLength(1);
        expect(_memoryStore.get('bodega_products_v1')[0].stock).toBe(8);
    });

    it('un rechazo no escribe nada', async () => {
        _memoryStore.set('bodega_products_v1', PRODUCTS.map((p) => ({ ...p, priceUsdt: 2 })));
        const ack = await applyRemoteSaleOnCaja(deps());
        expect(ack).toMatchObject({ status: 'rejected', code: 'PRICE_CHANGED', newTotalUsd: 4 });
        expect(storageService.setItem).not.toHaveBeenCalled();
    });

    it('G10: con el flag apagado en la caja rechaza sin leer ni escribir', async () => {
        const ack = await applyRemoteSaleOnCaja(deps({ enabled: false }));
        expect(ack).toMatchObject({ status: 'rejected', code: 'DISABLED' });
        expect(storageService.setItem).not.toHaveBeenCalled();
    });

    it('G4: caja cerrada → rechazo', async () => {
        _memoryStore.set('bodega_sales_v1', [{ ...SHIFT, cajaCerrada: true }]);
        expect(await applyRemoteSaleOnCaja(deps())).toMatchObject({ status: 'rejected', code: 'CASH_CLOSED' });
    });

    it('si la validación financiera de la caja falla, el ACK es rejected con el motivo', async () => {
        const ack = await applyRemoteSaleOnCaja(deps({ processSale: async () => ({ success: false, error: 'Inconsistencia USD/Bs' }) }));
        expect(ack).toMatchObject({ status: 'rejected', code: 'CHECKOUT_REJECTED', error: 'Inconsistencia USD/Bs' });
    });

    it('con stock negativo permitido registra con aviso (applied_with_warnings)', async () => {
        const ack = await applyRemoteSaleOnCaja(deps({
            payload: payload(12, 18),
            readContext: () => ({ effectiveRate: 40, tasaCop: 0, copEnabled: false, ivaOpts: null, allowNegativeStock: true }),
        }));
        expect(ack.status).toBe('applied_with_warnings');
        expect(ack.warnings[0]).toContain('Harina');
    });
});
