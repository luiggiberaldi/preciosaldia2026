// ── Salud del sistema (Fase 3, plan 2026-10-20) ─────────────────────────────
// Desfase de reloj local vs servidor, visible en Ajustes sin abrir consola.
//
// Fuentes:
//   1. Reloj del servidor: el `iat` (issued at, epoch s, sellado por el SERVIDOR)
//      del access_token que devuelve el refresh de la sesión existente
//      (POST /auth/v1/token — una petición HTTP que el SDK de Auth ya hace).
//      NOTA de implementación (decisión del dueño, 2026-10-20): el plan
//      original proponía leer el header `Date` de una petición REST; verificado
//      con evidencia en la WebView (Chromium/Capacitor) que `Date` NO es legible
//      desde fetch (no está en la safelist de CORS y el gateway no lo expone).
//      El `iat` del JWT vive en el body, que siempre es legible: cubre PWA,
//      Android y desarrollo sin RPC nueva ni migración (gate de la fase).
//   2. Última sincronización: `cloud_sync_ts` (localStorage) + evidencia de
//      pushes confirmados (`bodega_last_periodic_push_hash_*`).
//
// Todo es best-effort y jamás lanza: la pantalla degrada a "Sin datos".

import { supabaseCloud } from '../config/supabaseCloud';

export const CLOCK_SKEW_GREEN_MS = 30_000;
export const CLOCK_SKEW_YELLOW_MS = 120_000;
export const CLOCK_SKEW_SAMPLES = 3;

const LAST_PUSH_HASH_PREFIX = 'bodega_last_periodic_push_hash_';

/** Semáforo del desfase (el signo da igual: manda el valor absoluto). */
export function classifyClockSkew(skewMs) {
    const abs = Math.abs(Number(skewMs));
    if (!Number.isFinite(abs)) return 'unknown';
    if (abs < CLOCK_SKEW_GREEN_MS) return 'green';
    if (abs < CLOCK_SKEW_YELLOW_MS) return 'yellow';
    return 'red';
}

export function formatSkewMagnitude(skewMs) {
    const abs = Math.abs(Number(skewMs)) || 0;
    if (abs < 1_000) return `${Math.round(abs)} ms`;
    if (abs < 60_000) return `${Math.round(abs / 1_000)} s`;
    return `${(abs / 60_000).toFixed(1)} min`;
}

/**
 * Texto del estado para la UI. El estado rojo lleva el texto de acción que
 * pide el plan: "sincroniza la hora de este equipo".
 */
export function describeClockSkew(skewMs) {
    const level = classifyClockSkew(skewMs);
    const magnitude = formatSkewMagnitude(skewMs);
    switch (level) {
        case 'green':
            return { level, text: `En sincronía con el servidor (desfase de ${magnitude})` };
        case 'yellow':
            return { level, text: `Desfase leve de ${magnitude} — vigila la hora de este equipo` };
        case 'red':
            return { level, text: `Desfase de ${magnitude} — sincroniza la hora de este equipo` };
        default:
            return { level: 'unknown', text: 'Sin datos' };
    }
}

/** `iat` del JWT (epoch s, sellado por el servidor) en ms, o null si no se puede leer. */
export function decodeJwtIatMs(token) {
    try {
        const payload = String(token || '').split('.')[1] || '';
        const json = atob(payload.replace(/-/g, '+').replace(/_/g, '/'));
        const iat = Number(JSON.parse(json)?.iat);
        return Number.isFinite(iat) ? iat * 1000 : null;
    } catch {
        return null;
    }
}

/** Hora del servidor (ms) derivada del refresh de la sesión existente. */
async function readServerNowFromAuth() {
    const { data, error } = await supabaseCloud.auth.refreshSession();
    const serverMs = decodeJwtIatMs(data?.session?.access_token);
    if (!Number.isFinite(serverMs)) {
        throw new Error(error?.message || 'sin datos del servidor');
    }
    return serverMs;
}

function median(values) {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
}

/**
 * Desfase (ms) = hora del servidor − reloj local, comparado en UTC contra la
 * mitad del viaje de red; la mediana de varias lecturas tolera la latencia
 * (prueba (c)). Nunca lanza: devuelve `{ ok: false, error }`.
 */
export async function measureClockSkew({
    readServerNow = readServerNowFromAuth,
    samples = CLOCK_SKEW_SAMPLES,
    now = () => Date.now(),
} = {}) {
    const skews = [];
    let lastError = null;
    const count = Math.max(1, Number(samples) || 1);
    for (let i = 0; i < count; i += 1) {
        try {
            const started = now();
            const serverMs = await readServerNow();
            const received = now();
            if (Number.isFinite(Number(serverMs))) {
                skews.push(Number(serverMs) - (started + received) / 2);
            } else {
                lastError = 'sin datos';
            }
        } catch (error) {
            lastError = error?.message || 'sin conexión';
        }
    }
    if (!skews.length) return { ok: false, error: lastError || 'sin datos' };
    return {
        ok: true,
        skewMs: median(skews),
        sampleCount: skews.length,
        measuredAt: new Date(now()).toISOString(),
    };
}

/**
 * Última sincronización registrada (`cloud_sync_ts`) + evidencia de pushes
 * confirmados (hashes de `pushCloudSync`, que no llevan fecha propia).
 */
export function readLastSyncInfo() {
    let lastSyncAt = null;
    let confirmedPushKeys = 0;
    try {
        const raw = localStorage.getItem('cloud_sync_ts');
        const parsed = Date.parse(raw || '');
        lastSyncAt = Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
        for (let i = 0; i < localStorage.length; i += 1) {
            if (String(localStorage.key(i) || '').startsWith(LAST_PUSH_HASH_PREFIX)) confirmedPushKeys += 1;
        }
    } catch {
        // Sin almacenamiento no hay nada que mostrar.
    }
    return { lastSyncAt, confirmedPushKeys };
}

export default {
    CLOCK_SKEW_GREEN_MS,
    CLOCK_SKEW_YELLOW_MS,
    CLOCK_SKEW_SAMPLES,
    classifyClockSkew,
    formatSkewMagnitude,
    describeClockSkew,
    decodeJwtIatMs,
    measureClockSkew,
    readLastSyncInfo,
};
