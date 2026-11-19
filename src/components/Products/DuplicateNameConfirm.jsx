import React from 'react';
import { AlertTriangle, Barcode, Eye, Package, X } from 'lucide-react';
import SmartImage from '../SmartImage';
import { round3 } from '../../utils/dinero';

/**
 * Aviso de nombre parecido: ya existe un artículo con ese nombre. No bloquea: muestra la ficha
 * del artículo existente y permite abrirlo, volver a corregir o crear otro igual.
 */
export default function DuplicateNameConfirm({ owner, onCancel, onViewExisting, onConfirm }) {
    if (!owner) return null;

    const price = Number(owner.priceUsd) || 0;
    const stock = round3(Number(owner.stock) || 0);

    return (
        <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm p-4 animate-in fade-in duration-150"
            role="dialog"
            aria-modal="true"
            aria-labelledby="dup-name-title"
            onClick={onCancel}
        >
            <div
                className="relative bg-white dark:bg-slate-900 rounded-[1.5rem] p-5 sm:p-6 max-w-md w-full shadow-2xl border border-slate-200/80 dark:border-slate-800 animate-in zoom-in-95 duration-150"
                onClick={(e) => e.stopPropagation()}
            >
                <button
                    type="button"
                    onClick={onCancel}
                    aria-label="Cerrar aviso"
                    className="absolute top-4 right-4 p-1.5 rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                >
                    <X size={16} />
                </button>

                <div className="flex flex-col items-center text-center">
                    <div className="w-12 h-12 rounded-2xl bg-amber-50 dark:bg-amber-900/25 border border-amber-200/70 dark:border-amber-800/40 flex items-center justify-center mb-3">
                        <AlertTriangle size={24} className="text-amber-500" aria-hidden="true" />
                    </div>

                    <h4 id="dup-name-title" className="text-lg font-black text-slate-800 dark:text-white tracking-tight">
                        Ya existe un artículo parecido
                    </h4>
                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                        Revisa si es el mismo que ya tienes antes de crear uno nuevo.
                    </p>

                    {/* Tarjeta del artículo existente */}
                    <div className="w-full mt-4 rounded-2xl border border-amber-200/80 dark:border-amber-800/40 bg-amber-50/50 dark:bg-amber-950/20 p-3 flex items-center gap-3 text-left">
                        <div className="w-12 h-12 rounded-xl bg-white dark:bg-slate-800 border border-slate-200/70 dark:border-slate-700 overflow-hidden shrink-0 flex items-center justify-center">
                            <SmartImage
                                product={owner}
                                alt={owner.name}
                                className="w-full h-full object-cover"
                                fallbackIcon={<Package size={20} className="text-slate-400" />}
                            />
                        </div>
                        <div className="min-w-0 flex-1">
                            <p className="text-sm font-black text-slate-800 dark:text-white leading-snug break-words">
                                {owner.name}
                            </p>
                            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                <span className="inline-flex items-center gap-1">
                                    <Barcode size={12} className="text-slate-400" />
                                    {owner.barcode ? owner.barcode : 'Sin código'}
                                </span>
                                {price > 0 && (
                                    <span className="text-slate-700 dark:text-slate-200">
                                        ${price.toFixed(2)}
                                    </span>
                                )}
                                <span className={stock > 0 ? 'text-emerald-600 dark:text-emerald-400' : ''}>
                                    Stock: {stock}
                                </span>
                            </div>
                        </div>
                    </div>

                    {/* Acciones */}
                    <div className="w-full mt-4 space-y-2">
                        {onViewExisting && (
                            <button
                                type="button"
                                onClick={onViewExisting}
                                className="w-full px-4 py-3 min-h-[46px] rounded-2xl bg-brand hover:opacity-95 text-white text-sm font-bold flex items-center justify-center gap-2 shadow-sm active:scale-[0.99] transition-all cursor-pointer"
                            >
                                <Eye size={16} />
                                <span>Abrir el existente</span>
                            </button>
                        )}
                        <div className="flex flex-col-reverse sm:flex-row gap-2 w-full">
                            <button
                                type="button"
                                onClick={onCancel}
                                className="flex-1 px-4 py-2.5 min-h-[44px] rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs sm:text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 transition-colors whitespace-nowrap cursor-pointer"
                            >
                                Corregir nombre
                            </button>
                            <button
                                type="button"
                                onClick={onConfirm}
                                className="flex-1 px-4 py-2.5 min-h-[44px] rounded-2xl bg-amber-500 hover:bg-amber-600 text-white text-xs sm:text-sm font-bold shadow-sm transition-colors whitespace-nowrap cursor-pointer"
                            >
                                Crear otro igual
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
