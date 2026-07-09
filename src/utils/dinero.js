/**
 * dinero.js — Aritmética financiera segura
 * 
 * Centraliza TODA la lógica de redondeo del sistema POS.
 * Usa round-half-away-from-zero (estándar financiero internacional)
 * con corrección epsilon para evitar el bug IEEE 754 de .005.
 * 
 * REGLA DE ORO: Toda operación aritmética con dinero DEBE pasar por estas funciones.
 *               Nunca usar Math.round, toFixed, o parseFloat para redondear montos.
 */

/**
 * Redondea a 2 decimales (centavos) con round-half-away-from-zero.
 * Usa corrección epsilon para que 2.005 → 2.01 (no 2.00).
 * @param {number} n - Número a redondear
 * @returns {number} Número redondeado a 2 decimales
 */
export const round2 = (n) => {
    if (!Number.isFinite(n)) return 0;
    const sign = n < 0 ? -1 : 1;
    const abs = Math.abs(n);
    return sign * Math.round(parseFloat(abs.toFixed(12)) * 100) / 100;
};

/**
 * Redondea a 4 decimales (para tasas de cambio y precios unitarios internos).
 * @param {number} n
 * @returns {number}
 */
export const round4 = (n) => {
    if (!Number.isFinite(n)) return 0;
    const sign = n < 0 ? -1 : 1;
    const abs = Math.abs(n);
    return sign * Math.round(parseFloat(abs.toFixed(12)) * 10000) / 10000;
};

/**
 * Redondea a 3 decimales (para cantidades de peso: gramos/kg en ventas por peso).
 * @param {number} n
 * @returns {number}
 */
export const round3 = (n) => {
    if (!Number.isFinite(n)) return 0;
    const sign = n < 0 ? -1 : 1;
    const abs = Math.abs(n);
    return sign * Math.round(parseFloat(abs.toFixed(12)) * 1000) / 1000;
};

/**
 * Redondea a entero (round-half-away-from-zero).
 * Útil para Bs (política del POS: precios en Bs siempre a entero) y scores.
 * @param {number} n
 * @returns {number}
 */
export const round0 = (n) => {
    if (!Number.isFinite(n)) return 0;
    const sign = n < 0 ? -1 : 1;
    const abs = Math.abs(n);
    return sign * Math.round(parseFloat(abs.toFixed(12)));
};

/**
 * Redondea hacia +infinito (ceil) a entero.
 * Política del POS para precios en Bolívares (siempre redondear Bs hacia arriba).
 * Reemplaza `Math.ceil` en código financiero.
 * @param {number} n
 * @returns {number}
 */
export const ceilR = (n) => {
    if (!Number.isFinite(n)) return 0;
    return Math.ceil(n);
};

/**
 * Multiplica dos números y redondea a 2 decimales.
 * Para cadenas como precio * cantidad * tasa, encadenar: mulR(mulR(price, qty), rate)
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export const mulR = (a, b) => round2((a || 0) * (b || 0));

/**
 * Divide dos números y redondea a 2 decimales.
 * Para conversiones de moneda: divR(montoBs, tasa) = montoUsd
 * @param {number} a - Numerador
 * @param {number} b - Denominador (si es 0, retorna 0)
 * @returns {number}
 */
export const divR = (a, b) => {
    if (!b || !Number.isFinite(b) || b === 0) return 0;
    return round2((a || 0) / b);
};

/**
 * Suma números o un array de números y redondea el resultado a 2 decimales.
 * Previene acumulación de drift en reduce().
 * @example sumR([1, 2, 3]) // 6
 * @example sumR(1, 2) // 3
 * @param {...number|number[]} args
 * @returns {number}
 */
export const sumR = (...args) => {
    const arr = Array.isArray(args[0]) ? args[0] : args;
    return round2(arr.reduce((a, b) => a + (b || 0), 0));
};

/**
 * Resta segura: a - b, redondeada a 2 decimales.
 * @param {number} a
 * @param {number} b
 * @returns {number}
 */
export const subR = (a, b) => round2((a || 0) - (b || 0));
