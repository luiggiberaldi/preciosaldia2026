import { evaluateBackupEligibility } from '../config/licensePolicy';

/**
 * Regla única para el backup remoto automático.
 *
 * El backup local está disponible para todos. El remoto es de los planes de
 * pago (permanente y mensual) con la licencia viva, incluido el período de
 * gracia del mensual. La decisión vive en `config/licensePolicy.js`, que es el
 * mismo módulo que aplica la Estación Maestra.
 *
 * Historia (AUDITORIA-LICENCIAS.md LIC-03): esta función exigía
 * `type === 'permanent'`, así que el servidor mandaba solicitudes de respaldo a
 * clientes mensuales que la caja rechazaba siempre — se acumulaban como
 * "fallidas" para siempre.
 */
export function getBackupEntitlement({
    isPremium = false,
    isDemo = false,
    license = null,
    now = Date.now(),
} = {}) {
    if (!isPremium || isDemo) {
        return { allowed: false, reason: 'license_not_paid' };
    }

    const type = license?.type ?? license?.license_type;
    const isActive = license?.isActive ?? license?.is_active;
    const expiresAt = license?.expiresAt ?? license?.expires_at ?? null;

    const eligibility = evaluateBackupEligibility({ type, isActive, expiresAt }, now);
    return eligibility.allowed
        ? { allowed: true, reason: 'eligible' }
        : {
            allowed: false,
            reason: eligibility.reason === 'not_eligible' ? 'license_not_paid' : eligibility.reason,
        };
}

/**
 * @deprecated Nombre histórico. El respaldo remoto es de los planes de pago
 * (permanente y mensual), no solo del permanente. Usar `getBackupEntitlement`.
 */
export const getPermanentBackupEntitlement = getBackupEntitlement;

export function readCachedLicense(storage = globalThis.localStorage) {
    try {
        const raw = storage?.getItem('pda_license_cache');
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function getCachedBackupEntitlement({
    isPremium = false,
    isDemo = false,
    storage = globalThis.localStorage,
    now = Date.now(),
} = {}) {
    return getBackupEntitlement({
        isPremium,
        isDemo,
        license: readCachedLicense(storage),
        now,
    });
}

/** @deprecated Usar `getCachedBackupEntitlement`. */
export const getCachedPermanentBackupEntitlement = getCachedBackupEntitlement;

export default {
    getBackupEntitlement,
    getPermanentBackupEntitlement,
    readCachedLicense,
    getCachedBackupEntitlement,
    getCachedPermanentBackupEntitlement,
};
