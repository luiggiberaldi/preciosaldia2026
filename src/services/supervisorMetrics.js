import { round2 } from '../utils/dinero.js';
import { isLowStockProduct } from '../utils/granel.js';
import { computeInventoryValuation } from '../utils/inventoryValuation.js'; // BULTOS-001
import {
    calculateSupervisorSalesMetrics,
    normalizeProduct,
} from './supervisorFinancials.js';

export function calculateInventoryMetrics(products = []) {
    const list = (Array.isArray(products) ? products : []).map(normalizeProduct);
    // BULTOS-001: valorización canónica compartida — stock en unidades, precio y
    // costo por bulto se dividen por unitsPerPackage (utils/inventoryValuation).
    // Antes se multiplicaba `stock × precioDeBulto`, sobrevaluando ×uPP.
    const { totalCostUsd, totalRetailUsd } = computeInventoryValuation(list);
    let totalQty = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    for (const product of list) {
        totalQty += product.stock;

        if (product.stock <= 0) outOfStockCount += 1;
        else if (isLowStockProduct(product)) lowStockCount += 1;
    }

    return {
        totalCost: round2(totalCostUsd),
        totalRetail: round2(totalRetailUsd),
        totalQty,
        lowStockCount,
        outOfStockCount,
        expectedProfit: round2(Math.max(0, totalRetailUsd - totalCostUsd)),
        count: list.length,
    };
}

export function calculateSalesProfit(sales = [], products = [], bcvRate = 1) {
    return calculateSupervisorSalesMetrics(sales, products, bcvRate);
}

export function calculateInventoryMovementMetrics(sales = []) {
    const movements = (Array.isArray(sales) ? sales : [])
        .filter(record => record?.tipo === 'AJUSTE_ENTRADA' || record?.tipo === 'AJUSTE_SALIDA' || record?.direction === 'ingreso' || record?.direction === 'egreso')
        .sort((left, right) => new Date(right.timestamp || 0) - new Date(left.timestamp || 0));
    const income = movements.filter(record => record.tipo === 'AJUSTE_ENTRADA' || record.direction === 'ingreso');
    const egress = movements.filter(record => record.tipo === 'AJUSTE_SALIDA' || record.direction === 'egreso');
    const units = record => Number(record.unitsDelta ?? record.quantityInput ?? 0) || 0;

    return {
        total: movements.length,
        incomeCount: income.length,
        egressCount: egress.length,
        incomeUnits: income.reduce((sum, record) => sum + units(record), 0),
        egressUnits: egress.reduce((sum, record) => sum + units(record), 0),
        recent: movements.slice(0, 8),
    };
}

export default {
    calculateInventoryMetrics,
    calculateSalesProfit,
    calculateInventoryMovementMetrics,
};
