/**
 * tests/ivaTotals.test.js — Fase 2 del plan de IVA (FinancialEngine.buildCartTotals con ivaOpts).
 *
 * Contrato: sin ivaOpts.enabled los totales son idénticos a antes.
 * Con IVA: el IVA se calcula sobre la base descontada, por línea, y se suma al total.
 */

import { describe, it, expect } from 'vitest';
import { FinancialEngine } from '../src/core/FinancialEngine';
import { resolveLineIvaRate } from '../src/config/taxConfig';

const RATE_BCV = 500;
const RATE_COP = 4000;

const ivaOn = (rate = 16) => ({ enabled: true, rate });
const ivaFromConfig = (config) => ({
    enabled: config.ivaEnabled,
    resolveRate: (item) => resolveLineIvaRate(item, config),
});

describe('sin IVA (contrato existente)', () => {
    const cart = [{ priceUsd: 10, qty: 1 }];

    it('ivaOpts ausente o enabled=false → total igual al subtotal, IVA 0', () => {
        const base = FinancialEngine.buildCartTotals(cart, null, RATE_BCV, RATE_COP);
        const off = FinancialEngine.buildCartTotals(cart, null, RATE_BCV, RATE_COP, false, { enabled: false, rate: 16 });
        expect(off).toEqual(base);
        expect(off.ivaUsd).toBe(0);
        expect(off.totalUsd).toBe(10);
    });

    it('expone baseUsd igual a totalUsd cuando no hay IVA', () => {
        const t = FinancialEngine.buildCartTotals(cart, null, RATE_BCV, RATE_COP);
        expect(t.baseUsd).toBe(10);
        expect(t.ivaUsd).toBe(0);
    });
});

describe('IVA general 16% (fórmula base)', () => {
    it('10 USD con IVA 16% → IVA 1.60, total 11.60', () => {
        const t = FinancialEngine.buildCartTotals([{ priceUsd: 10, qty: 1 }], null, RATE_BCV, 0, false, ivaOn(16));
        expect(t.baseUsd).toBe(10);
        expect(t.ivaUsd).toBe(1.6);
        expect(t.totalUsd).toBe(11.6);
    });

    it('tasa 0% → total igual a la base', () => {
        const t = FinancialEngine.buildCartTotals([{ priceUsd: 10, qty: 1 }], null, RATE_BCV, 0, false, ivaOn(0));
        expect(t.ivaUsd).toBe(0);
        expect(t.totalUsd).toBe(10);
    });

    it('IVA se calcula sobre el subtotal de varias líneas', () => {
        const cart = [
            { priceUsd: 10, qty: 2 },   // 20
            { priceUsd: 5.5, qty: 1 },  // 5.5
        ];
        const t = FinancialEngine.buildCartTotals(cart, null, RATE_BCV, 0, false, ivaOn(16));
        expect(t.baseUsd).toBe(25.5);
        expect(t.ivaUsd).toBe(4.08);
        expect(t.totalUsd).toBe(29.58);
    });
});

describe('descuento se aplica antes del IVA', () => {
    it('10 USD con 10% de descuento e IVA 16% → base 9.00, IVA 1.44, total 10.44', () => {
        const t = FinancialEngine.buildCartTotals(
            [{ priceUsd: 10, qty: 1 }],
            { type: 'percentage', value: 10 },
            RATE_BCV, 0, false, ivaOn(16)
        );
        expect(t.discountAmountUsd).toBe(1);
        expect(t.baseUsd).toBe(9);
        expect(t.ivaUsd).toBe(1.44);
        expect(t.totalUsd).toBe(10.44);
    });

    it('descuento fijo: el IVA sale de la base descontada, no del subtotal', () => {
        const t = FinancialEngine.buildCartTotals(
            [{ priceUsd: 10, qty: 1 }],
            { type: 'fixed', value: 4 },
            RATE_BCV, 0, false, ivaOn(16)
        );
        expect(t.baseUsd).toBe(6);
        expect(t.ivaUsd).toBe(0.96);
        expect(t.totalUsd).toBe(6.96);
    });
});

describe('productos exentos y tasas por producto', () => {
    it('producto exento (ivaRate 0) no paga IVA aunque la general sea 16%', () => {
        const config = { ivaEnabled: true, ivaRate: 16 };
        const cart = [
            { priceUsd: 10, qty: 1 },                 // general 16% → 1.60
            { priceUsd: 10, qty: 1, ivaRate: 0 },     // exento → 0
        ];
        const t = FinancialEngine.buildCartTotals(cart, null, RATE_BCV, 0, false, ivaFromConfig(config));
        expect(t.baseUsd).toBe(20);
        expect(t.ivaUsd).toBe(1.6);
        expect(t.totalUsd).toBe(21.6);
    });

    it('producto con tasa reducida 8% usa su propia tasa', () => {
        const config = { ivaEnabled: true, ivaRate: 16 };
        const cart = [{ priceUsd: 10, qty: 1, ivaRate: 8 }];
        const t = FinancialEngine.buildCartTotals(cart, null, RATE_BCV, 0, false, ivaFromConfig(config));
        expect(t.ivaUsd).toBe(0.8);
        expect(t.totalUsd).toBe(10.8);
    });
});

describe('equivalentes en Bs y COP', () => {
    it('totalBs incluye el IVA convertido con la tasa de la venta', () => {
        // base 10 USD → 5000 Bs; IVA 1.60 USD → 800 Bs; total 5800 Bs
        const t = FinancialEngine.buildCartTotals([{ priceUsd: 10, qty: 1 }], null, RATE_BCV, 0, false, ivaOn(16));
        expect(t.totalBs).toBe(5800);
    });

    it('totalCop con priceCop lleva el mismo factor de IVA que el USD', () => {
        // base 10 USD = 40000 COP; con IVA 16% → 46400 COP
        const cart = [{ priceUsd: 10, qty: 1, priceCop: 40000 }];
        const t = FinancialEngine.buildCartTotals(cart, null, RATE_BCV, RATE_COP, false, ivaOn(16));
        expect(t.totalCop).toBe(46400);
    });

    it('totalCop sin priceCop usa totalUsd con IVA × tasa COP', () => {
        const t = FinancialEngine.buildCartTotals([{ priceUsd: 10, qty: 1 }], null, RATE_BCV, RATE_COP, false, ivaOn(16));
        expect(t.totalCop).toBe(46400);
    });
});

describe('pago en Bs con modo dual_usd', () => {
    it('el IVA se calcula sobre priceBsUsdRef cuando el pago es en Bs', () => {
        const cart = [{ priceUsd: 10, qty: 1, pricingMode: 'dual_usd', priceBsUsdRef: 8 }];
        const t = FinancialEngine.buildCartTotals(cart, null, RATE_BCV, 0, true, ivaOn(16));
        expect(t.baseUsd).toBe(8);
        expect(t.ivaUsd).toBe(1.28);
        expect(t.totalUsd).toBe(9.28);
    });
});

describe('redondeo', () => {
    it('IVA sobre base con decimales se redondea a 2 decimales', () => {
        const t = FinancialEngine.buildCartTotals([{ priceUsd: 3.33, qty: 1 }], null, RATE_BCV, 0, false, ivaOn(16));
        expect(t.ivaUsd).toBe(0.53);
        expect(t.totalUsd).toBe(3.86);
    });
});
