// Extraído de CheckoutModalPOS/index.jsx (COBRO fase 2): mismo código y mismo orden de cálculo.
import { FinancialEngine } from '../../../../core/FinancialEngine';
import { getCartIvaOpts } from '../../../../config/taxConfig';
import { subR, round2, sumR, mulR } from '../../../../utils/dinero';
import { showToast } from '../../../Toast';
import { FINANCIAL_EPSILON } from '../../../../utils/securityConstants';
import { useEffect, useRef } from 'react';
import { storageService } from '../../../../utils/storageService';
import { nextDuplicateWarning, localDayKey } from '../../../../utils/paymentReference';

export function useCheckoutPosPay({
    customers, clienteSeleccionado, pagos, cart, discountData, effectiveRate, tasaCop,
    totalPagadoGlobalUSD, totalPagadoBS, casheaAmountUsd, tasaSegura, pagoSaldoFavor,
    faltaPorPagar, setPagos, setReferencias, inputRefs, rateError, modo, cambioUSD,
    casheaActive, metodosNormalizados, val, referencias, casheaPercent, distVueltoUSD,
    distVueltoBS, isTipDonated, cashKeptUsd, isChangeCredited, changeToDeliverUsd,
    tipCurrency, setChangeConfirmation, onConfirmSale, triggerHaptic,
    changeAllocationComplete = true,
    isProcessing = false, changeConfirmation = null,
}) {
    const selectedCustomer = customers.find(c => c.id === clienteSeleccionado);

    // Referencia repetida: ventas guardadas del día, y las que ya se avisaron (cada una una vez).
    const ventasRef = useRef([]);
    const avisadasRef = useRef(new Set());
    useEffect(() => {
        let vivo = true;
        storageService.getItem('bodega_sales_v1', []).then(v => { if (vivo) ventasRef.current = Array.isArray(v) ? v : []; }).catch(() => {});
        return () => { vivo = false; };
    }, []);

    // ─── HANDLERS DE INPUT ──────────────────────────────────
    const llenarSaldo = (id, moneda) => {
        const actual = parseFloat(pagos[id] || 0);
        let valorFinal = 0;
        if (moneda === 'USD') {
            const usdTotals = FinancialEngine.buildCartTotals(cart, discountData, effectiveRate, tasaCop, false, getCartIvaOpts());
            const remUsd = Math.max(0, subR(usdTotals.totalUsd, totalPagadoGlobalUSD));
            valorFinal = round2(actual + remUsd);
        } else if (moneda === 'BS') {
            const bsTotals = FinancialEngine.buildCartTotals(cart, discountData, effectiveRate, tasaCop, true, getCartIvaOpts());
            // FIN-038: descontar también Cashea y el saldo a favor aplicado,
            // que ya cubren parte del total pero no están en totalPagadoBS.
            const cubiertoBs = sumR([
                totalPagadoBS,
                mulR(casheaAmountUsd, tasaSegura),
                mulR(parseFloat(pagoSaldoFavor) || 0, tasaSegura),
            ]);
            const remBs = Math.max(0, subR(bsTotals.totalBs, cubiertoBs));
            valorFinal = round2(actual + remBs);
        } else if (moneda === 'COP' && tasaCop > 0) {
            valorFinal = round2(actual + (faltaPorPagar * tasaCop));
        }
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
            else if (e.key === 'Enter') cobrarConTeclado(); // último campo: Enter cobra si todo está listo
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
            // M-2: la tasa se valida PRIMERO — sin tasa válida nada de lo demás tiene sentido.
            if (rateError) {
                showToast('Tasa BCV inválida. Configúrala antes de cobrar.', 'error');
                return;
            }
            if (modo === 'contado' && faltaPorPagar > 0.01) {
                showToast(`Faltan $${faltaPorPagar.toFixed(2)} por cobrar`, 'error');
                return;
            }
            if (modo === 'credito' && !clienteSeleccionado) {
                showToast('Selecciona un cliente para vender a crédito', 'warning');
                return;
            }
            // En una venta fiada, pagar más que el total no es un abono válido:
            // el excedente no debe desaparecer ni convertirse silenciosamente en deuda.
            // Cambia a Contado para entregar/acreditar el vuelto, o usa Cartera > Abono
            // si la intención era pagar una deuda anterior.
            if (modo === 'credito' && cambioUSD > 0.01) {
                showToast(`El pago excede la venta en $${cambioUSD.toFixed(2)}. Cambia a Contado para gestionar el vuelto.`, 'warning');
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

            // Referencia obligatoria (últimos 4)
            for (const m of metodosNormalizados) {
                if (val(m.id) > 0 && m.requiereRef && (!referencias[m.id] || referencias[m.id].length < 4)) {
                    showToast(`Falta la referencia de ${m.nombre} (últimos 4)`, 'warning');
                    const casilla = globalThis.document?.querySelector(`[data-ref-for="${m.id}"]`);
                    if (casilla) casilla.focus();
                    return;
                }
            }

            // Referencia repetida hoy (mismo método): avisa una vez y el segundo toque cobra.
            const repetida = nextDuplicateWarning(
                metodosNormalizados.filter(m => val(m.id) > 0), referencias, ventasRef.current, localDayKey(), avisadasRef.current
            );
            if (repetida) {
                avisadasRef.current.add(repetida.clave);
                const { metodo, ref, previa } = repetida;
                const num = previa.saleNumber ? `#${String(previa.saleNumber).padStart(7, '0')}` : 'otra venta';
                showToast(`La Ref. ${ref} de ${metodo.nombre} ya se usó hoy en la venta ${num}. Si es otro pago, pulsa COBRAR de nuevo.`, 'warning');
                const casilla = globalThis.document?.querySelector(`[data-ref-for="${metodo.id}"]`);
                if (casilla) casilla.focus();
                return;
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
                    amountBs: mulR(casheaAmountUsd, tasaSegura),
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

            const hasExplicitSplit = distVueltoUSD !== '' || distVueltoBS !== '';
            // TIP-002 (D3): propina donada ⟹ no se entrega vuelto. El procesador
            // lo vuelve a forzar, pero se manda coherente desde aquí.
            const tipEfectiva = isTipDonated && cashKeptUsd > FINANCIAL_EPSILON.PAYMENT_ZERO;
            const saleOptions = {
                // FIN-034: si el operador tocó cualquiera de los dos campos de desglose,
                // se respetan tal cual (el vacío vale 0). El botón "Todo" del campo Bs deja
                // distVueltoUSD en '' — leerlo como "no especificado" duplicaba el vuelto.
                changeUsdGiven: hasExplicitSplit
                    ? (parseFloat(distVueltoUSD) || 0)
                    : (isChangeCredited ? 0 : changeToDeliverUsd),
                changeBsGiven: hasExplicitSplit
                    ? (parseFloat(distVueltoBS) || 0)
                    : 0,
                esCredito: modo === 'credito',
                clienteId: clienteSeleccionado || null,
                esCashea: casheaActive,
                vueltoCredito: isChangeCredited,
                // TIP-001: una sola moneda canónica. amountUsd es el monto real;
                // amountBs lo recalcula el procesador si la moneda nativa es Bs.
                tipDonated: tipEfectiva
                    ? { amountUsd: cashKeptUsd, amountBs: tipCurrency === 'BS' ? round2(mulR(cashKeptUsd, tasaSegura)) : 0, currency: tipCurrency }
                    : null,
                changeAllocationExplicit: hasExplicitSplit || tipEfectiva || isChangeCredited,
            };

            // Si hay vuelto, se revisa la distribución en un modal final. No se
            // registra nada hasta que el cajero confirme explícitamente.
            // Decisión del dueño (2026-11-14): con vuelto, SIEMPRE se muestra la distribución
            // para confirmar después de pulsar COBRAR. Ahí también sale el aviso de efectivo.
            if (cambioUSD > FINANCIAL_EPSILON.PAYMENT_ZERO) {
                setChangeConfirmation({ payments, saleOptions, imprimir });
                return;
            }

            onConfirmSale(payments, saleOptions, imprimir);
            triggerHaptic && triggerHaptic();
        } catch (err) {
            console.error('Error al procesar pago POS:', err);
            showToast('Error al procesar el pago. Revisa la consola.', 'error');
        }
    };

    // COBRO fase 6: F9 y Enter (en el último campo) cobran con el mismo camino que el botón.
    function cobrarConTeclado() {
        if (isProcessing || changeConfirmation) return;
        if (modo === 'contado' && faltaPorPagar <= 0.01 && !changeAllocationComplete) {
            showToast('Elige cómo entregas el vuelto antes de cobrar', 'warning');
            return;
        }
        procesarPago(false);
    }

    return {
        selectedCustomer, handleInputChange, llenarSaldo, handleRefChange, handleInputKeyDown,
        sumarBillete, procesarPago, cobrarConTeclado,
    };
}
