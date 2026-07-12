import React, { useState, useCallback, useEffect, useRef } from 'react';
import { showToast } from '../../Toast';
import { useProductContext } from '../../../context/ProductContext';
import { round2, subR, mulR, divR } from '../../../utils/dinero';

// Hooks portados
import { usePaymentState } from './hooks/usePaymentState';
import { usePaymentCalculations } from './hooks/usePaymentCalculations';
import { useClientWallet } from './hooks/useClientWallet';

// Subcomponentes
import PaymentHeader from './components/PaymentHeader';
import PaymentLeftColumn from './components/PaymentLeftColumn';
import PaymentInputs from './components/PaymentInputs';
import PaymentFooter from './components/PaymentFooter';
import WalletSection from './components/WalletSection';

/**
 * CheckoutModalPOS — Modo de cobro profesional (estilo Listo POS, dos columnas).
 * Recibe exactamente los mismos props que CheckoutModal (modo básico) para ser
 * intercambiable sin cambios en SalesView.
 *
 * Props idénticos a CheckoutModal:
 *   onClose, cartTotalUsd, cartTotalBs, discountData, effectiveRate,
 *   customers, selectedCustomerId, setSelectedCustomerId,
 *   paymentMethods, onConfirmSale, onCreateCustomer, triggerHaptic,
 *   copEnabled, copPrimary, tasaCop, onUseSaldoFavor,
 *   currentFloatUsd, currentFloatBs
 *
 * Adicionalmente:
 *   onSwitchMode — callback para cambiar al modo básico desde el header
 */
export default function CheckoutModalPOS({
    onClose,
    cartSubtotalUsd,
    cartTotalUsd,
    cartTotalBs,
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
    currentFloatUsd = 0,
    currentFloatBs = 0,
    onSwitchMode,
    isProcessing = false,
}) {
    const { setCheckoutMode } = useProductContext();

    // Separar métodos por tipo para los inputs
    const metodosActivos = paymentMethods.filter(m => !m.disabled && m.enabled !== false);
    const metodosDivisa = metodosActivos.filter(m => m.currency === 'USD');
    const metodosBs = metodosActivos.filter(m => m.currency === 'BS').sort((a, b) => {
        const isCashA = a.label?.toLowerCase().includes('efectivo');
        const isCashB = b.label?.toLowerCase().includes('efectivo');
        if (isCashA && !isCashB) return -1;
        if (!isCashA && isCashB) return 1;
        return 0;
    });
    const metodosCop = copEnabled ? metodosActivos.filter(m => m.currency === 'COP') : [];

    // Re-mapeo: paymentMethods de bodega usan {id, label, currency} pero los hooks
    // de Listo POS esperan {id, nombre, tipo}. Normalizamos aquí.
    const metodosNormalizados = metodosActivos.map(m => ({
        ...m,
        nombre: m.label || m.nombre || m.id,
        tipo: m.currency === 'BS' ? 'BS' : m.currency === 'COP' ? 'COP' : 'DIVISA',
        icono: m.icon || m.icono || 'DollarSign',
    }));
    const metodosDivisaNorm = metodosNormalizados.filter(m => m.tipo === 'DIVISA');
    const metodosBsNorm = metodosNormalizados.filter(m => m.tipo === 'BS').sort((a, b) => {
        const isCashA = a.nombre.toLowerCase().includes('efectivo');
        const isCashB = b.nombre.toLowerCase().includes('efectivo');
        if (isCashA && !isCashB) return -1;
        if (!isCashA && isCashB) return 1;
        return 0;
    });
    const metodosCopNorm = copEnabled ? metodosNormalizados.filter(m => m.tipo === 'COP') : [];

    // ─── STATE ─────────────────────────────────────────────
    const {
        modo, setModo,
        clienteSeleccionado, setClienteSeleccionado,
        pagos, setPagos,
        referencias, setReferencias,
        pagoSaldoFavor, setPagoSaldoFavor,
        activeInputId, setActiveInputId,
        activeInputType, setActiveInputType,
        inputRefs,
        val,
    } = usePaymentState(null, metodosNormalizados, false);

    // Sync external selectedCustomerId con el estado interno
    useEffect(() => {
        if (selectedCustomerId !== undefined) {
            setClienteSeleccionado(selectedCustomerId || '');
        }
    }, [selectedCustomerId]);

    // Propagar cambio de cliente al exterior
    const handleSetCliente = useCallback((id) => {
        setClienteSeleccionado(id);
        setSelectedCustomerId(id);
    }, [setSelectedCustomerId]);

    // Cashea
    const casheaEnabled = localStorage.getItem('cashea_enabled') === 'true';
    const casheaMinAmount = parseFloat(localStorage.getItem('cashea_min_amount') || '0') || 0;
    const casheaMeetsMinimum = casheaMinAmount <= 0 || cartTotalUsd >= casheaMinAmount;
    const [casheaActive, setCasheaActive] = useState(false);
    const [casheaPercent, setCasheaPercent] = useState(60);

    // Vuelto distribución
    const [distVueltoUSD, setDistVueltoUSD] = useState('');
    const [distVueltoBS, setDistVueltoBS] = useState('');
    const [isChangeCredited, setIsChangeCredited] = useState(false);

    // ─── CÁLCULOS ──────────────────────────────────────────
    const {
        totalPagadoUSD,
        totalPagadoBS,
        totalPagadoGlobalUSD,
        faltaPorPagar,
        faltaPorPagarBS,
        cambioUSD,
        montoIGTF,
        totalConIGTF,
        totalConIGTFBS,
        tasaSegura,
        casheaAmountUsd,
    } = usePaymentCalculations({
        totalUSD: cartTotalUsd,
        totalBS: cartTotalBs,
        pagos,
        tasa: effectiveRate,
        metodosActivos: metodosNormalizados,
        val,
        pagoSaldoFavor,
        casheaActive,
        casheaPercent,
        copEnabled,
        tasaCop,
    });

    const handleVueltoDistChange = (moneda, valor) => {
        let cleanVal = valor.replace(',', '.');
        if (cleanVal !== '' && !/^\d*\.?\d*$/.test(cleanVal)) return;

        const valNum = parseFloat(cleanVal) || 0;
        
        if (moneda === 'usd') {
            const usdMax = round2(Math.min(valNum, cambioUSD));
            if (valNum > cambioUSD) {
                showToast(`El vuelto total es de $${cambioUSD.toFixed(2)}`, 'warning');
            }
            setDistVueltoUSD(cleanVal === '' ? '' : usdMax.toString());
            
            const restUsd = round2(Math.max(0, subR(cambioUSD, usdMax)));
            const restBs = round2(mulR(restUsd, tasaSegura));
            setDistVueltoBS(restUsd > 0.001 ? Math.round(restBs).toString() : '');
        } else {
            const maxBs = round2(mulR(cambioUSD, tasaSegura));
            const bsMax = round2(Math.min(valNum, maxBs));
            if (valNum > maxBs) {
                showToast(`El vuelto total en bolívares es Bs ${Math.round(maxBs).toLocaleString('es-VE')}`, 'warning');
            }
            setDistVueltoBS(cleanVal === '' ? '' : bsMax.toString());
            
            const restBsInUsd = divR(bsMax, tasaSegura);
            const restUsd = round2(Math.max(0, subR(cambioUSD, restBsInUsd)));
            setDistVueltoUSD(restUsd > 0.001 ? restUsd.toFixed(2) : '');
        }
    };
    const handleCreditChange = () => {
        if (!clienteSeleccionado) {
            showToast('Selecciona un cliente para abonar el vuelto a cuenta', 'warning');
            return;
        }
        setIsChangeCredited(true);
    };

    // Limpiar vuelto cuando baja
    useEffect(() => {
        if (cambioUSD <= 0) {
            setDistVueltoUSD('');
            setDistVueltoBS('');
        }
    }, [cambioUSD]);

    // ─── WALLET ─────────────────────────────────────────────
    const { proyeccion } = useClientWallet(
        clienteSeleccionado, customers, modo, cambioUSD,
        isChangeCredited, distVueltoUSD, distVueltoBS, tasaSegura
    );

    const selectedCustomer = customers.find(c => c.id === clienteSeleccionado);

    // ─── HANDLERS DE INPUT ──────────────────────────────────
    const llenarSaldo = (id, moneda) => {
        const actual = parseFloat(pagos[id] || 0);
        let valorFinal = 0;
        if (moneda === 'USD') valorFinal = round2(actual + faltaPorPagar);
        if (moneda === 'BS') valorFinal = round2(actual + faltaPorPagarBS);
        if (moneda === 'COP' && tasaCop > 0) valorFinal = round2(actual + (faltaPorPagar * tasaCop));
        setPagos(prev => ({ ...prev, [id]: valorFinal }));
    };

    const sumarBillete = (id, monto) => {
        const actual = parseFloat(pagos[id] || 0);
        const nuevo = round2(actual + monto);
        setPagos(prev => ({ ...prev, [id]: nuevo }));
    };

    const handleInputChange = (id, v) => {
        if (v === '' || /^\d*\.?\d*$/.test(v)) {
            setPagos(prev => ({ ...prev, [id]: v }));
        }
    };

    const handleRefChange = (id, v) => setReferencias(prev => ({ ...prev, [id]: v }));

    const handleInputKeyDown = (e, index) => {
        if (e.key === 'Enter' || e.key === 'ArrowDown') {
            e.preventDefault();
            const next = inputRefs.current[index + 1];
            if (next) next.focus({ preventScroll: true });
        }
        if (e.key === 'ArrowUp') {
            e.preventDefault();
            const prev = inputRefs.current[index - 1];
            if (prev) prev.focus({ preventScroll: true });
        }
    };

    // ─── PROCESAR PAGO ──────────────────────────────────────
    const procesarPago = (imprimir = false) => {
        try {
            // Validaciones
            if (modo === 'contado' && faltaPorPagar > 0.01) {
                showToast(`Faltan $${faltaPorPagar.toFixed(2)} por cobrar`, 'error');
                return;
            }
            if (modo === 'credito' && !clienteSeleccionado) {
                showToast('Selecciona un cliente para vender a crédito', 'warning');
                return;
            }
            if (parseFloat(pagoSaldoFavor || 0) > 0 && !clienteSeleccionado) {
                showToast('Selecciona un cliente para usar saldo a favor', 'error');
                return;
            }
            if (casheaActive && !clienteSeleccionado) {
                showToast('Selecciona un cliente para financiar con Cashea', 'warning');
                return;
            }

            // Verificar referencias
            for (const m of metodosNormalizados) {
                if (val(m.id) > 0 && m.requiereRef && (!referencias[m.id] || referencias[m.id].length < 4)) {
                    showToast(`Ingresa la referencia para ${m.nombre}`, 'warning');
                    return;
                }
            }

            // Construir pagos finales en formato que onConfirmSale espera
            const payments = metodosNormalizados
                .filter(m => val(m.id) > 0)
                .map(m => {
                    const amount = round2(val(m.id));
                    const currency = m.tipo === 'BS' ? 'BS' : m.tipo === 'COP' ? 'COP' : 'USD';
                    return {
                        id: crypto.randomUUID(),
                        methodId: m.id,
                        methodLabel: m.nombre,
                        currency,
                        amountInput: amount,
                        amountInputCurrency: currency,
                        amountUsd: currency === 'USD' ? amount
                            : currency === 'COP' ? (tasaCop > 0 ? amount / tasaCop : 0)
                            : (tasaSegura > 0 ? amount / tasaSegura : 0),
                        amountBs: currency === 'BS' ? amount
                            : currency === 'COP' ? (tasaCop > 0 && tasaSegura > 0 ? (amount / tasaCop) * tasaSegura : 0)
                            : (tasaSegura > 0 ? amount * tasaSegura : 0),
                        referencia: referencias[m.id] || '',
                    };
                });

            // Añadir Cashea virtual
            if (casheaActive && casheaAmountUsd > 0) {
                payments.push({
                    id: crypto.randomUUID(),
                    methodId: 'cashea',
                    methodLabel: 'Cashea',
                    currency: 'USD',
                    amountInput: casheaAmountUsd,
                    amountInputCurrency: 'USD',
                    amountUsd: casheaAmountUsd,
                    amountBs: casheaAmountUsd * tasaSegura,
                    isCashea: true,
                    casheaPercent: 100 - casheaPercent,
                });
            }

            // Añadir saldo a favor
            if (parseFloat(pagoSaldoFavor) > 0) {
                payments.push({
                    id: crypto.randomUUID(),
                    methodId: 'saldo_favor',
                    methodLabel: 'Saldo a Favor',
                    currency: 'USD',
                    amountInput: parseFloat(pagoSaldoFavor),
                    amountInputCurrency: 'USD',
                    amountUsd: parseFloat(pagoSaldoFavor),
                    amountBs: parseFloat(pagoSaldoFavor) * tasaSegura,
                    isSaldoFavor: true,
                });
            }

            onConfirmSale(payments, {
                changeUsdGiven: distVueltoUSD ? parseFloat(distVueltoUSD) : cambioUSD,
                changeBsGiven: distVueltoBS ? parseFloat(distVueltoBS) : 0,
                esCredito: modo === 'credito',
                clienteId: clienteSeleccionado || null,
                esCashea: casheaActive,
                vueltoCredito: isChangeCredited,
            }, imprimir);

            triggerHaptic && triggerHaptic();
        } catch (err) {
            console.error('Error al procesar pago POS:', err);
            showToast('Error al procesar el pago. Revisa la consola.', 'error');
        }
    };

    const deudaCliente = modo === 'credito' ? faltaPorPagar : 0;
    const isVueltoValido = cambioUSD < 0.001 || (
        parseFloat(distVueltoUSD || 0) + parseFloat(distVueltoBS || 0) / tasaSegura <= cambioUSD + 0.001
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
        <div className="fixed inset-0 bg-black/40 dark:bg-black/60 flex items-center justify-center z-50 p-4 backdrop-blur-sm animate-in fade-in duration-200">
            <div
                role="dialog"
                aria-modal="true"
                aria-label="Modal de pago profesional"
                className="bg-white dark:bg-slate-950 w-full max-w-5xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[95vh] animate-in zoom-in-95 duration-200"
            >
                {/* Header */}
                <PaymentHeader
                    modo={modo}
                    setModo={setModo}
                    onClose={onClose}
                    onSwitchToBasic={handleSwitchToBasic}
                    tasa={effectiveRate}
                    casheaActive={casheaActive}
                />

                {/* Body — dos columnas */}
                <div className="flex flex-1 overflow-hidden">
                    {/* Columna Izquierda */}
                    <PaymentLeftColumn
                        totalUSD={cartTotalUsd}
                        totalBS={cartTotalBs}
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
                    />

                    {/* Columna Derecha — inputs */}
                    <div className="flex-1 flex flex-col bg-white dark:bg-slate-950 overflow-hidden">
                        <div className="flex-1 overflow-y-auto p-5">
                            {/* Saldo a Favor */}
                            <WalletSection
                                cliente={selectedCustomer}
                                totalPagadoUSD={totalPagadoUSD}
                                tasaSegura={tasaSegura}
                                totalConIGTF={cartTotalUsd}
                                pagoSaldoFavor={pagoSaldoFavor}
                                setPagoSaldoFavor={setPagoSaldoFavor}
                            />

                            {/* Inputs de pago */}
                            <PaymentInputs
                                metodosDivisa={metodosDivisaNorm}
                                metodosBs={metodosBsNorm}
                                metodosCop={metodosCopNorm}
                                pagos={pagos}
                                handleInputChange={handleInputChange}
                                llenarSaldo={llenarSaldo}
                                referencias={referencias}
                                handleRefChange={handleRefChange}
                                inputRefs={inputRefs}
                                handleInputKeyDown={handleInputKeyDown}
                                tasa={tasaSegura}
                                sumarBillete={sumarBillete}
                                isTouch={false}
                                onFocusInput={(id) => { setActiveInputId(id); setActiveInputType('amount'); }}
                                activeInputId={activeInputId}
                                onFocusRef={(id) => { setActiveInputId(id); setActiveInputType('ref'); }}
                                copEnabled={copEnabled}
                            />
                        </div>

                        {/* Footer */}
                        <PaymentFooter
                            modo={modo}
                            faltaPorPagar={faltaPorPagar}
                            clienteSeleccionado={clienteSeleccionado}
                            totalPagadoGlobalUSD={totalPagadoGlobalUSD}
                            onProcesar={procesarPago}
                            isProcessing={isProcessing}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}
