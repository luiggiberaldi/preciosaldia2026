// ── Telemetría de la latencia del ACK en la caja ─────────────────────────────
// Por commandId se registran los hitos del flujo receptor de órdenes
// (processing_start → local_applied → ack_sent/ack_confirmed → publish_end) y se
// calculan las MISMAS magnitudes que tests/supervisorAckLatency.perf.test.jsx
// mide en local, para poder medirlas en producción:
//   - ackLatencyMs:     processing_start → ack_sent (la métrica principal:
//                       cuánto tarda la caja en confirmar la orden).
//   - ackConfirmMs:     processing_start → ack_confirmed (ACK aceptado por RPC).
//   - localDurableMs:   processing_start → local_applied (estado local durable).
//   - publishLatencyMs: processing_start → publish_end (publicación cloud).
//   - ackLeadMs:        ack_sent → publish_end. Con signo a propósito: positivo
//                       cuando el ACK precede a la publicación (lote), negativo
//                       cuando el ACK salió DESPUÉS de publicar (comandos de
//                       producto, que aún confirman tras publicar).
//
// Cada orden cerrada se registra con un log [AckLatency] (grep-able, familia del
// prefijo que imprime el test local) y en un buffer acotado persistido en
// `supervisor_ack_telemetry_v1` para consultar/exportar en producción.
//
// Todo es best-effort: la telemetría jamás interrumpe el procesamiento ni el
// ACK de una orden (nunca lanza).

import { storageService } from '../utils/storageService';

export const SUPERVISOR_ACK_TELEMETRY_KEY = 'supervisor_ack_telemetry_v1';
export const ACK_TELEMETRY_MAX_ENTRIES = 200;
// Un span sin cerrar (proceso caído a mitad de una orden) se descarta tras esto.
const STALE_SPAN_TTL_MS = 10 * 60 * 1000;

// Spans abiertos por commandId + historial de entradas cerradas (en memoria).
const openSpans = new Map();
let finishedEntries = [];
let pendingWrite = Promise.resolve();

const nowMs = () => Date.now();

/**
 * Cálculo puro de las métricas a partir de los hitos (epoch ms). Es la misma
 * definición que el test de rendimiento usa en local; un hito ausente produce
 * `null` (nunca un número inventado) y los deltas se recortan a 0 salvo
 * `ackLeadMs`, que conserva el signo a propósito: negativo significa que el ACK
 * salió después de publicar (la publicación se comió parte de su presupuesto).
 */
export function computeAckMetrics(marks = {}) {
    const at = (name) => (Number.isFinite(Number(marks[name])) ? Number(marks[name]) : null);
    const start = at('processing_start');
    const delta = (from, to) => (from != null && to != null ? Math.max(0, to - from) : null);
    const signedDelta = (from, to) => (from != null && to != null ? to - from : null);
    return {
        ackLatencyMs: delta(start, at('ack_sent')),
        ackConfirmMs: delta(start, at('ack_confirmed')),
        localDurableMs: delta(start, at('local_applied')),
        publishLatencyMs: delta(start, at('publish_end')),
        ackLeadMs: signedDelta(at('ack_sent'), at('publish_end')),
    };
}

function sweepStaleSpans(now) {
    for (const [commandId, span] of [...openSpans.entries()]) {
        const started = span.marks.processing_start;
        if (!Number.isFinite(started) || now - started > STALE_SPAN_TTL_MS) {
            openSpans.delete(commandId);
        }
    }
}

/**
 * Registra un hito del flujo receptor para un commandId.
 *  - 'processing_start' abre el span (si ya existe, conserva el primer inicio:
 *    la latencia que importa es hasta que el ACK sale, aunque haya reintentos).
 *  - El resto de hitos solo se anotan si hay un span abierto; `meta` agrega
 *    contexto ({ type, deviceId } en el inicio; { status } en los ACK).
 */
export function markAckTelemetry(commandId, mark, meta = {}) {
    try {
        const id = String(commandId || '');
        if (!id || typeof mark !== 'string') return;
        const now = nowMs();
        let span = openSpans.get(id);
        if (mark === 'processing_start') {
            if (!span) {
                sweepStaleSpans(now);
                span = { commandId: id, marks: {}, meta: {} };
                openSpans.set(id, span);
            }
            if (span.marks.processing_start == null) span.marks.processing_start = now;
        } else {
            if (!span) return;
            if (span.marks[mark] == null) span.marks[mark] = now;
        }
        Object.entries(meta || {}).forEach(([key, value]) => {
            if (value !== undefined && span.meta[key] == null) span.meta[key] = value;
        });
    } catch {
        // La telemetría jamás interrumpe el flujo del receptor.
    }
}

function logAckTelemetry(entry) {
    const { metrics } = entry;
    const ackPart = metrics.ackLatencyMs == null
        ? 'sin marca de envío del ACK'
        : `ACK tras ${metrics.ackLatencyMs} ms del inicio del procesamiento`;
    const publishPart = metrics.publishLatencyMs == null
        ? 'sin publicación cloud registrada'
        : `la publicación cloud terminó en ${metrics.publishLatencyMs} ms`
            + (metrics.ackLeadMs == null
                ? ''
                : (metrics.ackLeadMs >= 0
                    ? ` (el ACK la precedió en ${metrics.ackLeadMs} ms)`
                    : ` (el ACK salió ${Math.abs(metrics.ackLeadMs)} ms después de publicar)`));
    console.info(`[AckLatency] ${entry.commandId} · ${ackPart}; ${publishPart}`, {
        commandId: entry.commandId,
        type: entry.type,
        status: entry.status,
        acknowledgedEarly: entry.acknowledgedEarly,
        ...metrics,
    });
}

function persistAckTelemetry() {
    pendingWrite = pendingWrite
        .then(() => storageService.setItem(
            SUPERVISOR_ACK_TELEMETRY_KEY,
            finishedEntries.slice(-ACK_TELEMETRY_MAX_ENTRIES),
        ))
        .catch(() => {
            // Sin almacenamiento disponible la telemetría sigue viva en memoria.
        });
    return pendingWrite;
}

/** Espera a que las escrituras pendientes del buffer terminen (para tests). */
export function flushAckTelemetry() {
    return pendingWrite;
}

/**
 * Cierra el span del commandId y registra la entrada (log + buffer acotado).
 * Devuelve la entrada o `null` si no hay nada que medir (orden saltada, sin
 * ningún ACK, o sin span abierto). `extra` admite { status, acknowledgedEarly,
 * error } del flujo llamador.
 */
export function finishAckTelemetry(commandId, extra = {}) {
    try {
        const id = String(commandId || '');
        const span = openSpans.get(id);
        if (!span) return null;
        openSpans.delete(id);
        const { marks, meta } = span;
        const hasAck = marks.ack_sent != null || marks.ack_confirmed != null || marks.ack_failed != null;
        if (!hasAck) return null;
        const entry = {
            commandId: id,
            type: meta.type || null,
            deviceId: meta.deviceId || null,
            status: extra.status || meta.status || (marks.ack_failed != null ? 'ack_failed' : null),
            acknowledgedEarly: Boolean(extra.acknowledgedEarly || meta.acknowledgedEarly),
            error: extra.error || meta.error || null,
            startedAt: new Date(marks.processing_start ?? nowMs()).toISOString(),
            finishedAt: new Date(nowMs()).toISOString(),
            marks: { ...marks },
            metrics: computeAckMetrics(marks),
        };
        finishedEntries.push(entry);
        if (finishedEntries.length > ACK_TELEMETRY_MAX_ENTRIES) {
            finishedEntries = finishedEntries.slice(-ACK_TELEMETRY_MAX_ENTRIES);
        }
        logAckTelemetry(entry);
        persistAckTelemetry();
        return entry;
    } catch {
        return null;
    }
}

/** Instantánea en memoria de las entradas cerradas (más recientes al final). */
export function getAckTelemetryEntries() {
    return finishedEntries.map(entry => ({ ...entry, metrics: { ...entry.metrics }, marks: { ...entry.marks } }));
}

/**
 * Entradas persistidas en producción (para exportar/consultar). Usa el storage
 * inyectado o el de la app; si no hay nada persistido, cae a la memoria.
 */
export async function readAckTelemetry({ storage = storageService } = {}) {
    try {
        await flushAckTelemetry();
        const stored = await storage.getItem(SUPERVISOR_ACK_TELEMETRY_KEY, []);
        if (Array.isArray(stored) && stored.length > 0) return stored;
    } catch {
        // Sin almacenamiento se devuelve lo que hay en memoria.
    }
    return getAckTelemetryEntries();
}

/** Limpia el buffer (memoria y persistencia). */
export async function clearAckTelemetry({ storage = storageService } = {}) {
    finishedEntries = [];
    try {
        await storage.setItem(SUPERVISOR_ACK_TELEMETRY_KEY, []);
    } catch {
        // Best-effort: la memoria ya quedó limpia.
    }
}

export default {
    SUPERVISOR_ACK_TELEMETRY_KEY,
    ACK_TELEMETRY_MAX_ENTRIES,
    computeAckMetrics,
    markAckTelemetry,
    finishAckTelemetry,
    flushAckTelemetry,
    getAckTelemetryEntries,
    readAckTelemetry,
    clearAckTelemetry,
};
