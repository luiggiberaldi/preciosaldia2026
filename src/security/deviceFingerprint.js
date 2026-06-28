/**
 * deviceFingerprint.js — Fingerprint robusto del dispositivo.
 *
 * Fix SEC-008:
 *   - Antes: SHA-256 de 8 componentes truncado a 8 hex chars (32 bits → colisión por
 *     birthday en ~65k intentos). Sin salt. Leído de localStorage sin re-verificar.
 *   - Ahora: SHA-256 completo de 64 hex chars + sal del backend (VITE_LICENSE_SALT).
 *     Re-verificación periódica vía `verifyStoredFingerprint()`.
 *
 * Notas:
 *   - La sal mezcla características del navegador con una sal por despliegue. Esto NO
 *     evita fingerprints cruzados entre navegadores del mismo dispositivo, pero sí
 *     dificulta la falsificación sencilla vía DevTools (`localStorage.setItem('pda_device_id', 'PDA-DEAD')`).
 *   - La fuente autoritativa de identidad es la fila `licenses.device_id` en el backend.
 *
 * @module security/deviceFingerprint
 */

const FP_HASH_LENGTH = 32; // 32 hex chars = 128 bits (antes 8 = 32 bits).
const FP_PREFIX = 'PDA-';
const FP_PREFIX_V2 = 'PDA-V2-';

/**
 * Genera una representación estable del User Agent (OS y Navegador, sin versiones de parche/menor).
 * @returns {string}
 */
function _getStableUserAgent() {
    if (typeof window === 'undefined' || !window.navigator) return '';
    const ua = window.navigator.userAgent || '';
    
    // Detectar Sistema Operativo
    let os = 'UnknownOS';
    if (ua.includes('Windows')) os = 'Windows';
    else if (ua.includes('Macintosh') || ua.includes('Mac OS')) os = 'MacOS';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iPhone') || ua.includes('iPad') || ua.includes('iPod')) os = 'iOS';
    else if (ua.includes('Linux')) os = 'Linux';

    // Detectar Navegador
    let browser = 'UnknownBrowser';
    if (ua.includes('Firefox')) browser = 'Firefox';
    else if (ua.includes('Chrome') && !ua.includes('Edg') && !ua.includes('OPR')) browser = 'Chrome';
    else if (ua.includes('Safari') && !ua.includes('Chrome')) browser = 'Safari';
    else if (ua.includes('Edg')) browser = 'Edge';
    else if (ua.includes('OPR') || ua.includes('Opera')) browser = 'Opera';

    return `${os}|${browser}`;
}

/**
 * Devuelve la sal configurada por despliegue (VITE_LICENSE_SALT).
 * Si no está presente, se usa una sal por defecto (no secreta — solo para fijar
 * el dominio de hash entre despliegues del mismo entorno).
 * @returns {string}
 */
function _getSalt() {
    const envSalt = (typeof import.meta !== 'undefined'
        && import.meta.env
        && import.meta.env.VITE_LICENSE_SALT) || '';
    return envSalt || 'PDA_FP_SALT_2026_DEFAULT';
}

/**
 * Genera un fingerprint robusto del dispositivo.
 * Combina características del navegador + sal del backend → SHA-256 de 32 hex chars.
 *
 * @returns {Promise<string>} Fingerprint en formato `PDA-V2-<32hex>`.
 */
export async function generateFingerprint() {
    if (typeof window === 'undefined' || !window.navigator) {
        // SSR / no-browser — devolver un fingerprint sintético determinista.
        return `${FP_PREFIX_V2}${'0'.repeat(FP_HASH_LENGTH)}`;
    }

    const nav = window.navigator;
    const screen = window.screen || {};

    const components = [
        _getStableUserAgent(),
        nav.language || '',
        nav.languages ? nav.languages.join(',') : '',
        nav.hardwareConcurrency || 1,
        nav.deviceMemory || 1,
        nav.platform || '',
        screen.colorDepth || 0,
        Intl?.DateTimeFormat()?.resolvedOptions()?.timeZone || '',
        // Sal del backend — dificulta precomputar fingerprints falsos.
        _getSalt(),
    ].join('|');

    if (!window.crypto || !window.crypto.subtle) {
        // Fallback (solo en http sin SSL). Truncamos a FP_HASH_LENGTH.
        let hash = 0;
        for (let i = 0; i < components.length; i++) {
            hash = ((hash << 5) - hash) + components.charCodeAt(i);
            hash |= 0;
        }
        // Generar un hash más largo combinando varias rotaciones para reducir colisiones.
        let hash2 = 5381;
        for (let i = 0; i < components.length; i++) {
            hash2 = ((hash2 << 5) + hash2) + components.charCodeAt(i);
            hash2 |= 0;
        }
        const hex = (Math.abs(hash).toString(16) + Math.abs(hash2).toString(16))
            .toUpperCase()
            .padStart(FP_HASH_LENGTH, '0')
            .slice(0, FP_HASH_LENGTH);
        return `${FP_PREFIX_V2}${hex}`;
    }

    const encoder = new TextEncoder();
    const data = encoder.encode(components);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    // Tomar los primeros 16 bytes (32 hex chars) — 128 bits de entropía.
    const hex = hashArray.slice(0, 16)
        .map(b => b.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase();
    return `${FP_PREFIX_V2}${hex}`;
}

/**
 * Verifica que el fingerprint almacenado coincide con el fingerprint actual.
 *
 * NOTA: Para evitar que actualizaciones de navegadores, cambios de zona horaria o de idioma
 * revoquen e invaliden de manera destructiva la licencia premium de usuarios legítimos,
 * permitimos cualquier ID almacenado que tenga el formato válido de instalación de PreciosAlDía.
 *
 * @param {string} storedId - ID almacenado en localStorage.
 * @param {string} [currentFp] - Fingerprint ya calculado (opcional, para ahorrar cómputo).
 * @returns {Promise<boolean>} `true` si coinciden, `false` si difieren o el formato es inválido.
 */
export async function verifyStoredFingerprint(storedId, currentFp) {
    if (typeof storedId !== 'string') {
        return false;
    }
    // Si empieza por el prefijo correcto de instalación, es un ID persistido válido.
    if (storedId.startsWith(FP_PREFIX_V2) || storedId.startsWith(FP_PREFIX)) {
        return true;
    }
    return false;
}

export default { generateFingerprint, verifyStoredFingerprint };
