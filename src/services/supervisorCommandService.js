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

export function fetchPendingSupervisorCommands(client, targetDeviceId) {
    return client
        .from('supervisor_commands')
        .select(SUPERVISOR_PENDING_COMMAND_COLUMNS)
        .eq('target_device_id', targetDeviceId)
        .eq('status', 'pending')
        .order('issued_at', { ascending: true })
        .limit(25);
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

function generateCommandId() {
    if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
    return `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 12)}`;
}

export function buildSupervisorCommand({ type, targetDeviceId, monitorDeviceId, payload, now = Date.now(), commandId = generateCommandId() }) {
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

        const timeout = setTimeout(() => finish({
            ok: false,
            status: 'timeout',
            error: 'La caja no confirmó la orden a tiempo',
        }), timeoutMs);

        channel = supabaseCloud
            .channel(`supervisor-ack:${commandId}`)
            .on('postgres_changes', {
                event: 'UPDATE',
                schema: 'public',
                table: 'supervisor_commands',
                filter: `command_id=eq.${commandId}`,
            }, (payload) => {
                const row = payload.new;
                if (!row || !['applied', 'rejected', 'failed'].includes(row.status)) return;
                clearTimeout(timeout);
                finish({
                    ok: row.status === 'applied',
                    status: row.status,
                    commandId: row.command_id,
                    ack: row.ack_payload || null,
                    error: row.error_message || null,
                });
            })
            .subscribe((status) => {
                if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                    clearTimeout(timeout);
                    finish({ ok: false, status: 'failed', error: `Canal ACK: ${status}` });
                }
            });

        // Evita perder un ACK que llegue entre el INSERT RPC y la suscripción.
        supabaseCloud
            .from('supervisor_commands')
            .select('command_id, status, ack_payload, error_message')
            .eq('command_id', commandId)
            .maybeSingle()
            .then(({ data, error }) => {
                if (error || !data || !['applied', 'rejected', 'failed'].includes(data.status)) return;
                clearTimeout(timeout);
                finish({
                    ok: data.status === 'applied',
                    status: data.status,
                    commandId: data.command_id,
                    ack: data.ack_payload || null,
                    error: data.error_message || null,
                });
            })
            .catch(() => {});
    });
}

export async function sendSupervisorCommand({ type, targetDeviceId, payload }) {
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
};
