// El stock a granel se guarda en kg (sólidos) o L (líquidos): su rótulo nunca
// sale de la presentación del producto («gramo», «ml»). Antes «4.6» kg se leía
// «4.6 g» en el supervisor y en Productos.
import { describe, expect, it } from 'vitest';
import { granelStockUnitLabel, granelUnitLabel } from '../src/utils/granel.js';

describe('granelStockUnitLabel', () => {
    it.each([
        [{ packagingType: 'granel', unit: 'gramo', granelUnit: undefined }, 'kg'],
        [{ packagingType: 'granel', unit: 'gramo', granelUnit: 'kg' }, 'kg'],
        [{ packagingType: 'granel', unit: 'kg' }, 'kg'],
        [{ packagingType: 'granel', unit: 'ml' }, 'L'],
        [{ packagingType: 'granel', unit: 'lt', granelUnit: 'lt' }, 'L'],
        [{ packagingType: 'granel', unit: 'litro' }, 'L'],
    ])('%o → %s', (product, expected) => {
        expect(granelStockUnitLabel(product)).toBe(expected);
    });

    it('granelUnitLabel sigue describiendo la presentación (no el stock)', () => {
        expect(granelUnitLabel({ unit: 'gramo' })).toBe('g');
    });
});
