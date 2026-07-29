import { useEffect, useRef, useCallback } from 'react';
import { storageService } from '../utils/storageService';
import { supabaseCloud } from '../config/supabaseCloud';
import { IDB_KEYS, LS_KEYS } from '../config/backupKeys';
import { compressString, isCompressionSupported } from '../utils/compression';
import { uploadToGoogleDrive } from '../utils/driveBackupUploader';


// ─── Configuración optimizada ───────────────────────────────────────────────
const BACKUP_INTERVAL_MS = 30 * 60 * 1000; // 30 minutos
const BACKUP_KEY = 'bodega_autobackup_v1';
const LAST_UPLOAD_HASH_KEY = 'bodega_last_upload_hash';

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

                if (!hasData && !forceUpload) return;

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
                const hasCloudPairing = localStorage.getItem('pda_cloud_session') || localStorage.getItem('pda_paired_device') || premium;
                const isLocalhost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');

                // En entorno local (localhost) sin sesión de nube activa, omitir llamadas remotas para mantener la consola de desarrollo limpia
                if (isLocalhost && !hasCloudPairing && !forceUpload) return;

                if (devId && supabaseCloud && (hasCloudPairing || forceUpload)) {
                    const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
                    const lastDailyBackup = localStorage.getItem('bodega_last_daily_backup_date');

                    // Si no es premium y ya respaldó hoy, omitir para evitar peticiones redundantes
                    if (!premium && lastDailyBackup === todayStr && !forceUpload) return;

                    const currentHash = quickHash(idbData);
                    const lastHash = localStorage.getItem(LAST_UPLOAD_HASH_KEY);

                    // forceUpload=true omite la verificación de hash (solicitud manual)
                    if (!forceUpload && currentHash === lastHash) return;

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

                    // Resumen calculado una sola vez aquí para que Estación Maestra pueda
                    // listar backups sin tener que descargar/descomprimir `backup_data`.
                    const productCount = Array.isArray(idbData.bodega_products_v1) ? idbData.bodega_products_v1.length : 0;
                    const salesCount = Array.isArray(idbData.bodega_sales_v1) ? idbData.bodega_sales_v1.length : 0;
                    const customerCount = Array.isArray(idbData.bodega_customers_v1) ? idbData.bodega_customers_v1.length : 0;
                    const sizeBytes = JSON.stringify(payloadToUpload).length;

                    const clientName = localStorage.getItem('business_name') || 'Mi Negocio';
                    let driveResult = null;
                    try {
                        driveResult = await uploadToGoogleDrive(payloadToUpload, devId, clientName);
                    } catch (driveErr) {
                        console.error('[AutoBackup] Error al subir a Google Drive:', driveErr);
                    }

                    // Guardar metadatos a través de la API de La Estación Maestra (Service Key en Server Side)
                    const metadataPayload = {
                        drive_url: driveResult?.downloadUrl || null,
                        size_bytes: driveResult?.sizeBytes || sizeBytes,
                        product_count: productCount,
                        sales_count: salesCount,
                        customer_count: customerCount,
                        updated_at: new Date().toISOString()
                    };

                    // Notificar metadatos a la API de Estación Maestra o Supabase
                    const ESTACION_API = import.meta.env.VITE_ESTACION_API_URL || 'https://estacion-2026.vercel.app';
                    let apiSuccess = false;
                    try {
                        const res = await fetch(`${ESTACION_API}/api/backup/complete`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                                deviceId: devId,
                                driveUrl: metadataPayload.drive_url,
                                sizeBytes: metadataPayload.size_bytes,
                                productCount: metadataPayload.product_count,
                                salesCount: metadataPayload.sales_count,
                                customerCount: metadataPayload.customer_count
                            })
                        });
                        if (res.ok) apiSuccess = true;
                    } catch (apiErr) {
                        apiSuccess = false;
                    }

                    // Fallback directo a Supabase en cloud_backups (con manejo de 401/RLS)
                    if (!apiSuccess && supabaseCloud) {
                        try {
                            const { error: supErr } = await supabaseCloud.from('cloud_backups').upsert({
                                device_id: devId,
                                backup_data: metadataPayload,
                                updated_at: new Date().toISOString()
                            }, { onConflict: 'device_id' });
                            if (supErr && import.meta.env?.DEV) {
                                // Silencioso si no hay permisos de anon en RLS
                            }
                        } catch (sErr) {
                            // Omitir silenciosamente errores de autorización 401
                        }
                    }

                    localStorage.setItem(LAST_UPLOAD_HASH_KEY, currentHash);
                    localStorage.setItem('bodega_last_daily_backup_date', todayStr);
                }

            } catch (e) {
                console.error('[AutoBackup] Error:', e);
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
        // Garantizar que cualquier dispositivo con deviceId activo escuche solicitudes remotas de la Estación Maestra
        if (!deviceId || !supabaseCloud) return;

        let channel = null;

        const checkPendingRequests = async () => {
            try {
                const { data } = await supabaseCloud
                    .from('backup_requests')
                    .select('status')
                    .eq('device_id', deviceId)
                    .eq('status', 'pending')
                    .maybeSingle();

                if (data) {
                    console.log('[AutoBackup] Solicitud de backup pendiente detectada. Ejecutando...');
                    await performBackupRef.current?.(true);
                    await supabaseCloud.from('backup_requests').update({
                        status: 'completed',
                        completed_at: new Date().toISOString()
                    }).eq('device_id', deviceId);
                    console.log('[AutoBackup] Backup pendiente procesado exitosamente.');
                }
            } catch (err) {
                console.error('[AutoBackup] Error al procesar solicitud pendiente:', err);
            }
        };

        // Comprobar solicitudes pendientes al conectar y cada 60s (Fail-safe contra pérdida de WebSocket)
        checkPendingRequests();
        const pendingPollInterval = setInterval(checkPendingRequests, 60000);

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
                    await performBackupRef.current?.(true); // forzar subida
                }
            })
            .subscribe();

        return () => {
            clearInterval(pendingPollInterval);
            if (channel) {
                supabaseCloud.removeChannel(channel).catch(() => {});
            }
        };
    }, [deviceId]);
}

// Restaurar desde backup local (para emergencias)
export async function restoreFromBackup() {
    const backup = await storageService.getItem('bodega_autobackup_v1', null);
    if (!backup?.data) return null;

    if (backup.version === '2.0' && backup.data.idb) {
        for (const [key, val] of Object.entries(backup.data.idb)) {
            await storageService.setItem(key, val);
        }
        if (backup.data.ls) {
            for (const [key, val] of Object.entries(backup.data.ls)) {
                localStorage.setItem(key, val);
            }
        }
        return {
            restoredKeys: [...Object.keys(backup.data.idb), ...Object.keys(backup.data.ls)],
            backupTime: new Date(backup.timestamp).toLocaleString('es-VE'),
        };
    }

    // Fallback formato legacy
    for (const [key, val] of Object.entries(backup.data)) {
        await storageService.setItem(key, val);
    }
    return {
        restoredKeys: Object.keys(backup.data),
        backupTime: new Date(backup.timestamp).toLocaleString('es-VE'),
    };
}
