// GRANEL-001 / GRANEL-DUAL: Módulo canónico de detección, unidades duales y guardarraíles para granel.
//
// REGLA DE ORO DEL SISTEMA:
//   - Almacenamiento, inventario y cálculos SIEMPRE canónicos en Kg / Litros (hasta 3 decimales).
//   - Unidades en UI configurables:
//       'kg_lt': Kilogramos y Litros (decimales estándar: 0.5 kg, 0.8 L).
//       'gr_ml': Gramos y Mililitros (enteros adaptados: 500 g, 800 ml).
//   - Guardarraíl anti-error en modo gramos: si se ingresa < 1 (ej: 0.5 o 0.8), se interpreta
//     automáticamente como 500 g y 800 g en lugar de fracción infinitesimal.
//   - Toda conversión gr -> kg o ml -> L se realiza antes del guardado / addToCart (qty = gramos / 1000).
//   - No granel (unidad, paquete, lote) -> estrictamente enteros.

import { round2, round3, round0 } from './dinero.js';
import { useState, useEffect, useCallback } from 'react';

export const GRANEL_STORAGE_KEY = 'granel_unit_mode';
export const GRANEL_MODE_KG_LT = 'kg_lt';
export const GRANEL_MODE_GR_ML = 'gr_ml';
/** Techo de cordura de pesaje en punto de venta (5,000 kg = 5 toneladas) para impedir desbordamientos o escaneos accidentales de códigos de barra. */
export const MAX_GRANEL_KG = 5000;

/** Unidades legacy que identifican un producto vendido por peso/volumen. */
const GRANEL_LEGACY_UNITS = ['kg', 'kgs', 'kilo', 'kilos', 'litro', 'litros', 'lt', 'lts', 'l', 'gr', 'grs', 'g', 'gramo', 'gramos', 'ml', 'mls'];
const GRANEL_LIQUID_UNITS = ['litro', 'litros', 'lt', 'lts', 'l', 'ml', 'mls'];

/**
 * Obtiene la preferencia de unidad de granel configurada ('kg_lt' | 'gr_ml').
 * Default: 'kg_lt'.
 */
export const getGranelUnitMode = () => {
    if (typeof localStorage === 'undefined') return GRANEL_MODE_KG_LT;
    try {
        const mode = localStorage.getItem(GRANEL_STORAGE_KEY);
        return mode === GRANEL_MODE_GR_ML ? GRANEL_MODE_GR_ML : GRANEL_MODE_KG_LT;
    } catch {
        return GRANEL_MODE_KG_LT;
    }
};

/**
 * Persiste la preferencia de unidad de granel y emite evento para reactividad inmediata.
 */
export const setGranelUnitMode = (mode) => {
    const safeMode = mode === GRANEL_MODE_GR_ML ? GRANEL_MODE_GR_ML : GRANEL_MODE_KG_LT;
    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem(GRANEL_STORAGE_KEY, safeMode);
        } catch {
            // Storage quota or security error fallback (modo incógnito estricto)
        }
    }
    if (typeof window !== 'undefined') {
        try {
            window.dispatchEvent(new CustomEvent('granel_unit_mode_changed', { detail: safeMode }));
        } catch {
            // Event dispatch fallback
        }
    }
    return safeMode;
};

/**
 * Hook reactivo para leer y actualizar la modalidad de granel sin recargar página.
 */
export function useGranelUnitMode() {
    const [mode, setMode] = useState(() => getGranelUnitMode());

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onCustom = (e) => {
            const next = e?.detail || getGranelUnitMode();
            setMode(next);
        };
        const onStorage = (e) => {
            if (e.key === GRANEL_STORAGE_KEY) {
                setMode(getGranelUnitMode());
            }
        };
        window.addEventListener('granel_unit_mode_changed', onCustom);
        window.addEventListener('storage', onStorage);
        return () => {
            window.removeEventListener('granel_unit_mode_changed', onCustom);
            window.removeEventListener('storage', onStorage);
        };
    }, []);

    const updateMode = useCallback((newMode) => {
        const persisted = setGranelUnitMode(newMode);
        setMode(persisted);
    }, []);

    return [mode, updateMode];
}

/**
 * Detector canónico de producto a granel.
 * Acepta el objeto producto (o un item de venta/cart con los campos mínimos).
 * @param {object|null} p
 * @returns {boolean}
 */
export const isGranelProduct = (p) => {
    if (!p) return false;
    if (typeof p === 'string') {
        return GRANEL_LEGACY_UNITS.includes(p.toLowerCase().trim());
    }
    const unit = String(p.unit || '').toLowerCase().trim();
    const pkgType = String(p.packagingType || '').toLowerCase().trim();
    if (pkgType === 'suelto' || pkgType === 'lote') {
        return false;
    }
    return (
        pkgType === 'granel' ||
        GRANEL_LEGACY_UNITS.includes(unit) ||
        Boolean(p.isWeight) ||
        Boolean(p.soldByWeight) ||
        Boolean(p.granelUnit)
    );
};

/**
 * Determina si el producto granel es líquido/volumen (litros/ml).
 * @param {object|string|null} p
 * @returns {boolean}
 */
export const isLiquidProduct = (p) => {
    if (!p) return false;
    const raw = typeof p === 'string'
        ? p
        : String(p.granelUnit || p.unit || '').toLowerCase().trim();
    return GRANEL_LIQUID_UNITS.includes(raw.toLowerCase().trim());
};

/**
 * Unidad de medida corta canónica ("kg", "L", "g", "ml" o "UND").
 * @param {object|string|null} p
 * @returns {string}
 */
export const granelUnitLabel = (p) => {
    if (!p) return 'UND';
    const raw = typeof p === 'string'
        ? p.toLowerCase().trim()
        : String(p.granelUnit || p.unit || '').toLowerCase().trim();
    if (['kg', 'kgs', 'kilo', 'kilos'].includes(raw)) return 'kg';
    if (['litro', 'litros', 'lt', 'lts', 'l'].includes(raw)) return 'L';
    if (['gr', 'grs', 'g', 'gramo', 'gramos'].includes(raw)) return 'g';
    if (['ml', 'mls'].includes(raw)) return 'ml';
    return 'UND';
};

/**
 * Unidad adaptada al modo activo ('kg_lt' vs 'gr_ml').
 * @param {object|string|null} p
 * @param {'kg_lt'|'gr_ml'} [mode]
 * @returns {string}
 */
export const getGranelUnitLabel = (p, mode = getGranelUnitMode()) => {
    const isLiquid = isLiquidProduct(p);
    if (mode === GRANEL_MODE_GR_ML) {
        return isLiquid ? 'ml' : 'g';
    }
    return isLiquid ? 'L' : 'kg';
};

/**
 * Título interactivo adaptado para el modal de pesaje.
 * @param {object|string|null} p
 * @param {'kg_lt'|'gr_ml'} [mode]
 * @returns {string}
 */
export const getGranelTitle = (p, mode = getGranelUnitMode()) => {
    const isLiquid = isLiquidProduct(p);
    if (mode === GRANEL_MODE_GR_ML) {
        return isLiquid ? '¿Cuántos mililitros?' : '¿Cuántos gramos?';
    }
    return isLiquid ? '¿Cuántos litros?' : '¿Cuántos kilos?';
};

/**
 * Opciones rápidas para el popup de pesaje según el modo activo.
 * @param {object|string|null} p
 * @param {'kg_lt'|'gr_ml'} [mode]
 * @returns {Array<{ label: string, displayQty: number, canonicalQty: number }>}
 */
export const getGranelQuickOptions = (p, mode = getGranelUnitMode()) => {
    const unit = getGranelUnitLabel(p, mode);
    if (mode === GRANEL_MODE_GR_ML) {
        return [
            { displayQty: 250, canonicalQty: 0.25, label: `250 ${unit}` },
            { displayQty: 500, canonicalQty: 0.5, label: `500 ${unit}` },
            { displayQty: 1000, canonicalQty: 1.0, label: `1000 ${unit}` },
            { displayQty: 2000, canonicalQty: 2.0, label: `2000 ${unit}` },
        ];
    }
    return [
        { displayQty: 0.25, canonicalQty: 0.25, label: `0.25 ${unit}` },
        { displayQty: 0.5, canonicalQty: 0.5, label: `0.5 ${unit}` },
        { displayQty: 1, canonicalQty: 1.0, label: `1 ${unit}` },
        { displayQty: 2, canonicalQty: 2.0, label: `2 ${unit}` },
    ];
};

/**
 * Paso de incremento/decremento (+ / -).
 * En gr_ml: 100 g/ml. En kg_lt: 0.1 kg/L.
 */
export const getGranelStep = (mode = getGranelUnitMode()) =>
    mode === GRANEL_MODE_GR_ML ? 100 : 0.1;

/**
 * Valor inicial por defecto para el input de pesaje.
 */
export const getGranelDefaultQty = (mode = getGranelUnitMode()) =>
    mode === GRANEL_MODE_GR_ML ? '1000' : '1.00';

// ─────────────────────────────────────────────────────────────
// CONVERSIONES BIDIRECCIONALES EXACTAS (Gramos ↔ Kg, Ml ↔ L)
// ─────────────────────────────────────────────────────────────

export const gramsToKg = (grams) => {
    const n = Number(grams);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return round3(n / 1000);
};

export const kgToGrams = (kg) => {
    const n = Number(kg);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return round0(round3(n) * 1000);
};

export const mlToLiters = (ml) => {
    const n = Number(ml);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return round3(n / 1000);
};

export const litersToMl = (liters) => {
    const n = Number(liters);
    if (!Number.isFinite(n) || n <= 0) return 0;
    return round0(round3(n) * 1000);
};

/**
 * PARSEO ADAPTATIVO CON GUARDARRAÍLES ANTI-CONFUSIÓN
 *
 * En modo gr_ml:
 *   - Entradas enteras (500, 1250) -> 500 g (0.5 kg), 1250 g (1.25 kg).
 *   - Guardarraíl anti-error: Si el usuario ingresa un decimal menor a 1
 *     (0.5, 0.8, 0.75, ,5), el sistema detecta la confusión del cajero y lo
 *     interpreta automáticamente como gramos enteros (500 g, 800 g, 750 g).
 * En modo kg_lt:
 *   - Decimal estándar (0.5 -> 0.5 kg, 1 -> 1.0 kg).
 *
 * @param {string|number} rawInput
 * @param {'kg_lt'|'gr_ml'} [mode]
 * @returns {{ displayQty: number, canonicalKg: number, grams: number }|null}
 */
export const parseWeightInput = (rawInput, mode = getGranelUnitMode()) => {
    if (rawInput === null || rawInput === undefined) return null;
    let cleaned = String(rawInput).trim().replace(/\s/g, '');
    if (cleaned === '') return null;

    // Detectar si el usuario incluyó una unidad explícita (ej: "500g", "0.5kg", "800ml", "1L", "2kgs", "500grs", "1k")
    const unitMatch = cleaned.match(/(kilos?|kgs?|k|gramos?|grs?|g|litros?|lts?|lt|l|mls?|ml)$/i);
    let explicitUnit = null;
    if (unitMatch) {
        explicitUnit = unitMatch[0].toLowerCase();
        cleaned = cleaned.slice(0, -unitMatch[0].length);
    }

    cleaned = cleaned.replace(/,/g, '.');
    if (cleaned === '') return null;
    if (cleaned.startsWith('.')) cleaned = '0' + cleaned;
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n <= 0) return null;

    // Si el usuario especificó explícitamente la unidad, respetamos su intención
    const isExplicitGrams = explicitUnit && /^(gramos?|grs?|g|mls?|ml)$/i.test(explicitUnit);
    const isExplicitKg = explicitUnit && /^(kilos?|kgs?|k|litros?|lts?|lt|l)$/i.test(explicitUnit);

    const effectiveMode = isExplicitGrams
        ? GRANEL_MODE_GR_ML
        : isExplicitKg
            ? GRANEL_MODE_KG_LT
            : mode;

    if (effectiveMode === GRANEL_MODE_GR_ML) {
        let grams;
        if (n < 1 && !isExplicitGrams) {
            // Guardarraíl: decimal menor a 1 ingresado en modo gramos
            // ej: 0.5 -> 500g, 0.8 -> 800g, 0.75 -> 750g, 0.125 -> 125g
            grams = round3(n * 1000);
        } else {
            grams = round3(n);
        }
        const canonicalKg = round3(grams / 1000);
        if (canonicalKg <= 0 || canonicalKg > MAX_GRANEL_KG || grams <= 0) return null;
        return {
            grams,
            canonicalKg,
            displayQty: grams,
        };
    } else {
        const canonicalKg = round3(n);
        const grams = round3(n * 1000);
        if (canonicalKg <= 0 || canonicalKg > MAX_GRANEL_KG || grams <= 0) return null;
        return {
            grams,
            canonicalKg,
            displayQty: canonicalKg,
        };
    }
};

/**
 * Convierte un input de pesaje directamente a su valor canónico en Kg/L
 * aplicando los guardarraíles correspondientes al modo.
 * @param {string|number} rawInput
 * @param {'kg_lt'|'gr_ml'} [mode]
 * @returns {number|null}
 */
export const parseWeightToCanonical = (rawInput, mode = getGranelUnitMode()) => {
    const res = parseWeightInput(rawInput, mode);
    return res ? res.canonicalKg : null;
};

/**
 * Formatea una cantidad canónica en Kg/L para visualización en cesta, tickets y modales.
 * @param {number} canonicalQty - Cantidad canónica en kg o L
 * @param {object|string|null} productOrUnit
 * @param {'kg_lt'|'gr_ml'} [mode]
 * @returns {string} Ej: "500 g", "750 ml", "0.500 kg" o "0.5 kg"
 */
export const formatGranelDisplay = (canonicalQty, productOrUnit, mode = getGranelUnitMode()) => {
    const isLiquid = isLiquidProduct(productOrUnit);
    const unit = isLiquid ? (mode === GRANEL_MODE_GR_ML ? 'ml' : 'L') : (mode === GRANEL_MODE_GR_ML ? 'g' : 'kg');
    const n = Number(canonicalQty);
    if (!Number.isFinite(n) || n <= 0) return `0 ${unit}`;

    if (mode === GRANEL_MODE_GR_ML) {
        const inGrams = round3(n * 1000);
        return `${formatStockDisplay(inGrams, false)} ${unit}`;
    }

    const inKg = normalizeStockValue(n, true);
    return `${formatStockDisplay(inKg, true)} ${unit}`;
};

/**
 * Canonical sale-item quantity for receipts, histories and reports. New sales
 * carry the product unit metadata; legacy `isWeight` snapshots retain the old
 * kg label rather than guessing whether the missing unit was liquid.
 * @param {object} item
 * @param {'kg_lt'|'gr_ml'} [mode]
 */
export const formatSaleItemQuantity = (item, mode = getGranelUnitMode()) => {
    if (!item) return '0 u';
    const knownUnit = item.granelUnit || item.unit;
    if (isGranelProduct(item) && knownUnit && isGranelProduct(knownUnit)) {
        return formatGranelDisplay(item.qty, item, mode);
    }
    if (item.isWeight || item.soldByWeight || isGranelProduct(item)) {
        return `${formatStockDisplay(item.qty, true)} kg`;
    }
    return `${item.qty ?? 0} u`;
};

/**
 * Formats a canonical threshold as a numeric input value in the selected
 * display mode. Stock alert thresholds remain canonical kg/L in storage.
 */
export const formatGranelInputValue = (canonicalQty, mode = getGranelUnitMode()) => {
    const n = Number(canonicalQty);
    if (!Number.isFinite(n) || n <= 0) return '0';
    if (mode === GRANEL_MODE_GR_ML) return String(round0(round3(n) * 1000));
    return formatStockDisplay(n, true);
};

/** Format a product's canonical low-stock alert threshold for the current UI. */
export const formatLowStockAlert = (product, mode = getGranelUnitMode()) => {
    if (isGranelProduct(product)) {
        return `${formatGranelDisplay(product.lowStockAlert ?? 5, product, mode)} mín.`;
    }
    return `${product?.lowStockAlert ?? 5} uds mín.`;
};

/** True when stock and its low-stock threshold share canonical kg/L units. */
export const isLowStockProduct = (product) => {
    const stock = Number(product?.stock ?? 0);
    const threshold = Number(product?.lowStockAlert ?? 5);
    return stock >= 0 && stock <= threshold;
};

/** Parse a visible g/ml or kg/L threshold into the canonical kg/L scale. */
export const parseGranelThreshold = (rawValue, mode = getGranelUnitMode()) => {
    if (rawValue === null || rawValue === undefined || String(rawValue).trim() === '') return null;
    if (mode === GRANEL_MODE_GR_ML) {
        const raw = Number(String(rawValue).trim().replace(/,/g, '.'));
        if (!Number.isFinite(raw) || raw < 0) return null;
        return round3(raw / 1000);
    }
    return parseStockInput(rawValue, true);
};

/** Converts a canonical kg/L threshold to g/ml display units. */
export const canonicalThresholdForMode = (canonicalQty, mode = getGranelUnitMode()) =>
    mode === GRANEL_MODE_GR_ML
        ? round0(round3(Number(canonicalQty) || 0) * 1000)
        : normalizeStockValue(canonicalQty, true);

/** Converts a g/ml threshold to canonical kg/L. */
export const visibleThresholdToCanonical = (rawValue, mode = getGranelUnitMode()) =>
    parseGranelThreshold(rawValue, mode);

// Keep standalone threshold helpers above the stock parser declaration usable
// after module evaluation; function invocation happens only after initialization.
export const formatSaleQuantity = formatSaleItemQuantity;


/**
 * Extrae y parsea códigos de barra EAN-13 de balanza electrónica (prefijo 21).
 * Formato estándar: 21 + 5 dígitos PLU + 5 dígitos peso en gramos + 1 dígito checksum.
 * @param {string} barcode
 * @returns {{ pluCode: string, weightKg: number, grams: number }|null}
 */
export const parseEan13ScaleBarcode = (barcode) => {
    if (!barcode) return null;
    const str = String(barcode).trim();
    if (!str.startsWith('21') || str.length < 13 || !/^\d{13,}$/.test(str)) return null;

    const pluCode = parseInt(str.substring(2, 7), 10).toString();
    const grams = parseInt(str.substring(7, 12), 10);
    if (!Number.isFinite(grams) || grams <= 0) return null;

    const weightKg = round3(grams / 1000);
    if (weightKg <= 0 || weightKg > MAX_GRANEL_KG) return null;

    return {
        pluCode,
        grams,
        weightKg,
    };
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
    const cleaned = String(raw).trim().replace(/\s/g, '').replace(/,/g, '.');
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
    const cleaned = String(raw).trim().replace(/\s/g, '').replace(/,/g, '.');
    if (cleaned === '') return null;
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (!isGranel && !Number.isInteger(n)) return null;
    if (isGranel && n > MAX_GRANEL_KG) return null;
    return normalizeStockValue(n, isGranel);
};

/**
 * Normaliza cantidades que ya vienen dentro del estado persistido (por ejemplo,
 * una cesta antigua). A diferencia de parseCartQuantity, corrige legacy decimals
 * no-granel a entero para impedir que sobrevivan en el estado.
 * @param {string|number} raw
 * @param {object|boolean} productOrIsGranel
 * @returns {number}
 */
export const normalizeCartQuantity = (raw, productOrIsGranel) => {
    const isGranel = typeof productOrIsGranel === 'boolean'
        ? productOrIsGranel
        : isGranelProduct(productOrIsGranel);
    const cleaned = String(raw ?? '').trim().replace(/\s/g, '').replace(/,/g, '.');
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n <= 0) return 0;
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
    // eslint-disable-next-line no-restricted-syntax -- Formateo de stock de producto (no dinero)
    return String(Number(v.toFixed(3)));
};

// ─────────────────────────────────────────────────────────────
// GRANEL-MONEY: venta a granel "por monto" ("dame 3$ de queso",
// "dame 5000 Bs de jabón"). Convierte un monto en moneda a la
// cantidad (kg/L) equivalente según el precio por unidad del
// producto y la tasa de cambio vigente.
// ─────────────────────────────────────────────────────────────

/**
 * Parsea un monto ingresado por el usuario (admite coma decimal y espacios).
 * Devuelve null si no hay número válido o no es positivo.
 * @param {string|number} raw
 * @returns {number|null}
 */
export const parseMoneyAmount = (raw) => {
    if (raw === null || raw === undefined) return null;
    const cleaned = String(raw).trim().replace(/\s/g, '').replace(/,/g, '.');
    if (cleaned === '') return null;
    const n = Number(cleaned);
    if (!Number.isFinite(n) || n <= 0) return null;
    return n;
};

/**
 * Convierte un monto en Bs a USD usando la tasa (round2 canónico).
 * @param {number} amountBs
 * @param {number} rate
 * @returns {number}
 */
export const bsToUsd = (amountBs, rate) =>
    round2((Number(amountBs) || 0) / (Number(rate) || 0));

/**
 * Convierte un monto ($ o Bs) en la CANTIDAD a granel equivalente, aplicando
 * el guardarraíl canónico de 3 decimales.
 *
 *   cantidad = montoUsd / precioPorUnidadUsd  → round3
 *
 * @param {number} amount   Monto en USD (si currency='usd') o Bs (si 'bs')
 * @param {string} currency 'usd' | 'bs'
 * @param {number} unitPriceUsd  Precio por kg/lt en USD
 * @param {number} effectiveRate Tasa Bs/USD vigente
 * @returns {number|null} Cantidad en kg/L lista para addToCart, o null si:
 *   - moneda 'bs' sin tasa válida (>0),
 *   - precio unitario inválido (<= 0),
 *   - la cantidad resultante redondea a 0 (monto insuficiente).
 */
export const qtyFromMoneyAmount = (amount, currency, unitPriceUsd, effectiveRate) => {
    const price = Number(unitPriceUsd);
    if (!Number.isFinite(price) || price <= 0) return null;

    let amountUsd;
    if (currency === 'bs') {
        const rate = Number(effectiveRate);
        if (!Number.isFinite(rate) || rate <= 0) return null;
        amountUsd = bsToUsd(amount, rate);
    } else {
        amountUsd = Number(amount);
    }
    if (!Number.isFinite(amountUsd) || amountUsd <= 0) return null;

    const qty = normalizeStockValue(amountUsd / price, true);
    return qty > 0 ? qty : null;
};

// ── BULTOS-001: deducción canónica por modo de venta ─────────────────────────
// Centraliza la fórmula correcta para checkoutProcessor, voidSaleProcessor y
// los guards de SalesView.
// Granel → qty directo (decimal, 3 dec.)
// Unidad suelta → qty directo (1 ud = 1 del stock canónico)
// Bulto/Lote → qty × unitsPerPackage (1 bulto = N unidades del stock)
// Suelto/unidad con unitsPerPackage configurado → qty (NO multiplicar: su qty
// ya está en unidades; unitsPerPackage solo sirve para ajustes por bulto en
// StockBatchModal — ver productProcessor.js)
export function calculateItemStockDeduction(item) {
    // Granel: usa la cantidad directa en kg/L
    if (isGranelProduct(item)) return item.qty;

    // Modo 'unit': una unidad suelta equivale a 1 unidad en stock canónico
    if (item._mode === 'unit') return item.qty;

    // Solo los productos de bulto descuentan qty × uds por bulto.
    const isBulto = item.packagingType === 'lote' || item.unit === 'paquete';
    if (!isBulto) return item.qty;

    const uPP = item._unitsPerPackage || item.unitsPerPackage || 1;
    return item.qty * uPP;
}
