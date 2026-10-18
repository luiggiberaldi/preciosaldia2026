// ── Operaciones de stock por producto (optimistic update, unificado) ─────────
// Servicio compartido por los dos flujos de ajuste de stock del Supervisor:
// el ajuste de fila (+/− / edición directa) y el panel de lote de inventario.
// Los mensajes de error se leen del catálogo compartido
// (supervisorStockMessages) para que fila y lote usen el mismo texto.

import { stockMessage } from './supervisorStockMessages';
import { isNewerSyncDocument } from './supervisorSyncService';
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

// Persistencia del mapa de ops entre recargas: el valor "creído" (aplicado en
// caja aún sin sincronizar) debe sobrevivir un reload. Si se pierde, la fila
// muestra el stock sincronizado (que va atrás) y el usuario reintenta
// movimientos que YA se aplicaron.
export const STOCK_OP_STORAGE_KEY = 'pda_stock_ops_v1';

export function loadStockOpMap(storage = globalThis.localStorage) {
    try {
        const raw = storage?.getItem(STOCK_OP_STORAGE_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!parsed || typeof parsed !== 'object') return {};
        const entries = Object.entries(parsed).filter(([, op]) => (
            op
            && ['sending', 'pending', 'applied', 'failed'].includes(op.state)
            && Number.isFinite(Number(op.targetStock))
        ));
        return Object.fromEntries(entries);
    } catch {
        return {};
    }
}

export function saveStockOpMap(ops, storage = globalThis.localStorage) {
    try {
        const entries = Object.entries(ops || {}).filter(([, op]) => (
            op && Number.isFinite(Number(op.targetStock))
        ));
        if (!entries.length) {
            storage?.removeItem(STOCK_OP_STORAGE_KEY);
        } else {
            storage?.setItem(STOCK_OP_STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
        }
    } catch { /* best effort */ }
}

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
export function beginStockAdjust(ops, { productId, targetStock, silent = false, sinceWatermark = null }) {
    return withStockOp(ops, productId, {
        state: 'sending',
        targetStock,
        silent,
        // Marca del eco de productos vigente al iniciar el ajuste. Con ella la
        // reconciliación distingue "el eco va detrás" (se conserva el objetivo
        // creído) de "una venta en la caja ya dejó viejo el objetivo" (se retira
        // y la fila vuelve al stock sincronizado, que trae el descuento).
        ...(sinceWatermark ? { sinceWatermark } : {}),
    });
}

export function beginBatchStockTargets(ops, targets = [], { sinceWatermark = null } = {}) {
    return targets.reduce((acc, target) => (
        beginStockAdjust(acc, {
            productId: target.productId,
            targetStock: target.targetStock,
            silent: true,
            sinceWatermark,
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
    const prior = getStockOp(ops, productId);
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
        ...(prior?.sinceWatermark ? { sinceWatermark: prior.sinceWatermark } : {}),
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
//  - promoted:   ops que el stock sincronizado ya confirma → 'applied'.
//  - retire:     ops 'applied' ya sincronizadas → su franja puede retirarse.
//  - superseded: ops 'applied' cuyo objetivo quedó atrás de la realidad.
//  - inspect:    ops 'pending' con commandId → consultar el estado del comando.
// `map` es el mapa promovido y conserva la MISMA referencia si no hay cambios,
// para no provocar renders en bucle.
//
// Caso `superseded`: llegó un eco de productos MÁS NUEVO que el ajuste
// (`productsUpdatedAt` posterior al `sinceWatermark` de la op) y el stock ya no
// es el objetivo — típicamente una venta en la caja descontó después (o su push
// coalesció con el del ajuste). Sin este caso, el objetivo creído queda viejo
// para siempre y la venta nunca se descontaría en la fila del supervisor.
export function planStockOpReconciliation(ops, products = [], { productsUpdatedAt = null } = {}) {
    const entries = Object.entries(ops || {}).filter(([, op]) => (
        op && op.targetStock !== undefined
        && ['sending', 'pending', 'applied'].includes(op.state)
    ));
    if (!entries.length) return { map: ops, promoted: [], retire: [], superseded: [], inspect: [] };

    const productById = new Map(products.map(product => [String(product.id), product]));
    let map = ops;
    const promoted = [];
    const retire = [];
    const superseded = [];
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
        // Objetivo superado por la realidad: el eco posterior muestra otra cosa,
        // así que el creído está viejo y enmascararía el descuento de la venta.
        if (op.state === 'applied' && hasNewerSync(op, productsUpdatedAt)) {
            superseded.push({ id, targetStock: Number(op.targetStock) });
            return;
        }
        if (op.state === 'pending' && op.commandId) inspect.push({ id, op });
    });
    return { map, promoted, retire, superseded, inspect };
}

function hasNewerSync(op, productsUpdatedAt) {
    return Boolean(op.sinceWatermark && productsUpdatedAt)
        && isNewerSyncDocument(productsUpdatedAt, op.sinceWatermark);
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
        // signedDelta es el movimiento derivado de la línea (con semántica de
        // objetivo puede diferir de projectedStock − stock por el encadenado de
        // varias líneas del mismo producto).
        const delta = Number(line.signedDelta ?? (Number(line.projectedStock) - base));
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
    STOCK_OP_STORAGE_KEY,
    loadStockOpMap,
    saveStockOpMap,
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
