import { describe, it, expect, beforeEach } from 'vitest';
import { getCartCompactMode, setCartCompactMode, resolveCartCompact, CART_COMPACT_KEY } from '../src/config/salesFeatures';

describe('cesta compacta', () => {
    beforeEach(() => localStorage.removeItem(CART_COMPACT_KEY));
    it('de fábrica es automática', () => expect(getCartCompactMode()).toBe('auto'));
    it('guarda el modo elegido y rechaza valores raros', () => {
        expect(setCartCompactMode('always')).toBe('always');
        expect(getCartCompactMode()).toBe('always');
        expect(setCartCompactMode('xyz')).toBe('auto');
    });
    it('decide compacta según modo y alto de pantalla', () => {
        expect(resolveCartCompact('auto', true)).toBe(true);
        expect(resolveCartCompact('auto', false)).toBe(false);
        expect(resolveCartCompact('always', false)).toBe(true);
        expect(resolveCartCompact('never', true)).toBe(false);
    });
    it('en teléfono o tablet siempre es compacta, aunque el modo sea «Siempre amplia»', () => {
        expect(resolveCartCompact('never', false, true)).toBe(true);
        expect(resolveCartCompact('auto', false, true)).toBe(true);
    });
});
