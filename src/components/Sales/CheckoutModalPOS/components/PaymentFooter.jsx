import { CheckCircle, Wallet } from 'lucide-react';

/**
 * PaymentFooter — Footer del modo POS con botón PAGAR.
 */
export default function PaymentFooter({
    modo,
    faltaPorPagar,
    clienteSeleccionado,
    totalPagadoGlobalUSD,
    cambioUSD = 0,
    onProcesar,
    isProcessing = false,
    rateError = false,
    changeAllocationComplete = true,
    totalUsd = null,
    // 'side': bajo el resumen en la columna izquierda (PC). 'bottom': barra fija abajo (móvil).
    placement = 'bottom',
}) {
    const isSide = placement === 'side';
    const canPay = modo === 'contado'
        ? faltaPorPagar <= 0.01
        : (clienteSeleccionado && faltaPorPagar <= 0.01) || (clienteSeleccionado);

    // M-2: sin tasa BCV válida no se cobra (paridad con el modo básico).
    const creditOverpayment = modo === 'credito' && cambioUSD > 0.01;
    const disabled = isProcessing || rateError || creditOverpayment || (modo === 'contado'
        ? faltaPorPagar > 0.01 || !changeAllocationComplete
        : !clienteSeleccionado);

    return (
        <div className={isSide
            ? 'px-3 pt-2 pb-3 bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex shrink-0'
            : 'px-3 sm:px-5 pt-3 sm:pt-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:pb-4 bg-white/95 dark:bg-slate-950/95 backdrop-blur border-t border-slate-100 dark:border-slate-800 flex justify-end items-center gap-3 shrink-0 shadow-[0_-4px_10px_rgba(0,0,0,0.04)] dark:shadow-[0_-4px_10px_rgba(0,0,0,0.2)]'}>
            {/* Pagar / Fiar */}
            <button
                type="button"
                onClick={() => onProcesar(false)}
                disabled={disabled}
                aria-disabled={disabled}
                className={`px-4 sm:px-10 py-3.5 rounded-xl font-black flex items-center gap-2 shadow-lg transition-all active:scale-[0.97] flex-1 justify-center
                    ${isSide ? 'min-h-[60px] text-lg max-w-none' : 'min-h-[52px] text-sm sm:text-base max-w-none sm:max-w-xs'}
                    ${disabled
                        ? 'bg-slate-200 dark:bg-slate-800 !text-slate-700 dark:!text-slate-300 border-2 border-dashed border-slate-300 dark:border-slate-600 cursor-not-allowed shadow-none'
                        : modo === 'credito'
                            ? 'bg-amber-500 hover:bg-amber-600 text-white shadow-amber-500/25'
                            : 'bg-emerald-500 hover:bg-emerald-600 text-white shadow-emerald-500/25'
                    }`}
            >
                {isProcessing ? (
                    <><span className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin"></span> PROCESANDO...</>
                ) : modo === 'credito' ? (
                    creditOverpayment
                        ? <><Wallet size={20} /> PAGO EXCEDE LA VENTA</>
                        : <><Wallet size={20} /> {faltaPorPagar > 0.01
                            ? (totalPagadoGlobalUSD > 0.01 ? 'PROCESAR CON ABONO' : 'FIAR TOTALMENTE')
                            : 'REGISTRAR VENTA'}</>
                ) : (
                    faltaPorPagar > 0.01
                        ? <>FALTAN ${faltaPorPagar.toFixed(2)}</>
                        : changeAllocationComplete
                            ? <><CheckCircle size={22} /> {totalUsd != null ? `COBRAR $${Number(totalUsd).toFixed(2)}` : 'COBRAR'}</>
                            : <><Wallet size={20} /> CONFIRMA EL CAMBIO</>
                )}
            </button>
        </div>
    );
}
