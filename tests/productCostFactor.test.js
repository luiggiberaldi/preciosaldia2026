import { describe, expect, it } from 'vitest';
import { prepareProductFormState } from '../src/hooks/useProductForm.js';
import { actualCostFactor, buildProductPayload, derivePricingFromEdit, roundDerivedPrice, normalizePriceUsd, formatPriceUsdInput, resolveCostFactor } from '../src/utils/productProcessor.js';
import { FinancialEngine } from '../src/core/FinancialEngine.js';
import {
    costFactorFromMarginPercent,
    formatCostFactorAsMarginPercent,
    marginOverPricePercent,
} from '../src/utils/productCostFactor.js';

const payloadFor = (formData) => buildProductPayload({
    name: 'Producto prueba',
    priceUsd: '10.00',
    costUsd: '7.00',
    ...formData,
}, 40);

describe('factor costo de producto', () => {
    it('converts between margin percentage and cost factor', () => {
        expect(costFactorFromMarginPercent('30')).toBe('0.7');
        expect(formatCostFactorAsMarginPercent('0.7')).toBe('30');
        expect(formatCostFactorAsMarginPercent('0.655')).toBe('34.5');
        expect(costFactorFromMarginPercent('')).toBe('');
        expect(formatCostFactorAsMarginPercent('0')).toBe('');
        expect(formatCostFactorAsMarginPercent('1')).toBe('0');
    });

    it('al abrir un producto con costo y precio muestra el factor REAL, no uno guardado desfasado', () => {
        const stale = prepareProductFormState({ id: 'p1', name: 'Producto', priceUsd: 10, costUsd: 7, costFactor: 0.65 }, 40);
        const legacy = prepareProductFormState({ id: 'p2', name: 'Producto', priceUsd: 10, costUsd: 7 }, 40);
        const noCost = prepareProductFormState({ id: 'p3', name: 'Sin costo', priceUsd: 10, costFactor: 0.6 }, 40);
        expect(stale.costFactor).toBe('0.700');
        expect(legacy.costFactor).toBe('0.700');
        expect(noCost.costFactor).toBe('0.6');
        expect(prepareProductFormState({ id: 'p4', name: 'Sin costo', priceUsd: 10 }, 40).costFactor).toBe('0');
    });

    it('al guardar con costo y precio persiste el factor real; sin uno de los dos, el escrito', () => {
        expect(payloadFor({ costFactor: '0.650' }).costFactor).toBe(0.7);
        expect(payloadFor({ costFactor: '' }).costFactor).toBe(0.7);
        expect(payloadFor({ costUsd: '', costFactor: '0.6' }).costFactor).toBe(0.6);
        expect(payloadFor({ costUsd: '', costFactor: '' }).costFactor).toBeNull();
        expect(Object.hasOwn(payloadFor({}), 'costFactor')).toBe(false);
    });

    it('actualCostFactor redondea a 3 decimales y exige costo y precio', () => {
        expect(actualCostFactor(0.6, 1)).toBe(0.6);
        expect(actualCostFactor(2, 3)).toBe(0.667);
        expect(actualCostFactor(0, 1)).toBeNull();
        expect(actualCostFactor(1, 0)).toBeNull();
    });
});

// Simula el formulario: cada edición aplica la regla y redondea como la UI
// (precio y costo a 2 decimales, factor a 3). Sin estado entre ediciones.
const editSequence = (start, edits) => {
    const s = { ...start };
    for (const [field, value] of edits) {
        s[field] = value;
        const r = derivePricingFromEdit(field, s);
        if (r.field) s[r.field] = Number(r.value.toFixed(r.field === 'factor' ? 3 : 2));
    }
    return s;
};
const CAPI = { cost: 0.6, price: 1, factor: 0.6 }; // Cigarro Capi: 0.60 / 1.00 / 40%
const EMPTY = { cost: 0, price: 0, factor: 0 };

describe('regla costo fijo (auditoría 2026-10-28, casos A–L)', () => {
    it('A/J: cambiar el margen recalcula el precio y nunca el costo', () => {
        expect(editSequence(CAPI, [['factor', 0.5]])).toEqual({ cost: 0.6, price: 1.2, factor: 0.5 });
    });

    it('B/K: cambiar el precio recalcula el margen y nunca el costo', () => {
        expect(editSequence(CAPI, [['price', 1.2]])).toEqual({ cost: 0.6, price: 1.2, factor: 0.5 });
    });

    it('C/L: cambiar el costo mantiene el margen y recalcula el precio', () => {
        expect(editSequence(CAPI, [['cost', 0.7]])).toEqual({ cost: 0.7, price: 1.17, factor: 0.6 });
    });

    it('D: producto sin margen guardado → poner margen recalcula el precio', () => {
        expect(editSequence({ cost: 0.6, price: 1, factor: 0 }, [['factor', 0.5]]))
            .toEqual({ cost: 0.6, price: 1.2, factor: 0.5 });
    });

    it('E: producto nuevo, costo + margen → precio', () => {
        expect(editSequence(EMPTY, [['cost', 0.6], ['factor', 0.6]])).toEqual({ cost: 0.6, price: 1, factor: 0.6 });
    });

    it('F: producto nuevo, costo + precio → margen', () => {
        expect(editSequence(EMPTY, [['cost', 0.6], ['price', 1]])).toEqual({ cost: 0.6, price: 1, factor: 0.6 });
    });

    it('G/H/I: el orden de edición ya no cambia el resultado: el costo se respeta', () => {
        expect(editSequence(EMPTY, [['cost', 0.6], ['factor', 0.6], ['factor', 0.7]]).cost).toBe(0.6);
        expect(editSequence(EMPTY, [['cost', 0.6], ['price', 1], ['factor', 0.7]]))
            .toEqual({ cost: 0.6, price: 0.86, factor: 0.7 });
        expect(editSequence(EMPTY, [['cost', 0.6], ['factor', 0.6], ['price', 1.2], ['factor', 0.7]]))
            .toEqual({ cost: 0.6, price: 0.86, factor: 0.7 });
    });

    it('sin costo cargado, precio + margen sí derivan el costo (no hay nada que proteger)', () => {
        expect(editSequence(EMPTY, [['price', 1], ['factor', 0.6]])).toEqual({ cost: 0.6, price: 1, factor: 0.6 });
        expect(editSequence({ cost: 0, price: 0, factor: 0.6 }, [['price', 1]])).toEqual({ cost: 0.6, price: 1, factor: 0.6 });
    });

    it('valores vacíos o cero no derivan nada', () => {
        expect(derivePricingFromEdit('factor', { cost: 0.6, price: 1, factor: 0 })).toEqual({ field: null, value: null });
        expect(derivePricingFromEdit('price', { cost: 0, price: 1, factor: 0 })).toEqual({ field: null, value: null });
        expect(derivePricingFromEdit('cost', { cost: 0.6, price: 0, factor: 0 })).toEqual({ field: null, value: null });
    });
});

describe('margen sobre el precio de venta', () => {
    it('usa el mismo criterio que el formulario (ganancia / precio)', () => {
        // Costo $0.60 con precio $1.00 = 40% de margen (no el +67% de markup sobre costo).
        expect(marginOverPricePercent(1, 0.6)).toBeCloseTo(40, 6);
        expect(marginOverPricePercent(1.2, 0.9)).toBeCloseTo(25, 6);
    });

    it('marca pérdidas cuando el costo supera al precio', () => {
        expect(marginOverPricePercent(1, 1.5)).toBeCloseTo(-50, 6);
    });

    it('devuelve null sin precio o sin costo (insignia oculta)', () => {
        expect(marginOverPricePercent(1, 0)).toBeNull();
        expect(marginOverPricePercent(0, 0.6)).toBeNull();
        expect(marginOverPricePercent(undefined, 0.6)).toBeNull();
        expect(marginOverPricePercent(1, null)).toBeNull();
        expect(marginOverPricePercent('', '')).toBeNull();
    });
});

describe('precio con decimales extra: el margen elegido se mantiene', () => {
  it('normalizePriceUsd: 6 decimales bajo $0.10, 4 desde ahí, y no toca precios a centavos', () => {
    expect(normalizePriceUsd(0.0571428)).toBe(0.057143);
    expect(normalizePriceUsd(1.428571)).toBe(1.4286);
    expect(normalizePriceUsd(1.43)).toBe(1.43);
    expect(normalizePriceUsd(0)).toBe(0);
    expect(normalizePriceUsd('abc')).toBe(0);
  });

  it('formatPriceUsdInput: 2 decimales si alcanzan, los exactos si no', () => {
    expect(formatPriceUsdInput(0.0571428)).toBe('0.057143');
    expect(formatPriceUsdInput(0.06)).toBe('0.06');
    expect(formatPriceUsdInput(1.4)).toBe('1.40');
    expect(formatPriceUsdInput(1.428571)).toBe('1.4286');
    expect(formatPriceUsdInput(0)).toBe('');
  });

  it('caso reportado: costo $0.04 al 30% → $0.057143, ficha 30% y tarjeta +30%', () => {
    const { value } = derivePricingFromEdit('factor', { cost: 0.04, price: 0, factor: 0.7 });
    const { price, factor } = roundDerivedPrice(value, 0.04, 0.7);
    expect(price).toBe(0.057143);
    expect(formatCostFactorAsMarginPercent(factor)).toBe('30');
    expect(Math.round(marginOverPricePercent(price, 0.04))).toBe(30);
  });

  it('si el precio real se aleja del factor elegido, se muestra el factor real', () => {
    // El usuario escribe $0.06 a mano con costo $0.04: el factor real (0.667) manda.
    expect(resolveCostFactor(0.04, 0.06, 0.7)).toBe(0.667);
  });

  it('un precio que redondea a cero conserva el valor y no inventa factor', () => {
    expect(roundDerivedPrice(0.0000004, 0.0000003, 0.7)).toEqual({ price: 0.0000004, factor: null });
  });

  it('el cobro por línea se redondea a centavos: 1 unidad $0.06, 100 unidades $5.71', () => {
    const line = (qty) => ({ id: 'p1', name: 'Sal', qty, priceUsd: 0.057143, costUsd: 0.04, _mode: 'unit' });
    expect(FinancialEngine.buildCartTotals([line(1)], null, 40, 0, false, null).totalUsd).toBe(0.06);
    expect(FinancialEngine.buildCartTotals([line(100)], null, 40, 0, false, null).totalUsd).toBe(5.71);
  });

  // Matriz: precios bajos y altos × márgenes. Flujo completo de la ficha → guardado → tarjeta → reabrir.
  const COSTS = [0.01, 0.02, 0.03, 0.04, 0.07, 0.09, 0.13, 0.2, 0.33, 0.5, 0.75, 0.99, 1, 1.37, 2.5, 3.33, 7.89, 12, 45.5, 99.99, 250, 999.99];
  const MARGINS = [1, 5, 10, 12.5, 15, 20, 25, 30, 33, 35, 40, 45, 50, 60, 66, 75, 80, 90];

  it.each(COSTS)('costo $%s: el margen elegido se mantiene en ficha, guardado, tarjeta y al reabrir', (cost) => {
    for (const margin of MARGINS) {
      const typedFactor = Number(costFactorFromMarginPercent(margin));
      const { value } = derivePricingFromEdit('factor', { cost, price: 0, factor: typedFactor });
      const { price, factor: shownFactor } = roundDerivedPrice(value, cost, typedFactor);
      const where = `costo ${cost}, margen ${margin}%`;

      // 1) Ficha: al salir del campo sigue el % escrito.
      expect(formatCostFactorAsMarginPercent(shownFactor), where).toBe(String(margin));

      // 2) Guardado.
      const saved = payloadFor({ priceUsd: formatPriceUsdInput(price), costUsd: String(cost), costFactor: String(shownFactor) });
      expect(saved.priceUsd, where).toBe(price);
      expect(formatCostFactorAsMarginPercent(saved.costFactor), where).toBe(String(margin));

      // 3) Margen real del precio guardado: a menos de 0.05 puntos del elegido.
      const real = marginOverPricePercent(saved.priceUsd, saved.costUsd);
      expect(Math.abs(real - margin), where).toBeLessThanOrEqual(0.05);

      // 4) Tarjeta (+N%, sin decimales): a medio punto del elegido (12.5% puede verse 12 o 13).
      expect(Math.abs(Number(real.toFixed(0)) - margin), where).toBeLessThanOrEqual(0.5 + 1e-9);

      // 5) Reabrir la ficha: mismo %.
      const reopened = prepareProductFormState({ ...saved, id: 'x' }, 40);
      expect(formatCostFactorAsMarginPercent(reopened.costFactor), where).toBe(String(margin));
    }
  });
});
