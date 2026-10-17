/**
 * installIdentity.js — Identidad única por instalación.
 *
 * Problema (SEC-008 / plan 2026-10-16): `deviceFingerprint.js` derivaba el
 * `pda_device_id` de las características del navegador + sal del build. Dos
 * equipos con el mismo navegador, idioma, zona horaria y hardware producían el
 * MISMO `PDA-V2-…`, compartiendo dueño, licencia y datos en la nube.
 *
 * Solución: el ID ya no se deriva del navegador. Cada instalación genera un ID
 * aleatorio (128 bits) la primera vez y lo conserva en `localStorage`. Junto al
 * ID se guarda un SECRETO de instalación (solo se persiste en el equipo) que
 * permite distinguir dos instalaciones que llegaron a compartir el mismo ID.
 *
 * Compatibilidad:
 *   - Instalaciones existentes conservan su `pda_device_id` actual. La licencia
 *     y los datos siguen ligados al mismo ID: nada se pierde.
 *   - Solo se generan IDs nuevos cuando la instalación no tiene ninguno
 *     (instalación nueva, datos borrados o ventana privada).
 *   - `verifyStoredFingerprint` sigue funcionando para IDs heredados.
 *
 * @module security/installIdentity
 */

import { verifyStoredFingerprint, getFingerprintAnchor } from './deviceFingerprint';

const DEVICE_ID_KEY = 'pda_device_id';
const INSTALL_SECRET_KEY = 'pda_install_secret_v1';
const PREVIOUS_DEVICE_ID_KEY = 'pda_previous_device_id_v1';
const LICENSE_CACHE_KEY = 'pda_license_cache';
const FP_ANCHOR_KEY = 'pda_fp_anchor_v1';

const FP_PREFIX_V2 = 'PDA-V2-';
const FP_HASH_LENGTH = 32; // 32 hex chars = 128 bits de entropía aleatoria.
// IDs válidos: legacy `PDA-<8..64 hex>` y actual `PDA-V2-<8..64 hex>`.
const FP_VALID_ID_RE = /^PDA(?:-V2)?-[0-9A-F]{8,64}$/;

/** Genera `bytes` bytes aleatorios en hex mayúsculas. */
function _randomHex(bytes) {
    const buf = new Uint8Array(bytes);
    if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(buf);
    } else {
        // Fallback no criptográfico (solo entornos sin WebCrypto).
        for (let i = 0; i < buf.length; i++) {
            buf[i] = Math.floor(Math.random() * 256);
        }
    }
    return Array.from(buf)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
}

/** Genera un ID de dispositivo aleatorio, único por instalación. */
export function generateRandomDeviceId() {
    return `${FP_PREFIX_V2}${_randomHex(FP_HASH_LENGTH / 2)}`;
}

/**
 * Lee el secreto de instalación, generándolo si no existe.
 * Nunca sale del equipo: solo se guarda su hash en el servidor (fase C).
 * @returns {string} Secreto de instalación (>= 32 hex chars).
 */
export function getInstallSecret() {
    try {
        const existing = localStorage.getItem(INSTALL_SECRET_KEY);
        if (existing && existing.length >= 32) return existing;
    } catch { /* storage bloqueado */ }

    const secret = _randomHex(32);
    try {
        localStorage.setItem(INSTALL_SECRET_KEY, secret);
    } catch { /* storage lleno/bloqueado */ }
    return secret;
}

/**
 * Verifica que el ID almacenado pertenece a ESTA instalación.
 *
 * Política:
 *   1. Formato inválido → `false`.
 *   2. Coincide con la ancla de identidad acuñada al generar el ID → `true`.
 *   3. Sin ancla propia → se delega en `verifyStoredFingerprint` (compatibilidad
 *      con instalaciones heredadas cuyo ID se derivaba del navegador).
 *
 * @param {string} storedId - ID almacenado en localStorage.
 * @returns {Promise<boolean>} `true` si el ID pertenece a esta instalación.
 */
export async function verifyInstallOwnership(storedId) {
    if (typeof storedId !== 'string' || !FP_VALID_ID_RE.test(storedId)) {
        return false;
    }

    // Identidad nueva (ID aleatorio propio): la ancla acuñada al generar el ID
    // prueba procedencia sin depender de las características del navegador.
    const anchor = getFingerprintAnchor();
    if (anchor && anchor.anchor === storedId) {
        return true;
    }

    // Instalación heredada (ID derivado del navegador): política SEC-008-r2.
    return verifyStoredFingerprint(storedId);
}

/**
 * Registra una sesión de identidad falsa no aplica; helper interno para no
 * acuñar anclas de identidad sobre IDs heredados sin verificar primero.
 * (La ancla solo se acuña tras `ensureInstallIdentity` con ID nuevo, o tras un
 * match verificado dentro de `verifyStoredFingerprint`.)
 */

/**
 * Devuelve la identidad de la instalación, creándola si no existe.
 *
 * Regla de oro: si ya hay un `pda_device_id` guardado, se conserva tal cual.
 * Eso garantiza que licencias y datos existentes sigan ligados al mismo ID.
 *
 * Nota: solo se acuña ancla de identidad cuando el ID es nuevo. Los IDs
 * heredados pasan por `verifyStoredFingerprint` antes de acuñar nada.
 *
 * @returns {{deviceId: string, isNew: boolean}}
 */
export function ensureInstallIdentity() {
    let storedId = null;
    try {
        storedId = localStorage.getItem(DEVICE_ID_KEY);
    } catch { /* storage bloqueado */ }

    if (storedId && FP_VALID_ID_RE.test(storedId)) {
        // Instalación existente: preservar ID. Solo crear el secreto si falta,
        // para poder distinguirla de otra instalación que comparta el mismo ID.
        getInstallSecret();
        return { deviceId: storedId, isNew: false };
    }

    const deviceId = generateRandomDeviceId();
    try {
        localStorage.setItem(DEVICE_ID_KEY, deviceId);
    } catch { /* storage lleno/bloqueado */ }
    getInstallSecret();

    // Ancla propia: prueba de que este ID se acuñó en esta instalación.
    try {
        localStorage.setItem(FP_ANCHOR_KEY, JSON.stringify({
            anchor: deviceId,
            lastSeen: deviceId,
            updatedAt: Date.now(),
        }));
    } catch { /* ignorado */ }

    return { deviceId, isNew: true };
}

export const DEVICE_ID_MIGRATED_EVENT = 'pda_device_id_migrated';

/**
 * Cambia el ID de esta estación por uno nuevo y único, conservando todos los
 * datos locales. Sirve para separar dos equipos que llegaron a compartir el
 * mismo ID (por ejemplo `PDA-V2-…` repetido en dos estaciones).
 *
 * NO toca la licencia ni los datos del servidor: el ID anterior queda registrado
 * como `pda_previous_device_id_v1` para poder re-registrar la licencia desde el
 * ID nuevo (ver `claim_license_to_device_id` en supabase/production-drafts/).
 *
 * Tras el cambio se emite `DEVICE_ID_MIGRATED_EVENT` para que la app renueve su
 * estado (deviceId, licencia) sin reiniciar.
 *
 * @returns {{deviceId: string, previousDeviceId: string|null}}
 */
export function migrateDeviceIdentity() {
    const previousDeviceId = (() => {
        try {
            return localStorage.getItem(DEVICE_ID_KEY);
        } catch {
            return null;
        }
    })();

    const deviceId = generateRandomDeviceId();
    try {
        if (previousDeviceId) {
            localStorage.setItem(PREVIOUS_DEVICE_ID_KEY, previousDeviceId);
        }
        localStorage.setItem(DEVICE_ID_KEY, deviceId);
        // Ancla y secreto nuevos: esta identidad es exclusiva de esta instalación.
        localStorage.setItem(FP_ANCHOR_KEY, JSON.stringify({
            anchor: deviceId,
            lastSeen: deviceId,
            updatedAt: Date.now(),
        }));
        localStorage.removeItem(INSTALL_SECRET_KEY);
        getInstallSecret();
        // La caché de licencia queda inservible: está atada al ID anterior.
        localStorage.removeItem(LICENSE_CACHE_KEY);
    } catch { /* storage lleno/bloqueado */ }

    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
        try {
            window.dispatchEvent(new CustomEvent(DEVICE_ID_MIGRATED_EVENT, {
                detail: { deviceId, previousDeviceId },
            }));
        } catch { /* entorno sin CustomEvent */ }
    }

    return { deviceId, previousDeviceId };
}

export default {
    generateRandomDeviceId,
    getInstallSecret,
    verifyInstallOwnership,
    ensureInstallIdentity,
    migrateDeviceIdentity,
    DEVICE_ID_MIGRATED_EVENT,
};
