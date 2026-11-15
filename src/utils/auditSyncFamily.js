/**
 * Familia de sync de `abasto_audit_log_v1` por FRANJAS de 2 horas (UTC).
 * Plan 2026-11-14-plan-fixeo-egress-realtime, F1.
 *
 * Por qué: el log se publicaba entero (1.200 entradas ≈ 407 KB de JSON) en
 * cada acción; medido el 13-nov-2026 eran 450 subidas/día de 300–500 KB, el
 * 81 % de todo lo subido a `sync_documents`, y Realtime lo reenviaba entero a
 * cada supervisor conectado. Con franjas de 2 h una venta solo reescribe la
 * franja en curso (decenas de KB; 450 eventos en 4 h ≈ 70 KB por franja).
 *
 * Doc: `abasto_audit_log_v1:<YYYY-MM-DD>T<HH>` con HH par (00, 02, … 22).
 * Ventana publicada: los últimos AUDIT_SYNC_WINDOW_DAYS días (decisión D1); la
 * copia LOCAL conserva su retención fiscal (15.000 entradas / 5 años) y el
 * historial completo viaja en los respaldos.
 *
 * Semántica del lector:
 *  - doc de franja: REEMPLAZO DE FRANJA (las entradas de esa franja pasan a
 *    ser exactamente las del doc; `[]` la vacía). Así un borrado del log se
 *    propaga.
 *  - doc base (legacy, monolítico): unión con «lo local gana»; nunca limpia.
 *  - `replaceSlot: false` (la caja, que es la autora): solo une, nunca quita
 *    entradas locales (una descarga vieja no borra lo recién escrito).
 *  - `trimToWindow` (solo el supervisor): descarta lo que quedó fuera de la
 *    ventana para que su copia no crezca sin fin.
 */

export const AUDIT_SYNC_BASE_KEY = 'abasto_audit_log_v1';
export const AUDIT_SYNC_TRACKING_KEY = 'pda_audit_sync_docs_v1';
export const AUDIT_SYNC_WINDOW_DAYS = 7;
export const AUDIT_SYNC_SLOT_HOURS = 2;
// Tope de seguridad de la ventana publicada (≈ 3.150 entradas/semana en la
// caja más activa medida); evita que un log anómalo dispare el volumen.
export const AUDIT_SYNC_MAX_ENTRIES = 10_000;
// Misma retención local que auditService (MAX_ENTRIES).
export const AUDIT_LOCAL_MAX_ENTRIES = 15_000;

const DAY_MS = 86_400_000;
const SLOT_RE = /^\d{4}-\d{2}-\d{2}T(0[02468]|1[02468]|2[02])$/;

export function isAuditSyncDocId(docId) {
    return docId === AUDIT_SYNC_BASE_KEY
        || (typeof docId === 'string' && docId.startsWith(`${AUDIT_SYNC_BASE_KEY}:`));
}

function entryTs(entry) {
    const ts = Number(entry?.ts);
    return Number.isFinite(ts) && ts > 0 ? ts : null;
}

/** Franja de un instante: `YYYY-MM-DDTHH` (UTC, HH par). */
export function getAuditSlotOfTs(ts) {
    if (!Number.isFinite(ts) || ts <= 0) return null;
    const iso = new Date(ts).toISOString();
    const rawHour = Number(iso.slice(11, 13));
    const hour = rawHour - (rawHour % AUDIT_SYNC_SLOT_HOURS);
    return `${iso.slice(0, 10)}T${String(hour).padStart(2, '0')}`;
}

export function getAuditSlotOf(entry) {
    return getAuditSlotOfTs(entryTs(entry));
}

/** Franja de un doc de la familia; null si es el base o no es válido. */
export function parseAuditSyncDocId(docId) {
    if (!isAuditSyncDocId(docId) || docId === AUDIT_SYNC_BASE_KEY) return null;
    const slot = docId.slice(AUDIT_SYNC_BASE_KEY.length + 1);
    return SLOT_RE.test(slot) ? slot : null;
}

export function auditDocIdForSlot(slot) {
    return `${AUDIT_SYNC_BASE_KEY}:${slot}`;
}

/** Primer instante (ms) incluido en la ventana: inicio del día UTC de hace N-1 días. */
export function getAuditWindowStart(now = Date.now(), windowDays = AUDIT_SYNC_WINDOW_DAYS) {
    const startOfToday = now - (now % DAY_MS);
    return startOfToday - (Math.max(1, windowDays) - 1) * DAY_MS;
}

/** ¿La franja (o el doc) sigue dentro de la ventana? */
export function isAuditSlotInWindow(slot, now = Date.now(), windowDays = AUDIT_SYNC_WINDOW_DAYS) {
    if (!SLOT_RE.test(slot || '')) return false;
    return Date.parse(`${slot}:00:00Z`) >= getAuditWindowStart(now, windowDays);
}

/**
 * Copia PUBLICADA del log: solo la ventana, en el orden local («más reciente
 * primero») y con el tope de seguridad.
 */
export function projectAuditSyncPayload(log, { now = Date.now(), windowDays = AUDIT_SYNC_WINDOW_DAYS } = {}) {
    if (!Array.isArray(log)) return log;
    const start = getAuditWindowStart(now, windowDays);
    const projected = [];
    for (const entry of log) {
        const ts = entryTs(entry);
        if (ts == null || ts < start) continue;
        projected.push(entry);
        if (projected.length >= AUDIT_SYNC_MAX_ENTRIES) break;
    }
    return projected;
}

function compareAscending(a, b) {
    const ta = entryTs(a) ?? 0;
    const tb = entryTs(b) ?? 0;
    if (ta !== tb) return ta - tb;
    const ia = String(a?.id ?? '');
    const ib = String(b?.id ?? '');
    return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/**
 * Parte la copia publicada en docs por franja (cada uno completo y en orden
 * canónico ascendente, para que el hash sea estable).
 */
export function buildAuditSyncPlan(log, options = {}) {
    const projected = projectAuditSyncPayload(Array.isArray(log) ? log : [], options);
    const bySlot = new Map();
    for (const entry of projected) {
        const slot = getAuditSlotOf(entry);
        if (!slot) continue;
        if (!bySlot.has(slot)) bySlot.set(slot, []);
        bySlot.get(slot).push(entry);
    }
    return [...bySlot.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([slot, records]) => ({
            docId: auditDocIdForSlot(slot),
            slot,
            records: [...records].sort(compareAscending),
        }));
}

function sortNewestFirst(entries) {
    return [...entries].sort((a, b) => compareAscending(b, a));
}

/**
 * Merge de un doc de la familia en el log local (orden «más reciente primero»).
 * Payload no-arreglo → devuelve el local tal cual.
 */
export function mergeAuditSyncDoc(localLog, docId, payload, {
    replaceSlot = true,
    trimToWindow = false,
    now = Date.now(),
    windowDays = AUDIT_SYNC_WINDOW_DAYS,
} = {}) {
    const local = Array.isArray(localLog) ? localLog : [];
    if (!Array.isArray(payload)) return local;

    let merged;
    const slot = parseAuditSyncDocId(docId);
    if (slot !== null && replaceSlot) {
        merged = [...local.filter((entry) => getAuditSlotOf(entry) !== slot), ...payload];
    } else if (slot !== null || docId === AUDIT_SYNC_BASE_KEY) {
        // Unión sin quitar nada: lo local gana en el legacy; en una franja (caja)
        // también gana lo local, que es la versión autora.
        const localIds = new Set(local.map((entry) => entry?.id));
        merged = [...local, ...payload.filter((entry) => !localIds.has(entry?.id))];
    } else {
        return local;
    }

    let result = sortNewestFirst(merged);
    if (trimToWindow) {
        const start = getAuditWindowStart(now, windowDays);
        result = result.filter((entry) => (entryTs(entry) ?? 0) >= start);
    }
    if (result.length > AUDIT_LOCAL_MAX_ENTRIES) result.length = AUDIT_LOCAL_MAX_ENTRIES;
    return result;
}
