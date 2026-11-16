import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { rpcMock, fromMock, cleanupRef } = vi.hoisted(() => ({
    rpcMock: vi.fn(),
    fromMock: vi.fn(),
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
        from: fromMock,
        channel: vi.fn(() => ({ on: vi.fn().mockReturnThis(), subscribe: vi.fn().mockReturnThis() })),
        removeChannel: vi.fn(() => Promise.resolve()),
    },
}));

const HEARTBEAT_MS = 3 * 60 * 1000;

/** Respuesta de la consulta de respaldo `from('licenses')...maybeSingle()`. */
function selectReturns(result) {
    fromMock.mockImplementation(() => {
        const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => result };
        return chain;
    });
}

describe('useLicenseMonitoring: licencia que ya no existe o ya no vale', () => {
    let useLicenseMonitoring;
    let MISSING_LICENSE_LIMIT;
    let onRevoked;

    beforeEach(async () => {
        vi.useFakeTimers();
        vi.stubEnv('VITE_SUPABASE_URL', 'https://licenses.example.test');
        cleanupRef.current = null;
        rpcMock.mockReset();
        fromMock.mockReset();
        localStorage.setItem('pda_premium_token', 'token.local');
        localStorage.setItem('pda_license_cache', '{"type":"permanent"}');
        onRevoked = vi.fn();
        // El RPC no devuelve fila; el heartbeat responde sin error.
        rpcMock.mockImplementation(async () => ({ data: null, error: null }));
        vi.resetModules();
        ({ useLicenseMonitoring, MISSING_LICENSE_LIMIT } = await import('../src/hooks/useLicenseMonitoring'));
    });

    afterEach(() => {
        cleanupRef.current?.();
        vi.useRealTimers();
        vi.unstubAllEnvs();
        localStorage.clear();
    });

    const mount = () =>
        useLicenseMonitoring({ deviceId: 'PDA-DEVICE-01', isPremium: true, isDemo: false, onRevoked });

    it('quita el acceso tras varias consultas seguidas sin fila de licencia (licencia eliminada)', async () => {
        selectReturns({ data: null, error: null });
        mount();
        await vi.advanceTimersByTimeAsync(0);
        expect(onRevoked).not.toHaveBeenCalled(); // 1ª: aún puede ser transitorio

        await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * (MISSING_LICENSE_LIMIT - 1));
        expect(onRevoked).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('pda_premium_token')).toBeNull();
        expect(localStorage.getItem('pda_license_cache')).toBeNull();
    });

    it('NO quita el acceso si la consulta falla (sin red / error de servidor)', async () => {
        selectReturns({ data: null, error: { message: 'network' } });
        mount();
        await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * (MISSING_LICENSE_LIMIT + 2));
        expect(onRevoked).not.toHaveBeenCalled();
        expect(localStorage.getItem('pda_premium_token')).toBe('token.local');
    });

    it('una respuesta válida reinicia el conteo de filas ausentes', async () => {
        const missing = { data: null, error: null };
        const present = { data: { type: 'permanent', is_active: true, expires_at: null, created_at: null }, error: null };
        const seq = [missing, missing, present, missing, missing];
        let i = 0;
        fromMock.mockImplementation(() => {
            const chain = { select: () => chain, eq: () => chain, maybeSingle: async () => seq[Math.min(i++, seq.length - 1)] };
            return chain;
        });
        mount();
        await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 4);
        expect(onRevoked).not.toHaveBeenCalled();
    });

    it('quita el acceso a una permanente cuyo vencimiento ya pasó (la política la cierra)', async () => {
        selectReturns({
            data: { type: 'permanent', is_active: true, expires_at: '2020-01-01T00:00:00Z', created_at: null },
            error: null,
        });
        mount();
        await vi.advanceTimersByTimeAsync(0);
        expect(onRevoked).toHaveBeenCalledTimes(1);
        expect(localStorage.getItem('pda_premium_token')).toBeNull();
    });

    it('no toca una permanente vigente', async () => {
        selectReturns({ data: { type: 'permanent', is_active: true, expires_at: null, created_at: null }, error: null });
        mount();
        await vi.advanceTimersByTimeAsync(HEARTBEAT_MS * 4);
        expect(onRevoked).not.toHaveBeenCalled();
        expect(localStorage.getItem('pda_premium_token')).toBe('token.local');
    });
});
