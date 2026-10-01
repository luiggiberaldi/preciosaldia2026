import { describe, it, expect } from 'vitest';
import { normalizeVzlaPhone, isValidVzlaPhone, displayVzlaPhone } from '../src/utils/phoneValidation';

describe('phoneValidation — teléfonos venezolanos', () => {
    it('acepta móviles 04XX con y sin formato', () => {
        expect(isValidVzlaPhone('04121234567')).toBe(true);
        expect(isValidVzlaPhone('0412 123 4567')).toBe(true);
        expect(isValidVzlaPhone('0412-123-4567')).toBe(true);
        expect(isValidVzlaPhone('(0412) 123-4567')).toBe(true);
    });

    it('acepta prefijo internacional +58 / 58', () => {
        expect(isValidVzlaPhone('+58 412 123 4567')).toBe(true);
        expect(isValidVzlaPhone('584121234567')).toBe(true);
        expect(normalizeVzlaPhone('+58 412 123 4567')).toBe('04121234567');
    });

    it('rechaza números inválidos', () => {
        expect(isValidVzlaPhone('')).toBe(false);
        expect(isValidVzlaPhone('abc')).toBe(false);
        expect(isValidVzlaPhone('0412123456')).toBe(false);   // 10 dígitos
        expect(isValidVzlaPhone('041212345678')).toBe(false); // 12 dígitos
        expect(isValidVzlaPhone('02121234567')).toBe(false);  // fijo, no móvil
        expect(isValidVzlaPhone('13121234567')).toBe(false);
    });

    it('normaliza a 11 dígitos locales', () => {
        expect(normalizeVzlaPhone('0412-123-4567')).toBe('04121234567');
        expect(normalizeVzlaPhone(null)).toBeNull();
    });

    it('formatea para mostrar', () => {
        expect(displayVzlaPhone('04121234567')).toBe('0412 123 4567');
        expect(displayVzlaPhone('0412-123-4567')).toBe('0412 123 4567');
        expect(displayVzlaPhone('')).toBe('');
    });
});
