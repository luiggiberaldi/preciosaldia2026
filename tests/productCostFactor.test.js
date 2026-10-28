import { describe, expect, it } from 'vitest';
import { prepareProductFormState } from '../src/hooks/useProductForm.js';
import { actualCostFactor, buildProductPayload, derivePricingFromEdit } from '../src/utils/productProcessor.js';
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
