/**
 * fondoGaveta.js — Efectivo que hay en la gaveta en este momento (CAJA-FONDO-001).
 *
 * Lo usa el cobro para avisar si alcanza el efectivo para el vuelto. Antes el
 * cobro hacía su propia cuenta: filtraba por la fecha del calendario (después
 * de medianoche "olvidaba" el fondo de la apertura) y no restaba los vueltos ya
 * entregados (creía que había más dinero del real). Ahora usa la misma regla y
 * la misma fórmula que el "Efectivo esperado" del Inicio y el cierre.
 *
 * @module utils/fondoGaveta
 */

import { FinancialEngine } from '../core/FinancialEngine.js';
import { findOpenCashShift, isShiftCashMovement } from './cashShift.js';
import { calcularEfectivoEsperado } from './cajaEsperada.js';
import { getLocalISODate } from './dateHelpers.js';
import { round2 } from './dinero.js';

/**
 * @param {Array} records - Todos los movimientos guardados (bodega_sales_v1).
 * @param {string} [today] - Fecha local YYYY-MM-DD (para el caso sin apertura).
 * @returns {{ usd: number, bs: number, cop: number }}
 */
export function calcularFondoEnGaveta(records = [], today = getLocalISODate()) {
    const list = Array.isArray(records) ? records : [];
    const opening = findOpenCashShift(list);
    const movements = list.filter(record => isShiftCashMovement(record, opening, today));
    const breakdown = FinancialEngine.calculatePaymentBreakdown(movements);
    const { expectedUsd, expectedBs, expectedCop } = calcularEfectivoEsperado(breakdown);
    return { usd: expectedUsd, bs: expectedBs, cop: expectedCop };
}

/**
 * ¿Alcanza el efectivo de la gaveta para el vuelto que se va a entregar?
 * (CAJA-FONDO-002). Tolerancias iguales a los avisos anteriores: $0,05 y Bs 1.
 *
 * Si el fondo es desconocido (null/undefined, p. ej. venta remota del supervisor,
 * donde la gaveta está en otro equipo) no se avisa nada.
 *
 * @returns {{ evaluado: boolean, alcanza: boolean, faltaUsd: number, faltaBs: number,
 *            pideUsd: number, pideBs: number, hayUsd: number, hayBs: number }}
 */
export function evaluarFondoParaVuelto({ usdGiven, bsGiven, floatUsd, floatBs } = {}) {
    const pideUsd = Math.max(0, Number(usdGiven) || 0);
    const pideBs = Math.max(0, Number(bsGiven) || 0);
    const conoceUsd = floatUsd !== null && floatUsd !== undefined && Number.isFinite(Number(floatUsd));
    const conoceBs = floatBs !== null && floatBs !== undefined && Number.isFinite(Number(floatBs));
    const hayUsd = conoceUsd ? Math.max(0, Number(floatUsd)) : 0;
    const hayBs = conoceBs ? Math.max(0, Number(floatBs)) : 0;
    const faltaUsd = conoceUsd && pideUsd > hayUsd + 0.05 ? round2(pideUsd - hayUsd) : 0;
    const faltaBs = conoceBs && pideBs > hayBs + 1 ? round2(pideBs - hayBs) : 0;
    return {
        evaluado: conoceUsd || conoceBs,
        alcanza: faltaUsd === 0 && faltaBs === 0,
        faltaUsd, faltaBs, pideUsd, pideBs, hayUsd, hayBs,
    };
}
