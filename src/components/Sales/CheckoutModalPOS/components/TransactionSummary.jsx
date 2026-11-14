import { memo } from 'react';
import { CheckCircle } from 'lucide-react';
import { round2 } from '../../../../utils/dinero';

const fmtBs = (n) => round2(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * TransactionSummary — Resumen único del cobro (PC): Total, Pagado y la
 * tercera fila que cambia según el estado (Falta / Vuelto / Pago completo /
 * Queda debiendo). CASO-056 fase 1: reemplaza «Total a pagar» + «Monto
 * pagado» + «Falta por pagar», que repetían el mismo número.
 */
const TransactionSummary = ({
    totalUSD, totalBS, discountData, tasaSegura, baseUsd = 0, ivaUsd = 0,
    modo = 'contado', totalPagadoUSD = 0, faltaPorPagar = 0, faltaPorPagarBS = 0,
    cambioUSD = 0, deudaCliente = 0,
}) => {
    const isCredit = modo === 'credito';
    const creditOver = isCredit && cambioUSD > 0.01;

    let estado;
    if (isCredit) {
        estado = creditOver
            ? { label: 'Excede la venta', usd: `+$${cambioUSD.toFixed(2)}`, bs: fmtBs(cambioUSD * tasaSegura), tone: 'red' }
            : { label: 'Queda debiendo', usd: `$${deudaCliente.toFixed(2)}`, bs: fmtBs(deudaCliente * tasaSegura), tone: 'amber' };
    } else if (faltaPorPagar > 0.01) {
        estado = { label: 'Falta', usd: `$${faltaPorPagar.toFixed(2)}`, bs: fmtBs(faltaPorPagarBS), tone: 'amber' };
    } else if (cambioUSD > 0.009) {
        estado = { label: 'Vuelto', usd: `$${cambioUSD.toFixed(2)}`, bs: fmtBs(cambioUSD * tasaSegura), tone: 'green' };
    } else {
        estado = { label: 'Pago completo', usd: null, bs: null, tone: 'green' };
    }

    const toneCls = {
        amber: 'bg-amber-400/15 text-amber-300 ring-amber-400/30',
        green: 'bg-emerald-400/15 text-emerald-300 ring-emerald-400/30',
        red: 'bg-red-400/15 text-red-300 ring-red-400/30',
    }[estado.tone];

    return (
        <div className="px-3 pt-3 pb-2 shrink-0" data-testid="pos-summary">
            <div className="px-4 py-3 bg-slate-900 dark:bg-slate-800 text-white rounded-2xl shadow-md">
                {/* Total */}
                <div className="flex items-baseline justify-between gap-2">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-slate-300">Total</span>
                    <div className="flex items-baseline gap-2 min-w-0">
                        <span className="text-3xl font-black tracking-tight">${totalUSD.toFixed(2)}</span>
                        <span className="text-sm font-bold text-emerald-400 truncate">Bs {fmtBs(totalBS)}</span>
                    </div>
                </div>
                {(ivaUsd > 0 || discountData?.active) && (
                    <div className="flex justify-end gap-3 text-[11px] font-semibold text-slate-300 mt-0.5">
                        {ivaUsd > 0 && <span>Base ${baseUsd.toFixed(2)} + IVA ${ivaUsd.toFixed(2)}</span>}
                        {discountData?.active && (
                            <span className="text-emerald-300">
                                Desc. -{discountData.type === 'percentage' ? `${discountData.value}%` : `$${discountData.amountUsd?.toFixed(2)}`}
                            </span>
                        )}
                    </div>
                )}

                {/* Pagado */}
                <div className="flex items-baseline justify-between gap-2 mt-2 pt-2 border-t border-white/10">
                    <span className="text-[11px] font-bold uppercase tracking-widest text-slate-300">Pagado</span>
                    <span className="text-lg font-black text-white">${totalPagadoUSD.toFixed(2)}</span>
                </div>

                {/* Falta / Vuelto / Completo / Deuda */}
                <div
                    className={`flex items-center justify-between gap-2 mt-2 px-3 py-2 rounded-xl ring-1 ${toneCls}`}
                    aria-live="polite"
                    data-testid="pos-summary-estado"
                >
                    <span className="text-xs font-black uppercase tracking-widest">{estado.label}</span>
                    {estado.usd ? (
                        <div className="flex items-baseline gap-2 min-w-0">
                            <span className="text-2xl font-black">{estado.usd}</span>
                            <span className="text-sm font-bold truncate">Bs {estado.bs}</span>
                        </div>
                    ) : (
                        <CheckCircle size={24} />
                    )}
                </div>
            </div>
        </div>
    );
};

export default memo(TransactionSummary);
