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
    getChangedSyncDocumentIds,
    SUPERVISOR_SYNC_STATES,
} from '../services/supervisorSyncService';
import { clearMonitorCache } from '../services/monitorUnpair';
import { isMonitorPairingActive, readPairingRow } from '../services/supervisorPairingState';

localforage.config({ name: 'BodegaApp', storeName: 'bodega_app_data' });

const SUBSCRIBE_TIMEOUT_MS = 8000;
const RECONNECT_DELAYS_MS = [1000, 3000, 10000, 30000];

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
    const recoveryPullInFlightRef = useRef(null);
    const lastRecoveryAtRef = useRef(0);
    const documentQueuesRef = useRef(new Map());
    const remoteRevocationHandledRef = useRef(false);

    const updateLastSync = (value) => {
        lastSyncRef.current = value;
        setLastSync(value);
        if (value) localStorage.setItem('monitor_last_sync', value.toISOString());
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
        const attempt = Math.min(reconnectAttemptRef.current, RECONNECT_DELAYS_MS.length - 1);
        const delay = RECONNECT_DELAYS_MS[attempt];
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

        const validation = validateSupervisorSyncDocument(docId, envelope.payload);
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
                await localforage.setItem(docId, envelope.payload);
                window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: docId, source: 'remote' } }));
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

    const applyBatch = async (docs, lifecycleId = lifecycleRef.current) => {
        let applied = 0;
        let rejected = 0;
        for (const doc of docs || []) {
            if (!isActiveLifecycle(lifecycleId)) break;
            try {
                const result = await enqueueDocApplication(doc, lifecycleId);
                if (result.applied) applied += 1;
                if (result.rejected && !result.stale) rejected += 1;
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
                        if (!isActiveLifecycle(lifecycleId) || !realtimePayload.new) return;
                        const application = enqueueDocApplication(realtimePayload.new, lifecycleId);
                        pendingApplicationsRef.current.add(application);
                        try {
                            const result = await application;
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

    const pullDocuments = async (lifecycleId = lifecycleRef.current, { full = false } = {}) => {
        if (!isActiveLifecycle(lifecycleId)) return { ok: false, skipped: true, error: 'Ciclo de sincronización obsoleto' };
        if (recoveryPullInFlightRef.current) return recoveryPullInFlightRef.current;

        const pull = (async () => {
            const { session, error: sessionError } = await ensureSupervisorSession();
            if (sessionError || !session) throw sessionError || new Error('No hay sesión segura del monitor');
            if (!isActiveLifecycle(lifecycleId)) return { ok: false, skipped: true, error: 'Ciclo de sincronización obsoleto' };

            let docs = [];
            if (full) {
                const { data, error } = await supabaseCloud
                    .from('sync_documents')
                    .select('collection, doc_id, data, updated_at')
                    .eq('device_id', pairedDeviceId)
                    .in('collection', ['store', 'local'])
                    .in('doc_id', SUPERVISOR_SYNC_KEYS);
                if (error) throw error;
                docs = data || [];
            } else {
                // Primero transferimos solo metadatos. El payload pesado se
                // solicita únicamente para documentos realmente modificados.
                const { data: metadata, error: metadataError } = await supabaseCloud
                    .from('sync_documents')
                    .select('collection, doc_id, updated_at')
                    .eq('device_id', pairedDeviceId)
                    .in('collection', ['store', 'local'])
                    .in('doc_id', SUPERVISOR_SYNC_KEYS);

                if (metadataError) throw metadataError;

                const changedDocIds = getChangedSyncDocumentIds(
                    metadata,
                    (docId) => localStorage.getItem(getSyncMetadataKey(docId)),
                );

                if (changedDocIds.length === 0) {
                    return { ok: true, applied: 0, rejected: 0, skipped: true, reason: 'Sin cambios remotos' };
                }

                const { data, error } = await supabaseCloud
                    .from('sync_documents')
                    .select('collection, doc_id, data, updated_at')
                    .eq('device_id', pairedDeviceId)
                    .in('collection', ['store', 'local'])
                    .in('doc_id', changedDocIds);
                if (error) throw error;
                docs = data || [];
            }

            const batch = await applyBatch(docs, lifecycleId);
            if (!isActiveLifecycle(lifecycleId)) return { ok: false, skipped: true, error: 'Ciclo de sincronización obsoleto' };
            if (batch.applied > 0) updateLastSync(new Date());
            return { ok: true, ...batch };
        })();

        recoveryPullInFlightRef.current = pull;
        return pull.finally(() => {
            if (recoveryPullInFlightRef.current === pull) recoveryPullInFlightRef.current = null;
        });
    };

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
                const batch = await pullDocuments(lifecycleId, { full: true });
                if (!batch.ok) return batch;

                const realtime = await subscribeToRealtime(lifecycleId);
                startRecoveryTimer(lifecycleId);
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
        stopRecoveryTimer();

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

        window.addEventListener('online', handleOnline);
        window.addEventListener('offline', handleOffline);

        return () => {
            disposedRef.current = true;
            lifecycleRef.current += 1;
            const documentQueues = documentQueuesRef.current;
            window.removeEventListener('online', handleOnline);
            window.removeEventListener('offline', handleOffline);
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
            reconnectTimerRef.current = null;
            stopRecoveryTimer();
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
        triggerRefresh,
        stopMonitorSync,
    };
}
