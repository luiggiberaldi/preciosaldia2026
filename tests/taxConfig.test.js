/**
 * tests/taxConfig.test.js — Fase 1 del plan de IVA (src/config/taxConfig.js).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    DEFAULT_TAX_CONFIG,
    IVA_FACTORY_RATE,
    normalizeIvaRate,
    sanitizeTaxConfig,
    resolveLineIvaRate,
    loadTaxConfig,
    saveTaxConfig,
    resetTaxConfig,
} from '../src/config/taxConfig';

describe('valores de fábrica', () => {
    it('IVA de fábrica es 16% y arranca desactivado', () => {
        expect(IVA_FACTORY_RATE).toBe(16);
        expect(DEFAULT_TAX_CONFIG).toEqual({ ivaEnabled: false, ivaRate: 16 });
    });

    it('DEFAULT_TAX_CONFIG está congelado', () => {
        expect(Object.isFrozen(DEFAULT_TAX_CONFIG)).toBe(true);
    });
});

describe('normalizeIvaRate', () => {
    it.each([
        [16, 16],
        ['16', 16],
        ['16,5', 16.5],
        ['  8 ', 8],
        [0, 0],
        [100, 100],
        [12.345, 12.35],
    ])('acepta %p → %p', (input, expected) => {
        expect(normalizeIvaRate(input)).toBe(expected);
    });

    it.each([
        ['vacío', ''],
        ['null', null],
        ['undefined', undefined],
        ['negativo', -1],
        ['mayor a 100', 101],
        ['texto', 'abc'],
        ['NaN', NaN],
        ['Infinity', Infinity],
    ])('rechaza %s', (_label, input) => {
        expect(normalizeIvaRate(input)).toBeNull();
    });
});

describe('sanitizeTaxConfig', () => {
    it('usa la tasa de fábrica si la tasa es inválida', () => {
        expect(sanitizeTaxConfig({ ivaEnabled: true, ivaRate: 'abc' })).toEqual({
            ivaEnabled: true,
            ivaRate: 16,
        });
    });

    it('solo acepta ivaEnabled === true como activo', () => {
        expect(sanitizeTaxConfig({ ivaEnabled: 'true', ivaRate: 16 }).ivaEnabled).toBe(false);
        expect(sanitizeTaxConfig({ ivaEnabled: 1, ivaRate: 16 }).ivaEnabled).toBe(false);
        expect(sanitizeTaxConfig({ ivaEnabled: true, ivaRate: 16 }).ivaEnabled).toBe(true);
    });

    it('maneja entrada nula sin lanzar', () => {
        expect(sanitizeTaxConfig(null)).toEqual({ ivaEnabled: false, ivaRate: 16 });
        expect(sanitizeTaxConfig(undefined)).toEqual({ ivaEnabled: false, ivaRate: 16 });
    });
});

describe('resolveLineIvaRate', () => {
    const on = { ivaEnabled: true, ivaRate: 16 };

    it('IVA desactivado → 0 aunque el producto tenga tasa propia', () => {
        expect(resolveLineIvaRate({ ivaRate: 8 }, { ivaEnabled: false, ivaRate: 16 })).toBe(0);
        expect(resolveLineIvaRate({}, { ivaEnabled: false, ivaRate: 16 })).toBe(0);
    });

    it('producto sin ivaRate usa la tasa general', () => {
        expect(resolveLineIvaRate({}, on)).toBe(16);
        expect(resolveLineIvaRate({ ivaRate: null }, on)).toBe(16);
        expect(resolveLineIvaRate({ ivaRate: '' }, on)).toBe(16);
    });

    it('producto con ivaRate propio tiene prioridad sobre la general', () => {
        expect(resolveLineIvaRate({ ivaRate: 8 }, on)).toBe(8);
    });

    it('producto exento (ivaRate 0) → 0 aunque la general sea 16', () => {
        expect(resolveLineIvaRate({ ivaRate: 0 }, on)).toBe(0);
    });

    it('ivaRate inválido en el producto cae a la tasa general', () => {
        expect(resolveLineIvaRate({ ivaRate: 'abc' }, on)).toBe(16);
        expect(resolveLineIvaRate({ ivaRate: -5 }, on)).toBe(16);
    });

    it('sin configuración explícita usa los valores de fábrica (desactivado)', () => {
        expect(resolveLineIvaRate({ ivaRate: 8 })).toBe(0);
    });
});

describe('persistencia en localStorage', () => {
    beforeEach(() => {
        localStorage.clear();
    });

    it('sin nada guardado devuelve los valores de fábrica', () => {
        expect(loadTaxConfig()).toEqual({ ivaEnabled: false, ivaRate: 16 });
    });

    it('guarda y vuelve a leer la configuración', () => {
        saveTaxConfig({ ivaEnabled: true, ivaRate: 12 });
        expect(loadTaxConfig()).toEqual({ ivaEnabled: true, ivaRate: 12 });
    });

    it('saveTaxConfig sanea antes de guardar', () => {
        const saved = saveTaxConfig({ ivaEnabled: true, ivaRate: 500 });
        expect(saved).toEqual({ ivaEnabled: true, ivaRate: 16 });
        expect(loadTaxConfig()).toEqual({ ivaEnabled: true, ivaRate: 16 });
    });

    it('JSON corrupto en localStorage vuelve a valores de fábrica', () => {
        localStorage.setItem('tax_config_v1', '{no es json');
        expect(loadTaxConfig()).toEqual({ ivaEnabled: false, ivaRate: 16 });
    });

    it('resetTaxConfig restaura 16% y desactivado', () => {
        saveTaxConfig({ ivaEnabled: true, ivaRate: 3 });
        expect(resetTaxConfig()).toEqual({ ivaEnabled: false, ivaRate: 16 });
        expect(loadTaxConfig()).toEqual({ ivaEnabled: false, ivaRate: 16 });
    });
});
