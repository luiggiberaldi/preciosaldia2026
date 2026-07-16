import React, { memo } from 'react';
import { Banknote, CreditCard } from 'lucide-react';
import { round2 } from '../../../../utils/dinero';
import TransactionSummary from './TransactionSummary';
import CheckoutCustomerPicker from '../../CheckoutCustomerPicker';
import CasheaIcon from '../../../CasheaIcon';

/**
 * PaymentLeftColumn — Columna izquierda del modo POS.
 * Contiene: resumen de totales, selector de cliente, estado de pago (falta/vuelto/crédito), Cashea.
 */
const PaymentLeftColumn = ({
    totalUSD,
    totalBS,
    discountData,
    tasaSegura,
    clienteSeleccionado,
    setClienteSeleccionado,
    customers,
    onCreateCustomer,
    modo,
    proyeccion,
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
    deudaCliente,
    isVueltoValido,
    casheaActive,
    setCasheaActive,
    casheaPercent,
    setCasheaPercent,
    casheaAmountUsd,
    casheaEnabled,
    casheaMeetsMinimum,
    effectiveRate,
}) => {
    const isPending = modo === 'contado' && faltaPorPagar > 0.01;
    const isPaid = modo === 'contado' && faltaPorPagar <= 0.01;
    const isCredit = modo === 'credito';

    return (
        <div className="lg:w-[38%] bg-slate-50 dark:bg-slate-900 border-r border-slate-100 dark:border-slate-800 flex flex-col overflow-hidden">

            {/* Resumen del total */}
            <TransactionSummary
                totalUSD={totalUSD}
                totalBS={totalBS}
                discountData={discountData}
                tasaSegura={tasaSegura}
            />

            {/* Contenido scrollable */}
            <div className="flex-1 overflow-y-auto px-4 pb-4 pt-2 space-y-3">

                {/* Selector de cliente */}
                <CheckoutCustomerPicker
                    customers={customers}
                    selectedCustomerId={clienteSeleccionado}
                    setSelectedCustomerId={setClienteSeleccionado}
                    effectiveRate={effectiveRate}
                    onCreateCustomer={onCreateCustomer}
                />

                {/* Panel Cashea */}
                {casheaEnabled && casheaMeetsMinimum && clienteSeleccionado && (
                    <div className="p-3 bg-purple-50 dark:bg-purple-950/20 border border-purple-200 dark:border-purple-900/40 rounded-xl space-y-2 animate-in fade-in duration-300">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <CasheaIcon size={18} />
                                <span className="font-bold text-sm text-purple-900 dark:text-purple-300 uppercase tracking-wide">Cashea</span>
                            </div>
                            <button
                                onClick={() => setCasheaActive(!casheaActive)}
                                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                                    casheaActive ? 'bg-purple-600' : 'bg-slate-200 dark:bg-slate-700'
                                }`}
                            >
                                <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${casheaActive ? 'translate-x-4' : 'translate-x-0'}`} />
                            </button>
                        </div>
                        {casheaActive && (
                            <div className="space-y-2 animate-in slide-in-from-top-1 duration-200">
                                <div className="grid grid-cols-3 gap-1">
                                    {[60, 50, 40, 30, 20, 10].map(pct => (
                                        <button
                                            key={pct}
                                            onClick={() => setCasheaPercent(pct)}
                                            className={`py-1 text-xs font-black rounded-lg transition-all ${
                                                casheaPercent === pct
                                                    ? 'bg-purple-600 text-white shadow-md'
                                                    : 'bg-white dark:bg-slate-800 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-900/40 hover:bg-purple-100'
                                            }`}
                                        >{pct}%</button>
                                    ))}
                                </div>
                                <div className="p-2.5 bg-white dark:bg-slate-900 border border-purple-100 dark:border-purple-900/20 rounded-lg space-y-1 text-[11px]">
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
                <div className="space-y-1.5">
                    <div className="flex justify-between items-center px-1 text-[11px]">
                        <span className="text-slate-500 font-bold uppercase tracking-wide">Monto Pagado:</span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-extrabold">${totalPagadoGlobalUSD.toFixed(2)}</span>
                    </div>

                    {/* Falta por pagar */}
                    {isPending && (
                        <div className="flex flex-col justify-center items-center text-center p-5 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm transition-all">
                            <p className="text-[10px] font-extrabold uppercase tracking-widest text-slate-500 dark:text-slate-400">Falta por Pagar</p>
                            <p className="text-4xl lg:text-5xl font-black text-slate-800 dark:text-white my-2">${faltaPorPagar.toFixed(2)}</p>
                            <div className="text-lg font-black text-[#01696f] dark:text-[#1ce2ee]">
                                Bs {faltaPorPagarBS.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                            </div>
                        </div>
                    )}

                    {/* Vuelto */}
                    {isPaid && cambioUSD > 0.009 && (
                        <div className="flex flex-col justify-center items-center text-center p-5 rounded-xl border-2 border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-950/20 shadow-sm transition-all">
                            <p className="text-[10px] font-extrabold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">Vuelto</p>
                            <p className="text-4xl lg:text-5xl font-black text-emerald-700 dark:text-emerald-400 my-2">${cambioUSD.toFixed(2)}</p>
                            <div className="text-lg font-black text-emerald-600 dark:text-emerald-300">
                                Bs {round2(cambioUSD * tasaSegura).toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                            </div>
                            {/* Distribución de vuelto */}
                            <div className="w-full mt-3 pt-3 border-t border-emerald-200/60 dark:border-emerald-800/30 flex gap-2">
                                <div className="flex-1">
                                    <label className="text-[9px] font-black text-emerald-700 dark:text-emerald-500 uppercase block mb-1">En $ USD</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            value={distVueltoUSD}
                                            onChange={e => handleVueltoDistChange('usd', e.target.value)}
                                            onFocus={e => {
                                                e.target.select();
                                                if (e.target.value === '0' || parseFloat(e.target.value) === 0) {
                                                    handleVueltoDistChange('usd', '');
                                                }
                                            }}
                                            placeholder="0.00"
                                            className="w-full py-2 pl-2 pr-12 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 font-bold text-xs text-slate-800 dark:text-white outline-none focus:ring-1 focus:ring-emerald-500"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleVueltoDistChange('usd', cambioUSD.toString())}
                                            className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] font-black bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-1.5 py-1 rounded hover:bg-emerald-200 active:scale-95 transition-all"
                                        >
                                            Todo
                                        </button>
                                    </div>
                                </div>
                                <div className="flex-1">
                                    <label className="text-[9px] font-black text-emerald-700 dark:text-emerald-500 uppercase block mb-1">En Bs</label>
                                    <div className="relative">
                                        <input
                                            type="number"
                                            value={distVueltoBS}
                                            onChange={e => handleVueltoDistChange('bs', e.target.value)}
                                            onFocus={e => {
                                                e.target.select();
                                                if (e.target.value === '0' || parseFloat(e.target.value) === 0) {
                                                    handleVueltoDistChange('bs', '');
                                                }
                                            }}
                                            placeholder="0"
                                            className="w-full py-2 pl-2 pr-12 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 font-bold text-xs text-slate-800 dark:text-white outline-none focus:ring-1 focus:ring-emerald-500"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleVueltoDistChange('bs', Math.round(cambioUSD * tasaSegura).toString())}
                                            className="absolute right-1 top-1/2 -translate-y-1/2 text-[9px] font-black bg-emerald-100 dark:bg-emerald-900/40 text-emerald-700 dark:text-emerald-300 px-1.5 py-1 rounded hover:bg-emerald-200 active:scale-95 transition-all"
                                        >
                                            Todo
                                        </button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Pagado exacto */}
                    {isPaid && cambioUSD <= 0.009 && (
                        <div className="flex flex-col justify-center items-center text-center p-5 rounded-xl border-2 border-emerald-300 dark:border-emerald-700/40 bg-emerald-50 dark:bg-emerald-950/20 shadow-sm transition-all">
                            <p className="text-2xl font-black text-emerald-600 dark:text-emerald-400">✓ Pago Completo</p>
                            <p className="text-xs text-emerald-600/70 mt-1">Sin vuelto</p>
                        </div>
                    )}

                    {/* Queda Debiendo (Crédito) */}
                    {isCredit && (
                        <div className="flex flex-col justify-center items-center text-center p-5 rounded-xl border-2 border-amber-200 dark:border-amber-800/30 bg-amber-50 dark:bg-amber-950/10 shadow-sm transition-all">
                            <p className="text-[10px] font-extrabold uppercase tracking-widest text-amber-700 dark:text-amber-500">Queda Debiendo</p>
                            <p className="text-4xl lg:text-5xl font-black text-amber-700 dark:text-amber-400 my-2">${deudaCliente.toFixed(2)}</p>
                            <div className="text-lg font-black text-amber-600 dark:text-amber-300">
                                Bs {round2(deudaCliente * tasaSegura).toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default memo(PaymentLeftColumn);
