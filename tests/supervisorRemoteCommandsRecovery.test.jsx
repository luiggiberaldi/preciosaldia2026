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
vi.mock('../src/services/supervisorCommandService', async (importOriginal) => ({
    // Fase 3: getRecoveryDelayMs y sus constantes se movieron a este servicio
    // (el hook los re-exporta). El módulo real se trae de fondo para no perder
    // esas exportaciones; los overrides del test conservan su comportamiento.
    ...(await importOriginal()),
    claimSupervisorCommand: vi.fn(),
    fetchSupervisorCommandsForRecovery: h.fetchRecovery,
    readSupervisorCommandAck: vi.fn(),
    SUPERVISOR_TERMINAL_COMMAND_STATUSES: [],
    withSupervisorCommandLock: vi.fn(async (_id, fn) => fn()),
}));
vi.mock('../src/services/supervisorInventoryCommand', () => ({
    applySupervisorInventoryBatchTransaction: vi.fn(),
    retryInventoryPublish: vi.fn(async () => ({ retried: false, ok: true })),
    recoverSupervisorInventoryJournal: vi.fn(async () => ({ recovered: false, commandId: null, direction: null })),
}));
vi.mock('../src/services/supervisorUserCommand', () => ({ applySupervisorUserCommand: vi.fn() }));

import { useRemoteCommands, RECOVERY_BASE_DELAY_MS, RECEIVER_SWEEP_INTERVAL_MS } from '../src/hooks/useRemoteCommands';
import { ensureSupervisorSession } from '../src/services/supervisorAuth';

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
        delete document.visibilityState;
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

    it('SUBSCRIBED con canal silencioso barre de respaldo, una consulta por intervalo', async () => {
        await mount();
        // La consulta inicial de arranque no cuenta: se mide desde aquí.
        const baseline = h.state.fetchCalls;
        await setStatus('SUBSCRIBED');
        // El backoff no corre con SUBSCRIBED; el barrido de respaldo acota el
        // canal que dice conectado pero no entrega eventos (antes eso dejaba
        // las órdenes aplicándose solo al recargar la caja).
        await act(async () => { vi.advanceTimersByTime(RECEIVER_SWEEP_INTERVAL_MS); });
        await flush();
        expect(h.state.fetchCalls).toBe(baseline + 1);
        await act(async () => { vi.advanceTimersByTime(RECEIVER_SWEEP_INTERVAL_MS); });
        await flush();
        expect(h.state.fetchCalls).toBe(baseline + 2);
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

    it('volver a SUBSCRIBED detiene el backoff de recuperacion', async () => {
        await mount();
        await setStatus('CHANNEL_ERROR');
        await setStatus('SUBSCRIBED');
        const before = h.state.fetchCalls;
        // La ventana del backoff queda cancelada: no hay consultas por ella.
        // (El barrido de respaldo es aparte y corre en su propio intervalo.)
        await act(async () => { vi.advanceTimersByTime(RECOVERY_BASE_DELAY_MS * 2); });
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

    it('online adelanta la consulta de recuperacion con canal degradado', async () => {
        await mount();
        const baseline = h.state.fetchCalls;
        await setStatus('CHANNEL_ERROR');
        // El backoff todavía no consultó: el evento debe adelantar el barrido.
        expect(h.state.fetchCalls).toBe(baseline);
        await act(async () => { window.dispatchEvent(new Event('online')); });
        await flush();
        expect(h.state.fetchCalls).toBe(baseline + 1);
    });

    it('online con canal SUBSCRIBED barre por eventos perdidos durante el corte', async () => {
        await mount();
        await setStatus('SUBSCRIBED');
        const before = h.state.fetchCalls;
        // Los eventos de un corte no se reenvían: al volver la red se barre
        // aunque el canal siga diciendo conectado (igual que al recargar, pero
        // sin recargar).
        await act(async () => { window.dispatchEvent(new Event('online')); });
        await flush();
        expect(h.state.fetchCalls).toBe(before + 1);
    });

    it('la sesión no disponible al arrancar no deja el receptor mudo', async () => {
        const ensure = vi.mocked(ensureSupervisorSession);
        ensure.mockResolvedValueOnce({ session: null, error: new Error('sin red') });
        ensure.mockResolvedValueOnce({ session: null, error: new Error('sin red') });
        await act(async () => root.render(<Harness />));
        await flush();
        // Sin sesión no hay canal: el receptor NO queda suscrito…
        expect(h.state.statusCallback).toBe(null);
        const before = h.state.fetchCalls;
        // …pero el arranque se reintenta con backoff hasta suscribirse y
        // consultar (antes: mudo hasta la próxima recarga de la caja).
        await act(async () => { vi.advanceTimersByTime(RECOVERY_BASE_DELAY_MS * 2); });
        await flush();
        await act(async () => { vi.advanceTimersByTime(RECOVERY_BASE_DELAY_MS * 4); });
        await flush();
        expect(h.state.statusCallback).toBeTypeOf('function');
        expect(h.state.fetchCalls).toBeGreaterThan(before);
    });

    it('una rafaga de eventos de reconexion no duplica consultas', async () => {
        await mount();
        const baseline = h.state.fetchCalls;
        await setStatus('CHANNEL_ERROR');
        await act(async () => {
            window.dispatchEvent(new Event('online'));
            window.dispatchEvent(new Event('online'));
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await flush();
        // Una sola consulta a la vez: el semáforo absorbe la ráfaga.
        expect(h.state.fetchCalls).toBe(baseline + 1);
    });

    it('visibilitychange visible adelanta la consulta; oculto no consulta', async () => {
        await mount();
        const baseline = h.state.fetchCalls;
        await setStatus('CHANNEL_ERROR');

        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
        await flush();
        expect(h.state.fetchCalls).toBe(baseline);

        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
        await flush();
        expect(h.state.fetchCalls).toBe(baseline + 1);
    });

    it('tras desmontar, los eventos de reconexion no consultan', async () => {
        await mount();
        await setStatus('CHANNEL_ERROR');
        await act(async () => root.unmount());
        const before = h.state.fetchCalls;
        await act(async () => {
            window.dispatchEvent(new Event('online'));
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await flush();
        expect(h.state.fetchCalls).toBe(before);
    });
});
