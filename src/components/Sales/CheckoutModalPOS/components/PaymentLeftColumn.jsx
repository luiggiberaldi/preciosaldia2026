import { memo } from 'react';
import { round2 } from '../../../../utils/dinero';
import TransactionSummary from './TransactionSummary';
import CheckoutCustomerPicker from '../../CheckoutCustomerPicker';
import CasheaIcon from '../../../CasheaIcon';
import ChangeCard from './ChangeCard';

/**
 * PaymentLeftColumn — Columna izquierda del modo POS.
 * Contiene: resumen de totales, selector de cliente, estado de pago (falta/vuelto/crédito), Cashea.
 */
const PaymentLeftColumn = ({
    currentFloatUsd = null,
    currentFloatBs = null,
    totalUSD,
    totalBS,
    baseUsd = 0,
    ivaUsd = 0,
    discountData,
    tasaSegura,
    clienteSeleccionado,
    setClienteSeleccionado,
    customers,
    onCreateCustomer,
    modo,
    totalPagadoGlobalUSD,
    faltaPorPagar,
    faltaPorPagarBS,
    cambioUSD,
    distVueltoUSD,
    distVueltoBS,
    handleVueltoDistChange,
    isChangeCredited,
    handleCreditChange,
    setIsChangeCredited,
    isTipDonated,
    toggleTipDonated,
    cashKeptUsd,
    walletRemainderUsd,
    remainingChangeUsd,
    remainingChangeBs,
    deudaCliente,
    casheaActive,
    setCasheaActive,
    casheaPercent,
    setCasheaPercent,
    casheaAmountUsd,
    casheaEnabled,
    casheaMeetsMinimum,
    effectiveRate,
    footer = null,
    elegirVuelto,
    completarVuelto,
    autoCampo = null,
    restoLoDeja,
    restoABilletera,
    sugerido = null,
    isTouch = false,
    onFocusChangeField,
    activeChangeField = null,
    className = '',
}) => {
    const isPending = modo === 'contado' && faltaPorPagar > 0.01;
    const isPaid = modo === 'contado' && faltaPorPagar <= 0.01;
    const isCredit = modo === 'credito';
    const isCreditOverpayment = isCredit && cambioUSD > 0.01;

    return (
        <div className={`${className} w-full lg:w-[41%] bg-slate-50 dark:bg-slate-900 border-b lg:border-b-0 lg:border-r border-slate-100 dark:border-slate-800 flex flex-col overflow-hidden`}>

            {/* Resumen del total (oculto en móvil para evitar duplicidad; se muestra en cabecera del formulario) */}
            <div className="hidden lg:block">
                <TransactionSummary
                    totalUSD={totalUSD}
                    totalBS={totalBS}
                    baseUsd={baseUsd}
                    ivaUsd={ivaUsd}
                    discountData={discountData}
                    tasaSegura={tasaSegura}
                    modo={modo}
                    totalPagadoUSD={totalPagadoGlobalUSD}
                    faltaPorPagar={faltaPorPagar}
                    faltaPorPagarBS={faltaPorPagarBS}
                    cambioUSD={cambioUSD}
                    deudaCliente={deudaCliente}
                />
            </div>

            {/* Contenido scrollable */}
            <div className="flex-1 min-h-0 overflow-y-auto px-2.5 sm:px-3.5 pb-3 pt-1.5 space-y-2">

                {/* Selector de cliente: en móvil se muestra antes de los métodos de pago
                    desde CheckoutModalPOS; aquí se conserva para escritorio. */}
                <div className="hidden lg:block">
                <CheckoutCustomerPicker
                    customers={customers}
                    selectedCustomerId={clienteSeleccionado}
                    setSelectedCustomerId={setClienteSeleccionado}
                    effectiveRate={effectiveRate}
                    onCreateCustomer={onCreateCustomer}
                />
                </div>

                {/* Panel Cashea */}
                {casheaEnabled && casheaMeetsMinimum && clienteSeleccionado && (
                    <div className="p-2.5 bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/40 rounded-xl space-y-1.5 animate-in fade-in duration-300">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <CasheaIcon size={16} />
                                <span className="font-bold text-xs text-purple-900 dark:text-purple-300 uppercase tracking-wide">Cashea</span>
                            </div>
                            <button
                                type="button"
                                role="switch"
                                aria-checked={casheaActive}
                                aria-label="Activar Cashea"
                                onClick={() => setCasheaActive(!casheaActive)}
                                className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center p-1 shrink-0 cursor-pointer select-none focus:outline-none active:scale-95 transition-transform"
                            >
                                <span className={`relative inline-flex h-5 w-9 items-center rounded-full p-0.5 transition-colors duration-200 ease-in-out ${
                                    casheaActive ? 'bg-purple-600' : 'bg-slate-200 dark:bg-slate-700'
                                }`}>
                                    <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${casheaActive ? 'translate-x-4' : 'translate-x-0'}`} />
                                </span>
                            </button>
                        </div>
                        {casheaActive && (
                            <div className="space-y-1.5 animate-in slide-in-from-top-1 duration-200">
                                <div className="grid grid-cols-3 gap-1">
                                    {[60, 50, 40, 30, 20, 10].map(pct => (
                                        <button
                                            key={pct}
                                            onClick={() => setCasheaPercent(pct)}
                                            className={`py-0.5 text-[11px] font-black rounded-md transition-all ${
                                                casheaPercent === pct
                                                    ? 'bg-purple-600 text-white shadow-sm'
                                                    : 'bg-white dark:bg-slate-800 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-900/40 hover:bg-purple-100'
                                            }`}
                                        >{pct}%</button>
                                    ))}
                                </div>
                                <div className="p-2 bg-white dark:bg-slate-900 border border-purple-100 dark:border-purple-900/20 rounded-lg space-y-0.5 text-[10px]">
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">Paga Hoy (Inicial):</span>
                                        <span className="font-black text-slate-800 dark:text-white">${(totalUSD - casheaAmountUsd).toFixed(2)}</span>
                                    </div>
                                    <div className="flex justify-between">
                                        <span className="text-slate-500">Financiado Cashea:</span>
                                        <span className="font-black text-purple-600 dark:text-purple-400">${casheaAmountUsd.toFixed(2)}</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* Estado: Falta por pagar / Vuelto / Crédito */}
                <div className="space-y-1">
                    <div className="lg:hidden flex justify-between items-center px-1 text-[10px]">
                        <span className="text-slate-500 font-bold uppercase tracking-wide">Monto Pagado:</span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-extrabold">${totalPagadoGlobalUSD.toFixed(2)}</span>
                    </div>

                    {/* Falta por pagar */}
                    {isPending && (
                        <div className="lg:hidden flex flex-col justify-center items-center text-center p-3 sm:p-3.5 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm transition-all">
                            <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500 dark:text-slate-400">Falta por Pagar</p>
                            <div className="flex items-baseline justify-center gap-2 my-0.5">
                                <span className="text-2xl sm:text-3xl font-black text-slate-800 dark:text-white">${faltaPorPagar.toFixed(2)}</span>
                                <span className="text-xs sm:text-sm font-black text-brand dark:text-brand">
                                    Bs {faltaPorPagarBS.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Vuelto: cinco opciones de un toque (CASO-056) */}
                    {isPaid && cambioUSD > 0.009 && (
                        <ChangeCard
                            cambioUSD={cambioUSD}
                            tasaSegura={tasaSegura}
                            distVueltoUSD={distVueltoUSD}
                            distVueltoBS={distVueltoBS}
                            handleVueltoDistChange={handleVueltoDistChange}
                            elegirVuelto={elegirVuelto}
                            completarVuelto={completarVuelto}
                            autoCampo={autoCampo}
                            restoLoDeja={restoLoDeja}
                            restoABilletera={restoABilletera}
                            sugerido={sugerido}
                            isTipDonated={isTipDonated}
                            toggleTipDonated={toggleTipDonated}
                            cashKeptUsd={cashKeptUsd}
                            isChangeCredited={isChangeCredited}
                            handleCreditChange={handleCreditChange}
                            setIsChangeCredited={setIsChangeCredited}
                            walletRemainderUsd={walletRemainderUsd}
                            remainingChangeUsd={remainingChangeUsd}
                            remainingChangeBs={remainingChangeBs}
                            clienteSeleccionado={clienteSeleccionado}
                            currentFloatUsd={currentFloatUsd}
                            currentFloatBs={currentFloatBs}
                            isTouch={isTouch}
                            onFocusField={onFocusChangeField}
                            activeField={activeChangeField}
                        />
                    )}

                    {/* Pagado exacto */}
                    {isPaid && cambioUSD <= 0.009 && (
                        <div className="lg:hidden flex flex-col justify-center items-center text-center p-5 rounded-xl border-2 border-emerald-300 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-950/20 shadow-sm transition-all">
                            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">✓ Pago Completo</p>
                            <p className="text-xs text-emerald-600/70 mt-1">Sin vuelto</p>
                        </div>
                    )}

                    {/* Queda Debiendo (Crédito) */}
                    {isCredit && (
                        <div className={`${isCreditOverpayment ? '' : 'lg:hidden'} flex flex-col justify-center items-center text-center p-5 rounded-xl border-2 shadow-sm transition-all ${isCreditOverpayment
                            ? 'border-red-300 dark:border-red-800/50 bg-red-50 dark:bg-red-950/20'
                            : 'border-amber-200 dark:border-amber-800/30 bg-amber-50 dark:bg-amber-950/10'
                        }`}>
                            <p className={`text-[10px] font-extrabold uppercase tracking-widest ${isCreditOverpayment ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-500'}`}>
                                {isCreditOverpayment ? 'Pago excede la venta' : 'Queda Debiendo'}
                            </p>
                            <p className={`text-4xl lg:text-5xl font-black my-2 ${isCreditOverpayment ? 'text-red-700 dark:text-red-400' : 'text-amber-700 dark:text-amber-400'}`}>
                                {isCreditOverpayment ? `+$${cambioUSD.toFixed(2)}` : `$${deudaCliente.toFixed(2)}`}
                            </p>
                            <div className={`text-lg font-black ${isCreditOverpayment ? 'text-red-600 dark:text-red-300' : 'text-amber-600 dark:text-amber-300'}`}>
                                {isCreditOverpayment
                                    ? `Excedente · Bs ${round2(cambioUSD * tasaSegura).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`
                                    : `Bs ${round2(deudaCliente * tasaSegura).toLocaleString('es-VE', { minimumFractionDigits: 2 })}`
                                }
                            </div>
                            {isCreditOverpayment && (
                                <p className="mt-3 text-[11px] font-bold leading-tight text-red-600 dark:text-red-300">
                                    No se puede procesar como fiado. Cambia a Contado para entregar o acreditar el vuelto, o registra el abono desde Cartera.
                                </p>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Botón de cobro fijo bajo el resumen (solo PC). CASO-056 fase 1. */}
            {footer && <div className="hidden lg:block shrink-0">{footer}</div>}
        </div>
    );
};

export default memo(PaymentLeftColumn);
