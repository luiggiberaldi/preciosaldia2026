// @vitest-environment jsdom

// ── Fase 2 del plan 2026-10-20: ningún error del servidor en silencio ────────
// Camino del incidente: órdenes guardadas en la cola local que mueren con un
// error del servidor (p. ej. "Ventana temporal inválida") al reenviarse. Hoy el
// resumen solo decía "N cambios subidos" / "Se descartaron…" y el motivo real se
// tragaba. Estas pruebas exigen que el texto crudo del servidor llegue a la UI.
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    state: {
        products: [],
        effectiveRate: 3664.2,
        copEnabled: false,
    },
    sendBatch: vi.fn(),
    planSpy: vi.fn(),
    toast: vi.fn(),
    triggerRefresh: vi.fn(),
    inspectImpl: async () => ({ state: 'absent' }),
}));

vi.mock('../src/config/supabaseCloud', () => ({
    supabaseCloud: {
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: () => Promise.resolve(),
    },
}));
vi.mock('../src/hooks/useCloudSync', () => ({ pushLocalSync: vi.fn(), pushCloudSync: vi.fn() }));
vi.mock('../src/utils/storageService', () => ({
    storageService: { getItem: vi.fn(async (_k, fallback) => fallback), setItem: vi.fn(async () => {}) },
}));
vi.mock('../src/components/Toast', () => ({ showToast: h.toast }));
vi.mock('../src/services/supervisorAuth', () => ({
    ensureSupervisorSession: vi.fn(async () => ({ session: { user: { id: 'auth-1' } }, error: null })),
}));
vi.mock('../src/services/supervisorCommandService', () => ({
    inspectSupervisorCommandState: vi.fn((...args) => h.inspectImpl(...args)),
    sendSupervisorCommand: vi.fn(async () => ({ ok: true })),
    claimSupervisorCommand: vi.fn(),
    fetchSupervisorCommandsForRecovery: vi.fn(async () => ({ data: [], error: null })),
    readSupervisorCommandAck: vi.fn(),
    SUPERVISOR_TERMINAL_COMMAND_STATUSES: [],
    withSupervisorCommandLock: vi.fn(async (_id, fn) => fn()),
}));
vi.mock('../src/hooks/useMonitorSync', () => ({
    useMonitorSync: () => ({
        isConnected: h.state.isConnected !== false,
        lastSync: null,
        loading: false,
        syncState: 'synced',
        stopMonitorSync: vi.fn(),
        syncError: null,
        triggerRefresh: h.triggerRefresh,
    }),
}));
vi.mock('../src/context/ProductContext', () => ({
    useProductContext: () => ({
        products: h.state.products,
        effectiveRate: h.state.effectiveRate,
        copEnabled: h.state.copEnabled,
    }),
}));
vi.mock('../src/hooks/useSupervisorControl', () => ({ useSupervisorControl: () => ({}) }));
vi.mock('../src/services/supervisorInventoryBatchSender', () => ({
    sendSupervisorInventoryBatch: h.sendBatch,
}));
vi.mock('../src/services/supervisorStockOps', async (importOriginal) => {
    const actual = await importOriginal();
    return {
        ...actual,
        planStockOpReconciliation: (...args) => {
            const plan = actual.planStockOpReconciliation(...args);
            h.planSpy(plan);
            return plan;
        },
    };
});

import OwnerMonitorView from '../src/views/OwnerMonitorView';
import { sendSupervisorCommand } from '../src/services/supervisorCommandService';
import {
    enqueueSupervisorCommand,
    resetSupervisorCommandQueue,
} from '../src/services/supervisorCommandQueue';

async function flush() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}

function enqueueCreate() {
    enqueueSupervisorCommand({
        type: 'supervisor.product.create',
        kind: 'generic',
        label: 'el alta de "Harina PAN 1kg"',
        payload: { product: { id: 'p-new', name: 'Harina PAN 1kg' } },
        targetDeviceId: 'device-1',
    });
}

describe('Fase 2 · la cola local nunca traga el error del servidor', () => {
    let container;
    let root;

    beforeEach(async () => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        localStorage.setItem('pda_paired_device_id', 'device-1');
        resetSupervisorCommandQueue();
        h.toast.mockReset();
        sendSupervisorCommand.mockReset();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        resetSupervisorCommandQueue();
        localStorage.clear();
        vi.useRealTimers();
    });

    it('(a) un create que resuelve ok:false al subir la cola muestra el texto EXACTO del servidor', async () => {
        enqueueCreate();
        sendSupervisorCommand.mockResolvedValue({ ok: false, status: 'failed', error: 'Ventana temporal inválida' });

        await act(async () => root.render(<OwnerMonitorView />));
        await flush();

        expect(sendSupervisorCommand).toHaveBeenCalledTimes(1);
        const notices = h.toast.mock.calls.filter(([, type]) => type === 'error');
        expect(notices.some(([message]) => String(message).includes('Ventana temporal inválida'))).toBe(true);
    });

    it('un error NUEVO del servidor se muestra aunque el mismo error previo ya se hubiera avisado', async () => {
        vi.useFakeTimers();
        enqueueCreate();
        sendSupervisorCommand.mockResolvedValue({ ok: false, status: 'failed', error: 'Ventana temporal inválida' });

        await act(async () => root.render(<OwnerMonitorView />));
        await flush();

        const errorNotices = () => h.toast.mock.calls.filter(([, type]) => type === 'error');
        expect(errorNotices().some(([message]) => String(message).includes('Ventana temporal inválida'))).toBe(true);
        const afterFirst = errorNotices().length;

        // El barrido automático de 30 s repite el MISMO error: no debe spamear…
        await act(async () => { vi.advanceTimersByTime(30_000); });
        await flush();
        expect(errorNotices().length).toBe(afterFirst);

        // …pero un error distinto del servidor SIEMPRE se muestra.
        sendSupervisorCommand.mockResolvedValue({ ok: false, status: 'failed', error: 'Timeout del servidor' });
        await act(async () => { vi.advanceTimersByTime(30_000); });
        await flush();
        expect(errorNotices().some(([message]) => String(message).includes('Timeout del servidor'))).toBe(true);
    });

    it('el botón SUBIR AL SISTEMA re-muestra el fallo aunque sea el mismo error (petición manual del usuario)', async () => {
        enqueueCreate();
        sendSupervisorCommand.mockResolvedValue({ ok: false, status: 'failed', error: 'Ventana temporal inválida' });

        await act(async () => root.render(<OwnerMonitorView />));
        await flush();

        const uploadButton = Array.from(container.querySelectorAll('button'))
            .find(button => button.textContent.includes('SUBIR AL SISTEMA'));
        expect(uploadButton).toBeTruthy();
        await act(async () => uploadButton.click());
        await flush();

        const notices = h.toast.mock.calls.filter(([, type]) => type === 'error');
        expect(notices.filter(([message]) => String(message).includes('Ventana temporal inválida')).length).toBeGreaterThanOrEqual(2);
    });
});
