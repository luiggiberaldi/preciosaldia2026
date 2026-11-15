import React, { useCallback, useEffect } from 'react';
import { useProductContext } from '../../../context/ProductContext';
import { round2 } from '../../../utils/dinero';
import { FINANCIAL_EPSILON } from '../../../utils/securityConstants';

// Cálculo y estado del cobro, repartido en piezas (COBRO fase 2)
import NumericKeypad from './components/NumericKeypad';
import { applyKey } from './parts/keypadInput';
import { useCoarsePointer } from '../../../hooks/useCoarsePointer';
import { useCheckoutPosMethods } from './parts/useCheckoutPosMethods';
import { useCheckoutPosAmounts } from './parts/useCheckoutPosAmounts';
import { useCheckoutPosChange } from './parts/useCheckoutPosChange';
import { useCheckoutPosPay } from './parts/useCheckoutPosPay';

// Subcomponentes
import PaymentHeader from './components/PaymentHeader';
import CheckoutCustomerPicker from '../CheckoutCustomerPicker';
import PaymentLeftColumn from './components/PaymentLeftColumn';
import PaymentInputs from './components/PaymentInputs';
import PaymentFooter from './components/PaymentFooter';
import ChangeConfirmationModal from './components/ChangeConfirmationModal';
import { evaluarFondoParaVuelto } from '../../../utils/fondoGaveta';
import WalletSection from './components/WalletSection';
import RepriceNotice from '../RepriceNotice';
import { isTicketRepriced } from '../../../utils/reprice.js';

/**
 * CheckoutModalPOS — Modo de cobro profesional (estilo Listo POS, dos columnas).
 */
export default function CheckoutModalPOS({
    onClose,
    cart = [],
    cartSubtotalUsd,
    cartTotalUsd,
    cartTotalBs,
    cartBaseUsd = 0,
    cartIvaUsd = 0,
    discountData,
    effectiveRate,
    customers,
    selectedCustomerId,
    setSelectedCustomerId,
    paymentMethods,
    onConfirmSale,
    onCreateCustomer,
    triggerHaptic,
    copEnabled = false,
    copPrimary = false,
    tasaCop = 0,
    onUseSaldoFavor,
    // CAJA-FONDO-002: null = fondo desconocido (venta remota): no se avisa.
    currentFloatUsd = null,
    currentFloatBs = null,
    onOpenAporte = null,
    onSwitchMode,
    isProcessing = false,
    // Ventas remotas del supervisor: solo contado (sin pestaña Crédito).
    allowCredit = true,
}) {
    const { setCheckoutMode } = useProductContext();

    const {
        setClienteSeleccionado, clienteSeleccionado, metodosBsNorm, activeInputId, val, pagos,
        metodosNormalizados, pagoSaldoFavor, metodosDivisaNorm, metodosCopNorm, modo, setModo, setPagos,
        setReferencias, inputRefs, referencias, setPagoSaldoFavor, setActiveInputId, activeInputType,
        setActiveInputType,
    } = useCheckoutPosMethods({ paymentMethods, copEnabled });

    // Sync external selectedCustomerId con el estado interno
    useEffect(() => {
        if (selectedCustomerId !== undefined) {
            setClienteSeleccionado(selectedCustomerId || '');
        }
    }, [selectedCustomerId]);

    // Propagar cambio de cliente al exterior
    const handleSetCliente = useCallback((id) => {
        if (id !== clienteSeleccionado) {
            setIsChangeCredited(false);
            setIsTipDonated(false);
            setTipConfirmPending(false);
            setTipAmountUsd('');
            setDistVueltoUSD('');
            setDistVueltoBS('');
            setShowMobileChangeDetails(false);
        }
        setClienteSeleccionado(id);
        setSelectedCustomerId(id);
    }, [clienteSeleccionado, setSelectedCustomerId]);

    const {
        setIsChangeCredited, setIsTipDonated, setTipConfirmPending, setTipAmountUsd,
        setDistVueltoUSD, setDistVueltoBS, setShowMobileChangeDetails, distVueltoUSD,
        distVueltoBS, maxVueltoBS, maxVueltoUSD, isChangeCredited, walletRemainderUsd,
        tasaSegura, cambioUSD, changeToDeliverUsd, isTipDonated, tipConfirmPending,
        mobilePaymentCurrency, setMobilePaymentCurrency, cashKeptUsd, totalPagadoGlobalUSD,
        totalPagadoBS, casheaAmountUsd, faltaPorPagar, rateError, casheaActive, casheaPercent,
        setChangeConfirmation, dynamicCartTotals, faltaPorPagarBS, tipAmountUsd,
        changeDestinationSelected, changeRemainder, showMobileChangeDetails, casheaEnabled,
        casheaMeetsMinimum, setCasheaActive, setCasheaPercent, repricedActive, totalPagadoUSD,
        changeAllocationComplete, changeConfirmation, plannedPhysicalUsd, plannedWalletUsd,
        unallocatedChangeUsd,
    } = useCheckoutPosAmounts({
        cart, metodosBsNorm, activeInputId, val, cartTotalUsd, cartTotalBs, cartBaseUsd,
        cartIvaUsd, discountData, effectiveRate, tasaCop, pagos, metodosNormalizados,
        pagoSaldoFavor, copEnabled,
    });

    const {
        tipCurrency, proyeccion, handleVueltoDistChange, handleCreditChange, toggleTipDonated,
        handleTipAmountChange, maxTipUsd, elegirVuelto, completarVuelto,
        autoCampo, restoLoDeja, restoABilletera, sugerido,
    } = useCheckoutPosChange({
        distVueltoUSD, distVueltoBS, maxVueltoBS, setDistVueltoBS, maxVueltoUSD,
        setDistVueltoUSD, isChangeCredited, walletRemainderUsd, setIsChangeCredited, tasaSegura,
        cambioUSD, setTipAmountUsd, setIsTipDonated, changeToDeliverUsd, clienteSeleccionado,
        metodosNormalizados, val, isTipDonated, setTipConfirmPending, tipConfirmPending,
        triggerHaptic, setShowMobileChangeDetails, metodosDivisaNorm, metodosBsNorm,
        metodosCopNorm, mobilePaymentCurrency, setMobilePaymentCurrency, customers, modo,
        cashKeptUsd, currentFloatUsd,
    });

    const {
        selectedCustomer, handleInputChange, llenarSaldo, handleRefChange, handleInputKeyDown,
        sumarBillete, procesarPago, cobrarConTeclado,
    } = useCheckoutPosPay({
        customers, clienteSeleccionado, pagos, cart, discountData, effectiveRate, tasaCop,
        totalPagadoGlobalUSD, totalPagadoBS, casheaAmountUsd, tasaSegura, pagoSaldoFavor,
        faltaPorPagar, setPagos, setReferencias, inputRefs, rateError, modo, cambioUSD,
        casheaActive, metodosNormalizados, val, referencias, casheaPercent, distVueltoUSD,
        distVueltoBS, isTipDonated, cashKeptUsd, isChangeCredited, changeToDeliverUsd,
        tipCurrency, setChangeConfirmation, onConfirmSale, triggerHaptic,
        changeAllocationComplete, isProcessing, changeConfirmation,
    });

    // COBRO fase 7: en pantallas táctiles, teclado numérico propio (sin teclado de Windows).
    const isTouch = useCoarsePointer();
    const metodosMonto = [...metodosDivisaNorm, ...metodosBsNorm, ...(copEnabled ? metodosCopNorm : [])];
    const CAMPOS_VUELTO = { __vuelto_usd: { id: '__vuelto_usd', nombre: 'Vuelto en dólares', moneda: 'usd' }, __vuelto_bs: { id: '__vuelto_bs', nombre: 'Vuelto en bolívares', moneda: 'bs' } };
    const metodoActivo = CAMPOS_VUELTO[activeInputId] || metodosMonto.find(m => m.id === activeInputId) || null;
    useEffect(() => {
        if (isTouch && !activeInputId && metodosMonto[0]) {
            setActiveInputId(metodosMonto[0].id);
            setActiveInputType('amount');
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isTouch]);
    const handleKeypad = useCallback((key) => {
        if (!metodoActivo) return;
        if (activeInputType === 'ref' && !metodoActivo.moneda) {
            // Referencia: solo dígitos, máximo 4; la coma no aplica.
            const actual = String(referencias[metodoActivo.id] || '');
            let next = actual;
            if (key === 'clear') next = '';
            else if (key === 'back') next = actual.slice(0, -1);
            else if (/^\d$/.test(key) && actual.length < 4) next = actual + key;
            handleRefChange(metodoActivo.id, next);
        } else if (metodoActivo.moneda) {
            const actual = metodoActivo.moneda === 'usd' ? distVueltoUSD : distVueltoBS;
            handleVueltoDistChange(metodoActivo.moneda, applyKey(actual, key));
        } else {
            handleInputChange(metodoActivo.id, applyKey(pagos[metodoActivo.id], key));
        }
        triggerHaptic && triggerHaptic();
    }, [metodoActivo, pagos, handleInputChange, handleVueltoDistChange, distVueltoUSD, distVueltoBS, triggerHaptic, activeInputType, referencias, handleRefChange]);

    // COBRO fase 6: F9 cobra dentro del cobro (antes solo lo abría desde Vender).
    useEffect(() => {
        const onKey = (e) => {
            if (e.key !== 'F9') return;
            e.preventDefault();
            cobrarConTeclado();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    });

    const deudaCliente = modo === 'credito' ? faltaPorPagar : 0;
    // TIP: si el cliente dona el vuelto, no hay nada que repartir → siempre válido.
    const isVueltoValido = changeToDeliverUsd < 0.001 || (
        parseFloat(distVueltoUSD || 0) + parseFloat(distVueltoBS || 0) / tasaSegura <= changeToDeliverUsd + 0.001
    );

    // Switch rápido al modo básico
    const handleSwitchToBasic = () => {
        setCheckoutMode('basic');
        if (onSwitchMode) onSwitchMode('basic');
    };

    // 🛡️ EFECTO: Si se activa Cashea, forzar el modo de pago a Contado (no se puede vender a crédito de la casa y con Cashea a la vez)
    useEffect(() => {
        if (casheaActive && modo === 'credito') {
            setModo('contado');
        }
    }, [casheaActive, modo, setModo]);

    return (
        <div className="fixed inset-0 bg-black/40 dark:bg-black/60 flex items-center justify-center z-50 p-0 sm:p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Modal de pago profesional"
                className="bg-white dark:bg-slate-950 w-full max-w-6xl h-[100dvh] sm:h-auto lg:min-h-[34rem] rounded-none sm:rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[100dvh] sm:max-h-[95vh] animate-in zoom-in-95 duration-200"
            >
                <PaymentHeader
                    modo={modo}
                    setModo={setModo}
                    onClose={onClose}
                    onSwitchToBasic={handleSwitchToBasic}
                    tasa={effectiveRate}
                    casheaActive={casheaActive}
                    allowCredit={allowCredit}
                />
                <div className="flex flex-col lg:flex-row flex-1 min-h-0 overflow-y-auto lg:overflow-hidden">
                    <PaymentLeftColumn
                        className="order-2 lg:order-1"
                        currentFloatUsd={currentFloatUsd}
                        currentFloatBs={currentFloatBs}
                        totalUSD={dynamicCartTotals.totalUsd}
                        totalBS={dynamicCartTotals.totalBs}
                        baseUsd={dynamicCartTotals.baseUsd}
                        ivaUsd={dynamicCartTotals.ivaUsd}
                        discountData={discountData}
                        tasaSegura={tasaSegura}
                        clienteSeleccionado={clienteSeleccionado}
                        setClienteSeleccionado={handleSetCliente}
                        customers={customers}
                        onCreateCustomer={onCreateCustomer}
                        modo={modo}
                        proyeccion={proyeccion}
                        totalPagadoGlobalUSD={totalPagadoGlobalUSD}
                        faltaPorPagar={faltaPorPagar}
                        faltaPorPagarBS={faltaPorPagarBS}
                        cambioUSD={cambioUSD}
                        distVueltoUSD={distVueltoUSD}
                        distVueltoBS={distVueltoBS}
                        handleVueltoDistChange={handleVueltoDistChange}
                        isChangeCredited={isChangeCredited}
                        handleCreditChange={handleCreditChange}
                        setIsChangeCredited={setIsChangeCredited}
                        isTipDonated={isTipDonated}
                        toggleTipDonated={toggleTipDonated}
                        tipAmountUsd={tipAmountUsd}
                        handleTipAmountChange={handleTipAmountChange}
                        cashKeptUsd={cashKeptUsd}
                        changeToDeliverUsd={changeToDeliverUsd}
                        changeDestinationSelected={changeDestinationSelected}
                        walletRemainderUsd={walletRemainderUsd}
                        remainingChangeUsd={changeRemainder.remainingUsd}
                        remainingChangeBs={changeRemainder.remainingBs}
                        maxVueltoUSD={maxVueltoUSD}
                        maxVueltoBS={maxVueltoBS}
                        maxTipUsd={maxTipUsd}
                        showMobileChangeDetails={showMobileChangeDetails}
                        setShowMobileChangeDetails={setShowMobileChangeDetails}
                        tipConfirmPending={tipConfirmPending}
                        tipCurrency={tipCurrency}
                        deudaCliente={deudaCliente}
                        isVueltoValido={isVueltoValido}
                        casheaEnabled={casheaEnabled}
                        casheaMeetsMinimum={casheaMeetsMinimum}
                        casheaActive={casheaActive}
                        setCasheaActive={setCasheaActive}
                        casheaPercent={casheaPercent}
                        setCasheaPercent={setCasheaPercent}
                        casheaAmountUsd={casheaAmountUsd}
                        effectiveRate={effectiveRate}
                        elegirVuelto={elegirVuelto}
                        completarVuelto={completarVuelto}
                        autoCampo={autoCampo}
                        restoLoDeja={restoLoDeja}
                        restoABilletera={restoABilletera}
                        sugerido={sugerido}
                        isTouch={isTouch}
                        onFocusChangeField={(id) => { setActiveInputId(id); setActiveInputType('amount'); }}
                        activeChangeField={activeInputId}
                        footer={
                            <PaymentFooter placement="side" modo={modo} faltaPorPagar={faltaPorPagar} clienteSeleccionado={clienteSeleccionado} totalPagadoGlobalUSD={totalPagadoGlobalUSD} cambioUSD={cambioUSD} onProcesar={procesarPago} isProcessing={isProcessing} rateError={rateError} changeAllocationComplete={changeAllocationComplete} totalUsd={dynamicCartTotals.totalUsd} />
                        }
                    />
                    <div className="order-1 lg:order-2 flex-1 min-h-0 flex flex-col bg-white dark:bg-slate-950 overflow-hidden">
                        <div className="flex-1 min-h-0 overflow-y-auto p-2.5 sm:p-5 pb-5">
                            {/* Barra compacta de Total a Pagar (solo móvil para evitar duplicidad y scroll) */}
                            <div className="lg:hidden mb-2.5 p-2.5 rounded-xl bg-slate-900 dark:bg-slate-800 text-white flex items-center justify-between shadow-sm">
                                <div className="flex flex-col">
                                    <span className="text-[9px] font-bold uppercase tracking-widest text-slate-400">Total a Pagar</span>
                                    <span className="text-xl font-black leading-tight text-white">${dynamicCartTotals.totalUsd.toFixed(2)}</span>
                                    {dynamicCartTotals.ivaUsd > 0 && (
                                        <span className="text-[9px] font-bold text-slate-300">Base ${dynamicCartTotals.baseUsd.toFixed(2)} + IVA ${dynamicCartTotals.ivaUsd.toFixed(2)}</span>
                                    )}
                                </div>
                                <div className="text-right">
                                    <span className="text-sm font-bold text-emerald-400">Bs {round2(dynamicCartTotals.totalBs).toLocaleString('es-VE', { minimumFractionDigits: 2 })}</span>
                                    {discountData?.active && (
                                        <span className="block text-[9px] text-emerald-300 font-bold">
                                            Desc: -{discountData.type === 'percentage' ? `${discountData.value}%` : `$${discountData.amountUsd?.toFixed(2)}`}
                                        </span>
                                    )}
                                </div>
                            </div>

                            <RepriceNotice
                                repricedActive={repricedActive}
                                totalUsd={dynamicCartTotals.totalUsd}
                                baseTotalUsd={cartTotalUsd}
                            />
                            <div className="lg:hidden mb-2.5">
                                <CheckoutCustomerPicker customers={customers} selectedCustomerId={clienteSeleccionado} setSelectedCustomerId={handleSetCliente} effectiveRate={effectiveRate} onCreateCustomer={onCreateCustomer} />
                            </div>
                            <WalletSection cliente={selectedCustomer} totalPagadoUSD={totalPagadoUSD} tasaSegura={tasaSegura} totalConIGTF={dynamicCartTotals.totalUsd} casheaAmountUsd={casheaAmountUsd} pagoSaldoFavor={pagoSaldoFavor} setPagoSaldoFavor={setPagoSaldoFavor} />
                            <div className="lg:hidden mb-3 flex gap-1.5 overflow-x-auto pb-1" role="tablist" aria-label="Moneda del pago">
                                {[
                                    metodosDivisaNorm.length > 0 && { id: 'USD', label: 'Dólares' },
                                    metodosBsNorm.length > 0 && { id: 'BS', label: 'Bolívares' },
                                    metodosCopNorm.length > 0 && { id: 'COP', label: 'COP' },
                                ].filter(Boolean).map(option => (
                                    <button
                                        key={option.id}
                                        type="button"
                                        role="tab"
                                        aria-selected={mobilePaymentCurrency === option.id}
                                        tabIndex={mobilePaymentCurrency === option.id ? 0 : -1}
                                        onClick={() => setMobilePaymentCurrency(option.id)}
                                        className={`min-h-[44px] shrink-0 px-4 rounded-xl text-xs font-black focus:outline-none focus-visible:ring-2 focus-visible:ring-brand/60 ${mobilePaymentCurrency === option.id ? 'bg-brand text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-300'}`}
                                    >
                                        {option.label}
                                    </button>
                                ))}
                            </div>
                            <PaymentInputs metodosDivisa={metodosDivisaNorm} mobileCurrency={mobilePaymentCurrency} metodosBs={metodosBsNorm} metodosCop={metodosCopNorm} pagos={pagos} handleInputChange={handleInputChange} llenarSaldo={llenarSaldo} referencias={referencias} handleRefChange={handleRefChange} inputRefs={inputRefs} handleInputKeyDown={handleInputKeyDown} tasa={tasaSegura} sumarBillete={sumarBillete} isTouch={isTouch} onFocusInput={(id) => { setActiveInputId(id); setActiveInputType('amount'); }} activeInputId={activeInputId} activeInputType={activeInputType} onFocusRef={(id) => { setActiveInputId(id); setActiveInputType('ref'); }} copEnabled={copEnabled} />
                            {isTouch && (
                                <NumericKeypad
                                    activeLabel={activeInputType === 'ref' && metodoActivo && !metodoActivo.moneda ? `Referencia de ${metodoActivo.nombre}` : metodoActivo?.nombre}
                                    onKey={handleKeypad}
                                    disabled={!metodoActivo}
                                />
                            )}
                        </div>
                    </div>
                    <div className="order-3 lg:hidden sticky bottom-0 z-20 shrink-0">
                        <PaymentFooter modo={modo} faltaPorPagar={faltaPorPagar} clienteSeleccionado={clienteSeleccionado} totalPagadoGlobalUSD={totalPagadoGlobalUSD} cambioUSD={cambioUSD} onProcesar={procesarPago} isProcessing={isProcessing} rateError={rateError} changeAllocationComplete={changeAllocationComplete} totalUsd={dynamicCartTotals.totalUsd} />
                    </div>
                </div>
            </div>

            {changeConfirmation && (
                <ChangeConfirmationModal
                    cambioUSD={cambioUSD}
                    tasaSegura={tasaSegura}
                    distVueltoUSD={distVueltoUSD}
                    distVueltoBS={distVueltoBS}
                    plannedPhysicalUsd={plannedPhysicalUsd}
                    plannedWalletUsd={plannedWalletUsd}
                    plannedCashUsd={cashKeptUsd}
                    unallocatedChangeUsd={unallocatedChangeUsd}
                    changeAllocationComplete={changeAllocationComplete}
                    changeDestinationSelected={changeDestinationSelected}
                    isChangeCredited={isChangeCredited}
                    currentFloatUsd={currentFloatUsd}
                    currentFloatBs={currentFloatBs}
                    onOpenAporte={onOpenAporte}
                    onCreditShortfall={clienteSeleccionado ? () => {
                        // CAJA-FONDO-002: lo que no hay en la gaveta queda como saldo a
                        // favor; se vuelve a la pantalla de cobro para cobrar de nuevo.
                        const fondo = evaluarFondoParaVuelto({
                            usdGiven: distVueltoUSD, bsGiven: distVueltoBS,
                            floatUsd: currentFloatUsd, floatBs: currentFloatBs,
                        });
                        if (fondo.faltaBs > 0) setDistVueltoBS('');
                        if (fondo.faltaUsd > 0) setDistVueltoUSD('');
                        setIsChangeCredited(true);
                        setChangeConfirmation(null);
                    } : null}
                    onCancel={() => setChangeConfirmation(null)}
                    onConfirm={() => {
                        const pending = changeConfirmation;
                        setChangeConfirmation(null);
                        onConfirmSale(pending.payments, pending.saleOptions, pending.imprimir);
                        triggerHaptic && triggerHaptic();
                    }}
                    isProcessing={isProcessing}
                />
            )}
        </div>
    );
}
