import { describe, expect, it, beforeEach } from 'vitest';
import { buildTicketHtml } from '../src/utils/ticketHtmlTemplate';
import { getPaperConfig } from '../src/utils/ticketConstants';

const settings = { name: 'Bodega Test', rif: '', address: '', phone: '', instagram: '' };

beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('receipt_currency_mode', 'usd');
});

describe('referencias de cartera en tickets', () => {
    it('formatea cantidades canónicas con unidad líquida/sólida en tickets', () => {
        localStorage.setItem('granel_unit_mode', 'gr_ml');
        const html = buildTicketHtml({
            id: 'bulk-units', saleNumber: 5, timestamp: new Date().toISOString(),
            totalUsd: 3, totalBs: 120, rate: 40,
            items: [
                { name: 'Queso', qty: 0.5, priceUsd: 5, isWeight: true, unit: 'kg', granelUnit: 'kg', packagingType: 'granel' },
                { name: 'Cloro', qty: 0.75, priceUsd: 2, isWeight: true, unit: 'litro', granelUnit: 'litro', packagingType: 'granel' },
            ],
            payments: [{ methodId: 'efectivo_usd', methodLabel: 'Efectivo $', currency: 'USD', amountUsd: 3 }],
        }, 40, getPaperConfig('58'), settings);

        expect(html).toContain('500 g x');
        expect(html).toContain('750 ml x');
        expect(html).not.toContain('0.75 kg');
    });

    it('muestra cuando el vuelto queda acreditado a favor', () => {
        const html = buildTicketHtml({
            id: 'sale-wallet',
            tipo: 'VENTA',
            saleNumber: 1,
            timestamp: new Date().toISOString(),
            customerName: 'Ana',
            totalUsd: 5,
            totalBs: 2900,
            rate: 580,
            items: [{ name: 'Producto', qty: 1, priceUsd: 5 }],
            payments: [{ methodId: 'efectivo_usd', methodLabel: 'Efectivo $', currency: 'USD', amountUsd: 10 }],
            vueltoParaMonedero: 5,
        }, 580, getPaperConfig('58'), settings);

        expect(html).toContain('Saldo a favor acreditado:');
        expect(html).toContain('+$5.00');
        expect(html).not.toContain('Saldo a favor utilizado');
    });

    it('muestra el sobrante de un abono como saldo a favor generado', () => {
        const html = buildTicketHtml({
            id: 'debt-payment-wallet',
            tipo: 'COBRO_DEUDA',
            saleNumber: 3,
            timestamp: new Date().toISOString(),
            customerName: 'Luis',
            totalUsd: 10,
            totalBs: 8500,
            rate: 850,
            items: [{ name: 'Abono de deuda: Luis', qty: 1, priceUsd: 10 }],
            payments: [{ methodId: 'efectivo_usd', methodLabel: 'Efectivo $', currency: 'USD', amountUsd: 10 }],
            saldoFavorGeneradoUsd: 5.2,
        }, 850, getPaperConfig('58'), settings);

        expect(html).toContain('Saldo a favor generado (sobrante de abono):');
        expect(html).toContain('+$5.20');
        expect(html).not.toContain('Saldo a favor acreditado');
    });

    it('muestra cuando el cliente utiliza saldo a favor', () => {
        const html = buildTicketHtml({
            id: 'sale-used',
            tipo: 'VENTA',
            saleNumber: 2,
            timestamp: new Date().toISOString(),
            customerName: 'Ana',
            totalUsd: 5,
            totalBs: 2900,
            rate: 580,
            items: [{ name: 'Producto', qty: 1, priceUsd: 5 }],
            payments: [{ methodId: 'saldo_favor', methodLabel: 'Saldo a Favor', currency: 'INTERNAL_CREDIT', amountUsd: 5 }],
            vueltoParaMonedero: 0,
        }, 580, getPaperConfig('58'), settings);

        expect(html).toContain('Saldo a favor utilizado');
        expect(html).toContain('-$5.00');
        expect(html).not.toContain('Saldo a favor acreditado');
    });

    it('distingue caja, vuelto físico y billetera en un cambio parcial', () => {
        const html = buildTicketHtml({
            id: 'sale-split',
            tipo: 'VENTA',
            saleNumber: 4,
            timestamp: new Date().toISOString(),
            customerName: 'Ana',
            totalUsd: 5,
            totalBs: 2900,
            rate: 580,
            items: [{ name: 'Producto', qty: 1, priceUsd: 5 }],
            payments: [{ methodId: 'efectivo_usd', methodLabel: 'Efectivo $', currency: 'USD', amountUsd: 10 }],
            changeUsd: 1,
            tipDonated: { amountUsd: 2, amountBs: 0, currency: 'USD' },
            vueltoParaMonedero: 2,
        }, 580, getPaperConfig('58'), settings);

        expect(html).toContain('Vuelto entregado:');
        expect(html).toContain('Cambio dejado en caja:');
        expect(html).toContain('Saldo a favor acreditado:');
    });
});
