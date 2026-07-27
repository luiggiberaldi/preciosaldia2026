import { useEffect, useRef } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { storageService } from '../utils/storageService';
import { IDB_KEYS, LS_KEYS } from '../config/backupKeys';
import { compressString, isCompressionSupported } from '../utils/compression';
import { uploadToGoogleDrive } from '../utils/driveBackupUploader';

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

    const clientName = localStorage.getItem('business_name') || 'Mi Negocio';
    let driveResult = null;
    try {
        driveResult = await uploadToGoogleDrive(payloadToUpload, deviceId, clientName);
    } catch (driveErr) {
        console.error('[RemoteBackup] Error al subir remote backup a Google Drive:', driveErr);
    }

    const metadataPayload = {
        drive_url: driveResult?.downloadUrl || null,
        size_bytes: driveResult?.sizeBytes || JSON.stringify(payloadToUpload).length,
        product_count: Array.isArray(idbData.bodega_products_v1) ? idbData.bodega_products_v1.length : 0,
        sales_count: Array.isArray(idbData.bodega_sales_v1) ? idbData.bodega_sales_v1.length : 0,
        customer_count: Array.isArray(idbData.bodega_customers_v1) ? idbData.bodega_customers_v1.length : 0,
        updated_at: new Date().toISOString()
    };

    // Subir metadatos a cloud_backups
    const { error } = await supabaseCloud
        .from('cloud_backups')
        .upsert({
            device_id: deviceId,
            backup_data: metadataPayload,
            updated_at: new Date().toISOString()
        }, { onConflict: 'device_id' });
    if (error) throw error;
}

/**
 * @deprecated C-001: Consolidado en `useAutoBackup.js`.
 * Se conserva la exportación no-op para compatibilidad de importación sin duplicar el canal Realtime.
 */
export function useRemoteBackupListener(deviceId) {
    // La escucha de solicitudes de backup remoto se maneja exclusivamente en useAutoBackup.js
}
