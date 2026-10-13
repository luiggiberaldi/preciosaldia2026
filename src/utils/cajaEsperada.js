/**
 * cajaEsperada.js — Efectivo esperado en caja (USD / Bs / COP).
 *
 * Fuente única de la fórmula usada por el cierre de caja (CierreCajaWizard) y
 * por la tarjeta del dashboard visible solo para admin. Así ambos muestran el
 * mismo número.
 *
 * Función pura: no lee storage ni el DOM.
 *
 * @module utils/cajaEsperada
 */

import { round2 } from './dinero';

/**
 * @param {Object} paymentBreakdown - Salida de FinancialEngine.calculatePaymentBreakdown.
 * @returns {{ expectedUsd: number, expectedBs: number, expectedCop: number }}
 */
export function calcularEfectivoEsperado(paymentBreakdown = {}) {
    const expectedUsd = round2((paymentBreakdown['efectivo_usd']?.total || 0) - (paymentBreakdown['_vuelto_usd']?.total || 0));
    const expectedBs = round2((paymentBreakdown['efectivo_bs']?.total || 0) - (paymentBreakdown['_vuelto_bs']?.total || 0));
    const expectedCop = round2(paymentBreakdown['efectivo_cop']?.total || 0);
    return { expectedUsd, expectedBs, expectedCop };
}
