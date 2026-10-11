import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { backupQuery, channelState, cloudClient, driveUpload, storageGet } = vi.hoisted(() => {
    const state = { channel: null, callback: null, removed: [] };
    const channel = {
        on: vi.fn((_event, _filter, callback) => {
            state.callback = callback;
            return channel;
        }),
        subscribe: vi.fn(() => channel),
    };
    const query = {
        select: vi.fn(() => query),
        eq: vi.fn(() => {
            if (query.updating) {
                query.updating = false;
                return Promise.resolve(query.updateResult);
            }
            return query;
        }),
        order: vi.fn(() => query),
        maybeSingle: vi.fn(() => Promise.resolve(query.pendingResult)),
        pendingResult: null,
        updateResult: { error: null },
        updating: false,
        update: vi.fn(() => {
            query.updating = true;
            return query;
        }),
    };
    const client = {
        from: vi.fn(() => query),
        channel: vi.fn(() => channel),
        channelResult: channel,
        removeChannel: vi.fn(async (channel) => { state.removed.push(channel); }),
        auth: { getSession: vi.fn(async () => ({ data: { session: null } })) },
    };
    const upload = vi.fn(async () => ({ downloadUrl: 'https://backup.test/file', sizeBytes: 10 }));
    return {
        backupQuery: query,
        channelState: state,
        cloudClient: client,
        driveUpload: upload,
        storageGet: vi.fn(async () => null),
    };
});

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: storageGet,
        setItem: vi.fn(async () => {}),
    },
}));
vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: cloudClient }));
vi.mock('../src/config/backupKeys', () => ({ IDB_KEYS: [], LS_KEYS: [] }));
vi.mock('../src/utils/compression', () => ({
    compressString: vi.fn(async (value) => value),
    isCompressionSupported: vi.fn(() => false),
}));
vi.mock('../src/utils/driveBackupUploader', () => ({ uploadToGoogleDrive: driveUpload }));
vi.mock('../src/utils/backupRestoreService', () => ({
    validateBackupJson: vi.fn(),
    applyBackupToStorage: vi.fn(),
}));
vi.mock('../src/config/cloudSchema', () => ({ buildCloudBackupsRow: vi.fn() }));
vi.mock('../src/services/backupRequestPolling', () => ({
    startBackupRequestPolling: vi.fn((check, options) => {
        channelState.check = check;
        channelState.options = options;
        check();
        return vi.fn(() => { channelState.stopped = true; });
    }),
}));

import { useAutoBackup } from '../src/hooks/useAutoBackup';
import { startBackupRequestPolling } from '../src/services/backupRequestPolling';

function renderBackupHook() {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(createElement(HookHarness)));
    return {
        unmount() {
            act(() => root.unmount());
            container.remove();
        },
    };
}

function HookHarness() {
    useAutoBackup(true, false, 'PDA-DEVICE-01');
    return null;
}

function pendingRequest(id = 'request-1') {
    backupQuery.pendingResult = { data: { id, status: 'pending' }, error: null };
}

async function flushPromises() {
    await act(async () => {
        for (let index = 0; index < 10; index += 1) await Promise.resolve();
    });
}

describe('useAutoBackup remote request reconciliation', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        channelState.channel = null;
        cloudClient.channelResult.on.mockClear();
        cloudClient.channelResult.subscribe.mockClear();
        channelState.callback = null;
        channelState.removed = [];
        channelState.stopped = false;
        channelState.check = null;
        channelState.options = null;
        backupQuery.maybeSingle.mockClear();
        backupQuery.updateResult = { error: null };
        backupQuery.updating = false;
        backupQuery.pendingResult = null;
        backupQuery.update.mockClear();
        backupQuery.select.mockClear();
        backupQuery.eq.mockClear();
        backupQuery.order.mockClear();
        cloudClient.from.mockClear();
        cloudClient.removeChannel.mockClear();
        cloudClient.channel.mockClear();
        driveUpload.mockReset();
        driveUpload.mockResolvedValue({ downloadUrl: 'https://backup.test/file', sizeBytes: 10 });
        storageGet.mockReset();
        storageGet.mockResolvedValue(null);
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('business_name', 'Test Store');
        vi.stubEnv('VITE_ESTACION_API_URL', 'https://estacion.test');
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('deduplicates realtime and poll triggers while one request is in flight', async () => {
        let finishBackup;
        pendingRequest();
        driveUpload.mockImplementation(() => new Promise((resolve) => { finishBackup = resolve; }));
        const view = renderBackupHook();
        await flushPromises();

        expect(startBackupRequestPolling).toHaveBeenCalled();
        expect(cloudClient.channel).toHaveBeenCalledWith('backup_request_PDA-DEVICE-01');
        expect(channelState.callback).toBeTypeOf('function');
        expect(driveUpload).toHaveBeenCalledTimes(1);

        await act(async () => {
            await channelState.callback({ new: { status: 'pending' } });
            await channelState.check();
        });
        expect(backupQuery.maybeSingle).toHaveBeenCalledTimes(1);

        await act(async () => { finishBackup({ downloadUrl: 'https://backup.test/file', sizeBytes: 10 }); });
        await flushPromises();
        expect(backupQuery.update).toHaveBeenCalledTimes(1);
        expect(backupQuery.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));

        await act(async () => { await channelState.callback({ new: { status: 'pending' } }); });
        await flushPromises();
        expect(driveUpload).toHaveBeenCalledTimes(1);
        view.unmount();
    });

    it('does not repeat a backup after a completed request is delivered again by realtime', async () => {
        pendingRequest('already-completed');
        const view = renderBackupHook();
        await flushPromises();
        expect(driveUpload).toHaveBeenCalledTimes(1);

        await act(async () => { await channelState.callback({ new: { status: 'pending' } }); });
        await flushPromises();
        expect(driveUpload).toHaveBeenCalledTimes(1);
        view.unmount();
    });

    it('retries a failed backup on a later reconciliation and completes only after success', async () => {
        pendingRequest('retry-me');
        driveUpload
            .mockRejectedValueOnce(new Error('upload failed'))
            .mockResolvedValueOnce({ downloadUrl: 'https://backup.test/file', sizeBytes: 10 });
        const view = renderBackupHook();
        await flushPromises();

        expect(driveUpload).toHaveBeenCalledTimes(1);
        expect(backupQuery.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));

        await act(async () => { await channelState.check(); });
        await flushPromises();
        expect(driveUpload).toHaveBeenCalledTimes(2);
        expect(backupQuery.update).toHaveBeenCalledTimes(2);
        expect(backupQuery.update).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'completed' }));
        view.unmount();
    });

    it('does not report a request as completed when Supabase rejects the update promise', async () => {
        pendingRequest('completion-rejected');
        backupQuery.updateResult = Promise.reject(new Error('completion request rejected'));
        backupQuery.updateResult.catch(() => {});
        const view = renderBackupHook();
        await flushPromises();

        expect(driveUpload).toHaveBeenCalledTimes(1);
        expect(sessionStorage.getItem('backup_processed_completion-rejected')).toBeNull();
        expect(console.error).toHaveBeenCalledWith('[AutoBackup] Backup falló, se reintentará:', expect.any(Error));
        view.unmount();
    });

    it('keeps a request retryable when persisting completed status fails', async () => {
        pendingRequest('completion-write-retry');
        backupQuery.updateResult = { error: new Error('completion write failed') };
        const view = renderBackupHook();
        await flushPromises();

        expect(driveUpload).toHaveBeenCalledTimes(1);
        expect(backupQuery.update).toHaveBeenCalledTimes(1);
        expect(sessionStorage.getItem('backup_processed_completion-write-retry')).toBeNull();

        backupQuery.updateResult = { error: null };
        await act(async () => { await channelState.check(); });
        await flushPromises();

        expect(driveUpload).toHaveBeenCalledTimes(2);
        expect(backupQuery.update).toHaveBeenCalledTimes(2);
        expect(sessionStorage.getItem('backup_processed_completion-write-retry')).toBe('1');
        view.unmount();
    });

    it('keeps a request retryable when the forced upload cannot reach Google Drive', async () => {
        pendingRequest('missing-drive-endpoint');
        driveUpload
            .mockResolvedValueOnce(null)
            .mockResolvedValueOnce({ downloadUrl: 'https://backup.test/file', sizeBytes: 10 });
        const view = renderBackupHook();
        await flushPromises();

        expect(backupQuery.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
        expect(sessionStorage.getItem('backup_processed_missing-drive-endpoint')).toBeNull();

        await act(async () => { await channelState.check(); });
        await flushPromises();
        expect(driveUpload).toHaveBeenCalledTimes(2);
        expect(backupQuery.update).toHaveBeenCalledTimes(2);
        expect(backupQuery.update).toHaveBeenLastCalledWith(expect.objectContaining({ status: 'completed' }));
        view.unmount();
    });

    it('does not mark a request completed when Supabase returns a read error', async () => {
        backupQuery.pendingResult = { data: null, error: new Error('read failed') };
        const view = renderBackupHook();
        await flushPromises();

        expect(driveUpload).not.toHaveBeenCalled();
        expect(backupQuery.update).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith('[AutoBackup] Error al procesar solicitud pendiente:', expect.any(Error));
        view.unmount();
    });

    it('cleans the polling watchdog and realtime subscription on unmount during an in-flight backup', async () => {
        pendingRequest('unmount-in-flight');
        driveUpload.mockImplementation(() => new Promise(() => {}));
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
        const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
        const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
        const view = renderBackupHook();
        await flushPromises();

        expect(driveUpload).toHaveBeenCalledTimes(1);
        const watchdogTimer = setTimeoutSpy.mock.results.find((result, index) =>
            setTimeoutSpy.mock.calls[index][1] === 2 * 60 * 1000
        )?.value;
        const backupInterval = setIntervalSpy.mock.results.find((result, index) =>
            setIntervalSpy.mock.calls[index][1] === 30 * 60 * 1000
        )?.value;
        expect(watchdogTimer).toBeDefined();
        expect(backupInterval).toBeDefined();

        view.unmount();
        expect(channelState.stopped).toBe(true);
        expect(cloudClient.removeChannel).toHaveBeenCalledWith(cloudClient.channelResult);
        expect(clearTimeoutSpy).toHaveBeenCalledWith(watchdogTimer);
        expect(clearIntervalSpy).toHaveBeenCalledWith(backupInterval);
    });
});
