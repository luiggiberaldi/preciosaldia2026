/**
 * tests/ivaCheckoutWiring.test.js — Fase 4 del plan de IVA.
 *
 * Cubre la conexión del IVA: el ticket muestra BASE e IVA solo cuando la venta
 * tiene IVA, y sin IVA el HTML no incluye esas filas.
 */

import { describe, it, expect } from 'vitest';
import { buildTicketHtml } from '../src/utils/ticketHtmlTemplate';
import { getPaperConfig } from '../src/utils/ticketConstants';

const settings = {};

function saleWith(overrides = {}) {
    return {
        id: 'iva-sale',
        tipo: 'VENTA',
        saleNumber: 7,
        timestamp: new Date().toISOString(),
        totalUsd: 11.6,
        totalBs: 5800,
        rate: 500,
        items: [{ name: 'Producto', qty: 1, priceUsd: 10 }],
        payments: [{ methodId: 'efectivo_usd', methodLabel: 'Efectivo $', currency: 'USD', amountUsd: 11.6 }],
        ...overrides,
    };
}

describe('ticket con IVA', () => {
    it('muestra BASE e IVA por separado cuando ivaUsd > 0', () => {
        localStorage.setItem('receipt_currency_mode', 'usd');
        const html = buildTicketHtml(
            saleWith({ baseUsd: 10, ivaUsd: 1.6 }),
            500,
            getPaperConfig('58'),
            settings
        );
        expect(html).toContain('BASE:');
        expect(html).toContain('IVA:');
        expect(html).toContain('$10.00');
        expect(html).toContain('$1.60');
    });

    it('en modo Bs muestra BASE e IVA en bolívares', () => {
        localStorage.setItem('receipt_currency_mode', 'bs');
        const html = buildTicketHtml(
            saleWith({ baseUsd: 10, ivaUsd: 1.6 }),
            500,
            getPaperConfig('58'),
            settings
        );
        expect(html).toContain('BASE:');
        expect(html).toContain('Bs ');
    });

    it('si baseUsd no viene, deriva la base como total - IVA', () => {
        localStorage.setItem('receipt_currency_mode', 'usd');
        const html = buildTicketHtml(
            saleWith({ ivaUsd: 1.6 }),
            500,
            getPaperConfig('58'),
            settings
        );
        expect(html).toContain('$10.00');
    });
});

describe('ticket sin IVA (contrato existente)', () => {
    it('ivaUsd 0 no agrega filas de BASE ni IVA', () => {
        localStorage.setItem('receipt_currency_mode', 'usd');
        const html = buildTicketHtml(
            saleWith({ baseUsd: 11.6, ivaUsd: 0 }),
            500,
            getPaperConfig('58'),
            settings
        );
        expect(html).not.toContain('BASE:');
        expect(html).not.toContain('IVA:');
    });

    it('venta sin campos de IVA (ventas antiguas) no muestra IVA', () => {
        localStorage.setItem('receipt_currency_mode', 'usd');
        const html = buildTicketHtml(saleWith(), 500, getPaperConfig('58'), settings);
        expect(html).not.toContain('BASE:');
        expect(html).not.toContain('IVA:');
    });
});
