import { describe, it, expect } from 'vitest';
import { normalizeSearchText, matchesSearch } from '../src/utils/searchMatch';

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
});
