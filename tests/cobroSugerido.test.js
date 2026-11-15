// COBRO fase 5 — «Sugerido»: dólares en billetes enteros + resto en Bs, con los ajustes de Caja & Vuelto.
import { describe, it, expect } from 'vitest';
import { calcularSugerido, leerPrefsVuelto } from '../src/components/Sales/CheckoutModalPOS/parts/changeReparto';

const prefs = (o = {}) => ({ smallestUsdBill: 1, bsRoundStep: 0, bsRoundMode: 'ceil', ...o });

describe('calcularSugerido', () => {
    it('vuelto $3,27 a tasa 40: $3 en billetes + Bs 10,80', () => {
        const s = calcularSugerido({ cambioUsd: 3.27, tasa: 40, prefs: prefs() });
        expect(s.usdPart).toBe(3);
        expect(s.bsPart).toBeCloseTo(10.8, 2);
        expect(s.tipUsd).toBe(0);
    });
    it('la suma cuadra con el vuelto (tasas 700 y 1200)', () => {
        for (const tasa of [40, 700, 1200]) {
            const s = calcularSugerido({ cambioUsd: 6.2, tasa, prefs: prefs() });
            expect(s.usdPart + s.bsPart / tasa).toBeCloseTo(6.2, 2);
        }
    });
    it('vuelto entero: no hay nada que sugerir', () => {
        expect(calcularSugerido({ cambioUsd: 5, tasa: 40, prefs: prefs() })).toBeNull();
    });
    it('billete más pequeño $5 y vuelto $3,27: no hay parte en $, no sugiere (queda «Todo en Bs»)', () => {
        expect(calcularSugerido({ cambioUsd: 3.27, tasa: 40, prefs: prefs({ smallestUsdBill: 5 }) })).toBeNull();
    });
    it('billete $5 y vuelto $7,27: $5 + Bs del resto', () => {
        const s = calcularSugerido({ cambioUsd: 7.27, tasa: 40, prefs: prefs({ smallestUsdBill: 5 }) });
        expect(s.usdPart).toBe(5);
        expect(s.bsPart).toBeCloseTo(90.8, 2);
    });
    it('efectivo en dólares en gaveta insuficiente recorta la parte en $', () => {
        const s = calcularSugerido({ cambioUsd: 6.27, tasa: 40, floatUsd: 2, prefs: prefs() });
        expect(s.usdPart).toBe(2);
        expect(s.usdPart + s.bsPart / 40).toBeCloseTo(6.27, 2);
    });
    it('redondeo «a favor de la tienda»: el Bs baja y la diferencia queda en caja', () => {
        const s = calcularSugerido({ cambioUsd: 3.27, tasa: 40, prefs: prefs({ bsRoundStep: 5, bsRoundMode: 'floor' }) });
        expect(s.usdPart).toBe(3);
        expect(s.bsPart).toBe(10);
        expect(s.tipUsd).toBeCloseTo(0.02, 2);
        expect(s.usdPart + s.bsPart / 40 + s.tipUsd).toBeCloseTo(3.27, 2);
    });
    it('«a favor del cliente» no redondea hacia arriba (no se podría anotar en la venta)', () => {
        const s = calcularSugerido({ cambioUsd: 3.27, tasa: 40, prefs: prefs({ bsRoundStep: 5, bsRoundMode: 'ceil' }) });
        expect(s.bsPart).toBeCloseTo(10.8, 2);
    });
    it('sin tasa válida no sugiere', () => {
        expect(calcularSugerido({ cambioUsd: 3.27, tasa: 0, prefs: prefs() })).toBeNull();
    });
});

describe('leerPrefsVuelto', () => {
    const fake = (m) => ({ getItem: (k) => (k in m ? m[k] : null) });
    it('valores por defecto', () => {
        expect(leerPrefsVuelto(fake({}))).toEqual({ smallestUsdBill: 1, bsRoundStep: 0, bsRoundMode: 'ceil' });
    });
    it('valores guardados y protección contra basura', () => {
        expect(leerPrefsVuelto(fake({ checkout_smallest_usd_bill: '5', checkout_bs_round_step: '10', checkout_bs_round_mode: 'floor' })))
            .toEqual({ smallestUsdBill: 5, bsRoundStep: 10, bsRoundMode: 'floor' });
        expect(leerPrefsVuelto(fake({ checkout_smallest_usd_bill: '-3', checkout_bs_round_step: 'x' })))
            .toEqual({ smallestUsdBill: 1, bsRoundStep: 0, bsRoundMode: 'ceil' });
    });
});
