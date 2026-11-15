// Extraído de CheckoutModalPOS/index.jsx (COBRO fases 2 y 4). Vuelto: reparto y opciones de un toque.
import { useEffect, useMemo, useState } from 'react';
import { FINANCIAL_EPSILON } from '../../../../utils/securityConstants';
import { round2, divR, subR, sumR, mulR } from '../../../../utils/dinero';
import { showToast } from '../../../Toast';
import { useClientWallet } from '../hooks/useClientWallet';
import { restoEnLaOtra, completarCampo, otroEsAutomatico, calcularSugerido } from './changeReparto';

// F7: sin cliente, la opción de billetera abre el selector de cliente (además del aviso).
// Hay dos selectores (PC y pantalla angosta, uno escondido): se toca el que se ve.
function abrirSelectorCliente() {
    const botones = globalThis.document?.querySelectorAll('[data-testid="customer-picker-toggle"]') || [];
    const visible = Array.from(botones).find(b => b.getClientRects().length > 0);
    if (visible && visible.getAttribute('aria-expanded') === 'false') visible.click();
}

export function useCheckoutPosChange({ 
    distVueltoUSD, distVueltoBS, maxVueltoBS, setDistVueltoBS, maxVueltoUSD,
    setDistVueltoUSD, isChangeCredited, walletRemainderUsd, setIsChangeCredited, tasaSegura,
    cambioUSD, setTipAmountUsd, setIsTipDonated, changeToDeliverUsd, clienteSeleccionado,
    metodosNormalizados, val, isTipDonated, setTipConfirmPending, tipConfirmPending,
    triggerHaptic, setShowMobileChangeDetails, metodosDivisaNorm, metodosBsNorm,
    metodosCopNorm, mobilePaymentCurrency, setMobilePaymentCurrency, customers, modo,
    cashKeptUsd, currentFloatUsd = null
 }) {
// Corrige también estados antiguos que pudieran haber quedado sobreasignados
    // por la versión anterior de la interfaz.
    useEffect(() => {
        const currentUsd = Math.max(0, parseFloat(distVueltoUSD) || 0);
        const currentBs = Math.max(0, parseFloat(distVueltoBS) || 0);
        if (currentBs > maxVueltoBS + 0.01) {
            setDistVueltoBS(maxVueltoBS.toString());
        } else if (currentUsd > maxVueltoUSD + 0.01) {
            setDistVueltoUSD(maxVueltoUSD.toString());
        }
    }, [distVueltoUSD, distVueltoBS, maxVueltoUSD, maxVueltoBS]);

    // Si se asigna todo el cambio a físico o caja, desactivar automáticamente la acreditación a billetera
    useEffect(() => {
        if (isChangeCredited && walletRemainderUsd <= FINANCIAL_EPSILON.PAYMENT_ZERO) {
            setIsChangeCredited(false);
        }
    }, [isChangeCredited, walletRemainderUsd]);

    // Límite máximo para propina / dejar en caja respetando el cambio físico ya asignado
    const declaredPhysicalWithoutTip = round2(
        Math.max(0, parseFloat(distVueltoUSD) || 0) +
        divR(Math.max(0, parseFloat(distVueltoBS) || 0), tasaSegura)
    );
    const maxTipUsd = round2(Math.max(0, subR(cambioUSD, declaredPhysicalWithoutTip)));

    const handleTipAmountChange = (valor) => {
        const cleanVal = String(valor).replace(',', '.');
        if (cleanVal !== '' && !/^\d*\.?\d*$/.test(cleanVal)) return;
        const availableMax = maxTipUsd > 0.001 ? maxTipUsd : cambioUSD;
        const amount = Math.min(Math.max(0, parseFloat(cleanVal) || 0), availableMax);
        setTipAmountUsd(cleanVal === '' ? '' : amount.toString());
        setIsTipDonated(amount > FINANCIAL_EPSILON.PAYMENT_ZERO);
        setIsChangeCredited(false);
    };

    // Campo que llenó la app con «lo que falta»: 'usd' | 'bs' | null, o 'off' si el cajero
    // eligió que el resto lo deje o vaya a la billetera (ya no se llena solo en este vuelto).
    // Mientras sea 'usd'/'bs', se recalcula al escribir en el otro; si el cajero lo toca, pasa a ser suyo.
    const [autoCampo, setAutoCampo] = useState(null);

    const handleVueltoDistChange = (moneda, valor) => {
        let cleanVal = valor.replace(',', '.');
        if (cleanVal !== '' && !/^\d*\.?\d*$/.test(cleanVal)) return;

        const valNum = parseFloat(cleanVal) || 0;
        const otra = moneda === 'usd' ? 'bs' : 'usd';
        const valorOtro = otra === 'usd' ? distVueltoUSD : distVueltoBS;
        // Si el otro campo es automático, el tope es todo el vuelto (el otro se ajusta solo).
        const otroAuto = autoCampo !== 'off' && otroEsAutomatico(valorOtro, autoCampo, otra);
        if (autoCampo === moneda) setAutoCampo(null); // lo tocó el cajero

        let valorFinal;
        if (moneda === 'usd') {
            const tope = otroAuto ? round2(changeToDeliverUsd) : maxVueltoUSD;
            const usdMax = round2(Math.min(valNum, tope));
            if (valNum > tope) {
                showToast(otroAuto
                    ? `El vuelto es $${tope.toFixed(2)}.`
                    : `Con el monto en Bs actual, solo quedan $${tope.toFixed(2)} para entregar en dólares.`, 'warning');
            }
            valorFinal = usdMax;
            setDistVueltoUSD(cleanVal === '' ? '' : usdMax.toString());
        } else {
            const tope = otroAuto ? round2(mulR(changeToDeliverUsd, tasaSegura)) : maxVueltoBS;
            const bsMax = round2(Math.min(valNum, tope));
            if (valNum > tope) {
                showToast(`El vuelto total en bolívares es Bs ${Math.round(tope).toLocaleString('es-VE')}`, 'warning');
            }
            valorFinal = bsMax;
            setDistVueltoBS(cleanVal === '' ? '' : bsMax.toString());
        }

        // CASO-056: el otro campo se llena solo con lo que falta, si no lo escribió el cajero.
        let otroUsd = otra === 'usd' ? Math.max(0, parseFloat(distVueltoUSD) || 0) : divR(Math.max(0, parseFloat(distVueltoBS) || 0), tasaSegura);
        if (otroAuto) {
            const resto = restoEnLaOtra(moneda, valorFinal, changeToDeliverUsd, tasaSegura);
            if (otra === 'usd') setDistVueltoUSD(resto); else setDistVueltoBS(resto);
            setAutoCampo(otra);
            otroUsd = otra === 'usd' ? (parseFloat(resto) || 0) : divR(parseFloat(resto) || 0, tasaSegura);
        }

        const propioUsd = moneda === 'usd' ? valorFinal : divR(valorFinal, tasaSegura);
        if (changeToDeliverUsd - sumR(propioUsd, otroUsd) <= 0.009) {
            setIsChangeCredited(false);
        }
    };

    // «⚡ Completar» de cada campo: pone lo que falta, contando lo que ya tiene el otro.
    const completarVuelto = (moneda) => {
        const otra = moneda === 'usd' ? 'bs' : 'usd';
        const valorOtro = otra === 'usd' ? distVueltoUSD : distVueltoBS;
        const resto = completarCampo(moneda, valorOtro, changeToDeliverUsd, tasaSegura);
        if (!resto) {
            showToast('El vuelto ya está repartido.', 'info');
            return;
        }
        if (moneda === 'usd') setDistVueltoUSD(resto); else setDistVueltoBS(resto);
        setAutoCampo(prev => (prev === 'off' ? 'off' : null)); // los dos quedan como los dejó el cajero
        setIsChangeCredited(false);
        triggerHaptic && triggerHaptic();
    };

    // «El resto lo deja» / «A su billetera» junto al campo que se llenó solo:
    // vacía ese campo, deja de llenarlo y manda el resto a caja (propina) o a la billetera.
    const usdDelCampoFijo = () => {
        if (autoCampo === 'usd') return divR(Math.max(0, parseFloat(distVueltoBS) || 0), tasaSegura);
        if (autoCampo === 'bs') return Math.max(0, parseFloat(distVueltoUSD) || 0);
        return declaredPhysicalWithoutTip;
    };
    const vaciarCampoAuto = () => {
        if (autoCampo === 'usd') setDistVueltoUSD('');
        else if (autoCampo === 'bs') setDistVueltoBS('');
        setAutoCampo('off');
    };
    const restoLoDeja = () => {
        const resto = round2(Math.max(0, subR(cambioUSD, usdDelCampoFijo())));
        if (resto <= FINANCIAL_EPSILON.PAYMENT_ZERO) return;
        if (resto > FINANCIAL_EPSILON.TIP_MAX_AUTO_USD && !tipConfirmPending) {
            setTipConfirmPending(true);
            showToast(`El cliente deja $${resto.toFixed(2)}. Pulsa de nuevo para confirmar.`, 'warning');
            return;
        }
        vaciarCampoAuto();
        setIsChangeCredited(false);
        setTipConfirmPending(false);
        setTipAmountUsd(resto.toFixed(2));
        setIsTipDonated(true);
        triggerHaptic && triggerHaptic();
    };
    const restoABilletera = () => {
        if (!clienteSeleccionado) {
            showToast('Elige un cliente para pasar el vuelto a su billetera', 'warning');
            abrirSelectorCliente();
            return;
        }
        vaciarCampoAuto();
        setIsTipDonated(false);
        setTipAmountUsd('');
        setIsChangeCredited(true);
        triggerHaptic && triggerHaptic();
    };

    const handleCreditChange = () => {
        if (!clienteSeleccionado) {
            showToast('Selecciona un cliente para abonar el vuelto a cuenta', 'warning');
            return;
        }
        if (walletRemainderUsd <= FINANCIAL_EPSILON.PAYMENT_ZERO) {
            showToast('No queda vuelto para acreditar: el resto ya está en caja o fue asignado como vuelto físico.', 'warning');
            return;
        }
        // El resto, después de lo dejado en caja y del desglose físico,
        // va a la billetera. Se conservan los campos físicos para permitir
        // combinaciones: caja + vuelto físico + saldo a favor.
        setIsChangeCredited(true);
    };

    // ── TIP-004 (D7): la moneda de la propina se deriva de la composición REAL
    // del efectivo en la gaveta, comparando magnitudes en una misma unidad (Bs).
    // No del orden de los métodos: $1 junto a Bs 5.000 no hace la propina "USD".
    // Solo cuenta EFECTIVO: un pago móvil no puede producir vuelto físico.
    // D8: no hay camino COP para la propina; el fallback es USD.
    const tipCurrency = useMemo(() => {
        const efectivoBs = metodosNormalizados
            .filter(m => m.tipo === 'BS' && String(m.id).startsWith('efectivo'))
            .reduce((s, m) => sumR(s, val(m.id)), 0);
        const efectivoUsdEnBs = mulR(
            metodosNormalizados
                .filter(m => m.tipo === 'DIVISA' && String(m.id).startsWith('efectivo'))
                .reduce((s, m) => sumR(s, val(m.id)), 0),
            tasaSegura
        );
        return efectivoBs > efectivoUsdEnBs ? 'BS' : 'USD';
    }, [metodosNormalizados, val, tasaSegura]);

    // ── TIP-002 (D6): propinas por encima del umbral exigen doble pulsación.
    const toggleTipDonated = () => {
        if (isTipDonated) {
            setIsTipDonated(false);
            setTipAmountUsd('');
            setTipConfirmPending(false);
            return;
        }
        // El monto a asignar a caja es el resto no distribuido físicamente
        const targetTip = maxTipUsd > 0.001 ? maxTipUsd : cambioUSD;

        if (targetTip > FINANCIAL_EPSILON.TIP_MAX_AUTO_USD && !tipConfirmPending) {
            setTipConfirmPending(true);
            showToast(
                `Propina de $${targetTip.toFixed(2)}. Pulsa de nuevo para confirmar.`,
                'warning'
            );
            return;
        }
        
        setIsChangeCredited(false);
        setTipConfirmPending(false);
        setTipAmountUsd(targetTip.toFixed(2));
        setIsTipDonated(true);
        triggerHaptic && triggerHaptic();
    };

    // Limpiar vuelto cuando baja
    useEffect(() => {
        if (cambioUSD <= 0) {
            setDistVueltoUSD('');
            setDistVueltoBS('');
            setTipAmountUsd('');
            setIsTipDonated(false);
            setShowMobileChangeDetails(false);
        }
    }, [cambioUSD]);

    // TIP-005 (T-5): apagar la propina si el vuelto desaparece. Sin esto el flag
    // sobrevive a una corrección del pago y la propina se re-arma sola cuando el
    // vuelto vuelve a subir, sin que el operador la reconfirme.
    useEffect(() => {
        if (cambioUSD <= FINANCIAL_EPSILON.PAYMENT_ZERO) {
            setIsTipDonated(false);
            setTipAmountUsd('');
            setTipConfirmPending(false);
        }
    }, [cambioUSD]);

    // Si el monto del vuelto cambia, caduca cualquier confirmación pendiente:
    // el operador debe volver a ver la cifra antes de donarla.
    useEffect(() => {
        setTipConfirmPending(false);
    }, [cambioUSD]);

    // Mantener una pestaña válida si la configuración no tiene USD.
    useEffect(() => {
        const available = [
            metodosDivisaNorm.length > 0 && 'USD',
            metodosBsNorm.length > 0 && 'BS',
            metodosCopNorm.length > 0 && 'COP',
        ].filter(Boolean);
        if (available.length > 0 && !available.includes(mobilePaymentCurrency)) {
            setMobilePaymentCurrency(available[0]);
        }
    }, [metodosDivisaNorm.length, metodosBsNorm.length, metodosCopNorm.length, mobilePaymentCurrency]);

    // ─── WALLET ─────────────────────────────────────────────
    const { proyeccion } = useClientWallet(
        clienteSeleccionado, customers, modo, cambioUSD,
        isChangeCredited, distVueltoUSD, distVueltoBS, tasaSegura, cashKeptUsd
    );

    // ── CASO-056: una sola opción de vuelto a la vez ─────────────────────────
    // «Todo en $», «Todo en Bs», «Lo deja» y «A su billetera» reparten TODO el
    // vuelto en un paso (antes «Todo en $» completaba solo el resto). «En $ y Bs»
    // limpia y deja los campos para repartir a mano. No cambia ninguna cuenta:
    // solo fija los mismos estados que ya usaban los botones anteriores.
    // COBRO fase 5: propuesta realista ($ en billetes + resto en Bs) con los ajustes de Caja & Vuelto.
    const sugerido = calcularSugerido({ cambioUsd: cambioUSD, tasa: tasaSegura, floatUsd: currentFloatUsd });

    const elegirVuelto = (opcion) => {
        const full = round2(cambioUSD);
        if (full <= FINANCIAL_EPSILON.PAYMENT_ZERO) return;
        const limpiar = () => {
            setAutoCampo(null);
            setDistVueltoUSD('');
            setDistVueltoBS('');
            setIsChangeCredited(false);
            setIsTipDonated(false);
            setTipAmountUsd('');
        };
        if (opcion === 'propina') {
            if (full > FINANCIAL_EPSILON.TIP_MAX_AUTO_USD && !tipConfirmPending) {
                setTipConfirmPending(true);
                showToast(`El cliente deja $${full.toFixed(2)}. Pulsa de nuevo para confirmar.`, 'warning');
                return;
            }
            limpiar();
            setTipConfirmPending(false);
            setTipAmountUsd(full.toFixed(2));
            setIsTipDonated(true);
            triggerHaptic && triggerHaptic();
            return;
        }
        if (opcion === 'sugerido') {
            if (!sugerido) return;
            limpiar();
            setTipConfirmPending(false);
            setDistVueltoUSD(String(sugerido.usdPart));
            setDistVueltoBS(String(sugerido.bsPart));
            if (sugerido.tipUsd > 0) { setTipAmountUsd(sugerido.tipUsd.toFixed(2)); setIsTipDonated(true); }
            triggerHaptic && triggerHaptic();
            return;
        }
        if (opcion === 'usd' && sugerido) {
            // Los dólares no tienen centavos: se avisa, pero no se bloquea (decisión del dueño).
            showToast('Los dólares no tienen centavos. Mejor usa «Sugerido»: billetes en $ y el resto en Bs.', 'info');
        }
        if (opcion === 'billetera' && !clienteSeleccionado) {
            showToast('Elige un cliente para pasar el vuelto a su billetera', 'warning');
            abrirSelectorCliente();
            return;
        }
        limpiar();
        setTipConfirmPending(false);
        if (opcion === 'usd') setDistVueltoUSD(full.toString());
        else if (opcion === 'bs') setDistVueltoBS(round2(mulR(full, tasaSegura)).toString());
        else if (opcion === 'billetera') setIsChangeCredited(true);
        triggerHaptic && triggerHaptic();
    };

    return {
        tipCurrency, proyeccion, handleVueltoDistChange, handleCreditChange, toggleTipDonated,
        handleTipAmountChange, maxTipUsd, elegirVuelto, completarVuelto,
        autoCampo, restoLoDeja, restoABilletera, sugerido
     };
}
