// F3 del PLAN-FIXEO-CLIENTES-BILLETERA: el aviso de anulación usa la misma regla
// que processVoidSale, así que la vista previa debe coincidir con lo que pasa.
import { describe, it, expect, beforeEach, vi } from 'vitest';

const memoryStore = new Map();
vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (key, d = null) => memoryStore.has(key) ? memoryStore.get(key) : d),
        setItem: vi.fn(async (key, v) => memoryStore.set(key, JSON.parse(JSON.stringify(v)))),
    },
}));
vi.mock('../src/services/auditService', () => ({ logEvent: vi.fn(() => Promise.resolve()) }));
vi.mock('../src/hooks/store/useAuthStore', () => ({
    useAuthStore: { getState: () => ({ usuarioActivo: { id: 'u1', nombre: 'Cajera', rol: 'ADMIN' } }) },
}));

import { CUSTOMER_LEDGER_KEY } from '../src/utils/customerLedger';
import { processSaleTransaction } from '../src/utils/checkoutProcessor';
import { processCustomerTransaction } from '../src/utils/customerTransactionProcessor';
import { processVoidSale } from '../src/utils/voidSaleProcessor';
import { previewVoidCustomerImpact, describeVoidImpact, describeBalance } from '../src/utils/voidImpact';

const C = 'bodega_customers_v1';
const R = 40;
const maria = () => memoryStore.get(C)[0];
const usd = (a) => ({ methodId: 'efectivo_usd', currency: 'USD', amountUsd: a, amountBs: a * R });
const favor = (a) => ({ methodId: 'saldo_favor', currency: 'USD', amountUsd: a, amountBs: a * R, isSaldoFavor: true });

const vender = (totalUsd, payments, changeBreakdown = {}) => processSaleTransaction({
    cart: [{ id: 'p1', name: 'Harina', qty: 1, priceUsd: totalUsd, costUsd: 0, isWeight: false }],
    cartTotalUsd: totalUsd, cartTotalBs: totalUsd * R, cartSubtotalUsd: totalUsd,
    payments, changeBreakdown, selectedCustomerId: 'maria', customers: memoryStore.get(C),
    products: memoryStore.get('bodega_products_v1'), effectiveRate: R, tasaCop: 0, copEnabled: false,
    discountData: null, useAutoRate: false,
}).then(r => r.sale);
const aVuelto = { changeUsdGiven: 0, changeBsGiven: 0, vueltoCredito: true, changeAllocationExplicit: true };

async function previewYAnular(sale) {
    const impact = previewVoidCustomerImpact(sale, maria(), memoryStore.get(CUSTOMER_LEDGER_KEY));
    await processVoidSale(sale, memoryStore.get('bodega_sales_v1'), memoryStore.get('bodega_products_v1'));
    return impact;
}

beforeEach(() => {
    memoryStore.clear();
    memoryStore.set(C, [{ id: 'maria', name: 'María', deuda: 0, favor: 0 }]);
    memoryStore.set('bodega_products_v1', [{ id: 'p1', name: 'Harina', stock: 100, costUsd: 0 }]);
});

describe('previewVoidCustomerImpact', () => {
    it('vuelto a billetera ya gastado: avisa la deuda nueva y coincide con la anulación real', async () => {
        const v = await vender(5, [usd(10)], aVuelto);      // +$5 a favor
        await vender(5, [favor(5)]);                       // lo gasta
        const impact = await previewYAnular(v);
        expect(impact).toMatchObject({ antesUsd: 0, despuesUsd: -5, quedaDebiendoUsd: 5 });
        expect(maria()).toMatchObject({ deuda: 5, favor: 0 });
        const lines = describeVoidImpact(impact, R);
        expect(lines[0]).toBe('Cuenta de María: al día → debe $5.00.');
        expect(lines[1]).toContain('quedará debiendo $5.00 (Bs 200,00)');
    });

    it('venta fiada: la deuda baja y no hay aviso de deuda', async () => {
        const v = await vender(8, [usd(3)], { esCredito: true }); // fía $5
        const impact = await previewYAnular(v);
        expect(impact).toMatchObject({ antesUsd: -5, despuesUsd: 0, quedaDebiendoUsd: 0 });
        expect(maria().deuda).toBe(0);
        expect(describeVoidImpact(impact, R)).toEqual(['Cuenta de María: debe $5.00 → al día.']);
    });

    it('venta pagada con saldo a favor: el saldo vuelve', async () => {
        await vender(5, [usd(10)], aVuelto);
        const v = await vender(3, [favor(3)]);
        const impact = await previewYAnular(v);
        expect(impact).toMatchObject({ antesUsd: 2, despuesUsd: 5, quedaDebiendoUsd: 0 });
        expect(maria().favor).toBe(5);
    });

    it('abono con sobrante: se borra todo el abono y la deuda vuelve', async () => {
        await vender(4, [], { esCredito: true });         // debe $4
        const { sale } = await processCustomerTransaction({
            transactionAmount: 6, currencyMode: 'USD', type: 'ABONO', customer: maria(),
            paymentMethod: 'efectivo_usd', bcvRate: R, tasaCop: 0, copEnabled: false,
        });                                               // $2 a favor
        const impact = await previewYAnular(sale);
        expect(impact).toMatchObject({ antesUsd: 2, despuesUsd: -4, quedaDebiendoUsd: 4, esAbono: true });
        expect(maria()).toMatchObject({ deuda: 4, favor: 0 });
        expect(describeVoidImpact(impact)[1]).toBe('⚠ Se borra el abono: la deuda sube $4.00.');
    });

    it('venta sin cliente o de contado sin cartera: no hay nada que avisar', async () => {
        expect(previewVoidCustomerImpact({ id: 'x', customerId: null }, null, [])).toBeNull();
        const v = await vender(5, [usd(5)]);
        expect(previewVoidCustomerImpact(v, maria(), memoryStore.get(CUSTOMER_LEDGER_KEY) || [])).toBeNull();
    });

    it('describeBalance', () => {
        expect(describeBalance(-2.5)).toBe('debe $2.50');
        expect(describeBalance(3)).toBe('$3.00 a favor');
        expect(describeBalance(0.001)).toBe('al día');
    });
});
