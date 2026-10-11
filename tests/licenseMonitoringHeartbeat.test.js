import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock, cleanupRef } = vi.hoisted(() => ({
    rpcMock: vi.fn(),
    cleanupRef: { current: null },
}));

vi.mock('react', () => ({
    useEffect: (callback) => {
        cleanupRef.current = callback();
    },
}));

vi.mock('../src/core/supabaseClient', () => ({
    supabase: {
        rpc: rpcMock,
        channel: vi.fn(),
        removeChannel: vi.fn(),
    },
}));

describe('useLicenseMonitoring heartbeat cadence', () => {
    let useLicenseMonitoring;

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.stubEnv('VITE_SUPABASE_URL', 'https://licenses.example.test');
        cleanupRef.current = null;
        rpcMock.mockReset();
        rpcMock.mockImplementation(async (name) => {
            if (name === 'get_license_status') {
                return {
                    data: { type: 'registered', is_active: false, expires_at: null, created_at: null },
                    error: null,
                };
            }
            return { data: null, error: null };
        });
        vi.resetModules();
        ({ useLicenseMonitoring } = await import('../src/hooks/useLicenseMonitoring'));
    });

    afterEach(() => {
        cleanupRef.current?.();
        vi.useRealTimers();
        vi.unstubAllEnvs();
    });

    it('keeps 3-minute heartbeats and license checks, without recurring device registration', async () => {
        useLicenseMonitoring({ deviceId: 'PDA-DEVICE-01', isPremium: false, isDemo: false });
        await vi.advanceTimersByTimeAsync(0);

        expect(rpcMock).toHaveBeenCalledWith('heartbeat_device', expect.any(Object));
        expect(rpcMock).toHaveBeenCalledWith('get_license_status', { p_device_id: 'PDA-DEVICE-01' });
        expect(rpcMock).not.toHaveBeenCalledWith('auto_register_device', expect.any(Object));

        rpcMock.mockClear();
        await vi.advanceTimersByTimeAsync(3 * 60 * 1000);

        expect(rpcMock).toHaveBeenCalledWith('heartbeat_device', expect.any(Object));
        expect(rpcMock).toHaveBeenCalledWith('get_license_status', { p_device_id: 'PDA-DEVICE-01' });
        expect(rpcMock).not.toHaveBeenCalledWith('auto_register_device', expect.any(Object));
    });
});
