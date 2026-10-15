import { beforeEach, describe, expect, it, vi } from 'vitest';

const { cloudClient, query, relayUploadBackup, ensureSupervisorSession, ensureDeviceSessionRegistered } = vi.hoisted(() => {
    const q = {
        upsert: vi.fn(async () => ({ error: null })),
    };
    return {
        cloudClient: { from: vi.fn(() => q) },
        query: q,
        relayUploadBackup: vi.fn(),
        ensureSupervisorSession: vi.fn(),
        ensureDeviceSessionRegistered: vi.fn(),
    };
});

vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: cloudClient }));
vi.mock('../src/config/cloudSchema', () => ({
    buildCloudBackupsRow: vi.fn(({ deviceId, backupData }) => ({
        device_id: deviceId,
        backup_data: backupData,
        updated_at: '2026-10-15T00:00:00.000Z',
    })),
}));
vi.mock('../src/services/supervisorAuth', () => ({ ensureSupervisorSession }));
vi.mock('../src/utils/deviceIdentity', () => ({ ensureDeviceSessionRegistered }));
vi.mock('../src/utils/backupRelay', () => ({ relayUploadBackup }));
vi.mock('../src/utils/cloudError', () => ({ isRlsBlockedError: vi.fn(() => false) }));

import { uploadCompressedBackupToCloud } from '../src/services/cloudBackupUpload';

describe('cloud backup upload', () => {
    beforeEach(() => {
        query.upsert.mockClear();
        cloudClient.from.mockClear();
        relayUploadBackup.mockReset();
        ensureSupervisorSession.mockReset();
        ensureDeviceSessionRegistered.mockReset();
        ensureSupervisorSession.mockResolvedValue({ session: { user: { id: 'user-1' } }, error: null });
        ensureDeviceSessionRegistered.mockResolvedValue({ ok: true });
    });

    it('registers the device and stores the compressed payload', async () => {
        const payload = { compressed: true, compression: 'gzip', data: 'abc' };
        const result = await uploadCompressedBackupToCloud('PDA-DEVICE-01', payload);

        expect(result).toEqual({ ok: true, destination: 'cloud_backups' });
        expect(ensureSupervisorSession).toHaveBeenCalled();
        expect(ensureDeviceSessionRegistered).toHaveBeenCalledWith('PDA-DEVICE-01');
        expect(query.upsert).toHaveBeenCalledWith(
            expect.objectContaining({ device_id: 'PDA-DEVICE-01', backup_data: payload }),
            { onConflict: 'device_id' },
        );
    });

    it('does not write when the device session cannot be registered', async () => {
        ensureDeviceSessionRegistered.mockResolvedValue({ ok: false, error: { message: 'identity failed' } });

        const result = await uploadCompressedBackupToCloud('PDA-DEVICE-01', { compressed: true });

        expect(result).toEqual({ ok: false, error: 'identity failed' });
        expect(query.upsert).not.toHaveBeenCalled();
    });
});
