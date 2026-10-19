import { describe, expect, it } from 'vitest';
import {
    SUPERVISOR_SYNC_KEYS,
    isSupervisorSyncKey,
    validateSupervisorSyncDocument,
} from '../src/services/supervisorContracts';
import {
    buildSyncEnvelope,
    buildSupervisorRealtimeChannelName,
    isNewerSyncDocument,
    readSyncEnvelope,
    getSupervisorRecoveryIntervalMs,
    shouldRunSupervisorRecovery,
    MONITOR_CONNECTED_SWEEP_INTERVAL_MS,
    shouldRunMonitorConnectedSweep,
    getChangedSyncDocumentIds,
    withSyncRetry,
} from '../src/services/supervisorSyncService';

describe('Supervisor sync contract', () => {
    it('incluye solo documentos explícitamente permitidos', () => {
        expect(SUPERVISOR_SYNC_KEYS).toContain('bodega_products_v1');
        expect(SUPERVISOR_SYNC_KEYS).toContain('bodega_sales_v1');
        expect(isSupervisorSyncKey('abasto-auth-storage')).toBe(false);
        expect(isSupervisorSyncKey('bodega_users_catalog_v1')).toBe(false);
        expect(isSupervisorSyncKey('arbitrary-secret')).toBe(false);
    });

    it('valida arrays de productos y ventas', () => {
        expect(validateSupervisorSyncDocument('bodega_products_v1', []).valid).toBe(true);
        expect(validateSupervisorSyncDocument('bodega_sales_v1', []).valid).toBe(true);
        expect(validateSupervisorSyncDocument('bodega_products_v1', {}).valid).toBe(false);
        expect(validateSupervisorSyncDocument('bodega_sales_v1', null).valid).toBe(false);
    });

    it('valida configuración local con tipos seguros', () => {
        expect(validateSupervisorSyncDocument('bodega_rate_mode', 'manual').valid).toBe(true);
        expect(validateSupervisorSyncDocument('bodega_rate_mode', 'invalid').valid).toBe(false);
        expect(validateSupervisorSyncDocument('bodega_custom_rate', '45.50').valid).toBe(true);
        expect(validateSupervisorSyncDocument('bodega_custom_rate', 'NaN').valid).toBe(false);
        expect(validateSupervisorSyncDocument('bodega_use_auto_rate', 'true').valid).toBe(true);
    });

    it('rechaza claves de autenticación aunque tengan payload', () => {
        const result = validateSupervisorSyncDocument('abasto-auth-storage', { state: {} });
        expect(result.valid).toBe(false);
        expect(result.error).toContain('no permitido');
    });

    it('usa envelopes versionados y acepta legacy solo como compatibilidad', () => {
        const envelope = buildSyncEnvelope(['producto'], '2026-08-09T12:00:00.000Z');
        expect(readSyncEnvelope(envelope)).toMatchObject({ valid: true, payload: ['producto'], schemaVersion: 1 });
        expect(readSyncEnvelope({ payload: ['legacy'] })).toMatchObject({ valid: true, payload: ['legacy'], schemaVersion: 1 });
        expect(readSyncEnvelope({ payload: [], schemaVersion: 99 }).valid).toBe(false);
    });

    it('rechaza snapshots repetidos o antiguos', () => {
        expect(isNewerSyncDocument('2026-08-09T12:01:00.000Z', '2026-08-09T12:00:00.000Z')).toBe(true);
        expect(isNewerSyncDocument('2026-08-09T12:00:00.000Z', '2026-08-09T12:00:00.000Z')).toBe(false);
        expect(isNewerSyncDocument('2026-08-09T11:59:00.000Z', '2026-08-09T12:00:00.000Z')).toBe(false);
    });

    it('usa un topic diferente para cada ciclo de vida del monitor', () => {
        expect(buildSupervisorRealtimeChannelName('device-1', 1)).toBe('monitor:device-1:1');
        expect(buildSupervisorRealtimeChannelName('device-1', 2)).not.toBe(
            buildSupervisorRealtimeChannelName('device-1', 1)
        );
        expect(buildSupervisorRealtimeChannelName('device-2', 1)).not.toBe(
            buildSupervisorRealtimeChannelName('device-1', 1)
        );
    });

    it('reintenta con backoff y no oculta el error final', async () => {
        let calls = 0;
        const result = await withSyncRetry(async () => {
            calls += 1;
            if (calls < 3) throw new Error('transitorio');
            return 'ok';
        }, { sleep: async () => {} });
        expect(result).toBe('ok');
        expect(calls).toBe(3);

        await expect(withSyncRetry(async () => {
            throw new Error('definitivo');
        }, { attempts: 2, sleep: async () => {} })).rejects.toThrow('definitivo');
    });

    it('mantiene un intervalo de recuperación moderado', () => {
        expect(getSupervisorRecoveryIntervalMs()).toBe(5 * 60_000);
    });

    it('no hace polling cuando Realtime está conectado o ya hay un pull en curso', () => {
        expect(shouldRunSupervisorRecovery({ realtimeConnected: true, now: 600_000 })).toBe(false);
        expect(shouldRunSupervisorRecovery({ recoveryInFlight: true, now: 600_000 })).toBe(false);
    });

    it('el barrido conectado solo corre con Realtime vivo y sin pull en vuelo', () => {
        expect(shouldRunMonitorConnectedSweep({ realtimeConnected: true })).toBe(true);
        expect(shouldRunMonitorConnectedSweep({ realtimeConnected: true, pullInFlight: true })).toBe(false);
        expect(shouldRunMonitorConnectedSweep({ realtimeConnected: false })).toBe(false);
        expect(shouldRunMonitorConnectedSweep({})).toBe(false);
    });

    it('el barrido conectado es más frecuente que la recuperación degradada y distinto del barrido de publicación (30 s)', () => {
        expect(MONITOR_CONNECTED_SWEEP_INTERVAL_MS).toBe(45_000);
        expect(MONITOR_CONNECTED_SWEEP_INTERVAL_MS).toBeLessThan(getSupervisorRecoveryIntervalMs());
    });

    it('solo recupera cuando el intervalo de fallback ya venció', () => {
        expect(shouldRunSupervisorRecovery({ lastRecoveryAt: 100_000, now: 399_999 })).toBe(false);
        expect(shouldRunSupervisorRecovery({ lastRecoveryAt: 100_000, now: 400_000 })).toBe(true);
    });

    it('detecta solo documentos nuevos o modificados a partir de metadatos', () => {
        const previous = {
            products: '2026-10-15T10:00:00.000Z',
            sales: '2026-10-15T10:05:00.000Z',
        };
        const changed = getChangedSyncDocumentIds([
            { doc_id: 'products', updated_at: '2026-10-15T10:00:00.000Z' },
            { doc_id: 'sales', updated_at: '2026-10-15T10:06:00.000Z' },
            { doc_id: 'customers', updated_at: '2026-10-15T10:01:00.000Z' },
        ], (docId) => previous[docId] || null);

        expect(changed).toEqual(['sales', 'customers']);
    });
});
