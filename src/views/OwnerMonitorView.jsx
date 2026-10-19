import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useProductContext } from '../context/ProductContext';
import { useMonitorSync } from '../hooks/useMonitorSync';
import { storageService } from '../utils/storageService';
import { supabaseCloud } from '../config/supabaseCloud';
import { showToast } from '../components/Toast';
import { notifyStockToast, stockMessage } from '../services/supervisorStockMessages';
import { 
    TrendingUp, Package, Coins, Users, LogOut,
    RefreshCw, Wifi, WifiOff, Clock, FileText, DollarSign,
    Wallet, CreditCard, Smartphone, Banknote, ArrowDownRight, ArrowDownToLine, ArrowUpFromLine,
    ShieldCheck, Hash, AlertTriangle, ChevronLeft, ChevronRight,
    Plus, Minus, Check, X, Pencil, Trash2, Activity, Radio
} from 'lucide-react';
import { formatBs, formatCop } from '../utils/calculatorUtils';
import { getLocalISODate, getDateRange } from '../utils/dateHelpers';
import { toTitleCase } from '../config/paymentMethods';
import SupervisorRateModal from '../components/Monitor/SupervisorRateModal';
import RemoteProductFormModal from '../components/Monitor/RemoteProductFormModal';
import SupervisorInventoryBatchPanel from '../components/Monitor/SupervisorInventoryBatchPanel';
import SupervisorCommandDiagnosticsPanel from '../components/Monitor/SupervisorCommandDiagnosticsPanel';
import SupervisorSyncDiagnosticsPanel from '../components/Monitor/SupervisorSyncDiagnosticsPanel';
import { useSupervisorTeamNotices } from '../hooks/useSupervisorTeamNotices';
import { getVerifications, recordReconciliation, recordVerification } from '../services/supervisorCommandDiagnostics';
import SupervisorInventoryToolbar from '../components/Monitor/SupervisorInventoryToolbar';
import SupervisorInventoryCatalog from '../components/Monitor/SupervisorInventoryCatalog';
import { createInventoryDraft, addInventoryDraftLine } from '../services/supervisorInventoryDraft';
import { sendSupervisorInventoryBatch } from '../services/supervisorInventoryBatchSender';
import {
    applyBatchStockTargets,
    applyStockOpResult,
    beginBatchStockTargets,
    beginStockAdjust,
    believedStockOf as believedStockOfService,
    loadStockOpMap,
    saveStockOpMap,
    classifyStockOpResult,
    clearStockOp as clearStockOpMap,
    isStockAdjustBlocked,
    nextStockOpAfterInspection,
    patchProductStock,
    planStockOpReconciliation,
    shouldAnnounceStockOpFailure,
    withStockOp,
} from '../services/supervisorStockOps';
import {
    SUPERVISOR_REMOTE_MUTATIONS_ENABLED,
    SUPERVISOR_REMOTE_PRODUCTS_ENABLED,
    SUPERVISOR_REMOTE_INCOME_ENABLED,
} from '../config/supervisorPolicy';
import { calculateInventoryMetrics, calculateInventoryMovementMetrics, calculateSalesProfit } from '../services/supervisorMetrics';
import {
    buildSupervisorRegisterCloses,
    calculateSupervisorPaymentBreakdown,
    isSupervisorTurnIncomeMovement,
} from '../services/supervisorFinancials';
import { ensureSupervisorSession } from '../services/supervisorAuth';
import { MONITOR_CLEANUP_PENDING_KEY, isPairingRevocationConfirmed, revokeAndClearMonitor } from '../services/monitorUnpair';
import { SUPERVISOR_SYNC_STATES, getSyncMetadataKey } from '../services/supervisorSyncService';
import { inspectSupervisorCommandState, sendSupervisorCommand } from '../services/supervisorCommandService';
import { commandOutcomeToAck, isCommandOutcomeOwned, setCommandVerification, trackSupervisorCommand } from '../services/supervisorCommandTracker';
import { applyOptimisticProductEcho, isOptimisticEchoSettled } from '../services/supervisorProductCommand';
import { verifyCommandsAgainstEcho } from '../services/supervisorCommandVerification';
import { matchesSearch as matchesSearchFields } from '../utils/searchMatch';
import { shouldShowSupervisorCop, calculateSupervisorCashSummary } from '../services/supervisorReportData';
import { useSupervisorControl } from '../hooks/useSupervisorControl';
import SupervisorControlPanel from '../components/Monitor/SupervisorControlPanel';
import LocalQueueBanner from '../components/Monitor/LocalQueueBanner';
import {
    discardAllQueuedSupervisorCommands,
    enqueueSupervisorCommand,
    flushSupervisorCommandQueue,
    getQueuedSupervisorCommands,
    sendOrQueueSupervisorCommand,
    subscribeSupervisorCommandQueue,
} from '../services/supervisorCommandQueue';
import { buildInventoryBatchV2Payload } from '../services/supervisorContracts';

// Helper: icon por método de pago
const PAYMENT_METHOD_ICONS = {
    efectivo_bs: Banknote,
    pago_movil: Smartphone,
    punto_venta: CreditCard,
    efectivo_usd: DollarSign,
    efectivo_cop: Coins,
    transferencia_cop: CreditCard,
    fiado: Clock,
    cashea: Clock,
};

function getMethodIcon(methodId) {
    return PAYMENT_METHOD_ICONS[methodId] || Wallet;
}

export default function OwnerMonitorView({ theme, toggleTheme, triggerHaptic, rates }) {
    const pairedDeviceId = localStorage.getItem('pda_paired_device_id');
    const { products, effectiveRate: bcvRate, copEnabled } = useProductContext();
    const {
        isConnected,
        lastSync,
        loading: syncLoading,
        syncState,
        stopMonitorSync,
        syncError,
        syncDiagnostics,
        triggerRefresh,
    } = useMonitorSync(pairedDeviceId);
    const remoteActionsAvailable = Boolean(isConnected && pairedDeviceId);

    const [sales, setSales] = useState([]);
    const [activeCashier, setActiveCashier] = useState({ nombre: 'Ninguno', rol: '' });
    const [loadingData, setLoadingData] = useState(true);
    const [showDisconnectConfirm, setShowDisconnectConfirm] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const [disconnectError, setDisconnectError] = useState('');
    const [disconnectServerRevoked, setDisconnectServerRevoked] = useState(false);
    const disconnectingRef = useRef(false);
    const [viewTab, setViewTab] = useState('activo'); // 'activo', 'cierres', 'inventario' o 'control'
    // Propuesta 8: los cambios de OTROS supervisores avisan aunque la pestaña
    // Control esté cerrada. El canal lo mantiene useSupervisorControl (canal
    // único) y reenvía cada comando a este hook por onCommandRow.
    const teamNotices = useSupervisorTeamNotices({ targetDeviceId: pairedDeviceId });
    const supervisorControl = useSupervisorControl({
        targetDeviceId: pairedDeviceId,
        enabled: viewTab === 'control' && Boolean(pairedDeviceId),
        onCommandRow: teamNotices.handleCommandRow,
    });
    const [selectedCierreId, setSelectedCierreId] = useState(null);
    const [searchTermInventario, setSearchTermInventario] = useState('');
    const [filterStockInventario, setFilterStockInventario] = useState('todos'); // 'todos', 'bajo', 'agotado', 'movidos'
    const [showRateModal, setShowRateModal] = useState(false);
    const [showProductFormModal, setShowProductFormModal] = useState(false);
    const [productToEditRemote, setProductToEditRemote] = useState(null);
    const [productToDeleteRemote, setProductToDeleteRemote] = useState(null);
    const [deletingRemoteProduct, setDeletingRemoteProduct] = useState(false);
    const [inventoryBatchProduct, setInventoryBatchProduct] = useState(null);
    const [inventoryBatchMode, setInventoryBatchMode] = useState(null);
    // Panel de diagnóstico de comandos: estado, latencia de ACK y
    // reconciliaciones por commandId (telemetría registrada en la caja).
    const [showCommandDiagnostics, setShowCommandDiagnostics] = useState(false);
    const [showSyncDiagnostics, setShowSyncDiagnostics] = useState(false);
    // Edición directa de stock en la fila: número pulsable + botones +/- que
    // cambian la cantidad al instante (sin modal), con confirmación explícita y
    // estado visible por producto: sending / applied / failed / pending.
    const [stockEditProductId, setStockEditProductId] = useState(null);
    const [stockEditValue, setStockEditValue] = useState('');
    const [stockPendingConfirm, setStockPendingConfirm] = useState(null); // { product, nextStock }
    // productId -> { state, error, targetStock, commandId }. Se persiste para
    // que el stock "creído" (aplicado en caja aún sin sincronizar) sobreviva a
    // una recarga: si se pierde, la fila muestra el stock viejo y el usuario
    // reintenta movimientos que ya se aplicaron.
    const [stockOpStatus, setStockOpStatus] = useState(() => loadStockOpMap());

    useEffect(() => {
        saveStockOpMap(stockOpStatus);
    }, [stockOpStatus]);
    const [cierresDateRange, setCierresDateRange] = useState('all'); // 'all', 'today', 'yesterday', 'week', 'month'
    const [criticalStockTab, setCriticalStockTab] = useState('bajo'); // 'bajo', 'agotado', 'todos'

    const formatStockValue = (product, value) => (
        product?.isWeight ? `${Number(value).toFixed(3)} Kg` : `${Number(value)} u`
    );

    /**
     * Aplica un stock objetivo como un movimiento de lote de una línea (ingreso
     * o egreso), reutilizando el mismo canal batch v2 con ACK que usan
     * "Recepción rápida" y "Egreso rápido".
     */
    // ── Optimistic update (unificado) ───────────────────────────────────────────
    // La máquina de estados de operaciones de stock por producto vive en
    // supervisorStockOps y se comparte entre el ajuste de fila (+/− / edición
    // directa) y el panel de lote de inventario. Aquí solo se cablea a React y a
    // los efectos visibles (toasts, temporizadores, inspección de comandos).
    const believedStockOf = (product) => believedStockOfService(product, stockOpStatus);
    // Watermark del eco de productos vigente (updatedAt del último doc aplicado).
    // Se fija al iniciar cada ajuste para que la reconciliación sepa si un eco
    // posterior (una venta en la caja) ya dejó viejo el objetivo creído.
    const currentProductsWatermark = () => localStorage.getItem(getSyncMetadataKey('bodega_products_v1'));

    // Productos con el stock "creído": el panel de lote compone la base del
    // movimiento (expectedStock) desde aquí, que es el estado real de la caja
    // (el stock sincronizado puede quedar atrás unos segundos tras un ajuste).
    const believedProducts = useMemo(() => products.map(product => {
        const stock = believedStockOfService(product, stockOpStatus);
        return Number(stock) === Number(product.stock) ? product : { ...product, stock };
    }), [products, stockOpStatus]);

    const notifyStockOpRevert = () => {
        // Reversión del valor provisional: la fila vuelve al stock real.
        notifyStockToast(showToast, 'STOCK_REVERT');
    };

    const setStockOp = (productId, op) => {
        setStockOpStatus(current => withStockOp(current, String(productId), op));
        // Si el tracker se ocupa del resultado de este comando, su aviso ya cubre
        // el fallo (con motivo): la franja muestra el detalle, sin toast duplicado.
        if (shouldAnnounceStockOpFailure(op) && !isCommandOutcomeOwned(op.commandId)) notifyStockOpRevert();
    };

    const clearStockOp = (productId, options = {}) => {
        setStockOpStatus(current => clearStockOpMap(current, String(productId), options));
    };

    // Resultado de una operación (ajuste único) → estado por producto. El fallo
    // con aviso es solo del ajuste único: los lotes avisan por su panel.
    const applyStockOpOutcome = (target, result) => {
        setStockOpStatus(current => applyStockOpResult(current, target, result, { announce: true }));
        if (classifyStockOpResult(result) === 'failed') notifyStockOpRevert();
    };

    // Optimistic update del panel de lote: los stocks objetivo del lote se
    // reflejan en la fila como provisionales mientras la caja confirma. El ACK
    // global se reconcilia igual que un ajuste individual (commandId + sync).
    const applyInventoryBatchTargets = (result, targets = []) => {
        setStockOpStatus(current => applyBatchStockTargets(current, result, targets));
    };

    const handleInventoryBatchSubmitting = (targets = []) => {
        setStockOpStatus(current => beginBatchStockTargets(current, targets, {
            sinceWatermark: currentProductsWatermark(),
        }));
    };

    // ── Propuesta 5: cola local con mando del usuario ────────────────────
    // Los cambios que no pudieron enviarse esperan guardados ("EN COLA") y se
    // suben solos al volver la conexión (barrido de 30 s + evento online) o con
    // SUBIR AL SISTEMA. Descartar es siempre una decisión del usuario.
    const [queueEntries, setQueueEntries] = useState(() => getQueuedSupervisorCommands());
    const [queueUploading, setQueueUploading] = useState(false);

    useEffect(() => subscribeSupervisorCommandQueue(() => {
        setQueueEntries(getQueuedSupervisorCommands());
    }), []);

    const flushLocalQueue = async ({ manual = false } = {}) => {
        const entries = getQueuedSupervisorCommands();
        if (!entries.length || queueUploading) return null;
        if (!remoteActionsAvailable) {
            if (manual) notifyStockToast(showToast, 'BOX_OFFLINE_SEND');
            return null;
        }
        setQueueUploading(true);
        const summary = await flushSupervisorCommandQueue({
            send: async (entry) => {
                const result = await sendSupervisorCommand({
                    type: entry.type,
                    payload: entry.payload,
                    targetDeviceId: entry.targetDeviceId || pairedDeviceId,
                });
                if (!result?.ok) return result;
                // Enviada de verdad: ahora sí se trackea ("un cambio = un aviso").
                trackSupervisorCommand({
                    commandId: result.commandId,
                    type: entry.type,
                    payload: entry.payload,
                    label: entry.label,
                    ackPromise: result.ackPromise,
                });
                if (entry.kind === 'stock') {
                    // Cada línea pasa a "esperando a la caja" con su commandId:
                    // la reconciliación existente resuelve el resultado.
                    (entry.payload?.lines || []).forEach(line => {
                        const sign = entry.payload?.direction === 'egreso' ? -1 : 1;
                        const targetStock = Number(line.expectedStock) + sign * Number(line.quantityInput);
                        setStockOpStatus(current => withStockOp(current, String(line.productId), {
                            state: 'pending',
                            targetStock,
                            silent: true,
                            commandId: result.commandId,
                            sinceWatermark: currentProductsWatermark(),
                        }));
                    });
                }
                return result;
            },
        });
        setQueueUploading(false);
        if (summary?.sent) {
            showToast?.(`${summary.sent} ${summary.sent === 1 ? 'cambio subido' : 'cambios subidos'} a la caja`, 'success');
        }
        return summary;
    };

    // Barrido de 30 s + reconexión: el modo automático de la cola.
    useEffect(() => {
        if (!remoteActionsAvailable || !queueEntries.length) return undefined;
        flushLocalQueue();
        const timer = window.setInterval(() => { flushLocalQueue(); }, 30_000);
        const onOnline = () => { flushLocalQueue(); };
        window.addEventListener('online', onOnline);
        return () => {
            window.clearInterval(timer);
            window.removeEventListener('online', onOnline);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [remoteActionsAvailable, queueEntries.length]);

    const discardLocalQueue = () => {
        // Nunca se descarta lo que YA se envió: eso es territorio de la anulación.
        getQueuedSupervisorCommands().forEach(entry => {
            if (entry.kind !== 'stock') return;
            (entry.payload?.lines || []).forEach(line => {
                setStockOpStatus(current => clearStockOpMap(current, String(line.productId)));
            });
        });
        const discarded = discardAllQueuedSupervisorCommands();
        if (discarded) showToast?.(`Se descartaron ${discarded} ${discarded === 1 ? 'cambio' : 'cambios'} de la cola`, 'warning');
    };

    const applyTargetStock = async (product, targetStock) => {
        // Optimistic update: el movimiento se calcula contra el stock "creído"
        // (objetivo de un ajuste anterior confirmado aún sin sincronizar), que es
        // el estado que la caja ya tiene.
        const current = believedStockOf(product);
        const delta = Number(targetStock) - current;
        const productId = String(product.id);
        if (!Number.isFinite(delta) || Math.abs(delta) < 1e-9) return;
        if (delta < 0 && !SUPERVISOR_REMOTE_MUTATIONS_ENABLED) {
            notifyStockToast(showToast, 'EGRESS_DISABLED');
            return;
        }
        if (!remoteActionsAvailable) {
            // Propuesta 5: sin conexión el cambio se guarda en la cola local y se
            // sube solo cuando vuelva (o con SUBIR AL SISTEMA). La fila muestra
            // el stock objetivo con la etiqueta "EN COLA".
            const queuedDirection = delta > 0 ? 'ingreso' : 'egreso';
            const queuedPayload = buildInventoryBatchV2Payload(
                { direction: queuedDirection, reason: 'Ajuste de stock', reasonCategory: 'ajuste' },
                [{
                    productId: String(product.id),
                    inputUnit: 'unidades',
                    quantityInput: Math.abs(delta),
                    expectedStock: current,
                }],
            );
            setStockOpStatus(currentOps => beginStockAdjust(currentOps, {
                productId,
                targetStock,
                sinceWatermark: currentProductsWatermark(),
            }));
            enqueueSupervisorCommand({
                kind: 'stock',
                type: 'supervisor.inventory.batch.adjust',
                payload: {
                    ...queuedPayload,
                    lines: queuedPayload.lines.map(line => ({ ...line, productName: product.name })),
                },
                label: `el ajuste de stock de "${product.name}"`,
                targetDeviceId: pairedDeviceId,
            });
            showToast?.('Cambio guardado en la cola — se subirá cuando vuelva la conexión', 'info');
            return;
        }

        const direction = delta > 0 ? 'ingreso' : 'egreso';
        const draft = createInventoryDraft(direction, direction === 'egreso'
            ? { reason: 'Ajuste de stock', reasonCategory: 'ajuste' }
            : { reason: 'Ajuste de stock' });
        const result = addInventoryDraftLine(draft, {
            productId: product.id,
            productName: product.name,
            inputUnit: 'unidades',
            quantityInput: Math.abs(delta),
            unitsPerPackage: 1,
            // Semántica de objetivo (igual que el lote): el movimiento se deriva
            // al enviar como (objetivo − stock creído), así que reintentar un
            // objetivo ya alcanzado es un no-op en vez de duplicar el ajuste.
            baseStock: current,
            targetStock: Number(targetStock),
        });
        if (result.error) {
            showToast?.(result.error, 'error');
            return;
        }
        setStockOpStatus(current => beginStockAdjust(current, {
            productId,
            targetStock,
            sinceWatermark: currentProductsWatermark(),
        }));
        try {
            // expectedStock debe describir la base contra la que se calculó el
            // movimiento: si el stock local aún no refleja un ajuste confirmado, se
            // usa el valor creído para que la caja valide la concurrencia correcta.
            const baseProducts = Math.abs(current - Number(product.stock || 0)) < 1e-9
                ? products
                : patchProductStock(products, productId, current);
            let trackedCommandId = null;
            const senderPromise = sendSupervisorInventoryBatch({
                draft: result.draft,
                products: baseProducts,
                targetDeviceId: pairedDeviceId,
                onProgress: (event) => {
                    // "Confirma y sigue": la orden quedó registrada → el tracker
                    // garantiza el aviso final (el éxito del ajuste de fila deja
                    // de ser silencioso y el fallo no se duplica).
                    if (event?.status === 'sent' && event?.commandId && trackedCommandId !== event.commandId) {
                        trackedCommandId = event.commandId;
                        trackSupervisorCommand({
                            commandId: event.commandId,
                            type: 'supervisor.inventory.batch.adjust',
                            payload: { direction },
                            label: `el ajuste de stock de "${product.name}"`,
                            ackPromise: senderPromise.then(commandOutcomeToAck),
                        });
                    }
                },
            });
            const batchResult = await senderPromise;
            // Un solo lugar decide el estado por producto según el resultado
            // (applied / pending incierto / failed con reversión).
            applyStockOpOutcome({ productId, targetStock, commandId: batchResult.commandId ?? null }, batchResult);
            if (batchResult.ok) triggerRefresh?.();
        } catch (error) {
            applyStockOpOutcome({ productId, targetStock }, {
                ok: false,
                uncertain: false,
                error: error?.message || stockMessage('STOCK_UPDATE_FAILED'),
            });
        }
    };

    // Reconciliación automática de un ajuste sin confirmar: el aviso nunca debe
    // quedar pegado si la caja YA aplicó el cambio. El plan lo decide el servicio
    // (promociones por sincronía, retiros de franja, inspecciones por commandId);
    // aquí solo se ejecutan los temporizadores y las consultas de estado.
    useEffect(() => {
        const plan = planStockOpReconciliation(stockOpStatus, products, {
            productsUpdatedAt: currentProductsWatermark(),
        });
        if (!plan.promoted.length && !plan.retire.length && !plan.inspect.length && !plan.superseded.length) return undefined;
        if (plan.promoted.length) setStockOpStatus(plan.map);

        // Objetivo superado (una venta en la caja ya descontó y el eco posterior
        // lo trae): se retira al instante y la fila vuelve al stock sincronizado.
        plan.superseded.forEach(({ id, targetStock }) => clearStockOp(id, { onlyAppliedTarget: targetStock }));

        let cancelled = false;
        const timers = [];
        plan.retire.forEach(({ id, targetStock }) => {
            // El stock sincronizado ya coincide con el objetivo: el valor optimista
            // es el real y la franja se retira sola en unos segundos.
            timers.push(setTimeout(() => clearStockOp(id, { onlyAppliedTarget: targetStock }), 2500));
        });
        plan.inspect.forEach(({ id, op }) => {
            // Consulta del estado del comando cada pocos segundos (lectura sola;
            // jamás crea otro comando).
            const check = async () => {
                try {
                    const inspection = await inspectSupervisorCommandState(op.commandId);
                    if (cancelled) return;
                    const next = nextStockOpAfterInspection(op, inspection);
                    if (next) {
                        // Diagnóstico: la reconciliación de la fila resolvió el
                        // commandId (aplicado o fallido) sin reenviar nada.
                        recordReconciliation({
                            commandId: op.commandId,
                            source: 'fila',
                            via: 'auto',
                            outcome: next.state === 'applied' ? 'applied' : 'failed',
                            status: inspection?.ack?.status || inspection?.state || null,
                            detail: next.error || null,
                        });
                        setStockOp(id, next);
                    }
                    // 'active' / 'absent': sigue pendiente; se re-consulta en el próximo tick.
                } catch {
                    // Sin conexión en este momento: se reintenta en el próximo tick.
                }
            };
            check();
            timers.push(setInterval(check, 5000));
        });

        return () => {
            cancelled = true;
            timers.forEach(timer => { clearTimeout(timer); clearInterval(timer); });
        };
    }, [products, stockOpStatus]);

    // Resolutor de nombres para las fichas-recibo del panel Control: el payload
    // puede traer solo el id (p. ej. al reintentar una orden vieja); aquí se
    // resuelve contra el catálogo real que vino en el eco.
    const resolveProductName = (id) => {
        if (id == null || !Array.isArray(products)) return null;
        const found = products.find(product => String(product?.id) === String(id));
        return found?.name || null;
    };

    // Sellos "Aplicado y verificado" (propuesta 7): al llegar un eco (productos
    // o comandos nuevos), se contrastan los comandos aplicados recientes contra
    // lo que la caja publicó y se registra el sello. El sello es ESTADO, no un
    // aviso nuevo: solo un "No coincide" dispara alerta (la lanza el tracker,
    // una sola vez por comando). Un eco incompleto se degrada a "recibido".
    useEffect(() => {
        const commands = supervisorControl?.commands;
        if (!products && !commands?.length) return undefined;
        let cancelled = false;
        (async () => {
            let users = null;
            let rateMode = null;
            try {
                users = await storageService.getItem('bodega_users_catalog_v1', null);
                rateMode = localStorage.getItem('bodega_rate_mode');
            } catch { /* sin datos locales el sello se degrada a "recibido" */ }
            if (cancelled) return;
            const productsUpdatedAt = localStorage.getItem(getSyncMetadataKey('bodega_products_v1'));
            const usersUpdatedAt = localStorage.getItem(getSyncMetadataKey('bodega_users_catalog_v1'));
            const rateModeUpdatedAt = localStorage.getItem(getSyncMetadataKey('bodega_rate_mode'));
            verifyCommandsAgainstEcho({
                commands: commands || [],
                snapshot: {
                    products: Array.isArray(products) ? products : null,
                    users: Array.isArray(users) ? users : null,
                    rateMode: rateMode || null,
                    updatedAt: productsUpdatedAt || usersUpdatedAt || rateModeUpdatedAt || null,
                    productsUpdatedAt,
                    usersUpdatedAt,
                    rateModeUpdatedAt,
                },
                recorded: getVerifications(),
                onResult: (commandId, outcome) => {
                    recordVerification({
                        commandId,
                        level: outcome.level,
                        detail: outcome.detail,
                        checkedAt: outcome.checkedAt,
                    });
                    setCommandVerification(commandId, outcome);
                    supervisorControl?.refreshVerifications?.();
                },
            });
        })();
        return () => { cancelled = true; };
    }, [products, supervisorControl?.commands]);

    const openStockEditor = (product) => {
        if (isStockAdjustBlocked(stockOpStatus, product.id)) {
            notifyStockToast(showToast, 'ADJUST_IN_FLIGHT');
            return;
        }
        triggerHaptic?.();
        setStockEditProductId(String(product.id));
        setStockEditValue(String(believedStockOf(product)));
    };

    // Muestra el cambio propuesto en la fila (sin modal): el usuario confirma
    // con el botón ✓ o cancela con ✗ antes de enviar nada a la caja.
    const commitStockEdit = async (product) => {
        const parsed = Number(stockEditValue);
        const valid = product?.isWeight
            ? (Number.isFinite(parsed) && parsed >= 0)
            : (Number.isInteger(parsed) && parsed >= 0);
        if (!valid) {
            notifyStockToast(showToast, product?.isWeight ? 'INVALID_STOCK_WEIGHT' : 'INVALID_STOCK_UNITS');
            return;
        }
        setStockEditProductId(null);
        if (parsed === believedStockOf(product)) {
            setStockPendingConfirm(null);
            return;
        }
        setStockPendingConfirm({ product, nextStock: parsed });
    };

    // Los botones +/− cambian la cantidad al instante (sin modal). El cambio se
    // envía recién al pulsar ✓ en la franja de confirmación de la fila.
    const stepStockEdit = (product, step) => {
        const productId = String(product.id);
        triggerHaptic?.();
        // Sin conexión también se puede componer: el cambio se guarda en la cola
        // local al confirmar (propuesta 5) en vez de bloquear la edición.
        if (isStockAdjustBlocked(stockOpStatus, productId)) {
            notifyStockToast(showToast, 'ADJUST_IN_FLIGHT');
            return;
        }
        let base;
        if (stockPendingConfirm && String(stockPendingConfirm.product?.id) === productId) {
            base = Number(stockPendingConfirm.nextStock);
        } else if (stockEditProductId === productId && stockEditValue !== '') {
            base = Number(stockEditValue);
        } else {
            base = believedStockOf(product);
        }
        if (!Number.isFinite(base)) base = believedStockOf(product);
        const isWeight = Boolean(product?.isWeight);
        const next = isWeight ? Math.round((base + step) * 1000) / 1000 : Math.round(base + step);
        const finalNext = next < 0 ? 0 : next;

        if (stockEditProductId === productId) {
            // Si el usuario tenía abierto el input de texto manual, actualizamos el valor en el input
            setStockEditValue(String(finalNext));
        } else {
            // Al pulsar +/- directamente, actualizamos stockPendingConfirm para no ocultar la botonera stepper
            if (finalNext === believedStockOf(product)) {
                setStockPendingConfirm(null);
            } else {
                setStockPendingConfirm({ product, nextStock: finalNext });
            }
        }
    };

    const movedProductIds = useMemo(() => new Set(
        sales
            .filter(record => record?.tipo === 'AJUSTE_ENTRADA' || record?.tipo === 'AJUSTE_SALIDA' || record?.direction === 'ingreso' || record?.direction === 'egreso')
            .map(record => String(record.productId || record.product_id || record.items?.[0]?.id || ''))
            .filter(Boolean)
    ), [sales]);

    const negativeStockCount = useMemo(() => {
        return (products || []).filter(p => (Number(p.stock) || 0) < 0).length;
    }, [products]);

    // ── ECO OPTIMISTA DEL CATÁLOGO ──────────────────────────────────────────
    // Un comando de producto enviado muestra su resultado en la lista AL
    // INSTANTE (como el cambio de tasa), con la etiqueta del tracker encima.
    // Es solo presentación: no toca almacenamiento ni la nube. La entrada se
    // retira sola cuando el eco real llega (isOptimisticEchoSettled) o cuando
    // la caja rechaza/falla el comando (reversión; el motivo ya lo avisó el
    // tracker). Solo aplica a órdenes enviadas con ackPromise; las órdenes en
    // cola (sin conexión) conservan su etiqueta "EN COLA" de siempre.
    const [optimisticEchoEntries, setOptimisticEchoEntries] = useState([]);
    const productsWithEcho = useMemo(
        () => optimisticEchoEntries.reduce(applyOptimisticProductEcho, products || []),
        [products, optimisticEchoEntries]
    );
    const addOptimisticProductEcho = (entry) => {
        const key = entry.commandId || `${entry.action}:${entry.productId || entry.product?.id}:${Date.now()}`;
        setOptimisticEchoEntries(prev => [...prev, { ...entry, key }]);
        Promise.resolve(entry.ackPromise).then((result) => {
            const applied = result?.status === 'applied' || result?.status === 'applied_with_warnings';
            // Confirmado: la entrada se queda hasta que el eco real la retire
            // (evita un parpadeo de vuelta al valor viejo). Cualquier otro
            // desenlace (rechazo, fallo, cancelación, timeout) revierte.
            if (!applied) {
                setOptimisticEchoEntries(prev => prev.filter(item => item.key !== key));
            }
        }).catch(() => {
            setOptimisticEchoEntries(prev => prev.filter(item => item.key !== key));
        });
    };
    useEffect(() => {
        setOptimisticEchoEntries(prev => (
            prev.length === 0 ? prev : prev.filter(entry => !isOptimisticEchoSettled(entry, products || []))
        ));
    }, [products]);

    const filteredProducts = useMemo(() => {
        if (!productsWithEcho) return [];
        return productsWithEcho.filter(p => {
            const matchesSearch = matchesSearchFields([p.name, p.barcode], searchTermInventario);
            
            if (!matchesSearch) return false;
            
            if (filterStockInventario === 'bajo') {
                return p.stock > 0 && p.stock <= (p.minStock || 5);
            }
            if (filterStockInventario === 'agotado') {
                return p.stock <= 0;
            }
            if (filterStockInventario === 'negativo') {
                return (Number(p.stock) || 0) < 0;
            }
            if (filterStockInventario === 'movidos') {
                return movedProductIds.has(String(p.id));
            }
            return true;
        });
    }, [productsWithEcho, searchTermInventario, filterStockInventario, movedProductIds]);

    const [currentPageInventario, setCurrentPageInventario] = useState(1);
    const ITEMS_PER_PAGE_INVENTARIO = 15;

    useEffect(() => {
        setCurrentPageInventario(1);
    }, [searchTermInventario, filterStockInventario]);

    const totalPagesInventario = Math.ceil(filteredProducts.length / ITEMS_PER_PAGE_INVENTARIO);

    const paginatedProducts = useMemo(() => {
        const start = (currentPageInventario - 1) * ITEMS_PER_PAGE_INVENTARIO;
        return filteredProducts.slice(start, start + ITEMS_PER_PAGE_INVENTARIO);
    }, [filteredProducts, currentPageInventario]);

    const inventoryMetrics = useMemo(() => calculateInventoryMetrics(products), [products]);
    const inventoryMovementMetrics = useMemo(() => calculateInventoryMovementMetrics(sales), [sales]);
    const shouldShowCop = shouldShowSupervisorCop(copEnabled);

    // 1. Cargar datos locales (que son actualizados por useMonitorSync)
    const loadLocalData = async () => {
        try {
            const [savedSales, savedAuth] = await Promise.all([
                storageService.getItem('bodega_sales_v1', []),
                storageService.getItem('abasto-auth-storage', null)
            ]);

            setSales(savedSales);
            
            if (savedAuth && savedAuth.state && savedAuth.state.usuarioActivo) {
                setActiveCashier({
                    nombre: savedAuth.state.usuarioActivo.nombre || 'Cajero',
                    rol: savedAuth.state.usuarioActivo.rol || 'CAJERO'
                });
            } else {
                setActiveCashier({ nombre: 'Ninguno', rol: '' });
            }
        } catch (e) {
            console.error('[OwnerMonitorView] Error cargando datos locales:', e);
        } finally {
            setLoadingData(false);
        }
    };

    useEffect(() => {
        loadLocalData();

        // Escuchar actualizaciones del almacenamiento causadas por la sincronización en tiempo real
        const handleUpdate = () => {
            loadLocalData();
        };

        window.addEventListener('app_storage_update', handleUpdate);
        window.addEventListener('storage', handleUpdate);
        return () => {
            window.removeEventListener('app_storage_update', handleUpdate);
            window.removeEventListener('storage', handleUpdate);
        };
    }, []);

    // ── TURNO ACTIVO ──
    
    // Apertura de caja del turno activo
    const activeShiftApertura = useMemo(() => {
        const aperturas = sales.filter(s => s.tipo === 'APERTURA_CAJA' && !s.cajaCerrada);
        if (aperturas.length === 0) return null;
        return aperturas.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))[0];
    }, [sales]);

    // Filtrar ventas del turno activo (cajaCerrada !== true)
    const activeShiftSales = useMemo(() => {
        return sales.filter(s => {
            if (s.status === 'ANULADA') return false;
            if (s.tipo !== 'VENTA' && s.tipo !== 'VENTA_FIADA' && s.tipo !== 'VENTA_CASHEA') return false;
            if (s.cajaCerrada) return false;
            
            // Restringir a transacciones posteriores a la última apertura activa si existe
            if (activeShiftApertura) {
                return new Date(s.timestamp) >= new Date(activeShiftApertura.timestamp);
            }
            return true;
        });
    }, [sales, activeShiftApertura]);

    // Métricas del turno activo
    const activeShiftMetrics = useMemo(() => {
        const metrics = calculateSalesProfit(activeShiftSales, products, bcvRate);
        return {
            totalUsd: metrics.revenueUsd,
            totalBs: metrics.revenueBs,
            profitUsd: metrics.profitUsd,
            count: metrics.count,
        };
    }, [activeShiftSales, products, bcvRate]);

    // El desglose del monitor usa el mismo contrato de pagos que la caja.
    const activeShiftPaymentBreakdown = useMemo(() => {
        const activeFlow = sales.filter(sale => {
            if (sale.status === 'ANULADA' || sale.cajaCerrada) return false;
            if (!isSupervisorTurnIncomeMovement(sale)) return false;
            return !activeShiftApertura || new Date(sale.timestamp) >= new Date(activeShiftApertura.timestamp);
        });
        return calculateSupervisorPaymentBreakdown(activeFlow, bcvRate);
    }, [sales, activeShiftApertura, bcvRate]);

    // Ticket promedio del turno activo
    const activeShiftAvgTicket = useMemo(() => {
        if (activeShiftSales.length === 0) return 0;
        return activeShiftMetrics.totalUsd / activeShiftSales.length;
    }, [activeShiftMetrics.totalUsd, activeShiftSales.length]);


    // ── HISTORIAL DE CIERRES DE CAJA ──

    // El monitor consume el mismo normalizador y FinancialEngine que la caja.
    const registerCloses = useMemo(
        () => buildSupervisorRegisterCloses(sales, products, bcvRate),
        [sales, products, bcvRate]
    );

    // Filtro de cierres por rango de fechas
    const filteredRegisterCloses = useMemo(() => {
        if (cierresDateRange === 'all') return registerCloses;
        const { from, to } = getDateRange(cierresDateRange);
        return registerCloses.filter(c => {
            const d = getLocalISODate(new Date(Number(c.cierreId)));
            return d >= from && d <= to;
        });
    }, [registerCloses, cierresDateRange]);

    // Establecer primer cierre por defecto si cambia la lista
    useEffect(() => {
        if (filteredRegisterCloses.length > 0) {
            const exists = filteredRegisterCloses.some(c => c.cierreId === selectedCierreId);
            if (!exists) {
                setSelectedCierreId(filteredRegisterCloses[0].cierreId);
            }
        } else {
            setSelectedCierreId(null);
        }
    }, [filteredRegisterCloses, selectedCierreId]);

    // Registros del turno activo para el cálculo de arqueo y efectivo
    const activeShiftRecords = useMemo(() => {
        const records = sales.filter(s => {
            if (s.status === 'ANULADA' || s.cajaCerrada) return false;
            if (activeShiftApertura) {
                return new Date(s.timestamp) >= new Date(activeShiftApertura.timestamp);
            }
            return true;
        });
        if (activeShiftApertura && !records.some(r => r.id === activeShiftApertura.id || (r.tipo === 'APERTURA_CAJA' && r.timestamp === activeShiftApertura.timestamp))) {
            records.unshift(activeShiftApertura);
        }
        return records;
    }, [sales, activeShiftApertura]);

    // Resumen de efectivo esperado y apertura en vivo del turno activo
    const activeShiftCashSummary = useMemo(() => {
        return calculateSupervisorCashSummary(activeShiftRecords, bcvRate);
    }, [activeShiftRecords, bcvRate]);

    const openingUsd = activeShiftCashSummary.opening.USD || activeShiftApertura?.openingUsd || 0;
    const openingBs = activeShiftCashSummary.opening.BS || activeShiftApertura?.openingBs || 0;
    const openingCop = activeShiftCashSummary.opening.COP || activeShiftApertura?.openingCop || 0;

    const expectedCashUsd = activeShiftCashSummary.expected.USD;
    const expectedCashBs = activeShiftCashSummary.expected.BS;
    const expectedCashCop = activeShiftCashSummary.expected.COP;


    // ── COMPONENTES GENERALES ──

    // Productos Críticos (Stock Agotado o Stock Bajo)
    // 1. Stock Bajo (existencia > 0 pero <= minStock). Ordenados de menor a mayor existencia
    const lowStockProducts = useMemo(() => {
        return products
            .filter(p => {
                const stock = Number(p.stock) || 0;
                const minStock = Number(p.minStock ?? p.lowStockAlert) || 5;
                return stock > 0 && stock <= minStock;
            })
            .sort((a, b) => {
                const stockA = Number(a.stock) || 0;
                const stockB = Number(b.stock) || 0;
                return stockA - stockB;
            });
    }, [products]);

    // 2. Agotados (existencia <= 0)
    const outOfStockProducts = useMemo(() => {
        return products
            .filter(p => (Number(p.stock) || 0) <= 0)
            .sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    }, [products]);

    const lowStockCount = lowStockProducts.length;
    const outOfStockCount = outOfStockProducts.length;

    // Stock bajo va primero por requerimiento operativo, seguido de los agotados
    const allCriticalProducts = useMemo(() => {
        return [...lowStockProducts, ...outOfStockProducts];
    }, [lowStockProducts, outOfStockProducts]);

    // Lista activa según la pestaña seleccionada ('bajo' | 'agotado' | 'todos')
    const activeCriticalProducts = useMemo(() => {
        if (criticalStockTab === 'bajo') return lowStockProducts;
        if (criticalStockTab === 'agotado') return outOfStockProducts;
        return allCriticalProducts;
    }, [criticalStockTab, lowStockProducts, outOfStockProducts, allCriticalProducts]);

    // Desvincular Monitor: mantener esta sesión abierta hasta confirmar servidor y limpieza local.
    const handleDisconnect = async () => {
        if (disconnectingRef.current) return;
        disconnectingRef.current = true;
        setDisconnecting(true);
        setDisconnectError('');
        const resumeCleanup = localStorage.getItem(MONITOR_CLEANUP_PENDING_KEY) === 'true';
        const monitorDeviceId = localStorage.getItem('pda_device_id');
        setDisconnectServerRevoked(resumeCleanup);
        triggerHaptic?.();

        try {
            const { default: localforage } = await import('localforage');
            const monitorStore = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
            await revokeAndClearMonitor({
                deviceId: pairedDeviceId || localStorage.getItem('pda_paired_device_id'),
                ensureSession: ensureSupervisorSession,
                revokePairing: async (primaryDeviceId) => {
                    if (!supabaseCloud) return { error: new Error('Sin conexión a la nube') };

                    // Producción puede tener la RPC legacy, que identifica el vínculo
                    // por la caja, o la nueva, que también acepta el device_id del
                    // monitor. Probar ambos IDs no amplía permisos: la RPC sigue
                    // validando auth.uid() y el vínculo activo en el servidor.
                    const targets = [...new Set([monitorDeviceId, primaryDeviceId].filter(Boolean))];
                    let lastResponse = { error: new Error('No se encontró un identificador de vínculo') };

                    for (const target of targets) {
                        const response = await supabaseCloud.rpc('unpair_monitor', {
                            p_device_id: target,
                        });
                        if (!response.error) return response;
                        lastResponse = response;
                    }

                    return lastResponse;
                },
                serverAlreadyRevoked: resumeCleanup,
                onServerRevoked: () => setDisconnectServerRevoked(true),
                verifyPairingRevoked: async (deviceId) => {
                    if (!supabaseCloud) return false;
                    const { session, error: sessionError } = await ensureSupervisorSession();
                    if (sessionError || !session?.user?.id) return false;

                    const { data, error } = await supabaseCloud
                        .from('device_pairings')
                        // Mantener esta verificación compatible con instalaciones
                        // que todavía no tienen las columnas del segundo monitor.
                        .select('monitor_auth_id, revoked_at')
                        .eq('primary_device_id', deviceId)
                        .maybeSingle();
                    if (error) return false;

                    // La ausencia por RLS no basta: podría ocultar un error de permisos.
                    return isPairingRevocationConfirmed(data, session.user.id);
                },
                idbStore: monitorStore,
                localStorage,
                onRemoteRevoked: stopMonitorSync,
            });

            setShowDisconnectConfirm(false);
            showToast('Dispositivo desvinculado en el servidor; los datos locales se limpiaron', 'success');
            setTimeout(() => window.location.reload(), 1000);
        } catch (error) {
            console.warn('[OwnerMonitorView] No se pudo completar la desvinculación:', error);
            const serverWasRevoked = localStorage.getItem(MONITOR_CLEANUP_PENDING_KEY) === 'true'
                || error?.phase === 'cleanup';
            setDisconnectServerRevoked(serverWasRevoked);
            if (serverWasRevoked) await stopMonitorSync().catch(() => {});
            setDisconnectError(error?.message || 'No se pudo confirmar la desvinculación. Puedes reintentar.');
        } finally {
            disconnectingRef.current = false;
            setDisconnecting(false);
        }
    };

    // Eliminación remota de producto con confirmación profesional
    const handleConfirmDeleteProductRemote = async () => {
        if (!productToDeleteRemote) return;
        if (!SUPERVISOR_REMOTE_MUTATIONS_ENABLED) {
            showToast?.('Las mutaciones remotas están temporalmente deshabilitadas por seguridad', 'warning');
            return;
        }
        triggerHaptic?.();
        setDeletingRemoteProduct(true);
        try {
            // Propuesta 5: sin conexión la baja se guarda en la cola local y se
            // sube sola cuando vuelva (o con SUBIR AL SISTEMA).
            const payload = { productId: productToDeleteRemote.id, productName: productToDeleteRemote.name };
            const result = await sendOrQueueSupervisorCommand({
                type: 'supervisor.product.delete',
                payload,
                targetDeviceId: pairedDeviceId,
                label: `la baja de "${productToDeleteRemote.name}"`,
                canSend: remoteActionsAvailable,
                send: (args) => sendSupervisorCommand(args),
            });
            if (!result.ok) {
                showToast?.(result.error, result.status === 'disabled' ? 'warning' : 'error');
                return;
            }
            if (result.queued) {
                showToast?.(`"${productToDeleteRemote.name}" se eliminará cuando vuelva la conexión (guardado en cola)`, 'info');
                setProductToDeleteRemote(null);
                return;
            }
            // "Confirma y sigue": se cierra al quedar la orden registrada; el
            // resultado (éxito siempre, o error con motivo) llega por el tracker.
            trackSupervisorCommand({
                commandId: result.commandId,
                type: 'supervisor.product.delete',
                payload,
                label: `la baja de "${productToDeleteRemote.name}"`,
                ackPromise: result.ackPromise,
            });
            // Eco optimista: el producto desaparece de la lista al instante y
            // vuelve solo si la caja rechaza la baja.
            addOptimisticProductEcho({
                action: 'delete',
                productId: productToDeleteRemote.id,
                commandId: result.commandId,
                ackPromise: result.ackPromise,
            });
            setProductToDeleteRemote(null);
        } catch (e) {
            showToast?.('Error al eliminar producto', 'error');
        } finally {
            setDeletingRemoteProduct(false);
        }
    };

    // Formateadores
    const formatTime = (isoString) => {
        if (!isoString) return '';
        try {
            const date = new Date(isoString);
            return date.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        } catch {
            return '';
        }
    };

    // Determinar si la caja está actualmente inactiva (sin turno abierto)
    const isShiftActive = activeShiftApertura !== null || activeShiftSales.length > 0;
    const connectionLabel = isConnected
        ? (syncState === SUPERVISOR_SYNC_STATES.CONNECTED ? 'En Vivo' : 'Sincronizando')
        : syncState === SUPERVISOR_SYNC_STATES.PULLING
            ? 'Recuperando'
            : syncState === SUPERVISOR_SYNC_STATES.DEGRADED
                ? 'Conexión degradada'
                : 'Desconectado';

    const connectionLabelMobile = isConnected
        ? (syncState === SUPERVISOR_SYNC_STATES.CONNECTED ? 'En Vivo' : 'Sinc.')
        : syncState === SUPERVISOR_SYNC_STATES.PULLING
            ? 'Recup.'
            : syncState === SUPERVISOR_SYNC_STATES.DEGRADED
                ? 'Degradada'
                : 'Desconectado';

    return (
        <div data-testid="supervisor-panel" className="min-h-screen w-full min-w-0 bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 font-sans pb-12 transition-colors duration-300 overflow-x-hidden">
            {/* Header del Monitor */}
            <header
                data-testid="supervisor-header"
                style={{ paddingTop: 'max(0.625rem, env(safe-area-inset-top))' }}
                className="sticky top-0 z-50 flex flex-col items-stretch justify-between gap-2 border-b border-slate-200 bg-white/95 px-3 pb-2.5 shadow-sm backdrop-blur-md dark:border-slate-800 dark:bg-slate-900/95 sm:flex-row sm:items-center sm:px-4 sm:py-3"
            >
                <div className="flex min-w-0 w-full items-center gap-2.5 sm:flex-1 sm:gap-3">
                    <div className="h-9 w-9 shrink-0 overflow-hidden rounded-2xl shadow-lg shadow-emerald-500/20 sm:h-10 sm:w-10">
                        <img
                            src="/pwa-192x192.png"
                            alt=""
                            aria-hidden="true"
                            className="h-full w-full object-cover"
                        />
                    </div>
                    <div className="min-w-0">
                        <h1 className="text-sm sm:text-base font-black leading-tight text-slate-800 dark:text-white truncate">Panel de Supervisión</h1>
                        <p className="text-[9px] sm:text-[10px] text-slate-400 font-medium truncate">Monitoreo en vivo • {localStorage.getItem('business_name') || 'Mi Negocio'}</p>
                    </div>
                </div>

                <div className="flex w-full sm:w-auto shrink-0 items-center justify-between sm:justify-end gap-1.5 sm:gap-3 sm:pl-3 overflow-x-auto no-scrollbar py-0.5">
                    {/* Status Badge */}
                    <div data-testid="supervisor-connection-status" className={`flex items-center gap-1.5 px-2 sm:px-3 py-1.5 rounded-full text-[9px] sm:text-[10px] font-black tracking-wider uppercase shadow-xs transition-colors duration-300 shrink-0 ${
                        isConnected 
                            ? 'bg-emerald-50 border border-emerald-200/50 text-emerald-600 dark:bg-emerald-950/20 dark:border-emerald-800/30 dark:text-emerald-400' 
                            : 'bg-rose-50 border border-rose-200/50 text-rose-600 dark:bg-rose-950/20 dark:border-rose-800/30 dark:text-rose-400 animate-pulse'
                    }`}>
                        {isConnected ? (
                            <>
                                <Wifi size={12} className="shrink-0" />
                                <span>
                                    <span className="hidden sm:inline">{connectionLabel}</span>
                                    <span className="sm:hidden">{connectionLabelMobile}</span>
                                </span>
                            </>
                        ) : (
                            <>
                                <WifiOff size={12} className="shrink-0" />
                                <span>
                                    <span className="hidden sm:inline">{connectionLabel}</span>
                                    <span className="sm:hidden">{connectionLabelMobile}</span>
                                </span>
                            </>
                        )}
                    </div>

                    <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                        <button
                            onClick={() => { triggerHaptic?.(); setShowCommandDiagnostics(true); }}
                            className="min-h-9 min-w-9 sm:min-h-11 sm:min-w-11 p-1.5 sm:p-2.5 rounded-xl sm:rounded-2xl text-slate-400 hover:text-blue-500 hover:bg-blue-50 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:hover:text-blue-400 transition-colors flex items-center justify-center shrink-0"
                            title="Diagnóstico de Comandos"
                            aria-label="Diagnóstico de Comandos"
                        >
                            <Activity size={15} />
                        </button>

                        <button
                            onClick={() => { triggerHaptic?.(); setShowSyncDiagnostics(true); }}
                            className="min-h-9 min-w-9 sm:min-h-11 sm:min-w-11 p-1.5 sm:p-2.5 rounded-xl sm:rounded-2xl text-slate-400 hover:text-blue-500 hover:bg-blue-50 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:hover:text-blue-400 transition-colors flex items-center justify-center shrink-0"
                            title="Diagnóstico de Sincronización"
                            aria-label="Diagnóstico de Sincronización"
                        >
                            <Radio size={15} />
                        </button>

                        <button 
                            onClick={async () => { 
                                triggerHaptic?.();
                                const result = await triggerRefresh();
                                if (result?.ok) {
                                    showToast?.('Datos actualizados', 'success');
                                } else {
                                    showToast?.(result?.error || 'No se pudieron actualizar los datos', 'error');
                                }
                            }}
                            disabled={syncLoading}
                            className="min-h-9 min-w-9 sm:min-h-11 sm:min-w-11 p-1.5 sm:p-2.5 rounded-xl sm:rounded-2xl text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:hover:text-emerald-400 transition-colors disabled:opacity-50 flex items-center justify-center shrink-0"
                            title="Actualizar Datos"
                            aria-label="Actualizar Datos"
                        >
                            <RefreshCw size={15} className={syncLoading ? "animate-spin text-emerald-500" : ""} />
                        </button>

                        <button 
                            onClick={() => { triggerHaptic?.(); setShowRateModal(true); }}
                            disabled={!remoteActionsAvailable}
                            className="min-h-9 min-w-9 sm:min-h-11 flex items-center justify-center gap-1 rounded-xl sm:rounded-2xl border border-emerald-200 bg-emerald-50 px-2 sm:px-3 py-1.5 sm:py-2 text-[10px] sm:text-xs font-bold text-emerald-700 shadow-xs transition-all hover:bg-emerald-100 active:scale-95 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300 shrink-0"
                            title="Ajustar Tasa Remota"
                        >
                            <TrendingUp size={13} className="shrink-0" />
                            <span className="hidden sm:inline">Ajustar Tasa</span><span className="sm:hidden">Tasa</span>
                        </button>

                        <button 
                            onClick={() => {
                                triggerHaptic?.();
                                const cleanupPending = localStorage.getItem(MONITOR_CLEANUP_PENDING_KEY) === 'true';
                                setDisconnectServerRevoked(cleanupPending);
                                setDisconnectError(cleanupPending ? 'El vínculo ya fue revocado; falta limpiar la copia local.' : '');
                                setShowDisconnectConfirm(true);
                            }}
                            disabled={disconnecting}
                            className="min-h-9 min-w-9 sm:min-h-11 sm:min-w-11 p-1.5 sm:p-2.5 rounded-xl sm:rounded-2xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:hover:text-rose-400 transition-colors disabled:opacity-50 flex items-center justify-center shrink-0"
                            title="Desvincular Dispositivo"
                            aria-label="Desvincular Dispositivo"
                        >
                            <LogOut size={15} />
                        </button>
                    </div>
                </div>
            </header>

            {/* Banner Offline */}
            {!isConnected && lastSync && (
                <div className="mx-4 mt-4 p-3.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200/50 dark:border-amber-900/30 rounded-2xl flex gap-3 items-center text-amber-800 dark:text-amber-400 shadow-sm animate-fade-in">
                    <Clock size={18} className="shrink-0" />
                    <p className="text-xs font-semibold leading-relaxed">
                        Sin conexión a internet. Mostrando últimos datos sincronizados el {lastSync.toLocaleDateString()} a las {lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.
                    </p>
                </div>
            )}

            {syncError && (
                <div className="mx-4 mt-4 p-3.5 bg-rose-50 dark:bg-rose-950/20 border border-rose-200/50 dark:border-rose-900/30 rounded-2xl flex gap-3 items-center text-rose-800 dark:text-rose-400 shadow-sm animate-fade-in">
                    <AlertTriangle size={18} className="shrink-0" />
                    <p className="text-xs font-semibold leading-relaxed">
                        {syncState === SUPERVISOR_SYNC_STATES.DEGRADED && lastSync
                            ? `Conexión degradada. Mostrando los últimos datos confirmados. ${syncError}`
                            : syncError}
                    </p>
                </div>
            )}

            {/* Contenido Principal */}
            <main data-testid="supervisor-main" className="max-w-7xl mx-auto w-full min-w-0 px-3 sm:px-4 mt-4 sm:mt-6 space-y-5 sm:space-y-6 pb-24 sm:pb-8">
                {/* Selector de Pestañas / Barra de Navegación Responsiva (Bottom Nav en Móvil / Pill Bar en Escritorio) */}
                <div 
                    data-testid="supervisor-tabs" 
                    className="fixed bottom-0 inset-x-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200/80 dark:border-slate-800 p-1.5 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-lg flex justify-around sm:static sm:z-auto sm:border-0 sm:shadow-sm sm:max-w-2xl sm:p-1 sm:rounded-2xl sm:bg-slate-200/60 sm:dark:bg-slate-900/60 sm:overflow-x-auto sm:scrollbar-hide"
                >
                    <button
                        onClick={() => { triggerHaptic?.(); setViewTab('activo'); }}
                        className={`shrink-0 min-h-12 sm:min-h-11 flex-1 py-1.5 sm:py-2 px-2 sm:px-3 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 text-[10px] sm:text-xs font-black rounded-xl transition-all whitespace-nowrap active:scale-95 ${
                            viewTab === 'activo' 
                                ? 'bg-white dark:bg-slate-800 text-slate-850 dark:text-white shadow-sm' 
                                : 'text-slate-400 hover:text-slate-650 dark:hover:text-slate-200'
                        }`}
                    >
                        <Clock size={17} className={viewTab === 'activo' ? 'text-primary-600 dark:text-primary-400' : 'text-slate-400'} />
                        <span>Turno Activo</span>
                    </button>
                    <button
                        onClick={() => { triggerHaptic?.(); setViewTab('cierres'); }}
                        className={`shrink-0 min-h-12 sm:min-h-11 flex-1 py-1.5 sm:py-2 px-2 sm:px-3 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 text-[10px] sm:text-xs font-black rounded-xl transition-all whitespace-nowrap active:scale-95 ${
                            viewTab === 'cierres' 
                                ? 'bg-white dark:bg-slate-800 text-slate-850 dark:text-white shadow-sm' 
                                : 'text-slate-400 hover:text-slate-650 dark:hover:text-slate-200'
                        }`}
                    >
                        <FileText size={17} className={viewTab === 'cierres' ? 'text-primary-600 dark:text-primary-400' : 'text-slate-400'} />
                        <span>Cierres</span>
                    </button>
                    <button
                        onClick={() => { triggerHaptic?.(); setViewTab('inventario'); }}
                        className={`shrink-0 min-h-12 sm:min-h-11 flex-1 py-1.5 sm:py-2 px-2 sm:px-3 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 text-[10px] sm:text-xs font-black rounded-xl transition-all whitespace-nowrap active:scale-95 ${
                            viewTab === 'inventario' 
                                ? 'bg-white dark:bg-slate-800 text-slate-850 dark:text-white shadow-sm' 
                                : 'text-slate-400 hover:text-slate-650 dark:hover:text-slate-200'
                        }`}
                    >
                        <Package size={17} className={viewTab === 'inventario' ? 'text-primary-600 dark:text-primary-400' : 'text-slate-400'} />
                        <span>Inventario</span>
                    </button>
                    <button
                        onClick={() => { triggerHaptic?.(); setViewTab('control'); }}
                        className={`shrink-0 min-h-12 sm:min-h-11 flex-1 py-1.5 sm:py-2 px-2 sm:px-3 flex flex-col sm:flex-row items-center justify-center gap-1 sm:gap-2 text-[10px] sm:text-xs font-black rounded-xl transition-all whitespace-nowrap active:scale-95 ${
                            viewTab === 'control'
                                ? 'bg-white dark:bg-slate-800 text-slate-850 dark:text-white shadow-sm'
                                : 'text-slate-400 hover:text-slate-650 dark:hover:text-slate-200'
                        }`}
                    >
                        <ShieldCheck size={17} className={viewTab === 'control' ? 'text-primary-600 dark:text-primary-400' : 'text-slate-400'} />
                        <span>Control</span>
                    </button>
                </div>

                {viewTab === 'control' && (
                    <SupervisorControlPanel
                        control={supervisorControl}
                        isConnected={isConnected}
                        onToast={showToast}
                        resolveName={resolveProductName}
                    />
                )}

                {/* ── SECCIÓN 1: TURNO ACTIVO ── */}
                {viewTab === 'activo' && (
                    <div className="space-y-6">
                        {/* Barra de Estado de Turno y Acciones Remotas */}
                        <div className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm flex flex-wrap items-center justify-between gap-3">
                            <div className="flex items-center gap-3">
                                <div className={`w-3 h-3 rounded-full ${isShiftActive ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'}`} />
                                <div>
                                    <span className="text-xs font-black text-slate-800 dark:text-white block">
                                        {isShiftActive ? 'Turno Activo en Caja' : 'Caja Inactiva / Sin Turno Abierto'}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-medium block">
                                        Cajero: {activeCashier.nombre} {activeShiftApertura?.timestamp ? `• Abierto a las ${formatTime(activeShiftApertura.timestamp)}` : ''}
                                    </span>
                                </div>
                            </div>

                            {isShiftActive ? (
                                <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-800/40 text-[10px] font-black uppercase tracking-wider shrink-0">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                                    En Curso
                                </span>
                            ) : null}
                        </div>

                        {/* Control de Caja y Arqueo en Vivo: Monto de Apertura y Efectivo Esperado */}
                        {isShiftActive && (
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                                {/* Tarjeta: Monto de Apertura */}
                                <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between relative overflow-hidden">
                                    <div className="flex items-center justify-between w-full">
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-8 h-8 sm:w-9 sm:h-9 bg-amber-50 dark:bg-amber-950/30 rounded-xl flex items-center justify-center text-amber-600 dark:text-amber-400 shrink-0">
                                                <ArrowDownRight size={17} />
                                            </div>
                                            <div>
                                                <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200 block">
                                                    Monto de Apertura
                                                </span>
                                                <span className="text-[9px] text-slate-400 font-medium block">
                                                    Fondo inicial en caja
                                                </span>
                                            </div>
                                        </div>
                                        {activeShiftApertura?.timestamp && (
                                            <span className="text-[10px] font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 px-2 py-0.5 rounded-lg shrink-0">
                                                {formatTime(activeShiftApertura.timestamp)}
                                            </span>
                                        )}
                                    </div>
                                    <div className="mt-3.5 pt-3 border-t border-slate-100 dark:border-slate-800/60 grid grid-cols-2 gap-3">
                                        <div className="min-w-0">
                                            <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">USD Inicial</span>
                                            <span className="font-outfit text-base sm:text-xl font-black text-slate-800 dark:text-white tabular-nums block truncate">
                                                ${openingUsd.toFixed(2)}
                                            </span>
                                        </div>
                                        <div className="min-w-0">
                                            <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">Bs Inicial</span>
                                            <span className="font-outfit text-base sm:text-xl font-black text-amber-600 dark:text-amber-400 tabular-nums block truncate">
                                                {formatBs(openingBs)} Bs
                                            </span>
                                        </div>
                                        {shouldShowSupervisorCop(copEnabled) && openingCop > 0 && (
                                            <div className="min-w-0 col-span-2 pt-1 border-t border-slate-100 dark:border-slate-800/40">
                                                <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">COP Inicial</span>
                                                <span className="font-outfit text-sm font-black text-slate-700 dark:text-slate-300 tabular-nums block truncate">
                                                    {formatCop(openingCop)} COP
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Tarjeta: Efectivo Esperado en Caja */}
                                <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-emerald-200/60 dark:border-emerald-800/60 shadow-sm flex flex-col justify-between relative overflow-hidden bg-gradient-to-br from-emerald-50/20 via-white to-white dark:from-emerald-950/10 dark:via-slate-900 dark:to-slate-900">
                                    <div className="flex items-center justify-between w-full">
                                        <div className="flex items-center gap-2.5">
                                            <div className="w-8 h-8 sm:w-9 sm:h-9 bg-emerald-100 dark:bg-emerald-950/40 rounded-xl flex items-center justify-center text-emerald-600 dark:text-emerald-400 shrink-0">
                                                <Wallet size={17} />
                                            </div>
                                            <div>
                                                <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider text-slate-800 dark:text-white block">
                                                    Efectivo Esperado en Caja
                                                </span>
                                                <span className="text-[9px] text-emerald-600 dark:text-emerald-400 font-semibold block">
                                                    Físico en gaveta (arqueo)
                                                </span>
                                            </div>
                                        </div>
                                        <span className="text-[9px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300 bg-emerald-100/80 dark:bg-emerald-950/60 px-2 py-0.5 rounded-lg shrink-0">
                                            Gaveta
                                        </span>
                                    </div>
                                    <div className="mt-3.5 pt-3 border-t border-emerald-100/60 dark:border-emerald-900/40 grid grid-cols-2 gap-3">
                                        <div className="min-w-0">
                                            <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">USD Esperado</span>
                                            <span className="font-outfit text-base sm:text-xl font-black text-slate-850 dark:text-white tabular-nums block truncate">
                                                ${expectedCashUsd.toFixed(2)}
                                            </span>
                                        </div>
                                        <div className="min-w-0">
                                            <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">Bs Esperado</span>
                                            <span className="font-outfit text-base sm:text-xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums block truncate">
                                                {formatBs(expectedCashBs)} Bs
                                            </span>
                                        </div>
                                        {shouldShowSupervisorCop(copEnabled) && (expectedCashCop > 0 || openingCop > 0) && (
                                            <div className="min-w-0 col-span-2 pt-1 border-t border-emerald-100/40 dark:border-emerald-900/30">
                                                <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">COP Esperado</span>
                                                <span className="font-outfit text-sm font-black text-slate-700 dark:text-slate-300 tabular-nums block truncate">
                                                    {formatCop(expectedCashCop)} COP
                                                </span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            </div>
                        )}

                        {/* Fila 1: Tarjetas de Métricas de Ventas de Turno Activo */}
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
                            {/* Ventas Turno USD */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[105px] sm:min-h-[125px]">
                                <div className="flex items-center justify-between w-full">
                                    <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Vendido Turno (USD)</span>
                                    <div className="w-7 h-7 sm:w-9 sm:h-9 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl flex items-center justify-center text-emerald-500 shrink-0">
                                        <DollarSign size={16} />
                                    </div>
                                </div>
                                <div className="mt-2.5 min-w-0">
                                    <span className="font-outfit text-base sm:text-xl lg:text-2xl font-black text-slate-800 dark:text-white tabular-nums block break-words leading-none">
                                        ${activeShiftMetrics.totalUsd.toFixed(2)}
                                    </span>
                                </div>
                            </div>

                            {/* Ventas Turno Bs */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[105px] sm:min-h-[125px]">
                                <div className="flex items-center justify-between w-full">
                                    <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Vendido Turno (Bs)</span>
                                    <div className="w-7 h-7 sm:w-9 sm:h-9 bg-emerald-50 dark:bg-emerald-950/20 rounded-xl flex items-center justify-center text-emerald-500 shrink-0">
                                        <Coins size={16} />
                                    </div>
                                </div>
                                <div className="mt-2.5 min-w-0">
                                    <span className="font-outfit text-base sm:text-xl lg:text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums block break-words leading-none">
                                        {formatBs(activeShiftMetrics.totalBs)} Bs
                                    </span>
                                    <span className="text-[9px] text-slate-400 block font-medium mt-1">
                                        Tasa: {bcvRate ? `${bcvRate.toFixed(2)} Bs/$` : 'N/D'}
                                    </span>
                                </div>
                            </div>

                            {/* Margen Estimado Turno */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[105px] sm:min-h-[125px]">
                                <div className="flex items-center justify-between w-full">
                                    <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Ganancia Turno</span>
                                    <div className="w-7 h-7 sm:w-9 sm:h-9 bg-blue-50 dark:bg-blue-950/20 rounded-xl flex items-center justify-center text-blue-500 shrink-0">
                                        <TrendingUp size={16} />
                                    </div>
                                </div>
                                <div className="mt-2.5 min-w-0">
                                    <span className="font-outfit text-base sm:text-xl lg:text-2xl font-black text-blue-600 dark:text-blue-400 tabular-nums block break-words leading-none">
                                        ${activeShiftMetrics.profitUsd.toFixed(2)}
                                    </span>
                                </div>
                            </div>

                            {/* Cajero Activo */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[105px] sm:min-h-[125px]">
                                <div className="flex items-center justify-between w-full">
                                    <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Cajero de Turno</span>
                                    <div className="w-7 h-7 sm:w-9 sm:h-9 bg-slate-50 dark:bg-slate-800/50 rounded-xl flex items-center justify-center text-slate-450 shrink-0">
                                        <Users size={16} />
                                    </div>
                                </div>
                                <div className="mt-2.5 min-w-0">
                                    <span className="text-sm sm:text-base lg:text-lg font-black text-slate-800 dark:text-white block truncate leading-none">
                                        {isShiftActive ? activeCashier.nombre : 'Ninguno'}
                                    </span>
                                    <span className="text-[9px] text-slate-400 block font-medium mt-1">
                                        {activeShiftMetrics.count} {activeShiftMetrics.count === 1 ? 'venta' : 'ventas'} en curso
                                    </span>
                                </div>
                            </div>
                        </div>

                        {/* Si la caja no está activa */}
                        {!isShiftActive ? (
                            <div className="py-16 px-6 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm space-y-4 max-w-lg mx-auto flex flex-col items-center">
                                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 text-slate-450 rounded-full">
                                    <Clock size={42} />
                                </div>
                                <div className="space-y-1">
                                    <h4 className="text-sm font-black text-slate-800 dark:text-white">Caja Cerrada / Turno Inactivo</h4>
                                    <p className="text-xs text-slate-400 leading-relaxed px-4">
                                        No hay un turno de caja activo en este momento. Abre la caja en el dispositivo del punto de venta para comenzar a registrar movimientos en vivo.
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-6">
                                {/* Desglose Diario por Método de Pago */}
                                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm overflow-hidden">
                                    <div className="p-5 sm:p-6 border-b border-slate-100 dark:border-slate-800/80">
                                        <div className="flex items-center justify-between">
                                            <h3 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                                                <Wallet size={18} className="text-violet-500" />
                                                Ingresos del Turno Activo
                                            </h3>
                                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-xl">
                                                En Curso
                                            </span>
                                        </div>
                                    </div>

                                    <div className="p-5 sm:p-6">
                                        {/* Apertura de caja */}
                                        <div className="mb-5 p-4 bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800/50 rounded-2xl">
                                            <div className="flex items-center gap-2 mb-3">
                                                <div className="w-7 h-7 bg-amber-100 dark:bg-amber-950/30 rounded-lg flex items-center justify-center">
                                                    <ArrowDownRight size={14} className="text-amber-600 dark:text-amber-400" />
                                                </div>
                                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">Fondo de Apertura de Turno</span>
                                            </div>
                                            {activeShiftApertura ? (
                                                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                                                    <div className="space-y-0.5">
                                                        <span className="text-[9px] font-bold text-slate-400 uppercase block">USD Inicial</span>
                                                        <span className="font-outfit text-sm font-black text-slate-700 dark:text-slate-200 tabular-nums">${(activeShiftApertura.openingUsd || 0).toFixed(2)}</span>
                                                    </div>
                                                    <div className="space-y-0.5">
                                                        <span className="text-[9px] font-bold text-slate-400 uppercase block">Bs Inicial</span>
                                                        <span className="font-outfit text-sm font-black text-slate-700 dark:text-slate-200 tabular-nums">{formatBs(activeShiftApertura.openingBs || 0)} Bs</span>
                                                    </div>
                                                    {shouldShowCop && activeShiftApertura.openingCop > 0 && (
                                                        <div className="space-y-0.5">
                                                            <span className="text-[9px] font-bold text-slate-400 uppercase block">COP Inicial</span>
                                                            <span className="font-outfit text-sm font-black text-slate-700 dark:text-slate-200 tabular-nums">{(activeShiftApertura.openingCop || 0).toLocaleString()} COP</span>
                                                        </div>
                                                    )}
                                                    <div className="space-y-0.5 col-span-2 sm:col-span-3">
                                                        <span className="text-[9px] font-bold text-slate-400 uppercase block">Hora de apertura</span>
                                                        <span className="text-xs font-bold text-slate-500">{formatTime(activeShiftApertura.timestamp)}</span>
                                                    </div>
                                                </div>
                                            ) : (
                                                <p className="text-xs text-slate-400 font-bold">Caja iniciada sin fondo declarado.</p>
                                            )}
                                        </div>

                                        {/* Tabla desglose */}
                                        {activeShiftPaymentBreakdown.length === 0 ? (
                                            <div className="py-8 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                                                <Wallet size={28} className="mx-auto text-slate-300 mb-2" />
                                                <p className="text-xs font-black">Sin ventas cobradas en este turno</p>
                                                <p className="text-[10px] text-slate-450 mt-1">Los gastos, avances y ajustes no se cuentan como ingresos.</p>
                                            </div>
                                        ) : (
                                            <div className="space-y-2.5">
                                                {activeShiftPaymentBreakdown
                                                    .filter(([methodId]) => copEnabled || !methodId.toLowerCase().includes('cop'))
                                                    .map(([methodId, data]) => {
                                                        const IconComp = getMethodIcon(methodId);
                                                        const pct = activeShiftMetrics.totalUsd > 0
                                                            ? Math.round((data.totalUsd / activeShiftMetrics.totalUsd) * 100)
                                                            : 0;

                                                        return (
                                                            <div key={methodId} className="flex items-center gap-3 p-3.5 bg-slate-50/70 dark:bg-slate-800/20 border border-slate-100 dark:border-slate-800/40 rounded-2xl hover:bg-slate-50 dark:hover:bg-slate-800/30 transition-colors">
                                                                <div className="w-9 h-9 bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60 rounded-xl flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0 shadow-sm">
                                                                    <IconComp size={16} />
                                                                </div>
                                                                <div className="flex-1 min-w-0">
                                                                    <div className="flex items-center justify-between gap-2">
                                                                        <span className="text-xs font-black text-slate-700 dark:text-slate-200 truncate">{data.label}</span>
                                                                        <span className="font-outfit text-xs font-black text-slate-800 dark:text-white tabular-nums shrink-0">${data.totalUsd.toFixed(2)}</span>
                                                                    </div>
                                                                    <div className="flex items-center justify-between gap-2 mt-1">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-[9px] font-bold text-slate-400">{data.count} {data.count === 1 ? 'transacción' : 'transacciones'}</span>
                                                                            <span className="text-[9px] font-black text-violet-500 bg-violet-50 dark:bg-violet-950/20 dark:text-violet-400 px-1.5 py-0.5 rounded-md">{pct}%</span>
                                                                        </div>
                                                                        <span className="font-outfit text-[10px] font-bold text-slate-400 tabular-nums">{formatBs(data.totalBs)} Bs</span>
                                                                    </div>
                                                                    <div className="mt-1.5 h-1 bg-slate-200/60 dark:bg-slate-800 rounded-full overflow-hidden">
                                                                        <div
                                                                            className="h-full bg-gradient-to-r from-emerald-400 to-emerald-500 rounded-full transition-all duration-500"
                                                                            style={{ width: `${Math.max(2, pct)}%` }}
                                                                        />
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        );
                                                    })}
                                            </div>
                                        )}

                                        {/* Resumen total: siempre representa ventas válidas del turno, no movimientos operativos. */}
                                        <div className="mt-3 pt-3 border-t border-slate-200/60 dark:border-slate-800 flex items-center justify-between px-1">
                                            <div className="flex items-center gap-2">
                                                <Hash size={14} className="text-slate-400" />
                                                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                                                    Total Acumulado ({activeShiftMetrics.count} {activeShiftMetrics.count === 1 ? 'venta' : 'ventas'})
                                                </span>
                                            </div>
                                            <div className="text-right">
                                                <span className="font-outfit text-sm font-black text-slate-850 dark:text-white tabular-nums">${activeShiftMetrics.totalUsd.toFixed(2)}</span>
                                                <span className="font-outfit text-[10px] font-bold text-slate-400 ml-2">{formatBs(activeShiftMetrics.totalBs)} Bs</span>
                                            </div>
                                        </div>

                                        {/* Ticket promedio */}
                                        <div className="flex items-center justify-between px-1 mt-1">
                                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Ticket Promedio</span>
                                            <span className="font-outfit text-xs font-black text-blue-650 dark:text-blue-400 tabular-nums">
                                                {activeShiftSales.length > 0 ? `$${activeShiftAvgTicket.toFixed(2)}` : '—'}
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {/* Dashboard de Columnas */}
                                <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                    {/* Columna Izquierda: Listado de Ventas en Vivo */}
                                    <div className="lg:col-span-2 space-y-4">
                                        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-4 sm:p-6 shadow-sm min-w-0 overflow-hidden">
                                            <h3 className="text-sm font-black text-slate-800 dark:text-white mb-4 flex items-center gap-2">
                                                <FileText size={18} className="text-slate-400" />
                                                Ventas del Turno en Tiempo Real
                                            </h3>
                                            
                                            {loadingData || syncLoading ? (
                                                <div className="py-8 flex justify-center text-slate-400 gap-2 items-center">
                                                    <RefreshCw className="animate-spin" size={18} />
                                                    <span className="text-xs font-bold">Cargando transacciones...</span>
                                                </div>
                                            ) : activeShiftSales.length === 0 ? (
                                                <div className="py-12 text-center text-slate-400 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl">
                                                    <Clock size={36} className="mx-auto text-slate-350 dark:text-slate-700 mb-2" />
                                                    <p className="text-xs font-black">No se han registrado ventas en este turno</p>
                                                    <p className="text-[10px] text-slate-400 mt-1">Las ventas de la caja activa aparecerán aquí al instante.</p>
                                                </div>
                                            ) : (
                                                <div className="space-y-3 max-h-[550px] overflow-y-auto pr-1">
                                                    {activeShiftSales.slice().reverse().map(sale => (
                                                        <div 
                                                            key={sale.id}
                                                            className="p-4 border border-slate-100 dark:border-slate-800/80 hover:border-slate-200 rounded-2xl bg-slate-50/50 dark:bg-slate-800/20 flex justify-between items-start transition-colors"
                                                        >
                                                            <div className="space-y-1 min-w-0 flex-1 pr-3">
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400">
                                                                        #{sale.id.slice(-4).toUpperCase()}
                                                                    </span>
                                                                    <span className="text-[10px] text-slate-400 font-bold">{formatTime(sale.timestamp)}</span>
                                                                </div>
                                                                <p className="text-xs font-black text-slate-700 dark:text-slate-200 mt-1.5 truncate">
                                                                    {sale.items?.map(i => `${i.name} (x${i.qty})`).join(', ') || 'Venta de productos'}
                                                                </p>
                                                                <div className="flex gap-2 items-center mt-1">
                                                                    <span className="text-[10px] font-black text-slate-400 uppercase">{sale.metodoPago || sale.paymentMethod || 'Efectivo'}</span>
                                                                    {sale.clientName && (
                                                                        <span className="text-[10px] text-slate-400 font-bold">• {sale.clientName}</span>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            <div className="text-right space-y-0.5 shrink-0">
                                                                <span className="font-outfit text-sm font-black text-slate-800 dark:text-white block">${(sale.totalUsd || 0).toFixed(2)}</span>
                                                                <span className="font-outfit text-[10px] font-bold text-slate-400 block">{formatBs(sale.totalBs || 0)} Bs</span>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Columna Derecha: Stock Crítico */}
                                    <div className="space-y-6">
                                        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-4 sm:p-5 shadow-sm min-w-0 overflow-hidden">
                                            {/* Cabecera de la Tarjeta */}
                                            <div className="flex items-center justify-between mb-3 gap-2">
                                                <h3 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2 truncate">
                                                    <Package size={18} className="text-amber-500 shrink-0" />
                                                    <span>Stock Crítico</span>
                                                </h3>
                                                <span className="text-[10px] font-black px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-350 shrink-0">
                                                    {allCriticalProducts.length} total
                                                </span>
                                            </div>

                                            {/* Selector Segmentado de Pestañas: Stock Bajo (Primero) y Agotados */}
                                            <div className="p-1 bg-slate-100 dark:bg-slate-800/80 rounded-2xl flex gap-1 mb-3 select-none" role="tablist" aria-label="Filtro de stock crítico">
                                                <button
                                                    type="button"
                                                    role="tab"
                                                    aria-selected={criticalStockTab === 'bajo'}
                                                    onClick={() => {
                                                        triggerHaptic?.();
                                                        setCriticalStockTab('bajo');
                                                    }}
                                                    className={`flex-1 min-h-10 sm:min-h-9 py-1.5 px-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
                                                        criticalStockTab === 'bajo'
                                                            ? 'bg-white dark:bg-slate-900 text-amber-600 dark:text-amber-400 shadow-sm border border-slate-200/60 dark:border-slate-700/60'
                                                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                                    }`}
                                                >
                                                    <span>Stock Bajo</span>
                                                    <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
                                                        criticalStockTab === 'bajo'
                                                            ? 'bg-amber-100 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300'
                                                            : 'bg-slate-200/80 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                                                    }`}>
                                                        {lowStockCount}
                                                    </span>
                                                </button>

                                                <button
                                                    type="button"
                                                    role="tab"
                                                    aria-selected={criticalStockTab === 'agotado'}
                                                    onClick={() => {
                                                        triggerHaptic?.();
                                                        setCriticalStockTab('agotado');
                                                    }}
                                                    className={`flex-1 min-h-10 sm:min-h-9 py-1.5 px-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center gap-1.5 ${
                                                        criticalStockTab === 'agotado'
                                                            ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm border border-slate-200/60 dark:border-slate-700/60'
                                                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                                    }`}
                                                >
                                                    <span>Agotados</span>
                                                    <span className={`text-[10px] font-black px-1.5 py-0.5 rounded-full ${
                                                        criticalStockTab === 'agotado'
                                                            ? 'bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300'
                                                            : 'bg-slate-200/80 dark:bg-slate-700 text-slate-600 dark:text-slate-400'
                                                    }`}>
                                                        {outOfStockCount}
                                                    </span>
                                                </button>

                                                <button
                                                    type="button"
                                                    role="tab"
                                                    aria-selected={criticalStockTab === 'todos'}
                                                    onClick={() => {
                                                        triggerHaptic?.();
                                                        setCriticalStockTab('todos');
                                                    }}
                                                    className={`min-h-10 sm:min-h-9 py-1.5 px-2.5 rounded-xl text-xs font-black transition-all flex items-center justify-center ${
                                                        criticalStockTab === 'todos'
                                                            ? 'bg-white dark:bg-slate-900 text-slate-800 dark:text-white shadow-sm border border-slate-200/60 dark:border-slate-700/60'
                                                            : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                                                    }`}
                                                    title="Ver lista completa"
                                                >
                                                    <span>Todos</span>
                                                </button>
                                            </div>

                                            {/* Lista Escroleable */}
                                            {activeCriticalProducts.length === 0 ? (
                                                <div className="py-8 text-center text-slate-400 space-y-1">
                                                    <p className="text-xs font-black text-emerald-600 dark:text-emerald-400">
                                                        {criticalStockTab === 'bajo'
                                                            ? '¡Sin stock bajo!'
                                                            : criticalStockTab === 'agotado'
                                                            ? '¡Sin agotados!'
                                                            : '¡Todo el inventario en orden!'}
                                                    </p>
                                                    <p className="text-[10px] text-slate-400">
                                                        {criticalStockTab === 'bajo'
                                                            ? 'No hay productos con existencias reducidas.'
                                                            : criticalStockTab === 'agotado'
                                                            ? 'No hay productos totalmente agotados.'
                                                            : 'No hay alertas críticas en la caja.'}
                                                    </p>
                                                </div>
                                            ) : (
                                                <div className="space-y-2 max-h-[320px] overflow-y-auto custom-scrollbar pr-1 select-none">
                                                    {activeCriticalProducts.map(prod => {
                                                        const stock = Number(prod.stock) || 0;
                                                        const isOutOfStock = stock <= 0;
                                                        const rawPrice = prod.price != null ? prod.price : (prod.priceUsdt != null ? prod.priceUsdt : prod.precio);
                                                        const priceVal = Number(rawPrice);
                                                        const priceDisplay = Number.isFinite(priceVal) ? priceVal.toFixed(2) : '0.00';

                                                        return (
                                                            <div
                                                                key={prod.id}
                                                                onClick={() => {
                                                                    if (SUPERVISOR_REMOTE_PRODUCTS_ENABLED && remoteActionsAvailable) {
                                                                        triggerHaptic?.();
                                                                        setProductToEditRemote(prod);
                                                                        setShowProductFormModal(true);
                                                                    }
                                                                }}
                                                                className={`p-2.5 rounded-2xl border border-slate-100 dark:border-slate-800/80 hover:border-slate-200 dark:hover:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30 flex justify-between items-center transition-colors gap-2.5 ${
                                                                    SUPERVISOR_REMOTE_PRODUCTS_ENABLED && remoteActionsAvailable ? 'cursor-pointer hover:bg-slate-100/60 dark:hover:bg-slate-800/60' : ''
                                                                }`}
                                                                title={SUPERVISOR_REMOTE_PRODUCTS_ENABLED && remoteActionsAvailable ? 'Clic para editar producto remotamente' : prod.name}
                                                            >
                                                                <div className="min-w-0 flex-1">
                                                                    <span className="text-xs font-black text-slate-800 dark:text-slate-100 block truncate">
                                                                        {prod.name}
                                                                    </span>
                                                                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-slate-400 font-medium">
                                                                        <span className="font-outfit font-bold text-slate-600 dark:text-slate-350">
                                                                            ${priceDisplay}
                                                                        </span>
                                                                        {prod.barcode && (
                                                                            <>
                                                                                <span>•</span>
                                                                                <span className="font-mono text-[9px] text-slate-400 truncate max-w-[80px]">{prod.barcode}</span>
                                                                            </>
                                                                        )}
                                                                    </div>
                                                                </div>

                                                                {isOutOfStock ? (
                                                                    <span className="text-[10px] font-black px-2 py-0.5 rounded-xl bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 border border-rose-200/60 dark:border-rose-900/40 shrink-0">
                                                                        Agotado
                                                                    </span>
                                                                ) : (
                                                                    <span className="text-[10px] font-black px-2 py-0.5 rounded-xl bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-900/40 shrink-0 flex items-center gap-1">
                                                                        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
                                                                        Bajo ({stock})
                                                                    </span>
                                                                )}
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            )}

                                            {/* Botón dinámico a Inventario */}
                                            <button
                                                onClick={() => {
                                                    triggerHaptic?.();
                                                    setViewTab('inventario');
                                                    setFilterStockInventario(criticalStockTab === 'todos' ? (lowStockCount > 0 ? 'bajo' : 'agotado') : criticalStockTab);
                                                }}
                                                className="w-full mt-3 py-2.5 px-3 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-black border border-slate-200/70 dark:border-slate-700/60 transition-all flex items-center justify-center gap-1.5 active:scale-98 shadow-xs"
                                            >
                                                <span>
                                                    {criticalStockTab === 'bajo'
                                                        ? `Ver los ${lowStockCount} productos con bajo stock en Inventario`
                                                        : criticalStockTab === 'agotado'
                                                        ? `Ver los ${outOfStockCount} productos agotados en Inventario`
                                                        : `Ver los ${allCriticalProducts.length} productos críticos en Inventario`}
                                                </span>
                                                <ChevronRight size={14} className="text-slate-400" />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ── SECCIÓN 2: CIERRES DE CAJA (HISTORIAL + DETALLE ARQUEO) ── */}
                {viewTab === 'cierres' && (
                    <div className="space-y-4">
                        {/* Selector de Rango de Fechas para Cierres */}
                        <div className="flex bg-slate-200/60 dark:bg-slate-900/60 p-1 rounded-2xl w-full max-w-lg shadow-sm overflow-x-auto">
                            {[
                                { id: 'all', label: 'Todos' },
                                { id: 'today', label: 'Hoy' },
                                { id: 'yesterday', label: 'Ayer' },
                                { id: 'week', label: 'Esta Semana' },
                                { id: 'month', label: 'Este Mes' }
                            ].map(range => (
                                <button
                                    key={range.id}
                                    onClick={() => { triggerHaptic?.(); setCierresDateRange(range.id); }}
                                    className={`flex-1 py-1.5 px-3 text-[10px] sm:text-xs font-black rounded-xl transition-all whitespace-nowrap ${
                                        cierresDateRange === range.id
                                            ? 'bg-white dark:bg-slate-800 text-slate-850 dark:text-white shadow-sm'
                                            : 'text-slate-400 hover:text-slate-650 dark:hover:text-slate-200'
                                    }`}
                                >
                                    {range.label}
                                </button>
                            ))}
                        </div>

                        {filteredRegisterCloses.length === 0 ? (
                            <div className="py-16 px-6 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm space-y-4 max-w-lg mx-auto flex flex-col items-center">
                                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 text-slate-450 rounded-full">
                                    <ShieldCheck size={42} />
                                </div>
                                <div className="space-y-1">
                                    <h4 className="text-sm font-black text-slate-800 dark:text-white">
                                        {cierresDateRange === 'all' ? 'Sin cierres registrados' : 'Sin cierres en este período'}
                                    </h4>
                                    <p className="text-xs text-slate-400 leading-relaxed px-4">
                                        {cierresDateRange === 'all' 
                                            ? 'Cuando el cajero complete un cierre de caja en el dispositivo principal, aparecerá el arqueo detallado aquí.' 
                                            : 'No se encontraron registros de cierre para la fecha seleccionada. Intenta cambiar el filtro.'}
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                                {/* Selector / Lista de Cierres */}
                                <div className="bg-white dark:bg-slate-900 border border-slate-200/60 dark:border-slate-800 rounded-3xl p-5 shadow-sm h-fit space-y-4">
                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Historial de Cierres ({filteredRegisterCloses.length})</span>
                                    <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
                                        {filteredRegisterCloses.map(c => {
                                            const dateObj = new Date(c.cierreId);
                                            const isSelected = selectedCierreId === c.cierreId || (!selectedCierreId && filteredRegisterCloses[0].cierreId === c.cierreId);
                                            return (
                                                <button
                                                    key={c.cierreId}
                                                    onClick={() => setSelectedCierreId(c.cierreId)}
                                                    className={`w-full text-left p-3.5 rounded-2xl border transition-all flex items-center justify-between gap-3 ${
                                                        isSelected 
                                                            ? 'bg-emerald-500/10 border-emerald-300 dark:border-emerald-800 text-emerald-800 dark:text-emerald-400' 
                                                            : 'bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/40 dark:hover:bg-slate-800/80 border-slate-200/65 dark:border-slate-800/60 text-slate-600 dark:text-slate-300'
                                                    }`}
                                                >
                                                    <div className="min-w-0 flex-1">
                                                        <span className="text-xs font-black block truncate">
                                                            Cierre #{c.cierreNumber || String(c.cierreId).slice(-4)}
                                                        </span>
                                                        <span className="text-[9px] text-slate-400 font-bold block mt-0.5">
                                                            {dateObj.toLocaleDateString()} • {dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                                        </span>
                                                    </div>
                                                    <span className="font-outfit text-xs font-black tabular-nums shrink-0">${c.totalUsd.toFixed(2)}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>

                                {/* Zona de Resumen del Cierre Seleccionado */}
                                <div className="lg:col-span-2 space-y-6">
                                    {(() => {
                                        const activeC = registerCloses.find(c => c.cierreId === selectedCierreId) || registerCloses[0];
                                        if (!activeC) return null;

                                        const expectedUsd = activeC.reconData?.expectedUsd ?? activeC.totalUsd;
                                        // Declarados
                                        const declaredUsd = activeC.reconData?.cashUsd ?? null;
                                        const declaredBs = activeC.reconData?.cashBs ?? null;
                                        const declaredCop = activeC.reconData?.cashCop ?? null;
                                        const hasDeclaredCop = declaredCop !== null;
                                        
                                        const diffUsd = declaredUsd !== null ? declaredUsd - expectedUsd : null;
                                        const isCuadrado = declaredUsd === null || Math.abs(diffUsd) <= 0.50;

                                        return (
                                            <div className="space-y-6 animate-fade-in">
                                                {/* Resumen Principal */}
                                                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                                                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                                                        <span className="text-[9px] font-black uppercase text-slate-400">Total USD</span>
                                                        <strong className="font-outfit text-base sm:text-lg font-black text-slate-800 dark:text-white block mt-1">${activeC.totalUsd.toFixed(2)}</strong>
                                                    </div>
                                                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                                                        <span className="text-[9px] font-black uppercase text-slate-400">Total Bs</span>
                                                        <strong className="font-outfit text-base sm:text-lg font-black text-emerald-600 dark:text-emerald-400 block mt-1">{formatBs(activeC.totalBs)} Bs</strong>
                                                    </div>
                                                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                                                        <span className="text-[9px] font-black uppercase text-slate-400">Cajero</span>
                                                        <strong className="text-xs font-black text-slate-700 dark:text-slate-200 block truncate mt-1">{activeC.cashier?.nombre || 'Cajero'}</strong>
                                                    </div>
                                                    <div className="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                                                        <span className="text-[9px] font-black uppercase text-slate-400">Arqueo Físico</span>
                                                        <span className={`text-[10px] font-black uppercase tracking-wider px-2 py-0.5 rounded-md inline-block mt-1 ${
                                                            declaredUsd === null 
                                                                ? 'bg-slate-100 dark:bg-slate-800 text-slate-500' 
                                                                : isCuadrado 
                                                                    ? 'bg-emerald-100 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400' 
                                                                    : 'bg-amber-100 dark:bg-amber-955/30 text-amber-700 dark:text-amber-400 animate-pulse'
                                                        }`}>
                                                            {declaredUsd === null ? 'Sin Declarar' : isCuadrado ? 'Cuadrado' : 'Diferencia'}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Arqueo Detallado de Efectivo */}
                                                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-4 sm:p-5 shadow-sm min-w-0 overflow-hidden">
                                                    <h3 className="text-xs font-black text-slate-800 dark:text-white mb-4 uppercase tracking-wider">Cuadre de Efectivo</h3>
                                                    
                                                    {declaredUsd === null ? (
                                                        <div className="py-6 px-4 bg-amber-50/50 dark:bg-amber-950/10 border border-amber-100 dark:border-amber-900/30 rounded-2xl text-center">
                                                            <AlertTriangle size={24} className="text-amber-500 mx-auto mb-1.5" />
                                                            <p className="text-xs font-black text-amber-800 dark:text-amber-400">Cierre simplificado sin arqueo</p>
                                                            <p className="text-[10px] text-slate-500 mt-0.5">El cajero completó el cierre de caja sin declarar el saldo físico.</p>
                                                        </div>
                                                    ) : (
                                                        <div className="border border-slate-100 dark:border-slate-800 rounded-2xl overflow-hidden text-xs">
                                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-3 sm:px-4 py-2 bg-slate-50 dark:bg-slate-850/50 text-[10px] font-black text-slate-400 uppercase border-b border-slate-150 dark:border-slate-800">
                                                                <span>Moneda</span>
                                                                <span className="text-center">Esperado</span>
                                                                <span className="text-center">Declarado</span>
                                                                <span className="text-right">Diferencia</span>
                                                            </div>

                                                            {/* USD Row */}
                                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-3 sm:px-4 py-3 border-b border-slate-100 dark:border-slate-800 items-center">
                                                                <span className="font-bold text-slate-700 dark:text-slate-200">Dólares ($)</span>
                                                                <span className="font-outfit font-mono text-slate-400 text-center">${expectedUsd.toFixed(2)}</span>
                                                                <span className="font-outfit font-mono font-black text-slate-700 dark:text-white text-center">${declaredUsd.toFixed(2)}</span>
                                                                <span className={`font-outfit font-mono font-black text-right ${
                                                                    diffUsd === 0 ? 'text-slate-400' : diffUsd > 0 ? 'text-emerald-600' : 'text-rose-600'
                                                                }`}>
                                                                    {diffUsd > 0 ? '+' : ''}{diffUsd.toFixed(2)}
                                                                </span>
                                                            </div>

                                                            {/* Bs Row */}
                                                            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-3 sm:px-4 py-3 border-b border-slate-100 dark:border-slate-800 items-center">
                                                                <span className="font-bold text-slate-700 dark:text-slate-200">Bolívares (Bs)</span>
                                                                <span className="font-outfit font-mono text-slate-400 text-center">{formatBs(activeC.reconData?.expectedBs || 0)}</span>
                                                                <span className="font-outfit font-mono font-black text-slate-700 dark:text-white text-center">{formatBs(declaredBs)}</span>
                                                                <span className={`font-outfit font-mono font-black text-right ${
                                                                    (declaredBs - (activeC.reconData?.expectedBs || 0)) === 0 
                                                                        ? 'text-slate-400' 
                                                                        : (declaredBs - (activeC.reconData?.expectedBs || 0)) > 0 
                                                                            ? 'text-emerald-600' 
                                                                            : 'text-rose-600'
                                                                }`}>
                                                                    {(declaredBs - (activeC.reconData?.expectedBs || 0)) > 0 ? '+' : ''}
                                                                    {formatBs(declaredBs - (activeC.reconData?.expectedBs || 0))}
                                                                </span>
                                                            </div>

                                                            {/* COP Row si aplica */}
                                                            {shouldShowCop && activeC.reconData?.expectedCop > 0 && (
                                                                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 px-3 sm:px-4 py-3 items-center">
                                                                    <span className="font-bold text-slate-700 dark:text-slate-200">Pesos (COP)</span>
                                                                    <span className="font-outfit font-mono text-slate-400 text-center">{(activeC.reconData.expectedCop).toLocaleString()}</span>
                                                                    <span className="font-outfit font-mono font-black text-slate-700 dark:text-white text-center">{hasDeclaredCop ? formatCop(declaredCop) : 'Sin declarar'}</span>
                                                                    <span className={`font-outfit font-mono font-black text-right ${
                                                                        (declaredCop - activeC.reconData.expectedCop) === 0 
                                                                            ? 'text-slate-400' 
                                                                            : (declaredCop - activeC.reconData.expectedCop) > 0 
                                                                                ? 'text-emerald-600' 
                                                                                : 'text-rose-600'
                                                                    }`}>
                                                                        {(declaredCop - activeC.reconData.expectedCop) > 0 ? '+' : ''}
                                                                        {hasDeclaredCop ? formatCop(declaredCop - activeC.reconData.expectedCop) : '—'}
                                                                    </span>
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Desglose de Métodos de Pago */}
                                                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-4 sm:p-5 shadow-sm min-w-0 overflow-hidden">
                                                    <h3 className="text-xs font-black text-slate-800 dark:text-white mb-4 uppercase tracking-wider">Desglose de Ingresos</h3>
                                                    <div className="space-y-2.5">
                                                        {activeC.paymentBreakdown
                                                            .filter(([methodId]) => copEnabled || !methodId.toLowerCase().includes('cop'))
                                                            .map(([methodId, data]) => {
                                                            const IconComp = getMethodIcon(methodId);
                                                            const pct = activeC.totalUsd > 0 ? Math.round((data.totalUsd / activeC.totalUsd) * 100) : 0;
                                                            return (
                                                                <div key={methodId} className="flex items-center gap-3 p-3 bg-slate-50 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800 rounded-2xl">
                                                                    <div className="w-8 h-8 bg-white dark:bg-slate-800 border border-slate-150 dark:border-slate-700 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-400 shrink-0">
                                                                        <IconComp size={14} />
                                                                    </div>
                                                                    <div className="flex-1 min-w-0">
                                                                        <div className="flex items-center justify-between text-xs">
                                                                            <span className="font-black text-slate-700 dark:text-slate-200">{data.label}</span>
                                                                            <span className="font-outfit font-black text-slate-800 dark:text-white">${data.totalUsd.toFixed(2)}</span>
                                                                        </div>
                                                                        <div className="flex items-center justify-between text-[10px] text-slate-400 mt-0.5">
                                                                            <span>{data.count} tx • {pct}%</span>
                                                                            <span className="font-outfit">{formatBs(data.totalBs)} Bs</span>
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                </div>

                                                {/* Ventas del Cierre */}
                                                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-4 sm:p-6 shadow-sm min-w-0 overflow-hidden">
                                                    <h3 className="text-xs font-black text-slate-800 dark:text-white mb-4 uppercase tracking-wider">Ventas Cerradas en este Turno</h3>
                                                    <div className="space-y-3 max-h-[350px] overflow-y-auto pr-1">
                                                        {activeC.sales.slice().reverse().map(sale => (
                                                            <div key={sale.id} className="p-3.5 border border-slate-100 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-800/20 flex justify-between items-center text-xs">
                                                                    <div className="min-w-0 flex-1 pr-2">
                                                                        <div className="flex items-center gap-2">
                                                                            <span className="text-[9px] font-black px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border border-emerald-100 dark:border-emerald-800/40">
                                                                                #{sale.id.slice(-4).toUpperCase()}
                                                                            </span>
                                                                            <span className="text-[9px] text-slate-400 font-bold">{formatTime(sale.timestamp)}</span>
                                                                        </div>
                                                                        <p className="font-black text-slate-700 dark:text-slate-250 truncate mt-1">
                                                                            {sale.items?.map(i => `${i.name} (x${i.qty})`).join(', ') || 'Venta de productos'}
                                                                        </p>
                                                                    </div>
                                                                    <div className="text-right shrink-0">
                                                                        <span className="font-outfit font-black text-slate-850 dark:text-white block">${(sale.totalUsd || 0).toFixed(2)}</span>
                                                                        <span className="font-outfit text-[9px] text-slate-400 block">{formatBs(sale.totalBs || 0)} Bs</span>
                                                                    </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ── SECCIÓN 3: INVENTARIO EN TIEMPO REAL ── */}
                {viewTab === 'inventario' && (
                    <div className="space-y-6 animate-fade-in">
                        {/* Fila de Resumen de Inventario */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                            {/* Total Productos */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Total Artículos</span>
                                <div className="flex items-end justify-between mt-1">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-slate-800 dark:text-white tabular-nums leading-none">
                                        {inventoryMetrics.count}
                                    </span>
                                    <span className="text-[10px] text-slate-400 font-bold">{inventoryMetrics.totalQty} unds</span>
                                </div>
                            </div>

                            {/* Valorización Costo */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Valor Inventario (Costo)</span>
                                <div className="flex items-end justify-between mt-1">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-slate-800 dark:text-white tabular-nums leading-none">
                                        ${inventoryMetrics.totalCost.toFixed(2)}
                                    </span>
                                </div>
                            </div>

                            {/* Valorización Venta */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Valor Estimado (Venta)</span>
                                <div className="flex items-end justify-between mt-1">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-slate-800 dark:text-white tabular-nums leading-none">
                                        ${inventoryMetrics.totalRetail.toFixed(2)}
                                    </span>
                                </div>
                            </div>

                            {/* Ganancia Potencial */}
                            <div className="bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm flex flex-col justify-between min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Ganancia en Stock</span>
                                <div className="flex items-end justify-between mt-1">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-blue-600 dark:text-blue-400 tabular-nums leading-none">
                                        ${inventoryMetrics.expectedProfit.toFixed(2)}
                                    </span>
                                </div>
                            </div>

                            {/* Movimientos de inventario */}
                            <button type="button" onClick={() => setFilterStockInventario('movidos')} className="text-left bg-white dark:bg-slate-900 p-4 sm:p-5 rounded-3xl border border-slate-200/60 dark:border-slate-800/80 shadow-sm transition hover:border-emerald-300 dark:hover:border-emerald-700 min-h-[90px] sm:min-h-[110px]">
                                <span className="text-[9px] sm:text-[10px] font-black uppercase tracking-wider text-slate-400">Movimientos registrados</span>
                                <div className="mt-1 flex items-end justify-between">
                                    <span className="font-outfit text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 tabular-nums leading-none">{inventoryMovementMetrics.total}</span>
                                    <span className="text-[10px] font-bold text-slate-400">+{inventoryMovementMetrics.incomeUnits} / −{inventoryMovementMetrics.egressUnits} u</span>
                                </div>
                            </button>
                        </div>

                        <SupervisorInventoryToolbar
                            searchTerm={searchTermInventario}
                            onSearchChange={setSearchTermInventario}
                            onOpenBatch={(mode) => {
                                if (!remoteActionsAvailable) {
                                    notifyStockToast(showToast, 'BOX_OFFLINE_SEND');
                                    return;
                                }
                                setInventoryBatchProduct(null);
                                setInventoryBatchMode(mode);
                            }}
                            onNewProduct={() => {
                                triggerHaptic?.();
                                setProductToEditRemote(null);
                                setShowProductFormModal(true);
                            }}
                            filter={filterStockInventario}
                            onFilterChange={setFilterStockInventario}
                            counts={{
                                total: inventoryMetrics.count,
                                low: inventoryMetrics.lowStockCount,
                                out: inventoryMetrics.outOfStockCount,
                                moved: movedProductIds.size,
                                negative: negativeStockCount,
                            }}
                            canMutate={remoteActionsAvailable && SUPERVISOR_REMOTE_MUTATIONS_ENABLED}
                            canCreateProduct={remoteActionsAvailable && SUPERVISOR_REMOTE_PRODUCTS_ENABLED}
                            triggerHaptic={triggerHaptic}
                        />

                        {/* Listado de Productos */}
                        <SupervisorInventoryCatalog
                            products={products}
                            paginatedProducts={paginatedProducts}
                            filteredProducts={filteredProducts}
                            bcvRate={bcvRate}
                            inventoryMetrics={inventoryMetrics}
                            remoteActionsAvailable={remoteActionsAvailable}
                            SUPERVISOR_REMOTE_MUTATIONS_ENABLED={SUPERVISOR_REMOTE_MUTATIONS_ENABLED}
                            SUPERVISOR_REMOTE_PRODUCTS_ENABLED={SUPERVISOR_REMOTE_PRODUCTS_ENABLED}
                            stockOpStatus={stockOpStatus}
                            stockPendingConfirm={stockPendingConfirm}
                            setStockPendingConfirm={setStockPendingConfirm}
                            believedStockOf={believedStockOf}
                            formatBs={formatBs}
                            formatStockValue={formatStockValue}
                            toTitleCase={toTitleCase}
                            openStockEditor={openStockEditor}
                            commitStockEdit={commitStockEdit}
                            stepStockEdit={stepStockEdit}
                            applyTargetStock={applyTargetStock}
                            setProductToEditRemote={(p) => {
                                triggerHaptic?.();
                                setProductToEditRemote(p);
                                setShowProductFormModal(true);
                            }}
                            setProductToDeleteRemote={(p) => {
                                triggerHaptic?.();
                                setProductToDeleteRemote(p);
                            }}
                            clearStockOp={clearStockOp}
                            stockEditProductId={stockEditProductId}
                            setStockEditProductId={setStockEditProductId}
                            stockEditValue={stockEditValue}
                            setStockEditValue={setStockEditValue}
                            triggerHaptic={triggerHaptic}
                            showToast={showToast}
                        />

                        {/* Controles de Paginación */}
                        {totalPagesInventario > 1 && (
                            <div className="flex items-center justify-between bg-white dark:bg-slate-900 px-4 py-3 sm:px-6 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm mt-4">
                                <button
                                    onClick={() => {
                                        if (currentPageInventario > 1) {
                                            triggerHaptic?.();
                                            setCurrentPageInventario(prev => prev - 1);
                                        }
                                    }}
                                    disabled={currentPageInventario === 1}
                                    className="p-2 rounded-xl text-slate-500 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-slate-800 dark:hover:text-emerald-450 border border-slate-200 dark:border-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors duration-150"
                                >
                                    <ChevronLeft size={16} />
                                </button>

                                <span className="text-xs font-black text-slate-500 dark:text-slate-400">
                                    Página {currentPageInventario} de {totalPagesInventario}
                                    <span className="text-[10px] text-slate-450 font-medium ml-2">
                                        ({filteredProducts.length} productos)
                                    </span>
                                </span>

                                <button
                                    onClick={() => {
                                        if (currentPageInventario < totalPagesInventario) {
                                            triggerHaptic?.();
                                            setCurrentPageInventario(prev => prev + 1);
                                        }
                                    }}
                                    disabled={currentPageInventario === totalPagesInventario}
                                    className="p-2 rounded-xl text-slate-500 hover:text-emerald-500 hover:bg-emerald-50 dark:hover:bg-slate-800 dark:hover:text-emerald-450 border border-slate-200 dark:border-slate-800 disabled:opacity-30 disabled:pointer-events-none transition-colors duration-150"
                                >
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        )}

                        {inventoryMovementMetrics.recent.length > 0 && (
                            <div className="rounded-3xl border border-slate-200/60 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5">
                                <div className="mb-3 flex items-center justify-between gap-3">
                                    <div>
                                        <h3 className="text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-200">Últimos movimientos</h3>
                                        <p className="mt-1 text-[10px] font-medium text-slate-400">Auditoría rápida de ingresos y egresos confirmados.</p>
                                    </div>
                                    <button type="button" onClick={() => setFilterStockInventario('movidos')} className="text-[10px] font-black text-emerald-600 hover:text-emerald-700 dark:text-emerald-400">Ver productos movidos</button>
                                </div>
                                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                                    {inventoryMovementMetrics.recent.slice(0, 4).map((movement) => {
                                        const isIncome = movement.tipo === 'AJUSTE_ENTRADA' || movement.direction === 'ingreso';
                                        return (
                                            <div key={movement.id || movement.movementId || movement.commandId} className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-950">
                                                <div className="flex items-center justify-between gap-2">
                                                    <span className={`text-[9px] font-black uppercase ${isIncome ? 'text-emerald-600' : 'text-rose-600'}`}>{isIncome ? 'Ingreso' : 'Egreso'}</span>
                                                    <span className="text-[9px] text-slate-400">{movement.timestamp ? new Date(movement.timestamp).toLocaleDateString() : '—'}</span>
                                                </div>
                                                <p className="mt-1 truncate text-xs font-black text-slate-700 dark:text-slate-200">{movement.productNameSnapshot || movement.productName || movement.reason || 'Movimiento de stock'}</p>
                                                <p className="mt-0.5 text-[10px] font-bold text-slate-400">{isIncome ? '+' : '−'}{movement.unitsDelta ?? movement.quantityInput ?? 0} unidades</p>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        )}
                    </div>
                )}

            </main>

            {/* Propuestas 5 y 6: cola local con mando y arrepentimiento */}
            <LocalQueueBanner
                queueCount={queueEntries.length}
                pendingCount={Number(supervisorControl?.counts?.pending || 0)}
                isOnline={remoteActionsAvailable}
                uploading={queueUploading}
                onUpload={() => { triggerHaptic?.(); flushLocalQueue({ manual: true }); }}
                onDiscard={() => { triggerHaptic?.(); discardLocalQueue(); }}
                onCancelAll={async () => {
                    const summary = await supervisorControl?.cancelAll?.();
                    if (!summary) return;
                    const { total, cancelled, notCancelled } = summary;
                    if (!total) {
                        showToast?.('No hay cambios esperando a la caja', 'info');
                        return;
                    }
                    showToast?.(
                        notCancelled.length
                            ? `${cancelled} anulados · ${notCancelled.length} no se pudieron anular (la caja puede haberlos tomado)`
                            : `${cancelled} ${cancelled === 1 ? 'cambio anulado' : 'cambios anulados'}`,
                        notCancelled.length ? 'warning' : 'success',
                    );
                }}
            />

            {/* Modal Ajustar Tasa Remota */}
            <SupervisorCommandDiagnosticsPanel
                isOpen={showCommandDiagnostics}
                onClose={() => setShowCommandDiagnostics(false)}
            />

            <SupervisorSyncDiagnosticsPanel
                isOpen={showSyncDiagnostics}
                onClose={() => setShowSyncDiagnostics(false)}
                diagnostics={syncDiagnostics}
                statusLabel={connectionLabel}
                lastSync={lastSync}
            />

            <SupervisorRateModal
                isOpen={showRateModal}
                onClose={() => setShowRateModal(false)}
                targetDeviceId={pairedDeviceId}
                currentRateMode={localStorage.getItem('bodega_rate_mode')}
                currentCustomRate={localStorage.getItem('bodega_custom_rate')}
                rates={rates}
                remoteAvailable={remoteActionsAvailable}
            />

            {/* Panel de recepción/egreso rápido del Supervisor */}
            <SupervisorInventoryBatchPanel
                isOpen={Boolean(inventoryBatchMode)}
                direction={inventoryBatchMode || 'ingreso'}
                initialProduct={inventoryBatchProduct}
                products={believedProducts}
                targetDeviceId={pairedDeviceId}
                remoteAvailable={remoteActionsAvailable}
                onClose={() => {
                    setInventoryBatchMode(null);
                    setInventoryBatchProduct(null);
                }}
                onSubmitting={handleInventoryBatchSubmitting}
                onCompleted={(result, targets) => {
                    applyInventoryBatchTargets(result, targets);
                    triggerRefresh?.();
                }}
            />

            {/* Modal Editar / Crear Producto Remoto */}
            <RemoteProductFormModal
                isOpen={showProductFormModal}
                onClose={() => {
                    setShowProductFormModal(false);
                    setProductToEditRemote(null);
                }}
                targetDeviceId={pairedDeviceId}
                productToEdit={productToEditRemote}
                remoteAvailable={remoteActionsAvailable}
                onOptimisticEcho={addOptimisticProductEcho}
            />

            {/* Modal de Confirmación de Eliminación Remota de Producto */}
            {productToDeleteRemote && (
                <div className="fixed inset-0 z-[999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-fade-in">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 max-w-sm w-full max-h-[92vh] overflow-y-auto custom-scrollbar shadow-2xl space-y-4 sm:space-y-5 animate-scale-in">
                        <div className="w-12 h-12 bg-rose-50 dark:bg-rose-950/20 rounded-2xl flex items-center justify-center text-rose-500 mx-auto shrink-0">
                            <Trash2 size={22} />
                        </div>
                        <div className="space-y-2 text-center">
                            <h4 className="text-base font-black text-slate-800 dark:text-white">Eliminar Producto en Caja</h4>
                            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-100 dark:border-slate-800 text-left">
                                <p className="text-xs font-black text-slate-800 dark:text-slate-100 truncate">{productToDeleteRemote.name}</p>
                                <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                                    <span>Código: <span className="font-mono">{productToDeleteRemote.code || productToDeleteRemote.id || 'N/A'}</span></span>
                                    {productToDeleteRemote.stock !== undefined && (
                                        <span>Stock: <span className="font-bold">{productToDeleteRemote.stock}</span></span>
                                    )}
                                </div>
                            </div>
                            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 leading-relaxed">
                                ¿Deseas dar de baja este producto del catálogo activo de la caja registradora? Esta orden se sincronizará de inmediato.
                            </p>
                        </div>
                        <div className="flex gap-2.5 sm:gap-3 pt-1">
                            <button
                                onClick={() => {
                                    triggerHaptic?.();
                                    setProductToDeleteRemote(null);
                                }}
                                disabled={deletingRemoteProduct}
                                className="flex-1 min-h-11 py-2.5 px-4 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-350 font-black text-xs rounded-2xl border border-slate-200 dark:border-slate-700 transition-colors disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleConfirmDeleteProductRemote}
                                disabled={deletingRemoteProduct}
                                className="flex-1 min-h-11 py-2.5 px-4 bg-rose-500 hover:bg-rose-600 text-white font-black text-xs rounded-2xl shadow-lg shadow-rose-500/20 transition-colors disabled:opacity-50 flex items-center justify-center gap-1.5"
                            >
                                {deletingRemoteProduct ? (
                                    <>
                                        <RefreshCw size={14} className="animate-spin" />
                                        <span>Eliminando…</span>
                                    </>
                                ) : (
                                    'Eliminar'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Modal de Confirmación de Desvinculación */}
            {showDisconnectConfirm && (
                <div className="fixed inset-0 z-[999] bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 animate-fade-in">
                    <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 p-5 sm:p-6 max-w-sm w-full max-h-[92vh] overflow-y-auto custom-scrollbar shadow-2xl space-y-4 sm:space-y-5 animate-scale-in">
                        <div className="w-12 h-12 bg-rose-50 dark:bg-rose-950/20 rounded-2xl flex items-center justify-center text-rose-500 mx-auto shrink-0">
                            <LogOut size={22} />
                        </div>
                        <div className="space-y-1.5 text-center">
                            <h4 className="text-base font-black text-slate-800 dark:text-white">Desvincular Supervisor</h4>
                            <p className="text-xs font-semibold text-slate-500 leading-relaxed">
                                {disconnectServerRevoked
                                    ? 'El servidor ya confirmó la revocación. Reintentaremos borrar solamente la copia local del monitor.'
                                    : '¿Estás seguro de que deseas desvincular este dispositivo? Se quitará el acceso a esta caja y se borrará la copia local del monitor.'}
                            </p>
                        </div>
                        {disconnectError && (
                            <div role="alert" className={`rounded-2xl border p-3 text-xs font-bold ${disconnectServerRevoked ? 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300' : 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/40 dark:bg-rose-950/20 dark:text-rose-300'}`}>
                                <p>{disconnectServerRevoked ? 'El servidor ya quitó el vínculo, pero falta limpiar algunos datos de este dispositivo.' : disconnectError}</p>
                                {disconnectServerRevoked && <p className="mt-1">La próxima acción solo reintentará la limpieza; no volverá a enviar la revocación.</p>}
                            </div>
                        )}
                        <div className="flex gap-2.5 sm:gap-3 pt-1">
                            <button
                                onClick={() => { triggerHaptic?.(); setShowDisconnectConfirm(false); setDisconnectError(''); }}
                                disabled={disconnecting || disconnectServerRevoked}
                                className="flex-1 min-h-11 py-2.5 px-4 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-350 font-black text-xs rounded-2xl border border-slate-200 dark:border-slate-700 transition-colors disabled:opacity-50"
                            >
                                Cancelar
                            </button>
                            <button
                                onClick={handleDisconnect}
                                disabled={disconnecting}
                                className="flex-1 min-h-11 py-2.5 px-4 bg-rose-500 hover:bg-rose-600 text-white font-black text-xs rounded-2xl shadow-lg shadow-rose-500/20 transition-colors disabled:opacity-50"
                            >
                                {disconnecting ? 'Procesando…' : disconnectError ? 'Reintentar' : 'Desvincular'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
