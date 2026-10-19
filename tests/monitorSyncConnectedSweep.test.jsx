// @vitest-environment jsdom

// Hueco simétrico al del receptor de la caja (tests/supervisorRemoteCommandsRecovery):
// un canal Realtime que dice SUBSCRIBED pero no entrega eventos (socket a
// medias, pestaña restringida, eventos perdidos durante un corte) dejaba el eco
// de la caja aplicándose solo al recargar el Supervisor. Este suite cubre el
// barrido de respaldo conectado: corre el pull incremental cada
// MONITOR_CONNECTED_SWEEP_INTERVAL_MS y también al volver a la pestaña.
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import localforage from 'localforage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    selectCalls: [],
    metadataRows: [],
    payloadRows: [],
    realtime: {},
}));

vi.mock('../src/config/supabaseCloud', () => {
    const makeQuery = (columns) => {
        h.selectCalls.push(columns);
        const rows = columns.includes('data') ? h.payloadRows : h.metadataRows;
        // La cadena real es .select().eq().in().in() y el await cae sobre el
        // último eslabón: el stub debe ser a la vez encadenable y thenable.
        const result = Promise.resolve({ data: rows.map(row => ({ ...row })), error: null });
        const query = {
            eq: () => query,
            in: () => query,
            then: (onFulfilled, onRejected) => result.then(onFulfilled, onRejected),
        };
        return query;
    };
    return {
        supabaseCloud: {
            from: () => ({ select: makeQuery }),
            channel: () => {
                const callbacks = {};
                const channel = {
                    on: (_kind, params, callback) => {
                        callbacks[params.table] = callback;
                        return channel;
                    },
                    subscribe: (statusCallback) => {
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
    ensureSupervisorSession: vi.fn(async () => ({ session: { user: { id: 'auth-1' } }, error: null })),
}));

vi.mock('../src/services/supervisorPairingState', () => ({
    readPairingRow: vi.fn(async () => ({ data: null, error: null })),
    isMonitorPairingActive: vi.fn(() => true),
    isPrimaryPairingActive: vi.fn(() => true),
}));

import { useMonitorSync } from '../src/hooks/useMonitorSync';
import {
    buildSyncEnvelope,
    MONITOR_CONNECTED_SWEEP_INTERVAL_MS,
} from '../src/services/supervisorSyncService';

function flush() {
    // La cadena de arranque del hook (sesión → pull → suscripción) tiene varios
    // awaits encadenados; cada vuelta despierta un nivel.
    return act(async () => {
        for (let i = 0; i < 12; i += 1) await Promise.resolve();
    });
}

describe('useMonitorSync · barrido de respaldo con Realtime conectado', () => {
    let container;
    let root;

    beforeEach(async () => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        vi.useFakeTimers();
        h.selectCalls = [];
        h.metadataRows = [];
        h.payloadRows = [];
        h.realtime = {};
        localStorage.clear();
        await localforage.removeItem('bodega_products_v1');
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root?.unmount());
        container?.remove();
        vi.useRealTimers();
    });

    const Probe = ({ deviceId }) => {
        h.sync = useMonitorSync(deviceId);
        return null;
    };

    async function mountMonitor() {
        await act(async () => root.render(<Probe deviceId="device-caja" />));
        await flush();
        await flush();
        expect(h.realtime.sync_documents).toBeTypeOf('function');
    }

    it('con el canal en silencio, el barrido trae el eco y lo aplica sin recargar', async () => {
        await mountMonitor();

        // La caja publicó un doc más nuevo, pero el evento nunca llegó.
        const products = [{ id: 'p1', name: 'Prueba', stock: 105 }];
        const updatedAt = '2026-10-19T10:05:00.000Z';
        h.metadataRows = [{ collection: 'store', doc_id: 'bodega_products_v1', updated_at: updatedAt }];
        h.payloadRows = [{
            collection: 'store',
            doc_id: 'bodega_products_v1',
            data: buildSyncEnvelope(products, updatedAt),
            updated_at: updatedAt,
        }];

        await act(async () => { vi.advanceTimersByTime(MONITOR_CONNECTED_SWEEP_INTERVAL_MS); });
        await flush();

        // El eco del descuento quedó aplicado en el monitor sin recargar.
        expect(await localforage.getItem('bodega_products_v1')).toEqual(products);
        // Y el panel de diagnóstico lo ve como barrido (no como evento realtime).
        expect(h.sync.syncDiagnostics.lastEcho).toMatchObject({
            docId: 'bodega_products_v1',
            updatedAt,
            source: 'sweep',
            applied: true,
        });
    });

    it('con el eco al día el barrido solo consulta metadatos (sin payload)', async () => {
        await mountMonitor();
        const selectsAfterMount = h.selectCalls.length;

        await act(async () => { vi.advanceTimersByTime(MONITOR_CONNECTED_SWEEP_INTERVAL_MS); });
        await flush();

        const newSelects = h.selectCalls.slice(selectsAfterMount);
        // Una sola consulta por barrido…
        expect(newSelects).toHaveLength(1);
        // …y de metadatos: sin cambios remotos no se baja ningún payload.
        expect(newSelects[0]).not.toContain('data');
    });

    it('al volver a la pestaña se barre al instante (eventos perdidos no se reenvían)', async () => {
        await mountMonitor();
        const selectsAfterMount = h.selectCalls.length;

        Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
        await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
        await flush();
        expect(h.selectCalls.length).toBe(selectsAfterMount);

        Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
        await act(async () => { document.dispatchEvent(new Event('visibilitychange')); });
        await flush();
        expect(h.selectCalls.length).toBe(selectsAfterMount + 1);
    });

    it('tras desmontar, el barrido programado ya no consulta', async () => {
        await mountMonitor();
        await act(async () => root.unmount());
        const selectsAfterUnmount = h.selectCalls.length;

        await act(async () => { vi.advanceTimersByTime(MONITOR_CONNECTED_SWEEP_INTERVAL_MS * 2); });
        await flush();
        expect(h.selectCalls.length).toBe(selectsAfterUnmount);
    });
});
