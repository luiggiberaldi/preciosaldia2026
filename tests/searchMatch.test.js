import { describe, it, expect } from 'vitest';
import { normalizeSearchText, matchesSearch, productMatchesSearch } from '../src/utils/searchMatch';

describe('searchMatch utility', () => {
    describe('normalizeSearchText', () => {
        it('removes accents, lowercases and collapses spaces', () => {
            expect(normalizeSearchText('  Café   AU  Lait ')).toBe('cafe au lait');
        });

        it('returns empty string for null/undefined', () => {
            expect(normalizeSearchText(null)).toBe('');
            expect(normalizeSearchText(undefined)).toBe('');
        });
    });

    describe('matchesSearch', () => {
        it('matches everything for an empty query', () => {
            expect(matchesSearch(['Arroz'], '')).toBe(true);
            expect(matchesSearch(['Arroz'], '   ')).toBe(true);
        });

        it('ignores case and accents', () => {
            expect(matchesSearch(['Azúcar Refinada'], 'AZUCAR')).toBe(true);
            expect(matchesSearch(['azucar'], 'azúcar')).toBe(true);
        });

        it('requires every word to match, in any order', () => {
            expect(matchesSearch(['Harina PAN 1kg'], 'pan harina')).toBe(true);
            expect(matchesSearch(['Harina PAN 1kg'], 'pan maiz')).toBe(false);
        });

        it('searches across several fields', () => {
            expect(matchesSearch(['Juan Pérez', '0412-5551234'], 'perez 5551234')).toBe(true);
            expect(matchesSearch([null, undefined, '123'], '123')).toBe(true);
        });

        it('does not match when no field contains the term', () => {
            expect(matchesSearch(['Arroz'], 'harina')).toBe(false);
        });
    });

    describe('productMatchesSearch (matching unificado caja: desplegable + grid)', () => {
        const mayonesa = {
            id: 'p_001',
            name: 'Mayonesa Kraft 445GR',
            barcode: '7591114040042',
        };

        it('coincide por nombre, código de barras e id', () => {
            expect(productMatchesSearch(mayonesa, 'kraft')).toBe(true);
            expect(productMatchesSearch(mayonesa, '759111')).toBe(true);
            expect(productMatchesSearch(mayonesa, 'P_001')).toBe(true);
        });

        it('ignora tildes y mayúsculas igual que el desplegable', () => {
            expect(productMatchesSearch({ ...mayonesa, name: 'Azúcar Refinada' }, 'AZUCAR')).toBe(true);
        });

        it('cada palabra de la consulta debe coincidir', () => {
            expect(productMatchesSearch(mayonesa, 'kraft 445')).toBe(true);
            expect(productMatchesSearch(mayonesa, 'kraft hellmanns')).toBe(false);
        });

        it('campos ausentes no rompen el matching', () => {
            expect(productMatchesSearch({ id: 'x' }, '')).toBe(true);
            expect(productMatchesSearch({ id: 'x', name: 'Arroz' }, 'arroz')).toBe(true);
            expect(productMatchesSearch({}, 'undefined')).toBe(false);
        });
    });
});
