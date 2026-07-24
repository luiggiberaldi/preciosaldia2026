import { useState } from 'react';
import { storageService } from '../utils/storageService';
import { showToast } from '../components/Toast';
import { supabaseCloud } from '../config/supabaseCloud';
import { IDB_KEYS, LS_KEYS } from '../config/backupKeys';
import { runWithoutEco } from '../utils/syncFlags';
import { compressString, decompressString, isCompressionSupported } from '../utils/compression';
import { uploadToGoogleDrive } from '../utils/driveBackupUploader';


/**
 * Hook that encapsulates cloud backup/restore logic using device_id as the sole identifier.
 * No email or password required.
 *
 * @param {Object} params
 * @param {string}   params.deviceId
 * @param {Function} params.auditLog
 * @param {Function} params.forceHeartbeat
 * @param {Function} [params.triggerHaptic]
 */
export function useCloudBackup({
    deviceId,
    auditLog,
    forceHeartbeat,
    triggerHaptic,
}) {
    const [importStatus, setImportStatus] = useState(null);
    const [statusMessage, setStatusMessage] = useState('');
    const [dataConflictPending, setDataConflictPending] = useState(null);

    // ─── HELPER: Apply a cloud backup to local storage ───────────────────────
    // HOOK-014: Envolver TODA la restauración en `runWithoutEco` para setear
    // el flag `isSyncingFromCloud=true` y evitar que `storageService.setItem`
    // (vía `pushCloudSync`) re-envíe a la nube los datos que acabamos de recibir.
    const applyCloudBackup = async (cloudBackup) => {
        let backup = cloudBackup;
        if (cloudBackup?.compressed) {
            try {
                const rawJson = await decompressString(cloudBackup.data);
                backup = JSON.parse(rawJson);
            } catch (err) {
                console.error('[applyCloudBackup] Error al descomprimir:', err);
                throw new Error('El backup de la nube está dañado o no pudo descomprirse.');
            }
        }

        if (!backup?.data) {
            console.error('[applyCloudBackup] Backup inválido o sin datos:', backup);
            throw new Error('El backup de la nube está vacío o es inválido.');
        }
        await runWithoutEco(async () => {
            if (backup.version === '2.0' && backup.data.idb) {
                const idbEntries = Object.entries(backup.data.idb);
                for (const [key, value] of idbEntries) {
                    await storageService.setItem(key, value);
                }
            } else {
                console.warn('[applyCloudBackup] Formato no reconocido, intentando restauración legacy...');
            }
            if (backup.data.ls) {
                for (const [key, value] of Object.entries(backup.data.ls)) {
                    // localStorage.setItem pasa por el interceptor de useCloudSync;
                    // el flag global también lo silencia (doble protección).
                    localStorage.setItem(key, value);
                }
            }
        });
    };

    // ─── HELPER: Collect local backup payload ────────────────────────────────
    // HOOK-041: Usa las listas canónicas de `src/config/backupKeys.js`.
    const collectLocalBackup = async () => {
        const idbData = {};
        for (const key of IDB_KEYS) {
            const data = await storageService.getItem(key, null);
            if (data !== null) idbData[key] = data;
        }
        const lsData = {};
        for (const key of LS_KEYS) {
            const val = localStorage.getItem(key);
            if (val !== null) lsData[key] = val;
        }
        return {
            timestamp: new Date().toISOString(),
            version: '2.0',
            appName: 'TasasAlDia_Bodegas_Cloud',
            data: { idb: idbData, ls: lsData }
        };
    };

    // ─── HELPER: Upload local backup + initialize sync_documents ─────────────
    const uploadLocalBackup = async (backupData) => {
        if (!supabaseCloud || !deviceId) return;

        let payloadToUpload = backupData;
        if (isCompressionSupported()) {
            try {
                const compressedData = await compressString(JSON.stringify(backupData));
                payloadToUpload = {
                    compressed: true,
                    version: '2.0',
                    timestamp: backupData.timestamp,
                    appName: backupData.appName,
                    data: compressedData
                };
            } catch (err) {
                console.error('[CloudBackup] Error al comprimir manual backup, usando raw JSON:', err);
            }
        }

        // 1. Subir a Google Drive y guardar metadatos en Supabase
        const clientName = localStorage.getItem('business_name') || 'Mi Negocio';
        let driveResult = null;
        try {
            driveResult = await uploadToGoogleDrive(payloadToUpload, deviceId, clientName);
        } catch (driveErr) {
            console.error('[CloudBackup] Error al subir manual backup a Google Drive:', driveErr);
        }

        const metadataPayload = {
            drive_url: driveResult?.downloadUrl || null,
            size_bytes: driveResult?.sizeBytes || JSON.stringify(payloadToUpload).length,
            updated_at: new Date().toISOString()
        };

        const { error } = await supabaseCloud
            .from('cloud_backups')
            .upsert({
                device_id: deviceId,
                backup_data: metadataPayload,
                size_bytes: metadataPayload.size_bytes,
                updated_at: new Date().toISOString()
            }, { onConflict: 'device_id' });
        if (error) throw error;

        // 2. Inyección inicial en sync_documents para P2P
        try {
            const syncPayloads = [];
            for (const [key, value] of Object.entries(backupData.data.idb || {})) {
                syncPayloads.push({
                    device_id: deviceId,
                    collection: 'store',
                    doc_id: key,
                    data: { payload: value },
                    updated_at: new Date().toISOString()
                });
            }
            for (const [key, value] of Object.entries(backupData.data.ls || {})) {
                let finalVal = value;
                try { finalVal = JSON.parse(value); } catch { /* keep as string */ }
                syncPayloads.push({
                    device_id: deviceId,
                    collection: 'local',
                    doc_id: key,
                    data: { payload: finalVal },
                    updated_at: new Date().toISOString()
                });
            }
            if (syncPayloads.length > 0) {
                await supabaseCloud.from('sync_documents').upsert(syncPayloads, { onConflict: 'device_id,collection,doc_id' });
            }
        } catch (syncErr) {
            console.warn('[CloudBackup] Fallo inicializando sync_documents:', syncErr);
        }
    };

    // ─── HANDLER: Data conflict resolution ───────────────────────────────────
    const handleDataConflictChoice = async (choice) => {
        if (!dataConflictPending) return;
        const { cloudBackup, localBackup } = dataConflictPending;
        setDataConflictPending(null);
        setImportStatus('loading');
        setStatusMessage('Aplicando tu elección...');
        try {
            if (choice === 'cloud') {
                await applyCloudBackup(cloudBackup);
                showToast('Datos de la nube restaurados. Reiniciando...', 'success');
                setTimeout(() => window.location.reload(), 1500);
            } else {
                await uploadLocalBackup(localBackup);
                showToast('Datos locales guardados en la nube', 'success');
            }
            auditLog('NUBE', 'CONFLICTO_RESUELTO', `Conflicto datos resuelto: usuario eligió ${choice}`);
            setImportStatus(null);
        } catch (err) {
            showToast(err.message || 'Error al resolver el conflicto', 'error');
            setImportStatus('error');
        }
    };

    // ─── HANDLER: Sync cloud (initial connect) ────────────────────────────────
    const handleSyncCloud = async () => {
        if (!supabaseCloud || !deviceId) {
            showToast('Sin conexión a la nube', 'error');
            return;
        }

        try {
            setImportStatus('loading');
            setStatusMessage('Consultando backup en la nube...');

            const { data: cloudRow } = await supabaseCloud
                .from('cloud_backups')
                .select('backup_data')
                .eq('device_id', deviceId)
                .maybeSingle();

            const cloudBackup = cloudRow?.backup_data || null;
            const localBackup = await collectLocalBackup();
            const hasLocalData = Object.keys(localBackup.data.idb).length > 0;
            const hasCloudData = cloudBackup && cloudBackup.data;

            if (hasCloudData && hasLocalData) {
                // ⚠️ Conflicto: ambos tienen datos → preguntar al usuario
                setDataConflictPending({ cloudBackup, localBackup });
                setImportStatus(null);
                setStatusMessage('');
                auditLog('NUBE', 'CONFLICTO_DETECTADO', 'Conflicto datos nube/local');
                return;
            }

            if (hasCloudData && !hasLocalData) {
                // Dispositivo vacío → restaurar desde nube
                setStatusMessage('Restaurando backup de la nube...');
                await applyCloudBackup(cloudBackup);
                showToast('Datos restaurados automáticamente desde la nube', 'success');
                auditLog('NUBE', 'RESTORE_AUTO', 'Backup restaurado automáticamente');
                triggerHaptic?.();
                setImportStatus('success');
                setStatusMessage('Restauración completa. Reiniciando...');
                setTimeout(() => window.location.reload(), 1500);
                return;
            }

            // Sin datos en la nube → subir datos locales
            setStatusMessage('Guardando datos locales en la nube...');
            await uploadLocalBackup(localBackup);
            showToast('Datos sincronizados con la nube', 'success');
            auditLog('NUBE', 'SYNC_INICIAL', 'Datos locales subidos a la nube');
            triggerHaptic?.();
            setImportStatus(null);

        } catch (error) {
            console.error('[CloudBackup] Error:', error);
            showToast(error.message || 'Error contactando la nube', 'error');
            setImportStatus('error');
        }
    };

    return {
        importStatus,
        setImportStatus,
        statusMessage,
        setStatusMessage,
        dataConflictPending,
        setDataConflictPending,
        applyCloudBackup,
        collectLocalBackup,
        uploadLocalBackup,
        handleSyncCloud,
        handleDataConflictChoice,
    };
}
