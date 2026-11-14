// tests/tipDonated.test.js — Propina donada ("Cliente deja el cambio").
// Cubre TIP-001 a TIP-006. Ver PLAN-VUELTO-DONADO.md.
//
// ALCANCE: capas puras (checkoutProcessor + FinancialEngine).
// La UI (CheckoutModalPOS, PaymentLeftColumn, CheckoutModal) NO se testea aquí:
// @testing-library no es dependencia del proyecto. Se valida con el checklist manual.

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── Mocks (copiados de tests/checkout.test.js, deben ir arriba del todo) ──
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
import { FinancialEngine } from '../src/core/FinancialEngine';
import { storageService } from '../src/utils/storageService';
import { logEvent } from '../src/services/auditService';

const SALES_KEY = 'bodega_sales_v1';

function resetMockStore() {
    _memoryStore.clear();
    storageService.getItem.mockClear();
    storageService.setItem.mockClear();
    logEvent.mockClear();
}

// Venta de $10 a tasa 40, pagada con $15 en efectivo USD → vuelto real $5.
function baseOpts(over = {}) {
    return {
        cart: [{ id: 'p1', name: 'Harina', qty: 1, priceUsd: 10, costUsd: 4, costBs: 0, isWeight: false }],
        cartTotalUsd: 10,
        cartTotalBs: 400,
        cartSubtotalUsd: 10,
        payments: [{ amountUsd: 15, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
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

async function persistedSale() {
    const sales = _memoryStore.get(SALES_KEY) || [];
    return sales[0];
}

beforeEach(() => resetMockStore());

describe('COBRO-001: faltante de hasta $0,01', () => {
    it('no fía y queda en redondeoUsd', async () => {
        const r = await processSaleTransaction(baseOpts({
            payments: [{ amountUsd: 9.99, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
        }));
        expect(r.success).toBe(true);
        const sale = await persistedSale();
        expect(sale.tipo).toBe('VENTA');
        expect(sale.redondeoUsd).toBe(0.01);
        expect(sale.fiadoUsd).toBe(0);
    });
    it('venta exacta: redondeoUsd = 0', async () => {
        const r = await processSaleTransaction(baseOpts({
            payments: [{ amountUsd: 10, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
        }));
        expect(r.success).toBe(true);
        expect((await persistedSale()).redondeoUsd).toBe(0);
    });
    it('faltante de $0,02 sí exige cliente (fiado) y no es redondeo', async () => {
        const r = await processSaleTransaction(baseOpts({
            payments: [{ amountUsd: 9.98, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
        }));
        expect(r.success).toBe(false);
    });
});
