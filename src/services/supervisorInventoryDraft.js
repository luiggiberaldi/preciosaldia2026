import { round0, round3 } from '../utils/dinero';
import { stockMessage } from './supervisorStockMessages';
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
    if (!INPUT_UNITS.has(inputUnit)) return { ok: false, error: stockMessage('UNIT_INVALID') };
    if (!Number.isFinite(quantity) || quantity <= 0) return { ok: false, error: stockMessage('QUANTITY_REQUIRED') };
    if (!product) return { ok: false, error: stockMessage('PRODUCT_NOT_FOUND') };

    const isGranel = isGranelProduct(product);
    const toCanonical = MEASURE_TO_CANONICAL[inputUnit];
    if (toCanonical) {
        if (!isGranel) return { ok: false, error: stockMessage('MEASURE_ON_NON_GRANEL') };
        const kind = resolveGranelKind(product);
        if (!kind) return { ok: false, error: stockMessage('GRANEL_KIND_UNKNOWN') };
        const allowed = kind === 'liquid' ? LIQUID_MEASURE_UNITS : SOLID_MEASURE_UNITS;
        if (!allowed.includes(inputUnit)) {
            return { ok: false, error: stockMessage(kind === 'liquid' ? 'GRANEL_LIQUID_UNITS' : 'GRANEL_SOLID_UNITS') };
        }
        const unitsDelta = toCanonical(quantity);
        if (!(unitsDelta > 0) || unitsDelta > MAX_GRANEL_KG) return { ok: false, error: stockMessage('GRANEL_RANGE') };
        return { ok: true, unitsDelta, unitsPerPackage: 1 };
    }

    if (inputUnit === 'unidades') {
        if (isGranel) {
            const unitsDelta = round3(quantity);
            if (!(unitsDelta > 0) || unitsDelta > MAX_GRANEL_KG) return { ok: false, error: stockMessage('GRANEL_RANGE') };
            return { ok: true, unitsDelta, unitsPerPackage: 1 };
        }
        if (!Number.isInteger(quantity)) return { ok: false, error: stockMessage('UNITS_MUST_BE_INTEGER') };
        return { ok: true, unitsDelta: quantity, unitsPerPackage: 1 };
    }

    // cajas / bultos: solo productos contables con factor entero positivo.
    if (isGranel) return { ok: false, error: stockMessage('PRESENTATION_ON_GRANEL') };
    const factor = Number(unitsPerPackage);
    if (!Number.isInteger(factor) || factor <= 0) return { ok: false, error: stockMessage('PACKAGE_FACTOR_INVALID') };
    const raw = quantity * factor;
    const unitsDelta = round0(raw);
    if (Math.abs(raw - unitsDelta) > 1e-9 || unitsDelta <= 0) {
        return { ok: false, error: stockMessage('CONVERSION_NOT_INTEGER') };
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

// Base estampada al componer la línea: el stock contra el que el usuario calculó
// el movimiento. `expectedStock` debe salir de aquí (no del stock sincronizado
// crudo) o la caja rechaza movimientos legítimos cuando el stock local aún no
// refleja un ajuste ya confirmado. null = sin estampar (legacy: se usa el stock
// del producto al momento del envío).
function readStampedBase(line) {
    const value = Number(line?.baseStock);
    return line?.baseStock !== null && line?.baseStock !== undefined && Number.isFinite(value)
        ? value
        : null;
}

// Objetivo estampado al componer la línea: el stock con el que el usuario
// quiere QUEDAR. La semántica de objetivo hace el flujo idempotente de raíz:
// el movimiento real se deriva al enviar como (objetivo − stock actual), así
// que reintentar un lote ya aplicado es un no-op ("ya en objetivo") en vez de
// duplicar el movimiento. null = línea legacy de delta puro.
function readTargetStock(line) {
    const value = Number(line?.targetStock);
    return line?.targetStock !== null && line?.targetStock !== undefined && Number.isFinite(value)
        ? value
        : null;
}

function roundTarget(value) {
    return Math.round(Number(value) * 1000) / 1000;
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
    if (!draft?.direction || !line.productId) return { draft, error: stockMessage('PRODUCT_REQUIRED') };
    if (!INPUT_UNITS.has(line.inputUnit)) return { draft, error: stockMessage('UNIT_INVALID') };

    const quantityInput = toPositiveNumber(line.quantityInput);
    const unitsPerPackage = ['cajas', 'bultos'].includes(line.inputUnit)
        ? toPositiveNumber(line.unitsPerPackage, 1)
        : 1;
    if (!quantityInput) return { draft, error: stockMessage('QUANTITY_REQUIRED') };

    const normalized = {
        id: line.id || createId('line'),
        productId: String(line.productId),
        productName: line.productName || 'Producto',
        inputUnit: line.inputUnit,
        quantityInput,
        unitsPerPackage,
        baseStock: readStampedBase(line),
        targetStock: readTargetStock(line),
    };
    // Delta firmado de la contribución nueva (objetivo − base estampada).
    const newBase = readStampedBase(normalized);
    const newTarget = readTargetStock(normalized);
    const delta = newTarget !== null && newBase !== null ? newTarget - newBase : null;
    // Último objetivo ya estampado para este producto (aunque las contribuciones
    // sean en otras unidades): los objetivos acumulan por producto para que las
    // líneas encadenadas representen estados intermedios coherentes.
    const priorTargets = draft.lines
        .filter(existing => String(existing.productId) === normalized.productId)
        .map(existing => readTargetStock(existing))
        .filter(value => value !== null);

    const existingIndex = draft.lines.findIndex(existing => canMergeLines(existing, normalized));
    const lines = [...draft.lines];

    if (existingIndex >= 0) {
        const existing = lines[existingIndex];
        const existingTarget = readTargetStock(existing);
        const mergedTarget = delta !== null && existingTarget !== null
            ? roundTarget(existingTarget + delta)
            : existingTarget;
        lines[existingIndex] = {
            ...existing,
            quantityInput: existing.quantityInput + normalized.quantityInput,
            targetStock: mergedTarget,
        };
        // La fusión mueve el objetivo de la línea: las líneas posteriores del
        // mismo producto se desplazan igual para conservar el encadenado.
        const shift = mergedTarget !== null && existingTarget !== null ? mergedTarget - existingTarget : 0;
        if (shift !== 0) {
            for (let index = existingIndex + 1; index < lines.length; index += 1) {
                const target = readTargetStock(lines[index]);
                if (String(lines[index].productId) === normalized.productId && target !== null) {
                    lines[index] = { ...lines[index], targetStock: roundTarget(target + shift) };
                }
            }
        }
    } else {
        if (delta !== null && priorTargets.length) {
            normalized.targetStock = roundTarget(priorTargets[priorTargets.length - 1] + delta);
        }
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
    // El contrato v2 exige el MISMO expectedStock para todas las líneas de un
    // producto (la base real actual); el cursor por producto encadena las líneas
    // para derivar cada movimiento sin mezclar bases.
    const sendBaseByProduct = new Map();
    const cursorByProduct = new Map();
    const enrichedLines = lines.map(line => {
        const product = productById.get(String(line.productId));
        const productId = String(line.productId);
        const isGranel = isGranelProduct(product);
        const roundStock = (value) => (isGranel ? round3(value) : value);
        const target = readTargetStock(line);
        const isTarget = target !== null;

        if (!sendBaseByProduct.has(productId)) {
            // Línea de objetivo: el movimiento se deriva del stock actual real.
            // Línea legacy: la base estampada al componer (o el stock del producto).
            sendBaseByProduct.set(productId, isTarget
                ? Number(product?.stock || 0)
                : (readStampedBase(line) ?? Number(product?.stock || 0)));
        }
        const stock = sendBaseByProduct.get(productId);
        const cursor = cursorByProduct.get(productId) ?? stock;

        const conversion = resolveInventoryUnitConversion(product, line);
        const factor = conversion.ok
            ? conversion.unitsPerPackage
            : (['cajas', 'bultos'].includes(line.inputUnit) ? Number(line.unitsPerPackage) : 1);

        let unitsDelta;
        let projectedStock;
        let error = null;
        let satisfied = false;
        let wire;

        if (isTarget) {
            // Movimiento derivado: (objetivo − estado encadenado). Si ya está en
            // el objetivo, la línea es un no-op aplicado (idempotencia de raíz).
            const needed = roundStock(target - cursor);
            satisfied = Math.abs(needed) < 1e-9;
            const magnitude = Math.abs(needed);
            const moveUp = needed > 0;
            const directionOk = satisfied || (draft.direction === 'egreso' ? !moveUp : moveUp);
            if (target < 0) {
                error = stockMessage('STOCK_INSUFFICIENT', { units: magnitude, stock: cursor });
            } else if (!directionOk) {
                error = stockMessage('TARGET_ALREADY_PASSED', { stock: cursor, target });
            } else if (!satisfied && !conversion.ok) {
                error = conversion.error;
            }
            unitsDelta = satisfied ? 0 : magnitude;
            projectedStock = roundStock(target);
            // La caja recalcula la conversión con su factor actual: se conserva la
            // unidad compuesta ("2 cajas") solo si sigue representando exactamente
            // el movimiento derivado; si no, se manda en unidades canónicas.
            wire = satisfied
                ? { inputUnit: line.inputUnit, quantityInput: line.quantityInput, unitsPerPackage: factor }
                : (conversion.ok && Math.abs(conversion.unitsDelta - magnitude) < 1e-9)
                    ? { inputUnit: line.inputUnit, quantityInput: line.quantityInput, unitsPerPackage: conversion.unitsPerPackage }
                    : { inputUnit: 'unidades', quantityInput: magnitude, unitsPerPackage: 1 };
        } else {
            unitsDelta = conversion.ok ? conversion.unitsDelta : (Number(line.quantityInput) || 0) * (Number(factor) || 0);
            const rawProjected = draft.direction === 'egreso' ? cursor - unitsDelta : cursor + unitsDelta;
            projectedStock = roundStock(rawProjected);
            const insufficient = draft.direction === 'egreso' && projectedStock < 0;
            error = conversion.ok
                ? (insufficient ? stockMessage('STOCK_INSUFFICIENT', { units: unitsDelta, stock: cursor }) : null)
                : conversion.error;
            wire = { inputUnit: line.inputUnit, quantityInput: line.quantityInput, unitsPerPackage: factor };
        }

        cursorByProduct.set(productId, projectedStock);
        return {
            ...line,
            ...wire,
            product,
            stock,
            unitsDelta,
            signedDelta: draft.direction === 'egreso' ? -unitsDelta : unitsDelta,
            projectedStock,
            satisfied,
            error,
            valid: !error,
        };
    });
    return {
        lines: enrichedLines,
        totalLines: enrichedLines.length,
        totalUnits: enrichedLines.reduce((sum, line) => sum + line.unitsDelta, 0),
        invalidLines: enrichedLines.filter(line => !line.valid),
        satisfiedLines: enrichedLines.filter(line => line.satisfied),
        pendingLines: enrichedLines.filter(line => line.valid && !line.satisfied),
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
