import { beforeEach, describe, expect, it } from 'vitest';
import {
    BRAND_LOGO_KEY, DEFAULT_LOGO_DARK, DEFAULT_LOGO_LIGHT, LOGO_LIMITS,
    clearCustomLogo, fitInside, getCustomLogo, getLogoSrc, processLogoFile, setCustomLogo,
} from '../src/utils/brandLogo';

const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

beforeEach(() => localStorage.clear());

describe('logo personalizado', () => {
    it('sin logo guardado se usan los de fábrica (claro y oscuro)', () => {
        expect(getCustomLogo()).toBeNull();
        expect(getLogoSrc()).toBe(DEFAULT_LOGO_LIGHT);
        expect(getLogoSrc({ dark: true })).toBe(DEFAULT_LOGO_DARK);
    });

    it('con logo guardado se usa el mismo en claro y oscuro', () => {
        expect(setCustomLogo(PNG_1PX)).toBe(true);
        expect(getLogoSrc()).toBe(PNG_1PX);
        expect(getLogoSrc({ dark: true })).toBe(PNG_1PX);
    });

    it('quitar el logo restaura el de fábrica', () => {
        setCustomLogo(PNG_1PX);
        clearCustomLogo();
        expect(localStorage.getItem(BRAND_LOGO_KEY)).toBeNull();
        expect(getLogoSrc()).toBe(DEFAULT_LOGO_LIGHT);
    });

    it('emite el evento para que las pantallas abiertas se actualicen', () => {
        let fired = 0;
        const handler = () => { fired += 1; };
        globalThis.addEventListener('brand-logo-changed', handler);
        setCustomLogo(PNG_1PX);
        clearCustomLogo();
        globalThis.removeEventListener('brand-logo-changed', handler);
        expect(fired).toBe(2);
    });

    it('rechaza lo que no es una imagen en data URL (SVG, scripts, texto, URLs)', () => {
        [
            'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
            'javascript:alert(1)',
            'https://ejemplo.com/logo.png',
            'data:text/html;base64,PGgxPmhpPC9oMT4=',
            '',
            null,
        ].forEach((bad) => expect(setCustomLogo(bad)).toBe(false));
        expect(getCustomLogo()).toBeNull();
    });

    it('ignora un valor corrupto o demasiado grande ya guardado', () => {
        localStorage.setItem(BRAND_LOGO_KEY, 'no es una imagen');
        expect(getLogoSrc()).toBe(DEFAULT_LOGO_LIGHT);
        localStorage.setItem(BRAND_LOGO_KEY, `data:image/png;base64,${'A'.repeat(LOGO_LIMITS.MAX_STORED_CHARS)}`);
        expect(getCustomLogo()).toBeNull();
    });
});

describe('fitInside', () => {
    it('conserva la proporción dentro de la caja', () => {
        expect(fitInside(400, 100, 50, 12)).toEqual({ w: 48, h: 12 });
        expect(fitInside(100, 100, 50, 12)).toEqual({ w: 12, h: 12 });
        expect(fitInside(100, 400, 50, 12)).toEqual({ w: 3, h: 12 });
    });

    it('con medidas inválidas devuelve la caja completa', () => {
        expect(fitInside(0, 0, 50, 12)).toEqual({ w: 50, h: 12 });
    });
});

describe('processLogoFile', () => {
    it('rechaza tipos no permitidos y archivos enormes', async () => {
        expect((await processLogoFile(null)).ok).toBe(false);
        const svg = new File(['<svg/>'], 'logo.svg', { type: 'image/svg+xml' });
        expect((await processLogoFile(svg)).error).toMatch(/PNG, JPG o WEBP/);
        const big = { type: 'image/png', size: LOGO_LIMITS.MAX_INPUT_BYTES + 1 };
        expect((await processLogoFile(big)).error).toMatch(/5 MB/);
    });
});
