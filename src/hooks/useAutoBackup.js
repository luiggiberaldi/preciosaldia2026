import { useEffect, useRef, useCallback } from 'react';
import { storageService } from '../utils/storageService';
import { supabaseCloud } from '../config/supabaseCloud';
import { IDB_KEYS, LS_KEYS } from '../config/backupKeys';
import { compressString, isCompressionSupported } from '../utils/compression';
import { validateBackupJson, applyBackupToStorage } from '../utils/backupRestoreService';
import { buildCloudBackupsRow } from '../config/cloudSchema';
import { startBackupRequestPolling } from '../services/backupRequestPolling';
import { uploadBackupToStorage } from '../utils/backupStorageUpload';


// ─── Configuración optimizada ───────────────────────────────────────────────
const BACKUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutos
const BACKUP_KEY = 'bodega_autobackup_v1';
const LAST_UPLOAD_HASH_KEY = 'bodega_last_upload_hash';
const BACKUP_RETRY_STATE_PREFIX = 'backup_retry_';
const BACKUP_RETRY_BASE_MS = 5 * 60 * 1000;
const BACKUP_RETRY_MAX_MS = 30 * 60 * 1000;

function getBackupRetryState(requestId) {
    if (typeof sessionStorage === 'undefined') return { attempts: 0, nextAttemptAt: 0 };
    try {
        const raw = sessionStorage.getItem(`${BACKUP_RETRY_STATE_PREFIX}${requestId}`);
        if (!raw) return { attempts: 0, nextAttemptAt: 0 };
        const parsed = JSON.parse(raw);
        return {
            attempts: Math.max(0, Number(parsed.attempts) || 0),
            nextAttemptAt: Math.max(0, Number(parsed.nextAttemptAt) || 0),
        };
    } catch {
        return { attempts: 0, nextAttemptAt: 0 };
    }
}

function scheduleBackupRetry(requestId) {
    const previous = getBackupRetryState(requestId);
    const attempts = previous.attempts + 1;
    const delay = Math.min(BACKUP_RETRY_BASE_MS * (2 ** (attempts - 1)), BACKUP_RETRY_MAX_MS);
    const state = { attempts, nextAttemptAt: Date.now() + delay };
    try {
        sessionStorage.setItem(`${BACKUP_RETRY_STATE_PREFIX}${requestId}`, JSON.stringify(state));
    } catch {
        // Retry timing is best-effort when session storage is unavailable.
    }
    return state;
}

function clearBackupRetryState(requestId) {
    try {
        sessionStorage.removeItem(`${BACKUP_RETRY_STATE_PREFIX}${requestId}`);
    } catch {
        // A completed backup stays complete even if retry-state cleanup is unavailable.
    }
}

function isBackupRetryDue(requestId, now = Date.now()) {
    return getBackupRetryState(requestId).nextAttemptAt <= now;
}

/**
 * Marca una solicitud de respaldo como fallida con el motivo.
 * Tolerante a que la columna `error` aún no exista (migración pendiente):
 * si el UPDATE con `error` falla, reintenta solo con `status`.
 */
async function markBackupRequestFailed(requestId, reason) {
    if (!supabaseCloud || !requestId) return;
    const shortReason = String(reason ?? 'error desconocido').slice(0, 500);
    const mark = async (withError) => supabaseCloud.from('backup_requests')
        .update(withError ? { status: 'failed', error: shortReason } : { status: 'failed' })
        .eq('id', requestId);
    const first = await mark(true);
    if (first.error) {
        const second = await mark(false);
        if (second.error) {
            console.error(`[AutoBackup] No se pudo marcar la solicitud ${requestId} como fallida:`, second.error);
            return;
        }
    }
    console.warn(`[AutoBackup] Respaldo ${requestId} marcado como fallido: ${shortReason}`);
}

/** Hash ligero para detectar cambios sin comparar objetos enteros */
function quickHash(obj) {
    const str = JSON.stringify(obj) ?? '';
    let h = 0;
    for (let i = 0; i < Math.min(str.length, 5000); i++) {
        h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return `${str.length}_${h >>> 0}`;
}

export function useAutoBackup(isPremium, isDemo, deviceId) {
    const intervalRef = useRef(null);
    const initialTimerRef = useRef(null);
    const performBackupRef = useRef(null);
    const isRunningRef = useRef(false);
    const runningTimeoutRef = useRef(null);
    const processedIdsRef = useRef(new Set());

    const configRef = useRef({ isPremium, isDemo, deviceId });
    useEffect(() => {
        configRef.current = { isPremium, isDemo, deviceId };
    }, [isPremium, isDemo, deviceId]);

    const performBackup = useCallback(async (forceUpload = false) => {
        const { isPremium: premium, isDemo: demo, deviceId: devId } = configRef.current;
        try {
                // ── Recolectar IndexedDB ────────────────────────────────
                const idbData = {};
                let hasData = false;
                for (const key of IDB_KEYS) {
                    const val = await storageService.getItem(key, null);
                    if (val !== null) { idbData[key] = val; hasData = true; }
                }

                // ── Recolectar localStorage ────────────────────────────
                const lsData = {};
                for (const key of LS_KEYS) {
                    const val = localStorage.getItem(key);
                    if (val !== null) { lsData[key] = val; hasData = true; }
                }

                if (!hasData && !forceUpload) return { ok: false, error: 'Sin datos que respaldar' };

                // ── Backup completo (formato v2.0) ────────────────────
                const fullBackup = {
                    timestamp: new Date().toISOString(),
                    version: '2.0',
                    appName: 'TasasAlDia_Bodegas',
                    device: navigator.userAgent?.substring(0, 80),
                    data: { idb: idbData, ls: lsData }
                };

                // Guardar copia local
                await storageService.setItem(BACKUP_KEY, fullBackup);

                // Subir a la nube solo si hay conexión, deviceId y emparejamiento/licencia cloud activa
                // GUARDA-RAIL LICENCIA: los equipos en modo demo NO suben respaldos periódicos a Drive ni a la nube, salvo que sea una solicitud forzada
                if (demo && !forceUpload) return { ok: false, error: 'Equipo en demo: respaldo periódico omitido' };

                const hasCloudPairing = localStorage.getItem('pda_cloud_session') || localStorage.getItem('pda_paired_device') || premium;
                const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

                // En entorno local (localhost) sin sesión de nube activa, omitir llamadas remotas para mantener la consola de desarrollo limpia
                if (isLocalhost && !hasCloudPairing && !forceUpload) return { ok: false, error: 'Localhost sin sesión de nube: respaldo remoto omitido' };

                if (devId && supabaseCloud && (hasCloudPairing || forceUpload)) {
                    const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
                    const lastDailyBackup = localStorage.getItem('bodega_last_daily_backup_date');

                    // Si no es premium y ya respaldó hoy, omitir para evitar peticiones redundantes
                    if (!premium && lastDailyBackup === todayStr && !forceUpload) return { ok: false, error: 'Ya respaldó hoy (no premium)' };

                    const currentHash = quickHash(idbData);
                    const lastHash = localStorage.getItem(LAST_UPLOAD_HASH_KEY);

                    // forceUpload=true omite la verificación de hash (solicitud manual)
                    if (!forceUpload && currentHash === lastHash) return { ok: false, error: 'Sin cambios desde el último respaldo' };

                    let payloadToUpload = fullBackup;
                    if (isCompressionSupported()) {
                        try {
                            const compressedData = await compressString(JSON.stringify(fullBackup));
                            payloadToUpload = {
                                compressed: true,
                                version: '2.0',
                                timestamp: fullBackup.timestamp,
                                appName: fullBackup.appName,
                                device: fullBackup.device,
                                data: compressedData
                            };
                        } catch (err) {
                            console.error('[AutoBackup] Error al comprimir backup, usando raw JSON:', err);
                        }
                    }

                    // Subida a Storage de Estación: solo es éxito la respuesta verificada
                    // del servidor (ok:true). Un fallo no marca hash/fecha como respaldados.
                    if (!payloadToUpload.compressed || typeof payloadToUpload.data !== 'string') {
                        return { ok: false, driveUrl: null, error: 'Respaldo sin comprimir: no se sube a Storage' };
                    }
                    const gzipBytes = Uint8Array.from(atob(payloadToUpload.data), (c) => c.charCodeAt(0));
                    const upload = await uploadBackupToStorage(devId, gzipBytes);
                    if (!upload.ok) {
                        return { ok: false, driveUrl: null, error: upload.error || 'Subida a Storage fallida' };
                    }
                    // SEC-009 (excepción documentada): hash y fecha son controles locales del
                    // respaldo, no datos de negocio. No están en LOCAL_KEYS/SYNC_KEYS y no deben
                    // ir a storageService, que encola sincronización con la nube.
                    localStorage.setItem(LAST_UPLOAD_HASH_KEY, currentHash);
                    localStorage.setItem('bodega_last_daily_backup_date', todayStr);
                    return { ok: true, driveUrl: null, backupId: upload.backupId, operationId: upload.operationId };
                }

                return { ok: false, error: 'Sin deviceId o sin cliente de nube' };
            } catch (e) {
                console.error('[AutoBackup] Error:', e);
                return { ok: false, error: String(e?.message || e) };
            }
    }, []);

    useEffect(() => {
        performBackupRef.current = performBackup;
    }, [performBackup]);

    useEffect(() => {
        // Primer backup 30s después del arranque
        initialTimerRef.current = setTimeout(() => performBackupRef.current?.(), 30000);

        // Backup cada 30 minutos
        intervalRef.current = setInterval(() => performBackupRef.current?.(), BACKUP_INTERVAL_MS);

        return () => {
            if (initialTimerRef.current) clearTimeout(initialTimerRef.current);
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, []);

    // ── Suscripción a solicitudes de backup en tiempo real ─────────────────
    // Solo dispositivos con cuenta activa (permanent/monthly/demo) mantienen este
    // socket abierto — evita gastar cupo de conexiones Realtime en instalaciones
    // sin licencia (free/demo vencida) que nunca usarán el backup remoto forzado.
    useEffect(() => {
        // Solo dispositivos con licencia activa (no demo) escuchan solicitudes remotas de la Estación Maestra.
        // Los demos no tienen acceso a backup remoto en Drive.
        const { isDemo: demoActive } = configRef.current;
        if (!deviceId || !supabaseCloud || demoActive) return;

        let channel = null;

        const checkPendingRequests = async () => {
            // GUARDA-RAIL: semáforo anti-doble-ejecución (poll + realtime)
            if (isRunningRef.current) return;
            isRunningRef.current = true;

            // ARNES V1: auto-liberar semáforo si la subida cuelga por >2 minutos
            runningTimeoutRef.current = setTimeout(() => {
                isRunningRef.current = false;
                console.warn('[AutoBackup] Semáforo de backup liberado por timeout (2min)');
            }, 2 * 60 * 1000);

            try {
                const { data: requestRows, error: queryError } = await supabaseCloud
                    .from('backup_requests')
                    .select('id, status, created_at')
                    .eq('device_id', deviceId)
                    .in('status', ['pending', 'failed'])
                    .order('created_at', { ascending: false })
                    .limit(25);
                if (queryError) throw queryError;

                const requests = Array.isArray(requestRows) ? requestRows : (requestRows ? [requestRows] : []);
                const data = requests.find(request =>
                    (request.status === 'pending' || request.status === 'failed')
                    && isBackupRetryDue(request.id)
                );

                if (data?.id) {
                    // GUARDA-RAIL V4: usar sessionStorage para persistir IDs entre reloads en la misma pestaña
                    const sessionKey = `backup_processed_${data.id}`;
                    if (typeof sessionStorage !== 'undefined' && sessionStorage.getItem(sessionKey)) return;

                    // ARNES V2: pruning del Set (máx 100 IDs en memoria)
                    if (processedIdsRef.current.size > 100) processedIdsRef.current.clear();
                    if (processedIdsRef.current.has(data.id)) return;

                    try {
                        console.log(`[AutoBackup] Solicitud de backup pendiente detectada (${data.id}). Ejecutando...`);
                        const result = await performBackupRef.current?.(true);

                        if (result?.ok) {
                            const upd = await supabaseCloud.from('backup_requests').update({
                                status: 'completed',
                                completed_at: new Date().toISOString()
                            }).eq('id', data.id);
                            if (upd?.error) {
                                console.error(`[AutoBackup] Respaldo ${data.id} completado pero NO se pudo marcar completed:`, upd.error);
                                throw upd.error;
                            }

                            // ARNES V3: marcar como procesado SOLO después del backup y el cierre exitosos en la nube
                            processedIdsRef.current.add(data.id);
                            clearBackupRetryState(data.id);
                            if (typeof sessionStorage !== 'undefined') {
                                try {
                                    sessionStorage.setItem(sessionKey, '1');
                                } catch {
                                    // In-memory processed IDs still prevent duplicate work this session.
                                }
                            }
                            console.log('[AutoBackup] Backup pendiente procesado.');
                        } else {
                            // Un estado failed sigue siendo elegible para un retry con backoff.
                            scheduleBackupRetry(data.id);
                            await markBackupRequestFailed(data.id, result?.error || 'error desconocido');
                        }
                    } catch (backupErr) {
                        scheduleBackupRetry(data.id);
                        console.error('[AutoBackup] Backup falló, se reintentará:', backupErr);
                    }
                }
            } catch (err) {
                console.error('[AutoBackup] Error al procesar solicitud pendiente:', err);
            } finally {
                if (runningTimeoutRef.current) clearTimeout(runningTimeoutRef.current);
                isRunningRef.current = false;
            }
        };

        // Realtime es el camino primario. El polling visible cada 5 min es fail-safe;
        // al volver de background o recuperar conexión se reconcilia inmediatamente.
        const stopBackupRequestPolling = startBackupRequestPolling(checkPendingRequests);

        // Suscribirse al canal en tiempo real de forma anónima
        channel = supabaseCloud
            .channel(`backup_request_${deviceId}`)
            .on('postgres_changes', {
                event: '*',
                schema: 'public',
                table: 'backup_requests',
                filter: `device_id=eq.${deviceId}`
            }, async (payload) => {
                if (payload.new?.status === 'pending') {
                    console.log('[AutoBackup] Solicitud de backup recibida en tiempo real. Ejecutando...');
                    await checkPendingRequests(); // Usar checkPendingRequests para pasar por los semáforos
                }
            })
            .subscribe();

        return () => {
            stopBackupRequestPolling();
            if (runningTimeoutRef.current) {
                clearTimeout(runningTimeoutRef.current);
                runningTimeoutRef.current = null;
            }
            isRunningRef.current = false;
            if (channel) {
                supabaseCloud.removeChannel(channel).catch(() => {});
            }
        };
    }, [deviceId]);
}

// Restaurar desde backup local (para emergencias).
// BACKUP-006: ahora valida el backup, corre dentro de runWithoutEco (anti-eco
// hacia la nube) y activa `pda_backup_imported_flag` para que useCloudSync
// re-sincronice los datos críticos tras recargar.
export async function restoreFromBackup() {
    const backup = await storageService.getItem('bodega_autobackup_v1', null);
    if (!backup?.data) return null;

    validateBackupJson(backup);
    const applied = await applyBackupToStorage(backup, { writeMode: 'storageService' });
    localStorage.setItem('pda_backup_imported_flag', 'true');

    return {
        restoredKeys: [...applied.idbKeys, ...applied.lsKeys],
        backupTime: new Date(backup.timestamp).toLocaleString('es-VE'),
    };
}
