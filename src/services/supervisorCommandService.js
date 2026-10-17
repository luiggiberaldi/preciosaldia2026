import { supabaseCloud } from '../config/supabaseCloud';
import {
    SUPERVISOR_REMOTE_MUTATIONS_ENABLED,
    SUPERVISOR_REMOTE_PRODUCTS_ENABLED,
    SUPERVISOR_REMOTE_INCOME_ENABLED,
    SUPERVISOR_REMOTE_RATE_ENABLED,
    SUPERVISOR_REMOTE_EGRESS_ENABLED,
} from '../config/supervisorPolicy';
import { ensureSupervisorSession } from './supervisorAuth';
import { readPairingRow } from './supervisorPairingState';
import { SUPERVISOR_COMMAND_TYPES, validateSupervisorCommand } from './supervisorContracts';

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
    if (error) return { ok: false, status: 'failed', error: error.message || 'No se pudo reclamar la orden' };

    const result = Array.isArray(data) ? data[0] : data;
    const allowedStates = ['received', 'pending', ...SUPERVISOR_TERMINAL_COMMAND_STATUSES];
    if (!result || result.command_id !== commandId || !allowedStates.includes(result.status)) {
        return { ok: false, status: 'failed', error: 'Respuesta inválida al reclamar la orden' };
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
 */
export async function inspectSupervisorCommandState(commandId, { client = supabaseCloud, now = Date.now() } = {}) {
    if (!client || typeof commandId !== 'string' || !commandId.trim()) {
        return { state: 'absent', commandId: commandId || null, ack: null, row: null };
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

    return SUPERVISOR_REMOTE_MUTATIONS_ENABLED
        || (isProductChange && SUPERVISOR_REMOTE_PRODUCTS_ENABLED)
        || (isIncomeBatch && SUPERVISOR_REMOTE_INCOME_ENABLED)
        || (isEgressBatch && SUPERVISOR_REMOTE_EGRESS_ENABLED)
        || (isRateChange && SUPERVISOR_REMOTE_RATE_ENABLED);
}

export function generateSupervisorCommandId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export function buildSupervisorCommand({ type, targetDeviceId, monitorDeviceId, payload, now = Date.now(), commandId = generateSupervisorCommandId() }) {
    return {
        commandId,
        type,
        monitorDeviceId,
        targetDeviceId,
        issuedAt: now,
        expiresAt: now + SUPERVISOR_COMMAND_TTL_MS,
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

async function waitForCommandAck(commandId, timeoutMs = SUPERVISOR_ACK_TIMEOUT_MS) {
    return new Promise((resolve) => {
        let settled = false;
        let channel = null;
        const finish = (result) => {
            if (settled) return;
            settled = true;
            if (channel) supabaseCloud.removeChannel(channel).catch(() => {});
            resolve(result);
        };

        const timeout = setTimeout(() => {
            readSupervisorCommandAck(supabaseCloud, commandId)
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

        channel = supabaseCloud
            .channel(`supervisor-ack:${commandId}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'supervisor_commands',
                filter: `command_id=eq.${commandId}`,
            }, (payload) => {
                const row = payload.new;
                if (!row || !SUPERVISOR_TERMINAL_COMMAND_STATUSES.includes(row.status)) return;
                clearTimeout(timeout);
                finish(normalizeTerminalAck(row));
            })
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    clearTimeout(timeout);
                    finish({ ok: false, status: 'failed', error: `Canal ACK: ${status}` });
                }
            });

        // Evita perder un ACK que llegue entre el INSERT RPC y la suscripción.
        readSupervisorCommandAck(supabaseCloud, commandId)
            .then((ack) => {
                if (!ack) return;
                clearTimeout(timeout);
                finish(ack);
            })
            .catch(() => {});
    });
}

/** Fase 10: espera el ACK global de un comando YA creado (reconciliación). */
export function awaitSupervisorCommandAck(commandId, timeoutMs = SUPERVISOR_ACK_TIMEOUT_MS) {
    return waitForCommandAck(commandId, timeoutMs);
}

export async function sendSupervisorCommand({ type, targetDeviceId, payload, commandId }) {
    if (!isSupervisorCommandEnabled(type, payload)) {
        return { ok: false, status: 'disabled', error: 'Las mutaciones remotas están temporalmente deshabilitadas por seguridad' };
    }
    if (!supabaseCloud || !targetDeviceId) {
        return { ok: false, status: 'invalid', error: 'No hay caja objetivo' };
    }

    const { session, error: sessionError } = await ensureSupervisorSession();
    if (sessionError || !session) {
        return { ok: false, status: 'unauthenticated', error: sessionError?.message || 'No hay sesión segura' };
    }

    const { data: pairing, error: pairingError } = await readPairingRow({
        supabase: supabaseCloud,
        primaryDeviceId: targetDeviceId,
    });

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

    const { data, error } = await supabaseCloud.rpc('create_supervisor_command', {
        p_command_id: command.commandId,
        p_target_device_id: command.targetDeviceId,
        p_command_type: command.type,
        p_payload: command.payload,
        p_issued_at: new Date(command.issuedAt).toISOString(),
        p_expires_at: new Date(command.expiresAt).toISOString(),
    });

    if (error) {
        return { ok: false, status: 'failed', error: error.message || 'No se pudo crear la orden' };
    }

    const created = normalizeAck(data);
    if (!created?.command_id) {
        return { ok: false, status: 'failed', error: 'El servidor no devolvió command_id' };
    }

    return {
        ok: true,
        status: shouldAwaitSupervisorAck(type) ? (created.status || 'pending') : 'sent',
        commandId: created.command_id,
        ackPromise: shouldAwaitSupervisorAck(type)
            ? waitForCommandAck(created.command_id)
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
