/**
 * backupRelay.js — Cliente del relay de respaldos vía Estación Maestra.
 *
 * Qué es: una vía de emergencia. Si la caja no puede escribir/leer su respaldo
 * directo en la nube (p. ej. perdió su sesión y RLS la frena), le pide a la
 * Estación que lo haga por ella.
 *
 * Autorización (desde 2026-11-16, plan de fixeo F3):
 *   - La caja se identifica con SU credencial (`x-device-credential`), que
 *     obtiene canjeando un código de vinculación generado en la Estación.
 *   - El secreto común VITE_ESTACION_BACKUP_SECRET ya NO se usa ni se envía:
 *     iba en el JS público y la Estación ya no lo acepta.
 *   - Sin credencial, el relay se salta sin llamar a la red (needsLink: true).
 *
 * @module utils/backupRelay
 */

import { clearDeviceCredential, readDeviceCredential, saveDeviceCredential } from './estacionCredential';

/** Estación de producción (proyecto estacion-2026 en Vercel). */
export const ESTACION_PROD_URL = 'https://estacion-2026-eta.vercel.app';

/**
 * true cuando el bundle corre en un build de producción (vite define PROD).
 * En dev y en pruebas el valor de import.meta.env.PROD es false.
 */
function isProdBuild() {
    return import.meta.env?.PROD === true;
}

/**
 * URL base de la API de Estación Maestra.
 *
 * - Solo se acepta un valor configurado que sea una URL http(s). Un valor con
 *   otra forma (en 2026-11 Vercel tenía cargado el secreto en esta variable y
 *   el relay daba 404 en silencio) se ignora.
 * - Guardarraíl de entorno: el default a producción SOLO aplica en builds de
 *   producción. En desarrollo/pruebas sin URL válida se devuelve "" para que
 *   ningún entorno de prueba toque el backend real.
 * Lectura por llamada para testabilidad.
 */
export function getEstacionApiUrl() {
    const configured = String(import.meta.env?.VITE_ESTACION_API_URL || '').trim().replace(/\/+$/, '');
    if (/^https?:\/\/[^\s/]+$/i.test(configured)) return configured;
    return isProdBuild() ? ESTACION_PROD_URL : '';
}

function credentialHeaders() {
    return { 'x-device-credential': readDeviceCredential() };
}

/** Respuesta 401 de la Estación con credencial: el vínculo ya no vale (revocado o rotado). */
function handleUnauthorized(status) {
    if (status === 401) clearDeviceCredential();
}

/**
 * Sube el backup de un dispositivo vía relay.
 * @param {string} deviceId
 * @param {Object} backupData  Payload completo (el mismo JSON que iría en la fila).
 * @returns {Promise<{ok: boolean, relayed: boolean, skipped?: boolean, needsLink?: boolean, error?: any}>}
 */
export async function relayUploadBackup(deviceId, backupData) {
    const base = getEstacionApiUrl();
    if (!base) return { ok: false, relayed: false, skipped: true, error: 'relay no configurado' };
    if (!readDeviceCredential()) {
        return { ok: false, relayed: false, skipped: true, needsLink: true, error: 'equipo sin vincular a la Estación' };
    }

    try {
        const res = await fetch(`${base}/api/backup/relay`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...credentialHeaders() },
            body: JSON.stringify({ deviceId, backup_data: backupData }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            handleUnauthorized(res.status);
            return { ok: false, relayed: false, needsLink: res.status === 401, error: data?.error || `HTTP ${res.status}` };
        }
        return { ok: true, relayed: true, error: null };
    } catch (err) {
        return { ok: false, relayed: false, error: err };
    }
}

/**
 * Lee el backup de un dispositivo vía relay.
 * @param {string} deviceId
 * @returns {Promise<{ok: boolean, backupData: Object|null, updatedAt: string|null, needsLink?: boolean, error?: any}>}
 */
export async function relayFetchBackup(deviceId) {
    const base = getEstacionApiUrl();
    if (!base) return { ok: false, backupData: null, updatedAt: null, error: 'relay no configurado' };
    if (!readDeviceCredential()) {
        return { ok: false, backupData: null, updatedAt: null, needsLink: true, error: 'equipo sin vincular a la Estación' };
    }

    try {
        const res = await fetch(`${base}/api/backup/relay?deviceId=${encodeURIComponent(deviceId)}`, {
            headers: credentialHeaders(),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            handleUnauthorized(res.status);
            return { ok: false, backupData: null, updatedAt: null, needsLink: res.status === 401, error: data?.error || `HTTP ${res.status}` };
        }
        return {
            ok: true,
            backupData: data.backup_data ?? null,
            updatedAt: data.updated_at ?? null,
            error: null,
        };
    } catch (err) {
        return { ok: false, backupData: null, updatedAt: null, error: err };
    }
}

/**
 * Canjea un código de vinculación (generado en la Estación) por la credencial
 * de este equipo y la guarda localmente.
 * @param {string} deviceId
 * @param {string} code  Ej. "ABCD-EFGH" (se aceptan minúsculas y espacios).
 * @returns {Promise<{ok: boolean, error?: string}>}
 */
export async function claimDeviceCredential(deviceId, code) {
    const base = getEstacionApiUrl();
    if (!base) return { ok: false, error: 'La Estación no está configurada en este equipo.' };
    const clean = String(code || '').replace(/[\s-]+/g, '').toUpperCase();
    if (clean.length !== 8) return { ok: false, error: 'El código tiene 8 caracteres (ej. ABCD-EFGH).' };

    try {
        const res = await fetch(`${base}/api/backup/device-credential/claim`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ deviceId, code: clean }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || !data?.ok || typeof data.credential !== 'string') {
            return { ok: false, error: data?.error || `No se pudo vincular (HTTP ${res.status}).` };
        }
        saveDeviceCredential(data.credential);
        return { ok: true };
    } catch {
        return { ok: false, error: 'Sin conexión con la Estación. Revisa internet e inténtalo de nuevo.' };
    }
}

export default { relayUploadBackup, relayFetchBackup, claimDeviceCredential, getEstacionApiUrl };
