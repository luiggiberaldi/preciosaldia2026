import { isGranelProduct, normalizeStockValue } from '../utils/granel'; // GRANEL-001
import { INVENTORY_INPUT_UNITS, resolveInventoryUnitConversion } from './supervisorInventoryDraft';

const INPUT_UNITS = new Set(INVENTORY_INPUT_UNITS);
const EGRESS_REASONS = new Set(['merma', 'danio', 'vencimiento', 'autoconsumo', 'devolucion', 'ajuste']);

export function calculateSupervisorInventoryBatchAdjustment(product = {}, payload = {}, {
    commandId = 'unknown-command',
    timestamp = new Date().toISOString(),
    movementId,
} = {}) {
    const quantityInput = Number(payload.quantityInput);
    const unitsPerPackage = Number(payload.unitsPerPackage);
    const expectedStock = Number(payload.expectedStock);

    const direction = payload.direction;
    const isEgress = direction === 'egreso';
    if (!['ingreso', 'egreso'].includes(direction) || typeof payload.productId !== 'string' || payload.productId.length === 0) {
        throw new Error('Dirección de inventario no permitida');
    }
    if (isEgress && !EGRESS_REASONS.has(payload.reasonCategory)) {
        throw new Error('Categoría de egreso inválida');
    }
    if (!INPUT_UNITS.has(payload.inputUnit)
        || !Number.isFinite(quantityInput) || quantityInput <= 0
        || !Number.isFinite(unitsPerPackage) || unitsPerPackage <= 0
        || !Number.isFinite(expectedStock) || expectedStock < 0
        || typeof payload.reason !== 'string' || payload.reason.trim().length === 0) {
        throw new Error('Payload de ingreso por lote inválido');
    }

    const stockBefore = Number(product.stock || 0);
    if (!Number.isFinite(stockBefore) || stockBefore !== expectedStock) {
        throw new Error(`El stock cambió antes de aplicar: esperado ${expectedStock}, actual ${stockBefore}`);
    }

    // GRANEL-001: granel conserva hasta 3 decimales en el stock resultante;
    // el resto permanece entero estricto.
    // Fase 4: la caja recalcula la conversión con el producto actual.
    const isGranel = isGranelProduct(product);
    const conversion = resolveInventoryUnitConversion(product, {
        inputUnit: payload.inputUnit,
        quantityInput,
        unitsPerPackage,
    });
    if (!conversion.ok) throw new Error(conversion.error);
    const { unitsDelta } = conversion;
    const stockAfter = normalizeStockValue(stockBefore + (isEgress ? -unitsDelta : unitsDelta), isGranel);
    if (stockAfter < 0) throw new Error('Stock insuficiente para el egreso');
    const stableMovementId = movementId || `supervisor-${commandId}`;
    const movement = {
        id: stableMovementId,
        movementId: stableMovementId,
        tipo: isEgress ? 'AJUSTE_SALIDA' : 'AJUSTE_ENTRADA',
        source: 'supervisor',
        status: 'COMPLETADA',
        timestamp,
        productId: product.id,
        productNameSnapshot: product.name,
        direction,
        reasonCategory: isEgress ? payload.reasonCategory : null,
        quantityInput,
        inputUnit: payload.inputUnit,
        unitsPerPackageSnapshot: conversion.unitsPerPackage,
        unitsDelta,
        stockBefore,
        stockAfter,
        reason: payload.reason.trim(),
        lotReference: payload.lotReference || null,
        operatorNameSnapshot: 'Supervisor remoto',
        commandId,
    };

    return {
        product: { ...product, stock: stockAfter },
        movement,
        unitsDelta,
        stockBefore,
        stockAfter,
    };
}

/**
 * Purely validates and calculates a complete batch against the current catalog.
 * It either returns a full replacement plan or throws without exposing a
 * partial result; it does not read/write storage or perform network I/O.
 */
export function calculateSupervisorInventoryBatchPlan(products = [], sales = [], payload = {}, {
    commandId = 'unknown-command',
    timestamp = new Date().toISOString(),
} = {}) {
    if (!Array.isArray(products) || !Array.isArray(sales)) {
        throw new Error('Catálogo o historial de inventario inválido');
    }
    if (!Array.isArray(payload.lines) || payload.lines.length === 0) {
        throw new Error('El lote debe incluir al menos una línea');
    }

    const seenProductUnits = new Set();
    const baseByProduct = new Map();
    const plannedProducts = new Map();
    const lineResults = [];

    for (let index = 0; index < payload.lines.length; index += 1) {
        const line = payload.lines[index];
        if (!line || typeof line.productId !== 'string' || !line.productId.trim()) {
            throw new Error(`Línea ${index + 1}: producto inválido`);
        }
        const productKey = String(line.productId);
        const unitKey = `${productKey}\u0000${line.inputUnit}`;
        if (seenProductUnits.has(unitKey)) {
            throw new Error(`Líneas duplicadas para el producto ${productKey} y unidad ${line.inputUnit}`);
        }
        seenProductUnits.add(unitKey);

        const product = products.find(item => String(item.id) === productKey);
        if (!product) throw new Error(`Línea ${index + 1}: producto no encontrado (${productKey})`);
        if (!Number.isFinite(line.expectedStock)) {
            throw new Error(`Línea ${index + 1}: stock esperado inválido`);
        }
        const base = baseByProduct.get(productKey);
        if (base && (base.expectedStock !== line.expectedStock || base.baseRevision !== line.baseRevision)) {
            throw new Error(`Línea ${index + 1}: estado base inconsistente para ${productKey}`);
        }
        if (!base) {
            const actualStock = Number(product.stock || 0);
            if (!Number.isFinite(actualStock) || actualStock !== line.expectedStock) {
                throw new Error(`El stock cambió antes de aplicar: esperado ${line.expectedStock}, actual ${actualStock}`);
            }
            baseByProduct.set(productKey, line);
        }

        const currentPlanProduct = plannedProducts.get(product.id) || product;
        const adjustment = calculateSupervisorInventoryBatchAdjustment(currentPlanProduct, {
            direction: payload.direction,
            productId: line.productId,
            quantityInput: line.quantityInput,
            inputUnit: line.inputUnit,
            unitsPerPackage: line.unitsPerPackage ?? 1,
            expectedStock: currentPlanProduct.stock,
            reason: payload.reason,
            reasonCategory: payload.reasonCategory,
            lotReference: payload.lotReference,
        }, {
            commandId,
            timestamp,
            movementId: `supervisor-${commandId}-${line.lineId || index}`,
        });
        plannedProducts.set(product.id, adjustment.product);
        lineResults.push({
            lineId: line.lineId || String(index),
            productId: productKey,
            ...adjustment,
        });
    }

    const updatedProducts = products.map(product => plannedProducts.get(product.id) || product);
    const updatedSales = [...sales, ...lineResults.map(result => result.movement)];
    return { updatedProducts, updatedSales, lineResults };
}

// ── Persistencia local recuperable e idempotente (Fase 9) ───────────────────
// Gate comprobado antes de editar: storageService.setItem TRAGA errores
// (fallback a localStorage, cola de reintentos por cuota) y solo relanza los de
// CircuitBreaker: no se puede asumir que rechace en fallo. Por eso toda
// escritura se verifica leyendo el valor de vuelta (writeVerified). La
// abstracción de storage escribe UNA clave por operación: no existe transacción
// multi-documento. En lugar de prometer ACID sin prueba, se usa un journal
// write-ahead (commandId, snapshots antes/después y estado) con recuperación
// determinista:
//   - state 'pending'      → intención de aplicar: la recuperación avanza
//                            (roll-forward) hasta los snapshots 'after'.
//   - state 'rolling_back' → intención de revertir: la recuperación vuelve a
//                            los snapshots 'before'.
// Un resultado incierto bloquea nuevas operaciones de inventario con un error
// 'recoverable' (nunca 'rejected'). Los eventos los emite el llamador solo
// cuando esta función resuelve (estado local consistente). Debe ejecutarse
// bajo pos_write_lock (ver useRemoteCommands).

export const SUPERVISOR_INVENTORY_JOURNAL_KEY = 'bodega_supervisor_inventory_journal_v1';
const INVENTORY_DOC_KEYS = Object.freeze(['bodega_products_v1', 'bodega_sales_v1']);

export class InventoryStateError extends Error {
    constructor(message, { commandId = null, recoverable = true, status = 'recoverable', cause = null } = {}) {
        super(message);
        this.name = 'InventoryStateError';
        this.commandId = commandId;
        this.recoverable = recoverable;
        this.status = status;
        this.cause = cause;
    }
}

/**
 * El journal solo puede referir los dos documentos de inventario conocidos:
 * un journal corrupto nunca debe autorizar escrituras sobre otras claves.
 */
function isValidInventoryJournal(journal) {
    if (!journal || typeof journal !== 'object') return false;
    if (journal.version !== 1 || typeof journal.commandId !== 'string') return false;
    if (journal.state !== 'pending' && journal.state !== 'rolling_back') return false;
    if (!Array.isArray(journal.docs) || journal.docs.length !== INVENTORY_DOC_KEYS.length) return false;
    const keys = journal.docs.map(doc => doc?.key);
    return INVENTORY_DOC_KEYS.every(key => keys.includes(key))
        && new Set(keys).size === keys.length
        && journal.docs.every(doc => doc && 'before' in doc && 'after' in doc);
}

/**
 * Escribe y confirma por lectura de vuelta. Como storageService puede tragar
 * el error de escritura, la única prueba de durabilidad es releer el valor.
 */
async function writeVerified(storage, key, value, { commandId = null } = {}) {
    await storage.setItem(key, value);
    const readBack = await storage.getItem(key, null);
    if (JSON.stringify(readBack ?? null) !== JSON.stringify(value ?? null)) {
        throw new InventoryStateError(`La escritura de ${key} no se confirmó en el almacenamiento local`, { commandId });
    }
}

async function clearJournalVerified(storage, commandId) {
    if (typeof storage.removeItem === 'function') await storage.removeItem(SUPERVISOR_INVENTORY_JOURNAL_KEY);
    else await storage.setItem(SUPERVISOR_INVENTORY_JOURNAL_KEY, null);
    const left = await storage.getItem(SUPERVISOR_INVENTORY_JOURNAL_KEY, null);
    if (left !== null && left !== undefined) {
        throw new InventoryStateError('El journal de inventario no se pudo retirar', { commandId });
    }
}

/**
 * Recuperación determinista e idempotente. Resuelve el journal pendiente según
 * su intención registrada ('pending' → after, 'rolling_back' → before) y lo
 * retira. Llamarla dos veces es inofensivo: sin journal no hace nada. Un
 * journal 'published_pending' no se toca: el estado local ya quedó aplicado y
 * verificado, solo falta publicar en la nube (eso lo resuelve
 * retryInventoryPublish), y no debe bloquear el siguiente lote. Si la
 * escritura sigue fallando, propaga un error 'recoverable' y el journal queda
 * intacto para el siguiente intento: las operaciones de inventario quedan
 * bloqueadas hasta recuperar, nunca se reportan como 'rejected'.
 */
export async function recoverSupervisorInventoryJournal(storage) {
    const journal = await storage.getItem(SUPERVISOR_INVENTORY_JOURNAL_KEY, null);
    if (!journal) return { recovered: false, commandId: null, direction: null };
    if (journal.state === 'published_pending') {
        // Estado local consistente; la publicación pendiente se reintenta aparte y
        // sus documentos (snapshot del estado acumulado) los subsume el lote
        // siguiente, cuyo snapshot cubre el mismo estado más lo nuevo.
        return { recovered: false, commandId: journal.commandId, direction: 'publish_pending' };
    }
    if (!isValidInventoryJournal(journal)) {
        throw new InventoryStateError('Journal de inventario ilegible; se requiere intervención', {
            commandId: typeof journal?.commandId === 'string' ? journal.commandId : null,
        });
    }

    const direction = journal.state === 'rolling_back' ? 'rollback' : 'rollforward';
    const targetField = direction === 'rollback' ? 'before' : 'after';
    try {
        for (const doc of journal.docs) {
            await writeVerified(storage, doc.key, doc[targetField], { commandId: journal.commandId });
        }
        await clearJournalVerified(storage, journal.commandId);
    } catch (error) {
        throw new InventoryStateError(
            `Lote ${journal.commandId} en estado recuperable: recuperación pendiente — ${error?.message || error}`,
            { commandId: journal.commandId, cause: error },
        );
    }
    return { recovered: true, commandId: journal.commandId, direction };
}

/**
 * Aplica un ajuste de inventario (v1 de una línea o v2 multiartículo) con
 * persistencia local recuperable. Valida el plan completo antes de escribir
 * nada (todo-o-nada), journal write-ahead, escrituras verificadas y rollback
 * con intención registrada si la publicación remota falla.
 * Fase 11: `onLocalApplied` se invoca en cuanto el estado local es durable y
 * ANTES de la publicación cloud, para que el ACK no espere a la nube.
 */
export async function applySupervisorInventoryBatchTransaction({
    storage,
    pushSync,
    payload,
    commandId,
    timestamp = new Date().toISOString(),
    onLocalApplied,
}) {
    // 1. Resolver cualquier incertidumbre previa: nunca acumular journals.
    await recoverSupervisorInventoryJournal(storage);

    const currentProducts = (await storage.getItem('bodega_products_v1', [])) || [];
    const currentSales = (await storage.getItem('bodega_sales_v1', [])) || [];

    // 2. Validar el plan completo (todo-o-nada) antes de escribir nada.
    let result;
    if (Array.isArray(payload?.lines)) {
        result = calculateSupervisorInventoryBatchPlan(currentProducts, currentSales, payload, {
            commandId,
            timestamp,
        });
        result.unitsDelta = result.lineResults.reduce((sum, line) => sum + line.unitsDelta, 0);
    } else {
        const product = currentProducts.find(item => String(item.id) === String(payload.productId));
        if (!product) throw new Error('Producto no encontrado');
        const adjustment = calculateSupervisorInventoryBatchAdjustment(product, payload, {
            commandId,
            timestamp,
        });
        result = {
            ...adjustment,
            updatedProducts: currentProducts.map(item => item.id === product.id ? adjustment.product : item),
            updatedSales: [...currentSales, adjustment.movement],
        };
    }
    const { updatedProducts, updatedSales } = result;

    // 3. Journal write-ahead con snapshots antes/después.
    const journal = {
        version: 1,
        commandId,
        state: 'pending',
        createdAt: timestamp,
        docs: [
            { key: 'bodega_products_v1', before: currentProducts, after: updatedProducts },
            { key: 'bodega_sales_v1', before: currentSales, after: updatedSales },
        ],
    };
    await writeVerified(storage, SUPERVISOR_INVENTORY_JOURNAL_KEY, journal, { commandId });

    // 4. Aplicar los dos documentos con escritura verificada.
    try {
        for (const doc of journal.docs) {
            await writeVerified(storage, doc.key, doc.after, { commandId });
        }
    } catch (error) {
        // Estado mixto transitorio: el journal permite recuperar hacia adelante.
        throw new InventoryStateError(
            `Lote ${commandId} en estado recuperable: ${error?.message || error}`,
            { commandId, cause: error },
        );
    }

    // 5. El estado local ya es durable: este es el momento de confirmar la orden
    //    (ACK) hacia el supervisor, ANTES de cualquier publicación cloud. Un
    //    error del hook jamás interrumpe la aplicación ni la publicación.
    if (typeof onLocalApplied === 'function') {
        try {
            await onLocalApplied({ ...result, commandId });
        } catch (error) {
            console.warn('[SupervisorInventory] No se pudo confirmar el lote antes de publicar', {
                commandId,
                error: error?.message || error,
            });
        }
    }

    // 6. Publicación remota. El estado local ya es consistente y verificado: un
    //    fallo de publicación NO revierte el movimiento (la orden ya se confirmó
    //    en el paso 5). Se marca el journal como 'published_pending' para
    //    reintentar solo la publicación con el mismo commandId, sin volver a
    //    aplicar el movimiento.
    const pushed = await publishInventoryDocs(pushSync, updatedProducts, updatedSales);
    if (!pushed.ok) {
        await writeVerified(storage, SUPERVISOR_INVENTORY_JOURNAL_KEY, { ...journal, state: 'published_pending', pendingKeys: pushed.failedKeys }, { commandId });
        return {
            ...result,
            commandId,
            status: 'applied_with_warnings',
            pendingPublish: { commandId, keys: pushed.failedKeys, error: pushed.error },
        };
    }

    // 7. Estado local consistente y publicado: retirar el journal.
    await clearJournalVerified(storage, commandId);
    return { ...result, commandId, status: 'applied' };
}

/**
 * Publica los dos documentos de inventario. Devuelve las claves que fallaron
 * para reintentar solo esas. Un rechazo o excepción cuenta como fallo.
 */
async function publishInventoryDocs(pushSync, updatedProducts, updatedSales, keys = INVENTORY_DOC_KEYS) {
    const allDocs = [
        { key: 'bodega_products_v1', value: updatedProducts },
        { key: 'bodega_sales_v1', value: updatedSales },
    ];
    const docs = allDocs.filter(doc => keys.includes(doc.key));
    const outcomes = await Promise.all(docs.map(async doc => {
        try {
            const res = await pushSync(doc.key, doc.value, true);
            return res?.ok ? null : { key: doc.key, error: res?.error || 'sin confirmación' };
        } catch (error) {
            return { key: doc.key, error: error?.message || String(error) };
        }
    }));
    const failed = outcomes.filter(Boolean);
    return {
        ok: failed.length === 0,
        failedKeys: failed.map(item => item.key),
        error: failed[0]?.error || null,
    };
}

/**
 * Reintenta la publicación pendiente de un lote ya aplicado localmente. No
 * modifica catálogo ni historial: solo vuelve a publicar los documentos
 * registrados en el journal 'published_pending' con el mismo commandId.
 */
export async function retryInventoryPublish({ storage, pushSync }) {
    const journal = await storage.getItem(SUPERVISOR_INVENTORY_JOURNAL_KEY, null);
    if (!journal || journal.state !== 'published_pending') return { retried: false, ok: true };
    if (!isValidInventoryJournal({ ...journal, state: 'pending' })) {
        throw new InventoryStateError('Journal de publicación ilegible; se requiere intervención', {
            commandId: typeof journal?.commandId === 'string' ? journal.commandId : null,
        });
    }
    const currentByKey = Object.fromEntries(journal.docs.map(doc => [doc.key, doc.after]));
    const keys = Array.isArray(journal.pendingKeys) && journal.pendingKeys.length
        ? journal.pendingKeys
        : INVENTORY_DOC_KEYS;
    const pushed = await publishInventoryDocs(
        (key, value, force) => pushSync(key, value, force),
        currentByKey.bodega_products_v1,
        currentByKey.bodega_sales_v1,
        keys,
    );
    if (!pushed.ok) {
        await writeVerified(storage, SUPERVISOR_INVENTORY_JOURNAL_KEY, { ...journal, pendingKeys: pushed.failedKeys }, { commandId: journal.commandId });
        return { retried: true, ok: false, commandId: journal.commandId, failedKeys: pushed.failedKeys };
    }
    await clearJournalVerified(storage, journal.commandId);
    return { retried: true, ok: true, commandId: journal.commandId };
}

export default {
    calculateSupervisorInventoryBatchAdjustment,
    calculateSupervisorInventoryBatchPlan,
    applySupervisorInventoryBatchTransaction,
    recoverSupervisorInventoryJournal,
    InventoryStateError,
    SUPERVISOR_INVENTORY_JOURNAL_KEY,
};
