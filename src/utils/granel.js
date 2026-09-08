// GRANEL-001: Módulo canónico de detección y guardarraíles para productos a granel.
//
// REGLA DE ORO DEL SISTEMA:
//   - Productos a GRANEL (kg, litro, gr, g, ml, soldByWeight…) → stock con hasta 3 decimales.
//   - TODO lo demás (unidad, paquete/bulto, lote, suelto) → stock ESTRICTAMENTE entero.
//
// Toda lectura, parseo, redondeo y formateo de cantidades de stock DEBE pasar por
// este módulo. Nunca usar Math.round / parseInt / parseFloat directos sobre stock.

import { round3, round0 } from './dinero.js';

/** Unidades legacy que identifican un producto vendido por peso/volumen. */
const GRANEL_LEGACY_UNITS = ['kg', 'litro', 'gr', 'g', 'ml', 'l'];

/**
 * Detector canónico de producto a granel.
 * Acepta el objeto producto (o un item de venta/cart con los campos mínimos).
 * @param {object|null} p
 * @returns {boolean}
 */
export const isGranelProduct = (p) => {
    if (!p) return false;
    const unit = String(p.unit || '').toLowerCase().trim();
    const pkgType = String(p.packagingType || '').toLowerCase().trim();
    return (
        pkgType === 'granel' ||
        GRANEL_LEGACY_UNITS.includes(unit) ||
        Boolean(p.isWeight) ||
        Boolean(p.soldByWeight) ||
        Boolean(p.granelUnit)
    );
};

/**
 * Unidad de medida corta para mostrar en UI ("kg", "L", "g", "ml" o "UND").
 * @param {object|null} p
 * @returns {string}
 */
export const granelUnitLabel = (p) => {
    if (!p) return 'UND';
    const raw = String(p.granelUnit || p.unit || '').toLowerCase().trim();
    if (raw === 'kg') return 'kg';
    if (raw === 'litro' || raw === 'l') return 'L';
    if (raw === 'gr' || raw === 'g') return 'g';
    if (raw === 'ml') return 'ml';
    return 'UND';
};

/**
 * Guardarraíl de tipado de stock:
 *  - Granel → redondeo a 3 decimales (round-half-away-from-zero vía dinero.js).
 *  - No granel → entero estricto.
 * @param {number} value
 * @param {boolean} isGranel
 * @returns {number}
 */
export const normalizeStockValue = (value, isGranel) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    return isGranel ? round3(n) : round0(n);
};

/**
 * Parsea un input de usuario (admite coma decimal "55,5" y espacios) aplicando el
 * guardarraíl de tipado. Devuelve null si no hay número válido.
 * @param {string|number} raw
 * @param {boolean} isGranel
 * @returns {number|null}
 */
export const parseStockInput = (raw, isGranel) => {
    if (raw === null || raw === undefined) return null;
    const cleaned = String(raw).trim().replace(/\s/g, '').replace(',', '.');
    if (cleaned === '') return null;
    const n = Number(cleaned);
    if (!Number.isFinite(n)) return null;
    return normalizeStockValue(n, isGranel);
};

/**
 * Parsea una cantidad de cesta aplicando una política más estricta que el stock:
 * las líneas no-granel no aceptan fracciones; no se redondean silenciosamente.
 * @param {string|number} raw
 * @param {boolean} isGranel
 * @returns {number|null}
 */
export const parseCartQuantity = (raw, isGranel) => {
    if (raw === null || raw === undefined) return null;
    const cleaned = String(raw).trim().replace(/\s/g, '').replace(',', '.');
    if (cleaned === '') return null;
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (!isGranel && !Number.isInteger(n)) return null;
    return normalizeStockValue(n, isGranel);
};

/**
 * Ajuste de stock sin drift IEEE-754: stock + delta con redondeo canónico.
 * @param {number} stock
 * @param {number} delta
 * @param {boolean} isGranel
 * @returns {number}
 */
export const adjustStockValue = (stock, delta, isGranel) =>
    normalizeStockValue((Number(stock) || 0) + (Number(delta) || 0), isGranel);

/**
 * Formateo limpio para UI: hasta 3 decimales para granel SIN ceros de más ni
 * artefactos flotantes (55.300000000000004 → "55.3"); enteros sin decimales.
 * @param {number} value
 * @param {boolean} isGranel
 * @returns {string}
 */
export const formatStockDisplay = (value, isGranel) => {
    const v = normalizeStockValue(value, isGranel);
    if (!isGranel) return String(v);
    return String(Number(v.toFixed(3)));
};
