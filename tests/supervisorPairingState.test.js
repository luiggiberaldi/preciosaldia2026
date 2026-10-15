import { describe, expect, it, vi } from 'vitest';
import {
    getActivePairingSlots,
    isMonitorPairingActive,
    isMissingSecondaryPairingColumnsError,
    readPairingRow,
} from '../src/services/supervisorPairingState';

function makeSupabase(results) {
    let index = 0;
    return {
        from: vi.fn(() => {
            const query = {
                select: vi.fn(() => query),
                eq: vi.fn(() => query),
                maybeSingle: vi.fn(async () => results[index++]),
            };
            return query;
        }),
    };
}

describe('Supervisor pairing state', () => {
    it('reconoce los dos slots activos', () => {
        const row = {
            revoked_at: null,
            monitor_device_id: 'monitor-1',
            monitor_auth_id: 'auth-1',
            monitor_device_id_2: 'monitor-2',
            monitor_auth_id_2: 'auth-2',
        };

        expect(getActivePairingSlots(row)).toHaveLength(2);
        expect(isMonitorPairingActive(row, 'monitor-2')).toBe(true);
    });

    it('identifica un error por columnas ausentes del segundo slot', () => {
        expect(isMissingSecondaryPairingColumnsError({
            message: "Could not find the 'monitor_device_id_2' column in the schema cache",
        })).toBe(true);
    });

    it('usa la consulta legacy cuando producción aún no tiene el segundo slot', async () => {
        const supabase = makeSupabase([
            { data: null, error: { message: "Could not find the 'monitor_device_id_2' column in the schema cache" } },
            { data: { revoked_at: null, monitor_device_id: 'monitor-1', monitor_auth_id: 'auth-1' }, error: null },
        ]);

        const result = await readPairingRow({ supabase, primaryDeviceId: 'primary-1' });

        expect(result.error).toBeNull();
        expect(result.supportsSecondary).toBe(false);
        expect(result.data.monitor_device_id).toBe('monitor-1');
        expect(supabase.from).toHaveBeenCalledTimes(2);
    });
});
