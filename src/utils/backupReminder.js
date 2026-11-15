// Recordatorio de respaldo: guarda cuándo se exportó el último respaldo .json
// y dice si ya toca hacer otro (Ajustes → Sistema).
import { storageService } from './storageService';

export const LAST_BACKUP_KEY = 'last_backup_export_at';
export const BACKUP_STALE_DAYS = 7;

export async function markBackupExported(now = new Date()) {
    await storageService.setItem(LAST_BACKUP_KEY, now.toISOString());
}

export async function getLastBackupAt() {
    const v = await storageService.getItem(LAST_BACKUP_KEY, null);
    return typeof v === 'string' && !Number.isNaN(Date.parse(v)) ? v : null;
}

/** Días enteros transcurridos desde `iso`; null si nunca se exportó. */
export function daysSinceBackup(iso, now = new Date()) {
    if (!iso) return null;
    const ms = now.getTime() - Date.parse(iso);
    return Math.max(0, Math.trunc(ms / 86400000));
}

/** Texto corto para la tarjeta: «Último respaldo: hoy / ayer / hace N días / nunca». */
export function describeBackupAge(iso, now = new Date()) {
    const d = daysSinceBackup(iso, now);
    if (d === null) return 'Aún no has exportado ningún respaldo';
    if (d === 0) return 'Último respaldo: hoy';
    if (d === 1) return 'Último respaldo: ayer';
    return `Último respaldo: hace ${d} días`;
}

export function isBackupStale(iso, now = new Date()) {
    const d = daysSinceBackup(iso, now);
    return d === null || d >= BACKUP_STALE_DAYS;
}

/**
 * Nombre del archivo de respaldo: `respaldo_preciosaldia_AAAA-MM-DD.json`, con la fecha LOCAL
 * del equipo (toISOString daba la fecha UTC: de noche en Venezuela ya salía el día siguiente).
 */
export function backupFileName(now = new Date()) {
    const pad = (n) => String(n).padStart(2, '0');
    const fecha = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
    return `respaldo_preciosaldia_${fecha}.json`;
}
