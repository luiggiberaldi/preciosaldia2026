import { describe, expect, it } from 'vitest';
import { getPermanentBackupEntitlement } from '../src/services/backupEntitlement';

describe('backup entitlement', () => {
    it('allows only an active permanent license', () => {
        expect(getPermanentBackupEntitlement({
            isPremium: true,
            isDemo: false,
            license: { type: 'permanent', isActive: true },
        })).toEqual({ allowed: true, reason: 'permanent_active' });
    });

    it.each([
        ['demo', { type: 'demo3', isActive: true }],
        ['monthly', { type: 'monthly', isActive: true }],
        ['inactive', { type: 'permanent', isActive: false }],
        ['expired', { type: 'permanent', isActive: true, expiresAt: '2020-01-01T00:00:00Z' }],
    ])('rejects %s accounts', (_label, license) => {
        expect(getPermanentBackupEntitlement({
            isPremium: true,
            isDemo: license.type.startsWith('demo'),
            license,
            now: Date.parse('2026-10-15T00:00:00Z'),
        }).allowed).toBe(false);
    });

    it('fails closed when there is no license record', () => {
        expect(getPermanentBackupEntitlement({ isPremium: true, isDemo: false }).allowed).toBe(false);
    });
});
