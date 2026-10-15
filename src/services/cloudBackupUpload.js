import { supabaseCloud } from '../config/supabaseCloud';
import { buildCloudBackupsRow } from '../config/cloudSchema';
import { ensureSupervisorSession } from './supervisorAuth';
import { ensureDeviceSessionRegistered } from '../utils/deviceIdentity';
import { isRlsBlockedError } from '../utils/cloudError';
import { relayUploadBackup } from '../utils/backupRelay';

/**
 * Guarda un backup comprimido en la fila propia del dispositivo.
 * Esta ruta es el camino operativo inmediato mientras Storage dedicado no esté
 * habilitado. El payload sigue siendo gzip+base64 y es restaurable por
 * useCloudBackup/decompressCloudBackup.
 */
export async function uploadCompressedBackupToCloud(deviceId, backupData) {
    if (!supabaseCloud || !deviceId) {
        return { ok: false, error: 'Nube no disponible o dispositivo no definido' };
    }

    const { session, error: sessionError } = await ensureSupervisorSession();
    if (sessionError || !session) {
        return { ok: false, error: sessionError?.message || 'No hay sesión de dispositivo' };
    }

    const registration = await ensureDeviceSessionRegistered(deviceId);
    if (!registration.ok) {
        return { ok: false, error: registration.error?.message || registration.error || 'No se pudo registrar el dispositivo' };
    }

    const row = buildCloudBackupsRow({ deviceId, backupData });
    const { error } = await supabaseCloud
        .from('cloud_backups')
        .upsert(row, { onConflict: 'device_id' });

    if (!error) return { ok: true, destination: 'cloud_backups' };

    if (isRlsBlockedError(error)) {
        const relay = await relayUploadBackup(deviceId, backupData);
        if (relay.ok) return { ok: true, destination: 'relay' };
    }

    return { ok: false, error: error.message || 'No se pudo guardar el backup en Supabase' };
}

export default { uploadCompressedBackupToCloud };
