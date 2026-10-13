import { describe, expect, it } from 'vitest';
import { prepareProductFormState } from '../src/hooks/useProductForm.js';
import { buildProductPayload, deriveCostFactorUpdate } from '../src/utils/productProcessor.js';
import {
    costFactorFromMarginPercent,
    formatCostFactorAsMarginPercent,
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

    it('derives cost factor from the last-edited cost and price', () => {
        const result = deriveCostFactorUpdate(['cost'], 'price', { cost: 7, price: 10, factor: 0 });
        expect(result).toEqual({ editOrder: ['cost', 'price'], field: 'factor', value: 0.7 });
    });

    it('derives price from cost and factor', () => {
        const result = deriveCostFactorUpdate(['cost'], 'factor', { cost: 5, price: 3, factor: 0.5 });
        expect(result).toEqual({ editOrder: ['cost', 'factor'], field: 'price', value: 10 });
    });

    it('derives cost from price and factor', () => {
        const result = deriveCostFactorUpdate(['price'], 'factor', { cost: 4, price: 10, factor: 0.4 });
        expect(result).toEqual({ editOrder: ['price', 'factor'], field: 'cost', value: 4 });
    });

    it('does not let zero or empty values contaminate the edit order', () => {
        const afterClearing = ['cost', 'factor'].filter(field => field !== 'factor');
        const result = deriveCostFactorUpdate(afterClearing, 'price', { cost: 5, price: 3.02, factor: 0 });
        expect(result.field).toBe('factor');
        expect(result.value).toBeCloseTo(1.655629, 5);
    });

    it('loads stored factors and derives one for legacy products', () => {
        const saved = prepareProductFormState({ id: 'p1', name: 'Producto', priceUsd: 10, costUsd: 7, costFactor: 0.65 }, 40);
        const legacy = prepareProductFormState({ id: 'p2', name: 'Producto', priceUsd: 10, costUsd: 7 }, 40);
        expect(saved.costFactor).toBe('0.65');
        expect(legacy.costFactor).toBe('0.700');
        expect(prepareProductFormState({ id: 'p3', name: 'Sin costo', priceUsd: 10 }, 40).costFactor).toBe('0');
    });

    it('persists numeric factors (including zero) and leaves remote callers without a factor field unchanged', () => {
        expect(payloadFor({ costFactor: '0.700' }).costFactor).toBe(0.7);
        expect(payloadFor({ costFactor: '0' }).costFactor).toBe(0);
        expect(payloadFor({ costFactor: '' }).costFactor).toBeNull();
        expect(Object.hasOwn(payloadFor({}), 'costFactor')).toBe(false);
    });
});
