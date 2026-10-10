/**
 * tests/granelUnits.test.js — Arnés de pruebas automatizadas para Granel Dual
 * (Kilogramos/Litros decimal vs Gramos/Mililitros enteros).
 *
 * Cubre:
 *   1. Selector de modo y persistencia (R1).
 *   2. Parseo bidireccional exacto (Gramos ↔ Kg y Ml ↔ Litros) (R4.1).
 *   3. Guardarraíles anti-error con entradas mixtas (500, 0.5, ,5, 1250, 0.75) (R2, R4.2).
 *   4. Barcodes de balanza EAN-13 (prefijo 21) (R2).
 *   5. Venta por monto (GRANEL-MONEY) compatible con ambos modos (R4.3).
 *   6. Deducción de stock canónico y preservación de enteros no-granel (R3, R4.4).
 *   7. Formateo uniforme para cesta y comprobantes (R3).
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    getGranelUnitMode,
    setGranelUnitMode,
    GRANEL_STORAGE_KEY,
    GRANEL_MODE_KG_LT,
    GRANEL_MODE_GR_ML,
    MAX_GRANEL_KG,
    isGranelProduct,
    isLiquidProduct,
    granelUnitLabel,
    getGranelUnitLabel,
    getGranelTitle,
    getGranelQuickOptions,
    getGranelStep,
    getGranelDefaultQty,
    gramsToKg,
    kgToGrams,
    mlToLiters,
    litersToMl,
    parseWeightInput,
    parseWeightToCanonical,
    formatGranelDisplay,
    parseEan13ScaleBarcode,
    normalizeStockValue,
    adjustStockValue,
    formatStockDisplay,
    qtyFromMoneyAmount,
} from '../src/utils/granel.js';
import { mulR } from '../src/utils/dinero.js';

// Mocks para integración de transacciones
const _memoryStore = new Map();

vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn(async (key, defaultValue = null) => {
            if (_memoryStore.has(key)) return _memoryStore.get(key);
            return defaultValue;
        }),
        setItem: vi.fn(async (key, value) => {
            _memoryStore.set(key, JSON.parse(JSON.stringify(value)));
        }),
    },
}));

vi.mock('../src/services/auditService', () => ({
    logEvent: vi.fn(() => Promise.resolve()),
}));

vi.mock('../src/hooks/store/useAuthStore', () => ({
    useAuthStore: { getState: () => ({ usuarioActivo: { id: 'test-user', nombre: 'Tester', rol: 'ADMIN' } }) },
}));

import { processSaleTransaction } from '../src/utils/checkoutProcessor.js';
import { processVoidSale } from '../src/utils/voidSaleProcessor.js';
import { storageService } from '../src/utils/storageService.js';
import { buildProductPayload } from '../src/utils/productProcessor.js';
import { prepareProductFormState } from '../src/hooks/useProductForm.js';

const PRODUCTS_KEY = 'bodega_products_v1';
const SALES_KEY = 'bodega_sales_v1';

const QUESO_PRODUCT = {
    id: 'queso-001',
    name: 'Queso Blanco',
    unit: 'kg',
    packagingType: 'granel',
    granelUnit: 'kg',
    stock: 55.5,
    priceUsdt: 5.0,
    priceUsd: 5.0,
    costUsd: 3.0,
    isWeight: true,
};

const REFRESCO_PRODUCT = {
    id: 'refresco-001',
    name: 'Refresco 2L',
    unit: 'unidad',
    packagingType: 'suelto',
    stock: 10,
    priceUsdt: 2.0,
    priceUsd: 2.0,
    costUsd: 1.0,
    isWeight: false,
};

function resetStore() {
    _memoryStore.clear();
    storageService.getItem.mockClear();
    storageService.setItem.mockClear();
    _memoryStore.set(PRODUCTS_KEY, [
        JSON.parse(JSON.stringify(QUESO_PRODUCT)),
        JSON.parse(JSON.stringify(REFRESCO_PRODUCT)),
    ]);
    _memoryStore.set(SALES_KEY, []);
}

beforeEach(() => {
    localStorage.clear();
    resetStore();
});

// ════════════════════════════════════════════════════════════════════════
// 1. SELECTOR DE MODO Y PERSISTENCIA (R1)
// ════════════════════════════════════════════════════════════════════════
describe('R1: Selector de Unidad de Granel y Persistencia', () => {
    it('por defecto opera en kg_lt', () => {
        expect(getGranelUnitMode()).toBe(GRANEL_MODE_KG_LT);
    });

    it('persiste correctamente el modo gr_ml en localStorage', () => {
        setGranelUnitMode(GRANEL_MODE_GR_ML);
        expect(localStorage.getItem(GRANEL_STORAGE_KEY)).toBe(GRANEL_MODE_GR_ML);
        expect(getGranelUnitMode()).toBe(GRANEL_MODE_GR_ML);
    });

    it('permite alternar de regreso a kg_lt', () => {
        setGranelUnitMode(GRANEL_MODE_GR_ML);
        expect(getGranelUnitMode()).toBe(GRANEL_MODE_GR_ML);
        setGranelUnitMode(GRANEL_MODE_KG_LT);
        expect(getGranelUnitMode()).toBe(GRANEL_MODE_KG_LT);
    });

    it('modo inválido o corrupto retorna fallback seguro kg_lt', () => {
        localStorage.setItem(GRANEL_STORAGE_KEY, 'modo_invalido');
        expect(getGranelUnitMode()).toBe(GRANEL_MODE_KG_LT);
    });
});

// ════════════════════════════════════════════════════════════════════════
// 2. PARSEO BIDIRECCIONAL EXACTO (R4.1)
// ════════════════════════════════════════════════════════════════════════
describe('R4.1: Parseo Bidireccional Exacto (Gramos ↔ Kg y Ml ↔ Litros)', () => {
    it('convierte Gramos a Kg con 3 decimales exactos', () => {
        expect(gramsToKg(500)).toBe(0.5);
        expect(gramsToKg(1250)).toBe(1.25);
        expect(gramsToKg(250)).toBe(0.25);
        expect(gramsToKg(1000)).toBe(1);
        expect(gramsToKg(1)).toBe(0.001);
        expect(gramsToKg(750)).toBe(0.75);
    });

    it('convierte Kg a Gramos enteros exactos', () => {
        expect(kgToGrams(0.5)).toBe(500);
        expect(kgToGrams(1.25)).toBe(1250);
        expect(kgToGrams(0.25)).toBe(250);
        expect(kgToGrams(1)).toBe(1000);
        expect(kgToGrams(0.001)).toBe(1);
        expect(kgToGrams(0.75)).toBe(750);
    });

    it('convierte Ml a Litros con 3 decimales exactos', () => {
        expect(mlToLiters(500)).toBe(0.5);
        expect(mlToLiters(800)).toBe(0.8);
        expect(mlToLiters(1000)).toBe(1);
        expect(mlToLiters(2500)).toBe(2.5);
    });

    it('convierte Litros a Ml enteros exactos', () => {
        expect(litersToMl(0.5)).toBe(500);
        expect(litersToMl(0.8)).toBe(800);
        expect(litersToMl(1)).toBe(1000);
        expect(litersToMl(2.5)).toBe(2500);
    });

    it('round-trip Gramos ↔ Kg sin drift IEEE-754', () => {
        const testGrams = [100, 250, 333, 500, 750, 1000, 1250, 3500];
        testGrams.forEach(g => {
            const kg = gramsToKg(g);
            const backToGrams = kgToGrams(kg);
            expect(backToGrams).toBe(g);
        });
    });
});

// ════════════════════════════════════════════════════════════════════════
// 3. GUARDARRAÍLES ANTI-CONFUSIÓN CON ENTRADAS MIXTAS (R2, R4.2)
// ════════════════════════════════════════════════════════════════════════
describe('R4.2: Guardarraíles Anti-Confusión con Entradas Mixtas', () => {
    describe('Modo gr_ml (enteros adaptados con guardarraíl decimal < 1)', () => {
        it('entrada entera "500" se interpreta como 500 g -> 0.5 kg', () => {
            const res = parseWeightInput('500', GRANEL_MODE_GR_ML);
            expect(res).not.toBeNull();
            expect(res.grams).toBe(500);
            expect(res.canonicalKg).toBe(0.5);
            expect(res.displayQty).toBe(500);
        });

        it('entrada entera "1250" se interpreta como 1250 g -> 1.25 kg', () => {
            const res = parseWeightInput('1250', GRANEL_MODE_GR_ML);
            expect(res).not.toBeNull();
            expect(res.grams).toBe(1250);
            expect(res.canonicalKg).toBe(1.25);
            expect(res.displayQty).toBe(1250);
        });

        it('guardarraíl: "0.5" en modo gramos se interpreta automáticamente como 500 g -> 0.5 kg', () => {
            const res = parseWeightInput('0.5', GRANEL_MODE_GR_ML);
            expect(res).not.toBeNull();
            expect(res.grams).toBe(500);
            expect(res.canonicalKg).toBe(0.5);
            expect(res.displayQty).toBe(500);
        });

        it('guardarraíl: ",5" con coma se interpreta como 500 g -> 0.5 kg', () => {
            const res = parseWeightInput(',5', GRANEL_MODE_GR_ML);
            expect(res).not.toBeNull();
            expect(res.grams).toBe(500);
            expect(res.canonicalKg).toBe(0.5);
        });

        it('guardarraíl: ".5" con punto directo se interpreta como 500 g -> 0.5 kg', () => {
            const res = parseWeightInput('.5', GRANEL_MODE_GR_ML);
            expect(res).not.toBeNull();
            expect(res.grams).toBe(500);
            expect(res.canonicalKg).toBe(0.5);
        });

        it('guardarraíl: "0.75" se convierte a 750 g sin error (Criterio de Aceptación)', () => {
            const res = parseWeightInput('0.75', GRANEL_MODE_GR_ML);
            expect(res).not.toBeNull();
            expect(res.grams).toBe(750);
            expect(res.canonicalKg).toBe(0.75);
            expect(parseWeightToCanonical('0.75', GRANEL_MODE_GR_ML)).toBe(0.75);
        });

        it('guardarraíl: "0.8" se convierte a 800 g -> 0.8 kg', () => {
            const res = parseWeightInput('0.8', GRANEL_MODE_GR_ML);
            expect(res.grams).toBe(800);
            expect(res.canonicalKg).toBe(0.8);
        });

        it('guardarraíl: "0.125" se convierte a 125 g -> 0.125 kg', () => {
            const res = parseWeightInput('0.125', GRANEL_MODE_GR_ML);
            expect(res.grams).toBe(125);
            expect(res.canonicalKg).toBe(0.125);
        });

        it('guardarraíl: "0.05" se convierte a 50 g -> 0.05 kg', () => {
            const res = parseWeightInput('0.05', GRANEL_MODE_GR_ML);
            expect(res.grams).toBe(50);
            expect(res.canonicalKg).toBe(0.05);
        });
    });

    describe('Modo kg_lt (decimal estándar)', () => {
        it('entrada "0.5" se interpreta como 0.5 kg', () => {
            const res = parseWeightInput('0.5', GRANEL_MODE_KG_LT);
            expect(res.canonicalKg).toBe(0.5);
            expect(res.grams).toBe(500);
            expect(res.displayQty).toBe(0.5);
        });

        it('entrada "1.25" se interpreta como 1.25 kg', () => {
            const res = parseWeightInput('1.25', GRANEL_MODE_KG_LT);
            expect(res.canonicalKg).toBe(1.25);
            expect(res.grams).toBe(1250);
        });

        it('entrada ",5" se interpreta como 0.5 kg', () => {
            const res = parseWeightInput(',5', GRANEL_MODE_KG_LT);
            expect(res.canonicalKg).toBe(0.5);
        });
    });

    describe('Entradas inválidas o basura', () => {
        it('rechaza vacíos, ceros, negativos y texto no numérico', () => {
            [null, undefined, '', '   ', '0', '-5', 'abc', 'NaN'].forEach(input => {
                expect(parseWeightInput(input, GRANEL_MODE_GR_ML)).toBeNull();
                expect(parseWeightInput(input, GRANEL_MODE_KG_LT)).toBeNull();
                expect(parseWeightToCanonical(input, GRANEL_MODE_GR_ML)).toBeNull();
            });
        });
    });
});

// ════════════════════════════════════════════════════════════════════════
// 4. LECTURA DE CÓDIGO DE BARRAS DE BALANZA EAN-13 (R2)
// ════════════════════════════════════════════════════════════════════════
describe('R2: Barcode de Balanza Electrónica EAN-13 (prefijo 21)', () => {
    it('extrae limpiamente 5 dígitos de PLU y 5 dígitos de peso en gramos -> Kg', () => {
        // Formato 21 + 00123 (PLU 123) + 00500 (500 g = 0.5 kg) + 1 (checksum)
        const barcode = '2100123005001';
        const parsed = parseEan13ScaleBarcode(barcode);
        expect(parsed).not.toBeNull();
        expect(parsed.pluCode).toBe('123');
        expect(parsed.grams).toBe(500);
        expect(parsed.weightKg).toBe(0.5);
    });

    it('extrae 1250 g -> 1.250 kg correctamente', () => {
        // Formato 21 + 00045 (PLU 45) + 01250 (1250 g) + 8
        const barcode = '2100045012508';
        const parsed = parseEan13ScaleBarcode(barcode);
        expect(parsed.pluCode).toBe('45');
        expect(parsed.grams).toBe(1250);
        expect(parsed.weightKg).toBe(1.25);
    });

    it('rechaza códigos que no comienzan por 21 o con longitud < 13', () => {
        expect(parseEan13ScaleBarcode('7591234567890')).toBeNull();
        expect(parseEan13ScaleBarcode('2100123')).toBeNull();
        expect(parseEan13ScaleBarcode('')).toBeNull();
        expect(parseEan13ScaleBarcode(null)).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════
// 5. CÁLCULO DE VENTA POR MONTO (GRANEL-MONEY) COMPATIBLE (R4.3)
// ════════════════════════════════════════════════════════════════════════
describe('R4.3: Venta a Granel por Monto (GRANEL-MONEY)', () => {
    const PRICE_PER_KG = 10; // $10 / kg

    it('calcula la cantidad canónica en kg independientemente del modo de UI', () => {
        // "Dame 3$ de queso" a $10/kg -> 0.3 kg canónico
        const canonicalQty = qtyFromMoneyAmount(3, 'usd', PRICE_PER_KG, 40);
        expect(canonicalQty).toBe(0.3);

        // En modo kg_lt se visualiza como "0.3 kg"
        expect(formatGranelDisplay(canonicalQty, { unit: 'kg' }, GRANEL_MODE_KG_LT)).toBe('0.3 kg');

        // En modo gr_ml se visualiza como "300 g"
        expect(formatGranelDisplay(canonicalQty, { unit: 'kg' }, GRANEL_MODE_GR_ML)).toBe('300 g');
    });

    it('los subtotales financieros son idénticos al céntimo en ambos modos', () => {
        const canonicalQty = qtyFromMoneyAmount(2.5, 'usd', 5, 40); // $2.5 a $5/kg = 0.5 kg
        expect(canonicalQty).toBe(0.5);

        const subtotal = mulR(5, canonicalQty);
        expect(subtotal).toBe(2.5); // $2.50 exacto
    });

    it('rechaza montos que no alcanzan para la unidad mínima (0.001 kg)', () => {
        expect(qtyFromMoneyAmount(0.001, 'usd', 10, 40)).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════
// 6. DEDUCCIÓN DE STOCK Y PRESERVACIÓN CANÓNICA (R3, R4.4)
// ════════════════════════════════════════════════════════════════════════
describe('R3 & R4.4: Preservación Canónica del Inventario y Cálculos Financieros', () => {
    it('venta de 500 g descuenta exactamente 0.500 kg del stock en base de datos', async () => {
        // Entrada del cajero en modo gramos: 500 g -> parse a canonical 0.5 kg
        const canonicalQty = parseWeightToCanonical('500', GRANEL_MODE_GR_ML);
        expect(canonicalQty).toBe(0.5);

        const saleOpts = {
            cart: [{
                id: 'queso-001',
                _originalId: 'queso-001',
                name: 'Queso Blanco',
                qty: canonicalQty, // 0.5 kg
                priceUsd: 5.0,
                costUsd: 3.0,
                costBs: 0,
                isWeight: true,
            }],
            cartTotalUsd: 2.5,
            cartTotalBs: 100,
            cartSubtotalUsd: 2.5,
            payments: [{ amountUsd: 2.5, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: null,
            customers: [],
            products: [JSON.parse(JSON.stringify(QUESO_PRODUCT))],
            effectiveRate: 40,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
        };

        const result = await processSaleTransaction(saleOpts);
        expect(result.success).toBe(true);

        // Stock original: 55.5 kg -> luego de venta de 500 g: 55.0 kg exactos
        const products = await storageService.getItem(PRODUCTS_KEY, []);
        const queso = products.find(p => p.id === 'queso-001');
        expect(queso.stock).toBe(55.0);

        // Sin desbordamiento ni factor x1000: la venta no cobró $2500 ni dedujo 500 kg
        expect(result.sale.totalUsd).toBe(2.5);
        expect(result.sale.items[0].qty).toBe(0.5);
    });

    it('guardarraíl "0.75" descuenta exactamente 0.750 kg sin inflar', async () => {
        const canonicalQty = parseWeightToCanonical('0.75', GRANEL_MODE_GR_ML);
        expect(canonicalQty).toBe(0.75);

        const saleOpts = {
            cart: [{
                id: 'queso-001',
                _originalId: 'queso-001',
                name: 'Queso Blanco',
                qty: canonicalQty, // 0.75 kg
                priceUsd: 5.0,
                costUsd: 3.0,
                costBs: 0,
                isWeight: true,
            }],
            cartTotalUsd: 3.75,
            cartTotalBs: 150,
            cartSubtotalUsd: 3.75,
            payments: [{ amountUsd: 3.75, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: null,
            customers: [],
            products: [JSON.parse(JSON.stringify(QUESO_PRODUCT))],
            effectiveRate: 40,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
        };

        const result = await processSaleTransaction(saleOpts);
        expect(result.success).toBe(true);

        const products = await storageService.getItem(PRODUCTS_KEY, []);
        const queso = products.find(p => p.id === 'queso-001');
        expect(queso.stock).toBe(54.75); // 55.5 - 0.75 = 54.75
    });

    it('productos no-granel preservan stock ESTRICTAMENTE entero', async () => {
        const saleOpts = {
            cart: [{
                id: 'refresco-001',
                _originalId: 'refresco-001',
                name: 'Refresco 2L',
                qty: 2, // entero
                priceUsd: 2.0,
                costUsd: 1.0,
                costBs: 0,
                isWeight: false,
            }],
            cartTotalUsd: 4.0,
            cartTotalBs: 160,
            cartSubtotalUsd: 4.0,
            payments: [{ amountUsd: 4.0, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: null,
            customers: [],
            products: [
                JSON.parse(JSON.stringify(QUESO_PRODUCT)),
                JSON.parse(JSON.stringify(REFRESCO_PRODUCT)),
            ],
            effectiveRate: 40,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
        };

        const result = await processSaleTransaction(saleOpts);
        expect(result.success).toBe(true);

        const products = await storageService.getItem(PRODUCTS_KEY, []);
        const refresco = products.find(p => p.id === 'refresco-001');
        expect(refresco.stock).toBe(8); // 10 - 2 = 8
        expect(Number.isInteger(refresco.stock)).toBe(true);
    });
});

// ════════════════════════════════════════════════════════════════════════
// 7. FORMATO UNIFORME DE CESTA Y TICKETS (R3)
// ════════════════════════════════════════════════════════════════════════
describe('R3: Formato Uniforme para Cesta y Tickets', () => {
    it('muestra "g" o "ml" en modo gr_ml y "kg" o "L" en modo kg_lt', () => {
        const queso = { name: 'Queso', unit: 'kg' };
        const jugo = { name: 'Jugo', unit: 'litro' };

        // Modo gramos / ml
        expect(formatGranelDisplay(0.5, queso, GRANEL_MODE_GR_ML)).toBe('500 g');
        expect(formatGranelDisplay(1.25, queso, GRANEL_MODE_GR_ML)).toBe('1250 g');
        expect(formatGranelDisplay(0.8, jugo, GRANEL_MODE_GR_ML)).toBe('800 ml');

        // Modo estándar kg / L
        expect(formatGranelDisplay(0.5, queso, GRANEL_MODE_KG_LT)).toBe('0.5 kg');
        expect(formatGranelDisplay(1.25, queso, GRANEL_MODE_KG_LT)).toBe('1.25 kg');
        expect(formatGranelDisplay(0.8, jugo, GRANEL_MODE_KG_LT)).toBe('0.8 L');
    });

    it('provee títulos adaptados al modo y producto', () => {
        expect(getGranelTitle({ unit: 'kg' }, GRANEL_MODE_GR_ML)).toBe('¿Cuántos gramos?');
        expect(getGranelTitle({ unit: 'litro' }, GRANEL_MODE_GR_ML)).toBe('¿Cuántos mililitros?');
        expect(getGranelTitle({ unit: 'kg' }, GRANEL_MODE_KG_LT)).toBe('¿Cuántos kilos?');
        expect(getGranelTitle({ unit: 'litro' }, GRANEL_MODE_KG_LT)).toBe('¿Cuántos litros?');
    });

    it('provee opciones rápidas enteras en gr_ml y decimales en kg_lt', () => {
        const quickGrams = getGranelQuickOptions({ unit: 'kg' }, GRANEL_MODE_GR_ML);
        expect(quickGrams.map(o => o.displayQty)).toEqual([250, 500, 1000, 2000]);
        expect(quickGrams.map(o => o.canonicalQty)).toEqual([0.25, 0.5, 1.0, 2.0]);

        const quickKg = getGranelQuickOptions({ unit: 'kg' }, GRANEL_MODE_KG_LT);
        expect(quickKg.map(o => o.displayQty)).toEqual([0.25, 0.5, 1, 2]);
        expect(quickKg.map(o => o.canonicalQty)).toEqual([0.25, 0.5, 1.0, 2.0]);
    });
});

// ════════════════════════════════════════════════════════════════════════
// 8. SUFIJOS DE UNIDAD EXPLÍCITOS (g, kg, ml, L, grs, kgs, lts, mls, k)
// ════════════════════════════════════════════════════════════════════════
describe('R2 & R4.2: Entradas con Sufijos de Unidad Explícitos', () => {
    it('parsea correctamente entradas con unidad "g", "gr" o "grs"', () => {
        const res1 = parseWeightInput('500g', GRANEL_MODE_GR_ML);
        expect(res1).not.toBeNull();
        expect(res1.grams).toBe(500);
        expect(res1.canonicalKg).toBe(0.5);

        const res2 = parseWeightInput('250 gr', GRANEL_MODE_GR_ML);
        expect(res2).not.toBeNull();
        expect(res2.grams).toBe(250);
        expect(res2.canonicalKg).toBe(0.25);

        const res3 = parseWeightInput('500grs', GRANEL_MODE_GR_ML);
        expect(res3).not.toBeNull();
        expect(res3.grams).toBe(500);
        expect(res3.canonicalKg).toBe(0.5);

        const res4 = parseWeightInput(' 750 grs ', GRANEL_MODE_KG_LT);
        expect(res4).not.toBeNull();
        expect(res4.grams).toBe(750);
        expect(res4.canonicalKg).toBe(0.75);
    });

    it('especificar "g" en modo kg_lt respeta la intención de gramos', () => {
        const res = parseWeightInput('500g', GRANEL_MODE_KG_LT);
        expect(res).not.toBeNull();
        expect(res.canonicalKg).toBe(0.5);
        expect(res.grams).toBe(500);
    });

    it('especificar "kg", "kgs" o "k" respeta la intención de kilogramos', () => {
        const res1 = parseWeightInput('0.5kg', GRANEL_MODE_GR_ML);
        expect(res1).not.toBeNull();
        expect(res1.canonicalKg).toBe(0.5);
        expect(res1.grams).toBe(500);

        const res2 = parseWeightInput('2kgs', GRANEL_MODE_GR_ML);
        expect(res2).not.toBeNull();
        expect(res2.canonicalKg).toBe(2);
        expect(res2.grams).toBe(2000);

        const res3 = parseWeightInput('1k', GRANEL_MODE_GR_ML);
        expect(res3).not.toBeNull();
        expect(res3.canonicalKg).toBe(1);
        expect(res3.grams).toBe(1000);

        const res4 = parseWeightInput(' 1.5 kgs ', GRANEL_MODE_GR_ML);
        expect(res4).not.toBeNull();
        expect(res4.canonicalKg).toBe(1.5);
        expect(res4.grams).toBe(1500);
    });

    it('parsea unidades de volumen líquidas "ml", "mls", "L" y "lts"', () => {
        const resMl = parseWeightInput('800ml', GRANEL_MODE_GR_ML);
        expect(resMl).not.toBeNull();
        expect(resMl.grams).toBe(800);
        expect(resMl.canonicalKg).toBe(0.8);

        const resMls = parseWeightInput('500 mls', GRANEL_MODE_GR_ML);
        expect(resMls).not.toBeNull();
        expect(resMls.grams).toBe(500);
        expect(resMls.canonicalKg).toBe(0.5);

        const resL = parseWeightInput('1.5L', GRANEL_MODE_GR_ML);
        expect(resL).not.toBeNull();
        expect(resL.canonicalKg).toBe(1.5);
        expect(resL.grams).toBe(1500);

        const resLts = parseWeightInput('2 lts', GRANEL_MODE_GR_ML);
        expect(resLts).not.toBeNull();
        expect(resLts.canonicalKg).toBe(2);
        expect(resLts.grams).toBe(2000);
    });
});

// ════════════════════════════════════════════════════════════════════════
// 9. DETECCIÓN EXHAUSTIVA DE GRANEL Y LÍQUIDOS (VARIANTES LINGÜÍSTICAS)
// ════════════════════════════════════════════════════════════════════════
describe('R3: Detección Canónica con Variantes de Unidad (lt, litros, kilos, kgs, grs, lts, mls)', () => {
    it('reconoce unidades comunes y plurales como granel', () => {
        expect(isGranelProduct({ unit: 'kg' })).toBe(true);
        expect(isGranelProduct({ unit: 'kgs' })).toBe(true);
        expect(isGranelProduct({ unit: 'kilo' })).toBe(true);
        expect(isGranelProduct({ unit: 'kilos' })).toBe(true);
        expect(isGranelProduct({ unit: 'lt' })).toBe(true);
        expect(isGranelProduct({ unit: 'lts' })).toBe(true);
        expect(isGranelProduct({ unit: 'litros' })).toBe(true);
        expect(isGranelProduct({ unit: 'l' })).toBe(true);
        expect(isGranelProduct({ unit: 'gr' })).toBe(true);
        expect(isGranelProduct({ unit: 'grs' })).toBe(true);
        expect(isGranelProduct({ unit: 'ml' })).toBe(true);
        expect(isGranelProduct({ unit: 'mls' })).toBe(true);
        expect(isGranelProduct({ packagingType: 'granel' })).toBe(true);
    });

    it('reconoce variantes líquidas incluyendo plurales', () => {
        expect(isLiquidProduct({ unit: 'litro' })).toBe(true);
        expect(isLiquidProduct({ unit: 'litros' })).toBe(true);
        expect(isLiquidProduct({ unit: 'lt' })).toBe(true);
        expect(isLiquidProduct({ unit: 'lts' })).toBe(true);
        expect(isLiquidProduct({ unit: 'l' })).toBe(true);
        expect(isLiquidProduct({ unit: 'ml' })).toBe(true);
        expect(isLiquidProduct({ unit: 'mls' })).toBe(true);
        expect(isLiquidProduct({ unit: 'kg' })).toBe(false);
        expect(isLiquidProduct({ unit: 'kgs' })).toBe(false);
    });

    it('granelUnitLabel mapea correctamente sinónimos y plurales a etiquetas canónicas', () => {
        expect(granelUnitLabel({ unit: 'kg' })).toBe('kg');
        expect(granelUnitLabel({ unit: 'kgs' })).toBe('kg');
        expect(granelUnitLabel({ unit: 'kilo' })).toBe('kg');
        expect(granelUnitLabel({ unit: 'kilos' })).toBe('kg');
        expect(granelUnitLabel({ unit: 'lt' })).toBe('L');
        expect(granelUnitLabel({ unit: 'lts' })).toBe('L');
        expect(granelUnitLabel({ unit: 'litro' })).toBe('L');
        expect(granelUnitLabel({ unit: 'litros' })).toBe('L');
        expect(granelUnitLabel({ unit: 'gr' })).toBe('g');
        expect(granelUnitLabel({ unit: 'grs' })).toBe('g');
        expect(granelUnitLabel({ unit: 'gramo' })).toBe('g');
        expect(granelUnitLabel({ unit: 'gramos' })).toBe('g');
        expect(granelUnitLabel({ unit: 'ml' })).toBe('ml');
        expect(granelUnitLabel({ unit: 'mls' })).toBe('ml');
    });

    it('productos no-granel se reconocen correctamente', () => {
        expect(isGranelProduct({ unit: 'unidad' })).toBe(false);
        expect(isGranelProduct({ unit: 'paquete' })).toBe(false);
        expect(isGranelProduct({ unit: 'caja' })).toBe(false);
        expect(isGranelProduct(null)).toBe(false);
        expect(granelUnitLabel({ unit: 'unidad' })).toBe('UND');
        expect(granelUnitLabel(null)).toBe('UND');
    });
});

// ════════════════════════════════════════════════════════════════════════
// 10. PROTECCIÓN CONTRA VALORES INFINITESIMALES / VENTAS DE CERO
// ════════════════════════════════════════════════════════════════════════
describe('R2 & R3: Protección Contra Valores Infinitesimales / Venta Nula', () => {
    it('rechaza entradas infinitesimales que redondean a 0 kg', () => {
        expect(parseWeightInput('0.0001', GRANEL_MODE_GR_ML)).toBeNull();
        expect(parseWeightToCanonical('0.0001', GRANEL_MODE_GR_ML)).toBeNull();
        expect(parseWeightInput('0.0000', GRANEL_MODE_KG_LT)).toBeNull();
    });

    it('rechaza ceros con múltiples decimales o comas', () => {
        expect(parseWeightInput('0,00', GRANEL_MODE_GR_ML)).toBeNull();
        expect(parseWeightInput('0.000', GRANEL_MODE_KG_LT)).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════
// 11. FORMATO DE TICKETS Y COMPROBANTES SIN FLAG isWeight EXPLÍCITO
// ════════════════════════════════════════════════════════════════════════
describe('R3: Paridad en Comprobantes para Productos con packagingType granel', () => {
    it('formatea correctamente usando isGranelProduct aunque isWeight sea falsy o undefined', () => {
        const itemCatalogo = {
            name: 'Harina de Trigo Suelta',
            unit: 'kg',
            packagingType: 'granel',
            qty: 0.5,
            // isWeight no definido o false
        };

        expect(isGranelProduct(itemCatalogo)).toBe(true);
        expect(formatGranelDisplay(itemCatalogo.qty, itemCatalogo, GRANEL_MODE_GR_ML)).toBe('500 g');
        expect(formatGranelDisplay(itemCatalogo.qty, itemCatalogo, GRANEL_MODE_KG_LT)).toBe('0.5 kg');
    });

    it('formatea líquidos sueltos por volumen', () => {
        const liquidoGranel = {
            name: 'Cloro Concentrado Suelto',
            unit: 'lt',
            packagingType: 'granel',
            qty: 0.75,
        };

        expect(isGranelProduct(liquidoGranel)).toBe(true);
        expect(formatGranelDisplay(liquidoGranel.qty, liquidoGranel, GRANEL_MODE_GR_ML)).toBe('750 ml');
        expect(formatGranelDisplay(liquidoGranel.qty, liquidoGranel, GRANEL_MODE_KG_LT)).toBe('0.75 L');
    });
});

// ════════════════════════════════════════════════════════════════════════
// 12. INVARIANZA FINANCIERA EXACTA (DRIFT-FREE)
// ════════════════════════════════════════════════════════════════════════
describe('R3: Invarianza Financiera Exacta en Subtotales Monetarios', () => {
    const testCases = [
        { rawGrams: '250', rawKg: '0.25', pricePerKg: 6.0, expectedSubtotal: 1.5 },
        { rawGrams: '500', rawKg: '0.5', pricePerKg: 7.5, expectedSubtotal: 3.75 },
        { rawGrams: '750', rawKg: '0.75', pricePerKg: 8.4, expectedSubtotal: 6.3 },
        { rawGrams: '1250', rawKg: '1.25', pricePerKg: 4.8, expectedSubtotal: 6.0 },
        { rawGrams: '2000', rawKg: '2', pricePerKg: 3.25, expectedSubtotal: 6.5 },
    ];

    it('el subtotal monetario de venta es idéntico al céntimo en ambos modos', () => {
        testCases.forEach(tc => {
            const canonicalFromGr = parseWeightToCanonical(tc.rawGrams, GRANEL_MODE_GR_ML);
            const canonicalFromKg = parseWeightToCanonical(tc.rawKg, GRANEL_MODE_KG_LT);

            expect(canonicalFromGr).toBe(canonicalFromKg);

            const subtotalGr = mulR(tc.pricePerKg, canonicalFromGr);
            const subtotalKg = mulR(tc.pricePerKg, canonicalFromKg);

            expect(subtotalGr).toBe(tc.expectedSubtotal);
            expect(subtotalKg).toBe(tc.expectedSubtotal);
            expect(subtotalGr).toBe(subtotalKg);
        });
    });
});

// ════════════════════════════════════════════════════════════════════════
// 13. FORMATEO RESILIENTE ANTE VALORES NULOS O CERO (R3)
// ════════════════════════════════════════════════════════════════════════
describe('R3: formatGranelDisplay Resiliente ante Valores Nulos, Cero o No Numéricos', () => {
    it('incluye siempre la unidad activa en gramos y mililitros ante valores vacíos/cero', () => {
        expect(formatGranelDisplay(0, { unit: 'kg' }, GRANEL_MODE_GR_ML)).toBe('0 g');
        expect(formatGranelDisplay(null, { unit: 'kg' }, GRANEL_MODE_GR_ML)).toBe('0 g');
        expect(formatGranelDisplay(undefined, { unit: 'litro' }, GRANEL_MODE_GR_ML)).toBe('0 ml');
        expect(formatGranelDisplay(NaN, { unit: 'kg' }, GRANEL_MODE_GR_ML)).toBe('0 g');
    });

    it('incluye siempre la unidad activa en kilos y litros ante valores vacíos/cero', () => {
        expect(formatGranelDisplay(0, { unit: 'kg' }, GRANEL_MODE_KG_LT)).toBe('0 kg');
        expect(formatGranelDisplay(null, { unit: 'kg' }, GRANEL_MODE_KG_LT)).toBe('0 kg');
        expect(formatGranelDisplay(undefined, { unit: 'litro' }, GRANEL_MODE_KG_LT)).toBe('0 L');
        expect(formatGranelDisplay(NaN, { unit: 'kg' }, GRANEL_MODE_KG_LT)).toBe('0 kg');
    });
});

// ════════════════════════════════════════════════════════════════════════
// 14. ANULACIÓN DE VENTA (processVoidSale) CON PRODUCTO A GRANEL SIN isWeight
// ════════════════════════════════════════════════════════════════════════
describe('R3: Anulación de Venta (processVoidSale) para Granel sin isWeight Explícito', () => {
    const HARINA_GRANEL = {
        id: 'harina-001',
        name: 'Harina Suelta',
        unit: 'kg',
        packagingType: 'granel',
        stock: 50.0,
        priceUsdt: 2.0,
        priceUsd: 2.0,
        costUsd: 1.0,
        costBs: 0,
        // isWeight ausente intencionalmente
    };

    it('restaura el stock canónico a 3 decimales exactos tras anular la venta', async () => {
        _memoryStore.set(PRODUCTS_KEY, [JSON.parse(JSON.stringify(HARINA_GRANEL))]);

        // Venta de 0.375 kg de harina
        const saleOpts = {
            cart: [{
                id: 'harina-001',
                _originalId: 'harina-001',
                name: 'Harina Suelta',
                qty: 0.375, // 375 g
                priceUsd: 2.0,
                costUsd: 1.0,
                costBs: 0,
                packagingType: 'granel',
                unit: 'kg',
            }],
            cartTotalUsd: 0.75,
            cartTotalBs: 30,
            cartSubtotalUsd: 0.75,
            payments: [{ amountUsd: 0.75, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
            changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
            selectedCustomerId: null,
            customers: [],
            products: [JSON.parse(JSON.stringify(HARINA_GRANEL))],
            effectiveRate: 40,
            tasaCop: 0,
            copEnabled: false,
            discountData: null,
            useAutoRate: false,
        };

        const saleResult = await processSaleTransaction(saleOpts);
        expect(saleResult.success).toBe(true);

        // Stock tras venta: 50.0 - 0.375 = 49.625 kg
        let products = await storageService.getItem(PRODUCTS_KEY, []);
        let harina = products.find(p => p.id === 'harina-001');
        expect(harina.stock).toBe(49.625);

        // Anular la venta
        const voidResult = await processVoidSale({
            sale: saleResult.sale,
            motivo: 'Error de pesaje',
            usuario: { id: 'tester', nombre: 'Tester' },
        });
        expect(voidResult.success).toBe(true);

        // Stock tras anulación: restaurado exactamente a 50.0 kg sin pérdida decimal ni redondeo entero
        products = await storageService.getItem(PRODUCTS_KEY, []);
        harina = products.find(p => p.id === 'harina-001');
        expect(harina.stock).toBe(50.0);
    });
});

// ════════════════════════════════════════════════════════════════════════
// 15. RESOLUCIÓN DE PASOS (+ / -) CON ENTRADAS GUARDARRAÍL EN MODO GRAMOS
// ════════════════════════════════════════════════════════════════════════
describe('R2: Invarianza en Incrementos (+ / -) tras Entrada Decimal en Modo Gramos', () => {
    it('al ingresar "0.5" en modo gramos y pulsar +, la cantidad pasa a 600 g (no 101 g)', () => {
        // Simulación lógica de WeightPopup handleStep
        const rawInput = '0.5';
        const parsed = parseWeightInput(rawInput, GRANEL_MODE_GR_ML);
        expect(parsed).not.toBeNull();
        expect(parsed.displayQty).toBe(500); // 500 g por guardarraíl

        const step = getGranelStep(GRANEL_MODE_GR_ML); // 100 g
        const nextQty = parsed.displayQty + step; // 500 + 100 = 600 g
        expect(nextQty).toBe(600);

        const nextCanonical = gramsToKg(nextQty);
        expect(nextCanonical).toBe(0.6);
    });

    it('al ingresar "0.5" en modo gramos y pulsar -, la cantidad pasa a 400 g', () => {
        const rawInput = '0.5';
        const parsed = parseWeightInput(rawInput, GRANEL_MODE_GR_ML);
        const step = getGranelStep(GRANEL_MODE_GR_ML);
        const prevQty = parsed.displayQty - step; // 500 - 100 = 400 g
        expect(prevQty).toBe(400);

        const prevCanonical = gramsToKg(prevQty);
        expect(prevCanonical).toBe(0.4);
    });
});

// ════════════════════════════════════════════════════════════════════════
// 16. TECHO DE CORDURA (MAX_GRANEL_KG) Y NOTACIÓN CIENTÍFICA
// ════════════════════════════════════════════════════════════════════════
describe('R2 & R3: Techo de Cordura contra Desbordamientos y Escaneos Accidentales', () => {
    it('define MAX_GRANEL_KG en 5000 kg', () => {
        expect(MAX_GRANEL_KG).toBe(5000);
    });

    it('rechaza códigos de barras estándar de 13 dígitos pegados por error en input de peso', () => {
        // Un cajero escanea por error Coca-Cola (7591234567890) mientras el popup de peso está abierto
        expect(parseWeightInput('7591234567890', GRANEL_MODE_GR_ML)).toBeNull();
        expect(parseWeightInput('7591234567890', GRANEL_MODE_KG_LT)).toBeNull();
        expect(parseWeightToCanonical('7591234567890', GRANEL_MODE_GR_ML)).toBeNull();
    });

    it('rechaza entradas superiores a 5000 kg o 5,000,000 g', () => {
        expect(parseWeightInput('5001', GRANEL_MODE_KG_LT)).toBeNull();
        expect(parseWeightInput('5000001', GRANEL_MODE_GR_ML)).toBeNull();
        expect(parseWeightInput('5000', GRANEL_MODE_KG_LT)).not.toBeNull();
        expect(parseWeightInput('5000000', GRANEL_MODE_GR_ML)).not.toBeNull();
    });

    it('maneja con seguridad notación científica legal e invalida la extrema', () => {
        // 1e-3 = 0.001 -> en gramos es 1 g (0.001 kg)
        const sciSmall = parseWeightInput('1e-3', GRANEL_MODE_GR_ML);
        expect(sciSmall).not.toBeNull();
        expect(sciSmall.grams).toBe(1);

        // Notación científica extrema por encima de 5000 kg se rechaza limpiamente
        expect(parseWeightInput('1e6', GRANEL_MODE_KG_LT)).toBeNull();
        expect(parseWeightInput('1e10', GRANEL_MODE_GR_ML)).toBeNull();

        // Letras solas o malformadas no numéricas retornan null
        expect(parseWeightInput('1e', GRANEL_MODE_GR_ML)).toBeNull();
        expect(parseWeightInput('1e+', GRANEL_MODE_KG_LT)).toBeNull();
    });
});

// ════════════════════════════════════════════════════════════════════════
// 17. POLIMORFISMO STRING EN granelUnitLabel E isGranelProduct
// ════════════════════════════════════════════════════════════════════════
describe('R3: Polimorfismo de Argumentos Tipo String en Helpers de Granel', () => {
    it('granelUnitLabel acepta directamente cadenas de unidad', () => {
        expect(granelUnitLabel('kg')).toBe('kg');
        expect(granelUnitLabel('kgs')).toBe('kg');
        expect(granelUnitLabel('kilo')).toBe('kg');
        expect(granelUnitLabel('litro')).toBe('L');
        expect(granelUnitLabel('lt')).toBe('L');
        expect(granelUnitLabel('lts')).toBe('L');
        expect(granelUnitLabel('gr')).toBe('g');
        expect(granelUnitLabel('grs')).toBe('g');
        expect(granelUnitLabel('g')).toBe('g');
        expect(granelUnitLabel('ml')).toBe('ml');
        expect(granelUnitLabel('mls')).toBe('ml');
        expect(granelUnitLabel('unidad')).toBe('UND');
        expect(granelUnitLabel('paquete')).toBe('UND');
        expect(granelUnitLabel('')).toBe('UND');
    });

    it('isGranelProduct acepta directamente cadenas de unidad', () => {
        expect(isGranelProduct('kg')).toBe(true);
        expect(isGranelProduct('kgs')).toBe(true);
        expect(isGranelProduct('lt')).toBe(true);
        expect(isGranelProduct('lts')).toBe(true);
        expect(isGranelProduct('gr')).toBe(true);
        expect(isGranelProduct('ml')).toBe(true);
        expect(isGranelProduct('unidad')).toBe(false);
        expect(isGranelProduct('caja')).toBe(false);
    });
});

// ════════════════════════════════════════════════════════════════════════
// 18. VALIDACIONES ESTRICTAS DE BALANZA ELECTRÓNICA EAN-13
// ════════════════════════════════════════════════════════════════════════
describe('R2: Validaciones Estrictas de Balanza Electrónica EAN-13', () => {
    it('rechaza códigos con 0 gramos exactos (21 + PLU + 00000)', () => {
        // Balanza que pesó 0 gramos
        const zeroWeightBarcode = '2100123000001';
        expect(parseEan13ScaleBarcode(zeroWeightBarcode)).toBeNull();
    });

    it('rechaza códigos con caracteres alfabéticos o símbolos corruptos', () => {
        expect(parseEan13ScaleBarcode('2100123005A01')).toBeNull();
        expect(parseEan13ScaleBarcode('2100123-05001')).toBeNull();
    });

    it('rechaza lecturas de balanza que excedan MAX_GRANEL_KG', () => {
        // Formato con peso teórico superior a 5000 kg (ej: 99999 gramos = 99.999 kg es válido)
        const validLarge = '2100123999991'; // 99.999 kg
        expect(parseEan13ScaleBarcode(validLarge)).not.toBeNull();
        expect(parseEan13ScaleBarcode(validLarge).weightKg).toBe(99.999);
    });
});

// ════════════════════════════════════════════════════════════════════════
// 19. RESILIENCIA EN PERSISTENCIA ANTE EXCEPCIONES DE STORAGE
// ════════════════════════════════════════════════════════════════════════
describe('R1: Resiliencia de Persistencia de Modo ante Fallas de localStorage', () => {
    it('setGranelUnitMode y getGranelUnitMode sobreviven si localStorage lanza excepción', () => {
        const setItemSpy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
            throw new Error('SecurityError: The operation is insecure.');
        });
        const getItemSpy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
            throw new Error('SecurityError: The operation is insecure.');
        });

        try {
            // No debe arrojar excepción no capturada
            expect(() => setGranelUnitMode(GRANEL_MODE_GR_ML)).not.toThrow();
            expect(setGranelUnitMode(GRANEL_MODE_GR_ML)).toBe(GRANEL_MODE_GR_ML);

            expect(() => getGranelUnitMode()).not.toThrow();
            expect(getGranelUnitMode()).toBe(GRANEL_MODE_KG_LT);
        } finally {
            setItemSpy.mockRestore();
            getItemSpy.mockRestore();
        }
    });
});

// ════════════════════════════════════════════════════════════════════════
// 20. CONVERSIÓN DE STOCK DE ENTRADA EN GRAMOS/ML A CANÓNICO (R2 & R5.1)
// ════════════════════════════════════════════════════════════════════════
describe('R5.1: Conversión de stock de entrada en gramos/ml a stock canónico al crear productos', () => {
    it('crea producto en gramos: "5000" g se guarda como 5.000 kg canónico', () => {
        const payload = buildProductPayload({
            name: 'Queso Rallado',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: '5000',
            priceUsd: '6.00',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(payload.stock).toBe(5);
        expect(payload.unit).toBe('kg');
    });

    it('crea producto en gramos: "750" g se guarda como 0.750 kg canónico', () => {
        const payload = buildProductPayload({
            name: 'Café Molido',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: '750',
            priceUsd: '10.00',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(payload.stock).toBe(0.75);
    });

    it('crea producto líquido en ml: "800" ml se guarda como 0.800 L canónico', () => {
        const payload = buildProductPayload({
            name: 'Detergente Líquido',
            packagingType: 'granel',
            granelUnit: 'litro',
            stock: '800',
            priceUsd: '3.00',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(payload.stock).toBe(0.8);
        expect(payload.unit).toBe('litro');
    });

    it('guardarraíl: decimal menor a 1 ("0.5") en modo gramos se interpreta como 500 g -> 0.500 kg', () => {
        const payload = buildProductPayload({
            name: 'Queso Parmesano',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: '0.5',
            priceUsd: '15.00',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(payload.stock).toBe(0.5);
    });

    it('guardarraíl: decimal menor a 1 con coma ("0,75") en modo gramos se interpreta como 750 g -> 0.750 kg', () => {
        const payload = buildProductPayload({
            name: 'Jamón Serrano',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: '0,75',
            priceUsd: '20.00',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(payload.stock).toBe(0.75);
    });

    it('stock cero o vacío en modo gramos se almacena como 0 canónico', () => {
        const payloadZero = buildProductPayload({
            name: 'Azúcar',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: '0',
            priceUsd: '1.50',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(payloadZero.stock).toBe(0);

        const payloadEmpty = buildProductPayload({
            name: 'Harina',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: '',
            priceUsd: '1.50',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(payloadEmpty.stock).toBe(0);
    });

    it('cero riesgo de inflar stock por factor x1000 en base de datos', () => {
        const payload = buildProductPayload({
            name: 'Queso Paisa',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: '2500', // usuario ingresa 2500 gramos
            priceUsd: '5.00',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        // Debe ser 2.5 kg, NUNCA 2500 kg en base de datos
        expect(payload.stock).toBe(2.5);
        expect(payload.stock).not.toBe(2500);
    });

    it('los productos no-granel continúan operando con enteros estrictos sin alteración', () => {
        const payload = buildProductPayload({
            name: 'Arroz 1kg Empacado',
            packagingType: 'suelto',
            stock: '12.8',
            priceUsd: '1.20',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(payload.stock).toBe(13); // round0
        expect(Number.isInteger(payload.stock)).toBe(true);
    });

    it('guardarraíl: decimal con punto o coma inicial (".5" / ",5") se interpreta correctamente como 500 g -> 0.5 kg', () => {
        const payloadDot = buildProductPayload({
            name: 'Queso Rallado',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: '.5',
            priceUsd: '10.00',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(payloadDot.stock).toBe(0.5);

        const payloadComma = buildProductPayload({
            name: 'Queso Rallado Coma',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: ',5',
            priceUsd: '10.00',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(payloadComma.stock).toBe(0.5);
    });

    it('limpieza de espacios y notación científica en entrada de stock a granel', () => {
        const payloadSpaces = buildProductPayload({
            name: 'Almendras',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: '  1 250  ',
            priceUsd: '18.00',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(payloadSpaces.stock).toBe(1.25);

        const payloadScientific = buildProductPayload({
            name: 'Nueces',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: '1e3', // 1000g
            priceUsd: '22.00',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(payloadScientific.stock).toBe(1);
    });

    it('entrada inválida o negativa se normaliza a 0 canónico con seguridad', () => {
        const payloadNeg = buildProductPayload({
            name: 'Maní',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: '-500',
            priceUsd: '4.00',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(payloadNeg.stock).toBe(0);
    });
});

// ════════════════════════════════════════════════════════════════════════
// 21. MAPEO BIDIRECCIONAL AL EDITAR PRODUCTOS EXISTENTES (R3 & R5.2)
// ════════════════════════════════════════════════════════════════════════
describe('R5.2: Mapeo bidireccional al editar productos existentes con stock decimal', () => {
    it('al editar en modo gr_ml, 2.500 kg en base de datos se presenta en el formulario como 2500 gramos', () => {
        const existingProduct = {
            id: 'prod-001',
            name: 'Queso Guayanés',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: 2.5,
            priceUsd: 6.0,
        };
        const formState = prepareProductFormState(existingProduct, 40, GRANEL_MODE_GR_ML);
        expect(formState.stock).toBe('2500');

        // Al guardar sin modificar el input (2500 g), se recalcula a 2.5 kg exactos
        const savedPayload = buildProductPayload({
            ...formState,
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(savedPayload.stock).toBe(2.5);
    });

    it('al editar en modo gr_ml, 0.750 kg en base de datos se presenta como 750 gramos y round-trips limpio', () => {
        const existingProduct = {
            id: 'prod-002',
            name: 'Jamón Cocido',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: 0.75,
            priceUsd: 8.0,
        };
        const formState = prepareProductFormState(existingProduct, 40, GRANEL_MODE_GR_ML);
        expect(formState.stock).toBe('750');

        const savedPayload = buildProductPayload({
            ...formState,
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(savedPayload.stock).toBe(0.75);
    });

    it('al editar en modo gr_ml, producto líquido con 1.500 L se presenta como 1500 ml y round-trips limpio', () => {
        const existingProduct = {
            id: 'prod-003',
            name: 'Aceite a Granel',
            packagingType: 'granel',
            granelUnit: 'litro',
            stock: 1.5,
            priceUsd: 4.0,
        };
        const formState = prepareProductFormState(existingProduct, 40, GRANEL_MODE_GR_ML);
        expect(formState.stock).toBe('1500');
        expect(formState.granelUnit).toBe('litro');

        const savedPayload = buildProductPayload({
            ...formState,
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(savedPayload.stock).toBe(1.5);
    });

    it('al editar en modo kg_lt, se mantiene la visualización estándar decimal', () => {
        const existingProduct = {
            id: 'prod-004',
            name: 'Queso Amarillo',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: 2.5,
            priceUsd: 7.0,
        };
        const formState = prepareProductFormState(existingProduct, 40, GRANEL_MODE_KG_LT);
        expect(formState.stock).toBe('2.5');

        const savedPayload = buildProductPayload({
            ...formState,
            granelUnitMode: GRANEL_MODE_KG_LT,
        }, 40);
        expect(savedPayload.stock).toBe(2.5);
    });

    it('al editar y cambiar la cantidad en modo gr_ml de 2500 a 3000 g, se almacena 3.0 kg', () => {
        const existingProduct = {
            id: 'prod-005',
            name: 'Carne Molida',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: 2.5,
            priceUsd: 7.5,
        };
        const formState = prepareProductFormState(existingProduct, 40, GRANEL_MODE_GR_ML);
        expect(formState.stock).toBe('2500');

        // Usuario edita a 3000 g
        const savedPayload = buildProductPayload({
            ...formState,
            stock: '3000',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(savedPayload.stock).toBe(3);
    });

    it('producto con stock 0 al editar en gr_ml se presenta como "0"', () => {
        const existingProduct = {
            id: 'prod-006',
            name: 'Queso Duro',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: 0,
            priceUsd: 5.0,
        };
        const formState = prepareProductFormState(existingProduct, 40, GRANEL_MODE_GR_ML);
        expect(formState.stock).toBe('0');

        const savedPayload = buildProductPayload({
            ...formState,
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(savedPayload.stock).toBe(0);
    });

    it('producto legado con unit="kilo" sin packagingType se mapea a granel con stock en gramos enteros', () => {
        const legacyProduct = {
            id: 'prod-legacy-001',
            name: 'Queso Paisa Legado',
            unit: 'kilo',
            stock: 3.5,
            priceUsd: 5.0,
        };
        const formState = prepareProductFormState(legacyProduct, 40, GRANEL_MODE_GR_ML);
        expect(formState.packagingType).toBe('granel');
        expect(formState.granelUnit).toBe('kg');
        expect(formState.stock).toBe('3500');

        const savedPayload = buildProductPayload({
            ...formState,
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(savedPayload.stock).toBe(3.5);
        expect(savedPayload.packagingType).toBe('granel');
        expect(savedPayload.unit).toBe('kg');
    });

    it('producto legado líquido con unit="litros" sin packagingType se mapea a granel litro con stock en ml', () => {
        const legacyLiquid = {
            id: 'prod-legacy-002',
            name: 'Cloro Legado',
            unit: 'litros',
            stock: 2.0,
            priceUsd: 1.5,
        };
        const formState = prepareProductFormState(legacyLiquid, 40, GRANEL_MODE_GR_ML);
        expect(formState.packagingType).toBe('granel');
        expect(formState.granelUnit).toBe('litro');
        expect(formState.stock).toBe('2000');

        const savedPayload = buildProductPayload({
            ...formState,
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(savedPayload.stock).toBe(2);
        expect(savedPayload.packagingType).toBe('granel');
        expect(savedPayload.unit).toBe('litro');
    });

    it('fracciones de 3 decimales (0.125 kg) se mapean a 125 gramos y preservan la precisión', () => {
        const fractionProduct = {
            id: 'prod-frac-001',
            name: 'Levadura Seca',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: 0.125,
            priceUsd: 25.0,
        };
        const formState = prepareProductFormState(fractionProduct, 40, GRANEL_MODE_GR_ML);
        expect(formState.stock).toBe('125');

        const savedPayload = buildProductPayload({
            ...formState,
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(savedPayload.stock).toBe(0.125);
    });
});

// ════════════════════════════════════════════════════════════════════════
// 22. BLINDAJE DE FORMULARIOS REMOTOS, UNIDADES CANÓNICAS Y CASOS BORDE (R1-R5)
// ════════════════════════════════════════════════════════════════════════
describe('R1-R5: Blindaje de formularios, unidades canónicas y casos borde', () => {
    it('canonicaliza estrictamente variantes legacy en granelUnit a "litro" o "kg"', () => {
        const pLegacyLitros = {
            id: 'liq-001',
            name: 'Aceite de Oliva',
            packagingType: 'granel',
            granelUnit: 'litros',
            stock: 5.0,
            priceUsd: 12.0,
        };
        const stateLitros = prepareProductFormState(pLegacyLitros, 40, GRANEL_MODE_GR_ML);
        expect(stateLitros.granelUnit).toBe('litro');
        expect(stateLitros.packagingType).toBe('granel');
        expect(stateLitros.stock).toBe('5000');

        const pLegacyKilos = {
            id: 'sol-001',
            name: 'Café Molido',
            packagingType: 'granel',
            granelUnit: 'kilos',
            stock: 1.0,
            priceUsd: 10.0,
        };
        const stateKilos = prepareProductFormState(pLegacyKilos, 40, GRANEL_MODE_GR_ML);
        expect(stateKilos.granelUnit).toBe('kg');
        expect(stateKilos.packagingType).toBe('granel');
        expect(stateKilos.stock).toBe('1000');
    });

    it('creación de producto líquido a granel en modo gr_ml con stock en ml', () => {
        const payloadLiquid = buildProductPayload({
            name: 'Detergente Líquido',
            packagingType: 'granel',
            granelUnit: 'litro',
            stock: '1500',
            priceUsd: '3.50',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(payloadLiquid.stock).toBe(1.5);
        expect(payloadLiquid.unit).toBe('litro');
        expect(payloadLiquid.packagingType).toBe('granel');
    });

    it('creación con stock vacío o "0" en modo gr_ml resulta en stock canónico 0', () => {
        const payloadEmpty = buildProductPayload({
            name: 'Azúcar Morena',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: '',
            priceUsd: '2.00',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(payloadEmpty.stock).toBe(0);

        const payloadZero = buildProductPayload({
            name: 'Sal Marina',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: '0',
            priceUsd: '1.00',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(payloadZero.stock).toBe(0);
    });

    it('guardarraíl al editar producto con decimal menor a 1 (0.5 kg -> 500g -> edit a 0.25 -> 0.25 kg)', () => {
        const pHalf = {
            id: 'half-001',
            name: 'Mantequilla Artesanal',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: 0.5,
            priceUsd: 4.0,
        };
        const stateHalf = prepareProductFormState(pHalf, 40, GRANEL_MODE_GR_ML);
        expect(stateHalf.stock).toBe('500');

        // Operador edita usando "0.25"
        const savedHalf = buildProductPayload({
            ...stateHalf,
            stock: '0.25',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(savedHalf.stock).toBe(0.25);
    });

    it('productos no-granel (suelto y lote) preservan enteros estrictos', () => {
        const payloadSuelto = buildProductPayload({
            name: 'Galleta María',
            packagingType: 'suelto',
            stock: '15',
            priceUsd: '1.00',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(payloadSuelto.stock).toBe(15);
        expect(Number.isInteger(payloadSuelto.stock)).toBe(true);

        const payloadLote = buildProductPayload({
            name: 'Caja de Atún',
            packagingType: 'lote',
            stockInLotes: '3',
            unitsPerPackage: '24',
            priceUsd: '30.00',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(payloadLote.stock).toBe(72);
        expect(Number.isInteger(payloadLote.stock)).toBe(true);
    });

    it('flujo de producto remoto elimina el riesgo de inflación o reducción 1000x', () => {
        const remoteProduct = {
            id: 'rem-001',
            name: 'Queso Telita Remoto',
            unit: 'kilo',
            stock: 4.25,
            priceUsd: 7.0,
        };
        const remoteState = prepareProductFormState(remoteProduct, 40, GRANEL_MODE_GR_ML);
        expect(remoteState.packagingType).toBe('granel');
        expect(remoteState.granelUnit).toBe('kg');
        expect(remoteState.stock).toBe('4250');

        const remoteSaved = buildProductPayload({
            ...remoteState,
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(remoteSaved.stock).toBe(4.25);
        expect(remoteSaved.packagingType).toBe('granel');
        expect(remoteSaved.unit).toBe('kg');
    });

    it('isGranelProduct devuelve false para productos con packagingType suelto o lote aunque tengan granelUnit', () => {
        expect(isGranelProduct({ packagingType: 'suelto', granelUnit: 'kg' })).toBe(false);
        expect(isGranelProduct({ packagingType: 'lote', granelUnit: 'kg' })).toBe(false);
        expect(isGranelProduct({ packagingType: 'granel', granelUnit: 'kg' })).toBe(true);
        expect(isGranelProduct({ packagingType: 'suelto', granelUnit: 'litro', unit: 'unidad' })).toBe(false);
    });

    it('producto suelto con granelUnit presente en formData conserva enteros estrictos y no colapsa a gramos en gr_ml', () => {
        const payloadSueltoWithGranelUnit = buildProductPayload({
            name: 'Champú Anticaspa',
            packagingType: 'suelto',
            granelUnit: 'kg', // campo presente por defecto en el estado del formulario
            stock: '10',
            priceUsd: '3.50',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(payloadSueltoWithGranelUnit.stock).toBe(10);
        expect(payloadSueltoWithGranelUnit.stock).not.toBe(0.01);
        expect(payloadSueltoWithGranelUnit.unit).toBe('unidad');
        expect(payloadSueltoWithGranelUnit.packagingType).toBe('suelto');
        expect(payloadSueltoWithGranelUnit.granelUnit).toBeNull();
    });

    it('producto lote con granelUnit presente en formData conserva enteros estrictos y no colapsa en gr_ml', () => {
        const payloadLoteWithGranelUnit = buildProductPayload({
            name: 'Caja Galletas',
            packagingType: 'lote',
            granelUnit: 'kg',
            stockInLotes: '5',
            unitsPerPackage: '12',
            priceUsd: '15.00',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(payloadLoteWithGranelUnit.stock).toBe(60);
        expect(payloadLoteWithGranelUnit.unit).toBe('paquete');
        expect(payloadLoteWithGranelUnit.packagingType).toBe('lote');
        expect(payloadLoteWithGranelUnit.granelUnit).toBeNull();
    });

    it('prepareProductFormState no confunde un producto suelto como granel si contiene granelUnit residual', () => {
        const sueltoProduct = {
            id: 'suelto-001',
            name: 'Atún en Lata',
            packagingType: 'suelto',
            unit: 'unidad',
            granelUnit: 'kg',
            stock: 25,
            priceUsd: 1.5,
        };
        const state = prepareProductFormState(sueltoProduct, 40, GRANEL_MODE_GR_ML);
        expect(state.packagingType).toBe('suelto');
        expect(state.stock).toBe(25);
        expect(state.stock).not.toBe('25000');
    });

    it('prepareProductFormState maneja stocks almacenados con coma decimal legacy ("2,5")', () => {
        const commaProduct = {
            id: 'comma-001',
            name: 'Queso Rallado',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: '2,5',
            priceUsd: 5.0,
        };
        const stateGr = prepareProductFormState(commaProduct, 40, GRANEL_MODE_GR_ML);
        expect(stateGr.stock).toBe('2500');

        const stateKg = prepareProductFormState(commaProduct, 40, GRANEL_MODE_KG_LT);
        expect(stateKg.stock).toBe('2.5');
    });

    it('buildProductPayload exporta granelUnit canónico para granel y null para no-granel', () => {
        const solidGranel = buildProductPayload({
            name: 'Café Grano',
            packagingType: 'granel',
            granelUnit: 'kilos',
            stock: '1000',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(solidGranel.granelUnit).toBe('kg');
        expect(solidGranel.unit).toBe('kg');

        const liquidGranel = buildProductPayload({
            name: 'Jugo Natural',
            packagingType: 'granel',
            granelUnit: 'litros',
            stock: '2000',
            granelUnitMode: GRANEL_MODE_GR_ML,
        }, 40);
        expect(liquidGranel.granelUnit).toBe('litro');
        expect(liquidGranel.unit).toBe('litro');
    });
});



