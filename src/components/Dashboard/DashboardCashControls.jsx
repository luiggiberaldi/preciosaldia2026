import React from 'react';
import { CheckCircle2, LockIcon, Plus, Wallet } from 'lucide-react';
import { formatCop } from '../../utils/calculatorUtils';
import EfectivoEsperadoCard from './EfectivoEsperadoCard';
import TasaOficialCard from './TasaOficialCard';

export default function DashboardCashControls({
    isAdmin,
    paymentBreakdown,
    fondoBreakdown,
    copEnabled,
    copPrimary,
    tasaCop,
    bcvRate,
    todayCashFlow,
    todayApertura,
    todaySales,
    todayTotalUsd,
    todayTotalCop,
    onDailyClose,
    onOpenGasto,
    onTasaClick,
    onGoVentas,
    triggerHaptic,
}) {
    return (
        <section className="grid grid-cols-1 xl:grid-cols-2 gap-3 mb-5" aria-label="Resumen y controles de caja">
            <div className={`grid grid-cols-1 ${isAdmin ? 'sm:grid-cols-2' : ''} gap-3`}>
                {isAdmin && (
                    <EfectivoEsperadoCard
                        paymentBreakdown={paymentBreakdown}
                        fondoBreakdown={fondoBreakdown}
                        copEnabled={copEnabled}
                        bcvRate={bcvRate}
                        tasaCop={tasaCop}
                        triggerHaptic={triggerHaptic}
                    />
                )}
                <TasaOficialCard
                    canEditRate={isAdmin}
                    bcvRate={bcvRate}
                    copEnabled={copEnabled}
                    tasaCop={tasaCop}
                    triggerHaptic={triggerHaptic}
                />
            </div>

            <div className="grid grid-cols-1 gap-3">
                {(todayCashFlow.length > 0 || todaySales.length > 0) ? (
                    <button
                        type="button"
                        onClick={onDailyClose}
                        className="w-full min-h-[96px] bg-gradient-to-r from-orange-500 to-red-500 hover:from-orange-600 hover:to-red-600 text-white rounded-2xl p-4 shadow-lg shadow-red-500/20 active:scale-[0.98] transition-all flex items-center justify-between group"
                    >
                        <span className="flex items-center gap-3 min-w-0">
                            <span className="w-11 h-11 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm shrink-0">
                                <LockIcon size={22} />
                            </span>
                            <span className="text-left min-w-0">
                                <span className="block text-sm font-black">Cerrar Caja</span>
                                <span className="block text-[11px] font-medium text-white/80 truncate">
                                    {copEnabled && copPrimary && tasaCop > 0
                                        ? `${formatCop(todayTotalCop || Math.round(todayTotalUsd * tasaCop))} COP · $${todayTotalUsd.toFixed(2)}`
                                        : `$${todayTotalUsd.toFixed(2)}${copEnabled && tasaCop > 0 ? ` · ${formatCop(todayTotalCop || Math.round(todayTotalUsd * tasaCop))} COP` : ''}`}
                                    {' · '}{todaySales.length} {todaySales.length === 1 ? 'venta' : 'ventas'}
                                </span>
                            </span>
                        </span>
                        <span className="w-8 h-8 bg-white/20 rounded-lg flex items-center justify-center group-hover:translate-x-1 transition-transform shrink-0">
                            <LockIcon size={16} />
                        </span>
                    </button>
                ) : (
                    <div className="w-full min-h-[96px] bg-slate-100 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl p-4 flex items-center gap-3">
                        <span className="w-10 h-10 bg-emerald-100 dark:bg-emerald-900/30 rounded-xl flex items-center justify-center shrink-0">
                            <CheckCircle2 size={20} className="text-emerald-500" />
                        </span>
                        <span>
                            <span className="block text-sm font-bold text-slate-500 dark:text-slate-400">Sin ventas pendientes</span>
                            <span className="block text-[11px] text-slate-400 dark:text-slate-500">La caja está limpia</span>
                        </span>
                    </div>
                )}

                <div className={`grid grid-cols-1 ${isAdmin && todayApertura && onGoVentas ? 'sm:grid-cols-2' : ''} gap-3`}>
                    <button
                        type="button"
                        onClick={() => { triggerHaptic && triggerHaptic(); onOpenGasto && onOpenGasto(); }}
                    className="w-full min-h-[96px] bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-600 dark:text-rose-400 border border-rose-200/70 dark:border-rose-900/50 rounded-2xl p-4 shadow-sm active:scale-[0.98] transition-all flex items-center justify-between group"
                >
                    <span className="flex items-center gap-3 min-w-0">
                        <span className="w-11 h-11 bg-rose-100 dark:bg-rose-900/40 rounded-xl flex items-center justify-center shadow-inner shrink-0">
                            <Wallet size={22} className="text-rose-600 dark:text-rose-400" />
                        </span>
                        <span className="text-left min-w-0">
                            <span className="block text-sm font-black">Registrar Gasto</span>
                            <span className="block text-[11px] text-rose-500/80 font-bold">Abonos, compras e insumos</span>
                        </span>
                    </span>
                    <span className="w-8 h-8 bg-rose-100 dark:bg-rose-900/40 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform shrink-0">
                        <Plus size={18} className="text-rose-600 dark:text-rose-400" />
                    </span>
                    </button>
                    {isAdmin && todayApertura && onGoVentas && (
                        <button
                            type="button"
                            onClick={() => { triggerHaptic && triggerHaptic(); onGoVentas(); }}
                            className="w-full min-h-[96px] bg-emerald-50 dark:bg-emerald-950/30 hover:bg-emerald-100 dark:hover:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 border border-emerald-200/70 dark:border-emerald-900/50 rounded-2xl p-4 shadow-sm active:scale-[0.98] transition-all flex items-center justify-between group"
                        >
                            <span className="flex items-center gap-3 min-w-0">
                                <span className="w-11 h-11 bg-emerald-100 dark:bg-emerald-900/40 rounded-xl flex items-center justify-center shadow-inner shrink-0">
                                    <Wallet size={22} className="text-emerald-600 dark:text-emerald-400" />
                                </span>
                                <span className="text-left min-w-0">
                                    <span className="block text-sm font-black">Registrar Aporte</span>
                                    <span className="block text-[11px] text-emerald-600/80 dark:text-emerald-400/80 font-bold">Efectivo adicional del turno</span>
                                </span>
                            </span>
                            <span className="w-8 h-8 bg-emerald-100 dark:bg-emerald-900/40 rounded-lg flex items-center justify-center group-hover:scale-110 transition-transform shrink-0">
                                <Plus size={18} className="text-emerald-600 dark:text-emerald-400" />
                            </span>
                        </button>
                    )}
                </div>
            </div>
        </section>
    );
}
