// @vitest-environment jsdom

// Propuesta 8 (avisos de equipo) — Fases 2 y 3: cableado real.
// El canal único de `supervisor_commands` (useSupervisorControl) reenvía cada
// fila a useSupervisorTeamNotices, que clasifica, deduplica por commandId,
// agrupa ráfagas y emite el toast — con la pestaña Control CERRADA. Reglas:
//   - "un cambio = un aviso" (Realtime y barrido no duplican),
//   - los cambios propios NO avisan (el tracker ya los anuncia),
//   - tono informativo, nunca de error,
//   - el canal no se duplica al abrir/cerrar Control,
//   - sin emparejar: ni escucha ni consultas ni errores.
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    channels: [],
    realtime: {},
    commandRows: [],
    selectCalls: 0,
}));

vi.mock('../src/config/supabaseCloud', () => {
    const makeQuery = () => {
        h.selectCalls += 1;
        const result = Promise.resolve({ data: h.commandRows.map(row => ({ ...row })), error: null });
        const query = {
            eq: () => query,
            gte: () => query,
            order: () => query,
            limit: () => query,
            range: () => query,
            then: (onFulfilled, onRejected) => result.then(onFulfilled, onRejected),
        };
        return query;
    };
    return {
        supabaseCloud: {
            // Los RPC (conteos, cancelar) se llaman en el NIVEL SUPERIOR del
            // cliente, no sobre from(): por eso rpc vive aquí.
            rpc: async () => ({ data: [{ total: 0, pending: 0, applied: 0, warnings: 0, failed: 0, rejected: 0, cancelled: 0 }], error: null }),
            from: () => ({ select: makeQuery }),
            channel: (name) => {
                const callbacks = {};
                const channel = {
                    on: (_kind, params, callback) => {
                        callbacks[params.table] = callback;
                        return channel;
                    },
                    subscribe: (statusCallback) => {
                        h.channels.push({ name, callbacks });
                        h.realtime = callbacks;
                        statusCallback?.('SUBSCRIBED');
                        return channel;
                    },
                };
                return channel;
            },
            removeChannel: () => Promise.resolve(),
        },
    };
});

vi.mock('../src/services/supervisorAuth', () => ({
    ensureSupervisorSession: vi.fn(async () => ({ session: { user: { id: 'auth-mine' } }, error: null })),
}));

vi.mock('../src/services/supervisorCommandTracker', () => ({
    describeSupervisorCommand: vi.fn((type) => `descripción de ${type}`),
    trackSupervisorCommand: vi.fn(),
    isCommandOutcomeOwned: vi.fn(() => false),
}));

vi.mock('../src/components/Toast', () => ({
    showToast: vi.fn(),
    ToastProvider: ({ children }) => children,
    useToast: () => ({ showToast: vi.fn() }),
}));

import { useSupervisorTeamNotices } from '../src/hooks/useSupervisorTeamNotices';
import { useSupervisorControl } from '../src/hooks/useSupervisorControl';
import { showToast } from '../src/components/Toast';

function flush() {
    // Sesión → catch-up/clasificación: varios awaits encadenados; cada vuelta
    // despierta un nivel.
    return act(async () => {
        for (let i = 0; i < 12; i += 1) await Promise.resolve();
    });
}

const OTHER_ROW = {
    command_id: 'cmd-1',
    actor_auth_id: 'auth-other',
    command_type: 'supervisor.inventory.batch.adjust',
    status: 'pending',
    created_at: '2026-10-18T10:00:00.000Z',
    payload: { direction: 'ingreso', productName: 'Detodito Grande', quantityInput: 5, inputUnit: 'unidades' },
};

describe('avisos de equipo · cableado (propuesta 8)', () => {
    let container;
    let root;

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        vi.useFakeTimers();
        h.channels = [];
        h.realtime = {};
        h.commandRows = [];
        h.selectCalls = 0;
        vi.clearAllMocks();
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

    const Harness = ({ targetDeviceId, enabled }) => {
        const teamNotices = useSupervisorTeamNotices({ targetDeviceId });
        h.notices = teamNotices;
        useSupervisorControl({ targetDeviceId, enabled, onCommandRow: teamNotices.handleCommandRow });
        return null;
    };

    async function mountHarness({ targetDeviceId = 'device-caja', enabled = false } = {}) {
        await act(async () => root.render(<Harness targetDeviceId={targetDeviceId} enabled={enabled} />));
        await flush();
        await flush();
    }

    it('un INSERT de OTRO actor avisa con la pestaña Control CERRADA', async () => {
        await mountHarness({ enabled: false });
        expect(h.realtime.supervisor_commands).toBeTypeOf('function');

        await act(async () => {
            h.realtime.supervisor_commands({ eventType: 'INSERT', new: OTHER_ROW });
        });
        await flush();
        await act(async () => { vi.advanceTimersByTime(5000); });
        await flush();

        expect(showToast).toHaveBeenCalledTimes(1);
        const [message, tone] = showToast.mock.calls[0];
        expect(message).toContain('Otro supervisor actualizó el inventario');
        expect(message).toContain('Detodito Grande');
        expect(tone).toBe('info');
    });

    it('mis propios cambios NUNCA generan aviso de equipo', async () => {
        await mountHarness({ enabled: false });
        await act(async () => {
            h.realtime.supervisor_commands({ eventType: 'INSERT', new: { ...OTHER_ROW, actor_auth_id: 'auth-mine' } });
        });
        await flush();
        await act(async () => { vi.advanceTimersByTime(5000); });
        await flush();

        expect(showToast).not.toHaveBeenCalled();
    });

    it('un UPDATE del mismo commandId no duplica el aviso (un cambio = un aviso)', async () => {
        await mountHarness({ enabled: false });
        await act(async () => {
            h.realtime.supervisor_commands({ eventType: 'INSERT', new: OTHER_ROW });
            h.realtime.supervisor_commands({ eventType: 'UPDATE', new: { ...OTHER_ROW, status: 'applied' } });
        });
        await flush();
        await act(async () => { vi.advanceTimersByTime(5000); });
        await flush();

        expect(showToast).toHaveBeenCalledTimes(1);
    });

    it('sin caja emparejada no hay escucha ni consultas', async () => {
        await mountHarness({ targetDeviceId: null });
        expect(h.channels.length).toBe(0);
        expect(h.selectCalls).toBe(0);
        expect(showToast).not.toHaveBeenCalled();
    });

    it('abrir y cerrar la pestaña Control no duplica el canal Realtime', async () => {
        await mountHarness({ enabled: false });
        expect(h.channels.length).toBe(1);

        await act(async () => root.render(<Harness targetDeviceId="device-caja" enabled />));
        await flush();
        await act(async () => root.render(<Harness targetDeviceId="device-caja" enabled={false} />));
        await flush();

        expect(h.channels.length).toBe(1);
    });

    it('una ráfaga de 3 cambios produce UN aviso agrupado, no 3 toasts', async () => {
        await mountHarness({ enabled: false });
        await act(async () => {
            h.realtime.supervisor_commands({ eventType: 'INSERT', new: OTHER_ROW });
            h.realtime.supervisor_commands({ eventType: 'INSERT', new: { ...OTHER_ROW, command_id: 'cmd-2', created_at: '2026-10-18T10:00:01.000Z' } });
            h.realtime.supervisor_commands({ eventType: 'INSERT', new: { ...OTHER_ROW, command_id: 'cmd-3', created_at: '2026-10-18T10:00:02.000Z' } });
        });
        await flush();
        await act(async () => { vi.advanceTimersByTime(5000); });
        await flush();

        expect(showToast).toHaveBeenCalledTimes(1);
        expect(showToast.mock.calls[0][0]).toContain('3 cambios de otro supervisor mientras no estabas');
    });

    it('el catch-up avisa "mientras no estabas" y una repetición no vuelve a avisar', async () => {
        h.commandRows = [
            { ...OTHER_ROW, command_id: 'cmd-a', status: 'applied' },
            { ...OTHER_ROW, command_id: 'cmd-b', status: 'applied_with_warnings', created_at: '2026-10-18T09:59:00.000Z' },
        ];
        await mountHarness({ enabled: false });

        expect(showToast).toHaveBeenCalledTimes(1);
        expect(showToast.mock.calls[0][0]).toContain('2 cambios de otro supervisor mientras no estabas');

        // Reconexión/repetición tras pasar el mínimo entre barridos: silencio,
        // los mismos commandId ya están vistos.
        await act(async () => { vi.advanceTimersByTime(61_000); });
        await act(async () => { await h.notices.runCatchUp(); });
        await flush();
        expect(showToast).toHaveBeenCalledTimes(1);
    });

    it('el catch-up solo cuenta actividad real (cancelados y fallidos no son "cambios")', async () => {
        h.commandRows = [
            { ...OTHER_ROW, command_id: 'cmd-ok', status: 'applied' },
            { ...OTHER_ROW, command_id: 'cmd-cancelled', status: 'cancelled' },
            { ...OTHER_ROW, command_id: 'cmd-failed', status: 'failed' },
        ];
        await mountHarness({ enabled: false });

        expect(showToast).toHaveBeenCalledTimes(1);
        const [message] = showToast.mock.calls[0];
        expect(message).toContain('Otro supervisor actualizó el inventario');
        expect(message).not.toContain('cambios de otro supervisor');
    });
});
