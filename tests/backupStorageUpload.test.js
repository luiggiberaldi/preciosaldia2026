import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/utils/backupRelay', () => ({
    getEstacionApiUrl: () => 'https://estacion.test',
}));

import { uploadBackupToStorage, sha256Hex, newBackupOperationId, saveDeviceCredential, readDeviceCredential, DEVICE_CREDENTIAL_STORAGE_KEY } from '../src/utils/backupStorageUpload';

const bytes = new TextEncoder().encode('gzip-like-payload');
const CRED = 'device-credential-test-value-0123456789';

describe('uploadBackupToStorage', () => {
    let fetchMock;
    beforeEach(() => {
        fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        localStorage.clear();
        saveDeviceCredential(CRED);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it('stores the credential locally and reads it back', () => {
        expect(localStorage.getItem(DEVICE_CREDENTIAL_STORAGE_KEY)).toBe(CRED);
        expect(readDeviceCredential()).toBe(CRED);
    });

    it('sends operationId, sha256 and base64 bytes, and reports success only on ok:true', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: true, backupId: 'm-1', sha256: 'x' }), { status: 200 }));
        const result = await uploadBackupToStorage('DEV12345', bytes, { operationId: '11111111-2222-4333-8444-555555555555' });

        expect(result).toEqual({ ok: true, operationId: '11111111-2222-4333-8444-555555555555', backupId: 'm-1', sha256: 'x' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://estacion.test/api/backup/storage/upload');
        const body = JSON.parse(init.body);
        expect(body.operationId).toBe('11111111-2222-4333-8444-555555555555');
        expect(body.sha256).toBe(await sha256Hex(bytes));
        expect(body.deviceId).toBe('DEV12345');
        expect(atob(body.dataBase64)).toBe('gzip-like-payload');
        expect(init.headers['x-device-credential']).toBe(CRED);
        expect(init.headers['x-backup-secret']).toBeUndefined();
    });

    it('fails without calling fetch when the device has no credential', async () => {
        localStorage.clear();
        const result = await uploadBackupToStorage('DEV12345', bytes);
        expect(result.ok).toBe(false);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('reports failure when the server rejects, never success', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ ok: false, error: 'no licence' }), { status: 403 }));
        const result = await uploadBackupToStorage('DEV12345', bytes);
        expect(result.ok).toBe(false);
        expect(result.error).toBe('no licence');
    });

    it('treats a 200 without ok:true as failure', async () => {
        fetchMock.mockResolvedValue(new Response(JSON.stringify({ success: true }), { status: 200 }));
        const result = await uploadBackupToStorage('DEV12345', bytes);
        expect(result.ok).toBe(false);
    });

    it('reports network errors as failure', async () => {
        fetchMock.mockRejectedValue(new Error('offline'));
        const result = await uploadBackupToStorage('DEV12345', bytes);
        expect(result).toMatchObject({ ok: false, error: 'offline' });
    });

    it('generates a uuid-shaped operationId when none is given', () => {
        expect(newBackupOperationId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });
});
