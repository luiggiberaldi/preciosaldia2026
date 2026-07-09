import React from 'react';
import { Tag, Banknote, AlertTriangle, Box, Minus, Plus, Pencil, Trash2, Package, Layers, Clock, Printer } from 'lucide-react';
import { CATEGORY_COLORS, CATEGORY_ICONS, UNITS } from '../../config/categories';
import { formatUsd, formatBs, formatCop, smartCashRounding, getCop, getUsd } from '../../utils/calculatorUtils';

export default function ProductCard({
    product: p,
    effectiveRate,
    streetRate,
    categories,
    onAdjustStock,
    copEnabled,
    copPrimary,
    tasaCop,
    daysRemaining,
    isSelected,
    onToggleSelect,
    onPrint,
    readOnly = false,

    onEdit,
    onDelete
}) {
    const effectiveUsd = getUsd(p, tasaCop);
    const valBs = effectiveUsd * effectiveRate;
    const valCop = getCop(p, tasaCop);
    const isLowStock = (p.stock ?? 0) <= (p.lowStockAlert ?? 5);
    const margin = p.costBs > 0 ? ((valBs - p.costBs) / p.costBs * 100) : null;
    const catInfo = categories.find(c => c.id === p.category);
    const unitInfo = UNITS.find(u => u.id === p.unit);
    const efectivoPrecio = streetRate > 0 ? `$${smartCashRounding(valBs / streetRate)}` : null;

    return (
        <div className={`bg-white dark:bg-slate-900 rounded-2xl shadow-sm border flex flex-col overflow-hidden group ${isLowStock ? 'border-amber-300 dark:border-amber-700' : 'border-slate-100 dark:border-slate-800'} ${isSelected ? 'ring-2 ring-brand border-brand shadow-brand/20 bg-brand/5 dark:bg-brand/10' : ''}`}>
            {/* Image */}
            <div className="w-full h-24 lg:h-20 bg-white dark:bg-slate-900 overflow-hidden relative shrink-0">
                {/* Select Checkbox */}
                <div className="absolute top-1 left-1 z-10 w-6 h-6 flex items-center justify-center bg-white/80 dark:bg-slate-900/80 rounded backdrop-blur-sm">
                    <input type="checkbox" checked={isSelected} onChange={onToggleSelect} className="w-4 h-4 rounded border-slate-300 text-brand focus:ring-brand cursor-pointer shadow-sm" />
                </div>
                {p.image ? (
                    <img src={p.image} className="w-full h-full object-contain p-1" alt={p.name} loading="lazy" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-slate-300 dark:text-slate-600">
                        <Tag size={24} />
                    </div>
                )}
                {/* Category badge */}
                {catInfo && catInfo.id !== 'otros' && (
                    <div className={`absolute top-1 left-8 text-[9px] font-bold px-1.5 py-0.5 rounded flex items-center gap-0.5 ${CATEGORY_COLORS[catInfo.color] || ''}`}>
                        {(() => { const CatIcon = CATEGORY_ICONS[catInfo.id]; return CatIcon ? <CatIcon size={9} /> : catInfo.icon; })()} {catInfo.label}
                    </div>
                )}
                {/* Low stock alert */}
                {isLowStock && (
                    <div className="absolute top-1 right-1 bg-amber-500/90 backdrop-blur-sm text-white text-[9px] font-black px-1.5 py-0.5 rounded flex items-center gap-0.5">
                        <AlertTriangle size={9} /> Bajo
                    </div>
                )}
            </div>

            {/* Info */}
            <div className="p-3 lg:p-2.5 flex flex-col flex-1">
                <h3 className="font-bold text-slate-700 dark:text-slate-200 text-[13px] lg:text-[12px] leading-tight line-clamp-2 mb-2">{p.name}</h3>

                {/* Units per package info */}
                {p.unit === 'paquete' && p.unitsPerPackage && (
                    <div className="flex items-center gap-1 text-[10px] font-bold text-brand dark:text-brand mb-2 mt-[-4px]">
                        <Package size={11} /> Bulto · {p.unitsPerPackage} uds
                    </div>
                )}

                <div className="flex justify-between items-end mb-3">
                    <div>
                        {copEnabled && tasaCop > 0 ? (
                            copPrimary ? (
                                <>
                                    <p className="text-lg lg:text-base font-black text-amber-600 dark:text-amber-400 leading-none">
                                        {formatCop(valCop)} <span className="text-[10px] font-bold text-amber-600/50 dark:text-amber-400/50">COP {(p.unit === 'kg' || p.unit === 'litro') ? `/ ${unitInfo?.short || 'ud'}` : ''}</span>
                                    </p>
                                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                        <span className="text-[10px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 px-1.5 py-0.5 rounded">{formatUsd(effectiveUsd)} USD</span>
                                        <span className="text-[10px] font-bold text-brand-dark dark:text-brand bg-brand-light dark:bg-surface-800/20 px-1.5 py-0.5 rounded">{formatBs(valBs)} Bs</span>
                                    </div>
                                </>
                            ) : (
                                <>
                                    <p className="text-lg lg:text-base font-black text-emerald-600 dark:text-emerald-400 leading-none">
                                        {formatUsd(effectiveUsd)} <span className="text-[10px] font-bold text-emerald-600/50 dark:text-emerald-400/50">USD {(p.unit === 'kg' || p.unit === 'litro') ? `/ ${unitInfo?.short || 'ud'}` : ''}</span>
                                    </p>
                                    <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                                        <span className="text-[10px] font-bold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-1.5 py-0.5 rounded">{formatCop(valCop)} COP</span>
                                        <span className="text-[10px] font-bold text-brand-dark dark:text-brand bg-brand-light dark:bg-surface-800/20 px-1.5 py-0.5 rounded">{formatBs(valBs)} Bs</span>
                                    </div>
                                </>
                            )
                        ) : (
                            <>
                                <p className="text-lg lg:text-base font-black text-emerald-600 dark:text-emerald-400 leading-none">
                                    {formatUsd(effectiveUsd)} <span className="text-[10px] font-bold text-emerald-600/50 dark:text-emerald-400/50">USD {(p.unit === 'kg' || p.unit === 'litro') ? `/ ${unitInfo?.short || 'ud'}` : ''}</span>
                                </p>
                                <p className="text-[11px] font-bold text-slate-400 mt-1">{formatBs(valBs)} Bs</p>
                            </>
                        )}
                        {p.unit === 'paquete' && p.sellByUnit && (
                            <p className="text-[10px] font-bold text-brand dark:text-brand mt-0.5 flex items-center gap-0.5">
                                <Layers size={10} />
                                {copEnabled && tasaCop > 0
                                    ? copPrimary
                                        ? `${formatCop(p.unitPriceCop || (p.priceCop ? Math.round(p.priceCop / (p.unitsPerPackage || 1)) : Math.round((p.unitPriceUsd ?? effectiveUsd / (p.unitsPerPackage || 1)) * tasaCop)))} COP / ud · $${(p.unitPriceUsd ?? effectiveUsd / (p.unitsPerPackage || 1)).toFixed(2)}`
                                        : `$${(p.unitPriceUsd ?? effectiveUsd / (p.unitsPerPackage || 1)).toFixed(2)} / ud · ${formatCop(p.unitPriceCop || (p.priceCop ? Math.round(p.priceCop / (p.unitsPerPackage || 1)) : Math.round((p.unitPriceUsd ?? effectiveUsd / (p.unitsPerPackage || 1)) * tasaCop)))} COP`
                                    : `$${(p.unitPriceUsd ?? effectiveUsd / (p.unitsPerPackage || 1)).toFixed(2)} / ud`
                                }
                            </p>
                        )}
                    </div>
                    {!readOnly && margin !== null && (
                        <span className={`text-[10px] font-black px-2 py-1 rounded-lg ${margin >= 0 ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-900/20 dark:text-emerald-400' : 'bg-red-50 text-red-600 dark:bg-red-900/20 dark:text-red-400'}`}>
                            {margin >= 0 ? '+' : ''}{margin.toFixed(0)}%
                        </span>
                    )}
                </div>

                {/* Stock Control Prominente */}
                <div className="mt-auto pt-2 border-t border-slate-100 dark:border-slate-800">
                    <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/50 rounded-xl p-1">
                        {!readOnly && (
                        <button onClick={() => onAdjustStock(p.id, -1)} className="w-10 h-10 rounded-lg bg-white dark:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-red-500 shadow-sm active:scale-95 transition-all">
                            <Minus size={18} strokeWidth={2.5} />
                        </button>
                        )}
                        <div className="flex flex-col items-center justify-center px-2 text-center min-w-[50px]">
                            <span className={`text-base font-black leading-none mb-0.5 ${isLowStock ? 'text-amber-500' : 'text-slate-700 dark:text-slate-200'}`}>
                                {p.stock ?? 0}
                            </span>
                            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider leading-none">{(p.unit === 'kg' || p.unit === 'litro') ? unitInfo?.short : 'UND'}</span>
                            {p.unit === 'paquete' && p.unitsPerPackage > 0 && Math.floor((p.stock ?? 0) / p.unitsPerPackage) > 0 && (
                                <span className="text-[8px] text-slate-400 leading-none">= {Math.floor((p.stock ?? 0) / p.unitsPerPackage)} bultos</span>
                            )}
                        </div>
                        {!readOnly && (
                        <button onClick={() => onAdjustStock(p.id, 1)} className="w-10 h-10 rounded-lg bg-white dark:bg-slate-700 flex items-center justify-center text-slate-500 hover:text-emerald-500 shadow-sm active:scale-95 transition-all">
                            <Plus size={18} strokeWidth={2.5} />
                        </button>
                        )}
                    </div>

                    {/* Days Remaining Badge */}
                    {daysRemaining !== null && daysRemaining !== undefined && (
                        <div className={`flex items-center justify-center gap-1 mt-1.5 py-1 rounded-lg text-[10px] font-bold ${
                            daysRemaining <= 3
                                ? 'bg-red-50 dark:bg-red-900/20 text-red-500'
                                : daysRemaining <= 7
                                    ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-500'
                                    : 'bg-brand-light dark:bg-surface-800/20 text-brand'
                        }`}>
                            <Clock size={10} />
                            {daysRemaining <= 3
                                ? `Agotado en ~${daysRemaining}d`
                                : `~${daysRemaining} dias de stock`
                            }
                        </div>
                    )}
                </div>
            </div>

            {/* Actions */}
            <div className="flex border-t border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-800/20">
                <button 
                    onClick={onPrint} 
                    className="flex-1 py-2 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-brand hover:bg-brand/10 transition-colors border-r border-slate-100 dark:border-slate-800" 
                    title="Imprimir Etiqueta"
                >
                    <Printer size={15} />
                </button>
                {!readOnly && (
                    <button 
                        onClick={() => onEdit(p)} 
                        className="flex-1 py-2 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-amber-500 hover:bg-amber-50 dark:hover:bg-amber-950/30 transition-colors border-r border-slate-100 dark:border-slate-800"
                    >
                        <Pencil size={15} />
                    </button>
                )}
                {!readOnly && (
                    <button 
                        onClick={() => onDelete(p.id)} 
                        className="flex-1 py-2 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                    >
                        <Trash2 size={15} />
                    </button>
                )}
            </div>
        </div >
    );
}
