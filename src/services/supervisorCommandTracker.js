// ── Tracker de resultados de comandos del Supervisor ────────────────────────
// Regla fundamental: "el supervisor debe saber si su cambio hizo efecto o no,
// en cualquier tipo de cambio". Este módulo es la ÚNICA autoridad de avisos de
// resultado de comandos: todo comando enviado se registra aquí y termina en
// exactamente un aviso final:
//   - applied                → verde "✅ La caja aplicó tu cambio" (SIEMPRE),
//   - applied_with_warnings  → ámbar "se aplicó con reservas",
//   - rejected / failed      → rojo con el motivo en palabras,
//   - cancelled              → ámbar "fue cancelado",
//   - sin confirmación       → ámbar "sigue esperando" / "venció sin aplicarse".
// El timeout NO es un cierre definitivo: se sigue reconciliando el mismo
// commandId y, si el resultado real llega después, ese aviso manda.
// Sin dependencias de React: la interfaz llama trackSupervisorCommand y sigue
// trabajando; el resultado llega solo como aviso.

import { showToast } from '../components/Toast';
import * as commandService from './supervisorCommandService';

// Resolución defensiva de dependencias del servicio: el tracker debe seguir
// siendo la autoridad de avisos aunque el servicio esté parcialmente disponible
// (mocks de prueba, cargas diferidas). Nunca lanza por un export ausente.
function serviceFn(name) {
    try {
        const fn = commandService[name];
        return typeof fn === 'function' ? fn : null;
    } catch {
        return null;
    }
}

function defaultInteractiveAck(type) {
    const shouldAwait = serviceFn('shouldAwaitSupervisorAck');
    return shouldAwait ? Boolean(shouldAwait(type)) : true;
}

// Mismo contrato que SUPERVISOR_TERMINAL_COMMAND_STATUSES del servicio. Se
// declara local para que el tracker siga siendo la autoridad de avisos aunque
// el servicio se parcialice (mocks de prueba, cargas diferidas).
export const COMMAND_TERMINAL_STATUSES = Object.freeze([
    'applied',
    'applied_with_warnings',
    'rejected',
    'failed',
    'cancelled',
]);

export const COMMAND_FOLLOW_UP_INTERVAL_MS = 15_000;
export const COMMAND_FOLLOW_UP_BUDGET_MS = 15 * 60_000;

const records = new Map();
const listeners = new Set();

const defaultSleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const DEFAULT_LABELS = {
    'supervisor.rate.set': 'el cambio de tasa',
    'supervisor.product.create': 'el alta de producto',
    'supervisor.product.update': 'la edición del producto',
    'supervisor.product.delete': 'la baja del producto',
    'supervisor.user.create': 'el alta de usuario',
    'supervisor.user.pin.change': 'el cambio de PIN',
    'supervisor.user.update': 'la edición de usuario',
    'supervisor.user.delete': 'la baja de usuario',
    'supervisor.shift.close': 'el cierre de turno',
    'supervisor.shift.reopen': 'la reapertura de turno',
    'supervisor.inventory.batch.adjust': 'el ajuste de inventario',
};

/** Descripción llana del cambio: nombra qué se pidió, nunca un genérico vacío. */
export function describeSupervisorCommand(type, payload = {}) {
    switch (type) {
        case 'supervisor.rate.set':
            return `el cambio de tasa${payload.rateMode ? ` (${payload.rateMode})` : ''}`;
        case 'supervisor.product.create':
            return `el alta de "${payload.product?.name || 'producto'}"`;
        case 'supervisor.product.update':
            return payload.patch?.name
                ? `la edición de "${payload.patch.name}"`
                : 'la edición del producto';
        case 'supervisor.product.delete':
            return payload.productName
                ? `la baja de "${payload.productName}"`
                : 'la baja del producto';
        case 'supervisor.user.create':
            return `el alta de "${payload.nombre || 'usuario'}"`;
        case 'supervisor.user.pin.change':
            return payload.nombre ? `el cambio de PIN de "${payload.nombre}"` : 'el cambio de PIN';
        case 'supervisor.user.update':
            return `la edición de "${payload.nombre || 'usuario'}"`;
        case 'supervisor.user.delete':
            return payload.nombre ? `la baja de "${payload.nombre}"` : 'la baja de usuario';
        case 'supervisor.inventory.batch.adjust': {
            const lines = Array.isArray(payload.lines) ? payload.lines.length : (payload.productId ? 1 : 0);
            const base = DEFAULT_LABELS[type];
            return lines > 0 ? `${base} (${lines} movimiento${lines === 1 ? '' : 's'})` : base;
        }
        default:
            return DEFAULT_LABELS[type] || 'el cambio solicitado';
    }
}

function ackReason(ack) {
    const reason = String(ack?.error || '').trim();
    return reason || 'La caja no indicó el motivo.';
}

function ackStockDetail(ack) {
    const stockAfter = ack?.ack?.stockAfter;
    return stockAfter === undefined || stockAfter === null ? '' : ` (quedó en ${stockAfter})`;
}

function ackWarningsDetail(ack) {
    const warnings = ack?.ack?.warnings ?? ack?.ack?.warning;
    if (!warnings) return '';
    const text = Array.isArray(warnings) ? warnings.join('; ') : String(warnings);
    return text.trim() ? ` (${text.trim()})` : '';
}

/**
 * Aviso para cada tramo del ciclo de vida del comando. `kind` es uno de:
 * 'sent', 'applied', 'applied_with_warnings', 'rejected', 'failed', 'cancelled',
 * 'waiting', 'expired'. Devuelve { message, type } con el tipo de toast.
 */
export function buildCommandNotice(kind, { label = 'el cambio', ack = null, interactiveAck = true } = {}) {
    switch (kind) {
        case 'sent':
            return interactiveAck
                ? { message: `✈️ Cambio enviado a la caja — esperando confirmación: ${label}`, type: 'info' }
                : { message: `📣 Notificación enviada a la caja: ${label}`, type: 'info' };
        case 'applied':
            return { message: `✅ La caja aplicó tu cambio — ${label}${ackStockDetail(ack)}`, type: 'success' };
        case 'applied_with_warnings':
            return { message: `⚠️ Se aplicó con reservas — ${label}${ackWarningsDetail(ack)}`, type: 'warning' };
        case 'rejected':
            return { message: `❌ La caja rechazó el cambio — ${label}. ${ackReason(ack)}`, type: 'error' };
        case 'failed':
            return { message: `❌ No se pudo aplicar el cambio — ${label}. ${ackReason(ack)}`, type: 'error' };
        case 'cancelled':
            return { message: `⚠️ El cambio fue cancelado — ${label}`, type: 'warning' };
        case 'waiting':
            return { message: `⏳ Sigue esperando a la caja — ${label} puede seguir en camino`, type: 'warning' };
        case 'expired':
            return { message: `⚠️ La orden venció sin aplicarse — ${label}. Vuelve a intentarlo`, type: 'warning' };
        default:
            return { message: `Estado desconocido del cambio — ${label}`, type: 'warning' };
    }
}

function isTerminalAck(ack) {
    return Boolean(ack && COMMAND_TERMINAL_STATUSES.includes(ack.status));
}

/**
 * Adapta un resultado de flujo (p. ej. el outcome del sender de lote) a la
 * forma del ACK para que el tracker lo trate como su aviso final.
 */
export function commandOutcomeToAck(outcome) {
    if (!outcome || typeof outcome !== 'object') return null;
    return {
        ok: Boolean(outcome.ok),
        status: outcome.status || null,
        commandId: outcome.commandId || null,
        ack: outcome.ack || null,
        error: outcome.error || null,
    };
}

function emitChange() {
    const snapshot = getTrackedSupervisorCommands();
    listeners.forEach((listener) => {
        try { listener(snapshot); } catch { /* un oyente roto no rompe el seguimiento */ }
    });
}

function notifyNotice(notify, kind, record, ack = null) {
    const { message, type } = buildCommandNotice(kind, {
        label: record.label,
        ack,
        interactiveAck: record.interactiveAck,
    });
    notify?.(message, type);
}

function settle(record, ack, notify) {
    if (record.finalNotified) return;
    record.finalNotified = true;
    record.state = ack.status;
    record.outcome = ack;
    notifyNotice(notify, ack.status, record, ack);
    emitChange();
}

function settleExpired(record, notify) {
    if (record.finalNotified) return;
    record.finalNotified = true;
    record.state = 'expired';
    notifyNotice(notify, 'expired', record);
    emitChange();
}

function announceWaiting(record, notify) {
    if (record.waitingNotified) return;
    record.waitingNotified = true;
    notifyNotice(notify, 'waiting', record);
    emitChange();
}

async function run(record, deps) {
    const {
        ackPromise,
        awaitAck,
        inspectState,
        notify,
        followUpIntervalMs,
        followUpBudgetMs,
        sleep,
    } = deps;

    let first = null;
    try {
        first = ackPromise
            ? await ackPromise
            : (typeof awaitAck === 'function' ? await awaitAck(record.commandId) : null);
    } catch {
        first = null;
    }
    if (isTerminalAck(first)) {
        settle(record, first, notify);
        return;
    }

    // Sin confirmación en la primera ventana: el timeout NO cierra el ciclo.
    if (record.interactiveAck) announceWaiting(record, notify);

    const deadline = Date.now() + followUpBudgetMs;
    while (Date.now() < deadline) {
        await sleep(followUpIntervalMs);
        let inspection = null;
        try {
            inspection = typeof inspectState === 'function' ? await inspectState(record.commandId) : null;
        } catch {
            inspection = null;
        }
        if (inspection?.state === 'terminal' && isTerminalAck(inspection.ack)) {
            settle(record, inspection.ack, notify);
            return;
        }
        if (inspection?.state === 'expired') {
            settleExpired(record, notify);
            return;
        }
    }

    // Presupuesto agotado sin confirmación: nunca silencio. El aviso ámbar
    // "sigue esperando" es el resultado visible de este camino.
    if (!record.finalNotified) announceWaiting(record, notify);
}

/**
 * Registra un comando enviado y garantiza su aviso final. Idempotente por
 * commandId: un reintento con el mismo ID no duplica avisos.
 */
export function trackSupervisorCommand({
    commandId,
    type,
    payload = {},
    label,
    ackPromise = null,
    awaitAck = serviceFn('awaitSupervisorCommandAck'),
    inspectState = serviceFn('inspectSupervisorCommandState'),
    notify = showToast,
    announceSent = true,
    interactiveAck,
    followUpIntervalMs = COMMAND_FOLLOW_UP_INTERVAL_MS,
    followUpBudgetMs = COMMAND_FOLLOW_UP_BUDGET_MS,
    sleep = defaultSleep,
} = {}) {
    const id = String(commandId || '').trim();
    if (!id) return null;
    const existing = records.get(id);
    if (existing) return existing;

    // Si falta la función del servicio se asume tipo interactivo (camino
    // conservador: siempre hay aviso visible).
    const interactive = interactiveAck === undefined
        ? defaultInteractiveAck(type)
        : Boolean(interactiveAck);

    const record = {
        commandId: id,
        type,
        payload,
        label: label || describeSupervisorCommand(type, payload),
        interactiveAck: interactive,
        state: 'waiting',
        outcome: null,
        sentAt: Date.now(),
        waitingNotified: false,
        finalNotified: false,
        promise: null,
    };
    records.set(id, record);
    emitChange();
    if (announceSent) notifyNotice(notify, 'sent', record);

    record.promise = run(record, {
        ackPromise,
        awaitAck,
        inspectState,
        notify,
        followUpIntervalMs,
        followUpBudgetMs,
        sleep,
    });
    return record;
}

/**
 * ¿El resultado de este comando lo anuncia el tracker? Si es así, el resto de
 * la interfaz (franjas, paneles) muestra el detalle pero NO lanza otro toast.
 */
export function isCommandOutcomeOwned(commandId) {
    return records.has(String(commandId || '').trim());
}

export function getTrackedSupervisorCommands() {
    return [...records.values()];
}

const SETTABLE_VERIFICATION_LEVELS = Object.freeze(['received', 'verified', 'mismatch']);

/**
 * Refleja el sello de verificación (propuesta 7) en el estado del comando.
 * El sello es ESTADO, no un aviso: no dispara ningún toast… salvo un
 * 'mismatch', que es una alerta y se anuncia UNA sola vez por comando.
 * Devuelve false si el comando no está trackeado (p. ej. tras una recarga).
 */
export function setCommandVerification(commandId, verification, { notify = showToast } = {}) {
    const record = records.get(String(commandId || '').trim());
    if (!record) return false;
    const level = SETTABLE_VERIFICATION_LEVELS.includes(verification?.level)
        ? verification.level
        : 'received';
    record.verification = {
        level,
        detail: verification?.detail || null,
        checkedAt: verification?.checkedAt || new Date().toISOString(),
    };
    if (level === 'mismatch' && !record.mismatchAlerted) {
        record.mismatchAlerted = true;
        notify?.(`🔴 No coincide — revisar: ${record.label} no se ve reflejado en la caja`, 'error');
    }
    emitChange();
    return true;
}

/** Suscripción ligera para badges de estado (futuras propuestas 3 y 4). */
export function subscribeSupervisorCommandTracker(listener) {
    if (typeof listener !== 'function') return () => {};
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function resetSupervisorCommandTracker() {
    records.clear();
    listeners.clear();
}

export default {
    trackSupervisorCommand,
    commandOutcomeToAck,
    setCommandVerification,
    isCommandOutcomeOwned,
    getTrackedSupervisorCommands,
    subscribeSupervisorCommandTracker,
    resetSupervisorCommandTracker,
    buildCommandNotice,
    describeSupervisorCommand,
};
