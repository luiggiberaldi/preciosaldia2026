import { supabaseCloud as defaultSupabase } from '../config/supabaseCloud';
import { forceSyncAllPOSData } from '../hooks/useCloudSync';
import { ensureSupervisorSession } from './supervisorAuth';
import { getActivePairingSlots, readPairingRow } from './supervisorPairingState';

// Debe coincidir con token_expires_at de la RPC generate_pairing_token.
// El backend actual usa 30 minutos; la interfaz recibe este valor desde aquí
// para no mostrar un contador diferente al tiempo real del token.
export const PAIRING_TOKEN_TTL_SECONDS = 30 * 60;
export const PAIRING_POLL_INTERVAL_MS = 3000;
export const MAX_PAIRED_SUPERVISORS = 2;

export function normalizePairingToken(value) {
    const token = String(value ?? '').trim().toUpperCase();
    return token || null;
}

export function formatPairingTime(totalSeconds) {
    const seconds = Math.max(0, Number(totalSeconds) || 0);
    const minutes = Math.floor(seconds / 60);
    const remainder = seconds % 60;
    return `${minutes}:${String(remainder).padStart(2, '0')}`;
}

export function getPairingErrorMessage(error) {
    const message = String(error?.message || error || '').trim();
    if (/ya tiene un supervisor|monitor activo|desvincula/i.test(message)) {
        return 'Esta caja ya tiene un supervisor vinculado. Desvincúlalo desde Ajustes antes de generar otro código.';
    }
    if (/licencia permanente|licencia activa/i.test(message)) {
        return 'La caja necesita una licencia permanente activa para vincular un supervisor.';
    }
    if (/máximo de 2|2 supervisores|límite.*supervisor|limite.*supervisor/i.test(message)) {
        return 'Esta caja ya tiene 2 supervisores vinculados. Desvincula uno desde Ajustes para agregar otro.';
    }
    if (/sesión|sesion|auth/i.test(message)) {
        return 'No se pudo abrir la sesión segura del dispositivo. Revisa la conexión e inténtalo de nuevo.';
    }
    if (/sincroniz|preparar los datos|sync no activo/i.test(message)) {
        return 'No se pudieron preparar los datos para el supervisor. Revisa la conexión e inténtalo de nuevo.';
    }
    return message || 'No se pudo generar el código de vinculación.';
}

function assertDeviceId(deviceId) {
    const normalized = String(deviceId ?? '').trim();
    if (normalized.length < 8 || normalized.length > 160) {
        throw new Error('Identificador de dispositivo inválido');
    }
    return normalized;
}

/**
 * Prepara los datos una vez y solicita el token al RPC existente.
 * Las dependencias opcionales facilitan pruebas sin tocar el cliente real.
 */
export async function createPairingToken({
    deviceId,
    supabase = defaultSupabase,
    ensureSession = ensureSupervisorSession,
    syncBeforeIssue = forceSyncAllPOSData,
    onProgress,
} = {}) {
    const normalizedDeviceId = assertDeviceId(deviceId);
    if (!supabase?.rpc) throw new Error('Supabase no está disponible');

    onProgress?.('Abriendo la sesión segura de esta caja…');
    const { session, error: sessionError } = await ensureSession();
    if (sessionError || !session) {
        throw sessionError || new Error('No hay sesión segura del dispositivo');
    }

    onProgress?.('Preparando los datos para el supervisor…');
    // Bootstrap del primer pairing: publica el snapshot aunque todavía no
    // exista un monitor vinculado, pero respeta hashes para evitar egress
    // innecesario en reintentos o aperturas posteriores.
    const syncResult = await syncBeforeIssue(normalizedDeviceId, false, true);
    if (syncResult && syncResult.ok === false) {
        throw new Error(syncResult.error || 'No se pudieron preparar los datos para el supervisor');
    }

    onProgress?.('Generando el código temporal…');
    const { data, error } = await supabase.rpc('generate_pairing_token', {
        p_device_id: normalizedDeviceId,
    });
    if (error) throw error;

    const token = normalizePairingToken(data);
    if (!token) throw new Error('El servidor no devolvió un código de vinculación válido');

    return {
        token,
        ttlSeconds: PAIRING_TOKEN_TTL_SECONDS,
        expiresAt: Date.now() + (PAIRING_TOKEN_TTL_SECONDS * 1000),
    };
}

export async function revokePairingToken({
    deviceId,
    supabase = defaultSupabase,
    ensureSession = ensureSupervisorSession,
} = {}) {
    const normalizedDeviceId = assertDeviceId(deviceId);
    if (!supabase?.rpc) throw new Error('Supabase no está disponible');

    const { session, error: sessionError } = await ensureSession();
    if (sessionError || !session) {
        throw sessionError || new Error('No hay sesión segura del dispositivo');
    }

    const { data, error } = await supabase.rpc('revoke_pairing_token', {
        p_device_id: normalizedDeviceId,
    });
    if (error) throw error;
    return Boolean(data);
}

/**
 * Observa solo el estado de pairing mientras el QR está visible.
 * Devuelve una función de limpieza idempotente para desmontajes y cierres.
 */
export function watchPairing({
    deviceId,
    supabase = defaultSupabase,
    onPaired,
    onError,
    intervalMs = PAIRING_POLL_INTERVAL_MS,
} = {}) {
    let disposed = false;
    let timerId = null;
    let running = false;
    let consecutiveFailures = 0;

    const stop = () => {
        disposed = true;
        if (timerId !== null) {
            clearInterval(timerId);
            timerId = null;
        }
    };

    const poll = async () => {
        if (disposed || running || !deviceId || !supabase?.from) return;
        running = true;
        try {
            const { data, error } = await readPairingRow({ supabase, primaryDeviceId: deviceId });

            if (disposed) return;
            if (error) throw error;
            consecutiveFailures = 0;

            if (getActivePairingSlots(data).length > 0) {
                stop();
                onPaired?.(data);
            }
        } catch (error) {
            if (!disposed) {
                consecutiveFailures += 1;
                if (consecutiveFailures >= 3) {
                    stop();
                    onError?.(error);
                }
            }
        } finally {
            running = false;
        }
    };

    void poll();
    timerId = setInterval(() => void poll(), intervalMs);
    return stop;
}

export function clearPairingSecret(value) {
    return value ? '' : value;
}
