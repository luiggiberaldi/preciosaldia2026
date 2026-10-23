const formatDecimal = (value, maximumFractionDigits) => new Intl.NumberFormat('en-US', {
    maximumFractionDigits,
    useGrouping: false,
}).format(value);

export function costFactorFromMarginPercent(value) {
    if (value === null || value === undefined || String(value).trim() === '') return '';
    const marginPercent = Number(value);
    if (!Number.isFinite(marginPercent)) return '';
    return formatDecimal(1 - marginPercent / 100, 3);
}

export function formatCostFactorAsMarginPercent(costFactor) {
    const factor = Number(costFactor);
    if (!costFactor || !Number.isFinite(factor) || factor <= 0) return '';
    return formatDecimal((1 - factor) * 100, 1);
}

/**
 * Margen de ganancia sobre el PRECIO DE VENTA: (precio - costo) / precio * 100.
 * Es el criterio único del sistema (formulario, dashboard, toolbar e inventario):
 * costo $0.60 con precio $1.00 = 40% de margen (y no el +67% de markup sobre costo).
 * Devuelve null cuando faltan precio o costo (la insignia se oculta).
 */
export function marginOverPricePercent(priceUsd, costUsd) {
    const price = Number(priceUsd);
    const cost = Number(costUsd);
    if (!(price > 0) || !(cost > 0)) return null;
    return ((price - cost) / price) * 100;
}

export const COST_FACTOR_MODE_KEY = 'cost_factor_mode';
export const COST_FACTOR_MODE_PERCENT = 'percent';
export const COST_FACTOR_MODE_FACTOR = 'factor';

/**
 * Preferencia del toggle Factor costo. De fábrica: '%' (margen).
 */
export function getCostFactorMode() {
    if (typeof localStorage === 'undefined') return COST_FACTOR_MODE_PERCENT;
    try {
        return localStorage.getItem(COST_FACTOR_MODE_KEY) === COST_FACTOR_MODE_FACTOR
            ? COST_FACTOR_MODE_FACTOR
            : COST_FACTOR_MODE_PERCENT;
    } catch {
        return COST_FACTOR_MODE_PERCENT;
    }
}

/**
 * Persiste la preferencia del toggle Factor costo ('percent' | 'factor').
 */
export function setCostFactorMode(mode) {
    const safeMode = mode === COST_FACTOR_MODE_FACTOR ? COST_FACTOR_MODE_FACTOR : COST_FACTOR_MODE_PERCENT;
    if (typeof localStorage !== 'undefined') {
        try {
            localStorage.setItem(COST_FACTOR_MODE_KEY, safeMode);
        } catch {
            // Storage quota o modo incógnito estricto: la preferencia vive solo en esta sesión.
        }
    }
    return safeMode;
}
