import React from 'react';
import { ShoppingCart, Plus, Minus, X, CheckCircle, Package, Trash2, DollarSign, Percent, Search, Pause } from 'lucide-react';
import { formatBs, formatCop, getCop, formatUsd } from '../../utils/calculatorUtils';
import { mulR } from '../../utils/dinero';

export default function CartPanel({
    cart,
    effectiveRate,
    cartSubtotalUsd,
    cartSubtotalBs,
    cartTotalUsd,
    cartTotalBs,
    cartTotalCop,
    cartItemCount,
    discountData,
    onOpenDiscount,
    updateQty,
    removeFromCart,
    onCheckout,
    onClearCart,
    triggerHaptic,
    cartSelectedIndex,
    copEnabled,
    copPrimary,
    tasaCop
}) {
    const [editingQtyId, setEditingQtyId] = React.useState(null);
    const [tempQty, setTempQty] = React.useState('');
    const inputRef = React.useRef(null);

    const handleQtyClick = (item) => {
        setEditingQtyId(item.id);
        setTempQty(item.qty.toString());
        setTimeout(() => inputRef.current?.focus(), 50);
    };

    const submitCustomQty = (item) => {
        setEditingQtyId(null);
        let parsed = parseFloat(tempQty.replace(',', '.'));
        if (isNaN(parsed) || parsed <= 0) return;
        const diff = parsed - item.qty;
        if (diff !== 0) {
            updateQty(item.id, diff);
        }
    };

    return (
        <div className="lg:flex-1 lg:min-h-0 flex flex-col bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm">

            {/* Header */}
            <div className="shrink-0 px-4 py-4 border-b border-slate-100 dark:border-slate-800 bg-brand dark:bg-brand rounded-t-2xl sm:rounded-t-3xl">
                <div className="flex items-center justify-between">
                    <span className="text-sm font-black text-white flex items-center gap-2">
                        <ShoppingCart size={16} className="opacity-80" />
                        Cesta ({cartItemCount})
                    </span>
                </div>
            </div>

            {/* Cart Items — scrollable area with touch support */}
            <div
                className="lg:flex-1 lg:min-h-0 lg:overflow-y-auto overscroll-contain p-2 sm:p-3"
                style={{ WebkitOverflowScrolling: 'touch' }}
            >
                {cart.length === 0 ? (
                    <div className="flex flex-col items-center justify-center text-slate-300 dark:text-slate-700 p-8 text-center h-full gap-2">
                        <ShoppingCart size={44} strokeWidth={1} className="opacity-30" />
                        <p className="text-sm font-bold text-slate-400">Tu cesta está vacía</p>
                    </div>
                ) : (
                    <div className="space-y-2">
                        {cart.map((item, idx) => {
                            const qtyDisplay = item.isWeight ? `${item.qty.toFixed(3)} Kg` : item.qty;
                            const isCustomProduct = item.id.toString().startsWith('custom_') || item.name === 'Venta Libre';
                            const isEditing = editingQtyId === item.id;
                            const isSelected = cartSelectedIndex === idx;

                            return (
                                <div key={item.id} className={`group bg-white dark:bg-slate-900 rounded-xl sm:rounded-2xl p-2 pr-6 sm:p-3 sm:pr-10 border flex items-center justify-between gap-2 transition-colors relative ${
                                    isSelected 
                                        ? 'border-emerald-500 ring-2 ring-emerald-500/20 dark:border-emerald-400 dark:ring-emerald-400/20' 
                                        : 'border-slate-100 dark:border-slate-800/80 hover:border-emerald-200 dark:hover:border-emerald-800'
                                }`}>
                                    <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
                                        <div className={`w-10 h-10 sm:w-12 sm:h-12 rounded-lg sm:rounded-xl flex items-center justify-center shrink-0 overflow-hidden ${isCustomProduct ? 'bg-emerald-50 dark:bg-emerald-900/40 text-emerald-600' : 'bg-slate-50 dark:bg-slate-950'}`}>
                                            {item.image ? (
                                                <img src={item.image} alt={item.name} className="w-full h-full object-contain mix-blend-multiply dark:mix-blend-normal" />
                                            ) : isCustomProduct ? (
                                                <DollarSign size={20} className="sm:w-[22px] sm:h-[22px]" />
                                            ) : (
                                                <Package size={16} className="text-slate-300 sm:w-[18px] sm:h-[18px]" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0 pr-1">
                                            <p className="text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-100 leading-tight mb-0.5 sm:mb-1 truncate">{item.name}</p>
                                            <div className="flex items-center gap-1 sm:gap-2 flex-wrap">
                                                {copEnabled && tasaCop > 0 ? (
                                                    copPrimary ? (
                                                        <>
                                                            <p className="text-[10px] sm:text-[11px] font-black text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 px-1 sm:px-1.5 rounded">{formatCop(getCop(item, tasaCop))} COP</p>
                                                            <p className="text-[10px] sm:text-[11px] font-bold text-emerald-600">${formatUsd(item.priceUsd)}</p>
                                                            <p className="text-[10px] sm:text-[11px] font-bold text-brand dark:text-brand">{item.exactBs != null ? formatBs(item.exactBs) : formatBs(mulR(item.priceUsd, effectiveRate))} Bs</p>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <p className="text-[10px] sm:text-[11px] font-black text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 px-1 sm:px-1.5 rounded">${formatUsd(item.priceUsd)}</p>
                                                            <p className="text-[10px] sm:text-[11px] font-bold text-amber-600 dark:text-amber-400">{formatCop(getCop(item, tasaCop))} COP</p>
                                                            <p className="text-[10px] sm:text-[11px] font-bold text-brand dark:text-brand">{item.exactBs != null ? formatBs(item.exactBs) : formatBs(mulR(item.priceUsd, effectiveRate))} Bs</p>
                                                        </>
                                                    )
                                                ) : (
                                                    <>
                                                        <p className="text-[10px] sm:text-[11px] font-black text-emerald-600 bg-emerald-50 dark:bg-emerald-900/30 px-1 sm:px-1.5 rounded">${formatUsd(item.priceUsd)}</p>
                                                        <p className="text-[10px] sm:text-[11px] font-medium text-slate-400">
                                                            {item.exactBs != null ? formatBs(item.exactBs) : formatBs(mulR(item.priceUsd, effectiveRate))} Bs
                                                        </p>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                    <div className="flex flex-col items-end shrink-0 gap-1.5 sm:gap-2">
                                        {copEnabled && tasaCop > 0 && copPrimary ? (
                                            <>
                                                <p className="text-sm sm:text-base font-black text-amber-600 dark:text-amber-400">
                                                    {formatCop(mulR(getCop(item, tasaCop), item.qty))} COP
                                                </p>
                                                <p className="text-[10px] font-medium text-right leading-tight">
                                                    <span className="text-emerald-600 dark:text-emerald-400 font-bold">${formatUsd(mulR(item.priceUsd, item.qty))}</span>
                                                    <span className="text-slate-300 mx-0.5">|</span>
                                                    <span className="text-brand dark:text-brand font-bold">{formatBs(mulR(mulR(item.priceUsd, item.qty), effectiveRate))} Bs</span>
                                                </p>
                                            </>
                                        ) : (
                                            <>
                                                <p className="text-sm sm:text-base font-black text-slate-800 dark:text-white">
                                                    ${formatUsd(mulR(item.priceUsd, item.qty))}
                                                </p>
                                                {copEnabled && tasaCop > 0 && (
                                                    <p className="text-[10px] font-medium text-right leading-tight">
                                                        <span className="text-amber-600 dark:text-amber-400 font-bold">{formatCop(mulR(getCop(item, tasaCop), item.qty))} COP</span>
                                                        <span className="text-slate-300 mx-0.5">|</span>
                                                        <span className="text-brand dark:text-brand font-bold">{formatBs(mulR(mulR(item.priceUsd, item.qty), effectiveRate))} Bs</span>
                                                    </p>
                                                )}
                                            </>
                                        )}
                                        <div className="flex items-center bg-slate-50 dark:bg-slate-800 rounded-lg p-0.5 border border-slate-100 dark:border-slate-700">
                                            <button aria-label="Quitar uno" onClick={() => updateQty(item.id, item.isWeight ? -0.1 : -1)} className="w-7 sm:w-8 h-7 sm:h-8 flex items-center justify-center text-slate-400 hover:text-red-500 transition-colors rounded-l-md active:bg-slate-200 dark:active:bg-slate-700"><Minus size={14} strokeWidth={3} /></button>
                                            
                                            {isEditing ? (
                                                <input
                                                    ref={inputRef}
                                                    type="number"
                                                    value={tempQty}
                                                    onChange={e => setTempQty(e.target.value)}
                                                    onBlur={() => submitCustomQty(item)}
                                                    onKeyDown={e => { if (e.key === 'Enter') submitCustomQty(item) }}
                                                    className="w-12 sm:w-16 h-7 sm:h-8 text-center font-black text-slate-700 bg-white dark:bg-slate-900 dark:text-white border border-emerald-500 rounded text-xs outline-none"
                                                    step={item.isWeight ? "0.01" : "1"}
                                                />
                                            ) : (
                                                <span 
                                                    onClick={() => handleQtyClick(item)} 
                                                    className="w-10 sm:w-12 text-center font-black text-slate-700 dark:text-white text-[11px] sm:text-xs cursor-pointer hover:text-emerald-500 transition-colors"
                                                >
                                                    {qtyDisplay}
                                                </span>
                                            )}

                                            <button aria-label="Agregar uno" onClick={() => updateQty(item.id, item.isWeight ? 0.1 : 1)} className="w-7 sm:w-8 h-7 sm:h-8 flex items-center justify-center text-slate-400 hover:text-emerald-500 transition-colors rounded-r-md active:bg-slate-200 dark:active:bg-slate-700"><Plus size={14} strokeWidth={3} /></button>
                                        </div>
                                    </div>
                                    <button aria-label="Eliminar del carrito" onClick={() => removeFromCart(item.id)} className="absolute -top-1 -right-1 sm:top-2 sm:right-2 p-1.5 bg-red-50 dark:bg-red-900/40 text-red-500 sm:bg-transparent sm:text-slate-300 sm:hover:text-red-500 opacity-80 sm:opacity-0 group-hover:opacity-100 transition-opacity rounded-full sm:rounded-lg">
                                        <X size={12} className="sm:w-[14px] sm:h-[14px]" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Footer — shrink-0, always visible at bottom of flex container */}
            <div className="shrink-0 p-3 sm:p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 rounded-b-2xl sm:rounded-b-3xl space-y-2.5">
                
                {/* Botón de Descuento */}
                <button
                    onClick={() => { triggerHaptic && triggerHaptic(); onOpenDiscount(); }}
                    disabled={cart.length === 0}
                    className={`w-full py-2 sm:py-2.5 px-3 sm:px-4 rounded-xl flex items-center justify-between transition-all outline-none focus:ring-2 focus:ring-brand/50 ${discountData?.active ? 'bg-amber-100/80 dark:bg-amber-900/40 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-800/60' : 'bg-slate-50 dark:bg-slate-800/50 text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200 border border-slate-200 dark:border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed'}`}
                >
                    <div className="flex items-center gap-2">
                        <Percent size={15} className={discountData?.active ? 'text-amber-600 dark:text-amber-500' : ''} />
                        <span className="text-xs font-bold">
                            {discountData?.active ? 'Descuento Aplicado' : 'Añadir Descuento'}
                        </span>
                    </div>
                    {discountData?.active && (
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] sm:text-xs font-bold bg-amber-200 dark:bg-amber-800/80 px-2 py-0.5 rounded-md">
                                {discountData.type === 'percentage' ? `${discountData.value}%` : 'Fijo'}
                            </span>
                            {copEnabled && tasaCop > 0 && copPrimary ? (
                                <>
                                    <span className="font-black text-amber-600 dark:text-amber-400">{`-${formatCop(discountData.amountUsd * tasaCop)} COP`}</span>
                                    <span className="text-[9px] font-medium text-amber-600/70 dark:text-amber-400/70 ml-1">-${discountData.amountUsd.toFixed(2)}</span>
                                </>
                            ) : (
                                <>
                                    <span className="font-black text-xs">{`-$${discountData.amountUsd.toFixed(2)}`}</span>
                                    {copEnabled && tasaCop > 0 && (
                                        <span className="text-[9px] font-medium text-amber-600/70 dark:text-amber-400/70 ml-1">-{formatCop(discountData.amountUsd * tasaCop)} COP</span>
                                    )}
                                </>
                            )}
                        </div>
                    )}
                </button>

                {/* Subtotal simple */}
                <div className="flex justify-between items-center text-xs font-bold text-slate-500 px-1 pt-1">
                    <span>Subtotal</span>
                    <span>
                        {copEnabled && tasaCop > 0
                            ? (copPrimary
                                ? `${formatCop(cartSubtotalUsd * tasaCop)} COP · $${cartSubtotalUsd.toFixed(2)}`
                                : `$${cartSubtotalUsd.toFixed(2)} · ${formatCop(cartSubtotalUsd * tasaCop)} COP`)
                            : `$${cartSubtotalUsd.toFixed(2)}`}
                    </span>
                </div>

                {/* Caja de totales doble columna */}
                <div className="flex rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden bg-slate-50/50 dark:bg-slate-950/20">
                    <div className="flex-1 p-3 flex flex-col items-start">
                        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-0.5">TOTAL $</span>
                        <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white leading-none">
                            ${cartTotalUsd.toFixed(2)}
                        </span>
                    </div>
                    <div className="w-px bg-slate-200 dark:bg-slate-850" />
                    <div className="flex-1 p-3 flex flex-col items-end">
                        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 mb-0.5">BOLÍVARES</span>
                        <span className="text-xl sm:text-2xl font-black text-brand dark:text-brand leading-none">
                            {formatBs(cartTotalBs)}
                        </span>
                    </div>
                </div>

                {/* Botones de acción */}
                <div className="flex gap-2">
                    <button
                        disabled={cart.length === 0}
                        onClick={onCheckout}
                        className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed text-white font-black text-sm rounded-xl flex items-center justify-center gap-2 shadow-lg shadow-emerald-500/20 active:scale-[0.98] transition-all"
                    >
                        <CheckCircle size={18} className="opacity-80" />
                        COBRAR
                        <kbd className="bg-white/20 px-1.5 py-0.5 rounded text-[9px] font-mono leading-none">F9</kbd>
                    </button>
                </div>
            </div>
        </div>
    );
}
