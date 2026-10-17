// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
    const state = {
        statusCallback: null,
        removed: [],
        fetchCalls: 0,
    };
    const channel = {
        on() { return channel; },
        subscribe(cb) { state.statusCallback = cb; return channel; },
    };
    return {
        state,
        channel,
        client: {
            channel: () => channel,
            removeChannel: vi.fn((ch) => { state.removed.push(ch); return Promise.resolve(); }),
        },
        fetchRecovery: vi.fn(async () => {
            state.fetchCalls += 1;
            return { data: [], error: null };
        }),
    };
});

vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: h.client }));
vi.mock('../src/hooks/useCloudSync', () => ({ pushLocalSync: vi.fn(), pushCloudSync: vi.fn() }));
vi.mock('../src/utils/storageService', () => ({
    storageService: { getItem: vi.fn(async (_k, fb) => fb), setItem: vi.fn(async () => {}) },
}));
vi.mock('../src/hooks/store/useAuthStore', () => ({ useAuthStore: () => ({}) }));
vi.mock('../src/utils/withLock', () => ({ withLock: vi.fn(async (_n, fn) => fn()) }));
vi.mock('../src/components/Toast', () => ({ showToast: vi.fn() }));
vi.mock('../src/services/supervisorAuth', () => ({
    ensureSupervisorSession: vi.fn(async () => ({ session: { user: { id: 'auth-1' } }, error: null })),
}));
vi.mock('../src/services/supervisorCommandService', () => ({
    claimSupervisorCommand: vi.fn(),
    fetchSupervisorCommandsForRecovery: h.fetchRecovery,
    readSupervisorCommandAck: vi.fn(),
    SUPERVISOR_TERMINAL_COMMAND_STATUSES: [],
    withSupervisorCommandLock: vi.fn(async (_id, fn) => fn()),
}));
vi.mock('../src/services/supervisorInventoryCommand', () => ({
    applySupervisorInventoryBatchTransaction: vi.fn(),
    retryInventoryPublish: vi.fn(async () => ({ retried: false, ok: true })),
}));
vi.mock('../src/services/supervisorUserCommand', () => ({ applySupervisorUserCommand: vi.fn() }));

import { useRemoteCommands, RECOVERY_BASE_DELAY_MS } from '../src/hooks/useRemoteCommands';

function Harness({ deviceId = 'device-12345678', enabled = true }) {
    useRemoteCommands(deviceId, enabled);
    return null;
}

async function flush() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}

describe('useRemoteCommands: recuperacion con Realtime degradado', () => {
    let container;
    let root;

    beforeEach(async () => {
        vi.useFakeTimers();
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        h.state.statusCallback = null;
        h.state.removed.length = 0;
        h.state.fetchCalls = 0;
        h.fetchRecovery.mockClear();
        h.client.removeChannel.mockClear();
        localStorage.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root?.unmount());
        container?.remove();
        vi.useRealTimers();
    });

    async function mount() {
        await act(async () => root.render(<Harness />));
        await flush();
        expect(h.state.statusCallback).toBeTypeOf('function');
    }

    async function setStatus(status) {
        await act(async () => { h.state.statusCallback(status, null); });
    }

    it('SUBSCRIBED no programa recuperacion', async () => {
        await mount();
        // La consulta inicial de arranque no cuenta: se mide desde aquí.
        const baseline = h.state.fetchCalls;
        await setStatus('SUBSCRIBED');
        await act(async () => { vi.advanceTimersByTime(RECOVERY_BASE_DELAY_MS * 10); });
        await flush();
        expect(h.state.fetchCalls).toBe(baseline);
    });

    it('CHANNEL_ERROR programa una consulta de recuperacion y no se duplica', async () => {
        await mount();
        const baseline = h.state.fetchCalls;
        await setStatus('CHANNEL_ERROR');
        // Jitter: el delay real esta en [base, 2·base). Se avanza el maximo posible
        // para que la consulta ocurra sin depender del azar exacto.
        await act(async () => { vi.advanceTimersByTime(RECOVERY_BASE_DELAY_MS * 2); });
        await flush();
        expect(h.state.fetchCalls).toBeGreaterThanOrEqual(baseline + 1);
        const afterFirst = h.state.fetchCalls;
        // Una sola consulta en vuelo a la vez: avanzar un intervalo produce a lo sumo
        // una consulta nueva, nunca una rafaga por timers acumulados.
        await act(async () => { vi.advanceTimersByTime(RECOVERY_BASE_DELAY_MS * 2); });
        await flush();
        expect(h.state.fetchCalls - afterFirst).toBeLessThanOrEqual(1);
    });

    it('volver a SUBSCRIBED detiene la recuperacion pendiente', async () => {
        await mount();
        await setStatus('CHANNEL_ERROR');
        await setStatus('SUBSCRIBED');
        const before = h.state.fetchCalls;
        await act(async () => { vi.advanceTimersByTime(RECOVERY_BASE_DELAY_MS * 10); });
        await flush();
        expect(h.state.fetchCalls).toBe(before);
    });

    it('al desmontar se cancela el temporizador y se quita el canal', async () => {
        await mount();
        await setStatus('TIMED_OUT');
        await act(async () => root.unmount());
        const before = h.state.fetchCalls;
        await act(async () => { vi.advanceTimersByTime(RECOVERY_BASE_DELAY_MS * 10); });
        await flush();
        expect(h.state.fetchCalls).toBe(before);
        expect(h.client.removeChannel).toHaveBeenCalled();
    });

    it('al revocar el vinculo se cancela la recuperacion y se quita el canal', async () => {
        await mount();
        await setStatus('CHANNEL_ERROR');
        await act(async () => {
            window.dispatchEvent(new CustomEvent('supervisor_pairing_revoked', { detail: { deviceId: 'device-12345678' } }));
        });
        const before = h.state.fetchCalls;
        await act(async () => { vi.advanceTimersByTime(RECOVERY_BASE_DELAY_MS * 10); });
        await flush();
        expect(h.state.fetchCalls).toBe(before);
        expect(h.client.removeChannel).toHaveBeenCalled();
    });
});
