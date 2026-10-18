// Diagnóstico de sincronización del supervisor: el estado que alimenta el panel
// (último eco con su watermark, eventos Realtime sin cuerpo 413 y los pulls de
// respaldo que los resolvieron) se deriva con funciones puras para poder
// probarlo sin montar el hook ni tocar la red.
import { describe, expect, it } from 'vitest';
import {
    createSyncDiagnosticsState,
    updateSyncDiagnostics,
} from '../src/services/supervisorSyncService';

describe('updateSyncDiagnostics', () => {
    it('arranca vacío: sin eco, sin eventos 413 ni pulls de respaldo', () => {
        const state = createSyncDiagnosticsState();
        expect(state).toEqual({
            lastEcho: null,
            oversizeEvents: 0,
            oversizePulls: 0,
            lastOversizeAt: null,
            lastOversizePullAt: null,
        });
    });

    it('registra el último eco con su watermark, origen y estado de aplicación', () => {
        const state = updateSyncDiagnostics(createSyncDiagnosticsState(), {
            type: 'echo',
            docId: 'bodega_products_v1',
            updatedAt: '2026-10-18T10:05:00.000Z',
            receivedAt: '2026-10-18T10:05:01.000Z',
            source: 'pull-413',
            applied: true,
        });
        expect(state.lastEcho).toEqual({
            docId: 'bodega_products_v1',
            updatedAt: '2026-10-18T10:05:00.000Z',
            receivedAt: '2026-10-18T10:05:01.000Z',
            source: 'pull-413',
            applied: true,
            error: null,
        });
    });

    it('el eco más reciente pisa al anterior', () => {
        const first = updateSyncDiagnostics(createSyncDiagnosticsState(), {
            type: 'echo', docId: 'bodega_products_v1', updatedAt: '2026-10-18T10:00:00.000Z', source: 'realtime', applied: true,
        });
        const second = updateSyncDiagnostics(first, {
            type: 'echo', docId: 'bodega_sales_v1', updatedAt: '2026-10-18T10:06:00.000Z', source: 'pull', applied: true,
        });
        expect(second.lastEcho.docId).toBe('bodega_sales_v1');
        expect(second.lastEcho.updatedAt).toBe('2026-10-18T10:06:00.000Z');
    });

    it('acumula eventos 413 y pulls de respaldo por separado', () => {
        let state = createSyncDiagnosticsState();
        for (let i = 0; i < 5; i += 1) {
            state = updateSyncDiagnostics(state, { type: 'oversize_event', at: `2026-10-18T10:0${i}:00.000Z` });
        }
        state = updateSyncDiagnostics(state, { type: 'oversize_pull', at: '2026-10-18T10:05:00.000Z' });

        // 5 eventos sin cuerpo pueden resolver con UN solo pull (throttle).
        expect(state.oversizeEvents).toBe(5);
        expect(state.oversizePulls).toBe(1);
        expect(state.lastOversizeAt).toBe('2026-10-18T10:04:00.000Z');
        expect(state.lastOversizePullAt).toBe('2026-10-18T10:05:00.000Z');
    });

    it('conserva el error de un eco descartado (p. ej. documento antiguo)', () => {
        const state = updateSyncDiagnostics(createSyncDiagnosticsState(), {
            type: 'echo',
            docId: 'bodega_products_v1',
            updatedAt: '2026-10-18T09:00:00.000Z',
            source: 'realtime',
            applied: false,
            error: 'Documento antiguo o repetido',
        });
        expect(state.lastEcho.applied).toBe(false);
        expect(state.lastEcho.error).toBe('Documento antiguo o repetido');
    });

    it('un evento desconocido devuelve la MISMA referencia (sin re-renders)', () => {
        const state = createSyncDiagnosticsState();
        expect(updateSyncDiagnostics(state, { type: 'desconocido' })).toBe(state);
        expect(updateSyncDiagnostics(state, null)).toBe(state);
    });
});
