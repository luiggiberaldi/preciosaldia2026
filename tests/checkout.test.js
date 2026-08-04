// tests/checkout.test.js — Tests para src/utils/checkoutProcessor.js
// Cubre los fixes FIN-034 (doble conteo de vuelto), FIN-035 (vuelto en Cashea),
// FIN-036 (auditoría con total dinámico) y FIN-037 (cliente fresco).

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks (copiados de tests/financialEngine.test.js, deben ir arriba del todo) ──
const _memoryStore = new Map();

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (key, defaultValue = null) => {
            if (_memoryStore.has(key)) return _memoryStore.get(key);
            return defaultValue;
        }),
        setItem: vi.fn(async (key, value) => {
            _memoryStore.set(key, JSON.parse(JSON.stringify(value)));
        }),
    },
}));

vi.mock('../src/services/auditService', () => ({
    logEvent: vi.fn(() => Promise.resolve()),
}));

vi.mock('../src/hooks/store/useAuthStore', () => ({
    useAuthStore: { getState: () => ({ usuarioActivo: { id: 'test-user', nombre: 'Tester', rol: 'ADMIN' } }) },
}));

import { processSaleTransaction } from '../src/utils/checkoutProcessor';
import { storageService } from '../src/utils/storageService';
import { logEvent } from '../src/services/auditService';

const SALES_KEY = 'bodega_sales_v1';
const CUSTOMERS_KEY = 'bodega_customers_v1';

function resetMockStore() {
    _memoryStore.clear();
    storageService.getItem.mockClear();
    storageService.setItem.mockClear();
    logEvent.mockClear();
}

// Opts base: venta de $10 a tasa 40. Sobreescribe lo que necesites por test.
function baseOpts(over = {}) {
    return {
        cart: [{ id: 'p1', name: 'Harina', qty: 1, priceUsd: 10, costUsd: 4, costBs: 0, isWeight: false }],
        cartTotalUsd: 10,
        cartTotalBs: 400,
        cartSubtotalUsd: 10,
        payments: [{ amountUsd: 10, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
        changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
        selectedCustomerId: null,
        customers: [],
        products: [{ id: 'p1', name: 'Harina', stock: 50, costUsd: 4 }],
        effectiveRate: 40,
        tasaCop: 0,
        copEnabled: false,
        discountData: null,
        useAutoRate: false,
        ...over,
    };
}

beforeEach(() => resetMockStore());

// ════════════════════════════════════════════════════════════════════════
// FIN-034 — El vuelto declarado nunca puede superar el vuelto real
// ════════════════════════════════════════════════════════════════════════
describe('FIN-034: normalización del vuelto', () => {

    it('NO duplica el vuelto cuando la UI declara el mismo monto en USD y en Bs', async () => {
        // Venta $10, paga con $20 → vuelto real = $10 (o 400 Bs). NUNCA ambos.
        const result = await processSaleTransaction(baseOpts({
            payments: [{ amountUsd: 20, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            changeBreakdown: { changeUsdGiven: 10, changeBsGiven: 400 },
        }));

        expect(result.success).toBe(true);
        // El valor total del vuelto entregado, expresado en USD, no puede pasar de $10.
        const vueltoTotalUsd = result.sale.changeUsd + (result.sale.changeBs / 40);
        expect(vueltoTotalUsd).toBeLessThanOrEqual(10.01);
        // Política: se prioriza el tramo en Bs (es el que el operador escribe explícito).
        expect(result.sale.changeBs).toBe(400);
        expect(result.sale.changeUsd).toBe(0);
    });

    it('REGRESIÓN: un desglose de vuelto válido se persiste intacto', async () => {
        // Venta $10, paga $20, entrega $4 en efectivo USD + 240 Bs ($6). Total $10. Válido.
        const result = await processSaleTransaction(baseOpts({
            payments: [{ amountUsd: 20, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            changeBreakdown: { changeUsdGiven: 4, changeBsGiven: 240 },
        }));

        expect(result.success).toBe(true);
        expect(result.sale.changeUsd).toBe(4);
        expect(result.sale.changeBs).toBe(240);
    });
});

// ════════════════════════════════════════════════════════════════════════
// FIN-035 — Una venta Cashea con sobrepago sí registra su vuelto
// ════════════════════════════════════════════════════════════════════════
describe('FIN-035: vuelto en ventas Cashea', () => {

    it('conserva el vuelto de la cuota inicial en una VENTA_CASHEA', async () => {
        _memoryStore.set(CUSTOMERS_KEY, [{ id: 'c1', name: 'Ana', deuda: 0, favor: 0 }]);

        // Venta $100. Cashea remesa $60, el cliente paga $50 en efectivo → vuelto $10.
        const result = await processSaleTransaction(baseOpts({
            cart: [{ id: 'p1', name: 'Harina', qty: 10, priceUsd: 10, costUsd: 4, costBs: 0, isWeight: false }],
            cartTotalUsd: 100,
            cartTotalBs: 4000,
            cartSubtotalUsd: 100,
            payments: [
                { amountUsd: 50, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' },
                { amountUsd: 60, amountBs: 2400, currency: 'USD', methodId: 'cashea', methodLabel: 'Cashea' },
            ],
            changeBreakdown: { changeUsdGiven: 10, changeBsGiven: 0 },
            selectedCustomerId: 'c1',
            customers: [{ id: 'c1', name: 'Ana', deuda: 0, favor: 0 }],
        }));

        expect(result.success).toBe(true);
        expect(result.sale.tipo).toBe('VENTA_CASHEA');
        // El vuelto de la cuota inicial es dinero real que salió de la caja.
        expect(result.sale.changeUsd).toBe(10);
    });

    it('REGRESIÓN: una VENTA_FIADA no registra vuelto', async () => {
        _memoryStore.set(CUSTOMERS_KEY, [{ id: 'c1', name: 'Ana', deuda: 0, favor: 0 }]);

        const result = await processSaleTransaction(baseOpts({
            payments: [{ amountUsd: 4, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: 'c1',
            customers: [{ id: 'c1', name: 'Ana', deuda: 0, favor: 0 }],
        }));

        expect(result.success).toBe(true);
        expect(result.sale.tipo).toBe('VENTA_FIADA');
        expect(result.sale.changeUsd).toBe(0);
        expect(result.sale.changeBs).toBe(0);
    });
});

// ════════════════════════════════════════════════════════════════════════
// FIN-036 — La auditoría reporta el mismo total que la venta persistida
// ════════════════════════════════════════════════════════════════════════
describe('FIN-036: coherencia entre auditoría y venta', () => {

    it('el log de auditoría usa el total dinámico, no el prop crudo', async () => {
        _memoryStore.set(CUSTOMERS_KEY, []);

        // Item con doble precio: $10 en USD, pero $11 de referencia si se paga en Bs.
        const result = await processSaleTransaction(baseOpts({
            cart: [{
                id: 'p1', name: 'Harina', qty: 1,
                priceUsd: 10, priceBsUsdRef: 11, pricingMode: 'dual_usd',
                costUsd: 4, costBs: 0, isWeight: false,
            }],
            cartTotalUsd: 10,
            cartTotalBs: 400,
            cartSubtotalUsd: 10,
            // Pago en Bs → el motor recalcula el total a $11 / 440 Bs.
            payments: [{ amountUsd: 11, amountBs: 440, currency: 'BS', methodId: 'efectivo_bs', methodLabel: 'Efectivo Bs' }],
        }));

        expect(result.success).toBe(true);
        expect(result.sale.totalUsd).toBe(11);

        // El 5º argumento de logEvent es el objeto de metadata { saleId, total, items }.
        const meta = logEvent.mock.calls[0][4];
        expect(meta.total).toBe(result.sale.totalUsd);
    });
});

// ════════════════════════════════════════════════════════════════════════
// FIN-037 — El saldo del cliente se lee fresco del storage
// ════════════════════════════════════════════════════════════════════════
describe('FIN-037: cliente leído fresco dentro del lock', () => {

    it('parte de la deuda persistida, no de la del prop obsoleto', async () => {
        // Verdad en storage: Ana ya debe $5.
        _memoryStore.set(CUSTOMERS_KEY, [{ id: 'c1', name: 'Ana', deuda: 5, favor: 0 }]);

        // El prop que llega desde React está desactualizado (deuda 0).
        const result = await processSaleTransaction(baseOpts({
            payments: [],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: 'c1',
            customers: [{ id: 'c1', name: 'Ana', deuda: 0, favor: 0 }],
        }));

        expect(result.success).toBe(true);
        expect(result.sale.tipo).toBe('VENTA_FIADA');

        const persisted = _memoryStore.get(CUSTOMERS_KEY).find(c => c.id === 'c1');
        // 5 previos + 10 de esta venta = 15. Si sale 10, se perdió deuda.
        expect(persisted.deuda).toBe(15);
    });
});
