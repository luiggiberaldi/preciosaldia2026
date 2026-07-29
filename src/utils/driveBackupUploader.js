/**
 * driveBackupUploader.js
 * Utility to upload backup JSON payloads to Google Drive via Google Apps Script.
 * Reusable by useAutoBackup, useCloudBackup, and useRemoteBackupListener.
 */
export async function uploadToGoogleDrive(payload, deviceId, clientName) {
    const GOOGLE_SCRIPT_URL = import.meta.env.VITE_GOOGLE_SCRIPT_BACKUPS_URL || import.meta.env.VITE_GOOGLE_SCRIPT_URL;
    if (!GOOGLE_SCRIPT_URL) {
        return null;
    }

    const body = JSON.stringify({
        action: 'upload_backup',
        deviceId,
        clientName: clientName || 'Mi Negocio',
        backupData: payload
    });

    try {
        const response = await fetch(GOOGLE_SCRIPT_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body,
            redirect: 'follow'
        });

        if (response.ok) {
            const text = await response.text();
            try {
                const result = JSON.parse(text);
                if (result.status === 'success' && result.downloadUrl) {
                    return result;
                }
            } catch (e) {
                // Ignore parse error on redirect
            }
        }
    } catch (corsErr) {
        // En caso de bloqueo CORS o 302 redirect del navegador, enviamos via no-cors sin fallar la consola
        try {
            await fetch(GOOGLE_SCRIPT_URL, {
                method: 'POST',
                mode: 'no-cors',
                headers: { 'Content-Type': 'text/plain;charset=utf-8' },
                body
            });
            return { downloadUrl: null, sizeBytes: body.length, status: 'submitted_nocors' };
        } catch (e) {
            // Silenciosamente omitir si la red está desconectada
        }
    }

    return null;
}
