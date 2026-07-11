import { useEffect, useRef } from 'react';
import localforage from 'localforage';
import { supabaseCloud } from '../config/supabaseCloud';
import { useAuthStore } from './store/useAuthStore';

const SYNC_KEYS = [
    'bodega_products_v1',
    'bodega_customers_v1',
    'bodega_sales_v1',
    'bodega_payment_methods_v1',
    'monitor_rates_v12',
    'bodega_accounts_v2',
    'abasto_audit_log_v1',
    'bodega_custom_rate',
    'bodega_use_auto_rate',
    'bodega_rate_mode',
    'tasa_cop',
    'cop_enabled',
    'auto_cop_enabled'
];

// SEC-002: `abasto-auth-storage` (hashes de PIN) YA NO se sincroniza a sync_documents.
// Las políticas RLS de `sync_documents` en el schema original permiten lectura global
// (ver SEC-002/INFRA-002 — fix del SQL corresponde a Agente D). Aunque se arregle la
// RLS, los hashes de PIN no deben viajar por una tabla compartida entre dispositivos.
const LOCAL_KEYS = [
    'bodega_custom_rate',
    'bodega_use_auto_rate',
    'bodega_rate_mode',
    'tasa_cop',
    'cop_enabled',
    'auto_cop_enabled'
];

/** Hash ligero para detectar cambios sin comparar objetos enteros (mismo patrón que useAutoBackup.js) */
function quickHash(value) {
    const str = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
    let h = 0;
    for (let i = 0; i < Math.min(str.length, 5000); i++) {
        h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return `${str.length}_${h >>> 0}`;
}

const LAST_PUSH_HASH_PREFIX = 'bodega_last_periodic_push_hash_';

// ─── Estado Global del Motor ───────────────────────────────────────────────
let globalSubscription = null;
let isSyncingFromCloud = false; // true mientras aplicamos cambios de la nube → evita eco
let pendingPush = {};           // Debounce: { [key]: timeoutId }
let _currentDeviceId = '';      // Device ID activo para pushCloudSync
let isCloudSyncActive = false;   // Evita empujar a la nube si el dispositivo no está autenticado/emparejado

// SEC-009 / HOOK-011: ELIMINADO el monkeypatch global de `localStorage.setItem`.
// Antes se reemplazaba `localStorage.setItem` a nivel módulo, interceptando TODAS
// las escrituras (incluyendo extensiones y devtools) y empujando a sync_documents.
// Eso causaba:
//   1. Recursión si el módulo se importa dos veces (HMR, tests).
//   2. Filtrado de hashes de PIN a una tabla pública (SEC-002).
//
// Ahora, los puntos de escritura explícitos llaman a `storageService.setItem` (que
// invoca `pushCloudSync` internamente). Para localStorage writes directos, los
// callers deben usar `pushLocalSync(key, value)` explícitamente.
//
// Mantenemos `originalSetItem` como referencia interna solo para aplicar cambios
// venidos de la nube sin disparar re-eco.

const originalSetItem = localStorage.setItem.bind(localStorage);

// Keys pesadas (arrays grandes con imágenes) usan debounce más largo para agrupar ediciones
const HEAVY_KEYS = ['bodega_products_v1', 'bodega_sales_v1', 'bodega_customers_v1', 'abasto_audit_log_v1'];
const DEBOUNCE_LIGHT_MS = 300;
const DEBOUNCE_HEAVY_MS = 3000;

function _debouncePush(key, value) {
    if (pendingPush[key]) clearTimeout(pendingPush[key]);
    const delay = HEAVY_KEYS.includes(key) ? DEBOUNCE_HEAVY_MS : DEBOUNCE_LIGHT_MS;
    pendingPush[key] = setTimeout(() => {
        delete pendingPush[key];
        pushCloudSync(key, value).catch(() => {});
    }, delay);
}

export const pushCloudSync = async (key, value) => {
    if (!supabaseCloud) return;
    if (isSyncingFromCloud) return;          // Nunca re-emitir lo que llegó de la nube
    if (!isCloudSyncActive) return;          // Omitir si la sesión cloud no está activa
    if (!SYNC_KEYS.includes(key)) return;
    if (!_currentDeviceId) return;

    // SEC-002: jamás empujar `abasto-auth-storage` aunque accidentalmente lo pidan.
    if (key === 'abasto-auth-storage') return;

    try {
        const collectionType = LOCAL_KEYS.includes(key) ? 'local' : 'store';

        await supabaseCloud.from('sync_documents').upsert({
            device_id: _currentDeviceId,
            collection: collectionType,
            doc_id: key,
            data: { payload: value },
            updated_at: new Date().toISOString()
        }, { onConflict: 'device_id,collection,doc_id' });

        // Update local hash to prevent periodic push from re-uploading
        const hashKey = LAST_PUSH_HASH_PREFIX + key;
        localStorage.setItem(hashKey, quickHash(value));

    } catch (e) {
        // Silencioso en producción
    }
};

/**
 * SEC-009 / HOOK-011: Reemplazo EXPLÍCITO del antiguo monkeypatch.
 *
 * Los callers que escriban directamente en localStorage con una clave en LOCAL_KEYS
 * deben invocar esta función (o usar `storageService.setItem`) para que el cambio
 * se propague a la nube. Ya NO se intercepta automáticamente `localStorage.setItem`.
 *
 * @param {string} key
 * @param {any} value
 */
export const pushLocalSync = (key, value) => {
    if (!LOCAL_KEYS.includes(key) && !SYNC_KEYS.includes(key)) return;
    if (key === 'abasto-auth-storage') return; // SEC-002
    _debouncePush(key, value);
};

/**
 * Aplica un documento recibido de la nube al almacenamiento local.
 * Garantiza que isSyncingFromCloud esté activo durante toda la operación.
 */
async function _applyFromCloud(docId, collection, payload) {
    isSyncingFromCloud = true;
    try {
        if (collection === 'local') {
            // Ignorar payload nulo/undefined para no escribir "undefined" en localStorage
            if (payload == null) return;
            // SEC-002: nunca aplicar `abasto-auth-storage` desde la nube.
            if (docId === 'abasto-auth-storage') return;
            const stringPayload = typeof payload === 'string' ? payload : JSON.stringify(payload);
            originalSetItem(docId, stringPayload);   // Escribe sin pasar por interceptor (no existe ya)
            window.dispatchEvent(new StorageEvent('storage', {
                key: docId,
                newValue: stringPayload,
                storageArea: localStorage
            }));
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: docId } }));
        } else {
            // Colección 'store' → IndexedDB directo, sin pasar por storageService.setItem
            const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
            await lf.setItem(docId, payload);

            // Notificar a los componentes React que lean este store
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: docId } }));
        }

        // Update local hash to prevent periodic push from re-uploading what we just downloaded
        const hashKey = LAST_PUSH_HASH_PREFIX + docId;
        localStorage.setItem(hashKey, quickHash(payload));
    } finally {
        isSyncingFromCloud = false;
    }
}

// ─── Hook de React ─────────────────────────────────────────────────────────
export function useCloudSync(deviceId) {
    const isInitialized = useRef(false);

    useEffect(() => {
        if (!supabaseCloud || !deviceId) {
            isCloudSyncActive = false;
            if (globalSubscription) {
                try { supabaseCloud.removeChannel(globalSubscription).catch(() => {}); } catch { }
                globalSubscription = null;
                isInitialized.current = false;
                _currentDeviceId = '';
            }
            return;
        }

        // Si el deviceId cambió con respecto al inicializado, forzar reinicio y cleanup de suscripción
        if (isInitialized.current && _currentDeviceId !== deviceId) {
            if (globalSubscription) {
                try { supabaseCloud.removeChannel(globalSubscription).catch(() => {}); } catch { }
                globalSubscription = null;
            }
            isInitialized.current = false;
        }

        if (isInitialized.current) return;

        _currentDeviceId = deviceId;

        const initSync = async () => {
            try {
                let hasAuth = false;
                try {
                    const { data: { session } } = await supabaseCloud.auth.getSession();
                    hasAuth = session && !(session.expires_at && session.expires_at * 1000 < Date.now());
                } catch (e) {}

                if (!hasAuth) {
                    // Si no hay sesión, verificamos si está emparejado para permitir sync sin login
                    const { data: pairing, error: pairingErr } = await supabaseCloud
                        .from('device_pairings')
                        .select('id')
                        .eq('primary_device_id', deviceId)
                        .maybeSingle();

                    if (pairingErr || !pairing) {
                        isCloudSyncActive = false;
                        console.log('[CloudSync] Omitiendo sincronización: sin sesión cloud ni emparejamiento activo.');
                        return;
                    }
                }

                isCloudSyncActive = true;
                isInitialized.current = true;

                // ── Pull Inicial / Sincronización de Importación ──
                const backupImported = localStorage.getItem('pda_backup_imported_flag') === 'true';
                
                if (backupImported) {
                    console.log('[CloudSync] Detectado backup importado localmente. Subiendo datos locales a la nube...');
                    const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
                    const criticalKeys = ['bodega_sales_v1', 'bodega_products_v1', 'bodega_customers_v1', 'bodega_accounts_v2'];
                    for (const key of criticalKeys) {
                        const localValue = await lf.getItem(key);
                        if (localValue !== null) {
                            await pushCloudSync(key, localValue);
                            const hashKey = LAST_PUSH_HASH_PREFIX + key;
                            localStorage.setItem(hashKey, quickHash(localValue));
                        }
                    }
                    localStorage.removeItem('pda_backup_imported_flag');
                    console.log('[CloudSync] Sincronización de importación completada.');
                } else {
                    const { data: docs } = await supabaseCloud
                        .from('sync_documents')
                        .select('collection, doc_id, data')
                        .eq('device_id', deviceId)
                        .in('collection', ['store', 'local']);

                    if (docs?.length > 0) {
                        for (const doc of docs) {
                            // SEC-002: nunca aplicar `abasto-auth-storage` desde la nube.
                            if (doc.doc_id === 'abasto-auth-storage') continue;
                            try {
                                await _applyFromCloud(doc.doc_id, doc.collection, doc.data.payload);
                            } catch (e) {
                                // HOOK-023: try/catch por documento para no abortar el pull completo.
                                console.warn(`[CloudSync] Error aplicando doc ${doc.doc_id}:`, e);
                            }
                        }
                        console.log(`[CloudSync] Pull inicial: ${docs.length} documentos aplicados.`);
                    }
                }

                // ── Auto-recuperación: Purgar/subir datos locales que no llegaron a enviarse debido al bug anterior ──
                // Solo si cambiaron desde el último push (mismo hash-guard que forcePushLocalData,
                // para no re-subir todo en cada arranque/reconexión sin necesidad).
                try {
                    const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
                    const criticalKeys = ['bodega_sales_v1', 'bodega_products_v1', 'bodega_customers_v1', 'bodega_accounts_v2'];
                    for (const key of criticalKeys) {
                        const localValue = await lf.getItem(key);
                        if (!localValue) continue;

                        const hashKey = LAST_PUSH_HASH_PREFIX + key;
                        const currentHash = quickHash(localValue);
                        if (localStorage.getItem(hashKey) === currentHash) continue;

                        // Subimos los datos locales a la base de datos para sincronizar el historial
                        await pushCloudSync(key, localValue);
                        localStorage.setItem(hashKey, currentHash);
                    }
                } catch (e) {
                    // Silencioso
                }

                // ── Suscripción WebSocket Realtime ─────────────────────────
                if (!globalSubscription) {
                    globalSubscription = supabaseCloud
                        .channel(`sync:${deviceId}`)
                        .on('postgres_changes', {
                            event: '*',
                            schema: 'public',
                            table: 'sync_documents',
                            filter: `device_id=eq.${deviceId}`
                        }, async (payload) => {
                            const doc = payload.new;
                            if (!doc || !['store', 'local'].includes(doc.collection)) return;
                            // SEC-002: nunca aplicar auth-storage desde realtime.
                            if (doc.doc_id === 'abasto-auth-storage') return;
                            console.log(`[CloudSync] Recibido: ${doc.doc_id}`);
                            await _applyFromCloud(doc.doc_id, doc.collection, doc.data.payload);
                        })
                        .subscribe((status) => {
                            if (status === 'SUBSCRIBED') {
                                console.log('[CloudSync] Conectado y escuchando en Tiempo Real');
                            }
                        });
                }

            } catch (err) {
                console.error('[CloudSync] Fallo en inicialización:', err);
                isInitialized.current = false;
            }
        };

        initSync();

        // ── MECANISMOS DE SINCRONIZACIÓN AUTOMÁTICA Y CONTINUA ──
        
        // 1. Escuchar actualizaciones de almacenamiento locales para subirlas al instante
        const handleAppStorageUpdate = async (e) => {
            if (isSyncingFromCloud) return;
            const key = e.detail?.key;
            if (!key || !SYNC_KEYS.includes(key)) return;

            try {
                const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
                const localValue = await lf.getItem(key);
                if (localValue !== null) {
                    await pushCloudSync(key, localValue);
                }
            } catch (err) {
                // Silencioso
            }
        };

        // 2. Escuchar evento 'online' y temporizador periódico para sincronizar datos locales pendientes
        // HOOK: solo re-sube una key si cambió desde el último push (evita gastar cuota de
        // Supabase/Realtime subiendo el mismo dato sin cambios cada 20s — ver quickHash arriba).
        const forcePushLocalData = async () => {
            if (isSyncingFromCloud || !deviceId) return;
            try {
                const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
                const criticalKeys = ['bodega_sales_v1', 'bodega_products_v1', 'bodega_customers_v1', 'bodega_accounts_v2'];
                for (const key of criticalKeys) {
                    const localValue = await lf.getItem(key);
                    if (!localValue) continue;

                    const hashKey = LAST_PUSH_HASH_PREFIX + key;
                    const currentHash = quickHash(localValue);
                    if (localStorage.getItem(hashKey) === currentHash) continue;

                    await pushCloudSync(key, localValue);
                    localStorage.setItem(hashKey, currentHash);
                }
            } catch (e) {
                // Silencioso
            }
        };

        window.addEventListener('app_storage_update', handleAppStorageUpdate);
        window.addEventListener('online', forcePushLocalData);
        
        // Ejecución periódica cada 20 segundos para asegurar sincronización en tiempo real
        const intervalId = setInterval(forcePushLocalData, 20000);

        return () => {
            isCloudSyncActive = false;
            window.removeEventListener('app_storage_update', handleAppStorageUpdate);
            window.removeEventListener('online', forcePushLocalData);
            clearInterval(intervalId);

            // HOOK-012: limpiar suscripción en cleanup para evitar leaks.
            if (globalSubscription) {
                try { supabaseCloud.removeChannel(globalSubscription).catch(() => {}); } catch { }
                globalSubscription = null;
                isInitialized.current = false;
                _currentDeviceId = '';
            }
        };
    }, [deviceId]);
}
