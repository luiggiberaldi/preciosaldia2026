import { SUPERVISOR_SYNC_KEYS } from './supervisorContracts';
import { getSyncMetadataKey } from './supervisorSyncService';

export const MONITOR_CLEANUP_PENDING_KEY = 'monitor_revoked_cleanup_pending';

const MONITOR_ONLY_LOCAL_KEYS = Object.freeze([
    'business_name',
    'business_rif',
    'monitor_last_sync',
]);

const LAST_PUSH_HASH_PREFIX = 'bodega_last_periodic_push_hash_';

export function isPairingRevocationConfirmed(pairing, monitorAuthId) {
    return Boolean(pairing && (pairing.revoked_at || pairing.monitor_auth_id !== monitorAuthId));
}

export class MonitorUnpairError extends Error {
    constructor(phase, message, cause) {
        super(message, { cause });
        this.name = 'MonitorUnpairError';
        this.phase = phase;
    }
}

export async function clearMonitorCache({ idbStore, localStorage }) {
    if (!idbStore || typeof idbStore.removeItem !== 'function') {
        throw new Error('No está disponible el almacenamiento local del monitor');
    }
    if (!localStorage || typeof localStorage.removeItem !== 'function') {
        throw new Error('No está disponible la configuración local del monitor');
    }

    for (const key of SUPERVISOR_SYNC_KEYS) {
        await idbStore.removeItem(key);
    }

    for (const key of SUPERVISOR_SYNC_KEYS) {
        localStorage.removeItem(key);
        localStorage.removeItem(getSyncMetadataKey(key));
        localStorage.removeItem(`${LAST_PUSH_HASH_PREFIX}${key}`);
    }

    for (const key of MONITOR_ONLY_LOCAL_KEYS) {
        localStorage.removeItem(key);
    }

    // Quitar el identificador de vínculo al final: si la limpieza falla antes,
    // la pantalla conserva el dispositivo y puede ofrecer reintentar.
    localStorage.removeItem('pda_paired_device_id');
    localStorage.removeItem('pda_pairing_mode');
    // Este marcador se quita último para poder reanudar si cualquier paso falla.
    localStorage.removeItem(MONITOR_CLEANUP_PENDING_KEY);
}

export async function revokeAndClearMonitor({
    deviceId,
    ensureSession,
    revokePairing,
    verifyPairingRevoked,
    serverAlreadyRevoked = false,
    idbStore,
    localStorage,
    onRemoteRevoked,
    onServerRevoked,
}) {
    if (!localStorage || typeof localStorage.getItem !== 'function') {
        throw new MonitorUnpairError('revoke', 'No está disponible la configuración local del monitor');
    }

    // El marker permite reintentar la limpieza aunque ya se haya quitado el ID local.
    let serverRevoked = serverAlreadyRevoked
        || localStorage.getItem(MONITOR_CLEANUP_PENDING_KEY) === 'true';
    if (!serverRevoked && !deviceId) {
        throw new MonitorUnpairError('revoke', 'No hay una caja vinculada');
    }

    if (!serverRevoked) {
        try {
            const { session, error: sessionError } = await ensureSession();
            if (sessionError || !session) {
                throw sessionError || new Error('No hay una sesión segura del monitor');
            }

            const { error } = await revokePairing(deviceId);
            if (error) throw error;
            serverRevoked = true;
        } catch (revokeError) {
            // Una respuesta perdida puede ocultar una revocación ya aplicada. Solo
            // continuar si una lectura confirma el estado final; no repetir a ciegas.
            try {
                serverRevoked = Boolean(await verifyPairingRevoked?.(deviceId));
            } catch {
                serverRevoked = false;
            }
            if (!serverRevoked) {
                throw new MonitorUnpairError(
                    'revoke',
                    `El servidor no confirmó la desvinculación; el monitor sigue activo. Puedes reintentar. ${revokeError?.message || ''}`.trim(),
                    revokeError
                );
            }
        }
    }

    if (serverRevoked) onServerRevoked?.();

    try {
        // Guardar antes de limpiar: recarga o fallo local podrá reanudar desde aquí.
        // Evitar retirar información local vinculada si no se puede persistir el marker.
        localStorage.setItem(MONITOR_CLEANUP_PENDING_KEY, 'true');
        if (localStorage.getItem(MONITOR_CLEANUP_PENDING_KEY) !== 'true') {
            throw new Error('No se pudo guardar el estado de limpieza pendiente');
        }
        // Suspender Realtime tras confirmar revocación y antes de eliminar su caché.
        await onRemoteRevoked?.();
        await clearMonitorCache({ idbStore, localStorage });
    } catch (error) {
        throw new MonitorUnpairError(
            'cleanup',
            error?.message || 'La revocación quedó confirmada, pero falta limpiar los datos locales. Reintenta.',
            error
        );
    }
}
