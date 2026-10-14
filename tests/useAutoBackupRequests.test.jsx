import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { backupQuery, channelState, cloudClient, storageGet } = vi.hoisted(() => {
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
        eq: vi.fn((column, value) => {
            if (query.updating) {
                query.updating = false;
                query.updateId = value;
                const result = query.updateResult;
                const persistUpdate = (resolved) => {
                    if (!resolved?.error && Array.isArray(query.pendingResult?.data)) {
                        query.pendingResult.data.forEach(row => {
                            if (row.id === query.updateId) Object.assign(row, query.updatePayload);
                        });
                    }
                    return resolved;
                };
                if (result && typeof result.then === 'function') return result.then(persistUpdate);
                return Promise.resolve(persistUpdate(result));
            }
            if (column === 'device_id') query.deviceFilter = value;
            return query;
        }),
        in: vi.fn((column, values) => {
            if (column === 'status') query.statusFilter = values;
            return query;
        }),
        order: vi.fn(() => query),
        limit: vi.fn(() => {
            if (!query.pendingResult || query.pendingResult.error || !Array.isArray(query.pendingResult.data)) {
                return Promise.resolve(query.pendingResult);
            }
            const data = query.pendingResult.data.filter(row =>
                !query.statusFilter || query.statusFilter.includes(row.status)
            );
            query.observedStatuses.push(data.map(row => row.status));
            return Promise.resolve({ data, error: null });
        }),
        pendingResult: null,
        observedStatuses: [],
        statusFilter: null,
        updateResult: { error: null },
        updating: false,
        updatePayload: null,
        updateId: null,
        update: vi.fn((payload) => {
            query.updatePayload = payload;
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
    return {
        backupQuery: query,
        channelState: state,
        cloudClient: client,
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
vi.mock('../src/utils/backupRestoreService', () => ({
    validateBackupJson: vi.fn(),
    applyBackupToStorage: vi.fn(),
}));
vi.mock('../src/config/cloudSchema', () => ({ buildCloudBackupsRow: vi.fn() }));
vi.mock('../src/services/supervisorAuth', () => ({
    ensureSupervisorSession: vi.fn(),
}));
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
import { ensureSupervisorSession } from '../src/services/supervisorAuth';

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
    backupQuery.pendingResult = { data: [{ id, status: 'pending' }], error: null };
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
        backupQuery.limit.mockClear();
        backupQuery.in.mockClear();
        backupQuery.updateResult = { error: null };
        backupQuery.updating = false;
        backupQuery.updatePayload = null;
        backupQuery.updateId = null;
        backupQuery.statusFilter = null;
        backupQuery.observedStatuses = [];
        backupQuery.deviceFilter = null;
        backupQuery.pendingResult = null;
        backupQuery.update.mockClear();
        backupQuery.select.mockClear();
        backupQuery.eq.mockClear();
        backupQuery.order.mockClear();
        cloudClient.from.mockClear();
        cloudClient.removeChannel.mockClear();
        cloudClient.channel.mockClear();
        storageGet.mockReset();
        storageGet.mockResolvedValue(null);
        localStorage.clear();
        sessionStorage.clear();
        localStorage.setItem('business_name', 'Test Store');
        vi.stubEnv('VITE_ESTACION_API_URL', 'https://estacion.test');
        globalThis.fetch = vi.fn().mockResolvedValue({ ok: true });
        ensureSupervisorSession.mockReset();
        ensureSupervisorSession.mockResolvedValue({ session: { user: { id: 'device-user' } }, error: null });
        vi.spyOn(console, 'log').mockImplementation(() => {});
        vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.unstubAllEnvs();
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it('processes a pending request once and marks it failed without a remote copy', async () => {
        pendingRequest();
        const view = renderBackupHook();
        await flushPromises();

        expect(startBackupRequestPolling).toHaveBeenCalled();
        expect(cloudClient.channel).toHaveBeenCalledWith('backup_request_PDA-DEVICE-01');
        expect(channelState.callback).toBeTypeOf('function');
        expect(backupQuery.update).toHaveBeenCalledTimes(1);
        expect(backupQuery.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
        expect(backupQuery.update).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));

        await act(async () => { await channelState.callback({ new: { status: 'pending' } }); });
        await flushPromises();
        expect(backupQuery.update).toHaveBeenCalledTimes(1);
        view.unmount();
    });

    it('does not retry a failed request before its exponential backoff expires', async () => {
        pendingRequest('retry-backoff');
        const view = renderBackupHook();
        await flushPromises();
        const updatesAfterFirst = backupQuery.update.mock.calls.length;
        expect(updatesAfterFirst).toBe(1);

        await act(async () => {
            vi.advanceTimersByTime(5 * 60 * 1000 - 1);
            await channelState.check();
        });
        await flushPromises();
        expect(backupQuery.update.mock.calls.length).toBe(updatesAfterFirst);

        await act(async () => {
            vi.advanceTimersByTime(1);
            await channelState.check();
        });
        await flushPromises();
        expect(backupQuery.update.mock.calls.length).toBe(updatesAfterFirst + 1);
        view.unmount();
    });

    it('increases retry delay after consecutive backup failures', async () => {
        pendingRequest('retry-backoff-growth');
        const view = renderBackupHook();
        await flushPromises();
        const state = () => JSON.parse(sessionStorage.getItem('backup_retry_retry-backoff-growth'));
        expect(state().attempts).toBe(1);
        const firstDelay = state().nextAttemptAt - Date.now();

        await act(async () => {
            vi.advanceTimersByTime(5 * 60 * 1000);
            await channelState.check();
        });
        await flushPromises();
        expect(state().attempts).toBe(2);
        const secondDelay = state().nextAttemptAt - Date.now();
        expect(secondDelay).toBeGreaterThan(firstDelay);
        view.unmount();
    });

    it('does not repeat a backup after a completed request is delivered again by realtime', async () => {
        pendingRequest('already-completed');
        const view = renderBackupHook();
        await flushPromises();
        expect(backupQuery.update).toHaveBeenCalledTimes(1);

        await act(async () => { await channelState.callback({ new: { status: 'pending' } }); });
        await flushPromises();
        expect(backupQuery.update).toHaveBeenCalledTimes(1);
        view.unmount();
    });

    it('retries a failed request on a later reconciliation and never marks it completed without a remote copy', async () => {
        pendingRequest('retry-me');
        const view = renderBackupHook();
        await flushPromises();

        expect(backupQuery.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
        expect(backupQuery.pendingResult.data[0].status).toBe('failed');
        expect(backupQuery.in).toHaveBeenCalledWith('status', ['pending', 'failed']);

        await act(async () => {
            vi.advanceTimersByTime(5 * 60 * 1000);
            await channelState.check();
        });
        await flushPromises();
        expect(backupQuery.update).toHaveBeenCalledTimes(2);
        expect(backupQuery.update).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
        expect(backupQuery.observedStatuses).toEqual([['pending'], ['failed']]);
        expect(backupQuery.pendingResult.data[0].status).toBe('failed');
        view.unmount();
    });

    it('does not record a request as processed when the failed status write is rejected', async () => {
        pendingRequest('completion-rejected');
        backupQuery.updateResult = { error: new Error('status write rejected') };
        const view = renderBackupHook();
        await flushPromises();

        expect(backupQuery.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
        expect(sessionStorage.getItem('backup_processed_completion-rejected')).toBeNull();
        view.unmount();
    });

    it('marks the request failed with a reason when no remote destination exists', async () => {
        pendingRequest('no-remote-destination');
        const view = renderBackupHook();
        await flushPromises();

        // Este entorno no tiene CompressionStream: el respaldo no es .json.gz y Storage lo rechaza
        // sin llamar a red. Nunca se marca completed.
        expect(backupQuery.update).toHaveBeenCalledWith(
            expect.objectContaining({ status: 'failed', error: expect.stringContaining('no se sube a Storage') })
        );
        expect(backupQuery.update).not.toHaveBeenCalledWith(expect.objectContaining({ status: 'completed' }));
        expect(sessionStorage.getItem('backup_processed_no-remote-destination')).toBeNull();
        view.unmount();
    });

    it('does not read or process requests when the device has no Supabase session', async () => {
        pendingRequest('no-session');
        ensureSupervisorSession.mockResolvedValue({ session: null, error: new Error('anon sign-in rejected') });
        const view = renderBackupHook();
        await flushPromises();

        expect(ensureSupervisorSession).toHaveBeenCalled();
        expect(cloudClient.from).not.toHaveBeenCalledWith('backup_requests');
        expect(backupQuery.update).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith(
            '[AutoBackup] Sin sesión del dispositivo; se omite la revisión de solicitudes:',
            expect.any(Error)
        );
        view.unmount();
    });

    it('establishes the session before reading backup_requests', async () => {
        pendingRequest('session-first');
        const order = [];
        ensureSupervisorSession.mockImplementation(async () => {
            order.push('session');
            return { session: { user: { id: 'device-user' } }, error: null };
        });
        cloudClient.from.mockImplementation(() => {
            order.push('from');
            return backupQuery;
        });
        const view = renderBackupHook();
        await flushPromises();

        expect(order.indexOf('session')).toBeGreaterThanOrEqual(0);
        expect(order.indexOf('session')).toBeLessThan(order.indexOf('from'));
        cloudClient.from.mockImplementation(() => backupQuery);
        view.unmount();
    });

    it('does not mark a request completed when Supabase returns a read error', async () => {
        backupQuery.pendingResult = { data: null, error: new Error('read failed') };
        const view = renderBackupHook();
        await flushPromises();

        expect(backupQuery.update).not.toHaveBeenCalled();
        expect(console.error).toHaveBeenCalledWith('[AutoBackup] Error al procesar solicitud pendiente:', expect.any(Error));
        view.unmount();
    });

    it('cleans the polling watchdog and realtime subscription on unmount during an in-flight backup', async () => {
        pendingRequest('unmount-in-flight');
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');
        const setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
        const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval');
        const view = renderBackupHook();
        await flushPromises();

        expect(backupQuery.update).toHaveBeenCalledTimes(1);
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
