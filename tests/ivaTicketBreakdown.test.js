// @vitest-environment jsdom
// Ticket con productos exentos (E) y el IVA desglosado: EXENTO (E) / BASE IMPONIBLE n% / IVA n%.
// Regla: en cada moneda EXENTO + BASES + IVA = TOTAL que se cobró.
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

import { FinancialEngine } from '../src/core/FinancialEngine';
import { resolveLineIvaRate } from '../src/config/taxConfig';
import { buildTicketHtml, buildIvaTicketRows } from '../src/utils/ticketHtmlTemplate';
import { getPaperConfig } from '../src/utils/ticketConstants';
import { buildReceiptWhatsAppUrl } from '../src/components/Sales/ReceiptShareHelper';
import { processSaleTransaction } from '../src/utils/checkoutProcessor';
import { round2, sumR } from '../src/utils/dinero';

const RATE = 895;
const TAX = { ivaEnabled: true, ivaRate: 16 };
const ivaOpts = (cfg = TAX) => ({ enabled: cfg.ivaEnabled, resolveRate: (item) => resolveLineIvaRate(item, cfg) });

// Carrito del ejemplo acordado con el cliente.
const CART = [
    { id: 'harina', name: 'Harina PAN 1kg', priceUsd: 1.2, qty: 2, ivaRate: 0 },
    { id: 'arroz', name: 'Arroz Mary 1kg', priceUsd: 1.1, qty: 1, ivaRate: 0 },
    { id: 'aceite', name: 'Aceite Vatel 1L', priceUsd: 3.5, qty: 1 },
    { id: 'jabon', name: 'Jabón Las Llaves', priceUsd: 0.9, qty: 2 },
];

const sumBreakdown = (b) => ({
    usd: round2(b.exemptUsd + sumR(b.groups.map((g) => g.baseUsd)) + b.ivaUsd),
    bs: round2(b.exemptBs + sumR(b.groups.map((g) => g.baseBs)) + b.ivaBs),
});

describe('desglose de IVA por alícuota (buildCartTotals)', () => {
    it('ejemplo del ticket: exento 3.132,50 Bs, base 16% 4.743,50 Bs, IVA 758,96 Bs, total 8.634,96 Bs', () => {
        const t = FinancialEngine.buildCartTotals(CART, null, RATE, 0, false, ivaOpts());
        expect(t.ivaBreakdown).toEqual({
            exemptUsd: 3.5,
            exemptBs: 3132.5,
            ivaUsd: 0.85,
            ivaBs: 758.96,
            groups: [{ rate: 16, baseUsd: 5.3, baseBs: 4743.5, ivaUsd: 0.85, ivaBs: 758.96 }],
        });
        expect(t.totalUsd).toBe(9.65);
        expect(t.totalBs).toBe(8634.96);
        expect(sumBreakdown(t.ivaBreakdown)).toEqual({ usd: t.totalUsd, bs: t.totalBs });
    });

    it('el IVA en Bs sale de la base en Bs (cuadra), no del IVA en USD convertido', () => {
        const t = FinancialEngine.buildCartTotals(CART, null, RATE, 0, false, ivaOpts());
        // 0.85 USD × 895 = 760.75 no cuadraría con 4.743,50 × 16% = 758,96.
        expect(t.ivaBs).toBe(round2(4743.5 * 0.16));
    });

    it('con descuento: el descuento se reparte en las bases y todo sigue cuadrando', () => {
        const t = FinancialEngine.buildCartTotals(CART, { type: 'percentage', value: 10 }, RATE, 0, false, ivaOpts());
        expect(round2(t.ivaBreakdown.exemptUsd + t.ivaBreakdown.groups[0].baseUsd)).toBe(t.baseUsd);
        expect(sumBreakdown(t.ivaBreakdown)).toEqual({ usd: t.totalUsd, bs: t.totalBs });
    });

    it('varias alícuotas (16% y 8%) van en grupos separados, de mayor a menor', () => {
        const cart = [...CART, { id: 'pan', name: 'Pan', priceUsd: 2, qty: 1, ivaRate: 8 }];
        const t = FinancialEngine.buildCartTotals(cart, null, RATE, 0, false, ivaOpts());
        expect(t.ivaBreakdown.groups.map((g) => g.rate)).toEqual([16, 8]);
        expect(t.ivaBreakdown.groups[1]).toMatchObject({ baseUsd: 2, ivaUsd: 0.16 });
        expect(sumBreakdown(t.ivaBreakdown)).toEqual({ usd: t.totalUsd, bs: t.totalBs });
    });

    it('carritos al azar (con y sin descuento, tasas raras): siempre cuadra en USD y en Bs', () => {
        let seed = 7;
        const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
        for (let n = 0; n < 300; n += 1) {
            const cart = Array.from({ length: 1 + Math.floor(rnd() * 6) }, (_, i) => ({
                id: `p${i}`, name: `P${i}`,
                priceUsd: round2(0.05 + rnd() * 40),
                qty: 1 + Math.floor(rnd() * 5),
                ...(rnd() < 0.4 ? { ivaRate: 0 } : rnd() < 0.2 ? { ivaRate: 8 } : {}),
            }));
            const rate = round2(30 + rnd() * 900);
            const discount = rnd() < 0.3 ? { type: 'percentage', value: Math.floor(rnd() * 30) } : null;
            const t = FinancialEngine.buildCartTotals(cart, discount, rate, 0, false, ivaOpts());
            const b = t.ivaBreakdown;
            expect(round2(b.exemptUsd + sumR(b.groups.map((g) => g.baseUsd)))).toBe(t.baseUsd);
            expect(round2(b.exemptBs + sumR(b.groups.map((g) => g.baseBs)))).toBe(round2(t.totalBs - t.ivaBs));
            expect(sumBreakdown(b)).toEqual({ usd: t.totalUsd, bs: t.totalBs });
            for (const g of b.groups) {
                expect(g.ivaBs).toBe(round2(g.baseBs * g.rate / 100));
            }
        }
    });

    it('sin IVA activo no hay desglose y los totales no cambian', () => {
        const off = FinancialEngine.buildCartTotals(CART, null, RATE, 0, false, ivaOpts({ ivaEnabled: false, ivaRate: 16 }));
        expect(off.ivaBreakdown).toBeNull();
        expect(off.ivaUsd).toBe(0);
        expect(off.totalBs).toBe(off.subtotalBs);
    });
});

function saleFromCart(cart = CART) {
    const t = FinancialEngine.buildCartTotals(cart, null, RATE, 0, false, ivaOpts());
    return {
        id: 's1', tipo: 'VENTA', saleNumber: 1234, timestamp: '2026-11-07T14:42:00.000Z', rate: RATE,
        items: cart.map((i) => ({ ...i, ivaRate: resolveLineIvaRate(i, TAX) })),
        totalUsd: t.totalUsd, totalBs: t.totalBs, baseUsd: t.baseUsd, ivaUsd: t.ivaUsd, ivaBs: t.ivaBs,
        ivaBreakdown: t.ivaBreakdown,
        payments: [{ methodId: 'pago_movil', methodLabel: 'Pago Móvil', currency: 'BS', amountBs: t.totalBs, amountUsd: t.totalUsd }],
    };
}

describe('ticket impreso (HTML)', () => {
    beforeEach(() => localStorage.setItem('receipt_currency_mode', 'bs'));

    it('marca los exentos con (E) y desglosa EXENTO / BASE IMPONIBLE 16% / IVA 16% en Bs', () => {
        const html = buildTicketHtml(saleFromCart(), RATE, getPaperConfig('80'), {});
        expect(html).toContain('Harina PAN 1kg (E)');
        expect(html).toContain('Arroz Mary 1kg (E)');
        expect(html).not.toContain('Aceite Vatel 1L (E)');
        expect(html).not.toContain('Jabón Las Llaves (E)');
        expect(html).toMatch(/EXENTO \(E\):<\/td>\s*<td[^>]*>Bs 3\.132,50/);
        expect(html).toMatch(/BASE IMPONIBLE 16%:<\/td>\s*<td[^>]*>Bs 4\.743,50/);
        expect(html).toMatch(/IVA 16%:<\/td>\s*<td[^>]*>Bs 758,96/);
        expect(html).toContain('Bs 8.634,96');
    });

    it('no imprime la tasa de cambio', () => {
        const html = buildTicketHtml(saleFromCart(), RATE, getPaperConfig('58'), {});
        expect(html).not.toMatch(/Tasa/i);
        expect(html).not.toContain('895,00');
    });

    it('modo USD: el desglose sale en dólares', () => {
        localStorage.setItem('receipt_currency_mode', 'usd');
        const html = buildTicketHtml(saleFromCart(), RATE, getPaperConfig('58'), {});
        expect(html).toMatch(/EXENTO \(E\):<\/td>\s*<td[^>]*>\$3\.50/);
        expect(html).toMatch(/IVA 16%:<\/td>\s*<td[^>]*>\$0\.85/);
    });

    it('sin productos exentos no aparece la línea EXENTO', () => {
        const rows = buildIvaTicketRows(saleFromCart(CART.slice(2)), RATE);
        expect(rows.map((r) => r.label)).toEqual(['BASE IMPONIBLE 16%', 'IVA 16%']);
    });

    it('venta sin IVA: ni (E) ni desglose (el ticket queda como antes)', () => {
        const sale = { ...saleFromCart(), items: CART.map(({ ivaRate: _r, ...i }) => i), ivaUsd: 0, ivaBreakdown: undefined, baseUsd: undefined };
        const html = buildTicketHtml(sale, RATE, getPaperConfig('58'), {});
        expect(html).not.toContain('(E)');
        expect(html).not.toContain('EXENTO');
        expect(html).not.toContain('IVA');
    });

    it('venta vieja sin desglose: deduce el % si el IVA es exactamente un % de la base', () => {
        // Ticket #0000006 del cliente: base $8.75, IVA $1.40 = 16%.
        const rows = buildIvaTicketRows({ totalUsd: 10.15, baseUsd: 8.75, ivaUsd: 1.4 }, 897.54);
        expect(rows.map((r) => r.label)).toEqual(['BASE IMPONIBLE 16%', 'IVA 16%']);
        expect(rows.map((r) => r.usd)).toEqual([8.75, 1.4]);
    });

    it('venta vieja con exentos mezclados (el % no cuadra): conserva BASE / IVA', () => {
        // Base 20 (10 exento + 10 gravado), IVA 1.60 → 8% aparente, no exacto como alícuota real
        // pero sí entero: se evita rotular mal exigiendo que el IVA sea exacto con la base completa.
        const rows = buildIvaTicketRows({ totalUsd: 21.6, baseUsd: 20, ivaUsd: 1.6 }, 500);
        expect(rows.map((r) => r.label)).toEqual(['BASE', 'IVA']);
    });
});

describe('ticket compartido por WhatsApp', () => {
    it('lleva (E), el desglose y no la tasa', () => {
        localStorage.setItem('receipt_currency_mode', 'bs');
        const text = decodeURIComponent(buildReceiptWhatsAppUrl(saleFromCart(), RATE));
        expect(text).toContain('Harina PAN 1kg (E)');
        expect(text).toContain('EXENTO (E): Bs 3.132,50');
        expect(text).toContain('BASE IMPONIBLE 16%: Bs 4.743,50');
        expect(text).toContain('IVA 16%: Bs 758,96');
        expect(text).not.toMatch(/Tasa/i);
    });
});

describe('la venta guarda el % por línea y el desglose', () => {
    beforeEach(() => {
        _memoryStore.clear();
        _memoryStore.set('bodega_sales_v1', [{ id: 'ap', tipo: 'APERTURA_CAJA', timestamp: '2026-11-07T08:00:00.000Z', cajaCerrada: false }]);
        _memoryStore.set('bodega_products_v1', CART.map((i) => ({ id: i.id, name: i.name, priceUsdt: i.priceUsd, stock: 50 })));
        localStorage.setItem('tax_config_v1', JSON.stringify(TAX));
    });

    it('processSaleTransaction: ivaRate por producto e ivaBreakdown que cuadra con el total cobrado', async () => {
        const t = FinancialEngine.buildCartTotals(CART, null, RATE, 0, false, ivaOpts());
        const result = await processSaleTransaction({
            cart: CART,
            cartTotalUsd: t.totalUsd, cartTotalBs: t.totalBs, cartSubtotalUsd: t.subtotalUsd,
            cartBaseUsd: t.baseUsd, cartIvaUsd: t.ivaUsd,
            payments: [{ methodId: 'pago_movil', methodLabel: 'Pago Móvil', currency: 'BS', amountBs: t.totalBs, amountUsd: t.totalUsd }],
            changeBreakdown: {}, selectedCustomerId: null, customers: [], products: _memoryStore.get('bodega_products_v1'),
            effectiveRate: RATE, tasaCop: 0, copEnabled: false, discountData: null, useAutoRate: false, granelUnitMode: 'kg_lt',
        });
        expect(result.success).toBe(true);
        const sale = result.sale;
        expect(sale.items.map((i) => i.ivaRate)).toEqual([0, 0, 16, 16]);
        expect(sale.ivaBreakdown).toEqual(t.ivaBreakdown);
        expect(sale.ivaBs).toBe(758.96);
        expect(sale.totalBs).toBe(8634.96);
    });

    it('con IVA apagado la venta no guarda ivaRate ni desglose', async () => {
        localStorage.setItem('tax_config_v1', JSON.stringify({ ivaEnabled: false, ivaRate: 16 }));
        const t = FinancialEngine.buildCartTotals(CART, null, RATE, 0, false, null);
        const result = await processSaleTransaction({
            cart: CART,
            cartTotalUsd: t.totalUsd, cartTotalBs: t.totalBs, cartSubtotalUsd: t.subtotalUsd,
            cartBaseUsd: t.baseUsd, cartIvaUsd: 0,
            payments: [{ methodId: 'efectivo_usd', methodLabel: 'Efectivo', currency: 'USD', amountUsd: t.totalUsd }],
            changeBreakdown: {}, selectedCustomerId: null, customers: [], products: _memoryStore.get('bodega_products_v1'),
            effectiveRate: RATE, tasaCop: 0, copEnabled: false, discountData: null, useAutoRate: false, granelUnitMode: 'kg_lt',
        });
        expect(result.success).toBe(true);
        expect(result.sale.items.every((i) => !('ivaRate' in i))).toBe(true);
        expect(result.sale.ivaBreakdown).toBeUndefined();
    });
});

describe('pantalla de recibo tras cobrar (ReceiptModal)', () => {
    it('venta del cliente: Chocotina exenta con (E) y desglose EXENTO / BASE 16% / IVA 16%', async () => {
        const React = (await import('react')).default;
        const { renderToStaticMarkup } = await import('react-dom/server');
        const { default: ReceiptModal } = await import('../src/components/Sales/ReceiptModal');
        localStorage.setItem('receipt_currency_mode', 'usd');
        const cart = [
            { id: 'coco', name: 'BESITOS DE COCO ARTESANAL', priceUsd: 0.85, qty: 1 },
            { id: 'choco', name: 'CHOCOLATE CHOCOTINA KRON 1 KG', priceUsd: 13, qty: 2, ivaRate: 0 },
        ];
        const sale = saleFromCart(cart);
        const html = renderToStaticMarkup(React.createElement(ReceiptModal, { receipt: sale, onClose: () => {}, currentRate: RATE }));
        expect(html).toContain('CHOCOLATE CHOCOTINA KRON 1 KG (E)');
        expect(html).not.toContain('BESITOS DE COCO ARTESANAL (E)');
        expect(html).toMatch(/EXENTO \(E\)<\/span><span[^>]*>\$26\.00/);
        expect(html).toMatch(/BASE IMPONIBLE 16%<\/span><span[^>]*>\$0\.85/);
        expect(html).toMatch(/IVA 16%<\/span><span[^>]*>\$0\.14/);
        expect(sale.totalUsd).toBe(26.99);
    });
});
