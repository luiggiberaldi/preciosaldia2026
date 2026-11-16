import { describe, it, expect } from 'vitest';
import { adminsWithoutPin, canBypassPin, validateNewAdminPin, FACTORY_PIN } from '../src/utils/adminPinPolicy';

describe('política del PIN del Administrador', () => {
    const usuarios = [
        { id: 1, nombre: 'Administrador', rol: 'ADMIN', requirePin: false },
        { id: 2, nombre: 'Cajero', rol: 'CAJERO', requirePin: false },
        { id: 3, nombre: 'Dueña', rol: 'ADMIN', requirePin: true },
    ];

    it('encuentra solo a los administradores que entran sin PIN', () => {
        expect(adminsWithoutPin(usuarios).map(u => u.id)).toEqual([1]);
        expect(adminsWithoutPin(null)).toEqual([]);
    });

    it('con la pantalla de inicio activa, el Administrador no puede quedar «sin PIN»', () => {
        expect(canBypassPin(usuarios[0], true)).toBe(false);
        expect(canBypassPin(usuarios[0], false)).toBe(true);
        expect(canBypassPin(usuarios[1], true)).toBe(true);
    });

    it('el PIN nuevo debe ser válido, distinto de 000000 y coincidir con la confirmación', () => {
        expect(validateNewAdminPin(FACTORY_PIN, FACTORY_PIN)).toMatch(/000000/);
        expect(validateNewAdminPin('12a456', '12a456')).toMatch(/dígitos/);
        expect(validateNewAdminPin('123', '123')).toMatch(/al menos/);
        expect(validateNewAdminPin('482913', '482914')).toMatch(/no coinciden/);
        expect(validateNewAdminPin('482913', '482913')).toBeNull();
        expect(validateNewAdminPin('482913')).toBeNull();
    });
});
