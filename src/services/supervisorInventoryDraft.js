const INPUT_UNITS = new Set(['unidades', 'cajas', 'bultos']);

function createId(prefix = 'line') {
    if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`;
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function toPositiveNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : fallback;
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
    const unitsPerPackage = toPositiveNumber(line.unitsPerPackage, 1);
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
    const lines = draft.lines.map(line => line.id === lineId ? {
        ...line,
        ...changes,
        quantityInput: changes.quantityInput === undefined
            ? line.quantityInput
            : toPositiveNumber(changes.quantityInput, line.quantityInput),
        unitsPerPackage: changes.unitsPerPackage === undefined
            ? line.unitsPerPackage
            : toPositiveNumber(changes.unitsPerPackage, line.unitsPerPackage),
    } : line);
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
        const unitsDelta = line.quantityInput * line.unitsPerPackage;
        const projectedStock = draft.direction === 'egreso' ? stock - unitsDelta : stock + unitsDelta;
        return {
            ...line,
            product,
            stock,
            unitsDelta,
            projectedStock,
            valid: Boolean(product) && line.quantityInput > 0 && line.unitsPerPackage > 0
                && (draft.direction !== 'egreso' || projectedStock >= 0),
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
};
