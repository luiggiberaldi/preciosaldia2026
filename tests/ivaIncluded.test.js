/**
 * tests/ivaIncluded.test.js — Modo "Mis precios ya incluyen IVA".
 *
 * Contrato:
 * - El total cobrado no cambia: el IVA se saca del precio (base = precio / (1 + %)).
 * - El descuento se aplica sobre el precio con IVA y luego se desglosa.
 * - Exento + base + IVA = total, en USD y en Bs.
 * - La ganancia de una venta marcada `ivaIncluido` resta su IVA; las demás no cambian.
 * - El avance de efectivo siempre es exento.
 */

import { describe, it, expect } from 'vitest';
import { FinancialEngine } from '../src/core/FinancialEngine';
import { resolveLineIvaRate, sanitizeTaxConfig, getCartIvaOpts } from '../src/config/taxConfig';
import { round2 } from '../src/utils/dinero';

const RATE = 500;
const included = (rate = 16) => getCartIvaOpts({ ivaEnabled: true, ivaRate: rate, ivaIncluded: true });
const added = (rate = 16) => getCartIvaOpts({ ivaEnabled: true, ivaRate: rate, ivaIncluded: false });

const sumsUp = (t) => {
    const b = t.ivaBreakdown;
    const usd = round2(b.exemptUsd + b.groups.reduce((s, g) => s + g.baseUsd + g.ivaUsd, 0));
    const bs = round2(b.exemptBs + b.groups.reduce((s, g) => s + g.baseBs + g.ivaBs, 0));
    expect(usd).toBe(t.totalUsd);
    expect(bs).toBe(t.totalBs);
};

describe('configuración', () => {
    it('ivaIncluded arranca en false y se conserva al sanear', () => {
        expect(sanitizeTaxConfig({}).ivaIncluded).toBe(false);
        expect(sanitizeTaxConfig({ ivaIncluded: true }).ivaIncluded).toBe(true);
        expect(sanitizeTaxConfig({ ivaIncluded: 'si' }).ivaIncluded).toBe(false);
    });

    it('included solo aplica con el IVA activo', () => {
        expect(getCartIvaOpts({ ivaEnabled: false, ivaRate: 16, ivaIncluded: true }).included).toBe(false);
        expect(included().included).toBe(true);
    });

    it('el avance de efectivo siempre es exento', () => {
        const cfg = { ivaEnabled: true, ivaRate: 16 };
        expect(resolveLineIvaRate({ isCashAdvance: true }, cfg)).toBe(0);
        expect(resolveLineIvaRate({ isCashAdvance: true, ivaRate: 16 }, cfg)).toBe(0);
        expect(resolveLineIvaRate({ priceUsd: 1 }, cfg)).toBe(16);
    });
});

describe('IVA incluido en el carrito', () => {
    it('$11,60 → total $11,60, base $10,00, IVA $1,60', () => {
        const t = FinancialEngine.buildCartTotals([{ priceUsd: 11.6, qty: 1 }], null, RATE, 0, false, included());
        expect(t.totalUsd).toBe(11.6);
        expect(t.totalBs).toBe(5800);
        expect(t.baseUsd).toBe(10);
        expect(t.ivaUsd).toBe(1.6);
        expect(t.ivaBs).toBe(800);
        expect(t.ivaIncluded).toBe(true);
        sumsUp(t);
    });

    it('el total es igual al de sin IVA', () => {
        const cart = [{ priceUsd: 3.33, qty: 3 }, { priceUsd: 1.99, qty: 2, ivaRate: 8 }];
        const off = FinancialEngine.buildCartTotals(cart, null, RATE, 0, false, null);
        const on = FinancialEngine.buildCartTotals(cart, null, RATE, 0, false, included());
        expect(on.totalUsd).toBe(off.totalUsd);
        expect(on.totalBs).toBe(off.totalBs);
        sumsUp(on);
    });

    it('modo añadido sigue igual: $10 + 16% = $11,60', () => {
        const t = FinancialEngine.buildCartTotals([{ priceUsd: 10, qty: 1 }], null, RATE, 0, false, added());
        expect(t.totalUsd).toBe(11.6);
        expect(t.baseUsd).toBe(10);
        expect(t.ivaUsd).toBe(1.6);
        expect(t.ivaIncluded).toBe(false);
    });

    it('descuento 10% sobre $11,60 → cobra $10,44 = base $9,00 + IVA $1,44', () => {
        const t = FinancialEngine.buildCartTotals(
            [{ priceUsd: 11.6, qty: 1 }], { type: 'percentage', value: 10 }, RATE, 0, false, included());
        expect(t.discountAmountUsd).toBe(1.16);
        expect(t.totalUsd).toBe(10.44);
        expect(t.baseUsd).toBe(9);
        expect(t.ivaUsd).toBe(1.44);
        sumsUp(t);
    });

    it('descuento fijo se reparte entre exento y gravado', () => {
        const cart = [{ priceUsd: 11.6, qty: 1 }, { priceUsd: 5, qty: 1, ivaRate: 0 }];
        const t = FinancialEngine.buildCartTotals(cart, { type: 'fixed', value: 1.66 }, RATE, 0, false, included());
        expect(t.totalUsd).toBe(14.94);
        expect(t.ivaBreakdown.exemptUsd).toBeGreaterThan(0);
        expect(t.ivaBreakdown.exemptUsd).toBeLessThan(5);
        sumsUp(t);
    });

    it('carrito mixto con avance de efectivo: el avance no lleva IVA', () => {
        const cfg = { ivaEnabled: true, ivaRate: 16, ivaIncluded: true };
        const cart = [
            { priceUsd: 11.6, qty: 1 },
            { priceUsd: 20, qty: 1, isCashAdvance: true },
        ];
        const t = FinancialEngine.buildCartTotals(cart, null, RATE, 0, false, getCartIvaOpts(cfg));
        expect(t.totalUsd).toBe(31.6);
        expect(t.ivaUsd).toBe(1.6);
        expect(t.ivaBreakdown.exemptUsd).toBe(20);
        sumsUp(t);
    });

    it('pago en Bs con doble precio cuadra en ambas monedas', () => {
        const cart = [{ priceUsd: 11.6, priceBsUsdRef: 12.76, pricingMode: 'dual_usd', qty: 2 }];
        const t = FinancialEngine.buildCartTotals(cart, null, RATE, 0, true, included());
        expect(t.totalUsd).toBe(25.52);
        sumsUp(t);
    });

    it('COP no se infla con IVA incluido', () => {
        const cart = [{ priceUsd: 11.6, qty: 1, priceCop: 46400 }];
        const off = FinancialEngine.buildCartTotals(cart, null, RATE, 4000, false, null);
        const on = FinancialEngine.buildCartTotals(cart, null, RATE, 4000, false, included());
        expect(on.totalCop).toBe(off.totalCop);
    });
});

describe('ganancia', () => {
    const baseSale = {
        tipo: 'VENTA', rate: RATE,
        items: [{ id: 'a', priceUsd: 11.6, qty: 1, costUsd: 6 }],
        discountAmountUsd: 0, ivaUsd: 1.6, ivaBs: 800,
    };

    it('venta con IVA incluido: ganancia = precio sin IVA − costo', () => {
        const profitBs = FinancialEngine.calculateSaleProfit({ ...baseSale, ivaIncluido: true }, RATE, []);
        expect(profitBs).toBe(2000); // ($10,00 − $6,00) × 500
    });

    it('con descuento: $10,44 cobrado − $1,44 IVA − $6 costo = $3,00', () => {
        const sale = { ...baseSale, ivaIncluido: true, discountAmountUsd: 1.16, ivaUsd: 1.44, ivaBs: 720 };
        expect(FinancialEngine.calculateSaleProfit(sale, RATE, [])).toBe(1500);
    });

    it('sin ivaBs usa ivaUsd × tasa', () => {
        const { ivaBs: _omit, ...sale } = { ...baseSale, ivaIncluido: true };
        expect(FinancialEngine.calculateSaleProfit(sale, RATE, [])).toBe(2000);
    });

    it('ventas viejas o con IVA añadido no cambian', () => {
        expect(FinancialEngine.calculateSaleProfit(baseSale, RATE, [])).toBe(2800); // (11,60 − 6) × 500
        const addedSale = { ...baseSale, items: [{ id: 'a', priceUsd: 10, qty: 1, costUsd: 6 }] };
        expect(FinancialEngine.calculateSaleProfit(addedSale, RATE, [])).toBe(2000);
    });
});
