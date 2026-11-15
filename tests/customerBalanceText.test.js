// F7 del PLAN-FIXEO-CLIENTES-BILLETERA: textos de la cuenta del cliente.
import { describe, it, expect } from 'vitest';
import { customerBalanceChip, saleWalletNotes } from '../src/utils/customerBalanceText';

describe('customerBalanceChip', () => {
    it('deuda con su equivalente en Bs a la tasa del día', () => {
        expect(customerBalanceChip({ deuda: 5, favor: 0 }, 40)).toEqual({ text: 'Debe $5.00 · Bs 200,00', tone: 'debt' });
    });
    it('saldo a favor', () => {
        expect(customerBalanceChip({ deuda: 0, favor: 18.5 }, 40)).toEqual({ text: 'Favor $18.50 · Bs 740,00', tone: 'credit' });
    });
    it('sin tasa no inventa Bs; al día no hay chip', () => {
        expect(customerBalanceChip({ deuda: 2.5 }, 0).text).toBe('Debe $2.50');
        expect(customerBalanceChip({ deuda: 0, favor: 0.004 }, 40)).toBeNull();
    });
});

describe('saleWalletNotes', () => {
    it('venta pagada en parte con saldo a favor', () => {
        const sale = { tipo: 'VENTA', totalUsd: 10, payments: [
            { methodId: 'saldo_favor', amountUsd: 8 }, { methodId: 'efectivo_usd', amountUsd: 2 },
        ] };
        expect(saleWalletNotes(sale)).toEqual([{ key: 'saldo_usado', text: 'Pagó con su saldo a favor: −$8.00' }]);
    });
    it('fiado parcial: cuánto pagó y cuánto fió', () => {
        const sale = { tipo: 'VENTA_FIADA', totalUsd: 10, fiadoUsd: 7, payments: [{ methodId: 'efectivo_usd', amountUsd: 3 }] };
        expect(saleWalletNotes(sale).map(n => n.text)).toEqual(['Pagó $3.00 · fió $7.00']);
    });
    it('fiado cubierto entero o en parte por el saldo a favor', () => {
        const entero = { tipo: 'VENTA_FIADA', totalUsd: 5, fiadoUsd: 5, payments: [], walletSnapshot: { favorAntes: 18.5 } };
        expect(saleWalletNotes(entero).map(n => n.text)).toEqual(['El fiado lo cubrió su saldo a favor ($5.00): la deuda no subió']);
        const parte = { ...entero, walletSnapshot: { favorAntes: 2 } };
        expect(saleWalletNotes(parte).map(n => n.text)).toEqual(['$2.00 del fiado los cubrió su saldo a favor']);
    });
    it('venta normal o abono sin notas', () => {
        expect(saleWalletNotes({ tipo: 'VENTA', totalUsd: 5, payments: [{ methodId: 'efectivo_usd', amountUsd: 5 }] })).toEqual([]);
        expect(saleWalletNotes({ tipo: 'COBRO_DEUDA', totalUsd: 5, payments: [] })).toEqual([]);
        expect(saleWalletNotes(null)).toEqual([]);
    });
});
