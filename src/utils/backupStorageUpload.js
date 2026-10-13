/**
 * backupStorageUpload.js — Sube un respaldo comprimido al endpoint de Storage
 * de Estación Maestra (/api/backup/storage/upload).
 *
 * Contrato (ver estacion-maestra/src/app/api/backup/storage/upload/route.ts):
 *   body: { deviceId, operationId (uuid), sha256 (hex 64), schemaVersion (int), dataBase64 }
 *   éxito: { ok: true, backupId, sha256, sizeBytes, ... }
 *
 * Reglas:
 *   - operationId se genera una vez por intento lógico y se reutiliza en reintentos,
 *     para que el servidor sea idempotente.
 *   - Solo se declara éxito con la respuesta ok:true del servidor.
 */
import { getEstacionApiUrl } from './backupRelay';

const UUID_V4_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Clave local donde el POS guarda su credencial por dispositivo (entregada al emparejar). */
export const DEVICE_CREDENTIAL_STORAGE_KEY = 'estacion_device_upload_credential';

/** Lee la credencial del dispositivo desde almacenamiento local. '' si no existe. */
export function readDeviceCredential() {
    try {
        return globalThis.localStorage?.getItem(DEVICE_CREDENTIAL_STORAGE_KEY) || '';
    } catch {
        return '';
    }
}

/** Guarda la credencial entregada por el admin (solo en este equipo). */
export function saveDeviceCredential(credential) {
    globalThis.localStorage?.setItem(DEVICE_CREDENTIAL_STORAGE_KEY, String(credential || ''));
}

/** Nuevo UUID para una operación de respaldo. */
export function newBackupOperationId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    // Fallback sin crypto.randomUUID (entornos antiguos).
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/** SHA-256 en hex de los bytes dados. */
export async function sha256Hex(bytes) {
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bytesToBase64(bytes) {
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
    }
    return btoa(binary);
}

/**
 * Sube bytes gzip de un respaldo.
 * @param {string} deviceId
 * @param {Uint8Array} gzipBytes  Bytes ya comprimidos (.json.gz)
 * @param {{ operationId?: string, schemaVersion?: number, credential?: string }} [opts]
 * @returns {Promise<{ok: boolean, operationId: string, backupId?: string, sha256?: string, error?: string}>}
 */
export async function uploadBackupToStorage(deviceId, gzipBytes, opts = {}) {
    const operationId = opts.operationId || newBackupOperationId();
    const base = getEstacionApiUrl();
    if (!base) return { ok: false, operationId, error: 'Estación no configurada' };
    if (!UUID_V4_LIKE.test(operationId)) return { ok: false, operationId, error: 'operationId inválido' };

    const credential = opts.credential ?? readDeviceCredential();
    if (!credential) return { ok: false, operationId, error: 'Dispositivo sin credencial de respaldo' };

    const sha256 = await sha256Hex(gzipBytes);
    try {
        const res = await fetch(`${base}/api/backup/storage/upload`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-device-credential': credential,
            },
            body: JSON.stringify({
                deviceId,
                operationId,
                sha256,
                schemaVersion: opts.schemaVersion ?? 2,
                dataBase64: bytesToBase64(gzipBytes),
            }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok || data?.ok !== true) {
            return { ok: false, operationId, error: data?.error || `HTTP ${res.status}` };
        }
        return { ok: true, operationId, backupId: data.backupId, sha256: data.sha256 };
    } catch (err) {
        return { ok: false, operationId, error: String(err?.message || err) };
    }
}
