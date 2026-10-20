import { describe, expect, it } from 'vitest';

import {
    getBackupEntitlement,
    getPermanentBackupEntitlement,
    getCachedBackupEntitlement,
} from '../src/services/backupEntitlement';

// Instante fijo para que las ventanas de gracia sean deterministas.
const NOW = Date.parse('2026-10-15T00:00:00.000Z');

describe('backup entitlement (política compartida)', () => {
    it('permite los planes de pago: permanente y mensual', () => {
        expect(getBackupEntitlement({
            isPremium: true,
            isDemo: false,
            license: { type: 'permanent', isActive: true },
            now: NOW,
        })).toEqual({ allowed: true, reason: 'eligible' });

        expect(getBackupEntitlement({
            isPremium: true,
            isDemo: false,
            license: { type: 'monthly', isActive: true, expiresAt: '2026-10-20T00:00:00Z' },
            now: NOW,
        })).toEqual({ allowed: true, reason: 'eligible' });
    });

    it('el mensual en período de gracia conserva el respaldo', () => {
        expect(getBackupEntitlement({
            isPremium: true,
            isDemo: false,
            license: { type: 'monthly', isActive: true, expiresAt: '2026-10-13T00:00:00Z' },
            now: NOW,
        })).toEqual({ allowed: true, reason: 'eligible' });
    });

    it('acepta la licencia desde la caché local con la misma regla', () => {
        const storage = {
            getItem: () => JSON.stringify({ type: 'monthly', isActive: true, expiresAt: '2026-10-20T00:00:00Z' }),
        };
        expect(getCachedBackupEntitlement({ isPremium: true, isDemo: false, storage, now: NOW }).allowed).toBe(true);
    });

    it.each([
        ['demo', { type: 'demo3', isActive: true, expiresAt: '2026-10-20T00:00:00Z' }],
        ['demo7', { type: 'demo7', isActive: true, expiresAt: '2026-10-20T00:00:00Z' }],
        ['inactiva', { type: 'permanent', isActive: false }],
        ['revocada', { type: 'revoked', isActive: true }],
        ['vencida', { type: 'permanent', isActive: true, expiresAt: '2020-01-01T00:00:00Z' }],
        ['mensual muerta', { type: 'monthly', isActive: true, expiresAt: '2026-10-01T00:00:00Z' }],
        ['mensual sin vencimiento', { type: 'monthly', isActive: true }],
    ])('rechaza la cuenta %s', (_label, license) => {
        expect(getBackupEntitlement({
            isPremium: true,
            isDemo: license.type.startsWith('demo'),
            license,
            now: NOW,
        }).allowed).toBe(false);
    });

    it('falla cerrado sin licencia o sin acceso premium', () => {
        expect(getBackupEntitlement({ isPremium: true, isDemo: false, now: NOW }).allowed).toBe(false);
        expect(getBackupEntitlement({ now: NOW }).allowed).toBe(false);
        expect(getBackupEntitlement({
            isPremium: false,
            isDemo: false,
            license: { type: 'permanent', isActive: true },
            now: NOW,
        }).allowed).toBe(false);
        expect(getBackupEntitlement({
            isPremium: true,
            isDemo: true,
            license: { type: 'demo3', isActive: true, expiresAt: '2026-10-20T00:00:00Z' },
            now: NOW,
        }).allowed).toBe(false);
    });

    it('conserva el nombre histórico como alias deprecado', () => {
        expect(getPermanentBackupEntitlement).toBe(getBackupEntitlement);
    });
});
