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
        const syncBeforeIssue = vi.fn().mockResolvedValue({ ok: true });

        const result = await createPairingToken({
            deviceId: 'device-12345678',
            supabase,
            ensureSession,
            syncBeforeIssue,
        });

        expect(ensureSession).toHaveBeenCalledOnce();
        expect(syncBeforeIssue).toHaveBeenCalledWith('device-12345678', false, true);
        expect(rpc).toHaveBeenCalledWith('generate_pairing_token', {
            p_device_id: 'device-12345678',
        });
        expect(result.token).toBe('ABC123');
        expect(result.ttlSeconds).toBe(PAIRING_TOKEN_TTL_SECONDS);
        expect(result.expiresAt).toBeGreaterThan(Date.now());
    });

    it('rechaza una preparación de datos fallida antes de llamar al RPC', async () => {
        const rpc = vi.fn();
        await expect(createPairingToken({
            deviceId: 'device-12345678',
            supabase: { rpc },
            ensureSession: vi.fn().mockResolvedValue({ session: {} }),
            syncBeforeIssue: vi.fn().mockResolvedValue({ ok: false, error: 'sync caído' }),
        })).rejects.toThrow('sync caído');
        expect(rpc).not.toHaveBeenCalled();
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
