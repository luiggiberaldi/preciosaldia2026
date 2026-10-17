import React from 'react';
import { Package, Hash, Pencil, Trash2, Plus, Minus } from 'lucide-react';

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
    stockEditProductId = null,
    setStockEditProductId = () => {},
    stockEditValue = '',
    setStockEditValue = () => {},
    triggerHaptic = () => {},
    showToast = () => {},
}) {
    const displayList = paginatedProducts.length > 0 ? paginatedProducts : filteredProducts;

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
                const stockProvisional = Boolean(
                    stockOp && (stockOp.state === 'sending' || stockOp.state === 'pending')
                );
                const stock = believedStockOf(p);
                const minStock = p.minStock || 5;
                const isNegative = stock < 0;
                const isAgotado = stock === 0;
                const isBajo = !isNegative && !isAgotado && stock <= minStock;
                const profitUsd = Math.max(0, (p.priceUsd || 0) - (p.costPrice || 0));
                const profitPct = (p.priceUsd || 0) > 0 ? Math.round((profitUsd / p.priceUsd) * 100) : 0;

                // Color del borde lateral según stock
                const chromaticBorderColor = isNegative
                    ? 'bg-rose-600'
                    : isAgotado
                    ? 'bg-rose-500'
                    : isBajo
                    ? 'bg-amber-500'
                    : 'bg-emerald-500';

                return (
                    <div
                        key={p.id}
                        data-testid={`supervisor-product-row-${p.id}`}
                        className="bg-white dark:bg-slate-900 rounded-3xl border-2 border-slate-200/90 dark:border-slate-800 p-4 sm:p-5 shadow-sm hover:shadow-md transition-all relative overflow-hidden group pl-5 sm:pl-6"
                    >
                        {/* Borde lateral cromático absoluto de w-2 */}
                        <div className={`w-2 absolute left-0 top-0 bottom-0 ${chromaticBorderColor}`} />

                        <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4">
                            {/* Cabecera / Info del Producto */}
                            <div className="flex items-start justify-between gap-3 min-w-0 flex-1">
                                <div className="min-w-0 flex-1">
                                    <div className="flex items-center gap-2 flex-wrap">
                                        <h4 className="text-xs sm:text-sm font-black text-slate-800 dark:text-white uppercase leading-tight truncate">
                                            {p.name}
                                        </h4>
                                        <span
                                            className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full ${
                                                isNegative || isAgotado
                                                    ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-400'
                                                    : isBajo
                                                    ? 'bg-amber-50 text-amber-600 dark:bg-amber-950/30 dark:text-amber-400'
                                                    : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400'
                                            }`}
                                        >
                                            {isNegative ? 'Saldo Negativo' : isAgotado ? 'Agotado' : isBajo ? 'Bajo Stock' : 'Disponible'}
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
                            </div>

                            {/* Sección de Valores y Acciones */}
                            <div className="flex flex-col sm:flex-row sm:items-center justify-between md:justify-end gap-3 sm:gap-4 lg:gap-6 shrink-0">
                                {/* Subpanel financiero: Costo, Venta, Margen */}
                                <div className="grid grid-cols-3 gap-2 sm:gap-4 p-2.5 sm:p-2 bg-slate-50/70 dark:bg-slate-800/40 rounded-2xl border border-slate-100 dark:border-slate-800/60 text-center sm:text-right min-w-[200px]">
                                    {/* Costo */}
                                    <div className="min-w-0">
                                        <span className="text-[8px] text-slate-400 uppercase font-black block">Costo</span>
                                        <span className="font-outfit text-xs font-black text-slate-500 tabular-nums truncate block">
                                            ${(p.costPrice || 0).toFixed(2)}
                                        </span>
                                    </div>
                                    {/* Venta */}
                                    <div className="min-w-0">
                                        <span className="text-[8px] text-slate-400 uppercase font-black block truncate">Venta (USD/Bs)</span>
                                        <span className="font-outfit text-xs font-black text-slate-800 dark:text-white tabular-nums block">
                                            ${(p.priceUsd || 0).toFixed(2)}
                                        </span>
                                        <span className="font-outfit text-[8px] text-slate-400 block tabular-nums leading-none mt-0.5 truncate">
                                            {bcvRate ? `${formatBs((p.priceUsd || 0) * bcvRate)} Bs` : 'N/D'}
                                        </span>
                                    </div>
                                    {/* Ganancia */}
                                    <div className="min-w-0">
                                        <span className="text-[8px] text-slate-400 uppercase font-black block">Ganancia</span>
                                        <span className="font-outfit text-xs font-black text-emerald-600 dark:text-emerald-400 tabular-nums block truncate">
                                            ${profitUsd.toFixed(2)}
                                        </span>
                                        <span className="text-[8px] text-slate-400 block font-medium leading-none mt-0.5">
                                            {profitPct}%
                                        </span>
                                    </div>
                                </div>

                                {/* Botón / Control de Stock */}
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (!remoteActionsAvailable) {
                                            showToast?.('La caja está desconectada; no se puede cambiar el stock', 'warning');
                                            return;
                                        }
                                        openStockEditor(p);
                                    }}
                                    aria-label={stockProvisional ? `Stock provisional de ${p.name}, pendiente de confirmación en la caja` : `Editar stock de ${p.name}`}
                                    title={stockProvisional ? 'Stock provisional — esperando confirmación de la caja' : 'Toca para escribir el stock exacto'}
                                    className={`w-20 text-center py-2 px-2.5 rounded-2xl border cursor-pointer transition-colors hover:brightness-95 ${
                                        isNegative || isAgotado
                                            ? 'bg-rose-50/50 border-rose-150/70 text-rose-700 dark:bg-rose-950/20 dark:border-rose-900/30 dark:text-rose-455'
                                            : isBajo
                                            ? 'bg-amber-50/50 border-amber-150/70 text-amber-700 dark:bg-amber-950/20 dark:border-amber-900/30 dark:text-amber-455'
                                            : 'bg-slate-50 border-slate-150/70 text-slate-700 dark:bg-slate-850/60 dark:border-slate-800 dark:text-slate-300'
                                    }${stockProvisional ? ' border-dashed' : ''}`}
                                >
                                    <span className="text-[8px] uppercase font-black block leading-none mb-0.5">Stock</span>
                                    <span className={`font-outfit text-xs sm:text-sm font-black tabular-nums leading-none ${stockProvisional ? 'animate-pulse' : ''}`}>
                                        {p.isWeight ? `${stock.toFixed(3)} Kg` : `${stock} u`}
                                    </span>
                                </button>

                                {/* Acciones Remotas */}
                                <div className="flex items-center justify-end gap-1.5 sm:gap-1 pt-2 sm:pt-0 border-t sm:border-0 border-slate-100 dark:border-slate-800/60">
                                    {SUPERVISOR_REMOTE_MUTATIONS_ENABLED && (
                                        <>
                                            <button
                                                type="button"
                                                onClick={() => stepStockEdit(p, 1)}
                                                disabled={stockProvisional}
                                                className="min-h-10 min-w-10 sm:min-h-9 sm:min-w-9 flex items-center justify-center rounded-xl p-2 text-emerald-600 border border-emerald-200 transition-colors hover:bg-emerald-50 dark:hover:bg-emerald-950/30 active:scale-95 disabled:opacity-50"
                                                title="Subir stock en 1"
                                                aria-label={`Subir stock de ${p.name}`}
                                            >
                                                <Plus size={16} />
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => stepStockEdit(p, -1)}
                                                disabled={stockProvisional}
                                                className="min-h-10 min-w-10 sm:min-h-9 sm:min-w-9 flex items-center justify-center rounded-xl p-2 text-rose-500 border border-rose-200 transition-colors hover:bg-rose-50 dark:hover:bg-rose-950/30 active:scale-95 disabled:opacity-50"
                                                title="Bajar stock en 1"
                                                aria-label={`Bajar stock de ${p.name}`}
                                            >
                                                <Minus size={16} />
                                            </button>
                                        </>
                                    )}
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
                                        className="min-h-10 min-w-10 sm:min-h-9 sm:min-w-9 flex items-center justify-center p-2 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 hover:text-blue-600 rounded-xl transition-colors disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
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
                                        className="min-h-10 min-w-10 sm:min-h-9 sm:min-w-9 flex items-center justify-center p-2 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-rose-400 hover:text-rose-600 rounded-xl transition-colors active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
                                        title="Eliminar Producto Remotamente"
                                        aria-label="Eliminar Producto Remotamente"
                                    >
                                        <Trash2 size={16} />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
