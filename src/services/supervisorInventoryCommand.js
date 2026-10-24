import { isGranelProduct, normalizeStockValue } from '../utils/granel'; // GRANEL-001
import { INVENTORY_INPUT_UNITS, resolveInventoryUnitConversion } from './supervisorInventoryDraft';
import { INVENTORY_MAX_EXPECTED_STOCK } from './supervisorContracts';

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
        // expectedStock describe la base real de la caja y puede ser negativa
        // (saldo negativo legítimo); se acota simétricamente contra basura.
        || !Number.isFinite(expectedStock) || Math.abs(expectedStock) > INVENTORY_MAX_EXPECTED_STOCK
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
    // El piso en 0 protege los EGRESOS (no se despacha lo que no hay). Un
    // ingreso desde saldo negativo que sigue en negativo es una corrección
    // legítima hacia arriba y no debe bloquearse.
    if (isEgress && stockAfter < 0) throw new Error('Stock insuficiente para el egreso');
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
// Desacople del lote de inventario de la publicación de productos
// (docs/plans/2026-10-22-plan-desacoplar-lote-inventario-de-publicacion-de-productos.md):
// los dos planos que compartían vocabulario se separan —
//   - INVENTORY_LOCAL_KEYS: lo que el journal debe poder RECUPERAR (ambos
//     documentos; garantía local con snapshots before/after).
//   - INVENTORY_PUBLISH_KEYS: lo que se le debe a la NUBE (solo la familia de
//     ventas: los movimientos del lote viajan con stockBefore/stockAfter/
//     unitsDelta y el monitor deriva el stock visible como baseline + efectos,
//     así que un cambio de stock puro no necesita re-publicar el catálogo).
// Un journal legacy puede seguir debiendo productos (pendingKeys con ambas
// claves, o sin pendingKeys): pendingKeys manda y el fallback publica ambos.
const INVENTORY_LOCAL_KEYS = Object.freeze(['bodega_products_v1', 'bodega_sales_v1']);
const INVENTORY_PUBLISH_KEYS = Object.freeze(['bodega_sales_v1']);

// ── Snapshots del journal como strings (Fase 4 del plan de cuelgue) ─────────
// El journal write-ahead duplica ambos documentos (before+after): con el
// catálogo real (~1.3 MB) eso eran ~4 MB de objetos que writeVerified volvía a
// serializar dos veces y que el storage clonaba por completo en cada escritura.
// Cada snapshot viaja ahora como UN string con marca propia ('j1:' + JSON), lo
// que abarata los clones (copiar un string, no recorrer un grafo de objetos) y
// permite comparar sin volver a serializar. NO se comprime: medido contra el
// backup real, compressString (gzip + base64 + FileReader) cuesta ~7× el
// stringify que ahorra en este entorno — complejidad sin ganancia medida.
// La marca se auto-describe en el propio valor, así que un journal sigue siendo
// versión 1 y los journals viejos (valores en claro) se leen igual: los valores
// no-string se usan tal cual. Un snapshot marcado ilegible falla de forma
// segura (error 'recoverable' y journal intacto), nunca escribe basura.
export const JOURNAL_SNAPSHOT_PREFIX = 'j1:';

function packJournalJson(json) {
    return `${JOURNAL_SNAPSHOT_PREFIX}${json}`;
}

function unpackJournalValue(raw) {
    if (typeof raw !== 'string') return raw; // journal legacy: valores en claro
    if (raw.startsWith(JOURNAL_SNAPSHOT_PREFIX)) {
        return JSON.parse(raw.slice(JOURNAL_SNAPSHOT_PREFIX.length));
    }
    throw new Error('Snapshot de journal con formato desconocido');
}

/**
 * Igualdad profunda estricta para confirmar escrituras del journal sin volver a
 * serializar: sus snapshots son strings y se comparan directo (===). Es más
 * estricta que la comparación por JSON (un `undefined` normalizado por el
 * storage contaría como diferencia), en la dirección segura: nunca da por
 * buena una escritura que no coincide. Solo se usa para el journal, cuyos
 * valores construimos nosotros (strings y escalares, sin huecos).
 */
function sameStoredValue(a, b) {
    if (a === b) return true;
    if (Array.isArray(a) || Array.isArray(b)) {
        return Array.isArray(a) && Array.isArray(b)
            && a.length === b.length
            && a.every((item, index) => sameStoredValue(item, b[index]));
    }
    if (a && b && typeof a === 'object' && typeof b === 'object') {
        const keys = Object.keys(a);
        return keys.length === Object.keys(b).length
            && keys.every(key => sameStoredValue(a[key], b[key]));
    }
    return false;
}

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
    if (!Array.isArray(journal.docs) || journal.docs.length !== INVENTORY_LOCAL_KEYS.length) return false;
    const keys = journal.docs.map(doc => doc?.key);
    return INVENTORY_LOCAL_KEYS.every(key => keys.includes(key))
        && new Set(keys).size === keys.length
        && journal.docs.every(doc => doc && 'before' in doc && 'after' in doc);
}

/**
 * Escribe y confirma por lectura de vuelta. Como storageService puede tragar
 * el error de escritura, la única prueba de durabilidad es releer el valor.
 *  - `expectedJson` reutiliza una serialización ya calculada del valor (la del
 *    snapshot del journal) y no repite el stringify: la comparación sigue
 *    siendo exacta, byte a byte, contra lo que devuelve el storage.
 *  - `compare: 'deep'` compara por igualdad profunda en vez de serializar (para
 *    el journal, cuyos snapshots son strings y se comparan directo).
 *  - `skipSyncPush` se propaga al interceptor de storageService: la escritura
 *    local es igual de durable, pero no encola la publicación cloud (misma
 *    costura que usan checkout/void para el stock puro). La lectura de vuelta
 *    y la comparación no cambian.
 */
async function writeVerified(storage, key, value, { commandId = null, expectedJson, compare = 'json', skipSyncPush = false } = {}) {
    await storage.setItem(key, value, skipSyncPush ? { skipSyncPush: true } : undefined);
    const readBack = await storage.getItem(key, null);
    const confirmed = compare === 'deep'
        ? sameStoredValue(readBack ?? null, value ?? null)
        : JSON.stringify(readBack ?? null) === (expectedJson !== undefined ? expectedJson : JSON.stringify(value ?? null));
    if (!confirmed) {
        throw new InventoryStateError(`La escritura de ${key} no se confirmó en el almacenamiento local`, { commandId });
    }
}

/**
 * El journal pertenece a un comando hasta que otro lo reemplaza. Toda
 * transición posterior (retirarlo, marcar pendientes) debe verificar ownership:
 * una publicación/reintento en vuelo de un comando viejo jamás debe borrar ni
 * sobrescribir el journal del comando que ya está en curso (Fase 2 del plan
 * docs/plans/2026-10-21-plan-fix-cuelgue-caja-comandos-supervisor.md).
 */
async function journalOwnedBy(storage, commandId) {
    const current = await storage.getItem(SUPERVISOR_INVENTORY_JOURNAL_KEY, null);
    return current == null || current.commandId === commandId;
}

async function clearJournalVerified(storage, commandId) {
    // Ownership: si otro comando ya escribió su journal, este cierre no le
    // pertenece y debe ser no-op.
    if (!(await journalOwnedBy(storage, commandId))) return;
    if (typeof storage.removeItem === 'function') await storage.removeItem(SUPERVISOR_INVENTORY_JOURNAL_KEY);
    else await storage.setItem(SUPERVISOR_INVENTORY_JOURNAL_KEY, null);
    const left = await storage.getItem(SUPERVISOR_INVENTORY_JOURNAL_KEY, null);
    if (left !== null && left !== undefined) {
        throw new InventoryStateError('El journal de inventario no se pudo retirar', { commandId });
    }
}

/**
 * H3 (auditoría 2026-10-22): fusión sin pisar para la recuperación del journal.
 *
 * Cuando el estado actual de un documento coincide con uno de los extremos del
 * journal la resolución es directa (escribir el extremo objetivo). Cuando
 * coincide con NINGUNO, hubo trabajo posterior al corte y el snapshot NO puede
 * escribirse a ciegas (borraría la venta intermedia del cajero):
 *  - `bodega_sales_v1`: los movimientos del lote (los que están en `after` y no
 *    en `before`, con id estable) se aseguran (roll-forward) o se retiran
 *    (rollback) por id; todo lo demás del historial se conserva intacto. Es una
 *    fusión precisa: jamás pierde ni duplica entradas del cajero.
 *  - `bodega_products_v1`: el lote escribe productos ANTES que ventas, así que
 *    la presencia de los movimientos del lote en el historial dice si el efecto
 *    en stock ya se aplicó. Si está aplicado, el stock actual se conserva tal
 *    cual (incluida cualquier venta posterior). Si la evidencia no alcanza
 *    (movimientos ausentes con stock ya movido), cualquier elección sería una
 *    mentira silenciosa: se ESCALA con un error 'recoverable' «se requiere
 *    intervención» y el journal queda intacto, sin pisar nada.
 */
export function mergeRecoveredInventoryDoc(key, { current, before, after, direction, batchAppliedInLedger = false }) {
    const currentList = Array.isArray(current) ? current : [];
    const beforeList = Array.isArray(before) ? before : [];
    const afterList = Array.isArray(after) ? after : [];
    const targetList = direction === 'rollback' ? beforeList : afterList;

    if (key === 'bodega_sales_v1') {
        const beforeIds = new Set(beforeList.map(item => item?.id));
        const batchItems = afterList.filter(item => item?.id != null && !beforeIds.has(item.id));
        if (direction === 'rollback') {
            const removeIds = new Set(batchItems.map(item => item.id));
            return currentList.filter(item => !removeIds.has(item?.id));
        }
        const currentIds = new Set(currentList.map(item => item?.id));
        return [...currentList, ...batchItems.filter(item => !currentIds.has(item.id))];
    }

    if (key === 'bodega_products_v1') {
        const targetById = new Map(targetList.map(item => [String(item?.id), item]));
        const otherList = direction === 'rollback' ? afterList : beforeList;
        const otherById = new Map(otherList.map(item => [String(item?.id), item]));
        return currentList.map(item => {
            const target = targetById.get(String(item?.id));
            const other = otherById.get(String(item?.id));
            if (!target || !other || sameStoredValue(item, target)) return item;
            // El lote no tocó este producto (ambos extremos idénticos): el
            // trabajo posterior (una venta) se conserva tal cual.
            if (sameStoredValue(target, other)) return item;
            if (sameStoredValue(item, other)) return target;
            // Producto afectado por el lote con un estado que no es ninguno de
            // los dos extremos: solo se confía en el libro de ventas.
            if (direction === 'rollforward' && batchAppliedInLedger) return item;
            throw new InventoryStateError(
                'Estado mixto tras el corte: el stock del producto no coincide con ningún extremo del lote y el historial no confirma el efecto; se requiere intervención',
                { status: 'recoverable' },
            );
        });
    }

    // isValidInventoryJournal solo admite los dos documentos de inventario.
    return targetList;
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
        // Primero se RESUELVE todo (leyendo ambos documentos) y luego se escribe
        // en el orden original del lote (productos y después ventas): la
        // presencia de los movimientos en el historial sigue siendo una
        // evidencia válida incluso si la propia recuperación se interrumpe.
        const resolvedByKey = new Map();
        // La evidencia del libro de ventas se calcula PRIMERO: el journal lista
        // productos antes que ventas, y la resolución del catálogo la necesita.
        let batchAppliedInLedger = false;
        for (const doc of journal.docs) {
            if (doc.key !== 'bodega_sales_v1') continue;
            const beforeList = Array.isArray(await unpackJournalValue(doc.before)) ? await unpackJournalValue(doc.before) : [];
            const afterList = Array.isArray(await unpackJournalValue(doc.after)) ? await unpackJournalValue(doc.after) : [];
            const batchIds = afterList
                .filter(item => item?.id != null && !beforeList.some(b => b?.id === item.id))
                .map(item => item.id);
            const currentList = await storage.getItem(doc.key, null);
            const currentIds = new Set((Array.isArray(currentList) ? currentList : []).map(item => item?.id));
            batchAppliedInLedger = batchIds.length > 0 && batchIds.every(id => currentIds.has(id));
        }
        for (const doc of journal.docs) {
            const target = await unpackJournalValue(doc[targetField]);
            const other = await unpackJournalValue(doc[targetField === 'after' ? 'before' : 'after']);
            const before = await unpackJournalValue(doc.before);
            const after = await unpackJournalValue(doc.after);
            const current = await storage.getItem(doc.key, null);
            let resolved = target;
            if (!sameStoredValue(current ?? null, target ?? null)
                && !sameStoredValue(current ?? null, other ?? null)) {
                // H3 (auditoría 2026-10-22): el estado actual coincide con
                // NINGUNO de los dos extremos del journal → hubo escrituras
                // intermedias desde el corte (una venta del cajero). Escribir el
                // snapshot a ciegas las borraría: se fusiona en su lugar (y si la
                // fusión no puede decidirse con evidencia, se escala sin tocar
                // nada en vez de inventar un resultado).
                resolved = mergeRecoveredInventoryDoc(doc.key, {
                    current,
                    before,
                    after,
                    direction,
                    batchAppliedInLedger,
                });
            }
            resolvedByKey.set(doc.key, { current, resolved });
        }
        for (const doc of journal.docs) {
            const { current, resolved } = resolvedByKey.get(doc.key);
            if (!sameStoredValue(current ?? null, resolved ?? null)) {
                await writeVerified(storage, doc.key, resolved, { commandId: journal.commandId });
            }
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
    // Fase 2 (plan de cuelgue de caja): con `deferPublish` la transacción llega
    // hasta el estado local durable y deja el journal en 'published_pending'; la
    // publicación cloud la ejecuta el caller FUERA de pos_write_lock (vía
    // retryInventoryPublish, que publica el estado fresco del storage).
    deferPublish = false,
}) {
    // 1. Resolver cualquier incertidumbre previa: nunca acumular journals.
    await recoverSupervisorInventoryJournal(storage);

    const currentProducts = (await storage.getItem('bodega_products_v1', [])) || [];
    const currentSales = (await storage.getItem('bodega_sales_v1', [])) || [];

    // H2 (auditoría 2026-10-22): los movimientos del supervisor llevan el
    // commandId. Si ya están en el historial, el lote se aplicó antes de un
    // corte y solo se perdió el ACK: reaplicarlo duplicaría el ajuste, y la
    // guarda de expectedStock lo rechazaría con un falso «failed». No-op
    // aplicado que re-confirma sin tocar nada. (El historial se escribe en una
    // sola escritura, así que movimientos parciales no son un caso real.)
    const priorMovements = currentSales.filter(item => (
        item && item.source === 'supervisor' && item.commandId === commandId
    ));
    if (priorMovements.length > 0) {
        const alreadyApplied = {
            lineResults: [],
            unitsDelta: priorMovements.reduce((sum, item) => sum + Number(item.unitsDelta || 0), 0),
            stockBefore: priorMovements[0].stockBefore,
            stockAfter: priorMovements[priorMovements.length - 1].stockAfter,
            updatedProducts: currentProducts,
            updatedSales: currentSales,
            alreadyApplied: true,
        };
        if (typeof onLocalApplied === 'function') {
            try {
                await onLocalApplied({ ...alreadyApplied, commandId });
            } catch (error) {
                console.warn('[SupervisorInventory] No se pudo confirmar el lote antes de publicar', {
                    commandId,
                    error: error?.message || error,
                });
            }
        }
        return { ...alreadyApplied, commandId, status: 'applied' };
    }

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

    // 3. Journal write-ahead con snapshots antes/después. Fase 4: cada
    //    snapshot viaja como un string marcado; la serialización del "after" se
    //    reutiliza después como comprobación de la escritura verificada, así
    //    cada documento se serializa una sola vez.
    const beforeProductsJson = JSON.stringify(currentProducts ?? null);
    const afterProductsJson = JSON.stringify(updatedProducts ?? null);
    const beforeSalesJson = JSON.stringify(currentSales ?? null);
    const afterSalesJson = JSON.stringify(updatedSales ?? null);
    const journal = {
        version: 1,
        commandId,
        state: 'pending',
        createdAt: timestamp,
        docs: [
            {
                key: 'bodega_products_v1',
                before: packJournalJson(beforeProductsJson),
                after: packJournalJson(afterProductsJson),
            },
            {
                key: 'bodega_sales_v1',
                before: packJournalJson(beforeSalesJson),
                after: packJournalJson(afterSalesJson),
            },
        ],
    };
    await writeVerified(storage, SUPERVISOR_INVENTORY_JOURNAL_KEY, journal, { commandId, compare: 'deep' });

    // 4. Aplicar los dos documentos con escritura verificada. Los valores van
    //    en claro (los snapshots del journal son respaldo, no la fuente de la
    //    escritura) y su serialización "after" ya está calculada.
    const targetsByKey = {
        // Productos CON skipSyncPush: el lote es stock-puro y ese cambio ya
        // viaja como efecto en los movimientos de la familia de ventas; sin la
        // bandera el interceptor vuelve a subir el catálogo entero en el
        // debounce (~1.3 MB por lote) y el desacople no entrega nada medible.
        bodega_products_v1: { value: updatedProducts, json: afterProductsJson, skipSyncPush: true },
        // Ventas SIN la bandera: su auto-enqueue queda como red de seguridad
        // (§3.1.6 del plan de desacople) y el dedup por hash evita el segundo
        // viaje cuando la publicación del journal ya subió la familia.
        bodega_sales_v1: { value: updatedSales, json: afterSalesJson, skipSyncPush: false },
    };
    try {
        for (const doc of journal.docs) {
            const target = targetsByKey[doc.key];
            await writeVerified(storage, doc.key, target.value, {
                commandId,
                expectedJson: target.json,
                skipSyncPush: target.skipSyncPush,
            });
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
    if (deferPublish) {
        // El caller publica fuera del lock; el journal en 'published_pending' es
        // la intención registrada que hace la publicación recuperable.
        await writeVerified(
            storage,
            SUPERVISOR_INVENTORY_JOURNAL_KEY,
            { ...journal, state: 'published_pending', pendingKeys: [...INVENTORY_PUBLISH_KEYS] },
            { commandId, compare: 'deep' },
        );
        return {
            ...result,
            commandId,
            status: 'applied',
            publishDeferred: true,
            pendingPublish: { commandId, keys: [...INVENTORY_PUBLISH_KEYS], error: null },
        };
    }

    const pushed = await publishInventoryDocs(pushSync, updatedProducts, updatedSales, INVENTORY_PUBLISH_KEYS);
    if (!pushed.ok) {
        await writeVerified(storage, SUPERVISOR_INVENTORY_JOURNAL_KEY, { ...journal, state: 'published_pending', pendingKeys: pushed.failedKeys }, { commandId, compare: 'deep' });
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
 *
 * Fase 3 (plan de cuelgue de caja): la familia de ventas se publica SIN force
 * para que pushCloudSync compare el hash por periodo/shard y solo reescriba
 * los documentos que cambiaron (el lote típico agrega movimientos al periodo
 * corriente; reescribir todo el historial era puro trabajo perdido). El hash
 * por doc se registra solo tras un upsert confirmado, así que un fallo parcial
 * se reintegra en el siguiente intento sin perder nada. El vaciado total sigue
 * publicando tumbas porque su hash cambia respecto al último push.
 *
 * Desacople (2026-10-22): el lote publica SOLO la familia de ventas
 * (INVENTORY_PUBLISH_KEYS). La entrada de productos con force: true (monolítico,
 * sin hash por periodos) queda solo para los journals legacy que aún la deban
 * según su pendingKeys.
 */
async function publishInventoryDocs(pushSync, updatedProducts, updatedSales, keys = INVENTORY_LOCAL_KEYS) {
    const allDocs = [
        { key: 'bodega_products_v1', value: updatedProducts, force: true },
        { key: 'bodega_sales_v1', value: updatedSales, force: false },
    ];
    const docs = allDocs.filter(doc => keys.includes(doc.key));
    const outcomes = await Promise.all(docs.map(async doc => {
        try {
            const res = await pushSync(doc.key, doc.value, doc.force);
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
    // El retry publica el estado ACTUAL del storage, no los snapshots 'after'
    // del journal: si el cajero escribió después (una venta), empujar el
    // snapshot viejo la borraría en la nube (last-write-wins). El snapshot solo
    // es fallback si la clave desapareció del storage.
    const currentByKey = {};
    for (const doc of journal.docs) {
        const fresh = await storage.getItem(doc.key, null);
        // El snapshot 'after' (en claro o comprimido) solo es fallback si la
        // clave desapareció del storage.
        currentByKey[doc.key] = Array.isArray(fresh) ? fresh : await unpackJournalValue(doc.after);
    }
    // pendingKeys manda (migración perezosa §4): un journal nuevo solo debe la
    // familia de ventas; un journal legacy con ambas claves (o sin pendingKeys)
    // se liquida con la semántica con la que se escribió.
    const keys = Array.isArray(journal.pendingKeys) && journal.pendingKeys.length
        ? journal.pendingKeys
        : INVENTORY_LOCAL_KEYS;
    const pushed = await publishInventoryDocs(
        (key, value, force) => pushSync(key, value, force),
        currentByKey.bodega_products_v1,
        currentByKey.bodega_sales_v1,
        keys,
    );
    if (!pushed.ok) {
        // Ownership: solo actualiza el journal si sigue siendo de este comando.
        if (await journalOwnedBy(storage, journal.commandId)) {
            await writeVerified(storage, SUPERVISOR_INVENTORY_JOURNAL_KEY, { ...journal, pendingKeys: pushed.failedKeys }, { commandId: journal.commandId, compare: 'deep' });
        }
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
