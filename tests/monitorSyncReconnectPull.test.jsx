// @vitest-environment jsdom

// Fix del egress (REPORTE-CAUSA-RAIZ-EGRESS): `initMonitor` pedía
// `pullDocuments({ full: true })` en CADA arranque y reconexión, descargando el
// paquete completo (~1 MB) aunque nada hubiera cambiado. Con la política
// shouldPullFullSync, solo la primera carga y el resync periódico bajan el
// paquete; las reconexiones usan el pull incremental por watermark. Este suite
// cubre exactamente eso, más la telemetría de bytes que lo hace visible.
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import localforage from 'localforage';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    selectCalls: [],
    inArgs: [],
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
            in: (...args) => { h.inArgs.push(args); return query; },
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
    MONITOR_FULL_SYNC_AT_KEY,
} from '../src/services/supervisorSyncService';

function flush() {
    // La cadena de arranque del hook (sesión → pull → suscripción) tiene varios
    // awaits encadenados; cada vuelta despierta un nivel.
    return act(async () => {
        for (let i = 0; i < 12; i += 1) await Promise.resolve();
    });
}

const PRODUCTS_UPDATED_AT = '2026-10-23T10:00:00.000Z';
const products = [{ id: 'p1', name: 'Prueba', stock: 10 }];

function seedProductsDoc(updatedAt = PRODUCTS_UPDATED_AT) {
    h.metadataRows = [{ collection: 'store', doc_id: 'bodega_products_v1', updated_at: updatedAt }];
    h.payloadRows = [{
        collection: 'store',
        doc_id: 'bodega_products_v1',
        data: buildSyncEnvelope(products, updatedAt),
        updated_at: updatedAt,
    }];
}

describe('useMonitorSync · política full vs incremental del pull', () => {
    let container;
    let root;

    beforeEach(async () => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        vi.useFakeTimers();
        h.selectCalls = [];
        h.inArgs = [];
        h.metadataRows = [];
        h.payloadRows = [];
        h.realtime = {};
        localStorage.clear();
        await localforage.removeItem('bodega_products_v1');
        await localforage.removeItem('pda_products_stock_baseline_v1');
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

    it('la primera carga sí baja el paquete completo y marca el resync', async () => {
        seedProductsDoc();
        await mountMonitor();

        expect(h.selectCalls.some(columns => columns.includes('data'))).toBe(true);
        expect(h.sync.syncDiagnostics.lastPull).toMatchObject({ full: true, docs: 1, source: 'pull' });
        expect(h.sync.syncDiagnostics.lastPull.bytes).toBeGreaterThan(0);
        expect(localStorage.getItem(MONITOR_FULL_SYNC_AT_KEY)).toBeTypeOf('string');
    });

    it('una reconexión con el eco al día solo consulta metadatos (0 bytes de payload)', async () => {
        seedProductsDoc();
        await mountMonitor();
        h.selectCalls = [];

        await act(async () => { await h.sync.triggerRefresh(); });
        await flush();

        // Sin cambios remotos: una sola consulta, de metadatos.
        expect(h.selectCalls).toHaveLength(1);
        expect(h.selectCalls[0]).not.toContain('data');
        expect(h.sync.syncDiagnostics.lastPull).toMatchObject({ full: false, docs: 0, bytes: 0 });
    });

    it('la reconexión con un documento cambiado baja SOLO ese payload (incremental)', async () => {
        seedProductsDoc();
        await mountMonitor();
        h.selectCalls = [];
        h.inArgs = [];

        // La caja actualizó el doc; el watermark local quedó atrás.
        seedProductsDoc('2026-10-23T11:00:00.000Z');

        await act(async () => { await h.sync.triggerRefresh(); });
        await flush();

        // Hubo payload… pero filtrado al doc con watermark antiguo.
        expect(h.selectCalls.some(columns => columns.includes('data'))).toBe(true);
        expect(h.inArgs).toContainEqual(['doc_id', ['bodega_products_v1']]);
        expect(h.sync.syncDiagnostics.lastPull).toMatchObject({ full: false, docs: 1 });
        expect(h.sync.syncDiagnostics.lastPull.bytes).toBeGreaterThan(0);
    });

    it('pasado el intervalo, la reconexión reintegra el paquete completo (borrados remotos)', async () => {
        seedProductsDoc();
        await mountMonitor();

        // Sin cambios de watermark, pero el último full es anterior al intervalo.
        localStorage.setItem(MONITOR_FULL_SYNC_AT_KEY, new Date(Date.now() - 25 * 60 * 60_000).toISOString());
        h.selectCalls = [];

        await act(async () => { await h.sync.triggerRefresh(); });
        await flush();

        expect(h.selectCalls.some(columns => columns.includes('data'))).toBe(true);
        expect(h.sync.syncDiagnostics.lastPull).toMatchObject({ full: true, docs: 1 });
    });
});
