import React, { useState } from 'react';
import { Wallet, ChevronRight, Calculator } from 'lucide-react';
import { formatBs, formatCop } from '../../utils/calculatorUtils';
import { calcularEfectivoEsperado } from '../../utils/cajaEsperada';
import ArqueoRapidoModal from './ArqueoRapidoModal';

/**
 * Tarjeta de efectivo esperado en caja (solo Admin).
 *
 * Muestra el efectivo esperado en gaveta (USD / Bs / COP) y ofrece un botón
 * de arqueo rápido para previsualizar el desglose de cobros/vueltos y comprobar
 * el efectivo en mano sin cerrar la caja.
 */
export default function EfectivoEsperadoCard({
    paymentBreakdown,
    fondoBreakdown = {},
    copEnabled = false,
    bcvRate = 1,
    tasaCop = 0,
    triggerHaptic,
}) {
    const [isArqueoOpen, setIsArqueoOpen] = useState(false);
    const { expectedUsd, expectedBs, expectedCop } = calcularEfectivoEsperado(paymentBreakdown);
    const showCop = copEnabled && expectedCop !== 0;

    return (
        <>
            <div className="min-h-full bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5">
                            <Wallet size={13} className="text-brand" /> Efectivo esperado en caja
                        </h3>
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-800/30">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                            En vivo
                        </span>
                    </div>

                    <div className="flex flex-wrap gap-5 mt-1">
                        <div>
                            <p className="text-[10px] font-bold text-emerald-500 uppercase tracking-wider">Dólares</p>
                            <p className={`text-xl font-black ${expectedUsd < 0 ? 'text-red-500' : 'text-slate-800 dark:text-white'}`}>
                                USD {expectedUsd.toFixed(2)}
                            </p>
                        </div>
                        <div>
                            <p className="text-[10px] font-bold text-brand uppercase tracking-wider">Bolívares</p>
                            <p className={`text-xl font-black ${expectedBs < 0 ? 'text-red-500' : 'text-slate-800 dark:text-white'}`}>
                                {formatBs(expectedBs)} Bs
                            </p>
                        </div>
                        {showCop && (
                            <div>
                                <p className="text-[10px] font-bold text-amber-500 uppercase tracking-wider">Pesos</p>
                                <p className="text-xl font-black text-slate-800 dark:text-white">
                                    {formatCop(expectedCop)} COP
                                </p>
                            </div>
                        )}
                    </div>
                </div>

                <button
                    type="button"
                    onClick={() => {
                        triggerHaptic?.();
                        setIsArqueoOpen(true);
                    }}
                    className="w-full mt-3 py-2 px-3 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700/60 rounded-xl text-xs font-bold flex items-center justify-between group active:scale-[0.98] transition-all"
                    aria-label="Previsualizar arqueo de caja"
                >
                    <span className="flex items-center gap-2">
                        <Calculator size={14} className="text-brand group-hover:scale-110 transition-transform" />
                        <span>Previsualizar Arqueo</span>
                    </span>
                    <ChevronRight size={14} className="text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                </button>
            </div>

            <ArqueoRapidoModal
                isOpen={isArqueoOpen}
                onClose={() => setIsArqueoOpen(false)}
                paymentBreakdown={paymentBreakdown}
                fondoBreakdown={fondoBreakdown}
                bcvRate={bcvRate}
                copEnabled={copEnabled}
                tasaCop={tasaCop}
                triggerHaptic={triggerHaptic}
            />
        </>
    );
}
