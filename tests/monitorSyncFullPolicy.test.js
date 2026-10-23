// Política de pull completo vs incremental (shouldPullFullSync). El pull
// completo descarga la columna `data` de todos los documentos permitidos y fue
// el mayor componente del egress de PostgREST (REPORTE-CAUSA-RAIZ-EGRESS,
// 2026-10-23): solo corresponde en la primera carga y en el resync periódico
// que cubre los borrados remotos (los watermarks no los detectan). Puro: sin
// hook, sin red.
import { describe, expect, it } from 'vitest';
import {
    FULL_SYNC_INTERVAL_MS,
    shouldPullFullSync,
} from '../src/services/supervisorSyncService';

const NOW = Date.parse('2026-10-23T12:00:00.000Z');

describe('shouldPullFullSync', () => {
    it('primera carga sin historial local → pull completo', () => {
        expect(shouldPullFullSync({ hasLocalHistory: false, lastFullSyncAt: null, now: NOW })).toBe(true);
    });

    it('con historial y un full reciente → pull incremental (las reconexiones no bajan el paquete)', () => {
        expect(shouldPullFullSync({
            hasLocalHistory: true,
            lastFullSyncAt: NOW - 60_000,
            now: NOW,
        })).toBe(false);
    });

    it('con historial sin marca de full (clientes previos a la política) → un full de adopción', () => {
        expect(shouldPullFullSync({ hasLocalHistory: true, lastFullSyncAt: null, now: NOW })).toBe(true);
        expect(shouldPullFullSync({ hasLocalHistory: true, lastFullSyncAt: Number.NaN, now: NOW })).toBe(true);
        expect(shouldPullFullSync({ hasLocalHistory: true, lastFullSyncAt: 0, now: NOW })).toBe(true);
    });

    it('con el full más viejo que el intervalo → resync completo (cubre borrados remotos)', () => {
        expect(shouldPullFullSync({
            hasLocalHistory: true,
            lastFullSyncAt: NOW - FULL_SYNC_INTERVAL_MS - 1,
            now: NOW,
        })).toBe(true);
        expect(shouldPullFullSync({
            hasLocalHistory: true,
            lastFullSyncAt: NOW - FULL_SYNC_INTERVAL_MS + 1,
            now: NOW,
        })).toBe(false);
    });

    it('respeta un intervalo personalizado', () => {
        expect(shouldPullFullSync({ hasLocalHistory: true, lastFullSyncAt: NOW - 10_000, now: NOW, intervalMs: 5_000 })).toBe(true);
        expect(shouldPullFullSync({ hasLocalHistory: true, lastFullSyncAt: NOW - 10_000, now: NOW, intervalMs: 60_000 })).toBe(false);
    });
});
