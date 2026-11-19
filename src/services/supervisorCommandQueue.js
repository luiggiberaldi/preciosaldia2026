// ── Cola local de órdenes del supervisor (Propuesta 5) ─────────────────────
// Modelo de Donde Juancho: "si no hay internet, los cambios esperan guardados y
// se suben solos cuando vuelve la conexión". Cada cambio que no pudo enviarse
// queda aquí como una entrada completa (tipo + payload + productos afectados),
// visible como "EN COLA" en las fichas de producto y contado por el banner.
//
// Reglas:
//   - La cola es persistente (localStorage) y su lógica es pura: los efectos
//     (red, toasts, ops de stock) los ejecuta el llamador inyectando `send`.
//   - El reenvío conserva EL ORDEN de las entradas y se detiene en el primer
//     fallo (un movimiento posterior jamás se salta uno anterior pendiente).
//   - Descartar siempre es una decisión del usuario (nunca automático).
//   - Una entrada guardada aún NO es un comando: no se trackea ni se anuncia
//     hasta que se envía de verdad ("un cambio = un aviso").

export const SUPERVISOR_COMMAND_QUEUE_KEY = 'pda_supervisor_command_queue_v1';
export const QUEUE_MAX_ENTRIES = 200;

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const listeners = new Set();
let memoryQueue = [];
let pendingWrite = Promise.resolve();
let storageOverride = null;

function persist() {
    const storage = storageOverride || (typeof globalThis !== 'undefined' ? globalThis.localStorage : null);
    pendingWrite = pendingWrite
        .then(() => {
            if (!storage) return;
            if (!memoryQueue.length) storage.removeItem(SUPERVISOR_COMMAND_QUEUE_KEY);
            else storage.setItem(SUPERVISOR_COMMAND_QUEUE_KEY, JSON.stringify(memoryQueue));
        })
        .catch(() => { /* sin almacenamiento la cola sigue viva en memoria */ });
    return pendingWrite;
}

function notify() {
    listeners.forEach(listener => {
        try { listener(getQueuedSupervisorCommands()); } catch { /* un listener roto no rompe la cola */ }
    });
}

function loadFromStorage() {
    const storage = storageOverride || (typeof globalThis !== 'undefined' ? globalThis.localStorage : null);
    try {
        const raw = storage?.getItem(SUPERVISOR_COMMAND_QUEUE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        memoryQueue = Array.isArray(parsed)
            ? parsed
                .filter(entry => entry && entry.id && entry.type)
                .map(entry => ({ ...entry, payload: sanitizeQueuedPayload(entry.type, entry.payload) }))
            : [];
    } catch {
        memoryQueue = [];
    }
}

// Carga perezosa: la primera lectura restaura lo persistido.
let hydrated = false;
function ensureHydrated() {
    if (!hydrated) {
        hydrated = true;
        loadFromStorage();
    }
    return memoryQueue;
}

/** Productos afectados por un payload, según el tipo de orden. */
export function productIdsOf(type, payload = {}) {
    const id = (value) => (value == null ? null : String(value));
    switch (type) {
        case 'supervisor.inventory.batch.adjust': {
            if (Array.isArray(payload.lines)) {
                return [...new Set(payload.lines.map(line => id(line?.productId)).filter(Boolean))];
            }
            return payload.productId != null ? [id(payload.productId)] : [];
        }
        case 'supervisor.product.create':
            return payload.product?.id != null ? [id(payload.product.id)] : [];
        case 'supervisor.product.update':
        case 'supervisor.product.delete':
            return payload.productId != null ? [id(payload.productId)] : [];
        default:
            return [];
    }
}

// Campos que el servidor acepta en cada línea de un ajuste por lote v2
// (is_valid_supervisor_inventory_batch_payload). Cualquier otro hace que la RPC
// responda «Payload de ajuste por lote inválido» en cada reintento y, como la
// cola se detiene en el primer fallo, bloquea todo lo que viene detrás.
const BATCH_V2_LINE_KEYS = Object.freeze([
    'productId', 'inputUnit', 'quantityInput', 'expectedStock', 'lineId', 'baseRevision', 'unitsPerPackage',
]);

/** Deja el payload solo con lo que el servidor admite (repara colas viejas). */
export function sanitizeQueuedPayload(type, payload) {
    if (!isPlainObject(payload)) return {};
    if (type !== 'supervisor.inventory.batch.adjust' || !Array.isArray(payload.lines)) return payload;
    return {
        ...payload,
        lines: payload.lines.map(line => (isPlainObject(line)
            ? Object.fromEntries(Object.entries(line).filter(([key]) => BATCH_V2_LINE_KEYS.includes(key)))
            : line)),
    };
}

function normalizeEntry(input = {}) {
    const type = String(input.type || '');
    return {
        id: String(input.id || `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`),
        kind: String(input.kind || 'generic'),
        type,
        payload: sanitizeQueuedPayload(type, input.payload),
        label: String(input.label || 'cambio pendiente'),
        targetDeviceId: input.targetDeviceId ?? null,
        productIds: Array.isArray(input.productIds) && input.productIds.length
            ? input.productIds.map(String)
            : productIdsOf(type, input.payload),
        createdAt: input.createdAt || new Date().toISOString(),
        attempts: Number(input.attempts) || 0,
        lastError: input.lastError ?? null,
        blockedAt: input.blockedAt ?? null,
    };
}

export function enqueueSupervisorCommand(input = {}) {
    const entries = ensureHydrated();
    const entry = normalizeEntry(input);
    memoryQueue = [...entries, entry].slice(-QUEUE_MAX_ENTRIES);
    persist();
    notify();
    return entry;
}

export function getQueuedSupervisorCommands() {
    return ensureHydrated().map(entry => ({ ...entry }));
}

export function countQueuedSupervisorCommands() {
    return ensureHydrated().length;
}

/** Productos con al menos un cambio aún sin subir (para los badges "EN COLA"). */
export function queuedProductIds() {
    const ids = new Set();
    ensureHydrated().forEach(entry => (entry.productIds || []).forEach(id => ids.add(String(id))));
    return ids;
}

export function discardQueuedSupervisorCommand(id) {
    const before = ensureHydrated().length;
    memoryQueue = ensureHydrated().filter(entry => entry.id !== String(id));
    if (memoryQueue.length === before) return false;
    persist();
    notify();
    return true;
}

export function discardAllQueuedSupervisorCommands() {
    const discarded = ensureHydrated().length;
    if (!discarded) return 0;
    memoryQueue = [];
    persist();
    notify();
    return discarded;
}

export function subscribeSupervisorCommandQueue(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/**
 * Solo para pruebas: limpia la cola y la memoria. Con `clearStorage: false` se
 * simula una recarga (memoria vacía, storage intacto).
 */
export function resetSupervisorCommandQueue({ storage = null, clearStorage = true } = {}) {
    memoryQueue = [];
    hydrated = false;
    storageOverride = storage;
    listeners.clear();
    if (!clearStorage) return;
    try {
        (storage || (typeof globalThis !== 'undefined' ? globalThis.localStorage : null))?.removeItem(SUPERVISOR_COMMAND_QUEUE_KEY);
    } catch { /* sin storage no hay nada que limpiar */ }
}

export function flushSupervisorCommandQueueStorage({ storage } = {}) {
    storageOverride = storage || null;
    return persist();
}

/** Espera la escritura pendiente (para pruebas y cierres limpios). */
export function flushSupervisorCommandQueueWrite() {
    return pendingWrite;
}

/** Errores que significan "no se pudo subir ahora" (y por eso la entrada queda). */
export function isConnectivityError(message) {
    return /conexi[oó]n|conect|desconect|offline|network|fetch|timeout|tiempo de espera|no se pudo enviar/i.test(String(message || ''));
}

/**
 * Rechazos CIERTOS: la nube (o el propio monitor) dijo «no» y repetir el mismo
 * envío dará el mismo «no». Caso Bodega mani (2026-11-19): la versión vieja
 * reintentó una orden inválida cada 30 s todo el día (457 rechazos) y todo lo
 * de detrás quedó esperando. Los fallos de red, de sesión o un interruptor
 * apagado NO entran aquí: esos sí se arreglan solos.
 */
export const QUEUE_BLOCKING_STATUSES = Object.freeze(['rejected', 'invalid', 'unauthorized']);

export function isBlockingRejection(outcome) {
    return QUEUE_BLOCKING_STATUSES.includes(outcome?.status) && !isConnectivityError(outcome?.error);
}

/** Primera entrada de la cola si quedó bloqueada por un rechazo cierto. */
export function getBlockedQueueEntry() {
    const first = ensureHydrated()[0];
    return first?.blockedAt ? first : null;
}

/**
 * Reenvía la cola EN ORDEN. `send(entry)` debe resolver `{ ok, status?,
 * commandId?, ackPromise?, error? }`. En el primer fallo se detiene: lo que
 * sigue espera a que lo anterior se resuelva (nunca saltar órdenes).
 *
 * Si el fallo es un rechazo cierto, la entrada queda BLOQUEADA (`blockedAt`) y
 * el barrido automático (`auto: true`) deja de reintentarla: solo «SUBIR AL
 * SISTEMA» (intento manual) o «DESCARTAR» la destraban.
 */
export async function flushSupervisorCommandQueue({ send, auto = false, now = () => new Date().toISOString() } = {}) {
    const entries = getQueuedSupervisorCommands();
    const results = [];
    if (auto && entries[0]?.blockedAt) {
        return { sent: 0, failed: 0, blocked: entries[0], results };
    }
    let blocked = null;
    for (const entry of entries) {
        let outcome;
        try {
            outcome = await send(entry);
        } catch (error) {
            outcome = { ok: false, error: error?.message || String(error) };
        }
        if (outcome?.ok) {
            discardQueuedSupervisorCommand(entry.id);
            results.push({ entry, result: outcome });
            continue;
        }
        const blocking = isBlockingRejection(outcome);
        memoryQueue = ensureHydrated().map(item => (item.id === entry.id
            ? {
                ...item,
                attempts: item.attempts + 1,
                lastError: outcome?.error || 'sin confirmación',
                blockedAt: blocking ? (item.blockedAt || now()) : null,
            }
            : item));
        persist();
        notify();
        if (blocking) blocked = memoryQueue.find(item => item.id === entry.id) || null;
        results.push({ entry, result: outcome, failed: true, blocked: blocking });
        break;
    }
    return {
        sent: results.filter(item => !item.failed).length,
        failed: results.filter(item => item.failed).length,
        blocked,
        results,
    };
}

/**
 * Punto de entrada de los flujos de envío: si no se puede enviar AHORA, el
 * cambio se guarda en la cola ("EN COLA") en vez de perderse. Si se envía, el
 * llamador trackea con el commandId real (la cola jamás trackea).
 */
export async function sendOrQueueSupervisorCommand({
    type,
    payload,
    targetDeviceId = null,
    label = 'cambio pendiente',
    kind = 'generic',
    canSend = true,
    send,
} = {}) {
    const productIds = productIdsOf(type, payload);
    if (!canSend) {
        const entry = enqueueSupervisorCommand({ kind, type, payload, label, targetDeviceId, productIds });
        return { ok: true, queued: true, entry };
    }
    let result;
    try {
        result = await send({ type, payload, targetDeviceId });
    } catch (error) {
        result = { ok: false, error: error?.message || String(error) };
    }
    if (result?.ok) return result;
    if (isConnectivityError(result?.error)) {
        const entry = enqueueSupervisorCommand({ kind, type, payload, label, targetDeviceId, productIds });
        return { ok: true, queued: true, entry, previousError: result?.error || null };
    }
    return result;
}

// ── Estado visible por producto (Propuesta 4) ──────────────────────────────
// Derivación pura: el componente solo pinta. Prioridad: lo que aún no se subió
// ("EN COLA") nunca desaparece mientras exista, aunque haya algo en vuelo.

/** Ventana en la que un ACK reciente todavía muestra el sello "APLICADO". */
export const APPLIED_BADGE_MS = 15 * 60_000;

const IN_FLIGHT_STOCK_STATES = Object.freeze(['sending', 'pending']);

export function productQueueState({
    productId,
    queueEntries = [],
    stockOp = null,
    trackedInFlight = false,
    trackedAppliedAt = null,
    now = Date.now(),
} = {}) {
    const id = productId == null ? null : String(productId);
    if (id == null) return null;

    const queued = (queueEntries || []).some(entry => (entry?.productIds || []).map(String).includes(id));
    if (queued) return { key: 'queued', label: 'EN COLA', tone: 'info' };

    const opInFlight = Boolean(stockOp && IN_FLIGHT_STOCK_STATES.includes(stockOp.state));
    if (opInFlight || trackedInFlight) {
        return { key: 'waiting', label: 'ESPERANDO A LA CAJA', tone: 'warning' };
    }

    const opApplied = stockOp?.state === 'applied';
    const trackedApplied = trackedAppliedAt != null
        && Number.isFinite(Date.parse(trackedAppliedAt))
        && now - Date.parse(trackedAppliedAt) < APPLIED_BADGE_MS;
    if (opApplied || trackedApplied) return { key: 'applied', label: 'APLICADO', tone: 'success' };

    return null;
}

export default {
    SUPERVISOR_COMMAND_QUEUE_KEY,
    APPLIED_BADGE_MS,
    productQueueState,
    productIdsOf,
    enqueueSupervisorCommand,
    getQueuedSupervisorCommands,
    countQueuedSupervisorCommands,
    queuedProductIds,
    discardQueuedSupervisorCommand,
    discardAllQueuedSupervisorCommands,
    getBlockedQueueEntry,
    isBlockingRejection,
    subscribeSupervisorCommandQueue,
    resetSupervisorCommandQueue,
    flushSupervisorCommandQueue,
    flushSupervisorCommandQueueWrite,
    isConnectivityError,
    sendOrQueueSupervisorCommand,
};
