import { useEffect, useRef, useState } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { runWithoutEco } from '../utils/syncFlags';
import localforage from 'localforage';
import { SUPERVISOR_SYNC_KEYS, validateSupervisorSyncDocument } from '../services/supervisorContracts';
import { ensureSupervisorSession } from '../services/supervisorAuth';
import {
    getSyncMetadataKey,
    isNewerSyncDocument,
    readSyncEnvelope,
    buildSupervisorRealtimeChannelName,
    getSupervisorRecoveryIntervalMs,
    shouldRunSupervisorRecovery,
    MONITOR_CONNECTED_SWEEP_INTERVAL_MS,
    getMonitorReconnectDelayMs,
    shouldRunMonitorConnectedSweep,
    getChangedSyncDocumentIds,
    shouldPullFullSync,
    MONITOR_FULL_SYNC_AT_KEY,
    isOversizeRealtimePayload,
    createSyncDiagnosticsState,
    updateSyncDiagnostics,
    SUPERVISOR_SYNC_STATES,
} from '../services/supervisorSyncService';
import { clearMonitorCache } from '../services/monitorUnpair';
// Fase 4: los docs por periodo de `bodega_sales_v1` se mergean en la clave
// local única; la familia no está en la allowlist de claves y se lee por prefijo.
import {
    PRODUCTS_SYNC_BASE_KEY,
    SALES_SYNC_BASE_KEY,
    applyProductsDocToBaseline,
    deriveProductsFromBaseline,
    isProductsSyncDocId,
    isSalesSyncDocId,
    mergeSalesSyncDoc,
} from './useCloudSync';

// Plan de stock delta: el catálogo del monitor es una VISTA derivada — el
// baseline del último doc de productos (con su `stockAsOf`) más los efectos de
// la familia de ventas que el baseline todavía no incluye.
const PRODUCTS_KEY = 'bodega_products_v1';
const PRODUCTS_STOCK_BASELINE_KEY = 'pda_products_stock_baseline_v1';

async function rederiveProductsFromBaseline(mergedSales) {
    try {
        const baseline = await localforage.getItem(PRODUCTS_STOCK_BASELINE_KEY);
        if (!baseline || !Array.isArray(baseline.products)) return;
        // Fase 5: el baseline es por franjas (cada bucket con SU stockAsOf) y
        // cada producto pliega los efectos posteriores al cutoff de su franja.
        const derived = deriveProductsFromBaseline(baseline, mergedSales);
        await localforage.setItem(PRODUCTS_KEY, derived);
        window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: PRODUCTS_KEY, source: 'remote' } }));
    } catch (error) {
        // Best-effort: la derivación nunca rompe la aplicación del doc de ventas.
        console.warn('[MonitorSync] No se pudo re-derivar el stock del catálogo', error?.message || error);
    }
}
import { isMonitorPairingActive, readPairingRow } from '../services/supervisorPairingState';

localforage.config({ name: 'BodegaApp', storeName: 'bodega_app_data' });

const SUBSCRIBE_TIMEOUT_MS = 8000;
// Fase 2 (egress): los delays del reconnect ya no son la tabla fija
// [1s, 3s, 10s, 30s]; el backoff exponencial con jitter vive en
// getMonitorReconnectDelayMs (supervisorSyncService).
// Un solo pull de respaldo cubre una ráfaga de eventos 413 (la caja empuja
// productos y ventas juntos) sin montar una tormenta de selects.
const OVERSIZE_PULL_THROTTLE_MS = 3000;

// Marca del último pull completo (la política vive en shouldPullFullSync).
const readLastFullSyncAt = () => {
    const raw = localStorage.getItem(MONITOR_FULL_SYNC_AT_KEY);
    if (!raw) return null;
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? null : parsed;
};

const markFullSyncAt = (date) => {
    localStorage.setItem(MONITOR_FULL_SYNC_AT_KEY, date.toISOString());
};

export function useMonitorSync(pairedDeviceId) {
    const [isConnected, setIsConnected] = useState(false);
    const [lastSync, setLastSync] = useState(() => {
        const stored = localStorage.getItem('monitor_last_sync');
        if (!stored) return null;
        const parsed = new Date(stored);
        return Number.isNaN(parsed.getTime()) ? null : parsed;
    });
    const [loading, setLoading] = useState(true);
    const [syncState, setSyncState] = useState(SUPERVISOR_SYNC_STATES.IDLE);
    const [syncError, setSyncError] = useState(null);
    const [syncDiagnostics, setSyncDiagnostics] = useState(createSyncDiagnosticsState);
    const subscriptionRef = useRef(null);
    const disposedRef = useRef(false);
    const syncSuspendedRef = useRef(false);
    const pendingApplicationsRef = useRef(new Set());
    const initInFlightRef = useRef(null);
    const reconnectTimerRef = useRef(null);
    const reconnectAttemptRef = useRef(0);
    const lastSyncRef = useRef(lastSync);
    const lifecycleRef = useRef(0);
    const subscribeInFlightRef = useRef(null);
    const removeInFlightRef = useRef(Promise.resolve());
    const recoveryTimerRef = useRef(null);
    const sweepTimerRef = useRef(null);
    const recoveryPullInFlightRef = useRef(null);
    const lastRecoveryAtRef = useRef(0);
    const documentQueuesRef = useRef(new Map());
    const remoteRevocationHandledRef = useRef(false);
    const oversizePullTimerRef = useRef(null);
    const pullDocumentsRef = useRef(null);

    const updateLastSync = (value) => {
        lastSyncRef.current = value;
        setLastSync(value);
        if (value) localStorage.setItem('monitor_last_sync', value.toISOString());
    };

    // Telemetría para el panel de diagnóstico: último eco recibido (con su
    // watermark) y eventos 413 con sus pulls de respaldo. Solo acumula estado
    // visible; nunca cambia el flujo de sincronización.
    const recordDiagnostics = (event) => {
        setSyncDiagnostics((prev) => updateSyncDiagnostics(prev, event));
    };

    const isActiveLifecycle = (lifecycleId) => (
        !disposedRef.current && !syncSuspendedRef.current && lifecycleRef.current === lifecycleId
    );

    const removeChannel = async (channel) => {
        if (!channel) return;
        if (subscriptionRef.current === channel) subscriptionRef.current = null;

        const removal = supabaseCloud.removeChannel(channel).catch(() => {});
        removeInFlightRef.current = removal;
        await removal;
        if (removeInFlightRef.current === removal) removeInFlightRef.current = Promise.resolve();
    };

    const clearSubscription = async () => removeChannel(subscriptionRef.current);

    const scheduleReconnect = (lifecycleId = lifecycleRef.current) => {
        if (!isActiveLifecycle(lifecycleId) || !pairedDeviceId || reconnectTimerRef.current) return;
        const delay = getMonitorReconnectDelayMs(reconnectAttemptRef.current);
        reconnectAttemptRef.current += 1;
        reconnectTimerRef.current = setTimeout(() => {
            reconnectTimerRef.current = null;
            if (isActiveLifecycle(lifecycleId)) initMonitor(lifecycleId);
        }, delay);
    };

    const applyDocToLocal = async (doc, lifecycleId = lifecycleRef.current) => {
        if (!isActiveLifecycle(lifecycleId)) {
            return { applied: false, rejected: true, stale: true, error: 'La sincronización del monitor está detenida' };
        }
        const docId = doc?.doc_id;
        const collection = doc?.collection;
        const envelope = readSyncEnvelope(doc?.data);

        if (!envelope.valid) {
            return { applied: false, rejected: true, error: envelope.error };
        }

        // Fase 4/5: los docs de las familias de ventas y productos se validan
        // como su clave base (el contrato conoce `bodega_sales_v1` /
        // `bodega_products_v1`, no los periodos ni los buckets).
        const isSalesFamily = isSalesSyncDocId(docId);
        const isProductsFamily = isProductsSyncDocId(docId);
        const contractKey = isSalesFamily ? SALES_SYNC_BASE_KEY
            : isProductsFamily ? PRODUCTS_SYNC_BASE_KEY : docId;
        const validation = validateSupervisorSyncDocument(contractKey, envelope.payload);
        if (!validation.valid) {
            return { applied: false, rejected: true, error: validation.error };
        }

        if (!['store', 'local'].includes(collection)) {
            return { applied: false, rejected: true, error: `Colección remota rechazada: ${collection}` };
        }

        const incomingUpdatedAt = envelope.updatedAt || doc?.updated_at || null;
        const metadataKey = getSyncMetadataKey(docId);
        const previousUpdatedAt = localStorage.getItem(metadataKey);
        if (!isNewerSyncDocument(incomingUpdatedAt, previousUpdatedAt)) {
            return { applied: false, rejected: true, stale: true, error: 'Documento antiguo o repetido' };
        }

        if (!isActiveLifecycle(lifecycleId)) {
            return { applied: false, rejected: true, stale: true, error: 'La sincronización del monitor está detenida' };
        }

        await runWithoutEco(async () => {
            if (!isActiveLifecycle(lifecycleId)) return;
            if (collection === 'local') {
                const stringPayload = typeof envelope.payload === 'string'
                    ? envelope.payload
                    : JSON.stringify(envelope.payload);
                localStorage.setItem(docId, stringPayload);
                window.dispatchEvent(new StorageEvent('storage', {
                    key: docId,
                    newValue: stringPayload,
                    storageArea: localStorage,
                }));
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: docId, source: 'remote' } }));
            } else {
                let writeKey = docId;
                if (isSalesFamily) {
                    // Fase 4: merge en el lector — los periodos (y el legacy)
                    // se fusionan en la clave local única que leen las vistas.
                    writeKey = SALES_SYNC_BASE_KEY;
                    const localSales = await localforage.getItem(SALES_SYNC_BASE_KEY);
                    const mergedSales = mergeSalesSyncDoc(localSales, docId, envelope.payload);
                    await localforage.setItem(writeKey, mergedSales);
                    // Plan de stock delta: los efectos de stock viajan en la venta;
                    // el stock del catálogo se re-deriva desde el baseline guardado.
                    await rederiveProductsFromBaseline(mergedSales);
                } else if (isProductsFamily) {
                    // Fase 5: el payload del doc es el baseline de SU franja (su
                    // `stock` ya incluye los efectos con at <= stockAsOf) y el
                    // baseline se guarda por franjas; la vista derivada pliega
                    // los efectos posteriores por franja. El bucket es la
                    // autoridad de SU franja (reemplazo; `[]` = franja vacía) y
                    // el legacy congelado no resucita sus ids.
                    writeKey = PRODUCTS_KEY;
                    const localSales = await localforage.getItem(SALES_SYNC_BASE_KEY);
                    const baseline = applyProductsDocToBaseline(
                        await localforage.getItem(PRODUCTS_STOCK_BASELINE_KEY),
                        docId,
                        envelope.payload,
                        { stockAsOf: envelope.stockAsOf ?? null },
                    );
                    await localforage.setItem(PRODUCTS_STOCK_BASELINE_KEY, baseline);
                    await localforage.setItem(writeKey, deriveProductsFromBaseline(baseline, localSales));
                } else {
                    await localforage.setItem(docId, envelope.payload);
                }
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: writeKey, source: 'remote' } }));
            }
        });

        if (incomingUpdatedAt) localStorage.setItem(metadataKey, incomingUpdatedAt);
        return { applied: true, rejected: false, updatedAt: incomingUpdatedAt };
    };

    const enqueueDocApplication = (doc, lifecycleId = lifecycleRef.current) => {
        const queueKey = String(doc?.doc_id || '__unknown__');
        const previous = documentQueuesRef.current.get(queueKey) || Promise.resolve();
        let next;
        next = previous
            .catch(() => {})
            .then(() => applyDocToLocal(doc, lifecycleId))
            .finally(() => {
                if (documentQueuesRef.current.get(queueKey) === next) {
                    documentQueuesRef.current.delete(queueKey);
                }
            });
        documentQueuesRef.current.set(queueKey, next);
        return next;
    };

    const applyBatch = async (docs, lifecycleId = lifecycleRef.current, { source = 'pull' } = {}) => {
        let applied = 0;
        let rejected = 0;
        for (const doc of docs || []) {
            if (!isActiveLifecycle(lifecycleId)) break;
            try {
                const result = await enqueueDocApplication(doc, lifecycleId);
                if (result.applied) applied += 1;
                if (result.rejected && !result.stale) rejected += 1;
                if (isActiveLifecycle(lifecycleId)) {
                    recordDiagnostics({
                        type: 'echo',
                        docId: doc?.doc_id ?? null,
                        updatedAt: result.updatedAt ?? doc?.updated_at ?? null,
                        receivedAt: new Date().toISOString(),
                        source,
                        applied: Boolean(result.applied),
                        error: result.error || null,
                    });
                }
            } catch (error) {
                rejected += 1;
                console.warn('[MonitorSync] Error aplicando documento:', error?.message ?? error);
            }
        }
        return { applied, rejected };
    };

    const handleRemotePairingChange = async () => {
        if (!pairedDeviceId || remoteRevocationHandledRef.current) return;

        // Sin la identidad del monitor no podemos validar qué slot le pertenece.
        const monitorDeviceId = localStorage.getItem('pda_device_id');
        if (!monitorDeviceId) return;

        const { data, error } = await readPairingRow({
            supabase: supabaseCloud,
            primaryDeviceId: pairedDeviceId,
        });
        if (error || isMonitorPairingActive(data, monitorDeviceId)) return;

        remoteRevocationHandledRef.current = true;
        await stopMonitorSync();

        try {
            const monitorStore = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
            await clearMonitorCache({ idbStore: monitorStore, localStorage });
            window.dispatchEvent(new CustomEvent('supervisor_pairing_revoked', {
                detail: { deviceId: pairedDeviceId, source: 'remote_pairing_change' },
            }));
            setTimeout(() => window.location.reload(), 250);
        } catch (cleanupError) {
            remoteRevocationHandledRef.current = false;
            setSyncState(SUPERVISOR_SYNC_STATES.REVOKED);
            setSyncError(cleanupError?.message || 'El vínculo fue revocado; falta limpiar la copia local');
        }
    };

    const subscribeToRealtime = (lifecycleId = lifecycleRef.current) => {
        if (!isActiveLifecycle(lifecycleId)) return Promise.resolve({ ok: false, error: 'Ciclo de sincronización obsoleto' });
        if (subscriptionRef.current) return Promise.resolve({ ok: true, error: null });
        if (subscribeInFlightRef.current) return subscribeInFlightRef.current;

        const subscriptionPromise = (async () => {
            await removeInFlightRef.current;
            if (!isActiveLifecycle(lifecycleId)) return { ok: false, error: 'Ciclo de sincronización obsoleto' };

            return new Promise((resolve) => {
                let settled = false;
                let timeout;
                const finish = (result) => {
                    if (settled) return;
                    settled = true;
                    clearTimeout(timeout);
                    resolve(result);
                };

                timeout = setTimeout(() => {
                    void removeChannel(channel);
                    setIsConnected(false);
                    setSyncState(SUPERVISOR_SYNC_STATES.DEGRADED);
                    finish({ ok: false, error: 'Tiempo agotado al conectar Realtime' });
                    scheduleReconnect(lifecycleId);
                }, SUBSCRIBE_TIMEOUT_MS);

                const channel = supabaseCloud
                    .channel(buildSupervisorRealtimeChannelName(pairedDeviceId, lifecycleId))
                    .on('postgres_changes', {
                        event: '*',
                        schema: 'public',
                        table: 'sync_documents',
                        filter: `device_id=eq.${pairedDeviceId}`,
                    }, async (realtimePayload) => {
                        if (!isActiveLifecycle(lifecycleId)) return;

                        // DELETE no entrega `new`; los documentos no se borran en el flujo normal.
                        if (realtimePayload?.eventType === 'DELETE') return;

                        // Un evento sin cuerpo es el 413 de Realtime: el registro de
                        // `sync_documents` supera max_record_bytes (~1 MB, típico de
                        // `bodega_products_v1` con catálogos grandes) y llega vacío con
                        // `errors: ['Error 413: Payload Too Large']`. NUNCA se descarta en
                        // silencio: además el pull de recuperación no corre con el canal
                        // "conectado", así que el cambio se perdería para siempre. Se
                        // programa UN pull con throttle que trae el cambio por PostgREST.
                        if (isOversizeRealtimePayload(realtimePayload)) {
                            console.warn('[MonitorSync] Evento de Realtime sin cuerpo (posible 413). Programando pull de respaldo.', realtimePayload?.errors);
                            recordDiagnostics({ type: 'oversize_event', at: new Date().toISOString() });
                            if (!oversizePullTimerRef.current) {
                                oversizePullTimerRef.current = setTimeout(() => {
                                    oversizePullTimerRef.current = null;
                                    if (!isActiveLifecycle(lifecycleId)) return;
                                    recordDiagnostics({ type: 'oversize_pull', at: new Date().toISOString() });
                                    pullDocumentsRef.current?.(lifecycleId, { source: 'pull-413' }).catch((error) => {
                                        if (!isActiveLifecycle(lifecycleId)) return;
                                        setSyncState(SUPERVISOR_SYNC_STATES.DEGRADED);
                                        setSyncError(error?.message || 'No se pudo recuperar el cambio remoto');
                                        scheduleReconnect(lifecycleId);
                                    });
                                }, OVERSIZE_PULL_THROTTLE_MS);
                            }
                            return;
                        }

                        const application = enqueueDocApplication(realtimePayload.new, lifecycleId);
                        pendingApplicationsRef.current.add(application);
                        try {
                            const result = await application;
                            if (isActiveLifecycle(lifecycleId)) {
                                recordDiagnostics({
                                    type: 'echo',
                                    docId: realtimePayload.new?.doc_id ?? null,
                                    updatedAt: result.updatedAt ?? realtimePayload.new?.updated_at ?? null,
                                    receivedAt: new Date().toISOString(),
                                    source: 'realtime',
                                    applied: Boolean(result.applied),
                                    error: result.error || null,
                                });
                            }
                            if (result.applied && isActiveLifecycle(lifecycleId)) {
                                updateLastSync(new Date());
                                setSyncError(null);
                            }
                        } catch (error) {
                            if (!isActiveLifecycle(lifecycleId)) return;
                            setSyncError(error?.message || 'No se pudo aplicar la actualización remota');
                            setSyncState(SUPERVISOR_SYNC_STATES.DEGRADED);
                        } finally {
                            pendingApplicationsRef.current.delete(application);
                        }
                    })
                    .on('postgres_changes', {
                        event: '*',
                        schema: 'public',
                        table: 'device_pairings',
                        filter: `primary_device_id=eq.${pairedDeviceId}`,
                    }, () => {
                        void handleRemotePairingChange();
                    })
                    .subscribe((status) => {
                        if (!isActiveLifecycle(lifecycleId)) {
                            void removeChannel(channel);
                            finish({ ok: false, error: 'Ciclo de sincronización obsoleto' });
                            return;
                        }
                        if (status === 'SUBSCRIBED') {
                            reconnectAttemptRef.current = 0;
                            setIsConnected(true);
                            setSyncState(SUPERVISOR_SYNC_STATES.CONNECTED);
                            setSyncError(null);
                            finish({ ok: true, error: null });
                        } else if (status === 'CLOSED' || status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
                            void removeChannel(channel);
                            setIsConnected(false);
                            setSyncState(lastSyncRef.current ? SUPERVISOR_SYNC_STATES.DEGRADED : SUPERVISOR_SYNC_STATES.ERROR);
                            finish({ ok: false, error: `Canal Realtime: ${status}` });
                            scheduleReconnect(lifecycleId);
                        }
                    });

                subscriptionRef.current = channel;
            });
        })();

        subscribeInFlightRef.current = subscriptionPromise;
        return subscriptionPromise.finally(() => {
            if (subscribeInFlightRef.current === subscriptionPromise) subscribeInFlightRef.current = null;
        });
    };

    const pullDocuments = async (lifecycleId = lifecycleRef.current, { full = false, source = 'pull' } = {}) => {
        if (!isActiveLifecycle(lifecycleId)) return { ok: false, skipped: true, error: 'Ciclo de sincronización obsoleto' };
        if (recoveryPullInFlightRef.current) return recoveryPullInFlightRef.current;

        const pull = (async () => {
            const { session, error: sessionError } = await ensureSupervisorSession();
            if (sessionError || !session) throw sessionError || new Error('No hay sesión segura del monitor');
            if (!isActiveLifecycle(lifecycleId)) return { ok: false, skipped: true, error: 'Ciclo de sincronización obsoleto' };

            // Fase 4: primero solo metadatos y SIN filtro de doc_id en el
            // servidor: la familia `bodega_sales_v1:<periodo>` no cabe en la
            // allowlist de claves fijas. La selección de claves ocurre en el
            // lado cliente (allowlist + familia de ventas) y el payload pesado
            // se pide solo para esos ids: ningún documento fuera de contrato se
            // descarga (SEC-002).
            const { data: metadata, error: metadataError } = await supabaseCloud
                .from('sync_documents')
                .select('collection, doc_id, updated_at')
                .eq('device_id', pairedDeviceId)
                .in('collection', ['store', 'local']);
            if (metadataError) throw metadataError;

            const allowedDocs = (metadata || []).filter((doc) =>
                SUPERVISOR_SYNC_KEYS.includes(doc.doc_id)
                || isSalesSyncDocId(doc.doc_id)
                || isProductsSyncDocId(doc.doc_id));

            let targetDocIds;
            if (full) {
                targetDocIds = allowedDocs.map((doc) => doc.doc_id);
            } else {
                // El payload pesado se solicita únicamente para documentos
                // realmente modificados (watermark por documento).
                targetDocIds = getChangedSyncDocumentIds(
                    allowedDocs,
                    (docId) => localStorage.getItem(getSyncMetadataKey(docId)),
                );

                if (targetDocIds.length === 0) {
                    recordDiagnostics({
                        type: 'pull', at: new Date().toISOString(), source, docs: 0, bytes: 0, full,
                    });
                    return { ok: true, applied: 0, rejected: 0, skipped: true, reason: 'Sin cambios remotos' };
                }
            }

            let docs = [];
            if (targetDocIds.length > 0) {
                const { data, error } = await supabaseCloud
                    .from('sync_documents')
                    .select('collection, doc_id, data, updated_at')
                    .eq('device_id', pairedDeviceId)
                    .in('collection', ['store', 'local'])
                    .in('doc_id', targetDocIds);
                if (error) throw error;
                docs = data || [];
            }

            // Telemetría de egress: bytes del payload real bajado en este pull
            // (el panel los pinta: completo ~MB vs incremental ~0 B).
            const pulledBytes = docs.reduce((sum, doc) => {
                const raw = doc?.data == null ? '' : JSON.stringify(doc.data);
                return sum + raw.length;
            }, 0);
            recordDiagnostics({
                type: 'pull',
                at: new Date().toISOString(),
                source,
                docs: docs.length,
                bytes: pulledBytes,
                full,
            });

            const batch = await applyBatch(docs, lifecycleId, { source });
            if (!isActiveLifecycle(lifecycleId)) return { ok: false, skipped: true, error: 'Ciclo de sincronización obsoleto' };
            if (batch.applied > 0) updateLastSync(new Date());
            return { ok: true, ...batch };
        })();

        recoveryPullInFlightRef.current = pull;
        return pull.finally(() => {
            if (recoveryPullInFlightRef.current === pull) recoveryPullInFlightRef.current = null;
        });
    };

    // Para que el callback de Realtime (definido antes) pueda pedir el pull de
    // respaldo del 413 sin depender del orden de declaración.
    pullDocumentsRef.current = pullDocuments;

    const startRecoveryTimer = (lifecycleId) => {
        if (recoveryTimerRef.current || !isActiveLifecycle(lifecycleId)) return;
        recoveryTimerRef.current = setInterval(() => {
            if (!isActiveLifecycle(lifecycleId)) return;

            // Mientras Realtime está conectado, cada pull sería una copia
            // completa innecesaria del inventario/ventas del dispositivo.
            if (!shouldRunSupervisorRecovery({
                realtimeConnected: Boolean(subscriptionRef.current),
                recoveryInFlight: Boolean(recoveryPullInFlightRef.current),
                lastRecoveryAt: lastRecoveryAtRef.current,
            })) return;

            lastRecoveryAtRef.current = Date.now();
            void handleRemotePairingChange();
            pullDocuments(lifecycleId)
                .then((result) => {
                    if (!result?.ok || !isActiveLifecycle(lifecycleId)) return;
                    setSyncError(null);
                    if (subscriptionRef.current) setSyncState(SUPERVISOR_SYNC_STATES.CONNECTED);
                })
                .catch((error) => {
                    if (!isActiveLifecycle(lifecycleId)) return;
                    setSyncState(SUPERVISOR_SYNC_STATES.DEGRADED);
                    setSyncError(error?.message || 'No se pudo recuperar la sincronización');
                    scheduleReconnect(lifecycleId);
                });
        }, getSupervisorRecoveryIntervalMs());
    };

    const stopRecoveryTimer = () => {
        if (recoveryTimerRef.current) clearInterval(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
    };

    // ── Barrido de respaldo con Realtime "conectado" ──────────────────────────
    // Hueco simétrico al del receptor de la caja: un canal que dice SUBSCRIBED
    // pero no entrega eventos dejaba el eco de la caja aplicándose solo al
    // recargar el Supervisor. El barrido corre el pull incremental (metadatos
    // primero; payload solo de lo cambiado), así que con el eco al día cuesta
    // una consulta vacía. Al volver a la pestaña también se barre al instante.
    const runConnectedSweep = (lifecycleId) => {
        if (!shouldRunMonitorConnectedSweep({
            realtimeConnected: Boolean(subscriptionRef.current),
            pullInFlight: Boolean(recoveryPullInFlightRef.current),
            documentVisible: document.visibilityState === 'visible',
        })) return;
        const sweep = pullDocumentsRef.current?.(lifecycleId, { source: 'sweep' });
        if (sweep?.catch) {
            sweep.catch((error) => {
                if (!isActiveLifecycle(lifecycleId)) return;
                // Un barrido fallido no degrada el canal: Realtime sigue siendo
                // la vía primaria y el próximo barrido reintenta.
                console.warn('[MonitorSync] Barrido de respaldo falló:', error?.message ?? error);
            });
        }
    };

    const startSweepTimer = (lifecycleId) => {
        if (sweepTimerRef.current || !isActiveLifecycle(lifecycleId)) return;
        sweepTimerRef.current = setInterval(() => {
            if (!isActiveLifecycle(lifecycleId)) return;
            runConnectedSweep(lifecycleId);
        }, MONITOR_CONNECTED_SWEEP_INTERVAL_MS);
    };

    const stopSweepTimer = () => {
        if (sweepTimerRef.current) clearInterval(sweepTimerRef.current);
        sweepTimerRef.current = null;
    };

    const initMonitor = async (lifecycleId = lifecycleRef.current) => {
        if (!isActiveLifecycle(lifecycleId)) return { ok: false, error: 'Ciclo de sincronización obsoleto' };
        if (initInFlightRef.current) return initInFlightRef.current;

        const run = (async () => {
            if (!isActiveLifecycle(lifecycleId)) return { ok: false, error: 'Ciclo de sincronización obsoleto' };
            if (!pairedDeviceId) {
                setLoading(false);
                setIsConnected(false);
                setSyncState(SUPERVISOR_SYNC_STATES.IDLE);
                setSyncError(null);
                return { ok: false, error: 'No hay dispositivo vinculado' };
            }

            setLoading(true);
            setSyncState(SUPERVISOR_SYNC_STATES.AUTHENTICATING);
            setSyncError(null);

            try {
                const { session, error: sessionError } = await ensureSupervisorSession();
                if (sessionError || !session) throw sessionError || new Error('No hay sesión segura del monitor');
                if (!isActiveLifecycle(lifecycleId)) return { ok: false, error: 'Ciclo de sincronización obsoleto' };

                setSyncState(SUPERVISOR_SYNC_STATES.PULLING);
                // Fix egress: solo la primera carga (o el resync periódico) baja
                // el paquete completo; una reconexión o remontaje con historial
                // local usa el pull incremental por watermark.
                const wantsFullPull = shouldPullFullSync({
                    hasLocalHistory: Boolean(lastSyncRef.current),
                    lastFullSyncAt: readLastFullSyncAt(),
                });
                const batch = await pullDocuments(lifecycleId, { full: wantsFullPull });
                if (batch.ok && wantsFullPull) markFullSyncAt(new Date());
                if (!batch.ok) return batch;

                const realtime = await subscribeToRealtime(lifecycleId);
                startRecoveryTimer(lifecycleId);
                startSweepTimer(lifecycleId);
                if (!realtime.ok) {
                    setIsConnected(false);
                    setSyncState(SUPERVISOR_SYNC_STATES.DEGRADED);
                    setSyncError(realtime.error);
                    return { ok: false, error: realtime.error, ...batch };
                }

                return { ok: true, error: null, ...batch };
            } catch (error) {
                setIsConnected(false);
                setSyncState(lastSyncRef.current ? SUPERVISOR_SYNC_STATES.DEGRADED : SUPERVISOR_SYNC_STATES.ERROR);
                setSyncError(error?.message || 'No se pudo sincronizar el monitor');
                scheduleReconnect(lifecycleId);

                return { ok: false, error: error?.message || 'No se pudo sincronizar el monitor' };
            } finally {
                if (!disposedRef.current) setLoading(false);
            }
        })();

        initInFlightRef.current = run;
        try {
            return await run;
        } finally {
            if (initInFlightRef.current === run) initInFlightRef.current = null;
        }
    };

    const triggerRefresh = async () => initMonitor();

    const stopMonitorSync = async () => {
        if (syncSuspendedRef.current) return;
        syncSuspendedRef.current = true;
        lifecycleRef.current += 1;
        if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
        if (oversizePullTimerRef.current) clearTimeout(oversizePullTimerRef.current);
        oversizePullTimerRef.current = null;
        stopRecoveryTimer();
        stopSweepTimer();

        const initialization = initInFlightRef.current;
        if (initialization) await initialization.catch(() => {});
        while (pendingApplicationsRef.current.size > 0) {
            await Promise.allSettled([...pendingApplicationsRef.current]);
        }
        await clearSubscription();
        setIsConnected(false);
        setSyncState(SUPERVISOR_SYNC_STATES.REVOKED);
    };

    useEffect(() => {
        disposedRef.current = false;
        syncSuspendedRef.current = false;
        remoteRevocationHandledRef.current = false;
        const lifecycleId = lifecycleRef.current + 1;
        lifecycleRef.current = lifecycleId;
        reconnectAttemptRef.current = 0;
        lastRecoveryAtRef.current = 0;
        if (!supabaseCloud || !pairedDeviceId) {
            setLoading(false);
            setIsConnected(false);
            setSyncState(SUPERVISOR_SYNC_STATES.IDLE);
            setSyncError(null);
            return undefined;
        }

        initMonitor(lifecycleId);

        const handleOnline = () => {
            reconnectAttemptRef.current = 0;
            setSyncError(null);
            initMonitor(lifecycleId);
        };
        const handleOffline = () => {
            setIsConnected(false);
            setSyncState(SUPERVISOR_SYNC_STATES.DEGRADED);
            setSyncError('Sin conexión a internet');
        };
        const handleVisibilityChange = () => {
            if (document.visibilityState !== 'visible') return;
            // Los eventos perdidos mientras la pestaña descansó no se reenvían:
            // al volver la vista se barre al instante (mismo barrido conectado).
            runConnectedSweep(lifecycleId);
        };

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            disposedRef.current = true;
            lifecycleRef.current += 1;
            const documentQueues = documentQueuesRef.current;
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            document.removeEventListener('visibilitychange', handleVisibilityChange);
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
            if (oversizePullTimerRef.current) clearTimeout(oversizePullTimerRef.current);
            oversizePullTimerRef.current = null;
            stopRecoveryTimer();
            stopSweepTimer();
            documentQueues.clear();
            initInFlightRef.current = null;
            subscribeInFlightRef.current = null;
            clearSubscription();
        };
    }, [pairedDeviceId]);

    return {
        isConnected,
        lastSync,
        loading,
        syncState,
        syncError,
        syncDiagnostics,
        triggerRefresh,
        stopMonitorSync,
    };
}
