import { useState, useCallback, useMemo, useRef } from 'react';
import { round2, divR, mulR, subR, sumR } from '../utils/dinero';
import { FINANCIAL_EPSILON } from '../utils/securityConstants';
import { CurrencyService } from '../services/CurrencyService'; // FIN-016: safeParse en vez de parseFloat.

/**
 * Hook de cálculos de checkout.
 *
 * FIN-009 / FIN-033: No más fallback mágico a `4150` ni a `1` para tasas inválidas.
 *   Si effectiveRate <= 0 o tasaCop <= 0 (con COP habilitado), se expone `rateError`
 *   para que la UI bloquee el cobro. Los cálculos que dependen de la tasa devuelven 0
 *   en lugar de multiplicar por un número mágico.
 * FIN-016: Reemplaza toFixed/raw mul/div por round2/mulR/divR.
 * FIN-023: Umbral de "pago completo" usa FINANCIAL_EPSILON.PAYMENT_ZERO.
 */
export function useCheckoutCalculations({
    paymentMethods,
    effectiveRate,
    tasaCop,
    copEnabled = false,
    cartTotalUsd,
    cartTotalBs,
    triggerHaptic,
    onConfirmSale,
}) {
    const [barValues, setBarValues] = useState({});
    const [changeUsdGiven, setChangeUsdGiven] = useState('');
    const [changeBsGiven, setChangeBsGiven] = useState('');
    const [paymentWarning, setPaymentWarning] = useState(null);
    const pendingConfirmRef = useRef(null);

    // -- Cashea Hook Integration --
    const [casheaActive, setCasheaActive] = useState(false);
    const [casheaPercent, setCasheaPercent] = useState(60);

    const casheaEnabled = localStorage.getItem('cashea_enabled') === 'true';
    const casheaMinAmount = parseFloat(localStorage.getItem('cashea_min_amount') || '0') || 0;
    const casheaMeetsMinimum = casheaMinAmount <= 0 || cartTotalUsd >= casheaMinAmount;

    // FIN-009 / FIN-033: detectar tasa inválida y exponer flag para que la UI bloquee.
    const rateError = !effectiveRate || effectiveRate <= 0
        ? 'Tasa BCV no configurada. Configúrala antes de cobrar.'
        : null;
    const copRateError = copEnabled && (tasaCop == null || tasaCop <= 0)
        ? 'Tasa COP no configurada. Configúrala antes de aceptar pagos en pesos.'
        : null;

    const safeRate = effectiveRate > 0 ? effectiveRate : 0;
    const safeTasaCop = tasaCop > 0 ? tasaCop : 0;

    const totalPaidUsd = useMemo(() => {
        return sumR(paymentMethods.map(m => {
            const val = CurrencyService.safeParse(barValues[m.id]);
            if (m.currency === 'USD') return round2(val);
            if (m.currency === 'COP') return safeTasaCop > 0 ? divR(val, safeTasaCop) : 0;
            return safeRate > 0 ? divR(val, safeRate) : 0;
        }));
    }, [barValues, paymentMethods, effectiveRate, tasaCop, safeRate, safeTasaCop]);

    const totalPaidBs = useMemo(() => {
        return sumR(paymentMethods.map(m => {
            const val = CurrencyService.safeParse(barValues[m.id]);
            if (m.currency === 'BS') return round2(val);
            if (m.currency === 'COP') return safeTasaCop > 0 && safeRate > 0
                ? mulR(divR(val, safeTasaCop), safeRate)
                : 0;
            return safeRate > 0 ? mulR(val, safeRate) : 0;
        }));
    }, [barValues, paymentMethods, effectiveRate, tasaCop, safeRate, safeTasaCop]);

    // Monto que Cashea cubre (virtual, se agrega como pago al confirmar)
    const casheaAmountUsd = useMemo(() => {
        if (!casheaActive) return 0;
        return round2(mulR(cartTotalUsd, (100 - casheaPercent) / 100));
    }, [casheaActive, casheaPercent, cartTotalUsd]);

    const totalPaidWithCasheaUsd = round2(totalPaidUsd + casheaAmountUsd);

    const remainingUsd = Math.max(0, subR(cartTotalUsd, totalPaidWithCasheaUsd));
    const remainingBs = Math.max(0, subR(cartTotalBs, totalPaidBs + mulR(casheaAmountUsd, safeRate)));
    const changeUsd = Math.max(0, subR(totalPaidWithCasheaUsd, cartTotalUsd));
    const changeBs = Math.max(0, subR(totalPaidBs + mulR(casheaAmountUsd, safeRate), cartTotalBs));
    // FIN-023: umbral centralizado en securityConstants (antes `0.009` hardcodeado).
    const isPaid = remainingUsd < FINANCIAL_EPSILON.PAYMENT_ZERO;

    const PAYMENT_TOLERANCE = 0.01;
    const casheaConfirmReady = !casheaActive || isPaid || totalPaidUsd >= round2(cartTotalUsd - casheaAmountUsd) - PAYMENT_TOLERANCE;

    const handleBarChange = useCallback((methodId, value) => {
        let v = value.replace(',', '.');
        if (!/^[0-9.]*$/.test(v)) return;
        const dots = v.match(/\./g);
        if (dots && dots.length > 1) return;
        setBarValues(prev => ({ ...prev, [methodId]: v }));
    }, []);

    const fillBar = useCallback((methodId, currency) => {
        triggerHaptic && triggerHaptic();
        let val;
        if (currency === 'USD') {
            // FIN-016: round2 en vez de Number(remainingUsd.toFixed(2)).
            val = remainingUsd > 0 ? String(round2(remainingUsd)) : null;
        } else if (currency === 'COP') {
            // FIN-016: mulR en vez de (remainingUsd * safeTasaCop).toFixed(2).
            const copVal = safeTasaCop > 0 ? mulR(remainingUsd, safeTasaCop) : 0;
            val = remainingUsd > 0 ? String(round2(copVal)) : null;
        } else {
            val = remainingBs > 0 ? String(round2(remainingBs)) : null;
        }
        if (val) {
            setBarValues(prev => ({ ...prev, [methodId]: val }));
        }
    }, [remainingUsd, remainingBs, triggerHaptic, safeTasaCop]);

    // ── Procesamiento final de la venta (sin validaciones) ────────────────────
    const _processPayments = useCallback(() => {
        const payments = paymentMethods
            .filter(m => CurrencyService.safeParse(barValues[m.id]) > 0)
            .map(m => {
                const amount = round2(CurrencyService.safeParse(barValues[m.id]));
                return {
                    id: crypto.randomUUID(),
                    methodId: m.id,
                    methodLabel: m.label,
                    currency: m.currency,
                    amountInput: amount,
                    amountInputCurrency: m.currency,
                    amountUsd: m.currency === 'USD' ? amount
                        : m.currency === 'COP' ? (safeTasaCop > 0 ? divR(amount, safeTasaCop) : 0)
                        : (safeRate > 0 ? divR(amount, safeRate) : 0),
                    amountBs: m.currency === 'BS' ? amount
                        : m.currency === 'COP' ? (safeTasaCop > 0 && safeRate > 0 ? mulR(divR(amount, safeTasaCop), safeRate) : 0)
                        : (safeRate > 0 ? mulR(amount, safeRate) : 0),
                };
            });

        // Agregar pago virtual de Cashea si está activo
        if (casheaActive && casheaAmountUsd > 0) {
            payments.push({
                id: crypto.randomUUID(),
                methodId: 'cashea',
                methodLabel: 'Cashea',
                currency: 'USD',
                amountInput: casheaAmountUsd,
                amountInputCurrency: 'USD',
                amountUsd: casheaAmountUsd,
                amountBs: mulR(casheaAmountUsd, safeRate),
                isCashea: true,
                casheaPercent: 100 - casheaPercent,
            });
        }

        const defaultUsdChange = (!changeUsdGiven && !changeBsGiven) ? changeUsd : round2(CurrencyService.safeParse(changeUsdGiven));
        const defaultBsChange  = (!changeUsdGiven && !changeBsGiven) ? changeBs  : round2(CurrencyService.safeParse(changeBsGiven));
        onConfirmSale(payments, {
            changeUsdGiven: Math.min(defaultUsdChange, changeUsd),
            changeBsGiven: Math.min(defaultBsChange, changeBs),
        });
    }, [barValues, paymentMethods, onConfirmSale, changeUsdGiven, changeBsGiven, changeUsd, changeBs, safeRate, safeTasaCop, casheaActive, casheaAmountUsd, casheaPercent]);

    // ── Detección inteligente de errores de entrada ───────────────────────────
    const _detectWarning = useCallback(() => {
        if (cartTotalUsd <= 0) return null;

        for (const m of paymentMethods) {
            const val = CurrencyService.safeParse(barValues[m.id]);
            if (val === 0) continue;

            // FIN-016: usar divR en vez de val/safeRate o val/safeTasaCop.
            const valUsd = m.currency === 'USD' ? val
                : m.currency === 'COP' ? (safeTasaCop > 0 ? divR(val, safeTasaCop) : 0)
                : (safeRate > 0 ? divR(val, safeRate) : 0);
            const diff = valUsd - cartTotalUsd;

            // Capa 1 — Confusión Bs → USD
            if (m.currency === 'USD' && safeRate > 1) {
                const impliedUsd = safeRate > 0 ? divR(val, safeRate) : 0;
                const ratio = impliedUsd / cartTotalUsd;
                if (ratio >= 0.90 && ratio <= 1.10 && val > cartTotalUsd * 3) {
                    const expectedBs = round2(mulR(cartTotalUsd, safeRate));
                    return {
                        type: 'currency_confusion',
                        title: 'Posible error de moneda',
                        lines: [
                            `Ingresaste $${round2(val)} en el campo de Dólares, pero el total de la venta es $${round2(cartTotalUsd)}.`,
                            `El total en Bolívares es Bs ${expectedBs.toLocaleString('es-VE', { minimumFractionDigits: 2 })}. ¿Confundiste el campo?`,
                        ],
                        isRound: false,
                    };
                }
            }

            // Capa 1b — Confusión USD → COP (monto muy bajo en COP)
            if (m.currency === 'COP' && safeTasaCop > 100) {
                const expectedCop = mulR(cartTotalUsd, safeTasaCop);
                // If user entered a value that looks like USD in COP field (e.g., 50 instead of 200,000)
                if (val < expectedCop * 0.05 && val > 0 && val <= cartTotalUsd * 2) {
                    return {
                        type: 'currency_confusion',
                        title: 'Posible error de moneda',
                        lines: [
                            `Ingresaste COP ${val.toLocaleString('es-CO')} pero el total en pesos es ${round2(expectedCop).toLocaleString('es-CO')} COP.`,
                            `¿Ingresaste dólares en el campo de pesos?`,
                        ],
                        isRound: false,
                    };
                }
            }

            // Capa 2 — Umbral proporcional según tamaño de venta
            const threshold = cartTotalUsd <= 10  ? { factor: 4,   minDiff: 15 }
                            : cartTotalUsd <= 50  ? { factor: 3,   minDiff: 30 }
                            : cartTotalUsd <= 200 ? { factor: 2,   minDiff: 50 }
                            :                      { factor: 1.5, minDiff: 100 };

            if (valUsd > cartTotalUsd * threshold.factor && diff > threshold.minDiff) {
                const symbol = m.currency === 'USD' ? '$' : m.currency === 'COP' ? 'COP ' : 'Bs ';
                const isRound = val >= 100 && val % 100 === 0;
                return {
                    type: 'high_amount',
                    title: 'Monto inusualmente alto',
                    lines: [
                        `Ingresaste ${symbol}${val.toLocaleString('es-VE', { minimumFractionDigits: 2 })} para una venta de $${round2(cartTotalUsd)}.`,
                        `¿El cliente realmente pagó esa cantidad?`,
                    ],
                    isRound,
                };
            }
        }
        return null;
    }, [barValues, paymentMethods, cartTotalUsd, safeRate, safeTasaCop]);

    const handleConfirm = useCallback(() => {
        triggerHaptic && triggerHaptic();
        const warning = _detectWarning();
        if (warning) {
            pendingConfirmRef.current = _processPayments;
            setPaymentWarning(warning);
            return;
        }
        _processPayments();
    }, [_detectWarning, _processPayments, triggerHaptic]);

    const confirmWarning = useCallback(() => {
        setPaymentWarning(null);
        pendingConfirmRef.current?.();
        pendingConfirmRef.current = null;
    }, []);

    const dismissWarning = useCallback(() => {
        setPaymentWarning(null);
        pendingConfirmRef.current = null;
    }, []);

    return {
        barValues,
        totalPaidUsd,
        remainingUsd,
        remainingBs,
        changeUsd,
        changeBs,
        isPaid,
        changeUsdGiven,
        changeBsGiven,
        setChangeUsdGiven,
        setChangeBsGiven,
        handleBarChange,
        fillBar,
        handleConfirm,
        paymentWarning,
        confirmWarning,
        dismissWarning,
        safeRate,
        safeTasaCop,
        // FIN-009 / FIN-033: exponer errores de tasa para que la UI bloquee el cobro.
        rateError,
        copRateError,
        // Cashea outputs
        casheaActive,
        setCasheaActive,
        casheaPercent,
        setCasheaPercent,
        casheaAmountUsd,
        casheaConfirmReady,
        casheaEnabled,
        casheaMinAmount,
        casheaMeetsMinimum,
    };
}
