// COBRO fase 4 — Reparto del vuelto «En $ y Bs» (CASO-056, 2026-11-13): el otro campo se llena solo con lo que falta.
// Funciones puras para poder probarlas sin pantalla. Solo deciden qué número va en cada campo;
// las cuentas del vuelto (caja, billetera, propina) siguen en useCheckoutPosAmounts.
import { round2, divR, mulR, subR } from '../../../../utils/dinero';
import { computeRealisticSplit } from '../../../../utils/changeSplit';

const num = (v) => Math.max(0, parseFloat(v) || 0);

/** Lo que falta entregar en la otra moneda, como texto para el campo ('' si no falta nada). */
export function restoEnLaOtra(moneda, valorEscrito, changeToDeliverUsd, tasa) {
    const t = tasa > 0 ? tasa : 1;
    const usadoUsd = moneda === 'usd' ? num(valorEscrito) : divR(num(valorEscrito), t);
    const restoUsd = round2(Math.max(0, subR(changeToDeliverUsd, usadoUsd)));
    if (restoUsd <= 0.001) return '';
    return moneda === 'usd' ? round2(mulR(restoUsd, t)).toString() : restoUsd.toString();
}

/** Lo que falta para completar `moneda`, contando lo que ya tiene el otro campo. */
export function completarCampo(moneda, valorOtro, changeToDeliverUsd, tasa) {
    const otra = moneda === 'usd' ? 'bs' : 'usd';
    return restoEnLaOtra(otra, valorOtro, changeToDeliverUsd, tasa);
}

/** ¿El otro campo se puede llenar solo? Sí si está vacío/en 0 o si lo llenó la app. */
export function otroEsAutomatico(valorOtro, autoCampo, otra) {
    return autoCampo === otra || num(valorOtro) === 0;
}

/**
 * COBRO fase 5 — Preferencias de «Ajustes → Caja & Vuelto» (billete más pequeño y redondeo en Bs).
 * Mismos valores y mismas protecciones que el cobro de celular (CheckoutModal.jsx).
 */
export function leerPrefsVuelto(storage = globalThis.localStorage) {
    const get = (k) => { try { return storage?.getItem(k); } catch { return null; } };
    const bill = parseFloat(get('checkout_smallest_usd_bill'));
    const step = parseFloat(get('checkout_bs_round_step'));
    return {
        smallestUsdBill: Number.isFinite(bill) && bill > 0 ? bill : 1,
        bsRoundStep: Number.isFinite(step) && step >= 0 ? step : 0,
        bsRoundMode: get('checkout_bs_round_mode') === 'floor' ? 'floor' : 'ceil',
    };
}

/**
 * Vuelto «Sugerido»: dólares en billetes enteros + el resto en Bs (los dólares no tienen centavos).
 * - «A favor del cliente» (ceil): el Bs sale exacto. Dar de más no se puede anotar en la venta
 *   (el procesador topa el vuelto al real), así que no se redondea hacia arriba en el cobro de PC.
 * - «A favor de la tienda» (floor): se redondea hacia abajo y la diferencia queda en caja (tipUsd).
 * Devuelve null si no hay nada que sugerir (vuelto entero, o sin parte en $ o sin parte en Bs).
 */
export function calcularSugerido({ cambioUsd, tasa, floatUsd = null, prefs = leerPrefsVuelto() }) {
    const total = round2(Math.max(0, Number(cambioUsd) || 0));
    if (total <= 0.009 || !(Number(tasa) > 0)) return null;
    const cash = floatUsd !== null && floatUsd !== undefined && Number(floatUsd) > 0 ? Number(floatUsd) : Infinity;
    const floor = prefs.bsRoundMode === 'floor';
    const split = computeRealisticSplit({
        changeUsd: total,
        rate: tasa,
        smallestUsdBill: prefs.smallestUsdBill,
        bsRoundStep: floor ? prefs.bsRoundStep : 0,
        bsRoundMode: floor ? 'floor' : 'ceil',
        floatUsd: cash,
    });
    if (!(split.usdPart > 0) || !(split.bsPart > 0)) return null;
    const tipUsd = split.remainderUsd > 0.009 ? round2(split.remainderUsd) : 0;
    return { usdPart: split.usdPart, bsPart: split.bsPart, tipUsd };
}
