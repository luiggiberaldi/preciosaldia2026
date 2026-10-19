export const SUPERVISOR_SYNC_SCHEMA_VERSION = 1;

export const SUPERVISOR_SYNC_STATES = Object.freeze({
    IDLE: 'idle',
    AUTHENTICATING: 'authenticating',
    PULLING: 'pulling',
    CONNECTED: 'connected',
    DEGRADED: 'degraded',
    ERROR: 'error',
    REVOKED: 'revoked',
});

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

export function buildSyncEnvelope(payload, updatedAt = new Date().toISOString()) {
    return {
        schemaVersion: SUPERVISOR_SYNC_SCHEMA_VERSION,
        payload,
        updatedAt,
    };
}

/**
 * Acepta el formato versionado nuevo y el formato legacy { payload } durante
 * la migración. Nunca inventa un payload si el documento está incompleto.
 */
export function readSyncEnvelope(data) {
    if (!isPlainObject(data) || !Object.prototype.hasOwnProperty.call(data, 'payload')) {
        return { valid: false, error: 'Envelope de sincronización inválido' };
    }

    const schemaVersion = data.schemaVersion ?? 1;
    if (schemaVersion !== SUPERVISOR_SYNC_SCHEMA_VERSION) {
        return { valid: false, error: `Versión de schema no soportada: ${schemaVersion}` };
    }

    const updatedAt = data.updatedAt || null;
    if (updatedAt && Number.isNaN(Date.parse(updatedAt))) {
        return { valid: false, error: 'updatedAt inválido' };
    }

    return {
        valid: true,
        error: null,
        payload: data.payload,
        schemaVersion,
        updatedAt,
    };
}

export function isNewerSyncDocument(incomingUpdatedAt, previousUpdatedAt) {
    if (!incomingUpdatedAt) return !previousUpdatedAt;
    if (!previousUpdatedAt) return true;
    return Date.parse(incomingUpdatedAt) > Date.parse(previousUpdatedAt);
}

export function getSyncMetadataKey(docId) {
    return `supervisor_sync_updated_at_${docId}`;
}

export function getSupervisorRecoveryIntervalMs() {
    // Realtime es la vía primaria. El pull solo es un salvavidas cuando el
    // canal está degradado, por eso no debe ejecutarse cada pocos segundos.
    return 5 * 60_000;
}

/**
 * Barrido de respaldo del monitor con Realtime "conectado" — el hueco
 * simétrico al del receptor de la caja: un canal que dice SUBSCRIBED pero no
 * entrega eventos (socket a medias, pestaña restringida, eventos perdidos
 * durante un corte) no puede dejar al Supervisor sin el eco de la caja hasta
 * recargar. El barrido usa el pull incremental (solo metadatos; el payload se
 * pide únicamente para documentos realmente nuevos), así que con el eco al día
 * la consulta queda vacía. Más frecuente que la recuperación degradada (5 min)
 * y distinto del barrido de publicación de la caja (30 s) para no confundir
 * contratos de timer.
 */
export const MONITOR_CONNECTED_SWEEP_INTERVAL_MS = 45_000;

/**
 * El barrido conectado solo corre con Realtime vivo y sin un pull ya en vuelo:
 * apilar consultas en una pestaña restringida no aporta nada (el pull
 * incremental ya se deduplica, pero el gate evita acumular trabajo muerto).
 */
export function shouldRunMonitorConnectedSweep({
    realtimeConnected,
    pullInFlight = false,
} = {}) {
    return Boolean(realtimeConnected) && !pullInFlight;
}

export function shouldRunSupervisorRecovery({
    realtimeConnected,
    recoveryInFlight = false,
    lastRecoveryAt = 0,
    now = Date.now(),
    intervalMs = getSupervisorRecoveryIntervalMs(),
} = {}) {
    if (realtimeConnected || recoveryInFlight) return false;
    if (!Number.isFinite(lastRecoveryAt) || lastRecoveryAt <= 0) return true;
    return now - lastRecoveryAt >= intervalMs;
}

export function getChangedSyncDocumentIds(metadata = [], getPreviousUpdatedAt = () => null) {
    return [...new Set((metadata || [])
        .filter((doc) => doc?.doc_id && isNewerSyncDocument(
            doc.updated_at,
            getPreviousUpdatedAt(doc.doc_id),
        ))
        .map((doc) => doc.doc_id))];
}

/**
 * Realtime entrega el registro VACÍO (y `payload.errors` con "Error 413: Payload
 * Too Large") cuando `sync_documents.data` supera `max_record_bytes` (~1 MB).
 * Con catálogos de miles de productos ese es el caso normal de
 * `bodega_products_v1`: el evento no trae cuerpo y NUNCA puede descartarse en
 * silencio — el caller debe responder con un pull de respaldo.
 */
export function isOversizeRealtimePayload(realtimePayload) {
    if (Array.isArray(realtimePayload?.errors) && realtimePayload.errors.length > 0) return true;
    const doc = realtimePayload?.new;
    return !doc || !doc.doc_id || !doc.data;
}

// ── Diagnóstico de sincronización (panel del supervisor) ─────────────────────
// Estado puro que describe la recepción de ecos: el último documento con su
// watermark y los eventos Realtime sin cuerpo (413) con los pulls de respaldo
// que los resolvieron. Sin React ni red: así se prueba sin montar el hook.

export function createSyncDiagnosticsState() {
    return {
        lastEcho: null,
        oversizeEvents: 0,
        oversizePulls: 0,
        lastOversizeAt: null,
        lastOversizePullAt: null,
    };
}

export function updateSyncDiagnostics(state, event) {
    const current = state || createSyncDiagnosticsState();
    switch (event?.type) {
        case 'echo':
            return {
                ...current,
                lastEcho: {
                    docId: event.docId ?? null,
                    updatedAt: event.updatedAt ?? null,
                    receivedAt: event.receivedAt ?? null,
                    source: event.source ?? 'realtime',
                    applied: Boolean(event.applied),
                    error: event.error ?? null,
                },
            };
        case 'oversize_event':
            return {
                ...current,
                oversizeEvents: current.oversizeEvents + 1,
                lastOversizeAt: event.at ?? null,
            };
        case 'oversize_pull':
            return {
                ...current,
                oversizePulls: current.oversizePulls + 1,
                lastOversizePullAt: event.at ?? null,
            };
        default:
            return current;
    }
}

/**
 * Cada ciclo de vida usa un topic único para que React StrictMode, un cambio
 * de dispositivo o una reconexión no intenten añadir callbacks a un canal ya
 * suscrito.
 */
export function buildSupervisorRealtimeChannelName(deviceId, lifecycleId = 0) {
    return `monitor:${String(deviceId)}:${String(lifecycleId)}`;
}

export async function withSyncRetry(task, {
    attempts = 3,
    baseDelayMs = 250,
    maxDelayMs = 2000,
    sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
} = {}) {
    let lastError = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
        try {
            return await task(attempt);
        } catch (error) {
            lastError = error;
            if (attempt === attempts - 1) break;
            const delay = Math.min(maxDelayMs, baseDelayMs * (2 ** attempt));
            await sleep(delay);
        }
    }

    throw lastError || new Error('La sincronización falló');
}

export default {
    SUPERVISOR_SYNC_SCHEMA_VERSION,
    SUPERVISOR_SYNC_STATES,
    buildSyncEnvelope,
    readSyncEnvelope,
    isNewerSyncDocument,
    getSyncMetadataKey,
    getSupervisorRecoveryIntervalMs,
    shouldRunSupervisorRecovery,
    MONITOR_CONNECTED_SWEEP_INTERVAL_MS,
    shouldRunMonitorConnectedSweep,
    getChangedSyncDocumentIds,
    buildSupervisorRealtimeChannelName,
    withSyncRetry,
};
