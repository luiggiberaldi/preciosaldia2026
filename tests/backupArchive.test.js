import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/utils/compression', () => ({
    isCompressionSupported: vi.fn(() => true),
    compressString: vi.fn(async (value) => `gzip:${value}`),
    decompressString: vi.fn(async (value) => value.slice(5)),
}));

import { createCompressedBackupPayload, decompressBackupPayload } from '../src/utils/backupArchive';

const backup = {
    timestamp: '2026-10-15T00:00:00.000Z',
    version: '2.0',
    appName: 'TasasAlDia_Bodegas',
    data: { idb: { bodega_products_v1: [{ id: 'p1' }] }, ls: {} },
};

describe('backup archive', () => {
    it('creates a gzip payload with metadata and full content', async () => {
        const payload = await createCompressedBackupPayload(backup);
        expect(payload).toMatchObject({ compressed: true, compression: 'gzip', schemaVersion: 2 });
        expect(payload.data).toContain('gzip:');
    });

    it('round-trips the complete backup payload', async () => {
        const payload = await createCompressedBackupPayload(backup);
        const restored = await decompressBackupPayload(payload);
        expect(restored.data).toEqual(backup.data);
        expect(restored.version).toBe('2.0');
        expect(restored.compressed).toBe(false);
    });
});
