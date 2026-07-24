/**
 * driveBackupUploader.js
 * Utility to upload backup JSON payloads to Google Drive via Google Apps Script.
 * Reusable by useAutoBackup, useCloudBackup, and useRemoteBackupListener.
 */
export async function uploadToGoogleDrive(payload, deviceId, clientName) {
    const GOOGLE_SCRIPT_URL = import.meta.env.VITE_GOOGLE_SCRIPT_URL;
    if (!GOOGLE_SCRIPT_URL) {
        throw new Error('[DriveBackup] VITE_GOOGLE_SCRIPT_URL no configurada en .env');
    }

    const response = await fetch(GOOGLE_SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            action: 'upload_backup',
            deviceId,
            clientName: clientName || 'Mi Negocio',
            backupData: payload
        }),
        redirect: 'follow'
    });

    const text = await response.text();
    let result;
    try {
        result = JSON.parse(text);
    } catch (e) {
        throw new Error(`[DriveBackup] Respuesta no válida de Google Script: ${text.substring(0, 100)}`);
    }

    if (!response.ok || result.status !== 'success') {
        throw new Error(`[DriveBackup] Error en Google Script: ${result.message || response.status}`);
    }

    if (!result.downloadUrl) {
        throw new Error('[DriveBackup] Respuesta sin downloadUrl — backup no confirmado');
    }

    return result; // { downloadUrl, sizeBytes, fileName, fileId }
}
