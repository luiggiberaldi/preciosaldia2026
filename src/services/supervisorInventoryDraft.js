import { round0, round3 } from '../utils/dinero';
import {
    MAX_GRANEL_KG,
    granelUnitLabel,
    gramsToKg,
    isGranelProduct,
    isLiquidProduct,
    mlToLiters,
} from '../utils/granel';

export const PRESENTATION_UNITS = ['unidades', 'cajas', 'bultos'];
export const SOLID_MEASURE_UNITS = ['kg', 'g'];
export const LIQUID_MEASURE_UNITS = ['lt', 'ml'];
export const INVENTORY_INPUT_UNITS = [...PRESENTATION_UNITS, ...SOLID_MEASURE_UNITS, ...LIQUID_MEASURE_UNITS];
const INPUT_UNITS = new Set(INVENTORY_INPUT_UNITS);
const MEASURE_TO_CANONICAL = { kg: round3, lt: round3, g: gramsToKg, ml: mlToLiters };

/**
 * Tipo de granel inferido solo con helpers canónicos de granel.js.
 * Devuelve 'liquid', 'solid' o null cuando no hay certeza (no se adivina).
 */
export function resolveGranelKind(product) {
    if (!isGranelProduct(product)) return null;
    if (isLiquidProduct(product)) return 'liquid';
    return ['kg', 'g'].includes(granelUnitLabel(product)) ? 'solid' : null;
}

/**
 * Convierte la cantidad capturada al delta canónico del stock (kg/L con 3
 * decimales para granel; unidades enteras para productos contables).
 * La caja la ejecuta con el producto actual: el factor enviado no es autoritativo
 * para unidades de medida.
 * @returns {{ ok: true, unitsDelta: number, unitsPerPackage: number } | { ok: false, error: string }}
 */
export function resolveInventoryUnitConversion(product, { inputUnit, quantityInput, unitsPerPackage } = {}) {
    const quantity = Number(quantityInput);
    if (!INPUT_UNITS.has(inputUnit)) return { ok: false, error: 'Unidad de inventario inválida' };
    if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, error: 'La cantidad debe ser mayor que cero' };
    if (!product) return { ok: false, error: 'Producto no encontrado' };

    const isGranel = isGranelProduct(product);
    const toCanonical = MEASURE_TO_CANONICAL[inputUnit];
    if (toCanonical) {
        if (!isGranel) return { ok: false, error: 'Las unidades de peso o volumen solo aplican a productos a granel' };
        const kind = resolveGranelKind(product);
        if (!kind) return { ok: false, error: 'No se puede determinar si el producto a granel es sólido o líquido' };
        const allowed = kind === 'liquid' ? LIQUID_MEASURE_UNITS : SOLID_MEASURE_UNITS;
        if (!allowed.includes(inputUnit)) {
            return { ok: false, error: kind === 'liquid' ? 'Producto líquido: usa lt o ml' : 'Producto sólido: usa kg o g' };
        }
        const unitsDelta = toCanonical(quantity);
        if (!(unitsDelta > 0) || unitsDelta > MAX_GRANEL_KG) return { ok: false, error: 'Cantidad de granel fuera de rango' };
        return { ok: true, unitsDelta, unitsPerPackage: 1 };
    }

    if (inputUnit === 'unidades') {
        if (isGranel) {
            const unitsDelta = round3(quantity);
            if (!(unitsDelta > 0) || unitsDelta > MAX_GRANEL_KG) return { ok: false, error: 'Cantidad de granel fuera de rango' };
            return { ok: true, unitsDelta, unitsPerPackage: 1 };
        }
        if (!Number.isInteger(quantity)) return { ok: false, error: 'Las unidades contables deben ser enteras' };
        return { ok: true, unitsDelta: quantity, unitsPerPackage: 1 };
    }

    // cajas / bultos: solo productos contables con factor entero positivo.
    if (isGranel) return { ok: false, error: 'Cajas y bultos no aplican a productos a granel' };
    const factor = Number(unitsPerPackage);
    if (!Number.isInteger(factor) || factor <= 0) return { ok: false, error: 'Las unidades por presentación deben ser un entero positivo' };
    const raw = quantity * factor;
    const unitsDelta = round0(raw);
    if (Math.abs(raw - unitsDelta) > 1e-9 || unitsDelta <= 0) {
        return { ok: false, error: 'La conversión debe dar unidades contables enteras' };
    }
    return { ok: true, unitsDelta, unitsPerPackage: factor };
}

function createId(prefix = 'line') {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toPositiveNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function resolveInventoryPresentationFactor(product, inputUnit = 'unidades') {
    if (inputUnit === 'unidades' || MEASURE_TO_CANONICAL[inputUnit]) return 1;
    const factor = Number(product?.unitsPerPackage);
    return Number.isFinite(factor) && factor > 0 ? factor : 1;
}

/**
 * Empaque configurado en el producto (número > 0) o `null` si no está
 * configurado. Distingue "sin configurado" de "configurado en 1" para que la
 * interfaz nunca asuma 1 a escondidas: un bulto sin factor declarado contaría
 * como 1 unidad y perdería inventario.
 */
export function readConfiguredPresentationFactor(product) {
    const factor = Number(product?.unitsPerPackage);
    return Number.isFinite(factor) && factor > 0 ? factor : null;
}

export function createInventoryDraft(direction = 'ingreso', defaults = {}) {
    const safeDirection = direction === 'egreso' ? 'egreso' : 'ingreso';
    return {
        id: defaults.id || createId('draft'),
        direction: safeDirection,
        reason: defaults.reason ?? (safeDirection === 'ingreso' ? 'Compra recibida' : ''),
        reasonCategory: defaults.reasonCategory || 'merma',
        lotReference: defaults.lotReference || '',
        lines: Array.isArray(defaults.lines) ? defaults.lines : [],
    };
}

function canMergeLines(left, right) {
    return String(left.productId) === String(right.productId)
        && left.inputUnit === right.inputUnit
        && Number(left.unitsPerPackage) === Number(right.unitsPerPackage);
}

export function addInventoryDraftLine(draft, line = {}) {
    if (!draft?.direction || !line.productId) return { draft, error: 'Selecciona un producto' };
    if (!INPUT_UNITS.has(line.inputUnit)) return { draft, error: 'Unidad de ingreso inválida' };

    const quantityInput = toPositiveNumber(line.quantityInput);
    const unitsPerPackage = ['cajas', 'bultos'].includes(line.inputUnit)
        ? toPositiveNumber(line.unitsPerPackage, 1)
        : 1;
    if (!quantityInput) return { draft, error: 'La cantidad debe ser mayor que cero' };

    const normalized = {
        id: line.id || createId('line'),
        productId: String(line.productId),
        productName: line.productName || 'Producto',
        inputUnit: line.inputUnit,
        quantityInput,
        unitsPerPackage,
    };
    const existingIndex = draft.lines.findIndex(existing => canMergeLines(existing, normalized));
    const lines = [...draft.lines];

    if (existingIndex >= 0) {
        lines[existingIndex] = {
            ...lines[existingIndex],
            quantityInput: lines[existingIndex].quantityInput + normalized.quantityInput,
        };
    } else {
        lines.push(normalized);
    }

    return { draft: { ...draft, lines }, line: normalized };
}

export function updateInventoryDraftLine(draft, lineId, changes = {}) {
    const lines = draft.lines.map(line => {
        if (line.id !== lineId) return line;
        const nextInputUnit = changes.inputUnit !== undefined ? changes.inputUnit : line.inputUnit;
        const rawUnitsPerPackage = changes.unitsPerPackage !== undefined
            ? changes.unitsPerPackage
            : line.unitsPerPackage;
        const unitsPerPackage = !['cajas', 'bultos'].includes(nextInputUnit)
            ? 1
            : toPositiveNumber(rawUnitsPerPackage, line.unitsPerPackage);

        return {
            ...line,
            ...changes,
            inputUnit: nextInputUnit,
            quantityInput: changes.quantityInput === undefined
                ? line.quantityInput
                : toPositiveNumber(changes.quantityInput, line.quantityInput),
            unitsPerPackage,
        };
    });
    return { ...draft, lines };
}

export function removeInventoryDraftLine(draft, lineId) {
    return { ...draft, lines: draft.lines.filter(line => line.id !== lineId) };
}

export function getInventoryDraftSummary(draft, products = []) {
    const productById = new Map(products.map(product => [String(product.id), product]));
    const lines = draft?.lines || [];
    const enrichedLines = lines.map(line => {
        const product = productById.get(String(line.productId));
        const stock = Number(product?.stock || 0);
        const conversion = resolveInventoryUnitConversion(product, line);
        const factor = conversion.ok
            ? conversion.unitsPerPackage
            : (['cajas', 'bultos'].includes(line.inputUnit) ? Number(line.unitsPerPackage) : 1);
        const unitsDelta = conversion.ok ? conversion.unitsDelta : (Number(line.quantityInput) || 0) * (Number(factor) || 0);
        const isGranel = isGranelProduct(product);
        const rawProjected = draft.direction === 'egreso' ? stock - unitsDelta : stock + unitsDelta;
        const projectedStock = isGranel ? round3(rawProjected) : rawProjected;
        const insufficient = draft.direction === 'egreso' && projectedStock < 0;
        return {
            ...line,
            unitsPerPackage: factor,
            product,
            stock,
            unitsDelta,
            projectedStock,
            error: conversion.ok ? (insufficient ? 'Stock insuficiente para el egreso' : null) : conversion.error,
            valid: conversion.ok && !insufficient,
        };
    });
    return {
        lines: enrichedLines,
        totalLines: enrichedLines.length,
        totalUnits: enrichedLines.reduce((sum, line) => sum + line.unitsDelta, 0),
        invalidLines: enrichedLines.filter(line => !line.valid),
        canSubmit: enrichedLines.length > 0 && enrichedLines.every(line => line.valid),
    };
}

export default {
    createInventoryDraft,
    addInventoryDraftLine,
    updateInventoryDraftLine,
    removeInventoryDraftLine,
    getInventoryDraftSummary,
    resolveInventoryPresentationFactor,
    readConfiguredPresentationFactor,
    resolveInventoryUnitConversion,
    resolveGranelKind,
};
