// Validación y formato de teléfonos venezolanos (móviles 04XX)
// Usado en el registro del negocio, Ajustes → Mi Negocio y solicitud de licencia.

/**
 * Normaliza a dígitos locales de 11 caracteres (ej: "0412-1234567" → "04121234567").
 * Acepta prefijo internacional +58/58.
 * @returns {string|null} dígitos normalizados o null si no parece un número VE
 */
export const normalizeVzlaPhone = (raw) => {
    if (!raw) return null;
    let digits = String(raw).replace(/\D/g, '');
    // Quitar código de país 58 si viene con él (+58 412 ... → 13 dígitos)
    if (digits.length === 13 && digits.startsWith('58')) digits = digits.slice(2);
    if (digits.length === 12 && digits.startsWith('58')) digits = '0' + digits.slice(2);
    return digits || null;
};

/**
 * Válido = móvil venezolano: 11 dígitos empezando por 04 (0412, 0414, 0416, 0424, 0426…).
 */
export const isValidVzlaPhone = (raw) => {
    const digits = normalizeVzlaPhone(raw);
    return !!digits && /^04\d{9}$/.test(digits);
};

/** Formato legible: 04121234567 → "0412 123 4567" */
export const displayVzlaPhone = (raw) => {
    const digits = normalizeVzlaPhone(raw);
    if (!digits || digits.length !== 11) return raw || '';
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
};
