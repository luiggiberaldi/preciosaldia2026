import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useProductContext } from '../context/ProductContext';
import { useMonitorSync } from '../hooks/useMonitorSync';
import { storageService } from '../utils/storageService';
import { supabaseCloud } from '../config/supabaseCloud';
import { showToast } from '../components/Toast';
import { 
    TrendingUp, Package, Coins, Users, LogOut,
    RefreshCw, Wifi, WifiOff, Clock, FileText, DollarSign,
    Wallet, CreditCard, Smartphone, Banknote, ArrowDownRight, ArrowDownToLine, ArrowUpFromLine,
    ShieldCheck, Hash, AlertTriangle, ChevronLeft, ChevronRight,
    Plus, Pencil, Trash2
} from 'lucide-react';
import { formatBs, formatCop } from '../utils/calculatorUtils';
import { getLocalISODate, getDateRange } from '../utils/dateHelpers';
import { toTitleCase } from '../config/paymentMethods';
import SupervisorRateModal from '../components/Monitor/SupervisorRateModal';
import RemoteProductFormModal from '../components/Monitor/RemoteProductFormModal';
import SupervisorInventoryBatchPanel from '../components/Monitor/SupervisorInventoryBatchPanel';
import SupervisorInventoryToolbar from '../components/Monitor/SupervisorInventoryToolbar';
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
import { SUPERVISOR_SYNC_STATES } from '../services/supervisorSyncService';
import { sendSupervisorCommand } from '../services/supervisorCommandService';
import { matchesSearch as matchesSearchFields } from '../utils/searchMatch';
import { shouldShowSupervisorCop, calculateSupervisorCashSummary } from '../services/supervisorReportData';
import { useSupervisorControl } from '../hooks/useSupervisorControl';
import SupervisorControlPanel from '../components/Monitor/SupervisorControlPanel';

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
    const supervisorControl = useSupervisorControl({
        targetDeviceId: pairedDeviceId,
        enabled: viewTab === 'control' && Boolean(pairedDeviceId),
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
    const [cierresDateRange, setCierresDateRange] = useState('all'); // 'all', 'today', 'yesterday', 'week', 'month'

    const movedProductIds = useMemo(() => new Set(
        sales
            .filter(record => record?.tipo === 'AJUSTE_ENTRADA' || record?.tipo === 'AJUSTE_SALIDA' || record?.direction === 'ingreso' || record?.direction === 'egreso')
            .map(record => String(record.productId || record.product_id || record.items?.[0]?.id || ''))
            .filter(Boolean)
    ), [sales]);

    const filteredProducts = useMemo(() => {
        if (!products) return [];
        return products.filter(p => {
            const matchesSearch = matchesSearchFields([p.name, p.barcode], searchTermInventario);
            
            if (!matchesSearch) return false;
            
            if (filterStockInventario === 'bajo') {
                return p.stock > 0 && p.stock <= (p.minStock || 5);
            }
            if (filterStockInventario === 'agotado') {
                return p.stock <= 0;
            }
            if (filterStockInventario === 'movidos') {
                return movedProductIds.has(String(p.id));
            }
            return true;
        });
    }, [products, searchTermInventario, filterStockInventario, movedProductIds]);

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
    const allCriticalProducts = useMemo(() => {
        return products
            .filter(p => {
                const stock = Number(p.stock) || 0;
                const minStock = Number(p.minStock ?? p.lowStockAlert) || 5;
                return stock <= minStock;
            })
            .sort((a, b) => {
                const stockA = Number(a.stock) || 0;
                const stockB = Number(b.stock) || 0;
                return stockA - stockB;
            });
    }, [products]);

    const outOfStockCount = useMemo(() => {
        return products.filter(p => (Number(p.stock) || 0) <= 0).length;
    }, [products]);

    const lowStockCount = useMemo(() => {
        return products.filter(p => {
            const stock = Number(p.stock) || 0;
            const minStock = Number(p.minStock ?? p.lowStockAlert) || 5;
            return stock > 0 && stock <= minStock;
        }).length;
    }, [products]);

    const criticalProducts = useMemo(() => {
        return allCriticalProducts.slice(0, 5);
    }, [allCriticalProducts]);

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
        if (!remoteActionsAvailable) {
            showToast?.('La caja está desconectada; no se puede enviar la orden', 'warning');
            return;
        }
        if (!SUPERVISOR_REMOTE_MUTATIONS_ENABLED) {
            showToast?.('Las mutaciones remotas están temporalmente deshabilitadas por seguridad', 'warning');
            return;
        }
        triggerHaptic?.();
        setDeletingRemoteProduct(true);
        try {
            const result = await sendSupervisorCommand({
                type: 'supervisor.product.delete',
                targetDeviceId: pairedDeviceId,
                payload: { productId: productToDeleteRemote.id },
            });
            if (!result.ok) {
                showToast?.(result.error, result.status === 'disabled' ? 'warning' : 'error');
                return;
            }
            const ack = await result.ackPromise;
            if (!ack?.ok) {
                showToast?.(ack?.error || 'La caja no confirmó la eliminación', 'error');
                return;
            }
            showToast?.(`Producto "${productToDeleteRemote.name}" eliminado en caja`, 'success');
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

                <div className="flex w-full sm:w-auto shrink-0 items-center justify-between sm:justify-end gap-2 sm:gap-3 sm:pl-3">
                    {/* Status Badge */}
                    <div data-testid="supervisor-connection-status" className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 rounded-full text-[9px] sm:text-[10px] font-black tracking-wider uppercase shadow-xs transition-colors duration-300 shrink-0 ${
                        isConnected 
                            ? 'bg-emerald-50 border border-emerald-200/50 text-emerald-600 dark:bg-emerald-950/20 dark:border-emerald-800/30 dark:text-emerald-400' 
                            : 'bg-rose-50 border border-rose-200/50 text-rose-600 dark:bg-rose-950/20 dark:border-rose-800/30 dark:text-rose-400 animate-pulse'
                    }`}>
                        {isConnected ? (
                            <>
                                <Wifi size={12} className="shrink-0" />
                                <span>{connectionLabel}</span>
                            </>
                        ) : (
                            <>
                                <WifiOff size={12} className="shrink-0" />
                                <span>{connectionLabel}</span>
                            </>
                        )}
                    </div>

                    <div className="flex items-center gap-1.5 sm:gap-2">
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
                            className="min-h-10 min-w-10 sm:min-h-11 sm:min-w-11 p-2 sm:p-2.5 rounded-2xl text-slate-400 hover:text-emerald-500 hover:bg-emerald-50 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:hover:text-emerald-400 transition-colors disabled:opacity-50 flex items-center justify-center shrink-0"
                            title="Actualizar Datos"
                        >
                            <RefreshCw size={15} className={syncLoading ? "animate-spin text-emerald-500" : ""} />
                        </button>

                        <button 
                            onClick={() => { triggerHaptic?.(); setShowRateModal(true); }}
                            disabled={!remoteActionsAvailable}
                            className="min-h-10 min-w-10 sm:min-h-11 flex items-center justify-center gap-1.5 rounded-2xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-[11px] font-bold text-emerald-700 shadow-xs transition-all hover:bg-emerald-100 active:scale-95 dark:border-emerald-900/40 dark:bg-emerald-950/40 dark:text-emerald-300 shrink-0 sm:px-3 sm:text-xs"
                            title="Ajustar Tasa Remota"
                        >
                            <TrendingUp size={14} className="shrink-0" />
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
                            className="min-h-10 min-w-10 sm:min-h-11 sm:min-w-11 p-2 sm:p-2.5 rounded-2xl text-slate-400 hover:text-rose-500 hover:bg-rose-50 border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 dark:hover:bg-slate-800 dark:hover:text-rose-400 transition-colors disabled:opacity-50 flex items-center justify-center shrink-0"
                            title="Desvincular Dispositivo"
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
                                        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 p-4 sm:p-6 shadow-sm min-w-0 overflow-hidden">
                                            <div className="flex items-center justify-between mb-3.5 gap-2">
                                                <h3 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2 truncate">
                                                    <Package size={18} className="text-rose-500 shrink-0" />
                                                    <span>Stock Crítico</span>
                                                </h3>
                                                <div className="flex items-center gap-1.5 shrink-0">
                                                    {outOfStockCount > 0 && (
                                                        <button
                                                            onClick={() => { triggerHaptic?.(); setViewTab('inventario'); setFilterStockInventario('agotado'); }}
                                                            className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/30 dark:hover:bg-rose-950/50 text-rose-600 border border-rose-200/50 dark:border-rose-900/40 transition-colors"
                                                            title="Ver agotados en Inventario"
                                                        >
                                                            {outOfStockCount} agotados
                                                        </button>
                                                    )}
                                                    {lowStockCount > 0 && (
                                                        <button
                                                            onClick={() => { triggerHaptic?.(); setViewTab('inventario'); setFilterStockInventario('bajo'); }}
                                                            className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-amber-50 hover:bg-amber-100 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 text-amber-600 dark:text-amber-400 border border-amber-200/50 dark:border-amber-900/40 transition-colors"
                                                            title="Ver bajo stock en Inventario"
                                                        >
                                                            {lowStockCount} bajos
                                                        </button>
                                                    )}
                                                </div>
                                            </div>

                                            {allCriticalProducts.length === 0 ? (
                                                <div className="py-6 text-center text-slate-400">
                                                    <p className="text-xs font-black text-emerald-600">¡Todo en orden!</p>
                                                    <p className="text-[10px] text-slate-400 mt-0.5">No hay productos con stock bajo o agotado.</p>
                                                </div>
                                            ) : (
                                                <>
                                                    <div className="space-y-2.5">
                                                        {criticalProducts.map(prod => {
                                                            const stock = Number(prod.stock) || 0;
                                                            const isOutOfStock = stock <= 0;
                                                            const rawPrice = prod.price != null ? prod.price : (prod.priceUsdt != null ? prod.priceUsdt : prod.precio);
                                                            const priceVal = Number(rawPrice);
                                                            const priceDisplay = Number.isFinite(priceVal) ? priceVal.toFixed(2) : '0.00';

                                                            return (
                                                                <div key={prod.id} className="flex justify-between items-center py-2 border-b border-slate-100 dark:border-slate-800/80 last:border-0 gap-2">
                                                                    <div className="min-w-0 pr-2">
                                                                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block truncate" title={prod.name}>
                                                                            {prod.name}
                                                                        </span>
                                                                        <div className="flex items-center gap-2 mt-0.5">
                                                                            <span className="font-outfit text-[10px] text-slate-400 font-medium">
                                                                                Precio: ${priceDisplay}
                                                                            </span>
                                                                            {!isOutOfStock && (
                                                                                <span className="text-[10px] text-amber-600 dark:text-amber-400 font-bold">
                                                                                    • Stock: {stock}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    </div>
                                                                    {isOutOfStock ? (
                                                                        <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-rose-50 dark:bg-rose-950/20 text-rose-600 border border-rose-200/50 dark:border-rose-900/30 shrink-0">
                                                                            Agotado
                                                                        </span>
                                                                    ) : (
                                                                        <span className="text-[10px] font-black px-2 py-0.5 rounded-lg bg-amber-50 dark:bg-amber-950/20 text-amber-600 dark:text-amber-400 border border-amber-200/50 dark:border-amber-900/30 shrink-0">
                                                                            Bajo ({stock})
                                                                        </span>
                                                                    )}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>

                                                    <button
                                                        onClick={() => {
                                                            triggerHaptic?.();
                                                            setViewTab('inventario');
                                                            setFilterStockInventario(outOfStockCount > 0 ? 'agotado' : 'bajo');
                                                        }}
                                                        className="w-full mt-3 py-2 px-3 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-black border border-slate-200/70 dark:border-slate-700/60 transition-all flex items-center justify-center gap-1.5 active:scale-95 shadow-xs"
                                                    >
                                                        <span>Ver los {allCriticalProducts.length} productos en Inventario</span>
                                                        <ChevronRight size={14} className="text-slate-400" />
                                                    </button>
                                                </>
                                            )}
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
                                    showToast?.('La caja está desconectada; no se puede enviar la orden', 'warning');
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
                            counts={{ total: inventoryMetrics.count, low: inventoryMetrics.lowStockCount, out: inventoryMetrics.outOfStockCount, moved: movedProductIds.size }}
                            canMutate={remoteActionsAvailable && SUPERVISOR_REMOTE_MUTATIONS_ENABLED}
                            canCreateProduct={remoteActionsAvailable && SUPERVISOR_REMOTE_PRODUCTS_ENABLED}
                            triggerHaptic={triggerHaptic}
                        />

                        {/* Listado de Productos */}
                        <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm overflow-hidden">
                            {filteredProducts.length === 0 ? (
                                <div className="py-16 text-center text-slate-400 flex flex-col items-center justify-center space-y-3">
                                    <div className="p-4 bg-slate-50 dark:bg-slate-800/50 text-slate-300 dark:text-slate-600 rounded-full">
                                        <Package size={36} />
                                    </div>
                                    <div className="space-y-0.5">
                                        <p className="text-xs font-black text-slate-700 dark:text-slate-200">No se encontraron productos</p>
                                        <p className="text-[10px] text-slate-450">Intenta buscando con otro término o cambiando los filtros.</p>
                                    </div>
                                </div>
                            ) : (
                                <div className="divide-y divide-slate-100 dark:divide-slate-800/80">
                                    {paginatedProducts.map((p) => {
                                        const stock = p.stock || 0;
                                        const minStock = p.minStock || 5;
                                        const isAgotado = stock <= 0;
                                        const isBajo = !isAgotado && stock <= minStock;
                                        const profitUsd = Math.max(0, p.priceUsd - (p.costPrice || 0));
                                        const profitPct = p.priceUsd > 0 ? Math.round((profitUsd / p.priceUsd) * 100) : 0;

                                        return (
                                            <div key={p.id} data-testid={`supervisor-product-row-${p.id}`} className="p-3.5 sm:p-4 flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4 hover:bg-slate-50/50 dark:hover:bg-slate-800/10 transition-colors">
                                                {/* Cabecera / Info del Producto */}
                                                <div className="flex items-start justify-between gap-3 min-w-0 flex-1">
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex items-center gap-2 flex-wrap">
                                                            <h4 className="text-xs sm:text-sm font-black text-slate-800 dark:text-white uppercase leading-tight truncate">{p.name}</h4>
                                                            <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full ${
                                                                isAgotado 
                                                                    ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400' 
                                                                    : isBajo 
                                                                        ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400' 
                                                                        : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400'
                                                            }`}>
                                                                {isAgotado ? 'Agotado' : isBajo ? 'Bajo Stock' : 'Disponible'}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-3 text-[10px] text-slate-400 mt-1 font-medium flex-wrap">
                                                            {p.barcode && (
                                                                <span className="flex items-center gap-1 font-mono">
                                                                    <Hash size={10} /> {p.barcode}
                                                                </span>
                                                            )}
                                                            <span>Categoría: {toTitleCase(p.category || 'Varios')}</span>
                                                        </div>
                                                    </div>

                                                    {/* Stock visible en la cabecera en móviles (< md) */}
                                                    <div className={`md:hidden shrink-0 min-w-[68px] text-center py-1.5 px-2.5 rounded-xl border ${
                                                        isAgotado 
                                                            ? 'bg-rose-50/50 border-rose-150/70 text-rose-700 dark:bg-rose-950/20 dark:border-rose-900/30 dark:text-rose-455' 
                                                            : isBajo 
                                                                ? 'bg-amber-50/50 border-amber-150/70 text-amber-700 dark:bg-amber-950/20 dark:border-amber-900/30 dark:text-amber-455' 
                                                                : 'bg-slate-50 border-slate-150/70 text-slate-700 dark:bg-slate-850/60 dark:border-slate-800 dark:text-slate-300'
                                                    }`}>
                                                        <span className="text-[7px] uppercase font-black block leading-none mb-0.5 text-slate-400">Stock</span>
                                                        <span className="font-outfit text-xs font-black tabular-nums leading-none">
                                                            {p.isWeight ? `${stock.toFixed(3)} Kg` : `${stock} u`}
                                                        </span>
                                                    </div>
                                                </div>

                                                {/* Sección de Valores y Acciones */}
                                                <div className="flex flex-col sm:flex-row sm:items-center justify-between md:justify-end gap-3 sm:gap-4 lg:gap-6 shrink-0">
                                                    {/* Costo, Venta, Margen */}
                                                    <div className="grid grid-cols-3 gap-2 sm:gap-4 p-2 sm:p-0 bg-slate-50/70 dark:bg-slate-800/30 sm:bg-transparent dark:sm:bg-transparent rounded-xl border border-slate-100 sm:border-0 dark:border-slate-800/50 text-center sm:text-right">
                                                        {/* Costo */}
                                                        <div className="min-w-0">
                                                            <span className="text-[8px] text-slate-400 uppercase font-black block">Costo</span>
                                                            <span className="font-outfit text-xs font-black text-slate-500 tabular-nums truncate block">${(p.costPrice || 0).toFixed(2)}</span>
                                                        </div>
                                                        {/* Venta */}
                                                        <div className="min-w-0">
                                                            <span className="text-[8px] text-slate-400 uppercase font-black block truncate">Venta (USD/Bs)</span>
                                                            <span className="font-outfit text-xs font-black text-slate-800 dark:text-white tabular-nums block">${p.priceUsd.toFixed(2)}</span>
                                                            <span className="font-outfit text-[8px] text-slate-400 block tabular-nums leading-none mt-0.5 truncate">{bcvRate ? `${formatBs(p.priceUsd * bcvRate)} Bs` : 'N/D'}</span>
                                                        </div>
                                                        {/* Ganancia */}
                                                        <div className="min-w-0">
                                                            <span className="text-[8px] text-slate-400 uppercase font-black block">Ganancia</span>
                                                            <span className="font-outfit text-xs font-black text-blue-600 dark:text-blue-400 tabular-nums block truncate">${profitUsd.toFixed(2)}</span>
                                                            <span className="text-[8px] text-slate-400 block font-medium leading-none mt-0.5">{profitPct}%</span>
                                                        </div>
                                                    </div>

                                                    {/* Stock en pantallas de escritorio (>= md) */}
                                                    <div className={`hidden md:block w-20 text-center py-2 px-2.5 rounded-2xl border ${
                                                        isAgotado 
                                                            ? 'bg-rose-50/50 border-rose-150/70 text-rose-700 dark:bg-rose-950/20 dark:border-rose-900/30 dark:text-rose-455' 
                                                            : isBajo 
                                                                ? 'bg-amber-50/50 border-amber-150/70 text-amber-700 dark:bg-amber-950/20 dark:border-amber-900/30 dark:text-amber-455' 
                                                                : 'bg-slate-50 border-slate-150/70 text-slate-700 dark:bg-slate-850/60 dark:border-slate-800 dark:text-slate-300'
                                                    }`}>
                                                        <span className="text-[8px] uppercase font-black block leading-none mb-0.5">Stock</span>
                                                        <span className="font-outfit text-xs sm:text-sm font-black tabular-nums leading-none">
                                                            {p.isWeight ? `${stock.toFixed(3)} Kg` : `${stock} u`}
                                                        </span>
                                                    </div>

                                                    {/* Acciones Remotas */}
                                                    <div className="flex items-center justify-end gap-1.5 sm:gap-1 pt-2 sm:pt-0 border-t sm:border-0 border-slate-100 dark:border-slate-800/60">
                                                        {(SUPERVISOR_REMOTE_MUTATIONS_ENABLED || SUPERVISOR_REMOTE_INCOME_ENABLED) && (
                                                            <>
                                                                <button
                                                                    onClick={() => {
                                                                        if (!remoteActionsAvailable) {
                                                                            showToast?.('La caja está desconectada; no se puede enviar la orden', 'warning');
                                                                            return;
                                                                        }
                                                                        triggerHaptic?.();
                                                                        setInventoryBatchProduct(p);
                                                                        setInventoryBatchMode('ingreso');
                                                                    }}
                                                                    className="min-h-10 min-w-10 sm:min-h-9 sm:min-w-9 flex items-center justify-center rounded-xl p-2 text-emerald-500 transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-95"
                                                                    title="Registrar ingreso de este producto"
                                                                    aria-label="Registrar ingreso de este producto"
                                                                >
                                                                    <ArrowDownToLine size={16} />
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        if (!remoteActionsAvailable) {
                                                                            showToast?.('La caja está desconectada; no se puede enviar la orden', 'warning');
                                                                            return;
                                                                        }
                                                                        triggerHaptic?.();
                                                                        setInventoryBatchProduct(p);
                                                                        setInventoryBatchMode('egreso');
                                                                    }}
                                                                    className="min-h-10 min-w-10 sm:min-h-9 sm:min-w-9 flex items-center justify-center rounded-xl p-2 text-rose-500 transition-colors hover:bg-rose-50 dark:hover:bg-rose-950/30 active:scale-95"
                                                                    title="Registrar egreso de este producto"
                                                                    aria-label="Registrar egreso de este producto"
                                                                >
                                                                    <ArrowUpFromLine size={16} />
                                                                </button>
                                                            </>
                                                        )}
                                                        <button
                                                            onClick={() => {
                                                                if (!remoteActionsAvailable) {
                                                                    showToast?.('La caja está desconectada; no se puede enviar la orden', 'warning');
                                                                    return;
                                                                }
                                                                triggerHaptic?.();
                                                                setProductToEditRemote(p);
                                                                setShowProductFormModal(true);
                                                            }}
                                                            disabled={!SUPERVISOR_REMOTE_PRODUCTS_ENABLED || !remoteActionsAvailable}
                                                            className="min-h-10 min-w-10 sm:min-h-9 sm:min-w-9 flex items-center justify-center p-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-blue-600 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
                                                            title="Editar Producto Remotamente"
                                                            aria-label="Editar Producto Remotamente"
                                                        >
                                                            <Pencil size={16} />
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                if (!remoteActionsAvailable) {
                                                                    showToast?.('La caja está desconectada; no se puede enviar la orden', 'warning');
                                                                    return;
                                                                }
                                                                triggerHaptic?.();
                                                                setProductToDeleteRemote(p);
                                                            }}
                                                            disabled={!SUPERVISOR_REMOTE_PRODUCTS_ENABLED || !remoteActionsAvailable}
                                                            className="min-h-10 min-w-10 sm:min-h-9 sm:min-w-9 flex items-center justify-center p-2 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-400 hover:text-rose-600 rounded-xl transition-colors active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                                                            title="Eliminar Producto Remotamente"
                                                            aria-label="Eliminar Producto Remotamente"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>

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

            {/* Modal Ajustar Tasa Remota */}
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
                products={products}
                targetDeviceId={pairedDeviceId}
                remoteAvailable={remoteActionsAvailable}
                onClose={() => {
                    setInventoryBatchMode(null);
                    setInventoryBatchProduct(null);
                }}
                onCompleted={() => triggerRefresh?.()}
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
