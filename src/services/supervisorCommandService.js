import { supabaseCloud } from '../config/supabaseCloud';
import {
    SUPERVISOR_REMOTE_MUTATIONS_ENABLED,
    SUPERVISOR_REMOTE_PRODUCTS_ENABLED,
    SUPERVISOR_REMOTE_INCOME_ENABLED,
    SUPERVISOR_REMOTE_RATE_ENABLED,
    SUPERVISOR_REMOTE_EGRESS_ENABLED,
    SUPERVISOR_REMOTE_SUPPLIERS_ENABLED,
    SUPERVISOR_EXTENDED_TTL_ENABLED,
} from '../config/supervisorPolicy';
import { ensureSupervisorSession } from './supervisorAuth';
import { readPairingRow } from './supervisorPairingState';
import {
    getCommandMaxTtlMs,
    SUPERVISOR_COMMAND_TYPES,
    validateSupervisorCommand,
} from './supervisorContracts';

export const SUPERVISOR_COMMAND_TTL_MS = 60_000;
export const SUPERVISOR_ACK_TIMEOUT_MS = 10_000;
export const SUPERVISOR_PENDING_COMMAND_COLUMNS = 'command_id,target_device_id,actor_auth_id,command_type,status,issued_at,expires_at,payload,schema_version';
export const SUPERVISOR_TERMINAL_COMMAND_STATUSES = Object.freeze([
    'applied',
    'applied_with_warnings',
    'rejected',
    'failed',
    'cancelled',
]);

const commandLockQueues = new Map();

export function withSupervisorCommandLock(commandId, operation, lockManager = globalThis.navigator?.locks) {
    if (typeof commandId !== 'string' || !commandId.trim()) throw new TypeError('commandId inválido para el lock');
    if (typeof operation !== 'function') throw new TypeError('La operación del comando debe ser una función');
    const lockName = `supervisor-command:${commandId}`;
    if (lockManager && typeof lockManager.request === 'function') {
        return lockManager.request(lockName, { mode: 'exclusive' }, operation);
    }

    const previous = commandLockQueues.get(commandId) || Promise.resolve();
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const queued = previous.catch(() => {}).then(() => gate);
    commandLockQueues.set(commandId, queued);

    return previous.catch(() => {}).then(operation).finally(() => {
        release();
        if (commandLockQueues.get(commandId) === queued) commandLockQueues.delete(commandId);
    });
}

export function fetchSupervisorCommandsForRecovery(client, targetDeviceId, now = Date.now()) {
    const nowIso = new Date(now).toISOString();
    return client
        .from('supervisor_commands')
        .select(SUPERVISOR_PENDING_COMMAND_COLUMNS)
        .eq('target_device_id', targetDeviceId)
        .or(`status.eq.received,and(status.eq.pending,expires_at.gt.${nowIso})`)
        .order('issued_at', { ascending: true })
        .limit(25);
}

export function fetchPendingSupervisorCommands(client, targetDeviceId) {
    return client
        .from('supervisor_commands')
        .select(SUPERVISOR_PENDING_COMMAND_COLUMNS)
        .eq('target_device_id', targetDeviceId)
        .eq('status', 'pending')
        .order('issued_at', { ascending: true })
        .limit(25);
}

export async function claimSupervisorCommand({ client = supabaseCloud, commandId, targetDeviceId } = {}) {
    if (!client || typeof commandId !== 'string' || !commandId.trim() || typeof targetDeviceId !== 'string' || !targetDeviceId.trim()) {
        return { ok: false, status: 'invalid', error: 'Comando o caja inválidos' };
    }
    const { data, error } = await client.rpc('claim_supervisor_command', {
        p_command_id: commandId,
        p_target_device_id: targetDeviceId,
    });
    if (error) {
        // `retryable` distingue un corte de transporte (se reintenta) de un
        // rechazo DEFINITIVO del servidor (permisos, comando desconocido…): con
        // este segundo el receptor terminaliza la orden en vez de dejarla
        // esperando su TTL. Usa la misma taxonomía que los reintentos del create.
        return {
            ok: false,
            status: 'failed',
            error: error.message || 'No se pudo reclamar la orden',
            retryable: isRetryableCreateError(error),
        };
    }

    const result = Array.isArray(data) ? data[0] : data;
    const allowedStates = ['received', 'pending', ...SUPERVISOR_TERMINAL_COMMAND_STATUSES];
    if (!result || result.command_id !== commandId || !allowedStates.includes(result.status)) {
        return { ok: false, status: 'failed', error: 'Respuesta inválida al reclamar la orden', retryable: false };
    }

    return {
        ok: true,
        status: result.status,
        claimed: result.claimed === true,
        expired: result.expired === true,
        data: result,
    };
}

export async function readSupervisorCommandAck(client, commandId) {
    if (!client || typeof commandId !== 'string' || !commandId.trim()) return null;
    const { data, error } = await client
        .from('supervisor_commands')
        .select('command_id, status, ack_payload, error_message')
        .eq('command_id', commandId)
        .maybeSingle();
    if (error) throw error;
    if (!data || !SUPERVISOR_TERMINAL_COMMAND_STATUSES.includes(data.status)) return null;
    return normalizeTerminalAck(data);
}

/**
 * Fase 10: inspecciona el estado de un comando SIN crear otro. Es la primera
 * acción de toda reconciliación ante timeout:
 *  - 'absent'   : no existe fila (nunca llegó a crearse) → se puede crear con el
 *                 mismo commandId.
 *  - 'terminal' : aplicado / aplicado con advertencias / rechazado / fallido /
 *                 cancelado → conclusión cierta, trae el ACK global.
 *  - 'active'   : pending vigente o received (Fase 7: received nunca expira) →
 *                 la caja puede seguir aplicándolo; NO crear otro.
 *  - 'expired'  : pending con expires_at vencido → derivado, jamás se aplicará.
 *  - 'unknown'  : no se pudo consultar (sin cliente / id inválido) → NADA se
 *                 concluye. Se distingue de 'absent' para que la reconciliación
 *                 no declare «la orden no existe» por un problema local.
 */
export async function inspectSupervisorCommandState(commandId, { client = supabaseCloud, now = Date.now() } = {}) {
    if (!client || typeof commandId !== 'string' || !commandId.trim()) {
        return { state: 'unknown', commandId: commandId || null, ack: null, row: null };
    }
    const { data, error } = await client
        .from('supervisor_commands')
        .select('command_id, status, ack_payload, error_message, issued_at, expires_at')
        .eq('command_id', commandId)
        .maybeSingle();
    if (error) throw error;
    if (!data) return { state: 'absent', commandId, ack: null, row: null };
    if (SUPERVISOR_TERMINAL_COMMAND_STATUSES.includes(data.status)) {
        return { state: 'terminal', commandId, ack: normalizeTerminalAck(data), row: data };
    }
    const expiresAt = Date.parse(data.expires_at);
    const expired = data.status === 'pending' && Number.isFinite(expiresAt) && expiresAt <= now;
    return { state: expired ? 'expired' : 'active', commandId, ack: null, row: data };
}

// Las tasas se envían como una notificación automática: la caja procesa el
// comando y muestra su aviso local, pero el Supervisor no espera confirmación
// interactiva ni convierte la notificación en un timeout visible.
export function shouldAwaitSupervisorAck(type) {
    return type !== 'supervisor.rate.set';
}

export function isSupervisorCommandEnabled(type, payload = {}) {
    if (!SUPERVISOR_COMMAND_TYPES.includes(type)) return false;
    const isProductChange = type === 'supervisor.product.create' || type === 'supervisor.product.update';
    const isIncomeBatch = type === 'supervisor.inventory.batch.adjust' && payload?.direction === 'ingreso';
    const isEgressBatch = type === 'supervisor.inventory.batch.adjust' && payload?.direction === 'egreso';
    const isRateChange = type === 'supervisor.rate.set';
    const isSupplierChange = type.startsWith('supervisor.supplier.');
    const isInvoiceChange = type.startsWith('supervisor.invoice.');

    return SUPERVISOR_REMOTE_MUTATIONS_ENABLED
        || (isProductChange && SUPERVISOR_REMOTE_PRODUCTS_ENABLED)
        || (isIncomeBatch && SUPERVISOR_REMOTE_INCOME_ENABLED)
        || (isEgressBatch && SUPERVISOR_REMOTE_EGRESS_ENABLED)
        || (isRateChange && SUPERVISOR_REMOTE_RATE_ENABLED)
        || ((isSupplierChange || isInvoiceChange) && SUPERVISOR_REMOTE_SUPPLIERS_ENABLED);
}

export function generateSupervisorCommandId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Fase 5: TTL de emisión por tipo. Con el flag apagado se emiten 60 s para
 * todo (comportamiento legacy). Con el flag activo, los tipos no sensibles al
 * tiempo se emiten con su tope extendido. El receptor acepta ambas duraciones
 * desde antes del rollout; la RPC solo acepta la ventana extendida tras
 * aplicar la migración de Fase 5.
 */
export function getCommandTtlMs(type, extendedTtl = SUPERVISOR_EXTENDED_TTL_ENABLED) {
    return extendedTtl ? getCommandMaxTtlMs(type) : SUPERVISOR_COMMAND_TTL_MS;
}

export function buildSupervisorCommand({ type, targetDeviceId, monitorDeviceId, payload, now = Date.now(), commandId = generateSupervisorCommandId(), extendedTtl }) {
    return {
        commandId,
        type,
        monitorDeviceId,
        targetDeviceId,
        issuedAt: now,
        expiresAt: now + getCommandTtlMs(type, extendedTtl),
        payload,
        schemaVersion: 1,
    };
}

function normalizeAck(data) {
    if (!data) return null;
    return Array.isArray(data) ? data[0] : data;
}

function normalizeTerminalAck(row) {
    return {
        ok: row.status === 'applied' || row.status === 'applied_with_warnings',
        status: row.status,
        commandId: row.command_id,
        ack: row.ack_payload || null,
        error: row.status === 'cancelled'
            ? 'La orden fue cancelada antes de que la caja la reclamara'
            : row.error_message || null,
    };
}

async function waitForCommandAck(commandId, timeoutMs = SUPERVISOR_ACK_TIMEOUT_MS, deps = {}) {
    const {
        client = supabaseCloud,
        getPollDelayMs = getRecoveryDelayMs,
    } = deps;

    return new Promise((resolve) => {
        let settled = false;
        let channel = null;
        let pollTimer = null;
        let pollAttempt = 0;

        const finish = (result) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            if (pollTimer) clearTimeout(pollTimer);
            if (channel) client.removeChannel(channel).catch(() => {});
            resolve(result);
        };

        const timeout = setTimeout(() => {
            // Lectura final: conclusión cierta si el ACK ya está publicado.
            readSupervisorCommandAck(client, commandId)
                .then((ack) => finish(ack || {
                    ok: false,
                    status: 'timeout',
                    error: 'La caja no confirmó la orden a tiempo',
                }))
                .catch(() => finish({
                    ok: false,
                    status: 'timeout',
                    error: 'La caja no confirmó la orden a tiempo',
                }));
        }, timeoutMs);

        // Fase 3: si el canal ACK cae, eso NO es un fallo de la orden. Se
        // degrada a lecturas periódicas con el backoff del receptor hasta el
        // límite de la espera; jamás se resuelve 'failed' por un corte de red.
        const schedulePoll = () => {
            if (settled || pollTimer) return;
            const delay = getPollDelayMs(pollAttempt);
            pollAttempt += 1;
            pollTimer = setTimeout(async () => {
                pollTimer = null;
                if (settled) return;
                try {
                    const ack = await readSupervisorCommandAck(client, commandId);
                    if (ack && !settled) {
                        finish(ack);
                        return;
                    }
                } catch {
                    // Sin lectura posible ahora: reintentar en el próximo ciclo.
                }
                if (!settled) schedulePoll();
            }, delay);
        };

        channel = client
            .channel(`supervisor-ack:${commandId}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'supervisor_commands',
                filter: `command_id=eq.${commandId}`,
            }, (payload) => {
                const row = payload.new;
                if (!row || !SUPERVISOR_TERMINAL_COMMAND_STATUSES.includes(row.status)) return;
                finish(normalizeTerminalAck(row));
            })
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    schedulePoll();
                }
            });

        // Evita perder un ACK que llegue entre el INSERT RPC y la suscripción.
        readSupervisorCommandAck(client, commandId)
            .then((ack) => {
                if (ack) finish(ack);
            })
            .catch(() => {});
    });
}

/** Fase 10: espera el ACK global de un comando YA creado (reconciliación). */
export function awaitSupervisorCommandAck(commandId, timeoutMs = SUPERVISOR_ACK_TIMEOUT_MS, deps = {}) {
    return waitForCommandAck(commandId, timeoutMs, deps);
}

// Fase 1 — reintentos de transporte del create. Un fallo de red no debe perder
// la orden: se reintenta con el MISMO commandId, payload y ventana temporal
// (la RPC es idempotente por payload idéntico y jamás crea dos comandos). El
// presupuesto de backoff total (≤ 4.5 s) queda con holgura dentro del TTL de
// 60 s de la orden.
export const CREATE_RETRY_MAX_ATTEMPTS = 3;
export const CREATE_RETRY_BASE_DELAY_MS = 1_000;
export const CREATE_RETRY_MAX_DELAY_MS = 2_000;

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Delay exponencial con jitter completo para los reintentos del create. */
export function getCreateRetryDelayMs(attempt, random = Math.random) {
    const safeAttempt = Math.max(0, Math.floor(Number(attempt) || 0));
    const exp = Math.min(CREATE_RETRY_MAX_DELAY_MS, CREATE_RETRY_BASE_DELAY_MS * (2 ** safeAttempt));
    const jitter = Math.floor(random() * exp * 0.5);
    return Math.min(CREATE_RETRY_MAX_DELAY_MS, exp + jitter);
}

/**
 * Solo se reintentan fallos de transporte. Un status HTTP < 500 o un code de
 * PostgREST/Postgres (p. ej. 'Ventana temporal inválida') es una respuesta
 * definitiva del servidor y jamás se repite.
 */
export function isRetryableCreateError(error) {
    if (!error) return false;
    const status = Number(error.status ?? error.statusCode);
    if (Number.isFinite(status) && status !== 0) return status >= 500;
    if (error.code) return false;
    return true;
}

// Backoff compartido entre la recuperación del receptor (useRemoteCommands) y
// la degradación de la espera de ACK (waitForCommandAck). Vive aquí para no
// crear un ciclo de imports; el hook lo re-exporta para conservar su API.
export const RECOVERY_BASE_DELAY_MS = 5_000;
export const RECOVERY_MAX_DELAY_MS = 20_000;

// Barrido de respaldo del receptor con el canal Realtime "conectado". Un canal
// que dice SUBSCRIBED pero no entrega eventos (socket a medias, pestaña
// restringida, eventos perdidos durante un corte) no puede dejar órdenes del
// supervisor aplicándose solo tras recargar la caja. Una consulta ligera de
// órdenes pendientes por intervalo (normalmente vacía) acota la espera sin
// tocar el camino rápido: Realtime sigue siendo la entrega inmediata. Fase 3
// del plan de egress: espaciado a 60 s (antes 15 s) — con Realtime SUBSCRIBED
// el barrido es solo red de seguridad, y 60 s sigue muy por debajo del TTL de
// 5 min de inventario/productos (ninguna orden vence sin aplicar).
export const RECEIVER_SWEEP_INTERVAL_MS = 60_000;

/**
 * Delay exponencial con jitter completo. `random` es inyectable para tests.
 * attempt 0 → ~[base, 2·base); crece hasta el máximo.
 */
export function getRecoveryDelayMs(attempt, random = Math.random) {
    const safeAttempt = Math.max(0, Math.floor(Number(attempt) || 0));
    const exp = Math.min(RECOVERY_MAX_DELAY_MS, RECOVERY_BASE_DELAY_MS * (2 ** safeAttempt));
    const jitter = Math.floor(random() * exp * 0.5);
    return Math.min(RECOVERY_MAX_DELAY_MS, exp + jitter);
}

export async function sendSupervisorCommand({
    type,
    targetDeviceId,
    payload,
    commandId,
    extendedTtl,
    client = supabaseCloud,
    ensureSession = ensureSupervisorSession,
    readPairing = readPairingRow,
    sleep = defaultSleep,
    random = Math.random,
}) {
    if (!isSupervisorCommandEnabled(type, payload)) {
        return { ok: false, status: 'disabled', error: 'Las mutaciones remotas están temporalmente deshabilitadas por seguridad' };
    }
    if (!client || !targetDeviceId) {
        return { ok: false, status: 'invalid', error: 'No hay caja objetivo' };
    }

    // Fase 2: sesión y pairing en paralelo (−1 round-trip por envío). La
    // lectura del pairing puede salir vacía o fallar si el token de sesión
    // estaba vencido al emitirse; en ese caso se reintenta UNA vez ya con la
    // sesión asegurada antes de declarar unauthorized. La autoridad real sigue
    // siendo el trigger/RLS del servidor en el INSERT.
    const [sessionResult, pairingResult] = await Promise.all([
        ensureSession(),
        readPairing({ supabase: client, primaryDeviceId: targetDeviceId }),
    ]);
    const { session, error: sessionError } = sessionResult;
    if (sessionError || !session) {
        return { ok: false, status: 'unauthenticated', error: sessionError?.message || 'No hay sesión segura' };
    }

    let { data: pairing, error: pairingError } = pairingResult;
    if (!pairing || pairingError) {
        ({ data: pairing, error: pairingError } = await readPairing({
            supabase: client,
            primaryDeviceId: targetDeviceId,
        }));
    }

    const actorId = session.user?.id;
    const authorizedMonitor = [
        { deviceId: pairing?.monitor_device_id, authId: pairing?.monitor_auth_id },
        { deviceId: pairing?.monitor_device_id_2, authId: pairing?.monitor_auth_id_2 },
    ].find((monitor) => monitor.deviceId && monitor.authId && monitor.authId === actorId);

    if (pairingError || !authorizedMonitor) {
        return { ok: false, status: 'unauthorized', error: 'El monitor no tiene un vínculo autorizado' };
    }

    const command = buildSupervisorCommand({
        type,
        targetDeviceId,
        monitorDeviceId: authorizedMonitor.deviceId,
        payload,
        extendedTtl,
        // Fase 10: el sender puede reutilizar un commandId persistido (reintento
        // tras timeout jamás debe crear un segundo comando).
        ...(commandId ? { commandId } : {}),
    });
    const validation = validateSupervisorCommand(command, {
        targetDeviceId,
        monitorDeviceId: authorizedMonitor.deviceId,
    });
    if (!validation.valid) {
        return { ok: false, status: 'invalid', error: validation.error };
    }

    // Reintentos acotados ante fallos de transporte, siempre con el mismo
    // commandId: una respuesta perdida tras crear se resuelve con la fila
    // idempotente que devuelve la propia RPC, nunca con un segundo comando.
    let created = null;
    let createError = null;
    for (let attempt = 0; attempt < CREATE_RETRY_MAX_ATTEMPTS; attempt += 1) {
        if (attempt > 0) await sleep(getCreateRetryDelayMs(attempt - 1, random));

        let response;
        try {
            response = await client.rpc('create_supervisor_command', {
                p_command_id: command.commandId,
                p_target_device_id: command.targetDeviceId,
                p_command_type: command.type,
                p_payload: command.payload,
                p_issued_at: new Date(command.issuedAt).toISOString(),
                p_expires_at: new Date(command.expiresAt).toISOString(),
            });
        } catch (thrown) {
            response = { data: null, error: thrown };
        }

        if (!response.error) {
            created = normalizeAck(response.data);
            createError = null;
            break;
        }
        createError = response.error;
        if (!isRetryableCreateError(response.error)) break;
    }

    if (createError) {
        // Un error NO reintentable es un rechazo CIERTO del servidor (validación
        // de la ventana, payload, permisos…): la orden NUNCA llegó a crearse y
        // jamás se aplicará. Solo el transporte agotado deja el resultado
        // incierto ('failed': la RPC pudo crear la fila y perderse la respuesta).
        // El vocabulario lo fija tests/supervisorCommands.test.js: 'rejected'
        // jamás puede venir de un fallo de transporte.
        const certain = !isRetryableCreateError(createError);
        return {
            ok: false,
            status: certain ? 'rejected' : 'failed',
            error: createError.message || 'No se pudo crear la orden',
        };
    }

    if (!created?.command_id) {
        return { ok: false, status: 'failed', error: 'El servidor no devolvió command_id' };
    }

    return {
        ok: true,
        status: shouldAwaitSupervisorAck(type) ? (created.status || 'pending') : 'sent',
        commandId: created.command_id,
        ackPromise: shouldAwaitSupervisorAck(type)
            ? waitForCommandAck(created.command_id, SUPERVISOR_ACK_TIMEOUT_MS, { client })
            : null,
    };
}

export default {
    buildSupervisorCommand,
    sendSupervisorCommand,
    shouldAwaitSupervisorAck,
    isSupervisorCommandEnabled,
    fetchPendingSupervisorCommands,
    fetchSupervisorCommandsForRecovery,
    claimSupervisorCommand,
    readSupervisorCommandAck,
    inspectSupervisorCommandState,
    awaitSupervisorCommandAck,
    generateSupervisorCommandId,
    withSupervisorCommandLock,
};
