/**
 * estacionCredential.js — Llave propia de ESTE equipo para los respaldos vía
 * Estación Maestra (relay y Storage).
 *
 * Antes la caja usaba un secreto común a todas (VITE_ESTACION_BACKUP_SECRET),
 * incluido en el JS público: cualquiera podía leer o pisar respaldos ajenos.
 * Ahora cada caja canjea un código de vinculación (lo genera el admin en la
 * Estación → Dispositivos → «Vincular respaldo») por su propia credencial, que
 * se guarda solo en este equipo.
 *
 * Si se borran los datos del navegador, la credencial se pierde con ellos y hay
 * que vincular de nuevo con un código nuevo. El respaldo local no se ve afectado.
 */

/** Clave local donde la caja guarda su credencial. */
export const DEVICE_CREDENTIAL_STORAGE_KEY = 'estacion_device_upload_credential';

/** Lee la credencial del equipo. '' si no existe. */
export function readDeviceCredential() {
    try {
        return globalThis.localStorage?.getItem(DEVICE_CREDENTIAL_STORAGE_KEY) || '';
    } catch {
        return '';
    }
}

/** Guarda la credencial entregada por la Estación (solo en este equipo). */
export function saveDeviceCredential(credential) {
    globalThis.localStorage?.setItem(DEVICE_CREDENTIAL_STORAGE_KEY, String(credential || ''));
}

/** Borra la credencial (p. ej. al desvincular o si la Estación la rechaza). */
export function clearDeviceCredential() {
    try {
        globalThis.localStorage?.removeItem(DEVICE_CREDENTIAL_STORAGE_KEY);
    } catch {
        /* sin almacenamiento: nada que borrar */
    }
}

/** ¿Este equipo ya está vinculado? */
export function hasDeviceCredential() {
    return readDeviceCredential().length >= 20;
}
