import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { hashPin } from '../src/utils/crypto';
import { useAuthStore } from '../src/hooks/store/useAuthStore';
import {
    PAIRING_STATES,
    canMonitorRead,
    canTransitionPairing,
} from '../src/services/supervisorContracts';
import {
    createPairingToken,
    formatPairingTime,
    getPairingErrorMessage,
    PAIRING_TOKEN_TTL_SECONDS,
    revokePairingToken,
    watchPairing,
} from '../src/services/supervisorPairingService';

const pairingScreen = readFileSync('src/components/PairingScanScreen.jsx', 'utf8');

describe('Supervisor pairing contract', () => {
    it('solo permite lectura remota cuando el pairing está paired', () => {
        expect(canMonitorRead(PAIRING_STATES.PENDING)).toBe(false);
        expect(canMonitorRead(PAIRING_STATES.EXPIRED)).toBe(false);
        expect(canMonitorRead(PAIRING_STATES.REVOKED)).toBe(false);
        expect(canMonitorRead(PAIRING_STATES.PAIRED)).toBe(true);
    });

    it('permite completar o revocar un pairing pendiente', () => {
        expect(canTransitionPairing(PAIRING_STATES.PENDING, PAIRING_STATES.PAIRED)).toBe(true);
        expect(canTransitionPairing(PAIRING_STATES.PENDING, PAIRING_STATES.REVOKED)).toBe(true);
        expect(canTransitionPairing(PAIRING_STATES.PENDING, PAIRING_STATES.PENDING)).toBe(true);
    });

    it('no permite reactivar directamente un pairing ya vinculado', () => {
        expect(canTransitionPairing(PAIRING_STATES.PAIRED, PAIRING_STATES.PENDING)).toBe(false);
        expect(canTransitionPairing(PAIRING_STATES.PAIRED, PAIRING_STATES.EXPIRED)).toBe(false);
    });

    it('usa la longitud del token nuevo también para habilitar el botón manual', () => {
        expect(pairingScreen).toContain('const PAIRING_TOKEN_LENGTH = 24;');
        expect(pairingScreen).toContain('disabled={loading || manualCode.length !== PAIRING_TOKEN_LENGTH}');
        expect(pairingScreen).not.toContain('disabled={loading || manualCode.length !== 6}');
    });
});

describe('supervisorPairingService', () => {
    it('prepara datos, crea la sesión y solicita un token normalizado', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: '  abc123  ', error: null });
        const supabase = { rpc };
        const ensureSession = vi.fn().mockResolvedValue({ session: { user: { id: 'device-auth' } } });
        const registerDeviceSession = vi.fn().mockResolvedValue({ ok: true });
        const syncBeforeIssue = vi.fn().mockResolvedValue({ ok: true });

        const result = await createPairingToken({
            deviceId: 'device-12345678',
            supabase,
            ensureSession,
            registerDeviceSession,
            syncBeforeIssue,
        });

        expect(ensureSession).toHaveBeenCalledOnce();
        expect(registerDeviceSession).toHaveBeenCalledWith('device-12345678');
        expect(syncBeforeIssue).toHaveBeenCalledWith('device-12345678', false, true);
        expect(rpc).toHaveBeenCalledWith('generate_pairing_token', {
            p_device_id: 'device-12345678',
        });
        expect(result.token).toBe('ABC123');
        expect(result.ttlSeconds).toBe(PAIRING_TOKEN_TTL_SECONDS);
        expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    it('registra la identidad antes de publicar el snapshot (RLS own-row)', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: '  abc123  ', error: null });
        const registerDeviceSession = vi.fn().mockResolvedValue({ ok: true });
        const syncBeforeIssue = vi.fn().mockResolvedValue({ ok: true });

        await createPairingToken({
            deviceId: 'device-12345678',
            supabase: { rpc },
            ensureSession: vi.fn().mockResolvedValue({ session: { user: { id: 'device-auth' } } }),
            registerDeviceSession,
            syncBeforeIssue,
        });

        expect(registerDeviceSession.mock.invocationCallOrder[0])
            .toBeLessThan(syncBeforeIssue.mock.invocationCallOrder[0]);
    });

    it('aborta antes de publicar si la identidad no se pudo registrar', async () => {
        const rpc = vi.fn();
        const syncBeforeIssue = vi.fn();
        await expect(createPairingToken({
            deviceId: 'device-12345678',
            supabase: { rpc },
            ensureSession: vi.fn().mockResolvedValue({ session: { user: { id: 'device-auth' } } }),
            registerDeviceSession: vi.fn().mockResolvedValue({
                ok: false,
                error: { code: 'DEVICE_SESSION_CONFLICT', message: 'Esta caja ya está vinculada a otra sesión.' },
            }),
            syncBeforeIssue,
        })).rejects.toThrow('vinculada a otra sesión');
        expect(syncBeforeIssue).not.toHaveBeenCalled();
        expect(rpc).not.toHaveBeenCalled();
    });

    it('traduce el conflicto de identidad a un mensaje accionable', () => {
        expect(getPairingErrorMessage(new Error('Esta caja ya está vinculada a otra sesión.')))
            .toMatch(/otra sesión segura/i);
    });

    // Fase 1 (2026-10-20): el snapshot pesado ya NO bloquea la emisión del token.
    // Comportamiento nuevo: el fallo del snapshot se reintenta y se registra en
    // segundo plano; el código se emite igualmente.
    it('el fallo del snapshot no bloquea la emisión del token', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const rpc = vi.fn().mockResolvedValue({ data: 'abc123', error: null });
        const syncBeforeIssue = vi.fn().mockResolvedValue({ ok: false, error: 'sync caído' });
        const result = await createPairingToken({
            deviceId: 'device-12345678',
            supabase: { rpc },
            ensureSession: vi.fn().mockResolvedValue({ session: {} }),
            registerDeviceSession: vi.fn().mockResolvedValue({ ok: true }),
            syncBeforeIssue,
            sleep: () => Promise.resolve(),
        });
        expect(result.token).toBe('ABC123');
        expect(rpc).toHaveBeenCalledOnce();
        await vi.waitFor(() => expect(syncBeforeIssue).toHaveBeenCalledTimes(2));
        warn.mockRestore();
    });

    it('traduce el rechazo RLS de sync_documents a un mensaje accionable en el registro', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const rpc = vi.fn().mockResolvedValue({ data: 'abc123', error: null });
        const syncBeforeIssue = vi.fn().mockResolvedValue({
            ok: false,
            error: 'new row violates row-level security policy for table "sync_documents"',
        });
        const result = await createPairingToken({
            deviceId: 'device-12345678',
            supabase: { rpc },
            ensureSession: vi.fn().mockResolvedValue({ session: {} }),
            registerDeviceSession: vi.fn().mockResolvedValue({ ok: true }),
            syncBeforeIssue,
            sleep: () => Promise.resolve(),
        });
        expect(result.token).toBe('ABC123');
        await vi.waitFor(() => expect(warn).toHaveBeenCalled());
        expect(warn.mock.calls.flat().join(' ')).toMatch(/Cierra y vuelve a abrir la app/i);
        warn.mockRestore();
    });

    it('revoca un código pendiente al cancelar el modal', async () => {
        const rpc = vi.fn().mockResolvedValue({ data: true, error: null });
        const ensureSession = vi.fn().mockResolvedValue({ session: { user: { id: 'device-auth' } } });
        await expect(revokePairingToken({
            deviceId: 'device-12345678',
            supabase: { rpc },
            ensureSession,
        })).resolves.toBe(true);
        expect(rpc).toHaveBeenCalledWith('revoke_pairing_token', {
            p_device_id: 'device-12345678',
        });
    });

    it('vigila el pairing y limpia el intervalo al vincular', async () => {
        vi.useFakeTimers();
        const onPaired = vi.fn();
        const maybeSingle = vi.fn().mockResolvedValue({
            data: { monitor_device_id: 'monitor-12345678', monitor_auth_id: 'auth-1', revoked_at: null },
            error: null,
        });
        const supabase = {
            from: vi.fn(() => ({
                select: () => ({
                    eq: () => ({ maybeSingle }),
                }),
            })),
        };

        const cleanup = watchPairing({
            deviceId: 'device-12345678',
            supabase,
            onPaired,
            intervalMs: 1000,
        });

        await vi.runOnlyPendingTimersAsync();
        expect(onPaired).toHaveBeenCalledWith(expect.objectContaining({ monitor_device_id: 'monitor-12345678' }));
        cleanup();
        vi.useRealTimers();
    });

    it('formatea el tiempo y traduce conflictos conocidos', () => {
        expect(formatPairingTime(300)).toBe('5:00');
        expect(formatPairingTime(65)).toBe('1:05');
        expect(getPairingErrorMessage(new Error('Esta caja ya tiene un supervisor conectado'))).toMatch(/ya tiene un supervisor/i);
    });

    it('muestra la causa real cuando la identidad de la caja no quedó ligada, en vez del texto genérico de sesión', () => {
        const message = getPairingErrorMessage({ code: 'DEVICE_SESSION_NOT_BOUND', message: 'La identidad de esta caja no quedó ligada a la sesión de la nube.' });
        expect(message).toMatch(/identidad de esta caja no quedó ligada/i);
        expect(message).not.toMatch(/No se pudo abrir la sesión segura/);
    });
});

describe('createPairingToken — el código no espera el snapshot (Fase 1)', () => {
    // Módulo fresco por prueba: el guard de snapshot en vuelo es estado del módulo.
    const loadService = async () => {
        vi.resetModules();
        return import('../src/services/supervisorPairingService');
    };
    const baseDeps = (overrides = {}) => ({
        deviceId: 'device-12345678',
        supabase: { rpc: vi.fn().mockResolvedValue({ data: '  abc123  ', error: null }) },
        ensureSession: vi.fn().mockResolvedValue({ session: { user: { id: 'device-auth' } } }),
        registerDeviceSession: vi.fn().mockResolvedValue({ ok: true }),
        sleep: vi.fn().mockResolvedValue(undefined),
        ...overrides,
    });

    it('(a) emite el token aunque el snapshot en segundo plano nunca termine', async () => {
        const { createPairingToken } = await loadService();
        const syncBeforeIssue = vi.fn(() => new Promise(() => {}));
        const result = await createPairingToken(baseDeps({ syncBeforeIssue }));
        expect(result.token).toBe('ABC123');
        expect(syncBeforeIssue).toHaveBeenCalledWith('device-12345678', false, true);
    });

    it('(b) el snapshot fallido se reintenta una vez y solo se registra', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { createPairingToken } = await loadService();
        const syncBeforeIssue = vi.fn().mockResolvedValue({ ok: false, error: 'sync caído' });
        const sleep = vi.fn().mockResolvedValue(undefined);
        const result = await createPairingToken(baseDeps({ syncBeforeIssue, sleep }));
        expect(result.token).toBe('ABC123');
        await vi.waitFor(() => expect(syncBeforeIssue).toHaveBeenCalledTimes(2));
        expect(sleep).toHaveBeenCalledOnce();
        expect(warn.mock.calls.flat().join(' ')).toMatch(/sync caído/);
        warn.mockRestore();
    });

    it('(c) un rechazo del RPC llega al usuario sin pasar por el timeout y sin disparar el snapshot', async () => {
        const { createPairingToken } = await loadService();
        const syncBeforeIssue = vi.fn();
        await expect(createPairingToken(baseDeps({
            supabase: { rpc: vi.fn().mockRejectedValue(new Error('Esta caja ya tiene un supervisor conectado')) },
            syncBeforeIssue,
        }))).rejects.toThrow('ya tiene un supervisor conectado');
        expect(syncBeforeIssue).not.toHaveBeenCalled();
    });

    it('(d) reintentar en ráfaga no dispara snapshots duplicados', async () => {
        const { createPairingToken } = await loadService();
        const syncBeforeIssue = vi.fn(() => new Promise(() => {}));
        const deps = baseDeps({ syncBeforeIssue });
        await Promise.all([createPairingToken(deps), createPairingToken(deps)]);
        expect(syncBeforeIssue).toHaveBeenCalledOnce();
    });
});

describe('useAuthStore.verifyAdminPin', () => {
    beforeEach(async () => {
        localStorage.clear();
        const adminHash = await hashPin('246810');
        const cashierHash = await hashPin('135790');
        useAuthStore.setState({
            usuarioActivo: { id: 2, nombre: 'Cajero', rol: 'CAJERO' },
            usuarios: [
                { id: 1, nombre: 'Administrador', rol: 'ADMIN', pin: adminHash, requirePin: true },
                { id: 2, nombre: 'Cajero', rol: 'CAJERO', pin: cashierHash, requirePin: true },
            ],
            failedAttempts: 0,
            lockUntil: null,
            consecutiveLockouts: 0,
            lastFailedAttemptTs: 0,
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('autoriza a un administrador sin reemplazar el usuario activo', async () => {
        const result = await useAuthStore.getState().verifyAdminPin('246810');
        expect(result.success).toBe(true);
        expect(result.user.rol).toBe('ADMIN');
        expect(useAuthStore.getState().usuarioActivo).toEqual({ id: 2, nombre: 'Cajero', rol: 'CAJERO' });
    });

    it('rechaza el PIN del cajero', async () => {
        const result = await useAuthStore.getState().verifyAdminPin('135790');
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/incorrecto/i);
    });

    it('aplica el bloqueo existente tras intentos fallidos', async () => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
            await useAuthStore.getState().verifyAdminPin('000000');
        }
        expect(useAuthStore.getState().lockUntil).toBeGreaterThan(Date.now());
        const blocked = await useAuthStore.getState().verifyAdminPin('246810');
        expect(blocked.success).toBe(false);
        expect(blocked.error).toMatch(/bloqueado/i);
    });
});
