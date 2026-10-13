import React from 'react';
import { Wallet } from 'lucide-react';
import { formatBs, formatCop } from '../../utils/calculatorUtils';
import { calcularEfectivoEsperado } from '../../utils/cajaEsperada';

/**
 * Tarjeta de efectivo esperado en caja. Solo para admin: el padre decide si la monta.
 * Usa la misma fórmula que el cierre de caja (utils/cajaEsperada).
 */
export default function EfectivoEsperadoCard({ paymentBreakdown, copEnabled }) {
    const { expectedUsd, expectedBs, expectedCop } = calcularEfectivoEsperado(paymentBreakdown);
    const showCop = copEnabled && expectedCop !== 0;

    return (
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm">
            <h3 className="text-xs font-bold text-slate-400 uppercase mb-3 flex items-center gap-1">
                <Wallet size={12} /> Efectivo esperado en caja
            </h3>
            <div className="flex flex-wrap gap-6">
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
                        <p className="text-xl font-black text-slate-800 dark:text-white">{formatCop(expectedCop)} COP</p>
                    </div>
                )}
            </div>
        </div>
    );
}
