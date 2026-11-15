// Extraído de CheckoutModalPOS/index.jsx (COBRO fase 2): mismo código y mismo orden de cálculo.
import { useState, useMemo } from 'react';
import { FinancialEngine } from '../../../../core/FinancialEngine';
import { getCartIvaOpts } from '../../../../config/taxConfig';
import { isTicketRepriced } from '../../../../utils/reprice.js';
import { usePaymentCalculations } from '../hooks/usePaymentCalculations';
import { round2, subR, divR, sumR, calculateChangeRemainder, mulR } from '../../../../utils/dinero';
import { FINANCIAL_EPSILON } from '../../../../utils/securityConstants';

export function useCheckoutPosAmounts({
    cart, metodosBsNorm, activeInputId, val, cartTotalUsd, cartTotalBs, cartBaseUsd,
    cartIvaUsd, discountData, effectiveRate, tasaCop, pagos, metodosNormalizados,
    pagoSaldoFavor, copEnabled,
}) {
    // Cashea
    const casheaEnabled = localStorage.getItem('cashea_enabled') === 'true';
    const casheaMinAmount = parseFloat(localStorage.getItem('cashea_min_amount') || '0') || 0;
    const [casheaActive, setCasheaActive] = useState(false);
    const [casheaPercent, setCasheaPercent] = useState(60);

    // Vuelto distribución
    const [distVueltoUSD, setDistVueltoUSD] = useState('');
    const [distVueltoBS, setDistVueltoBS] = useState('');
    const [isChangeCredited, setIsChangeCredited] = useState(false);
    // TIP: propina donada ("cliente deja el cambio").
    const [isTipDonated, setIsTipDonated] = useState(false);
    // TIP-002 (D6): propinas grandes exigen una segunda pulsación.
    const [tipConfirmPending, setTipConfirmPending] = useState(false);
    // Monto del vuelto que el cliente deja en caja. Puede ser parcial.
    const [tipAmountUsd, setTipAmountUsd] = useState('');
    // En móvil se muestra una sola familia de moneda a la vez para reducir
    // desplazamiento y evitar errores de captura. Los valores no se pierden al
    // cambiar de pestaña.
    const [mobilePaymentCurrency, setMobilePaymentCurrency] = useState('USD');
    const [showMobileChangeDetails, setShowMobileChangeDetails] = useState(false);
    // La distribución se confirma en un segundo paso únicamente cuando existe vuelto.
    const [changeConfirmation, setChangeConfirmation] = useState(null);

    // Detectar si hay pagos ingresados en Bolívares o si un input de Bolívares está seleccionado
    const isBsPaymentActive = useMemo(() => {
        if (!cart || cart.length === 0) return false;
        const hasDualItem = cart.some(i => i.pricingMode === 'dual_usd' && parseFloat(i.priceBsUsdRef) > 0);
        if (!hasDualItem) return false;
        const isBsInputActive = metodosBsNorm.some(m => m.id === activeInputId);
        const hasBsPayment = metodosBsNorm.some(m => val(m.id) > 0);
        return isBsInputActive || hasBsPayment;
    }, [cart, metodosBsNorm, val, activeInputId]);

    // Recalcular totales dinámicos si el pago es en Bolívares
    const dynamicCartTotals = useMemo(() => {
        if (!cart || cart.length === 0 || !cart.some(i => i.pricingMode === 'dual_usd' && parseFloat(i.priceBsUsdRef) > 0)) {
            return { totalUsd: cartTotalUsd, totalBs: cartTotalBs, baseUsd: cartBaseUsd, ivaUsd: cartIvaUsd };
        }
        // IVA: misma configuración que la cesta, para que el total cobrado coincida con lo mostrado.
        return FinancialEngine.buildCartTotals(cart, discountData, effectiveRate, tasaCop, isBsPaymentActive, getCartIvaOpts());
    }, [cart, discountData, effectiveRate, tasaCop, isBsPaymentActive, cartTotalUsd, cartTotalBs, cartBaseUsd, cartIvaUsd]);

    // AVISO-REPRECIO (PLAN-AVISO-REPRECIO-BS · Trabajo 1): el total cambia al
    // aplicar el precio de referencia en Bs de los ítems con Doble Precio.
    const repricedActive = isTicketRepriced({
        isBsPaymentActive,
        baseTotalUsd: cartTotalUsd,
        newTotalUsd: dynamicCartTotals.totalUsd,
    });
    const casheaMeetsMinimum = casheaMinAmount <= 0 || dynamicCartTotals.totalUsd >= casheaMinAmount;

    // M-2: paridad con el modo básico — bloquear el cobro si la tasa BCV es inválida.
    // Sin esto el POS deja armar todo el pago y el rechazo llega recién en el procesador.
    const rateError = !effectiveRate || effectiveRate <= 0;

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
        totalUSD: dynamicCartTotals.totalUsd,
        totalBS: dynamicCartTotals.totalBs,
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

    // El resto del vuelto, después de lo dejado en caja, puede entregarse
    // físicamente o acreditarse a la billetera.
    const cashKeptUsd = round2(Math.min(
        Math.max(0, parseFloat(tipAmountUsd) || 0),
        cambioUSD
    ));
    const changeToDeliverUsd = round2(Math.max(0, subR(cambioUSD, cashKeptUsd)));
    const declaredPhysicalUsd = round2(Math.min(
        changeToDeliverUsd,
        Math.max(0, parseFloat(distVueltoUSD) || 0) + divR(Math.max(0, parseFloat(distVueltoBS) || 0), tasaSegura)
    ));
    const walletRemainderUsd = round2(Math.max(0, subR(changeToDeliverUsd, declaredPhysicalUsd)));
    const hasPhysicalDistribution = distVueltoUSD !== '' || distVueltoBS !== '';
    const plannedPhysicalUsd = hasPhysicalDistribution
        ? declaredPhysicalUsd
        : (isChangeCredited ? 0 : changeToDeliverUsd);
    const plannedWalletUsd = isChangeCredited ? walletRemainderUsd : 0;
    const unallocatedChangeUsd = round2(Math.max(0, subR(
        changeToDeliverUsd,
        sumR(plannedPhysicalUsd, plannedWalletUsd)
    )));
    const changeDestinationSelected = changeToDeliverUsd <= FINANCIAL_EPSILON.PAYMENT_ZERO
        || hasPhysicalDistribution
        || isChangeCredited;
    const changeAllocationComplete = changeDestinationSelected
        && unallocatedChangeUsd <= FINANCIAL_EPSILON.PAYMENT_ZERO;
    // Referencia dinámica para el cajero: muestra el remanente del mismo vuelto
    // en ambas monedas, sin escribir automáticamente en el otro campo.
    const changeRemainder = calculateChangeRemainder(
        changeToDeliverUsd,
        distVueltoUSD,
        distVueltoBS,
        tasaSegura,
    );
    // Cada moneda solo puede ocupar el espacio que deja la otra. Así nunca se
    // puede declarar $2 + Bs 2.085 cuando el vuelto real es $2,88.
    const maxVueltoUSD = round2(Math.max(0, subR(
        changeToDeliverUsd,
        divR(Math.max(0, parseFloat(distVueltoBS) || 0), tasaSegura),
    )));
    const maxVueltoBS = round2(Math.max(0, mulR(
        Math.max(0, subR(changeToDeliverUsd, Math.max(0, parseFloat(distVueltoUSD) || 0))),
        tasaSegura,
    )));

    return {
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
        unallocatedChangeUsd, hasPhysicalDistribution,
    };
}
