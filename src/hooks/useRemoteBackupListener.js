import { useEffect, useRef } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { storageService } from '../utils/storageService';
import { IDB_KEYS, LS_KEYS } from '../config/backupKeys';
import { compressString, isCompressionSupported } from '../utils/compression';

async function collectAndUpload(deviceId) {
    // Recolectar datos locales
    // HOOK-041: usa las listas canónicas de backupKeys.js.
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
    const backupData = {
        timestamp: new Date().toISOString(),
        version: '2.0',
        appName: 'TasasAlDia_Bodegas_Cloud',
        data: { idb: idbData, ls: lsData }
    };

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
            console.error('[RemoteBackup] Error compressing remote backup:', err);
        }
    }

    // Subir a cloud_backups
    const { error } = await supabaseCloud
        .from('cloud_backups')
        .upsert({ device_id: deviceId, backup_data: payloadToUpload, updated_at: new Date().toISOString() },
            { onConflict: 'device_id' });
    if (error) throw error;
}

/**
 * Escucha solicitudes de backup remoto desde la Estación Maestra.
 * Cuando llega una solicitud (status='pending'), sube el backup y la marca como completada.
 */
export function useRemoteBackupListener(deviceId) {
    useEffect(() => {
        if (!supabaseCloud || !deviceId) return;

        const handleRequest = async () => {
            try {
                await collectAndUpload(deviceId);
                await supabaseCloud
                    .from('backup_requests')
                    .update({ status: 'completed', completed_at: new Date().toISOString() })
                    .eq('device_id', deviceId);
                console.log('[RemoteBackup] Backup enviado al admin.');
            } catch (err) {
                console.error('[RemoteBackup] Error al responder solicitud:', err);
                await supabaseCloud
                    .from('backup_requests')
                    .update({ status: 'error' })
                    .eq('device_id', deviceId)
                    .catch(() => {});
            }
        };

        let channel = null;

        // Verificar si hay una solicitud pendiente al conectar
        supabaseCloud
            .from('backup_requests')
            .select('status')
            .eq('device_id', deviceId)
            .single()
            .then(({ data }) => { if (data?.status === 'pending') handleRequest(); })
            .catch(() => {});

        // Suscribirse a nuevas solicitudes en tiempo real de forma anónima
        channel = supabaseCloud
            .channel(`remote_backup:${deviceId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'backup_requests',
                filter: `device_id=eq.${deviceId}`,
            }, async (payload) => {
                if (payload.new?.status === 'pending') await handleRequest();
            })
            .subscribe();

        return () => {
            if (channel) {
                supabaseCloud.removeChannel(channel).catch(() => {});
            }
        };
    }, [deviceId]);
}
