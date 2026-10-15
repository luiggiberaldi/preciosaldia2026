export const LEGACY_PAIRING_SELECT = 'monitor_device_id, monitor_auth_id, paired_at, revoked_at, token_expires_at';
export const EXTENDED_PAIRING_SELECT = `${LEGACY_PAIRING_SELECT}, monitor_device_id_2, monitor_auth_id_2, paired_at_2`;

function errorText(error) {
    return String(error?.message || error?.details || error?.hint || '').toLowerCase();
}

export function isMissingSecondaryPairingColumnsError(error) {
    const message = errorText(error);
    return Boolean(
        message.includes('monitor_device_id_2')
        || message.includes('monitor_auth_id_2')
        || message.includes('paired_at_2')
        || (message.includes('column') && message.includes('does not exist'))
        || message.includes('schema cache')
    );
}

/** Lee el vínculo y cae al esquema legacy solo si faltan columnas del segundo slot. */
export async function readPairingRow({ supabase, primaryDeviceId } = {}) {
    if (!supabase?.from || !primaryDeviceId) {
        return { data: null, error: new Error('No hay dispositivo principal definido'), supportsSecondary: false };
    }

    const extended = await supabase
        .from('device_pairings')
        .select(EXTENDED_PAIRING_SELECT)
        .eq('primary_device_id', primaryDeviceId)
        .maybeSingle();

    if (!extended.error || !isMissingSecondaryPairingColumnsError(extended.error)) {
        return { ...extended, supportsSecondary: !extended.error };
    }

    const legacy = await supabase
        .from('device_pairings')
        .select(LEGACY_PAIRING_SELECT)
        .eq('primary_device_id', primaryDeviceId)
        .maybeSingle();

    return { ...legacy, supportsSecondary: false, fallbackFrom: extended.error };
}

export function getActivePairingSlots(row) {
    if (!row || row.revoked_at) return [];

    return [
        { id: row.monitor_device_id, authId: row.monitor_auth_id, pairedAt: row.paired_at },
        { id: row.monitor_device_id_2, authId: row.monitor_auth_id_2, pairedAt: row.paired_at_2 },
    ].filter((device) => device.id && device.authId);
}

export function isPrimaryPairingActive(row) {
    return getActivePairingSlots(row).length > 0;
}

export function isMonitorPairingActive(row, monitorDeviceId) {
    if (!monitorDeviceId || !row || row.revoked_at) return false;
    return getActivePairingSlots(row).some((device) => String(device.id) === String(monitorDeviceId));
}
