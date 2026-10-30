// @vitest-environment jsdom
// Escala de interfaz: el zoom del <html> escala vh/vw; el CSS los compensa
// con --ui-zoom (postcss-viewport-zoom.js) y applyUiScale fija ambos juntos.
import postcss from 'postcss';
import { describe, expect, it } from 'vitest';
import viewportZoom, { compensateViewportUnits } from '../postcss-viewport-zoom.js';
import { applyUiScale } from '../src/utils/uiScale';

describe('postcss-viewport-zoom', () => {
    it('divide toda unidad de viewport por --ui-zoom y no toca lo demás', () => {
        expect(compensateViewportUnits('100dvh')).toBe('calc(100dvh / var(--ui-zoom, 1))');
        expect(compensateViewportUnits('calc(100dvh - 12rem)')).toBe('calc(calc(100dvh / var(--ui-zoom, 1)) - 12rem)');
        expect(compensateViewportUnits('min(88vh,900px)')).toBe('min(calc(88vh / var(--ui-zoom, 1)),900px)');
        expect(compensateViewportUnits('90vw')).toBe('calc(90vw / var(--ui-zoom, 1))');
        expect(compensateViewportUnits('12px 1rem')).toBe('12px 1rem');
    });

    it('reescribe declaraciones, pero no variables ni media queries', async () => {
        const css = '.a{height:100dvh}.b{max-height:92vh;--x:10vh}@media (min-height:50vh){.c{width:1px}}';
        const out = (await postcss([viewportZoom()]).process(css, { from: undefined })).css;
        expect(out).toContain('.a{height:calc(100dvh / var(--ui-zoom, 1))}');
        expect(out).toContain('max-height:calc(92vh / var(--ui-zoom, 1))');
        expect(out).toContain('--x:10vh');
        expect(out).toContain('@media (min-height:50vh)');
    });
});

describe('applyUiScale', () => {
    it('fija zoom y --ui-zoom juntos; 100 % o fuera de rango limpia ambos', () => {
        const root = document.createElement('div');
        expect(applyUiScale(85, root)).toBe(85);
        expect(root.style.zoom).toBe('85%');
        expect(root.style.getPropertyValue('--ui-zoom')).toBe('0.85');
        expect(applyUiScale(100, root)).toBe(100);
        expect(root.style.zoom).toBe('');
        expect(root.style.getPropertyValue('--ui-zoom')).toBe('');
        expect(applyUiScale(NaN, root)).toBe(100);
        expect(applyUiScale(200, root)).toBe(100);
    });
});

describe('postcss-viewport-zoom · idempotencia', () => {
    it('un valor ya compensado no se vuelve a reescribir (evita el bucle de PostCSS)', () => {
        const once = compensateViewportUnits('100dvh');
        expect(compensateViewportUnits(once)).toBe(once);
    });
});
