import React, { useState, useMemo } from 'react';
import {
    X,
    Wallet,
    DollarSign,
    Coins,
    ArrowUpRight,
    ArrowDownRight,
    CheckCircle2,
    AlertTriangle,
    Info,
    RotateCcw,
} from 'lucide-react';
import { formatBs, formatCop } from '../../utils/calculatorUtils';
import { calcularEfectivoEsperado } from '../../utils/cajaEsperada';
import { round2, subR } from '../../utils/dinero';
import { FINANCIAL_EPSILON } from '../../utils/securityConstants';

/**
 * ArqueoRapidoModal — Previsualización y comprobación de arqueo físico en tiempo real.
 *
 * Permite al administrador/cajero consultar el desglose exacto de cobros en efectivo,
 * vueltos entregados y neto esperado en gaveta, además de simular un conteo en mano
 * para verificar si la caja está cuadrada en cualquier momento del turno sin alterar el sistema.
 */
export default function ArqueoRapidoModal({
    isOpen,
    onClose,
    paymentBreakdown = {},
    fondoBreakdown = {},
    bcvRate = 1,
    copEnabled = false,
    tasaCop = 0,
    triggerHaptic,
}) {
    const [conteoUsd, setConteoUsd] = useState('');
    const [conteoBs, setConteoBs] = useState('');
    const [conteoCop, setConteoCop] = useState('');

    const { expectedUsd, expectedBs, expectedCop } = useMemo(
        () => calcularEfectivoEsperado(paymentBreakdown),
        [paymentBreakdown]
    );

    if (!isOpen) return null;

    // Desglose de cobros y vueltos
    const cobroUsd = paymentBreakdown['efectivo_usd']?.total || 0;
    const vueltoUsd = paymentBreakdown['_vuelto_usd']?.total || 0;
    const cobroBs = paymentBreakdown['efectivo_bs']?.total || 0;
    const vueltoBs = paymentBreakdown['_vuelto_bs']?.total || 0;
    const cobroCop = paymentBreakdown['efectivo_cop']?.total || 0;
    const vueltoCop = paymentBreakdown['_vuelto_cop']?.total || 0;

    // Fondos o aportes incluidos
    const fondoUsd = fondoBreakdown?.efectivo_usd?.total || 0;
    const fondoBs = fondoBreakdown?.efectivo_bs?.total || 0;

    const showCop = copEnabled && (expectedCop !== 0 || cobroCop !== 0);

    // Total consolidado en efectivo (a tasa BCV)
    const rate = Number(bcvRate) > 0 ? Number(bcvRate) : 1;
    const copRate = Number(tasaCop) > 0 ? Number(tasaCop) : 0;
    const copInUsd = showCop && copRate > 0 ? expectedCop / copRate : 0;
    const totalUsdConsolidado = round2(expectedUsd + (expectedBs / rate) + copInUsd);
    const totalBsConsolidado = round2(totalUsdConsolidado * rate);

    // Conteo en mano y cálculo de diferencias
    const hasInputUsd = conteoUsd.trim() !== '';
    const hasInputBs = conteoBs.trim() !== '';
    const hasInputCop = conteoCop.trim() !== '';
    const hasAnyInput = hasInputUsd || hasInputBs || (showCop && hasInputCop);

    const numUsd = hasInputUsd ? parseFloat(conteoUsd) || 0 : 0;
    const numBs = hasInputBs ? parseFloat(conteoBs) || 0 : 0;
    const numCop = hasInputCop ? parseFloat(conteoCop) || 0 : 0;

    const diffUsd = round2(subR(numUsd, expectedUsd));
    const diffBs = round2(subR(numBs, expectedBs));
    const diffCop = round2(subR(numCop, expectedCop));

    const isUsdOk = Math.abs(diffUsd) <= FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_USD;
    const isBsOk = Math.abs(diffBs) <= FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_BS;
    const isCopOk = !showCop || Math.abs(diffCop) <= FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_COP;

    const isTotalCuadrado = (!hasInputUsd || isUsdOk) && (!hasInputBs || isBsOk) && (!hasInputCop || isCopOk);

    const handleResetConteo = () => {
        triggerHaptic?.();
        setConteoUsd('');
        setConteoBs('');
        setConteoCop('');
    };

    return (
        <div
            className="fixed inset-0 z-[200] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-slate-900 rounded-[1.75rem] max-w-lg w-full shadow-2xl border border-slate-100 dark:border-slate-800 p-5 sm:p-6 my-auto max-h-[92vh] flex flex-col justify-between overflow-y-auto animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 bg-brand-light dark:bg-surface-800/30 rounded-2xl flex items-center justify-center shrink-0">
                            <Wallet size={22} className="text-brand" />
                        </div>
                        <div>
                            <div className="flex items-center gap-2">
                                <h3 className="text-lg font-black text-slate-800 dark:text-white leading-tight">
                                    Arqueo Rápido de Caja
                                </h3>
                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-800/30">
                                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                                    En vivo
                                </span>
                            </div>
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                                Verificación preliminar de gaveta sin cerrar el turno
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        aria-label="Cerrar modal"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body Content */}
                <div className="py-4 space-y-4">
                    {/* Tarjetas de Efectivo Esperado Desglosado */}
                    <div className={`grid grid-cols-1 ${showCop ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-3`}>
                        {/* Dólares */}
                        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-3.5 border border-slate-100 dark:border-slate-700/60">
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider flex items-center gap-1">
                                    <DollarSign size={13} /> Dólares (USD)
                                </span>
                                <span className="text-[10px] font-bold text-slate-400">Gaveta</span>
                            </div>
                            <p className={`text-2xl font-black ${expectedUsd < 0 ? 'text-red-500' : 'text-slate-800 dark:text-white'}`}>
                                USD {expectedUsd.toFixed(2)}
                            </p>

                            <div className="mt-2.5 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 space-y-1 text-[11px]">
                                <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                                    <span className="flex items-center gap-1">
                                        <ArrowDownRight size={12} className="text-emerald-500" /> Cobrado:
                                    </span>
                                    <span className="font-bold text-slate-700 dark:text-slate-300">+${cobroUsd.toFixed(2)}</span>
                                </div>
                                <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                                    <span className="flex items-center gap-1">
                                        <ArrowUpRight size={12} className="text-red-400" /> Vueltos dados:
                                    </span>
                                    <span className="font-bold text-slate-700 dark:text-slate-300">-${vueltoUsd.toFixed(2)}</span>
                                </div>
                                {fondoUsd > 0 && (
                                    <p className="text-[10px] text-slate-400 dark:text-slate-500 text-right pt-0.5">
                                        incluye apertura/aportes: ${fondoUsd.toFixed(2)}
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Bolívares */}
                        <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-3.5 border border-slate-100 dark:border-slate-700/60">
                            <div className="flex items-center justify-between mb-1.5">
                                <span className="text-[11px] font-bold text-brand uppercase tracking-wider flex items-center gap-1">
                                    <Coins size={13} /> Bolívares (Bs)
                                </span>
                                <span className="text-[10px] font-bold text-slate-400">Gaveta</span>
                            </div>
                            <p className={`text-2xl font-black ${expectedBs < 0 ? 'text-red-500' : 'text-slate-800 dark:text-white'}`}>
                                {formatBs(expectedBs)} <span className="text-sm font-bold text-slate-400">Bs</span>
                            </p>

                            <div className="mt-2.5 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 space-y-1 text-[11px]">
                                <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                                    <span className="flex items-center gap-1">
                                        <ArrowDownRight size={12} className="text-emerald-500" /> Cobrado:
                                    </span>
                                    <span className="font-bold text-slate-700 dark:text-slate-300">+{formatBs(cobroBs)} Bs</span>
                                </div>
                                <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                                    <span className="flex items-center gap-1">
                                        <ArrowUpRight size={12} className="text-red-400" /> Vueltos dados:
                                    </span>
                                    <span className="font-bold text-slate-700 dark:text-slate-300">-{formatBs(vueltoBs)} Bs</span>
                                </div>
                                {fondoBs > 0 && (
                                    <p className="text-[10px] text-slate-400 dark:text-slate-500 text-right pt-0.5">
                                        incluye apertura/aportes: {formatBs(fondoBs)} Bs
                                    </p>
                                )}
                            </div>
                        </div>

                        {/* Pesos COP (si aplica) */}
                        {showCop && (
                            <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-3.5 border border-slate-100 dark:border-slate-700/60">
                                <div className="flex items-center justify-between mb-1.5">
                                    <span className="text-[11px] font-bold text-amber-500 uppercase tracking-wider flex items-center gap-1">
                                        <Coins size={13} /> Pesos (COP)
                                    </span>
                                    <span className="text-[10px] font-bold text-slate-400">Gaveta</span>
                                </div>
                                <p className="text-xl font-black text-slate-800 dark:text-white">
                                    {formatCop(expectedCop)} <span className="text-xs font-bold text-slate-400">COP</span>
                                </p>
                                <div className="mt-2.5 pt-2 border-t border-slate-200/60 dark:border-slate-700/60 space-y-1 text-[11px]">
                                    <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                                        <span className="flex items-center gap-1">
                                            <ArrowDownRight size={12} className="text-emerald-500" /> Cobrado:
                                        </span>
                                        <span className="font-bold text-slate-700 dark:text-slate-300">+{formatCop(cobroCop)} COP</span>
                                    </div>
                                    {vueltoCop > 0 && (
                                        <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
                                            <span className="flex items-center gap-1">
                                                <ArrowUpRight size={12} className="text-red-400" /> Vuelto:
                                            </span>
                                            <span className="font-bold text-slate-700 dark:text-slate-300">-{formatCop(vueltoCop)} COP</span>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Consolidado Patrimonial en Efectivo */}
                    <div className="bg-gradient-to-r from-slate-900 to-slate-800 dark:from-slate-800 dark:to-slate-950 text-white rounded-2xl p-3.5 flex items-center justify-between">
                        <div className="flex items-center gap-2.5">
                            <span className="w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
                                <Coins size={16} className="text-brand-light" />
                            </span>
                            <div>
                                <span className="block text-[10px] uppercase tracking-wider text-slate-400 font-bold">
                                    Total Consolidado en Efectivo
                                </span>
                                <span className="block text-xs font-medium text-slate-300">
                                    ≈ {formatBs(totalBsConsolidado)} Bs a tasa {formatBs(rate)} Bs/$
                                </span>
                            </div>
                        </div>
                        <div className="text-right">
                            <span className="text-lg font-black text-white">
                                ≈ ${totalUsdConsolidado.toFixed(2)}
                            </span>
                            <span className="block text-[10px] text-slate-400">USD total</span>
                        </div>
                    </div>

                    {/* Conteo Físico Rápido (Comprobación en vivo) */}
                    <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-700/60 rounded-2xl p-4">
                        <div className="flex items-center justify-between mb-3">
                            <div>
                                <h4 className="text-xs font-bold text-slate-700 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                                    <span>Comprobar Efectivo Físico en Mano</span>
                                </h4>
                                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                                    Ingresa cuánto tienes contado en gaveta para validar diferencias al instante
                                </p>
                            </div>
                            {hasAnyInput && (
                                <button
                                    type="button"
                                    onClick={handleResetConteo}
                                    className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-lg hover:bg-slate-200/60 dark:hover:bg-slate-700/60 transition-colors"
                                    title="Limpiar conteo"
                                >
                                    <RotateCcw size={14} />
                                </button>
                            )}
                        </div>

                        <div className={`grid grid-cols-1 ${showCop ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} gap-3 mb-3`}>
                            {/* Input USD */}
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1 mb-1 block">
                                    USD en mano
                                </label>
                                <div className="relative flex items-center">
                                    <DollarSign size={14} className="absolute left-3 text-slate-400" />
                                    <input
                                        type="number"
                                        step="any"
                                        inputMode="decimal"
                                        value={conteoUsd}
                                        onChange={(e) => setConteoUsd(e.target.value)}
                                        placeholder={expectedUsd.toFixed(2)}
                                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl py-2 pl-8 pr-3 text-sm text-slate-800 dark:text-white font-bold outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all font-mono"
                                    />
                                </div>
                                {hasInputUsd && (
                                    <div className="mt-1 pl-1">
                                        {isUsdOk ? (
                                            <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                                <CheckCircle2 size={11} /> Cuadrado ($0.00)
                                            </span>
                                        ) : diffUsd > 0 ? (
                                            <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400">
                                                Sobra +${diffUsd.toFixed(2)}
                                            </span>
                                        ) : (
                                            <span className="text-[11px] font-bold text-red-500">
                                                Falta -${Math.abs(diffUsd).toFixed(2)}
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Input Bs */}
                            <div>
                                <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1 mb-1 block">
                                    Bolívares en mano
                                </label>
                                <div className="relative flex items-center">
                                    <span className="absolute left-3 text-[11px] font-bold text-slate-400">Bs</span>
                                    <input
                                        type="number"
                                        step="any"
                                        inputMode="decimal"
                                        value={conteoBs}
                                        onChange={(e) => setConteoBs(e.target.value)}
                                        placeholder={expectedBs.toFixed(2)}
                                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl py-2 pl-9 pr-3 text-sm text-slate-800 dark:text-white font-bold outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all font-mono"
                                    />
                                </div>
                                {hasInputBs && (
                                    <div className="mt-1 pl-1">
                                        {isBsOk ? (
                                            <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                                <CheckCircle2 size={11} /> Cuadrado (0,00 Bs)
                                            </span>
                                        ) : diffBs > 0 ? (
                                            <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400">
                                                Sobra +{formatBs(diffBs)} Bs
                                            </span>
                                        ) : (
                                            <span className="text-[11px] font-bold text-red-500">
                                                Falta -{formatBs(Math.abs(diffBs))} Bs
                                            </span>
                                        )}
                                    </div>
                                )}
                            </div>

                            {/* Input COP (si aplica) */}
                            {showCop && (
                                <div>
                                    <label className="text-[10px] font-bold text-slate-500 uppercase tracking-widest pl-1 mb-1 block">
                                        Pesos en mano
                                    </label>
                                    <div className="relative flex items-center">
                                        <span className="absolute left-3 text-[10px] font-bold text-slate-400">COP</span>
                                        <input
                                            type="number"
                                            step="any"
                                            inputMode="decimal"
                                            value={conteoCop}
                                            onChange={(e) => setConteoCop(e.target.value)}
                                            placeholder={formatCop(expectedCop)}
                                            className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl py-2 pl-11 pr-3 text-sm text-slate-800 dark:text-white font-bold outline-none focus:border-brand focus:ring-2 focus:ring-brand/20 transition-all font-mono"
                                        />
                                    </div>
                                    {hasInputCop && (
                                        <div className="mt-1 pl-1">
                                            {isCopOk ? (
                                                <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                                                    <CheckCircle2 size={11} /> Cuadrado
                                                </span>
                                            ) : diffCop > 0 ? (
                                                <span className="text-[11px] font-bold text-blue-600 dark:text-blue-400">
                                                    Sobra +{formatCop(diffCop)} COP
                                                </span>
                                            ) : (
                                                <span className="text-[11px] font-bold text-red-500">
                                                    Falta -{formatCop(Math.abs(diffCop))} COP
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                        </div>

                        {/* Banner de Estado Global del Conteo */}
                        {hasAnyInput && (
                            <div
                                className={`p-2.5 rounded-xl text-xs flex items-center gap-2 ${
                                    isTotalCuadrado
                                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 border border-emerald-200/60 dark:border-emerald-800/40'
                                        : 'bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border border-amber-200/60 dark:border-amber-800/40'
                                }`}
                            >
                                {isTotalCuadrado ? (
                                    <>
                                        <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />
                                        <span>
                                            <strong>¡Excelente!</strong> El efectivo físico coincide con lo esperado por el sistema.
                                        </span>
                                    </>
                                ) : (
                                    <>
                                        <AlertTriangle size={15} className="shrink-0 text-amber-500" />
                                        <span>
                                            <strong>Hay diferencias detectadas:</strong> Revisa si entregaste vueltos sin registrar o si hubo salidas de efectivo.
                                        </span>
                                    </>
                                )}
                            </div>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                        <Info size={13} className="shrink-0 text-brand" />
                        <span>Esta comprobación no altera registros ni cierra el turno.</span>
                    </p>
                    <button
                        type="button"
                        onClick={onClose}
                        className="py-2.5 px-5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs transition-colors"
                    >
                        Cerrar previsualización
                    </button>
                </div>
            </div>
        </div>
    );
}
