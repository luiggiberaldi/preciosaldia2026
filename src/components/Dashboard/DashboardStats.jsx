import React from 'react';
import { TrendingUp, Package, ShoppingBag, Users, ChevronDown, ChevronUp, Key } from 'lucide-react';
import { formatBs, formatCop } from '../../utils/calculatorUtils';
import AnimatedCounter from '../AnimatedCounter';
import CasheaIcon from '../CasheaIcon';

export default function DashboardStats({
    isDemo, demoTimeLeft, deviceId,
    todayTotalUsd, todayTotalBs, todayTotalCop, todaySales, todayItemsSold,
    todayExpenses, todayExpensesUsd, todayGastosUsd = 0,
    todayProfit, bcvRate,
    totalDeudas, showTopDeudas, setShowTopDeudas,
    triggerHaptic, copEnabled, copPrimary, tasaCop,
}) {
    return (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4">
            {/* Licencia Demo */}
            {isDemo && demoTimeLeft && (
                <div className="col-span-2 lg:col-span-4 bg-gradient-to-r from-amber-500 to-amber-600 rounded-2xl p-4 shadow-sm relative overflow-hidden text-white flex items-center justify-between">
                    <div className="absolute right-0 top-0 w-32 h-32 bg-white/10 rounded-full blur-2xl -translate-y-1/2 translate-x-1/2"></div>
                    <div className="flex items-center gap-3 relative z-10">
                        <div className="w-10 h-10 bg-black/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                            <Key size={20} className="text-amber-100" />
                        </div>
                        <div>
                            <h3 className="text-[13px] font-bold text-amber-50 leading-tight">Licencia de Prueba</h3>
                            <p className="text-2xl font-outfit font-semibold mt-0.5">{demoTimeLeft}</p>
                        </div>
                    </div>
                    <div className="relative z-10 text-right">
                        <button className="text-[10px] font-bold bg-white/20 hover:bg-white/30 transition-colors px-3 py-1.5 rounded-lg active:scale-95" onClick={() => window.open(`https://wa.me/584124051793?text=Hola! Quiero adquirir la licencia Premium de PreciosAlDía Bodega. Mi ID de instalación es: ${deviceId || 'N/A'}`.replace(/\s+/g, '%20'), '_blank')}>
                            ADQUIRIR
                        </button>
                    </div>
                </div>
            )}

            {/* Ventas Hoy */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm relative overflow-hidden">
                <div className={`absolute -right-4 -top-4 w-16 h-16 ${copEnabled && copPrimary ? 'bg-amber-50 dark:bg-amber-900/10' : 'bg-emerald-50 dark:bg-emerald-900/10'} rounded-full blur-2xl`}></div>
                <div className="flex items-center justify-between mb-3 relative z-10">
                    <div className={`w-10 h-10 ${copEnabled && copPrimary ? 'bg-amber-100 dark:bg-amber-900/30' : 'bg-emerald-100 dark:bg-emerald-900/30'} rounded-xl flex items-center justify-center shadow-inner`}>
                        <span className={`${copEnabled && copPrimary ? 'text-amber-600 dark:text-amber-400' : 'text-emerald-600 dark:text-emerald-400'} font-black text-xl`}>{copEnabled && copPrimary ? 'C' : '$'}</span>
                    </div>
                    <span className={`text-[10px] font-bold ${copEnabled && copPrimary ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30' : 'text-emerald-600 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/30'} px-2 py-1 rounded-lg tracking-wider`}>HOY</span>
                </div>
                <div className="relative z-10">
                    {copEnabled && copPrimary && tasaCop > 0 ? (
                        <>
                            <div className="flex items-baseline gap-1">
                                <span className="text-3xl font-outfit font-semibold text-amber-600 dark:text-amber-400 tracking-tight">
                                    {formatCop(todayTotalCop || Math.round(todayTotalUsd * tasaCop))} <span className="text-base">COP</span>
                                </span>
                            </div>
                            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mt-0.5">${todayTotalUsd.toFixed(2)} · {formatBs(todayTotalBs)} Bs</p>
                        </>
                    ) : (
                        <>
                            <div className="flex items-baseline gap-1">
                                <span className="text-3xl font-outfit font-semibold text-slate-800 dark:text-white tracking-tight">
                                    $<AnimatedCounter value={todayTotalUsd} />
                                </span>
                            </div>
                            {copEnabled && tasaCop > 0 && (
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mt-0.5">{formatCop(todayTotalCop || Math.round(todayTotalUsd * tasaCop))} COP · {formatBs(todayTotalBs)} Bs</p>
                            )}
                            {!(copEnabled && tasaCop > 0) && (
                                <p className="text-sm font-bold text-slate-400 dark:text-slate-500 mt-0.5">{formatBs(todayTotalBs)} Bs</p>
                            )}
                        </>
                    )}
                    <p className="text-[11px] font-medium text-slate-400 mt-1">Ingresos brutos</p>
                </div>
            </div>

            {/* Transacciones */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
                <div className="flex items-center justify-between mb-2">
                    <div className="w-9 h-9 bg-brand-light dark:bg-surface-800/30 rounded-xl flex items-center justify-center">
                        <ShoppingBag size={18} className="text-brand" />
                    </div>
                </div>
                <p className="text-2xl font-outfit font-semibold text-slate-800 dark:text-white leading-none"><AnimatedCounter value={todaySales.length} /> <span className="text-xs font-bold text-slate-400">{todaySales.length === 1 ? 'venta' : 'ventas'}</span></p>
                <p className="text-[11px] text-slate-400 mt-1"><AnimatedCounter value={todayItemsSold} /> {todayItemsSold === 1 ? 'artículo vendido' : 'artículos vendidos'}</p>
            </div>

            {/* Egresos del Día */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-orange-200 dark:border-orange-800/30 shadow-sm relative overflow-hidden">
                <div className="absolute -right-4 -top-4 w-16 h-16 bg-orange-50 dark:bg-orange-900/10 rounded-full blur-2xl"></div>
                <div className="flex items-center justify-between mb-3 relative z-10">
                    <div className="w-10 h-10 bg-orange-100 dark:bg-orange-900/30 rounded-xl flex items-center justify-center shadow-inner shrink-0">
                        <Package size={20} className="text-orange-500" />
                    </div>
                    <span className="text-[10px] font-bold text-orange-600 dark:text-orange-400 bg-orange-50 dark:bg-orange-900/30 px-2 py-1 rounded-lg tracking-wider shrink-0 whitespace-nowrap">
                        {todayExpenses.length} {todayExpenses.length === 1 ? 'PAGO' : 'PAGOS'}
                    </span>
                </div>
                <div className="relative z-10">
                    {copEnabled && copPrimary && tasaCop > 0 ? (
                        <>
                            <div className="flex items-baseline gap-1">
                                <span className="text-2xl sm:text-3xl font-outfit font-semibold text-orange-600 dark:text-orange-400 tracking-tight">
                                    -{formatCop(todayExpensesUsd * tasaCop)} <span className="text-base">COP</span>
                                </span>
                            </div>
                            <p className="text-[10px] font-bold text-orange-400 mt-0.5">-${todayExpensesUsd.toFixed(2)} · {formatBs(todayExpensesUsd * bcvRate)} Bs</p>
                        </>
                    ) : (
                        <>
                            <div className="flex items-baseline gap-1">
                                <span className="text-2xl sm:text-3xl font-outfit font-semibold text-orange-600 dark:text-orange-400 tracking-tight">
                                    -$<AnimatedCounter value={todayExpensesUsd} />
                                </span>
                            </div>
                            <p className="text-sm font-bold text-orange-400 mt-0.5">{formatBs(todayExpensesUsd * bcvRate)} Bs</p>
                            {copEnabled && tasaCop > 0 && <p className="text-[10px] text-orange-400">{formatCop(todayExpensesUsd * tasaCop)} COP</p>}
                        </>
                    )}
                    <p className="text-[11px] font-medium text-slate-400 mt-1">Egresos del día</p>
                    {todayGastosUsd > 0 && (
                        <div className="mt-2 pt-1.5 border-t border-orange-100/50 dark:border-orange-950/50 flex flex-wrap gap-2 text-[10px] text-slate-400 font-bold">
                            <span>Caja Chica: -${todayGastosUsd.toFixed(2)}</span>
                            {todayExpensesUsd - todayGastosUsd > 0.01 && (
                                <span>Proveedores: -${(todayExpensesUsd - todayGastosUsd).toFixed(2)}</span>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Ganancia Estimada */}
            <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm relative overflow-hidden">
                <div className="absolute -right-4 -top-4 w-16 h-16 bg-green-50 dark:bg-green-900/10 rounded-full blur-2xl"></div>
                <div className="flex items-center justify-between mb-3 relative z-10">
                    <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center shadow-inner">
                        <TrendingUp size={20} className="text-green-600 dark:text-green-400" strokeWidth={2.5} />
                    </div>
                </div>
                <div className="relative z-10">
                    {copEnabled && copPrimary && tasaCop > 0 ? (
                        <>
                            <div className="flex items-baseline gap-1">
                                <span className={`text-3xl font-outfit font-semibold tracking-tight ${todayProfit >= 0 ? 'text-amber-600 dark:text-amber-400' : 'text-red-500'}`}>
                                    {todayProfit >= 0 ? '+' : ''}{formatCop((bcvRate > 0 ? todayProfit / bcvRate : 0) * tasaCop)} <span className="text-base">COP</span>
                                </span>
                            </div>
                            <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mt-0.5">{todayProfit >= 0 ? '+' : ''}${bcvRate > 0 ? (todayProfit / bcvRate).toFixed(2) : '0.00'} · {formatBs(todayProfit)} Bs</p>
                        </>
                    ) : (
                        <>
                            <div className="flex items-baseline gap-1">
                                <span className={`text-3xl font-outfit font-semibold tracking-tight ${todayProfit >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-500'}`}>
                                    {todayProfit >= 0 ? '+' : ''}${bcvRate > 0 ? (todayProfit / bcvRate).toFixed(2) : '0.00'}
                                </span>
                            </div>
                            {copEnabled && tasaCop > 0 && (
                                <p className="text-[10px] font-bold text-slate-400 dark:text-slate-500 mt-0.5">{formatCop((bcvRate > 0 ? todayProfit / bcvRate : 0) * tasaCop)} COP · {formatBs(todayProfit)} Bs</p>
                            )}
                            {!(copEnabled && tasaCop > 0) && (
                                <p className="text-sm font-bold text-slate-400 dark:text-slate-500 mt-0.5">{formatBs(todayProfit)} Bs</p>
                            )}
                        </>
                    )}
                    <p className="text-[11px] font-medium text-slate-400 mt-1">Ganancia estimada</p>
                </div>
            </div>


            {/* Deudas Pendientes */}
            {totalDeudas.count > 0 && (
                <div
                    onClick={() => { setShowTopDeudas(!showTopDeudas); triggerHaptic && triggerHaptic(); }}
                    className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-red-100 dark:border-red-800/30 shadow-sm relative overflow-hidden col-span-2 lg:col-span-4 cursor-pointer active:scale-[0.99] transition-all"
                >
                    <div className="absolute -right-4 -top-4 w-16 h-16 bg-red-50 dark:bg-red-900/10 rounded-full blur-2xl"></div>
                    <div className="flex items-center justify-between relative z-10">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-xl flex items-center justify-center shadow-inner">
                                <Users size={20} className="text-red-500" />
                            </div>
                            <div>
                                <p className="text-[10px] font-bold text-red-400 uppercase">Deudas por cobrar</p>
                                {copEnabled && copPrimary && tasaCop > 0 ? (
                                    <>
                                        <p className="text-2xl font-outfit font-semibold text-red-500">
                                            {formatCop(totalDeudas.totalUsd * tasaCop)} COP
                                        </p>
                                        <p className="text-[10px] text-red-400">${totalDeudas.totalUsd.toFixed(2)} · {formatBs(totalDeudas.totalUsd * bcvRate)} Bs</p>
                                    </>
                                ) : (
                                    <>
                                        <p className="text-2xl font-outfit font-semibold text-red-500">
                                            ${totalDeudas.totalUsd.toFixed(2)}
                                        </p>
                                        {copEnabled && tasaCop > 0 && (
                                            <p className="text-[10px] text-red-400">{formatCop(totalDeudas.totalUsd * tasaCop)} COP · {formatBs(totalDeudas.totalUsd * bcvRate)} Bs</p>
                                        )}
                                        {!(copEnabled && tasaCop > 0) && bcvRate > 0 && (
                                            <p className="text-[10px] text-red-400">{formatBs(totalDeudas.totalUsd * bcvRate)} Bs</p>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                        <div className="text-right flex items-center gap-2">
                            <div>
                                <p className="text-sm font-bold text-slate-400">{totalDeudas.count} {totalDeudas.count === 1 ? 'cliente' : 'clientes'}</p>
                            </div>
                            {showTopDeudas ? <ChevronUp size={16} className="text-slate-400" /> : <ChevronDown size={16} className="text-slate-400" />}
                        </div>
                    </div>

                    {showTopDeudas && (
                        <div className="mt-3 pt-3 border-t border-red-100 dark:border-red-800/20 space-y-2 relative z-10" style={{ animation: 'fadeIn 0.2s ease' }}>
                            {totalDeudas.top5.map((c, i) => {
                                const debtNormal = c.deuda || 0;
                                const debtCashea = c.casheaDeuda || 0;
                                const debtTotal = debtNormal + debtCashea;
                                return (
                                    <div key={c.id} className="flex items-center justify-between py-1.5">
                                        <div className="flex items-center gap-2.5 min-w-0">
                                            <span className="text-[10px] font-black text-red-300 w-4 text-center shrink-0">{i + 1}</span>
                                            <div className="w-7 h-7 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center shrink-0">
                                                <span className="text-xs font-black text-red-400">{c.name.charAt(0).toUpperCase()}</span>
                                            </div>
                                            <div className="min-w-0">
                                                <p className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{c.name}</p>
                                                {debtCashea > 0 && (
                                                    <span className="text-[9px] font-black text-purple-600 dark:text-purple-400 flex items-center gap-1 mt-0.5">
                                                        <CasheaIcon size={10} /> Incluye Cashea (${debtCashea.toFixed(2)})
                                                    </span>
                                                )}
                                            </div>
                                        </div>
                                        <div className="text-right shrink-0">
                                            {copEnabled && copPrimary && tasaCop > 0 ? (
                                                <>
                                                    <p className="text-sm font-black text-red-500">
                                                        {formatCop(debtTotal * tasaCop)} COP
                                                    </p>
                                                    <p className="text-[9px] text-red-400/60">${debtTotal.toFixed(2)} · {formatBs(debtTotal * bcvRate)} Bs</p>
                                                </>
                                            ) : (
                                                <>
                                                    <p className="text-sm font-black text-red-500">
                                                        ${debtTotal.toFixed(2)}
                                                    </p>
                                                    {copEnabled && tasaCop > 0 && (
                                                        <p className="text-[9px] text-red-400/60">{formatCop(debtTotal * tasaCop)} COP · {formatBs(debtTotal * bcvRate)} Bs</p>
                                                    )}
                                                    {!(copEnabled && tasaCop > 0) && bcvRate > 0 && (
                                                        <p className="text-[9px] text-red-400/60">{formatBs(debtTotal * bcvRate)} Bs</p>
                                                    )}
                                                </>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
