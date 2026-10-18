// @vitest-environment jsdom

// Regresión del bug de producción (mismo C1 que Donde Juancho ya padeció y
// arregló): Supabase Realtime entrega el registro VACÍO con
// `errors: ['Error 413: Payload Too Large']` cuando `sync_documents.data`
// supera max_record_bytes (~1 MB). Con un catálogo de miles de productos ese es
// el caso normal de `bodega_products_v1`. Nuestro handler se tragaba el evento
// sin cuerpo y, como el canal se ve "conectado", el pull de recuperación (5 min,
// solo sin Realtime) nunca corría: el supervisor se quedaba sin el descuento de
// stock de las ventas PARA SIEMPRE. Regla de la casa: un evento sin cuerpo jamás
// se descarta sin respaldo — pull con throttle (3 s) que cubre la ráfaga.
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
import { buildSyncEnvelope } from '../src/services/supervisorSyncService';

function flush() {
    // La cadena de arranque del hook (sesión → pull → suscripción) tiene varios
    // awaits encadenados; cada vuelta despierta un nivel.
    return act(async () => {
        for (let i = 0; i < 12; i += 1) await Promise.resolve();
    });
}

describe('useMonitorSync · evento Realtime sin cuerpo (413) nunca se pierde', () => {
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
        // Captura el valor del hook en cada render para poder inspeccionar el
        // diagnóstico de sincronización desde las pruebas.
        h.sync = useMonitorSync(deviceId);
        return null;
    };

    async function mountMonitor() {
        await act(async () => root.render(<Probe deviceId="device-caja" />));
        await flush();
        await flush();
        expect(h.realtime.sync_documents).toBeTypeOf('function');
    }

    it('un evento 413 dispara un pull de respaldo y el cambio termina aplicado (≤3 s)', async () => {
        await mountMonitor();
        const selectsBefore = h.selectCalls.length;

        // Realtime avisa que `bodega_products_v1` cambió, pero sin cuerpo.
        await act(async () => {
            h.realtime.sync_documents({
                eventType: 'UPDATE',
                new: {},
                errors: ['Error 413: Payload Too Large'],
            });
        });
        await flush();

        // Sin el fix: el evento se tragaba y jamás había pull. Con el fix: el
        // pull (con throttle de 3 s) trae el documento por PostgREST y lo aplica.
        const products = [{ id: 'p1', name: 'Prueba', stock: 105 }];
        h.metadataRows = [{ collection: 'store', doc_id: 'bodega_products_v1', updated_at: '2026-10-18T10:05:00.000Z' }];
        h.payloadRows = [{
            collection: 'store',
            doc_id: 'bodega_products_v1',
            data: buildSyncEnvelope(products, '2026-10-18T10:05:00.000Z'),
            updated_at: '2026-10-18T10:05:00.000Z',
        }];

        await act(async () => { vi.advanceTimersByTime(3000); });
        await flush();

        // Hubo pull (al menos una consulta más a sync_documents)…
        expect(h.selectCalls.length).toBeGreaterThan(selectsBefore);
        // …y el stock descontado por la venta quedó aplicado en el monitor.
        expect(await localforage.getItem('bodega_products_v1')).toEqual(products);

        // El diagnóstico del panel ve el mismo flujo: 1 evento 413, 1 pull de
        // respaldo y el eco aplicado con su watermark por la vía de respaldo.
        expect(h.sync.syncDiagnostics.oversizeEvents).toBe(1);
        expect(h.sync.syncDiagnostics.oversizePulls).toBe(1);
        expect(h.sync.syncDiagnostics.lastOversizePullAt).toBeTypeOf('string');
        expect(h.sync.syncDiagnostics.lastEcho).toMatchObject({
            docId: 'bodega_products_v1',
            updatedAt: '2026-10-18T10:05:00.000Z',
            source: 'pull-413',
            applied: true,
        });
    });

    it('una ráfaga de eventos 413 produce UN solo pull (throttle)', async () => {
        await mountMonitor();
        const selectsBefore = h.selectCalls.length;

        await act(async () => {
            for (let i = 0; i < 5; i += 1) {
                h.realtime.sync_documents({ eventType: 'UPDATE', new: {}, errors: ['Error 413: Payload Too Large'] });
            }
        });
        await flush();
        await act(async () => { vi.advanceTimersByTime(3000); });
        await flush();

        // Un solo pull de respaldo: la consulta de metadatos del pull incremental.
        expect(h.selectCalls.length - selectsBefore).toBe(1);

        // El diagnóstico distingue la ráfaga (5 eventos) del pull único.
        expect(h.sync.syncDiagnostics.oversizeEvents).toBe(5);
        expect(h.sync.syncDiagnostics.oversizePulls).toBe(1);
    });

    it('un evento completo se aplica por Realtime sin pull adicional', async () => {
        await mountMonitor();
        const selectsBefore = h.selectCalls.length;
        const products = [{ id: 'p1', name: 'Prueba', stock: 105 }];
        const updatedAt = '2026-10-18T10:05:00.000Z';

        await act(async () => {
            h.realtime.sync_documents({
                eventType: 'UPDATE',
                new: {
                    collection: 'store',
                    doc_id: 'bodega_products_v1',
                    data: buildSyncEnvelope(products, updatedAt),
                    updated_at: updatedAt,
                },
            });
        });
        await flush();

        expect(await localforage.getItem('bodega_products_v1')).toEqual(products);
        // Sin pull: el cuerpo llegó completo y se aplicó directo.
        expect(h.selectCalls.length).toBe(selectsBefore);

        // El eco entra por Realtime, sin eventos 413 ni pulls de respaldo.
        expect(h.sync.syncDiagnostics.oversizeEvents).toBe(0);
        expect(h.sync.syncDiagnostics.oversizePulls).toBe(0);
        expect(h.sync.syncDiagnostics.lastEcho).toMatchObject({
            docId: 'bodega_products_v1',
            updatedAt,
            source: 'realtime',
            applied: true,
        });
    });

    it('un DELETE no dispara pull (los documentos no se borran en el flujo normal)', async () => {
        await mountMonitor();
        const selectsBefore = h.selectCalls.length;

        await act(async () => {
            h.realtime.sync_documents({ eventType: 'DELETE', old: { doc_id: 'bodega_products_v1' }, new: {} });
        });
        await flush();
        await act(async () => { vi.advanceTimersByTime(3000); });
        await flush();

        expect(h.selectCalls.length).toBe(selectsBefore);
    });
});
