// ── Operaciones de stock por producto (optimistic update, unificado) ─────────
// Servicio compartido por los dos flujos de ajuste de stock del Supervisor:
// el ajuste de fila (+/− / edición directa) y el panel de lote de inventario.
// Los mensajes de error se leen del catálogo compartido
// (supervisorStockMessages) para que fila y lote usen el mismo texto.

import { stockMessage } from './supervisorStockMessages';
//
// Estado por producto (op):
//   { state: 'sending'|'pending'|'applied'|'failed', targetStock, commandId?, silent?, error? }
//   - sending/pending: en vuelo o sin confirmar → el stock objetivo es provisional.
//   - applied: confirmado por la caja aún sin sincronizar → el objetivo es real.
//   - failed: conclusión cierta de fallo → se revierte al stock sincronizado.
//
// Todas las funciones son puras: reciben el mapa de operaciones y devuelven el
// siguiente SIN mutar. Los efectos (toasts, temporizadores, inspección de
// comandos) los ejecuta el llamador a partir de los planes y predicados de
// este servicio.

export const STOCK_OP_IN_FLIGHT_STATES = Object.freeze(['sending', 'pending']);

export function getStockOp(ops, productId) {
    return ops?.[String(productId)] || null;
}

// Valor "creído" de la fila: mientras un ajuste está en vuelo o confirmado aún
// sin sincronizar, el stock objetivo ES el valor real de la caja. Si el ajuste
// falla, se revierte solo al stock sincronizado.
export function believedStockOf(product, ops) {
    const op = getStockOp(ops, product?.id);
    if (op && op.state !== 'failed' && op.targetStock !== undefined) return Number(op.targetStock);
    return Number(product?.stock || 0);
}

// Un ajuste nuevo solo puede partir del estado confirmado: mientras hay un
// ajuste en vuelo (enviando o sin confirmar) la edición queda bloqueada.
export function isStockAdjustBlocked(ops, productId) {
    const op = getStockOp(ops, productId);
    return Boolean(op && STOCK_OP_IN_FLIGHT_STATES.includes(op.state));
}

export function withStockOp(ops, productId, op) {
    return { ...ops, [String(productId)]: op };
}

// Con onlyAppliedTarget solo elimina si sigue siendo el mismo ajuste aplicado
// (nunca borra un ajuste nuevo en vuelo).
export function clearStockOp(ops, productId, { onlyAppliedTarget } = {}) {
    const key = String(productId);
    const entry = ops?.[key];
    if (!entry) return ops;
    if (onlyAppliedTarget !== undefined
        && (entry.state !== 'applied' || Number(entry.targetStock) !== Number(onlyAppliedTarget))) {
        return ops;
    }
    const next = { ...ops };
    delete next[key];
    return next;
}

// Inicio de un ajuste: 'sending' con el stock objetivo (provisional). Los lotes
// multiartículo van en silencio (el panel avisa por su cuenta).
export function beginStockAdjust(ops, { productId, targetStock, silent = false }) {
    return withStockOp(ops, productId, { state: 'sending', targetStock, silent });
}

export function beginBatchStockTargets(ops, targets = []) {
    return targets.reduce((acc, target) => (
        beginStockAdjust(acc, {
            productId: target.productId,
            targetStock: target.targetStock,
            silent: true,
        })
    ), ops);
}

// Clasifica cualquier resultado (ajuste único o lote) en el estado del op.
export function classifyStockOpResult(result) {
    if (result?.ok || result?.status === 'applied' || result?.status === 'applied_with_warnings') {
        return 'applied';
    }
    // Estado desconocido: la caja puede seguir aplicándolo → NO se marca como
    // fallido para no invitar a un doble envío.
    if (result?.uncertain) return 'pending';
    return 'failed';
}

// Un fallo de ajuste único se comunica (toast + franja con reintento); los
// lotes multiartículo solo revierten (el panel muestra el error del lote).
export function shouldAnnounceStockOpFailure(op) {
    return Boolean(op && op.state === 'failed' && !op.silent);
}

export function applyStockOpResult(ops, { productId, targetStock, commandId = null }, result, { announce = true } = {}) {
    const state = classifyStockOpResult(result);
    if (state === 'failed') {
        if (announce) {
            return withStockOp(ops, productId, {
                state: 'failed',
                targetStock,
                commandId,
                error: result?.error || stockMessage('STOCK_UPDATE_FAILED'),
            });
        }
        // Conclusión cierta de fallo (o nada enviado): reversión pura al stock
        // sincronizado, sin franja ni toast por producto.
        return clearStockOp(ops, productId);
    }
    return withStockOp(ops, productId, {
        state,
        targetStock,
        commandId,
        ...(announce ? {} : { silent: true }),
    });
}

export function applyBatchStockTargets(ops, result, targets = []) {
    return targets.reduce((acc, target) => (
        applyStockOpResult(
            acc,
            { ...target, commandId: result?.commandId ?? null },
            result,
            { announce: false },
        )
    ), ops);
}

// Plan de reconciliación para el efecto de la vista:
//  - promoted: ops que el stock sincronizado ya confirma → 'applied'.
//  - retire:   ops 'applied' ya sincronizadas → su franja puede retirarse.
//  - inspect:  ops 'pending' con commandId → consultar el estado del comando.
// `map` es el mapa promovido y conserva la MISMA referencia si no hay cambios,
// para no provocar renders en bucle.
export function planStockOpReconciliation(ops, products = []) {
    const entries = Object.entries(ops || {}).filter(([, op]) => (
        op && op.targetStock !== undefined
        && ['sending', 'pending', 'applied'].includes(op.state)
    ));
    if (!entries.length) return { map: ops, promoted: [], retire: [], inspect: [] };

    const productById = new Map(products.map(product => [String(product.id), product]));
    let map = ops;
    const promoted = [];
    const retire = [];
    const inspect = [];
    entries.forEach(([id, op]) => {
        const product = productById.get(id);
        const synced = Boolean(product)
            && Math.abs(Number(product.stock || 0) - Number(op.targetStock)) < 1e-9;
        if (synced) {
            if (op.state === 'applied') {
                retire.push({ id, targetStock: Number(op.targetStock) });
            } else {
                if (map === ops) map = { ...ops };
                map[id] = { ...op, state: 'applied' };
                promoted.push(id);
            }
            return;
        }
        if (op.state === 'pending' && op.commandId) inspect.push({ id, op });
    });
    return { map, promoted, retire, inspect };
}

// Traduce la inspección del comando en el siguiente estado del op, o null si
// sigue sin resolverse ('active' / 'absent': la caja puede seguir aplicándolo).
export function nextStockOpAfterInspection(op, inspection) {
    if (inspection?.state === 'terminal') {
        const ok = inspection?.ack?.status === 'applied'
            || inspection?.ack?.status === 'applied_with_warnings';
        return ok
            ? { ...op, state: 'applied' }
            : { ...op, state: 'failed', error: inspection?.ack?.error || stockMessage('BOX_REJECTED_STOCK') };
    }
    if (inspection?.state === 'expired') {
        return { ...op, state: 'failed', error: stockMessage('ORDER_EXPIRED') };
    }
    return null;
}

// Stocks objetivo por producto para un lote (acumula varias líneas del mismo
// producto: el resumen proyecta cada línea desde la misma base).
export function buildInventoryBatchTargets(lines = []) {
    const byProduct = new Map();
    lines.forEach(line => {
        if (!line?.valid) return;
        const id = String(line.productId);
        const base = Number(line.stock || 0);
        const delta = Number(line.projectedStock) - base;
        const entry = byProduct.get(id);
        if (entry) {
            entry.targetStock = Math.round((entry.targetStock + delta) * 1000) / 1000;
        } else {
            byProduct.set(id, {
                productId: id,
                targetStock: Math.round(Number(line.projectedStock) * 1000) / 1000,
            });
        }
    });
    return [...byProduct.values()];
}

// expectedStock debe describir la base contra la que se calculó el movimiento:
// si el stock local aún no refleja un ajuste confirmado, se usa el valor creído
// para que la caja valide la concurrencia con el estado correcto.
export function patchProductStock(products = [], productId, stock) {
    return products.map(item => (String(item.id) === String(productId) ? { ...item, stock } : item));
}

export default {
    STOCK_OP_IN_FLIGHT_STATES,
    getStockOp,
    believedStockOf,
    isStockAdjustBlocked,
    withStockOp,
    clearStockOp,
    beginStockAdjust,
    beginBatchStockTargets,
    classifyStockOpResult,
    shouldAnnounceStockOpFailure,
    applyStockOpResult,
    applyBatchStockTargets,
    planStockOpReconciliation,
    nextStockOpAfterInspection,
    buildInventoryBatchTargets,
    patchProductStock,
};
