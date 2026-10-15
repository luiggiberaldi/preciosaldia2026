/**
 * Regla única para el backup remoto automático.
 *
 * El backup local está disponible para todos. El remoto solo se habilita
 * cuando la licencia confirmada es permanente y está activa.
 */
export function getPermanentBackupEntitlement({
    isPremium = false,
    isDemo = false,
    license = null,
    now = Date.now(),
} = {}) {
    if (!isPremium || isDemo) {
        return { allowed: false, reason: 'license_not_permanent' };
    }

    const type = license?.type ?? license?.license_type;
    const isActive = license?.isActive ?? license?.is_active;
    const expiresAt = license?.expiresAt ?? license?.expires_at ?? null;

    if (type !== 'permanent') {
        return { allowed: false, reason: 'license_not_permanent' };
    }
    if (isActive === false) {
        return { allowed: false, reason: 'license_inactive' };
    }
    if (expiresAt && Number.isFinite(new Date(expiresAt).getTime()) && new Date(expiresAt).getTime() <= now) {
        return { allowed: false, reason: 'license_expired' };
    }

    return { allowed: true, reason: 'permanent_active' };
}

export function readCachedLicense(storage = globalThis.localStorage) {
    try {
        const raw = storage?.getItem('pda_license_cache');
        return raw ? JSON.parse(raw) : null;
    } catch {
        return null;
    }
}

export function getCachedPermanentBackupEntitlement({
    isPremium = false,
    isDemo = false,
    storage = globalThis.localStorage,
    now = Date.now(),
} = {}) {
    return getPermanentBackupEntitlement({
        isPremium,
        isDemo,
        license: readCachedLicense(storage),
        now,
    });
}

export default {
    getPermanentBackupEntitlement,
    readCachedLicense,
    getCachedPermanentBackupEntitlement,
};
