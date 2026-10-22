import React, { useEffect, useState } from 'react';
import { lowStockThreshold } from '../../utils/granel'; // BULTOS-001
import {
    Package,
    Hash,
    Pencil,
    Trash2,
    Plus,
    Minus,
    Check,
    X,
    RefreshCw,
    AlertTriangle,
} from 'lucide-react';
import { notifyStockToast, stockMessage } from '../../services/supervisorStockMessages';
import ProductStateBadge from './ProductStateBadge';
import {
    getQueuedSupervisorCommands,
    productIdsOf,
    productQueueState,
    subscribeSupervisorCommandQueue,
} from '../../services/supervisorCommandQueue';
import { getTrackedSupervisorCommands, subscribeSupervisorCommandTracker } from '../../services/supervisorCommandTracker';

// Fuentes del badge por producto (propuesta 4): qué está en vuelo según el
// tracker de comandos. La prioridad entre estados la decide productQueueState.
function trackedStateByProduct() {
    const map = {};
    getTrackedSupervisorCommands().forEach(record => {
        productIdsOf(record.type, record.payload).forEach(id => {
            const current = map[id] || { inFlight: false, appliedAt: null };
            if (!record.finalNotified) current.inFlight = true;
            else if (record.state === 'applied' || record.state === 'applied_with_warnings') {
                current.appliedAt = new Date(record.sentAt).toISOString();
            }
            map[id] = current;
        });
    });
    return map;
}

export default function SupervisorInventoryCatalog({
    products = [],
    paginatedProducts = [],
    filteredProducts = [],
    bcvRate = 0,
    inventoryMetrics = {},
    remoteActionsAvailable = false,
    SUPERVISOR_REMOTE_MUTATIONS_ENABLED = false,
    SUPERVISOR_REMOTE_PRODUCTS_ENABLED = false,
    stockOpStatus = {},
    stockPendingConfirm = null,
    setStockPendingConfirm = () => {},
    believedStockOf = (p) => p?.stock ?? 0,
    formatBs = (val) => Number(val || 0).toFixed(2),
    formatStockValue = (p, val) => (p?.isWeight ? `${Number(val || 0).toFixed(3)} Kg` : `${val} u`),
    toTitleCase = (str) => (str ? String(str).charAt(0).toUpperCase() + String(str).slice(1).toLowerCase() : ''),
    openStockEditor = () => {},
    commitStockEdit = () => {},
    stepStockEdit = () => {},
    applyTargetStock = () => {},
    setProductToEditRemote = () => {},
    setProductToDeleteRemote = () => {},
    clearStockOp = () => {},
    stockEditProductId = null,
    setStockEditProductId = () => {},
    stockEditValue = '',
    setStockEditValue = () => {},
    triggerHaptic = () => {},
    showToast = () => {},
}) {
    const displayList = paginatedProducts.length > 0 ? paginatedProducts : filteredProducts;

    // Propuesta 4: la etiqueta de estado solo pinta; el estado lo derivan
    // productQueueState + las fuentes vivas (cola local y tracker).
    const [queueEntries, setQueueEntries] = useState(() => getQueuedSupervisorCommands());
    const [trackedByProduct, setTrackedByProduct] = useState(() => trackedStateByProduct());
    useEffect(() => {
        const refresh = () => {
            setQueueEntries(getQueuedSupervisorCommands());
            setTrackedByProduct(trackedStateByProduct());
        };
        refresh();
        const offQueue = subscribeSupervisorCommandQueue(refresh);
        const offTracker = subscribeSupervisorCommandTracker(refresh);
        return () => { offQueue(); offTracker(); };
    }, []);

    if (!filteredProducts || filteredProducts.length === 0) {
        return (
            <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm overflow-hidden py-16 text-center text-slate-400 flex flex-col items-center justify-center space-y-3">
                <div className="p-4 bg-slate-50 dark:bg-slate-800/50 text-slate-300 dark:text-slate-600 rounded-full">
                    <Package size={36} />
                </div>
                <div className="space-y-0.5">
                    <p className="text-xs font-black text-slate-700 dark:text-slate-200">No se encontraron productos</p>
                    <p className="text-[10px] text-slate-400">Intenta buscando con otro término o cambiando los filtros.</p>
                </div>
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {displayList.map((p) => {
                const stockOp = stockOpStatus?.[String(p.id)];
                const trackedInfo = trackedByProduct[String(p.id)] || null;
                const productBadge = productQueueState({
                    productId: p.id,
                    queueEntries,
                    stockOp,
                    trackedInFlight: Boolean(trackedInfo?.inFlight),
                    trackedAppliedAt: trackedInfo?.appliedAt || null,
                });
                const stockProvisional = Boolean(
                    stockOp && (stockOp.state === 'sending' || stockOp.state === 'pending')
                );
                // Aplicado en la caja pero aún sin sincronizar: el valor es real,
                // solo falta que la escritura remota llegue al monitor.
                const stockAppliedUnsynced = Boolean(stockOp && stockOp.state === 'applied');
                const stock = believedStockOf(p);
                const pending =
                    stockPendingConfirm && String(stockPendingConfirm.product?.id) === String(p.id)
                        ? stockPendingConfirm
                        : null;
                const effectiveDisplayStock = pending ? pending.nextStock : stock;
                const minStock = lowStockThreshold(p); // BULTOS-001: umbral canónico
                const isNegative = stock < 0;
                const isAgotado = stock === 0;
                const isBajo = !isNegative && !isAgotado && stock <= minStock;
                // FIN-030: el precio/costo canónicos son priceUsdt/costUsd (misma
                // precedencia que getUsd en la caja). priceUsd/costPrice son alias
                // legacy que pueden quedar desactualizados tras escrituras parciales.
                const salePriceUsd = p.priceUsdt ?? p.priceUsd ?? 0;
                const costUsdCanonical = p.costUsd ?? p.costPrice ?? 0;
                const profitUsd = Math.max(0, salePriceUsd - costUsdCanonical);
                const profitPct = salePriceUsd > 0 ? Math.round((profitUsd / salePriceUsd) * 100) : 0;

                // Color del borde lateral cromático según stock
                const chromaticBorderColor = isNegative
                    ? 'bg-rose-600'
                    : isAgotado
                    ? 'bg-rose-500'
                    : isBajo
                    ? 'bg-amber-500'
                    : 'bg-emerald-500';

                const statusLabel = isNegative
                    ? 'Saldo Negativo'
                    : isAgotado
                    ? 'Agotado'
                    : isBajo
                    ? 'Bajo Stock'
                    : 'Disponible';

                const statusBadgeColor = isNegative
                    ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400 border border-rose-200 dark:border-rose-900/50'
                    : isAgotado
                    ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400 border border-rose-200/60 dark:border-rose-900/30'
                    : isBajo
                    ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400 border border-amber-200/60 dark:border-amber-900/30'
                    : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400 border border-emerald-200/60 dark:border-emerald-900/30';

                return (
                    <div
                        key={p.id}
                        data-testid={`supervisor-product-row-${p.id}`}
                        className="bg-white dark:bg-slate-900 rounded-3xl border-2 border-slate-200/90 dark:border-slate-800 p-3.5 sm:p-5 shadow-sm hover:shadow-md transition-all relative overflow-hidden group pl-5 sm:pl-6"
                    >
                        {/* Borde lateral cromático absoluto de w-2 */}
                        <div className={`w-2 absolute left-0 top-0 bottom-0 ${chromaticBorderColor}`} />

                        {/* Propuesta 4: estado del cambio sobre este producto */}
                        {productBadge && (
                            <div className="mb-2 flex">
                                <ProductStateBadge state={productBadge} />
                            </div>
                        )}

                        {/* ============================================================== */}
                        {/* DESKTOP BENTO GRID LAYOUT (visible en md:, oculto en móvil)    */}
                        {/* ============================================================== */}
                        <div className="hidden md:flex md:items-center justify-between gap-3 sm:gap-4">
                            {/* Cabecera / Info del Producto */}
                            <div className="flex items-start justify-between gap-3 min-w-0 flex-1">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h4 className="text-xs sm:text-sm lg:text-base font-black text-slate-800 dark:text-white uppercase leading-tight truncate">
                                            {p.name}
                                        </h4>
                                        <span
                                            className={`text-[8px] sm:text-[9px] font-black uppercase px-2.5 py-0.5 rounded-full ${statusBadgeColor}`}
                                        >
                                            {statusLabel}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-3 text-[10px] sm:text-xs text-slate-400 mt-1 font-medium flex-wrap">
                                        {p.barcode && (
                                            <span className="flex items-center gap-1 font-mono bg-slate-100 dark:bg-slate-800/60 px-1.5 py-0.5 rounded-md text-[11px]">
                                                <Hash size={11} className="text-slate-400" /> {p.barcode}
                                            </span>
                                        )}
                                        <span>Categoría: {toTitleCase(p.category || 'Varios')}</span>
                                    </div>
                                </div>
                            </div>

                            {/* Sección de Valores y Acciones en Escritorio */}
                            <div className="flex items-center justify-end gap-3 sm:gap-4 lg:gap-6 shrink-0">
                                {/* Subpanel financiero: Costo, Venta (USD/Bs), Ganancia */}
                                <div className="grid grid-cols-3 gap-2 sm:gap-4 p-2.5 sm:p-2 bg-slate-50/80 dark:bg-slate-800/40 rounded-2xl border border-slate-200/60 dark:border-slate-800/60 text-right min-w-[210px] sm:min-w-[230px]">
                                    {/* Costo */}
                                    <div className="min-w-0">
                                        <span className="text-[8px] sm:text-[9px] text-slate-400 uppercase font-black block tracking-wider">
                                            Costo
                                        </span>
                                        <span className="font-outfit text-xs font-black text-slate-500 tabular-nums truncate block">
                                            ${costUsdCanonical.toFixed(2)}
                                        </span>
                                    </div>
                                    {/* Venta */}
                                    <div className="min-w-0">
                                        <span className="text-[8px] sm:text-[9px] text-slate-400 uppercase font-black block tracking-wider truncate">
                                            Venta (USD/Bs)
                                        </span>
                                        <span className="font-outfit text-xs font-black text-slate-800 dark:text-white tabular-nums block">
                                            ${salePriceUsd.toFixed(2)}
                                        </span>
                                        <span className="font-outfit text-[8px] sm:text-[9px] text-slate-400 block tabular-nums leading-none mt-0.5 truncate">
                                            {bcvRate ? `${formatBs(salePriceUsd * bcvRate)} Bs` : 'N/D'}
                                        </span>
                                    </div>
                                    {/* Ganancia */}
                                    <div className="min-w-0">
                                        <span className="text-[8px] sm:text-[9px] text-slate-400 uppercase font-black block tracking-wider">
                                            Ganancia
                                        </span>
                                        <span className="font-outfit text-xs font-black text-emerald-600 dark:text-emerald-400 tabular-nums block truncate">
                                            ${profitUsd.toFixed(2)}
                                        </span>
                                        <span className="text-[8px] sm:text-[9px] text-slate-400 block font-medium leading-none mt-0.5">
                                            {profitPct}%
                                        </span>
                                    </div>
                                </div>

                                {/* Control de Stock Directo (Input o Botón) */}
                                {stockEditProductId === String(p.id) ? (
                                    <div className="flex items-center gap-1.5">
                                        <input
                                            autoFocus
                                            type="number"
                                            inputMode={p.isWeight ? 'decimal' : 'numeric'}
                                            min="0"
                                            step={p.isWeight ? '0.001' : '1'}
                                            value={stockEditValue}
                                            onChange={(event) => setStockEditValue(event.target.value)}
                                            onKeyDown={(event) => {
                                                if (event.key === 'Enter') {
                                                    event.preventDefault();
                                                    commitStockEdit(p);
                                                }
                                                if (event.key === 'Escape') setStockEditProductId(null);
                                            }}
                                            aria-label={`Nuevo stock de ${p.name}`}
                                            className="w-20 py-2 px-2.5 rounded-2xl border border-blue-400 bg-white text-center font-outfit text-xs font-black tabular-nums text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-blue-700 dark:bg-slate-950 dark:text-white"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => commitStockEdit(p)}
                                            aria-label="Confirmar nuevo stock"
                                            title="Confirmar nuevo stock"
                                            className="min-h-9 min-w-9 flex items-center justify-center rounded-xl bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 transition-all shadow-sm"
                                        >
                                            <Check size={15} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => setStockEditProductId(null)}
                                            aria-label="Cancelar edición de stock"
                                            title="Cancelar edición de stock"
                                            className="min-h-9 min-w-9 flex items-center justify-center rounded-xl bg-slate-200 text-slate-600 hover:bg-slate-300 active:scale-95 transition-all dark:bg-slate-800 dark:text-slate-300"
                                        >
                                            <X size={15} />
                                        </button>
                                    </div>
                                ) : (
                                    <button
                                        type="button"
                                        onClick={() => {
                                            // Sin conexión también se puede editar: el cambio se
                                            // guarda en la cola local al confirmar (propuesta 5).
                                            openStockEditor(p);
                                        }}
                                        aria-label={stockProvisional ? `Stock provisional de ${p.name}, pendiente de confirmación en la caja` : stockAppliedUnsynced ? `Stock de ${p.name} confirmado en la caja, esperando sincronización` : `Editar stock de ${p.name}`}
                                        title={stockProvisional ? 'Stock provisional — esperando confirmación de la caja' : stockAppliedUnsynced ? 'Confirmado en la caja — esperando sincronización' : 'Toca para escribir el stock exacto'}
                                        className={`w-20 text-center py-2 px-2.5 rounded-2xl border cursor-pointer transition-all hover:scale-[1.02] active:scale-95 ${
                                            pending
                                                ? 'bg-blue-50/90 border-blue-400 text-blue-700 dark:bg-blue-950/40 dark:border-blue-600 dark:text-blue-300 ring-2 ring-blue-400/25'
                                                : isNegative || isAgotado
                                                ? 'bg-rose-50/50 border-rose-200/70 text-rose-700 dark:bg-rose-950/20 dark:border-rose-900/30 dark:text-rose-400'
                                                : isBajo
                                                ? 'bg-amber-50/50 border-amber-200/70 text-amber-700 dark:bg-amber-950/20 dark:border-amber-900/30 dark:text-amber-400'
                                                : 'bg-slate-50 border-slate-200/70 text-slate-700 dark:bg-slate-800/60 dark:border-slate-700/80 dark:text-slate-300'
                                        }${stockProvisional || stockAppliedUnsynced ? ' border-dashed' : ''}`}
                                    >
                                        <span className={`text-[8px] uppercase font-black block leading-none mb-0.5 ${pending ? 'text-blue-500 dark:text-blue-400' : 'text-slate-400'}`}>
                                            {pending ? 'Ajuste' : 'Stock'}
                                        </span>
                                        <span className={`font-outfit text-xs sm:text-sm font-black tabular-nums leading-none ${stockProvisional ? 'animate-pulse' : ''}`}>
                                            {formatStockValue(p, effectiveDisplayStock)}
                                        </span>
                                    </button>
                                )}

                                {/* Steppers + y - */}
                                {SUPERVISOR_REMOTE_MUTATIONS_ENABLED && (
                                    <div className="flex items-center gap-1">
                                        <button
                                            type="button"
                                            onClick={() => stepStockEdit(p, 1)}
                                            disabled={stockProvisional}
                                            className="min-h-9 min-w-9 flex items-center justify-center rounded-xl p-2 text-emerald-600 border border-emerald-200 dark:border-emerald-800/50 transition-all hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-95 disabled:opacity-50"
                                            title="Subir stock en 1"
                                            aria-label={`Subir stock de ${p.name}`}
                                        >
                                            <Plus size={16} />
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => stepStockEdit(p, -1)}
                                            disabled={stockProvisional}
                                            className="min-h-9 min-w-9 flex items-center justify-center rounded-xl p-2 text-rose-500 border border-rose-200 dark:border-rose-800/50 transition-all hover:bg-rose-50 dark:hover:bg-rose-950/30 active:scale-95 disabled:opacity-50"
                                            title="Bajar stock en 1"
                                            aria-label={`Bajar stock de ${p.name}`}
                                        >
                                            <Minus size={16} />
                                        </button>
                                    </div>
                                )}

                                {/* Acciones Remotas */}
                                <div className="flex items-center gap-1">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!remoteActionsAvailable) {
                                                showToast?.('La caja está desconectada; no se puede enviar la orden', 'warning');
                                                return;
                                            }
                                            triggerHaptic?.();
                                            setProductToEditRemote(p);
                                        }}
                                        disabled={!SUPERVISOR_REMOTE_PRODUCTS_ENABLED || !remoteActionsAvailable}
                                        className="min-h-9 min-w-9 flex items-center justify-center p-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-blue-600 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
                                        title="Editar Producto Remotamente"
                                        aria-label="Editar Producto Remotamente"
                                    >
                                        <Pencil size={16} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={() => {
                                            if (!remoteActionsAvailable) {
                                                showToast?.('La caja está desconectada; no se puede enviar la orden', 'warning');
                                                return;
                                            }
                                            triggerHaptic?.();
                                            setProductToDeleteRemote(p);
                                        }}
                                        disabled={!SUPERVISOR_REMOTE_PRODUCTS_ENABLED || !remoteActionsAvailable}
                                        className="min-h-9 min-w-9 flex items-center justify-center p-2 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-400 hover:text-rose-600 rounded-xl transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                                        title="Eliminar Producto Remotamente"
                                        aria-label="Eliminar Producto Remotamente"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* ============================================================== */}
                        {/* MOBILE COMPACT ERGONOMIC LAYOUT (~115-125px) (< md)           */}
                        {/* ============================================================== */}
                        <div className="md:hidden flex flex-col justify-between gap-1.5">
                            {/* Fila Superior: Nombre + Badge + Botón Editar */}
                            <div className="flex items-center justify-between gap-2 min-w-0">
                                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                    <h4 className="text-xs font-black text-slate-800 dark:text-white uppercase leading-tight truncate">
                                        {p.name}
                                    </h4>
                                    <span
                                        className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full shrink-0 ${statusBadgeColor}`}
                                    >
                                        {statusLabel}
                                    </span>
                                </div>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (!remoteActionsAvailable) {
                                            showToast?.('La caja está desconectada; no se puede enviar la orden', 'warning');
                                            return;
                                        }
                                        triggerHaptic?.();
                                        setProductToEditRemote(p);
                                    }}
                                    disabled={!SUPERVISOR_REMOTE_PRODUCTS_ENABLED || !remoteActionsAvailable}
                                    className="w-[34px] h-[34px] shrink-0 flex items-center justify-center rounded-xl bg-slate-100 dark:bg-slate-800/80 text-slate-500 hover:text-blue-600 active:scale-95 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                                    title="Editar Producto Remotamente"
                                    aria-label="Editar Producto Remotamente"
                                >
                                    <Pencil size={15} />
                                </button>
                            </div>

                            {/* Fila Intermedia: Código de barras (#) + Categoría */}
                            <div className="flex items-center gap-2 text-[10px] text-slate-400 font-medium">
                                {p.barcode && (
                                    <span className="flex items-center gap-0.5 font-mono">
                                        <Hash size={10} className="text-slate-400" />
                                        {p.barcode}
                                    </span>
                                )}
                                {p.barcode && <span>•</span>}
                                <span className="truncate">Categoría: {toTitleCase(p.category || 'Varios')}</span>
                            </div>

                            {/* Fila Inferior Dividida: Micro-Ficha Financiera (Izquierda) + Stepper Cápsula y Delete (Derecha) */}
                            <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-slate-100 dark:border-slate-800/60">
                                {/* Micro-ficha financiera */}
                                <div className="min-w-0">
                                    <div className="flex items-baseline gap-1.5">
                                        <span className="font-outfit text-sm font-black text-emerald-600 dark:text-emerald-400 tabular-nums">
                                            ${salePriceUsd.toFixed(2)}
                                        </span>
                                        <span className="text-[10px] font-black text-emerald-600/80 dark:text-emerald-400/80 tabular-nums">
                                            +{profitPct}%
                                        </span>
                                    </div>
                                    <span className="font-outfit text-[10px] text-slate-400 font-medium block tabular-nums leading-none truncate mt-0.5">
                                        {bcvRate ? `${formatBs(salePriceUsd * bcvRate)} Bs` : 'N/D'}
                                    </span>
                                </div>

                                {/* Controles de Stock y Eliminación */}
                                <div className="flex items-center gap-1.5 shrink-0">
                                    {stockEditProductId === String(p.id) ? (
                                        <div className="flex items-center gap-1">
                                            <input
                                                autoFocus
                                                type="number"
                                                inputMode={p.isWeight ? 'decimal' : 'numeric'}
                                                min="0"
                                                step={p.isWeight ? '0.001' : '1'}
                                                value={stockEditValue}
                                                onChange={(event) => setStockEditValue(event.target.value)}
                                                onKeyDown={(event) => {
                                                    if (event.key === 'Enter') {
                                                        event.preventDefault();
                                                        commitStockEdit(p);
                                                    }
                                                    if (event.key === 'Escape') setStockEditProductId(null);
                                                }}
                                                aria-label={`Nuevo stock de ${p.name}`}
                                                className="w-16 py-1 px-1.5 rounded-xl border border-blue-400 bg-white text-center font-outfit text-xs font-black tabular-nums text-slate-800 outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-blue-700 dark:bg-slate-950 dark:text-white"
                                            />
                                            <button
                                                type="button"
                                                onClick={() => commitStockEdit(p)}
                                                aria-label="Confirmar nuevo stock"
                                                title="Confirmar nuevo stock"
                                                className="w-[32px] h-[32px] flex items-center justify-center rounded-lg bg-emerald-500 text-white hover:bg-emerald-600 active:scale-95 transition-all shadow-sm"
                                            >
                                                <Check size={14} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setStockEditProductId(null)}
                                                aria-label="Cancelar edición de stock"
                                                title="Cancelar edición de stock"
                                                className="w-[32px] h-[32px] flex items-center justify-center rounded-lg bg-slate-200 text-slate-600 hover:bg-slate-300 active:scale-95 transition-all dark:bg-slate-800 dark:text-slate-300"
                                            >
                                                <X size={14} />
                                            </button>
                                        </div>
                                    ) : (
                                        <div className={`flex items-center rounded-2xl p-0.5 border shadow-inner transition-all ${
                                            pending
                                                ? 'bg-blue-50/90 border-blue-300 dark:bg-blue-950/50 dark:border-blue-700 ring-2 ring-blue-400/25'
                                                : 'bg-slate-100 dark:bg-slate-800/80 border-slate-200/60 dark:border-slate-700/60'
                                        }`}>
                                            {SUPERVISOR_REMOTE_MUTATIONS_ENABLED && (
                                                <button
                                                    type="button"
                                                    onClick={() => stepStockEdit(p, -1)}
                                                    disabled={stockProvisional}
                                                    className="w-8 h-8 flex items-center justify-center rounded-xl text-rose-500 hover:bg-white dark:hover:bg-slate-700 active:scale-90 transition-all disabled:opacity-40"
                                                    title="Bajar stock en 1"
                                                    aria-label={`Bajar stock de ${p.name}`}
                                                >
                                                    <Minus size={14} />
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    // Igual que en desktop: sin conexión el cambio
                                                    // espera guardado en la cola local.
                                                    openStockEditor(p);
                                                }}
                                                aria-label={stockProvisional ? `Stock provisional de ${p.name}, pendiente de confirmación en la caja` : `Editar stock de ${p.name}`}
                                                title={stockProvisional ? 'Stock provisional — esperando confirmación de la caja' : 'Toca para escribir el stock exacto'}
                                                className={`px-2 h-8 flex flex-col items-center justify-center min-w-[50px] rounded-xl transition-all ${
                                                    pending
                                                        ? 'text-blue-700 dark:text-blue-300 font-extrabold'
                                                        : isNegative || isAgotado
                                                        ? 'text-rose-600 dark:text-rose-400'
                                                        : isBajo
                                                        ? 'text-amber-600 dark:text-amber-400'
                                                        : 'text-slate-700 dark:text-slate-200'
                                                }${stockProvisional ? ' animate-pulse' : ''}`}
                                            >
                                                <span className={`text-[7px] uppercase font-black leading-none ${pending ? 'text-blue-500 dark:text-blue-400' : 'text-slate-400'}`}>
                                                    {pending ? 'Ajuste' : 'Stock'}
                                                </span>
                                                <span className="font-outfit text-xs font-black tabular-nums leading-none">
                                                    {formatStockValue(p, effectiveDisplayStock)}
                                                </span>
                                            </button>
                                            {SUPERVISOR_REMOTE_MUTATIONS_ENABLED && (
                                                <button
                                                    type="button"
                                                    onClick={() => stepStockEdit(p, 1)}
                                                    disabled={stockProvisional}
                                                    className="w-8 h-8 flex items-center justify-center rounded-xl text-emerald-600 hover:bg-white dark:hover:bg-slate-700 active:scale-90 transition-all disabled:opacity-40"
                                                    title="Subir stock en 1"
                                                    aria-label={`Subir stock de ${p.name}`}
                                                >
                                                    <Plus size={14} />
                                                </button>
                                            )}
                                        </div>
                                    )}

                                    {/* Botón Eliminar en Móvil */}
                                    {stockEditProductId !== String(p.id) && (
                                        <button
                                            type="button"
                                            onClick={() => {
                                                if (!remoteActionsAvailable) {
                                                    showToast?.('La caja está desconectada; no se puede enviar la orden', 'warning');
                                                    return;
                                                }
                                                triggerHaptic?.();
                                                setProductToDeleteRemote(p);
                                            }}
                                            disabled={!SUPERVISOR_REMOTE_PRODUCTS_ENABLED || !remoteActionsAvailable}
                                            className="w-[34px] h-[34px] flex items-center justify-center rounded-xl hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-400 hover:text-rose-600 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                                            title="Eliminar Producto Remotamente"
                                            aria-label="Eliminar Producto Remotamente"
                                        >
                                            <Trash2 size={15} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* ============================================================== */}
                        {/* INLINE FEEDBACK / BANNER DE CONFIRMACIÓN (Desktop y Mobile)    */}
                        {/* ============================================================== */}
                        {(() => {
                            const pending =
                                stockPendingConfirm && String(stockPendingConfirm.product?.id) === String(p.id)
                                    ? stockPendingConfirm
                                    : null;
                            const op = stockOpStatus?.[String(p.id)];
                            if (!pending && !op) return null;

                            return (
                                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200/70 bg-slate-50/80 px-3 py-2 dark:border-slate-800 dark:bg-slate-950/60 animate-in fade-in duration-200">
                                    {pending && (
                                        <>
                                            <span className="text-[11px] font-black text-slate-600 dark:text-slate-300">
                                                {formatStockValue(p, stock)} →{' '}
                                                <span
                                                    className={
                                                        pending.nextStock >= stock ? 'text-emerald-600' : 'text-rose-600'
                                                    }
                                                >
                                                    {formatStockValue(p, pending.nextStock)}
                                                </span>
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    triggerHaptic?.();
                                                    setStockPendingConfirm(null);
                                                }}
                                                className="min-h-9 px-3 rounded-xl bg-slate-200 text-slate-600 hover:bg-slate-300 text-[11px] font-black transition-colors dark:bg-slate-800 dark:text-slate-300 active:scale-95"
                                            >
                                                Descartar
                                            </button>
                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    triggerHaptic?.();
                                                    const { product, nextStock } = stockPendingConfirm;
                                                    setStockPendingConfirm(null);
                                                    await applyTargetStock(product, nextStock);
                                                }}
                                                className="min-h-9 px-3 rounded-xl bg-blue-600 text-white hover:bg-blue-700 text-[11px] font-black transition-colors active:scale-95 flex items-center gap-1.5 shadow-sm"
                                            >
                                                <Check size={13} /> Confirmar cambio
                                            </button>
                                        </>
                                    )}
                                    {!pending && op?.state === 'sending' && (
                                        <span className="flex items-center gap-1.5 text-[11px] font-black text-blue-600 dark:text-blue-400">
                                            <RefreshCw size={12} className="animate-spin" /> Enviando cambio de stock…
                                        </span>
                                    )}
                                    {!pending && op?.state === 'applied' && (
                                        <>
                                            <span className="flex items-center gap-1.5 text-[11px] font-black text-emerald-600 dark:text-emerald-400">
                                                <Check size={12} /> Stock actualizado en la caja
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    triggerHaptic?.();
                                                    clearStockOp?.(p.id);
                                                }}
                                                className="min-h-9 px-3 rounded-xl bg-slate-200 text-slate-600 hover:bg-slate-300 text-[11px] font-black transition-colors dark:bg-slate-800 dark:text-slate-300 active:scale-95"
                                            >
                                                Ocultar
                                            </button>
                                        </>
                                    )}
                                    {!pending && op?.state === 'pending' && (
                                        <span className="flex items-center gap-1.5 text-[11px] font-black text-amber-600 dark:text-amber-400">
                                            <AlertTriangle size={12} /> La caja aún no confirma; revisa el stock en unos segundos
                                        </span>
                                    )}
                                    {!pending && op?.state === 'failed' && (
                                        <>
                                            <span className="flex items-center gap-1.5 text-[11px] font-black text-rose-600 dark:text-rose-400">
                                                <AlertTriangle size={12} /> {op.error || stockMessage('STOCK_UPDATE_FAILED')}
                                            </span>
                                            <button
                                                type="button"
                                                onClick={() => applyTargetStock(p, op.targetStock)}
                                                className="min-h-9 px-3 rounded-xl bg-rose-500 text-white hover:bg-rose-600 text-[11px] font-black transition-colors active:scale-95 flex items-center gap-1.5 shadow-sm"
                                            >
                                                <RefreshCw size={12} /> Reintentar
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => {
                                                    triggerHaptic?.();
                                                    clearStockOp?.(p.id);
                                                }}
                                                className="min-h-9 px-3 rounded-xl bg-slate-200 text-slate-600 hover:bg-slate-300 text-[11px] font-black transition-colors dark:bg-slate-800 dark:text-slate-300 active:scale-95"
                                            >
                                                Descartar
                                            </button>
                                        </>
                                    )}
                                </div>
                            );
                        })()}
                    </div>
                );
            })}
        </div>
    );
}
