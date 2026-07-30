import React from 'react';
import { Calculator, DollarSign, Wallet, X, LayoutGrid, Zap } from 'lucide-react';

/**
 * PaymentHeader — Header del modo POS.
 * Incluye tabs Contado/Crédito + botón de cambio rápido de modo (a Basic).
 */
export default function PaymentHeader({ modo, setModo, onClose, onSwitchToBasic, tasa, casheaActive = false }) {
    return (
        <div className="h-16 px-4 bg-white dark:bg-slate-950 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center shrink-0 shadow-sm">
            {/* Título */}
            <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-lg bg-brand/10 dark:bg-brand/20 flex items-center justify-center">
                    <Calculator size={16} className="text-brand dark:text-brand" />
                </div>
                <div className="flex flex-col">
                    <h2 className="text-sm font-black text-slate-800 dark:text-white tracking-wide">Procesar Pago</h2>
                    <span className="text-[10px] font-bold text-slate-400 dark:text-slate-500 leading-none">
                        {tasa > 0 ? `Tasa: ${tasa.toFixed(2)} Bs/$` : 'Tasa no configurada'}
                    </span>
                </div>
            </div>

            {/* Tabs Contado / Crédito */}
            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl gap-0.5">
                <button
                    onClick={() => setModo('contado')}
                    className={`px-5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                        modo === 'contado'
                            ? 'bg-white dark:bg-slate-700 text-emerald-600 dark:text-emerald-400 shadow-sm'
                            : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                >
                    <DollarSign size={13} /> Contado
                </button>
                <button
                    onClick={() => setModo('credito')}
                    disabled={casheaActive}
                    title={casheaActive ? "No disponible para compras financiadas con Cashea" : ""}
                    className={`px-5 py-1.5 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 ${
                        casheaActive
                            ? 'opacity-40 cursor-not-allowed text-slate-400 dark:text-slate-600'
                            : modo === 'credito'
                                ? 'bg-white dark:bg-slate-700 text-amber-600 dark:text-amber-400 shadow-sm ring-1 ring-amber-200 dark:ring-amber-800/40'
                                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
                    }`}
                >
                    <Wallet size={13} /> Crédito
                </button>
            </div>

            {/* Acciones: switch de modo + cerrar */}
            <div className="flex items-center gap-2">
                {onSwitchToBasic && (
                    <button
                        onClick={onSwitchToBasic}
                        title="Cambiar al modo móvil / tablet"
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[10px] font-bold text-slate-400 hover:text-brand hover:bg-brand/5 border border-slate-200 dark:border-slate-700 dark:hover:border-brand/30 transition-all"
                    >
                        <LayoutGrid size={12} /> Modo Móvil
                    </button>
                )}
                <button
                    onClick={onClose}
                    className="w-9 h-9 bg-slate-50 dark:bg-slate-900 hover:bg-red-50 dark:hover:bg-red-950/20 hover:text-red-500 text-slate-400 rounded-xl transition-all flex items-center justify-center active:scale-90"
                >
                    <X size={18} />
                </button>
            </div>
        </div>
    );
}
