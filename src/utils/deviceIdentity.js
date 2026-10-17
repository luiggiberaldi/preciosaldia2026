/**
 * deviceIdentity.js — Registro de identidad del dispositivo en Supabase.
 *
 * Problema que resuelve:
 *   - Las políticas RLS "own-row" (001_device_own_row_rls.sql) necesitan que
 *     el dispositivo esté registrado en `device_sessions` vinculado a su
 *     sesión anónima. Sin ese registro, cloud_backups/sync_documents siguen
 *     bloqueados (42501).
 *
 * Contrato con la migración:
 *   - Tabla: device_sessions(device_id PK, user_id, first_seen, last_seen)
 *   - INSERT con with check (auth.uid() = user_id)
 *   - UPDATE de reconciliación: si el device_id ya existe con OTRO user_id,
 *     la política "reclaim" permite reasignarlo al usuario actual
 *     (with check auth.uid() = user_id).
 *
 * Recuperación automática: si el RPC seguro reporta DEVICE_SESSION_CONFLICT
 * (la fila quedó ligada a otra sesión, p.ej. porque la sesión anónima se
 * regeneró), la caja re-liga su propia fila vía la política reclaim. Es una
 * bodega, no un banco: la identidad se repara sola, sin pasos manuales.
 *
 * @module utils/deviceIdentity
 */

import { supabaseCloud } from '../config/supabaseCloud';

async function getSessionUserId() {
    try {
        const { data } = await supabaseCloud.auth.getSession();
        return data?.session?.user?.id ?? null;
    } catch {
        return null;
    }
}

function isRegistrationRpcUnavailable(error) {
    const code = error?.code;
    const message = String(error?.message || '');
    return code === 'PGRST202'
        || code === '42883'
        || /register_device_session|function .* does not exist/i.test(message);
}

function rpcFailureToIdentityError(data) {
    const message = data?.message || 'No se pudo registrar la sesión del dispositivo';
    return {
        code: data?.code
            || (message.toLowerCase().includes('vinculada') ? 'DEVICE_SESSION_CONFLICT' : 'DEVICE_SESSION_REGISTRATION_FAILED'),
        message,
    };
}

/**
 * Re-liga la fila de identidad al usuario actual (política "reclaim" de
 * 001_device_own_row_rls.sql). Idempotente.
 * @returns {Promise<any>} null si la re-ligación fue exitosa; el error si no.
 */
const POSSESSION_KEY = 'pda_device_possession_v1';

/**
 * Secreto local de posesión (≥256 bits). Se genera una vez y se guarda solo en
 * este equipo; la nube conserva únicamente su hash SHA-256.
 */
function getOrCreatePossessionSecret() {
    let secret = localStorage.getItem(POSSESSION_KEY);
    if (!secret || secret.length < 32) {
        const bytes = new Uint8Array(32);
        crypto.getRandomValues(bytes);
        secret = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
        localStorage.setItem(POSSESSION_KEY, secret);
    }
    return secret;
}

/**
 * Reclama la fila de identidad con prueba de posesión (RPC claim_device_session,
 * migración 20261017). Ya no se usa UPDATE directo: esa ruta dependía de la política
 * abierta device_sessions_reclaim.
 * @returns {Promise<any>} null si el reclamo fue exitoso; el error si no.
 */
async function reclaimDeviceSessionRow(deviceId) {
    const { data, error } = await supabaseCloud.rpc('claim_device_session', {
        p_device_id: deviceId,
        p_secret: getOrCreatePossessionSecret(),
    });
    if (error) return error;
    if (data?.success !== true) {
        return {
            code: data?.code || 'DEVICE_SESSION_NOT_BOUND',
            message: data?.code === 'POSSESSION_REQUIRED'
                ? 'Esta caja no puede demostrar su identidad. Vuelve a vincularla desde el equipo original.'
                : 'El reclamo de identidad no se completó.',
        };
    }
    return null;
}

/**
 * Verifica que la fila de identidad quedó REALMENTE ligada a la sesión actual.
 * La política `device_sessions_select_own` solo devuelve filas cuando
 * auth.uid() = user_id, así que leer la fila == vínculo comprobado.
 * @returns {Promise<{bound: boolean, row: any, error: any}>}
 */
export async function verifyDeviceSessionRegistered(deviceId) {
    if (!supabaseCloud || !deviceId) return { bound: false, row: null, error: 'sin supabase o deviceId' };
    try {
        const { data, error } = await supabaseCloud
            .from('device_sessions')
            .select('device_id')
            .eq('device_id', deviceId)
            .maybeSingle();
        if (error) return { bound: false, row: null, error };
        return { bound: Boolean(data), row: data || null, error: null };
    } catch (error) {
        return { bound: false, row: null, error };
    }
}

// Éxito SOLO con vínculo comprobado (read-back). Un UPDATE que no afecta filas
// NO es un error en PostgREST: sin esta verificación, un reclaim sin efecto se
// reportaba como ok y el siguiente push moría con RLS ("new row violates…").
async function assertBinding(deviceId, registered, reclaimed) {
    const verification = await verifyDeviceSessionRegistered(deviceId);
    if (verification.bound) return { ok: true, registered, reclaimed, error: null };
    // Diagnóstico: el mensaje de UI no muestra la causa; registrar el paso que falló.
    console.error('[DeviceIdentity] Vínculo no comprobado tras registro', {
        deviceId: String(deviceId).slice(0, 12),
        registered,
        reclaimed,
        verificationError: verification.error?.message || verification.error || null,
        verificationCode: verification.error?.code || null,
    });
    return {
        ok: false,
        registered: false,
        reclaimed: false,
        error: verification.error || {
            code: 'DEVICE_SESSION_NOT_BOUND',
            message: 'La identidad de esta caja no quedó ligada a la sesión de la nube. Cierra y vuelve a abrir la app e inténtalo de nuevo.',
        },
    };
}

/**
 * Registra (o reconcilia) la identidad del dispositivo. Idempotente.
 * Debe llamarse con la sesión ya establecida (ensureSupervisorSession).
 *
 * @param {string} deviceId
 * @returns {Promise<{ok: boolean, registered: boolean, reclaimed: boolean, error: any}>}
 */
export async function ensureDeviceSessionRegistered(deviceId) {
    if (!supabaseCloud || !deviceId) {
        return { ok: false, registered: false, reclaimed: false, error: 'sin supabase o deviceId' };
    }

    const userId = await getSessionUserId();
    if (!userId) {
        return { ok: false, registered: false, reclaimed: false, error: 'sin sesión activa' };
    }

    // Staging revoca INSERT directo sobre device_sessions. La RPC mantiene
    // la misma validación de auth.uid() en el servidor sin abrir esa tabla.
    if (typeof supabaseCloud.rpc === 'function') {
        const { data: rpcData, error: rpcError } = await supabaseCloud.rpc('register_device_session', {
            p_device_id: deviceId,
        });

        if (!rpcError) {
            if (rpcData?.success === false) {
                const identityError = rpcFailureToIdentityError(rpcData);

                // Conflicto = la fila quedó ligada a otra sesión (sesión anónima
                // regenerada). La caja re-liga su propia fila automáticamente.
                if (identityError.code === 'DEVICE_SESSION_CONFLICT') {
                    const reclaimErr = await reclaimDeviceSessionRow(deviceId);
                    if (!reclaimErr) {
                        return assertBinding(deviceId, false, true);
                    }
                    return { ok: false, registered: false, reclaimed: false, error: reclaimErr };
                }

                return {
                    ok: false,
                    registered: false,
                    reclaimed: false,
                    error: identityError,
                };
            }

            return assertBinding(deviceId, true, false);
        }

        // Older production schemas do not have the RPC yet. Preserve their
        // existing direct-table path until the migration is applied.
        if (!isRegistrationRpcUnavailable(rpcError)) {
            return { ok: false, registered: false, reclaimed: false, error: rpcError };
        }
    }

    // 1. INSERT (caso normal: primera vez en esta máquina).
    const { error: insertErr } = await supabaseCloud
        .from('device_sessions')
        .insert({ device_id: deviceId, user_id: userId });

    if (!insertErr) {
        return assertBinding(deviceId, true, false);
    }

    // 2. Duplicado (23505): reconciliación. La política "reclaim" permite al
    //    dueño actual (posible nueva sesión anónima) reasignarse la fila.
    if (insertErr?.code === '23505') {
        const updateErr = await reclaimDeviceSessionRow(deviceId);
        if (!updateErr) {
            return assertBinding(deviceId, false, true);
        }
        return { ok: false, registered: false, reclaimed: false, error: updateErr };
    }

    // 3. Otro error (RLS, red, etc.): se reporta; el caller decide.
    return { ok: false, registered: false, reclaimed: false, error: insertErr };
}

export default { ensureDeviceSessionRegistered, verifyDeviceSessionRegistered };
