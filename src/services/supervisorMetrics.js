import { round2 } from '../utils/dinero.js';
import { isLowStockProduct } from '../utils/granel.js';
import {
    calculateSupervisorSalesMetrics,
    normalizeProduct,
} from './supervisorFinancials.js';

export function calculateInventoryMetrics(products = []) {
    const list = (Array.isArray(products) ? products : []).map(normalizeProduct);
    let totalCost = 0;
    let totalRetail = 0;
    let totalQty = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;

    for (const product of list) {
        totalCost += product.costUsd * product.stock;
        totalRetail += product.priceUsd * product.stock;
        totalQty += product.stock;

        if (product.stock <= 0) outOfStockCount += 1;
        else if (isLowStockProduct(product)) lowStockCount += 1;
    }

    return {
        totalCost: round2(totalCost),
        totalRetail: round2(totalRetail),
        totalQty,
        lowStockCount,
        outOfStockCount,
        expectedProfit: round2(Math.max(0, totalRetail - totalCost)),
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
