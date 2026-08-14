import React, { memo } from 'react';
import { AlertTriangle, HandCoins, CheckCircle, Wallet, Zap } from 'lucide-react';
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
    isTipDonated,
    toggleTipDonated,
    tipAmountUsd,
    handleTipAmountChange,
    cashKeptUsd,
    changeToDeliverUsd,
    changeDestinationSelected,
    walletRemainderUsd,
    remainingChangeUsd,
    remainingChangeBs,
    maxVueltoUSD,
    maxVueltoBS,
    maxTipUsd,
    showMobileChangeDetails,
    setShowMobileChangeDetails,
    tipConfirmPending,
    tipCurrency,
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
    className = '',
}) => {
    const isPending = modo === 'contado' && faltaPorPagar > 0.01;
    const isPaid = modo === 'contado' && faltaPorPagar <= 0.01;
    const isCredit = modo === 'credito';
    const isCreditOverpayment = isCredit && cambioUSD > 0.01;

    return (
        <div className={`${className} w-full lg:w-[41%] bg-slate-50 dark:bg-slate-900 border-b lg:border-b-0 lg:border-r border-slate-100 dark:border-slate-800 flex flex-col overflow-hidden`}>

            {/* Resumen del total */}
            <TransactionSummary
                totalUSD={totalUSD}
                totalBS={totalBS}
                discountData={discountData}
                tasaSegura={tasaSegura}
            />

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
                                className="min-h-[36px] min-w-[36px] inline-flex items-center justify-center p-1 shrink-0 cursor-pointer select-none focus:outline-none active:scale-95 transition-transform"
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
                    <div className="flex justify-between items-center px-1 text-[10px]">
                        <span className="text-slate-500 font-bold uppercase tracking-wide">Monto Pagado:</span>
                        <span className="text-emerald-600 dark:text-emerald-400 font-extrabold">${totalPagadoGlobalUSD.toFixed(2)}</span>
                    </div>

                    {/* Falta por pagar */}
                    {isPending && (
                        <div className="flex flex-col justify-center items-center text-center p-3 sm:p-3.5 rounded-xl border-2 border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-sm transition-all">
                            <p className="text-[9px] font-extrabold uppercase tracking-widest text-slate-500 dark:text-slate-400">Falta por Pagar</p>
                            <div className="flex items-baseline justify-center gap-2 my-0.5">
                                <span className="text-2xl sm:text-3xl font-black text-slate-800 dark:text-white">${faltaPorPagar.toFixed(2)}</span>
                                <span className="text-xs sm:text-sm font-black text-[#01696f] dark:text-[#1ce2ee]">
                                    Bs {faltaPorPagarBS.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Vuelto */}
                    {isPaid && cambioUSD > 0.009 && (
                        <div className={`flex flex-col justify-center items-center text-center p-2.5 sm:p-3 rounded-xl border-2 bg-emerald-50 dark:bg-emerald-950/20 shadow-sm transition-all ${isTipDonated ? 'border-emerald-500 ring-2 ring-emerald-400/50' : 'border-emerald-200 dark:border-emerald-800/40'}`}>
                            <p className="text-[9px] font-extrabold uppercase tracking-widest text-emerald-700 dark:text-emerald-400">{isTipDonated ? 'Vuelto distribuido' : 'Vuelto'}</p>
                            <div className="flex items-baseline justify-center gap-2 my-0.5">
                                <span className="text-2xl sm:text-3xl font-black text-emerald-700 dark:text-emerald-400">${cambioUSD.toFixed(2)}</span>
                                <span className="text-xs sm:text-sm font-black text-emerald-600 dark:text-emerald-300">
                                    Bs {round2(cambioUSD * tasaSegura).toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                                </span>
                            </div>

                            {/* El operador debe elegir qué hacer con el vuelto: dejarlo en caja,
                                acreditarlo a la billetera o entregarlo físicamente. */}
                            <div className="w-full mt-2 grid grid-cols-2 gap-1.5">
                                <button
                                    type="button"
                                    onClick={toggleTipDonated}
                                    title={isTipDonated ? 'Vuelto asignado a caja como ingreso/propina (pulsa para cancelar)' : 'Dejar el vuelto en caja como ingreso o propina para el negocio'}
                                    className={`py-1.5 px-2 min-h-[34px] rounded-lg font-black text-[10px] flex items-center justify-center gap-1 transition-all active:scale-[0.97] ${
                                        isTipDonated
                                            ? 'bg-emerald-600 text-white shadow-md shadow-emerald-500/30'
                                            : tipConfirmPending
                                                ? 'bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 border-2 border-amber-400 animate-pulse'
                                                : 'bg-white dark:bg-slate-800 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 hover:bg-emerald-100 dark:hover:bg-slate-700'
                                    }`}
                                >
                                    <HandCoins size={14} className="shrink-0" />
                                    <span className="truncate">
                                        {isTipDonated
                                            ? `En caja: $${cashKeptUsd.toFixed(2)}`
                                            : tipConfirmPending
                                                ? `Confirmar $${cambioUSD.toFixed(2)}`
                                                : 'Dejar en caja'}
                                    </span>
                                    {isTipDonated && <CheckCircle size={13} className="text-white shrink-0" />}
                                </button>

                                <button
                                    type="button"
                                    disabled={!clienteSeleccionado || (!isChangeCredited && walletRemainderUsd <= 0.01)}
                                    onClick={() => {
                                        if (isChangeCredited) {
                                            setIsChangeCredited(false);
                                        } else {
                                            handleCreditChange();
                                        }
                                    }}
                                    className={`py-1.5 px-2 min-h-[34px] rounded-lg font-black text-[10px] flex items-center justify-center gap-1 transition-all active:scale-[0.97] ${
                                        isChangeCredited
                                            ? 'bg-brand text-white shadow-md shadow-brand/30'
                                            : 'bg-white dark:bg-slate-800 text-brand-dark dark:text-brand border border-brand/30 dark:border-brand/70 hover:bg-brand-light dark:hover:bg-slate-700'
                                    } ${(!clienteSeleccionado || walletRemainderUsd <= 0.01) ? 'opacity-40 cursor-not-allowed' : ''}`}
                                    title={!clienteSeleccionado ? 'Selecciona un cliente para acreditar el vuelto' : 'Acreditar el resto del vuelto como saldo a favor'}
                                >
                                    <Wallet size={14} className="shrink-0" />
                                    <span className="whitespace-nowrap">
                                        {isChangeCredited ? `Billetera $${walletRemainderUsd.toFixed(2)}` : `Acreditar $${walletRemainderUsd.toFixed(2)}`}
                                    </span>
                                    {isChangeCredited && <CheckCircle size={13} className="text-white shrink-0" />}
                                </button>
                            </div>

                            {isChangeCredited && (
                                <div className="w-full mt-1.5 px-2 py-1 rounded-lg bg-brand/10 border border-brand/20 text-center text-[9px] font-bold text-brand-dark dark:text-brand">
                                    Acreditará a billetera: <strong>${walletRemainderUsd.toFixed(2)}</strong>.
                                </div>
                            )}

                            {/* En móvil los campos avanzados se revelan solo cuando
                                el cajero decide personalizar la distribución. */}
                            <button
                                type="button"
                                className="lg:hidden w-full mt-2 min-h-[38px] rounded-xl border border-emerald-300 dark:border-emerald-700 bg-white/80 dark:bg-slate-900/70 text-emerald-700 dark:text-emerald-300 text-[10px] font-black"
                                onClick={() => setShowMobileChangeDetails(current => !current)}
                                aria-expanded={showMobileChangeDetails}
                            >
                                {showMobileChangeDetails ? 'Ocultar distribución avanzada' : 'Personalizar distribución del vuelto'}
                            </button>

                            {/* Monto parcial que el cliente deja en caja. Solo se
                                muestra después de activar "Dejar en caja". */}
                            {isTipDonated && (
                                <div className={`w-full mt-2 pt-2 border-t border-emerald-200/60 dark:border-emerald-800/30 ${showMobileChangeDetails ? 'block' : 'hidden'} lg:block`}>
                                    <div className="flex items-center justify-between gap-1 mb-1">
                                        <label className="text-[10px] font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-400">
                                            Parte del vuelto que queda en caja
                                        </label>
                                        <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-emerald-100/70 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/60 whitespace-nowrap">
                                            Máx: ${(maxTipUsd !== undefined ? maxTipUsd : cambioUSD).toFixed(2)}
                                        </span>
                                    </div>
                                    <div className="relative group">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-emerald-600 dark:text-emerald-400 pointer-events-none select-none">
                                            $
                                        </span>
                                        <input
                                            type="number"
                                            min="0"
                                            max={maxTipUsd !== undefined ? maxTipUsd : cambioUSD}
                                            step="0.01"
                                            value={tipAmountUsd}
                                            onChange={e => handleTipAmountChange(e.target.value)}
                                            onFocus={e => e.target.select()}
                                            placeholder="0.00"
                                            className="w-full h-11 py-2 pl-7 pr-16 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 font-black text-sm text-slate-800 dark:text-white shadow-inner outline-none transition-all focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleTipAmountChange((maxTipUsd !== undefined ? maxTipUsd : cambioUSD).toString())}
                                            className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 px-2.5 inline-flex items-center justify-center gap-1 rounded-lg text-[10px] font-black bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-sm shadow-emerald-600/20 active:scale-95 transition-all"
                                            title="Asignar todo el vuelto a caja"
                                        >
                                            <Zap size={11} className="fill-current" />
                                            <span>Todo</span>
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Distribución de vuelto físico. Si no se acredita el resto,
                                cualquier monto no especificado se entrega en USD para no perderlo. */}

                            <div className={`w-full mt-2 pt-2 border-t border-emerald-200/60 dark:border-emerald-800/30 grid grid-cols-2 gap-2.5 ${showMobileChangeDetails ? 'grid' : 'hidden'} lg:grid`}>
                                <div className="min-w-0">
                                    <div className="flex items-center justify-between gap-1 mb-1.5 min-h-[22px]">
                                        <label className="text-[10px] font-black uppercase tracking-wider text-emerald-800 dark:text-emerald-400 whitespace-nowrap shrink-0">
                                            Cambio en $
                                        </label>
                                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-emerald-100/70 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-300 border border-emerald-200/80 dark:border-emerald-800/60 whitespace-nowrap shrink-0">
                                            Queda ${remainingChangeUsd.toFixed(2)}
                                        </span>
                                    </div>
                                    <div className="relative group">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-xs font-black text-emerald-600 dark:text-emerald-400 pointer-events-none select-none">
                                            $
                                        </span>
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
                                            className="w-full h-11 py-2 pl-7 pr-16 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 font-black text-sm text-slate-800 dark:text-white shadow-inner outline-none transition-all focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleVueltoDistChange('usd', maxVueltoUSD.toString())}
                                            className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 px-2.5 inline-flex items-center justify-center gap-1 rounded-lg text-[10px] font-black bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white shadow-sm shadow-emerald-600/20 active:scale-95 transition-all"
                                            title="Asignar todo el vuelto restante en USD"
                                        >
                                            <Zap size={11} className="fill-current" />
                                            <span>Todo</span>
                                        </button>
                                    </div>
                                </div>
                                <div className="min-w-0">
                                    <div className="flex items-center justify-between gap-1 mb-1.5 min-h-[22px]">
                                        <label className="text-[10px] font-black uppercase tracking-wider text-blue-800 dark:text-blue-400 whitespace-nowrap shrink-0">
                                            Cambio en Bs
                                        </label>
                                        <span className="text-[9px] font-black px-1.5 py-0.5 rounded-md bg-blue-100/70 dark:bg-blue-950/50 text-blue-800 dark:text-blue-300 border border-blue-200/80 dark:border-blue-800/60 whitespace-nowrap shrink-0">
                                            Queda Bs {remainingChangeBs.toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                        </span>
                                    </div>
                                    <div className="relative group">
                                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[11px] font-black text-blue-600 dark:text-blue-400 pointer-events-none select-none">
                                            Bs
                                        </span>
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
                                            className="w-full h-11 py-2 pl-8 pr-16 rounded-xl border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-900 font-black text-sm text-slate-800 dark:text-white shadow-inner outline-none transition-all focus:border-blue-500 focus:ring-2 focus:ring-blue-500/20"
                                        />
                                        <button
                                            type="button"
                                            onClick={() => handleVueltoDistChange('bs', maxVueltoBS.toString())}
                                            className="absolute right-1.5 top-1/2 -translate-y-1/2 h-8 px-2.5 inline-flex items-center justify-center gap-1 rounded-lg text-[10px] font-black bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white shadow-sm shadow-blue-600/20 active:scale-95 transition-all"
                                            title="Asignar todo el vuelto restante en Bolívares"
                                        >
                                            <Zap size={11} className="fill-current" />
                                            <span>Todo</span>
                                        </button>
                                    </div>
                                </div>
                            </div>
                            <div
                                role="status"
                                aria-live="polite"
                                className={`w-full mt-2 px-3 py-2.5 rounded-xl border ${
                                    remainingChangeUsd > 0.001
                                        ? 'bg-red-50 dark:bg-red-950/25 border-red-300 dark:border-red-800/60'
                                        : 'bg-emerald-50/70 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40'
                                }`}
                            >
                                <div className="flex items-start gap-2.5">
                                    <span className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${
                                        remainingChangeUsd > 0.001
                                            ? 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                                            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                    }`}>
                                        {remainingChangeUsd > 0.001
                                            ? <AlertTriangle size={14} strokeWidth={2.5} />
                                            : <CheckCircle size={14} strokeWidth={2.5} />}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <p className={`text-[10px] font-black uppercase tracking-wide leading-tight ${
                                            remainingChangeUsd > 0.001 ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'
                                        }`}>
                                            {isChangeCredited ? 'Se acreditará a billetera' : remainingChangeUsd > 0.001 ? 'Vuelto pendiente' : 'Vuelto asignado'}
                                        </p>
                                        <div className={`mt-1 grid grid-cols-2 divide-x ${remainingChangeUsd > 0.001 ? 'divide-red-200 dark:divide-red-800/60' : 'divide-emerald-200 dark:divide-emerald-800/40'}`}>
                                            <div className="min-w-0 pr-3">
                                                <span className={`block text-[9px] font-black uppercase tracking-wide ${remainingChangeUsd > 0.001 ? 'text-red-500 dark:text-red-300' : 'text-emerald-500 dark:text-emerald-300'}`}>Dólares</span>
                                                <strong className={`block mt-0.5 text-xl leading-none font-black tracking-tight ${
                                                    remainingChangeUsd > 0.001 ? 'text-red-700 dark:text-red-300' : 'text-emerald-700 dark:text-emerald-300'
                                                }`}>
                                                    ${remainingChangeUsd.toFixed(2)}
                                                </strong>
                                            </div>
                                            <div className="min-w-0 pl-3">
                                                <span className={`block text-[9px] font-black uppercase tracking-wide ${remainingChangeUsd > 0.001 ? 'text-red-500 dark:text-red-300' : 'text-emerald-500 dark:text-emerald-300'}`}>Bolívares</span>
                                                <strong className={`block mt-0.5 text-sm leading-tight font-black break-words ${
                                                    remainingChangeUsd > 0.001 ? 'text-red-600 dark:text-red-300' : 'text-emerald-600 dark:text-emerald-300'
                                                }`}>
                                                    Bs {remainingChangeBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}
                                                </strong>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </div>
                            {!showMobileChangeDetails && !changeDestinationSelected && changeToDeliverUsd > 0.001 && (
                                <>
                                    <p className="lg:hidden w-full mt-2 text-center text-[10px] font-black text-amber-700 dark:text-amber-300">
                                        Selecciona cómo entregar el vuelto:
                                    </p>
                                    <div className="lg:hidden grid grid-cols-2 gap-2 mt-1">
                                        <button
                                            type="button"
                                            onClick={() => handleVueltoDistChange('usd', maxVueltoUSD.toString())}
                                            className="w-full min-w-0 min-h-[40px] rounded-lg border border-emerald-300 bg-white dark:bg-slate-800 px-1 text-[10px] leading-tight font-black text-emerald-700 dark:text-emerald-300 hover:bg-emerald-50"
                                        >
                                            Todo en $
                                        </button>
                                        <button
                                            type="button"
                                            onClick={() => handleVueltoDistChange('bs', maxVueltoBS.toString())}
                                            className="w-full min-w-0 min-h-[40px] rounded-lg border border-blue-300 bg-white dark:bg-slate-800 px-1 text-[10px] leading-tight font-black text-blue-700 dark:text-blue-300 hover:bg-blue-50"
                                        >
                                            Todo en Bs
                                        </button>
                                    </div>
                                </>
                            )}
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
                        <div className={`flex flex-col justify-center items-center text-center p-5 rounded-xl border-2 shadow-sm transition-all ${isCreditOverpayment
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
        </div>
    );
};

export default memo(PaymentLeftColumn);
