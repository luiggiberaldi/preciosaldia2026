// cloudPublishQueue.js — Publicación cloud single-flight por clave, con
// RELECTURA del valor fresco al publicar.
//
// Fase 1 del plan docs/plans/2026-10-21-plan-fix-cuelgue-caja-comandos-supervisor.md.
//
// Por qué re-leer el valor al publicar (y no empujar el snapshot del comando):
// el snapshot que el comando calculó bajo `pos_write_lock` queda obsoleto en
// cuanto el cajero escribe (una venta descuenta stock del mismo catálogo).
// `sync_documents` es last-write-wins: publicar el snapshot viejo borraría la
// venta concurrente del cajero desde la nube. Publicar SIEMPRE el valor fresco
// del storage es seguro porque es monótono: el estado más nuevo nunca pierde.
//
// Por qué single-flight: dos publicaciones de la misma clave nunca deben
// pisarse con dos subidas paralelas de ~1.3 MB. La segunda llamada durante un
// vuelo se "cuelga" del mismo resultado y solo dispara una pasada final si el
// valor cambió respecto de lo último publicado.

import { storageService } from '../utils/storageService';
import { pushCloudSync } from '../hooks/useCloudSync';

const inFlight = new Map();    // key → Promise del vuelo actual
const wantsRepublish = new Set(); // keys con cambios llegados durante el vuelo
const lastPushedJson = new Map(); // key → JSON del último valor publicado con éxito

/**
 * Publica el estado ACTUAL de `key` en la nube. No recibe el valor a propósito:
 * lo lee del storage en el momento de publicar.
 *
 * Devuelve el resultado de `pushCloudSync` (o `{ ok: true, skipped: false,
 * reason: 'sin cambios: ya publicado' }` cuando el valor idéntico ya fue
 * publicado por este vuelo: la nube ya tiene ese estado, no es un pendiente).
 */
export async function publishKeyNow(key) {
    if (inFlight.has(key)) {
        wantsRepublish.add(key);
        return inFlight.get(key);
    }

    const run = (async () => {
        let result = { ok: false, skipped: true, error: 'sin publicación' };
        try {
            for (;;) {
                wantsRepublish.delete(key);
                const fresh = await storageService.getItem(key, null);
                if (fresh == null) return result;

                const serialized = JSON.stringify(fresh);
                if (serialized === lastPushedJson.get(key)) {
                    // Este mismo valor ya quedó publicado y confirmado en este
                    // ciclo de vida: la nube ya lo tiene.
                    result = { ok: true, skipped: false, reason: 'sin cambios: ya publicado' };
                } else {
                    result = await pushCloudSync(key, fresh, true);
                    if (result?.ok) lastPushedJson.set(key, serialized);
                }

                if (!wantsRepublish.has(key)) return result;
                // Llegó otro cambio durante el vuelo: una pasada más con el
                // estado más reciente (el bucle corta si no cambió nada).
            }
        } finally {
            inFlight.delete(key);
        }
    })();

    inFlight.set(key, run);
    return run;
}

/** ¿Hay un vuelo de publicación en curso para la clave? (para tests/diagnóstico). */
export function isPublishInFlight(key) {
    return inFlight.has(key);
}

/** Limpia el estado interno (solo tests: el estado es por pestaña/ciclo de vida). */
export function resetCloudPublishQueue() {
    inFlight.clear();
    wantsRepublish.clear();
    lastPushedJson.clear();
}

export default { publishKeyNow, isPublishInFlight, resetCloudPublishQueue };
