// Configuración fiscal (IVA). Fase 1 del plan 2026-10-13-iva-configurable-plan.md.
//
// - IVA general editable desde Ajustes; 16% de fábrica.
// - Cada producto puede tener `ivaRate` propio: undefined/null = usar la general, 0 = exento.
// - `ivaEnabled` arranca en false: no cambia ningún total hasta que el dueño lo active.

const TAX_CONFIG_KEY = 'tax_config_v1';

export const IVA_FACTORY_RATE = 16;

export const DEFAULT_TAX_CONFIG = Object.freeze({
    ivaEnabled: false,
    ivaRate: IVA_FACTORY_RATE,
});

/** Devuelve un número válido entre 0 y 100, o null si la entrada no es válida. */
export function normalizeIvaRate(value) {
    if (value === '' || value === null || value === undefined) return null;
    const n = typeof value === 'number' ? value : Number(String(value).replace(',', '.').trim());
    if (!Number.isFinite(n) || n < 0 || n > 100) return null;
    return Math.round(n * 100) / 100;
}

/** Normaliza una configuración cruda (de localStorage o de entrada) a una válida. */
export function sanitizeTaxConfig(raw) {
    const rate = normalizeIvaRate(raw?.ivaRate);
    return {
        ivaEnabled: raw?.ivaEnabled === true,
        ivaRate: rate ?? IVA_FACTORY_RATE,
    };
}

/**
 * Tasa efectiva de una línea del carrito.
 * Prioridad: ivaRate del producto (si está definido) > tasa general.
 * Devuelve 0 si el IVA está desactivado.
 */
export function resolveLineIvaRate(item, config = DEFAULT_TAX_CONFIG) {
    const cfg = sanitizeTaxConfig(config);
    if (!cfg.ivaEnabled) return 0;
    const productRate = normalizeIvaRate(item?.ivaRate);
    if (item?.ivaRate !== undefined && item?.ivaRate !== null && item?.ivaRate !== '' && productRate !== null) {
        return productRate;
    }
    return cfg.ivaRate;
}

/** Lee la configuración guardada. Si no existe o está corrupta, devuelve los valores de fábrica. */
export function loadTaxConfig() {
    try {
        const raw = localStorage.getItem(TAX_CONFIG_KEY);
        if (!raw) return { ...DEFAULT_TAX_CONFIG };
        return sanitizeTaxConfig(JSON.parse(raw));
    } catch {
        return { ...DEFAULT_TAX_CONFIG };
    }
}

/**
 * Opciones IVA listas para pasar a FinancialEngine.buildCartTotals.
 * Usar siempre esta función para que cesta, cobro, saldo y guardado usen la misma regla.
 */
export function getCartIvaOpts() {
    const taxConfig = loadTaxConfig();
    return {
        enabled: taxConfig.ivaEnabled,
        resolveRate: (item) => resolveLineIvaRate(item, taxConfig),
    };
}

/** Guarda la configuración (saneada). Devuelve la versión guardada. */
export function saveTaxConfig(config) {
    const clean = sanitizeTaxConfig(config);
    localStorage.setItem(TAX_CONFIG_KEY, JSON.stringify(clean));
    return clean;
}

/** Restaura los valores de fábrica (16%, IVA desactivado). */
export function resetTaxConfig() {
    return saveTaxConfig(DEFAULT_TAX_CONFIG);
}
