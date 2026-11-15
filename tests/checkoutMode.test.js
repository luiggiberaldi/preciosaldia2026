import { describe, it, expect } from 'vitest';
import { resolveCheckoutMode } from '../src/utils/checkoutMode';

const PC_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130 Safari/537.36';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 Chrome/130 Safari/537.36';

describe('resolveCheckoutMode', () => {
    it('automático: PC ancho → modo PC', () => {
        expect(resolveCheckoutMode('auto', { isWide: true, userAgent: PC_UA })).toBe('pos');
    });

    it('automático: ventana angosta → modo Móvil', () => {
        expect(resolveCheckoutMode('auto', { isWide: false, userAgent: PC_UA })).toBe('basic');
    });

    it('automático: tablet Android ancha → modo Móvil', () => {
        expect(resolveCheckoutMode('auto', { isWide: true, userAgent: ANDROID_UA })).toBe('basic');
    });

    it('sin modo guardado se comporta como automático', () => {
        expect(resolveCheckoutMode(undefined, { isWide: true, userAgent: PC_UA })).toBe('pos');
        expect(resolveCheckoutMode(null, { isWide: false, userAgent: PC_UA })).toBe('basic');
    });

    it('modos fijos ignoran el tamaño de pantalla', () => {
        expect(resolveCheckoutMode('basic', { isWide: true, userAgent: PC_UA })).toBe('basic');
        expect(resolveCheckoutMode('pos', { isWide: false, userAgent: ANDROID_UA })).toBe('pos');
    });

    it('interruptor checkout_shell_v2 fuerza Móvil en automático y en PC', () => {
        expect(resolveCheckoutMode('auto', { isWide: true, userAgent: PC_UA, shellV2: true })).toBe('basic');
        expect(resolveCheckoutMode('pos', { isWide: true, userAgent: PC_UA, shellV2: true })).toBe('basic');
    });
});
