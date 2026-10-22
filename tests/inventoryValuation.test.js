// BULTOS-001: semántica canónica de `product.stock` en UNIDADES para la
// valorización del inventario y los umbrales de stock bajo.
// Antes ProductContext/useDashboardMetrics/supervisorMetrics multiplicaban
// `stock × precioDeBulto`, sobrevaluando el inventario ×uPP en productos de
// bulto, y cada vista miraba un campo de umbral distinto (minStock vs
// lowStockAlert) para las alertas.
import { describe, it, expect } from 'vitest';
import {
    isPackageProduct,
    packageFactor,
    perUnitRetailUsd,
    perUnitCostUsd,
    computeInventoryValuation,
} from '../src/utils/inventoryValuation';
import { lowStockThreshold, isLowStockProduct } from '../src/utils/granel';
import { calculateInventoryMetrics } from '../src/services/supervisorMetrics';

// Bulto clásico: 24 uds por caja, precio/costo POR CAJA, stock en unidades.
const bulto = {
    id: 'p-bulto',
    name: 'Café molido',
    packagingType: 'lote',
    unit: 'paquete',
    unitsPerPackage: 24,
    stock: 48, // = 2 cajas
    priceUsd: 24,
    priceUsdt: 24,
    costUsd: 20,
    sellByUnit: false,
};

const bultoPorUnidad = {
    ...bulto,
    id: 'p-bulto-ud',
    sellByUnit: true,
    unitPriceUsd: 1.5,
};

// Suelto: conserva unitsPerPackage para ajustes por bulto en StockBatchModal,
// pero su precio/costo/stock son por unidad → NO se divide.
const suelto = {
    id: 'p-suelto',
    name: 'Golosina suelta',
    packagingType: 'suelto',
    unit: 'unidad',
    unitsPerPackage: 24,
    stock: 10,
    priceUsd: 3,
    costUsd: 1,
};

const granel = {
    id: 'p-granel',
    name: 'Arroz a granel',
    packagingType: 'granel',
    unit: 'kg',
    unitsPerPackage: 1,
    stock: 2.5,
    priceUsd: 4,
    costUsd: 2,
};

describe('isPackageProduct / packageFactor', () => {
    it('d1: lote con uPP > 1 es producto de bulto con ese factor', () => {
        expect(isPackageProduct(bulto)).toBe(true);
        expect(packageFactor(bulto)).toBe(24);
    });

    it('d2: suelto con uPP conservado NO es de bulto (factor 1)', () => {
        expect(isPackageProduct(suelto)).toBe(false);
        expect(packageFactor(suelto)).toBe(1);
    });

    it('d3: granel y paquetes de factor 1 quedan en factor 1', () => {
        expect(isPackageProduct(granel)).toBe(false);
        expect(packageFactor(granel)).toBe(1);
        expect(packageFactor({ ...bulto, unitsPerPackage: 1 })).toBe(1);
    });
});

describe('perUnitRetailUsd / perUnitCostUsd', () => {
    it('d4: bulto → precio y costo se dividen por uPP', () => {
        expect(perUnitRetailUsd(bulto)).toBe(1);
        expect(perUnitCostUsd(bulto)).toBeCloseTo(20 / 24, 10);
    });

    it('d5: venta por unidad usa unitPriceUsd explícito', () => {
        expect(perUnitRetailUsd(bultoPorUnidad)).toBe(1.5);
    });

    it('d6: suelto y granel valúan por unidad/kg sin dividir', () => {
        expect(perUnitRetailUsd(suelto)).toBe(3);
        expect(perUnitCostUsd(suelto)).toBe(1);
        expect(perUnitRetailUsd(granel)).toBe(4);
    });
});

describe('computeInventoryValuation', () => {
    it('d7: 2 cajas (48 uds × $24/caja) valúan $48, no $1152', () => {
        const v = computeInventoryValuation([bulto]);
        expect(v.totalRetailUsd).toBe(48);
        expect(v.totalCostUsd).toBe(40);
        expect(v.totalProfitUsd).toBe(8);
        expect(v.marginPct).toBeCloseTo((8 / 48) * 100, 6);
        expect(v.markupPct).toBeCloseTo(20, 6);
        expect(v.totalUnits).toBe(48);
    });

    it('d8: ignora stock 0 y negativo, suma el resto', () => {
        const v = computeInventoryValuation([
            bulto,
            { ...suelto, stock: 0 },
            { ...granel, stock: -3 },
            granel,
        ]);
        expect(v.totalRetailUsd).toBe(48 + 10);
        expect(v.totalUnits).toBe(48 + 2.5);
    });

    it('d9: catálogo vacío o inválido no rompe', () => {
        expect(computeInventoryValuation([]).totalRetailUsd).toBe(0);
        expect(computeInventoryValuation(undefined).totalCostUsd).toBe(0);
        expect(computeInventoryValuation([null, {}]).totalUnits).toBe(0);
    });
});

describe('calculateInventoryMetrics (supervisor) usa la valorización canónica', () => {
    it('d10: totalRetail $48 para 2 cajas, no $1152', () => {
        const m = calculateInventoryMetrics([bulto]);
        expect(m.totalRetail).toBe(48);
        expect(m.totalCost).toBe(40);
        expect(m.expectedProfit).toBe(8);
        expect(m.totalQty).toBe(48);
        expect(m.count).toBe(1);
    });
});

describe('lowStockThreshold / isLowStockProduct', () => {
    it('d11: lowStockAlert manda; minStock legado es respaldo; 5 por defecto', () => {
        expect(lowStockThreshold({ lowStockAlert: 3, minStock: 8 })).toBe(3);
        expect(lowStockThreshold({ minStock: 8 })).toBe(8);
        expect(lowStockThreshold({ lowStockAlert: '', minStock: 8 })).toBe(8);
        expect(lowStockThreshold({})).toBe(5);
        expect(lowStockThreshold({ lowStockAlert: 'x', minStock: '' })).toBe(5);
    });

    it('d12: la alerta compara en las mismas unidades canónicas que stock', () => {
        expect(isLowStockProduct({ stock: 2, lowStockAlert: 3 })).toBe(true);
        expect(isLowStockProduct({ stock: 4, lowStockAlert: 3 })).toBe(false);
        expect(isLowStockProduct({ stock: 7, minStock: 8 })).toBe(true);
        // stock 0 cuenta como bajo (agotado también es crítico); negativo no.
        expect(isLowStockProduct({ stock: 0, lowStockAlert: 5 })).toBe(true);
        expect(isLowStockProduct({ stock: -1, lowStockAlert: 5 })).toBe(false);
    });
});
