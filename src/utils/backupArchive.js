import { compressString, decompressString, isCompressionSupported } from './compression';

export const BACKUP_ARCHIVE_SCHEMA_VERSION = 2;

/**
 * Crea el payload comprimido que se guarda en cloud_backups.
 * La metadata queda fuera del contenido comprimido para que la UI pueda
 * inspeccionar el estado sin descargar/descomprimir todo el backup.
 */
export async function createCompressedBackupPayload(backup) {
    if (!isCompressionSupported()) {
        throw new Error('Este navegador no soporta compresión gzip para backup remoto.');
    }

    const compressedData = await compressString(JSON.stringify(backup));
    return {
        compressed: true,
        compression: 'gzip',
        schemaVersion: BACKUP_ARCHIVE_SCHEMA_VERSION,
        version: backup.version,
        timestamp: backup.timestamp,
        appName: backup.appName,
        device: backup.device,
        summary: {
            idbKeys: Object.keys(backup.data?.idb || {}),
            lsKeys: Object.keys(backup.data?.ls || {}),
            recordCount: Object.keys(backup.data?.idb || {}).length
                + Object.keys(backup.data?.ls || {}).length,
        },
        data: compressedData,
    };
}

/**
 * Recupera el backup original desde el payload comprimido guardado en la nube.
 */
export async function decompressBackupPayload(payload) {
    if (!payload?.compressed || typeof payload.data !== 'string') return payload;
    if (payload.compression && payload.compression !== 'gzip') {
        throw new Error('Compresión de backup no soportada.');
    }
    const rawJson = await decompressString(payload.data);
    let parsed;
    try {
        parsed = JSON.parse(rawJson);
    } catch {
        throw new Error('El backup comprimido está dañado.');
    }
    return { ...payload, ...parsed, compressed: false };
}

export default { createCompressedBackupPayload, decompressBackupPayload };
