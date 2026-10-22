/**
 * inventoryValuation.js — Valorización canónica del inventario (BULTOS-001).
 *
 * Semántica canónica: `product.stock` está en UNIDADES canónicas (uds para
 * productos contables, kg/L para granel). En cambio `priceUsd`/`costUsd` vienen
 * POR BULTO en productos de bulto (packagingType 'lote' o unit 'paquete' con
 * unitsPerPackage > 1) y por unidad/kg en el resto (suelto, granel).
 *
 * Valorizar con `stock × precioDeBulto` sobrevalora el inventario ×uPP: el
 * mismo error de deducción que corrigió BULTOS-001, pero en la métrica de
 * "Valor Total Venta". Este módulo centraliza la conversión para que todas las
 * métricas (ProductContext, useDashboardMetrics, supervisorMetrics) valúen
 * igual: por unidad canónica.
 *
 * @module utils/inventoryValuation
 */

import { round2 } from './dinero.js';

/** Producto vendido en bultos (cajas/lotes) con factor entero > 1. */
export function isPackageProduct(product) {
    const uPP = Number(product?.unitsPerPackage);
    return (product?.packagingType === 'lote' || product?.unit === 'paquete')
        && Number.isFinite(uPP) && uPP > 1;
}

/** Unidades canónicas por bulto (1 si no es producto de bulto). */
export function packageFactor(product) {
    return isPackageProduct(product) ? Number(product.unitsPerPackage) : 1;
}

/**
 * Precio de venta por UNIDAD canónica.
 * - Venta por unidad con precio explícito → ese precio (ya es por unidad).
 * - Bulto → precioDeBulto / unitsPerPackage.
 * - Suelto/granel → su precio (ya es por unidad/kg).
 */
export function perUnitRetailUsd(product) {
    if (product?.sellByUnit && Number(product?.unitPriceUsd) > 0) return Number(product.unitPriceUsd);
    // FIN-030: priceUsdt (typo histórico) y priceUsd son alias del mismo valor.
    const price = Number(product?.priceUsd ?? product?.priceUsdt) || 0;
    return price / packageFactor(product);
}

/**
 * Costo por UNIDAD canónica. `costUsd` es por bulto en productos de bulto
 * (misma convención que usa FinancialEngine para el COGS de ventas por unidad).
 */
export function perUnitCostUsd(product) {
    const cost = Number(product?.costUsd) || 0;
    return cost / packageFactor(product);
}

/**
 * Valorización total del inventario en stock. Solo entra stock > 0 (la métrica
 * ignora agotados y stock negativo, como ya hacían ProductContext y
 * useDashboardMetrics).
 */
export function computeInventoryValuation(products = []) {
    let totalRetailUsd = 0;
    let totalCostUsd = 0;
    let totalUnits = 0;

    for (const p of Array.isArray(products) ? products : []) {
        const stockQty = Number(p?.stock ?? 0);
        if (!Number.isFinite(stockQty) || stockQty <= 0) continue;
        totalUnits += stockQty;
        totalRetailUsd += perUnitRetailUsd(p) * stockQty;
        totalCostUsd += perUnitCostUsd(p) * stockQty;
    }

    const retail = round2(totalRetailUsd);
    const cost = round2(totalCostUsd);
    const profit = round2(retail - cost);
    return {
        totalRetailUsd: retail,
        totalCostUsd: cost,
        totalProfitUsd: profit,
        marginPct: retail > 0 ? (profit / retail) * 100 : 0,
        markupPct: cost > 0 ? (profit / cost) * 100 : 0,
        totalUnits,
    };
}

export default {
    isPackageProduct,
    packageFactor,
    perUnitRetailUsd,
    perUnitCostUsd,
    computeInventoryValuation,
};
