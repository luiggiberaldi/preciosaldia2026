// @vitest-environment jsdom

// Plan de egress Realtime F3 y F4.
//  - F4: con la tabla `sync_document_events` disponible, el supervisor escucha
//    SOLO avisos livianos (no las filas completas de `sync_documents`) y baja
//    por PostgREST, en una sola descarga por ráfaga, los docs avisados.
//  - D3: con la pestaña oculta no baja nada; baja al volver.
//  - F3: si la pestaña sigue oculta 2 min, suelta su conexión de Realtime y al
//    volver se reconecta con un pull incremental.
//  - Sin la tabla (migración no aplicada) sigue en el modo anterior.
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import localforage from 'localforage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    eventsTableMissing: false,
    payloadRequests: [],
    metadataRequests: 0,
    rows: new Map(),
    channels: [],
    removed: 0,
}));

vi.mock('../src/config/supabaseCloud', () => {
    const from = (table) => {
        const q = { table, columns: '', filters: {} };
        const run = () => {
            if (table === 'sync_document_events') {
                return h.eventsTableMissing
                    ? { data: null, error: { code: '42P01', message: 'relation "sync_document_events" does not exist' } }
                    : { data: [], error: null };
            }
            if (table !== 'sync_documents') return { data: [], error: null };
            const all = [...h.rows.values()];
            if (q.columns.includes('data')) {
                const ids = q.filters.doc_id || [];
                h.payloadRequests.push([...ids]);
                return { data: all.filter((r) => ids.includes(r.doc_id)).map((r) => ({ ...r })), error: null };
            }
            h.metadataRequests += 1;
            return { data: all.map(({ collection, doc_id, updated_at }) => ({ collection, doc_id, updated_at })), error: null };
        };
        const api = {
            select(columns) { q.columns = columns; return api; },
            eq() { return api; },
            in(key, value) { q.filters[key] = value; return api; },
            limit() { return api; },
            then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
        };
        return api;
    };
    return {
        supabaseCloud: {
            from,
            channel: () => {
                const handlers = {};
                const channel = {
                    handlers,
                    on: (_kind, params, callback) => {
                        handlers[params.table] = callback;
                        return channel;
                    },
                    subscribe: (statusCallback) => {
                        channel.statusCallback = statusCallback;
                        statusCallback?.('SUBSCRIBED');
                        return channel;
                    },
                };
                h.channels.push(channel);
                return channel;
            },
            removeChannel: (channel) => {
                // Como supabase-js: un canal se cierra (y avisa CLOSED) una sola vez.
                if (!channel || channel.closed) return Promise.resolve();
                channel.closed = true;
                h.removed += 1;
                channel.statusCallback?.('CLOSED');
                return Promise.resolve();
            },
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

import {
    MONITOR_HIDDEN_RELEASE_MS,
    SYNC_NOTIFY_COALESCE_MS,
    resetSyncEventsSupportForTests,
    useMonitorSync,
} from '../src/hooks/useMonitorSync';
import { buildSyncEnvelope } from '../src/services/supervisorSyncService';

let visibility = 'visible';
Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });

function setVisibility(value) {
    visibility = value;
    document.dispatchEvent(new Event('visibilitychange'));
}

function flush() {
    return act(async () => {
        for (let i = 0; i < 15; i += 1) await Promise.resolve();
    });
}

function putDoc(docId, payload, updatedAt) {
    h.rows.set(docId, {
        collection: 'store',
        doc_id: docId,
        data: buildSyncEnvelope(payload, updatedAt),
        updated_at: updatedAt,
    });
}

function notify(docId, updatedAt) {
    const channel = h.channels.at(-1);
    channel.handlers.sync_document_events({ new: { device_id: 'caja', collection: 'store', doc_id: docId, updated_at: updatedAt, bytes: 120 } });
}

describe('useMonitorSync · avisos livianos (egress F4) y pestaña oculta (F3)', () => {
    let container;
    let root;

    beforeEach(async () => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        vi.useFakeTimers();
        resetSyncEventsSupportForTests();
        h.eventsTableMissing = false;
        h.payloadRequests = [];
        h.metadataRequests = 0;
        h.rows = new Map();
        h.channels = [];
        h.removed = 0;
        visibility = 'visible';
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

    const Probe = () => {
        h.sync = useMonitorSync('caja');
        return null;
    };

    async function mount() {
        await act(async () => root.render(<Probe />));
        await flush();
        await flush();
    }

    it('escucha solo avisos y baja una sola vez una ráfaga del mismo doc', async () => {
        await mount();
        const channel = h.channels.at(-1);
        expect(Object.keys(channel.handlers).sort()).toEqual(['device_pairings', 'sync_document_events']);
        expect(h.sync.syncDiagnostics).toBeTruthy();

        const products = [{ id: 'p1', name: 'Prueba', stock: 7 }];
        for (let i = 0; i < 10; i += 1) {
            const at = `2026-11-14T15:00:0${i}.000Z`;
            putDoc('bodega_products_v1', products, at);
            notify('bodega_products_v1', at);
        }
        await flush();
        expect(h.payloadRequests).toEqual([]);

        await act(async () => { vi.advanceTimersByTime(SYNC_NOTIFY_COALESCE_MS); });
        await flush();
        expect(h.payloadRequests).toEqual([['bodega_products_v1']]);
        expect(await localforage.getItem('bodega_products_v1')).toEqual(products);

        // Un aviso repetido (ya aplicado) no vuelve a bajar nada.
        notify('bodega_products_v1', '2026-11-14T15:00:09.000Z');
        await act(async () => { vi.advanceTimersByTime(SYNC_NOTIFY_COALESCE_MS); });
        await flush();
        expect(h.payloadRequests).toHaveLength(1);
    });

    it('ignora avisos de docs fuera de contrato', async () => {
        await mount();
        notify('abasto-auth-storage', '2026-11-14T15:00:00.000Z');
        await act(async () => { vi.advanceTimersByTime(SYNC_NOTIFY_COALESCE_MS); });
        await flush();
        expect(h.payloadRequests).toEqual([]);
    });

    it('con la pestaña oculta no baja nada y baja una vez al volver', async () => {
        await mount();
        setVisibility('hidden');
        putDoc('bodega_products_v1', [{ id: 'p1', stock: 3 }], '2026-11-14T15:00:00.000Z');
        notify('bodega_products_v1', '2026-11-14T15:00:00.000Z');
        await act(async () => { vi.advanceTimersByTime(SYNC_NOTIFY_COALESCE_MS * 5); });
        await flush();
        expect(h.payloadRequests).toEqual([]);

        setVisibility('visible');
        await flush();
        await flush();
        expect(h.payloadRequests).toContainEqual(['bodega_products_v1']);
        expect(await localforage.getItem('bodega_products_v1')).toEqual([{ id: 'p1', stock: 3 }]);
    });

    it('oculta más de 2 min suelta el canal sin reintentar y al volver se reconecta', async () => {
        await mount();
        const channelsBefore = h.channels.length;
        setVisibility('hidden');
        await act(async () => { vi.advanceTimersByTime(MONITOR_HIDDEN_RELEASE_MS); });
        await flush();
        expect(h.removed).toBe(1);

        // Mucho rato oculta: ningún reintento ni canal nuevo.
        await act(async () => { vi.advanceTimersByTime(10 * 60_000); });
        await flush();
        expect(h.channels.length).toBe(channelsBefore);

        // Al volver: pull incremental (metadatos) y canal nuevo.
        const metadataBefore = h.metadataRequests;
        setVisibility('visible');
        await flush();
        await flush();
        expect(h.metadataRequests).toBeGreaterThan(metadataBefore);
        expect(h.channels.length).toBe(channelsBefore + 1);
        expect(h.sync.syncState).toBe('connected');
    });

    it('volver antes de 2 min no suelta el canal', async () => {
        await mount();
        setVisibility('hidden');
        await act(async () => { vi.advanceTimersByTime(MONITOR_HIDDEN_RELEASE_MS - 1_000); });
        setVisibility('visible');
        await act(async () => { vi.advanceTimersByTime(MONITOR_HIDDEN_RELEASE_MS); });
        await flush();
        expect(h.removed).toBe(0);
    });

    it('sin la tabla de avisos sigue escuchando sync_documents (modo anterior)', async () => {
        h.eventsTableMissing = true;
        await mount();
        const channel = h.channels.at(-1);
        expect(Object.keys(channel.handlers).sort()).toEqual(['device_pairings', 'sync_documents']);
    });
});
