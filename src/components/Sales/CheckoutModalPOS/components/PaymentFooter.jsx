import React from 'react';
import { CheckCircle, Wallet } from 'lucide-react';

/**
 * PaymentFooter — Footer del modo POS con botón PAGAR.
 */
export default function PaymentFooter({
    modo,
    faltaPorPagar,
    clienteSeleccionado,
    totalPagadoGlobalUSD,
    onProcesar,
    isProcessing = false,
}) {
    const canPay = modo === 'contado'
        ? faltaPorPagar <= 0.01
        : (clienteSeleccionado && faltaPorPagar <= 0.01) || (clienteSeleccionado);

    const disabled = isProcessing || (modo === 'contado'
        ? faltaPorPagar > 0.01
        : !clienteSeleccionado);

    return (
        <div className="px-5 py-4 bg-white dark:bg-slate-950 border-t border-slate-100 dark:border-slate-800 flex justify-end items-center gap-3 shrink-0 shadow-[0_-4px_10px_rgba(0,0,0,0.04)] dark:shadow-[0_-4px_10px_rgba(0,0,0,0.2)]">
            {/* Pagar / Fiar */}
            <button
                onClick={() => onProcesar(false)}
                disabled={disabled}
                className={`px-10 py-3.5 rounded-xl font-black text-base flex items-center gap-2 shadow-lg transition-all active:scale-[0.97] flex-1 max-w-xs justify-center
                    ${disabled
                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-450 dark:text-slate-500 cursor-not-allowed shadow-none'
                        : modo === 'credito'
                            ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/25'
                            : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/25'
                    }`}
            >
                {isProcessing ? (
                    <><span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span> PROCESANDO...</>
                ) : modo === 'credito' ? (
                    <><Wallet size={20} /> {totalPagadoGlobalUSD > 0.01 ? 'PROCESAR CON ABONO' : 'FIAR TOTALMENTE'}</>
                ) : (
                    <><CheckCircle size={20} /> PAGAR (LISTO)</>
                )}
            </button>
        </div>
    );
}
