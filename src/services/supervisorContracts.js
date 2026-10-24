// Contratos puros del Modo Supervisor.
// Este módulo no conoce React, Supabase ni localStorage: sirve como frontera
// común para validar datos antes de conectarlos a persistencia o Realtime.
import {
    buildProductRevision,
    EDITABLE_PRODUCT_FIELDS,
    extractEditableProductPatch,
    normalizeProductFieldValue,
    resolveEffectivePriceUsd,
} from './supervisorProductCommand';

export {
    buildProductRevision,
    EDITABLE_PRODUCT_FIELDS,
    extractEditableProductPatch,
    normalizeProductFieldValue,
    resolveEffectivePriceUsd,
};

export const PAIRING_STATES = Object.freeze({
    PENDING: 'pending',
    PAIRED: 'paired',
    EXPIRED: 'expired',
    REVOKED: 'revoked',
});

const PAIRING_TRANSITIONS = Object.freeze({
    [PAIRING_STATES.PENDING]: new Set([PAIRING_STATES.PAIRED, PAIRING_STATES.EXPIRED, PAIRING_STATES.REVOKED]),
    [PAIRING_STATES.PAIRED]: new Set([PAIRING_STATES.REVOKED]),
    [PAIRING_STATES.EXPIRED]: new Set([PAIRING_STATES.PENDING, PAIRING_STATES.REVOKED]),
    [PAIRING_STATES.REVOKED]: new Set([PAIRING_STATES.PENDING]),
});

export function canTransitionPairing(from, to) {
    return from === to || Boolean(PAIRING_TRANSITIONS[from]?.has(to));
}

export function canMonitorRead(state) {
    return state === PAIRING_STATES.PAIRED;
}

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isBooleanLike = (value) => value === true || value === false || value === 'true' || value === 'false';
const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const SYNC_VALIDATORS = Object.freeze({
    bodega_products_v1: Array.isArray,
    bodega_customers_v1: Array.isArray,
    bodega_customer_ledger_v1: Array.isArray,
    bodega_sales_v1: Array.isArray,
    bodega_payment_methods_v1: Array.isArray,
    bodega_accounts_v2: Array.isArray,
    abasto_audit_log_v1: Array.isArray,
    monitor_rates_v12: isPlainObject,
    bodega_custom_rate: (value) => {
        const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
        return isFiniteNumber(parsed) && parsed > 0;
    },
    bodega_use_auto_rate: isBooleanLike,
    bodega_rate_mode: (value) => ['bcv', 'euro', 'usdt', 'manual'].includes(value),
    tasa_cop: (value) => isFiniteNumber(Number(value)) && Number(value) >= 0,
    cop_enabled: isBooleanLike,
    auto_cop_enabled: isBooleanLike,
});

export const SUPERVISOR_SYNC_KEYS = Object.freeze(Object.keys(SYNC_VALIDATORS));

export function isSupervisorSyncKey(docId) {
    return typeof docId === 'string' && Object.prototype.hasOwnProperty.call(SYNC_VALIDATORS, docId);
}

export function validateSupervisorSyncDocument(docId, payload) {
    if (!isSupervisorSyncKey(docId)) {
        return { valid: false, error: `Documento no permitido: ${String(docId)}` };
    }

    if (payload == null) {
        return { valid: false, error: `Payload vacío: ${docId}` };
    }

    const valid = SYNC_VALIDATORS[docId](payload);
    return valid
        ? { valid: true, error: null }
        : { valid: false, error: `Schema inválido: ${docId}` };
}

// El PIN NO se cambia por el canal del supervisor: 'supervisor.user.pin.change'
// se retiró de la lista (2026-10-18). validateSupervisorCommand rechaza el tipo
// tanto al emitir como al aplicar, y las ediciones de usuario no pueden llevar
// campos de PIN. Queda en COMMAND_EXTENDED_TTL_TYPES solo por compatibilidad
// histórica; volver a habilitarlo exige reañadir validación de payload.
export const SUPERVISOR_COMMAND_TYPES = Object.freeze([
    'supervisor.rate.set',
    'supervisor.product.create',
    'supervisor.product.update',
    'supervisor.product.delete',
    'supervisor.user.create',
    'supervisor.user.update',
    'supervisor.user.delete',
    'supervisor.shift.close',
    'supervisor.shift.reopen',
    'supervisor.inventory.batch.adjust',
]);

// Campos de PIN que jamás deben viajar en una edición de usuario remota.
const USER_PIN_FIELDS = Object.freeze(['pin', 'pinHash', 'newPin', 'plainPin']);

function carriesPinChange(value) {
    return isPlainObject(value)
        && USER_PIN_FIELDS.some(key => value[key] !== undefined && value[key] !== null);
}

// Fase 5 — TTL por tipo. Los comandos sensibles al tiempo conservan 60 s; los
// de catálogo/inventario/usuarios admiten 5 min para sobrevivir cortes de red.
// El emisor solo usa la ventana extendida con SUPERVISOR_EXTENDED_TTL_ENABLED
// (rollout: migración aplicada + receivers actualizados primero).
const COMMAND_TTL_MS = 60_000;
export const COMMAND_EXTENDED_TTL_MS = 5 * 60_000;
// Cota de seguridad global: jamás se acepta una duración mayor, por tipo que
// sea. La RPC impone la misma cota en servidor.
export const COMMAND_ABSOLUTE_MAX_TTL_MS = 10 * 60_000;
export const COMMAND_EXTENDED_TTL_TYPES = Object.freeze([
    'supervisor.inventory.batch.adjust',
    'supervisor.product.create',
    'supervisor.product.update',
    'supervisor.product.delete',
    'supervisor.user.create',
    'supervisor.user.pin.change',
    'supervisor.user.update',
    'supervisor.user.delete',
]);

export function getCommandMaxTtlMs(type) {
    return COMMAND_EXTENDED_TTL_TYPES.includes(type) ? COMMAND_EXTENDED_TTL_MS : COMMAND_TTL_MS;
}

const MAX_COMMAND_ID_LENGTH = 128;

// ── Contrato inventario batch v2 ──────────────────────────────────────────
// v1 (sin batchVersion) = una línea plana; v2 = cabecera + `lines`.
// El factor/delta enviado NO es autoritativo: la caja recalcula con su catálogo.
export const INVENTORY_BATCH_VERSION = 2;
// 50 líneas: cubre con holgura una recepción típica de bodega y acota el
// payload (~15 KB) y el trabajo de la caja dentro de una sola transacción.
export const INVENTORY_BATCH_MAX_LINES = 50;
export const INVENTORY_REASON_MAX_LENGTH = 240;
export const INVENTORY_LOT_REFERENCE_MAX_LENGTH = 128;
export const INVENTORY_ID_MAX_LENGTH = 128;
export const INVENTORY_REVISION_MAX_LENGTH = 2048;
export const INVENTORY_MAX_EXPECTED_STOCK = 10_000_000;
export const INVENTORY_MAX_UNITS_PER_PACKAGE = 10_000;
// Máximo por unidad capturada; kg/lt/g/ml equivalen a MAX_GRANEL_KG (5000).
export const INVENTORY_MAX_QUANTITY_BY_UNIT = Object.freeze({
    unidades: 100_000,
    cajas: 10_000,
    bultos: 10_000,
    kg: 5_000,
    lt: 5_000,
    g: 5_000_000,
    ml: 5_000_000,
});
export const INVENTORY_EGRESS_CATEGORIES = Object.freeze(['merma', 'danio', 'vencimiento', 'autoconsumo', 'devolucion', 'ajuste']);

const isBoundedString = (value, max, { required = true } = {}) => {
    if (value === undefined || value === null) return !required;
    return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
};

function isValidInventoryBatchLineV2(line) {
    if (!isPlainObject(line)) return false;
    const maxQuantity = INVENTORY_MAX_QUANTITY_BY_UNIT[line.inputUnit];
    return isBoundedString(line.productId, INVENTORY_ID_MAX_LENGTH)
        && isBoundedString(line.lineId, INVENTORY_ID_MAX_LENGTH, { required: false })
        && maxQuantity !== undefined
        && isFiniteNumber(line.quantityInput)
        && line.quantityInput > 0
        && line.quantityInput <= maxQuantity
        && isFiniteNumber(line.expectedStock)
        // expectedStock describe la BASE real de la caja, no un objetivo: puede
        // ser negativa (saldo negativo legítimo con allow_negative_stock). Se
        // acota simétricamente para descartar basura sin penalizar negativos.
        && line.expectedStock >= -INVENTORY_MAX_EXPECTED_STOCK
        && line.expectedStock <= INVENTORY_MAX_EXPECTED_STOCK
        && isBoundedString(line.baseRevision, INVENTORY_REVISION_MAX_LENGTH, { required: false })
        && (line.unitsPerPackage === undefined
            || (Number.isInteger(line.unitsPerPackage)
                && line.unitsPerPackage > 0
                && line.unitsPerPackage <= INVENTORY_MAX_UNITS_PER_PACKAGE));
}

/**
 * Política de duplicados: no puede haber dos líneas con el mismo producto y la
 * misma unidad. Distintas unidades del mismo producto se permiten, pero deben
 * compartir expectedStock y baseRevision (describen el mismo estado base).
 */
function hasConsistentInventoryLines(lines) {
    const seenUnits = new Set();
    const baseByProduct = new Map();
    for (const line of lines) {
        const unitKey = `${line.productId}\u0000${line.inputUnit}`;
        if (seenUnits.has(unitKey)) return false;
        seenUnits.add(unitKey);
        const base = baseByProduct.get(line.productId);
        if (base && (base.expectedStock !== line.expectedStock || base.baseRevision !== line.baseRevision)) return false;
        if (!base) baseByProduct.set(line.productId, line);
    }
    return true;
}

export function validateInventoryBatchV2Payload(payload) {
    return isPlainObject(payload)
        && payload.batchVersion === INVENTORY_BATCH_VERSION
        && ['ingreso', 'egreso'].includes(payload.direction)
        && isBoundedString(payload.reason, INVENTORY_REASON_MAX_LENGTH)
        && (payload.direction === 'egreso'
            ? INVENTORY_EGRESS_CATEGORIES.includes(payload.reasonCategory)
            : (payload.reasonCategory === undefined || INVENTORY_EGRESS_CATEGORIES.includes(payload.reasonCategory)))
        && isBoundedString(payload.lotReference, INVENTORY_LOT_REFERENCE_MAX_LENGTH, { required: false })
        && Array.isArray(payload.lines)
        && payload.lines.length > 0
        && payload.lines.length <= INVENTORY_BATCH_MAX_LINES
        && payload.lines.every(isValidInventoryBatchLineV2)
        && hasConsistentInventoryLines(payload.lines);
}

function validateCommandPayload(type, payload) {
    if (!isPlainObject(payload)) return false;

    switch (type) {
        case 'supervisor.rate.set':
            return ['bcv', 'euro', 'usdt', 'manual'].includes(payload.rateMode)
                && (payload.rateMode !== 'manual'
                    || (isFiniteNumber(Number(payload.customRate)) && Number(payload.customRate) > 0));
        case 'supervisor.product.create':
            return typeof payload.product?.id === 'string' && typeof payload.product?.name === 'string';
        case 'supervisor.product.update':
            return typeof payload.productId === 'string'
                && isPlainObject(payload.patch)
                && typeof payload.baseRevision === 'string'
                && payload.baseRevision.trim().length > 0
                && typeof payload.patch.baseRevision === 'string'
                && payload.patch.baseRevision.trim().length > 0
                && payload.baseRevision === payload.patch.baseRevision
                && (payload.baseUpdatedAt == null
                    || (typeof payload.baseUpdatedAt === 'string' && !Number.isNaN(Date.parse(payload.baseUpdatedAt))));
        case 'supervisor.product.delete':
            return typeof payload.productId === 'string';
        case 'supervisor.user.create':
            return typeof payload.nombre === 'string'
                && ['CAJERO', 'ADMIN'].includes(payload.rol)
                && typeof payload.pinHash === 'string'
                && /^pbkdf2\$\d+\$[^$]+\$[^$]+$/.test(payload.pinHash);
        case 'supervisor.user.update':
            // La edición remota jamás cambia PINs (ni en el payload ni en el
            // patch); si llega uno, el comando entero se rechaza.
            return Number.isFinite(payload.userId)
                && isPlainObject(payload.patch)
                && !carriesPinChange(payload)
                && !carriesPinChange(payload.patch);
        case 'supervisor.user.delete':
            return Number.isFinite(payload.userId);
        case 'supervisor.shift.close':
        case 'supervisor.shift.reopen':
            return typeof payload.shiftId === 'string'
                && payload.shiftId.length > 0
                && typeof payload.cierreId === 'string'
                && payload.cierreId.length > 0;
        case 'supervisor.inventory.batch.adjust':
            // Cualquier batchVersion presente se valida como v2; versiones
            // desconocidas se rechazan. Sin batchVersion = v1 (sin cambios).
            if (payload.batchVersion !== undefined) return validateInventoryBatchV2Payload(payload);
            return ['ingreso', 'egreso'].includes(payload.direction)
                && (payload.direction !== 'egreso' || ['merma', 'danio', 'vencimiento', 'autoconsumo', 'devolucion', 'ajuste'].includes(payload.reasonCategory))
                && typeof payload.productId === 'string'
                && payload.productId.length > 0
                && Number.isFinite(Number(payload.quantityInput))
                && Number(payload.quantityInput) > 0
                && ['unidades', 'cajas', 'bultos', 'kg', 'g', 'lt', 'ml'].includes(payload.inputUnit)
                && Number.isFinite(Number(payload.unitsPerPackage))
                && Number(payload.unitsPerPackage) > 0
                && Number.isFinite(Number(payload.expectedStock))
                && Math.abs(Number(payload.expectedStock)) <= INVENTORY_MAX_EXPECTED_STOCK
                && typeof payload.reason === 'string'
                && payload.reason.trim().length > 0
                && payload.reason.length <= 240;
        default:
            return false;
    }
}

/**
 * Construye un payload v2 consolidando líneas repetidas (mismo producto + unidad)
 * antes del envío. Solo copia campos del contrato: deltas/factores derivados no
 * viajan como autoritativos (unitsPerPackage se envía solo para cajas/bultos).
 */
export function buildInventoryBatchV2Payload({ direction, reason, reasonCategory, lotReference } = {}, lines = []) {
    const merged = new Map();
    for (const line of Array.isArray(lines) ? lines : []) {
        const productId = String(line?.productId ?? '');
        const key = `${productId}\u0000${line?.inputUnit}`;
        const quantityInput = Number(line?.quantityInput);
        const existing = merged.get(key);
        const sameFactor = !existing || !['cajas', 'bultos'].includes(line?.inputUnit)
            || existing.unitsPerPackage === Number(line?.unitsPerPackage);
        if (existing && !sameFactor) {
            // Factores distintos no se suman: se conserva la línea y el validador
            // rechaza el duplicado de forma explícita en vez de mezclar unidades.
            merged.set(`${key}\u0000${merged.size}`, {
                productId,
                inputUnit: line?.inputUnit,
                quantityInput,
                expectedStock: Number(line?.expectedStock),
                unitsPerPackage: Number(line?.unitsPerPackage),
            });
            continue;
        }
        if (existing) {
            existing.quantityInput = Math.round((existing.quantityInput + quantityInput) * 1000) / 1000;
            continue;
        }
        const next = {
            productId,
            inputUnit: line?.inputUnit,
            quantityInput,
            expectedStock: Number(line?.expectedStock),
        };
        if (line?.lineId) next.lineId = String(line.lineId);
        if (line?.baseRevision) next.baseRevision = String(line.baseRevision);
        if (['cajas', 'bultos'].includes(line?.inputUnit)) next.unitsPerPackage = Number(line?.unitsPerPackage);
        merged.set(key, next);
    }
    const payload = {
        batchVersion: INVENTORY_BATCH_VERSION,
        direction,
        reason: typeof reason === 'string' ? reason.trim() : reason,
        lines: [...merged.values()],
    };
    if (direction === 'egreso') payload.reasonCategory = reasonCategory;
    const lot = typeof lotReference === 'string' ? lotReference.trim() : '';
    if (lot) payload.lotReference = lot;
    return payload;
}

/**
 * Valida la forma mínima de un comando. La autenticidad criptográfica y la
 * autorización final deben comprobarse en backend; esta función evita que el
 * cliente procese basura o comandos fuera de ventana.
 */
export function validateSupervisorCommand(command, { targetDeviceId, monitorDeviceId, now = Date.now() } = {}) {
    if (!isPlainObject(command)) return { valid: false, error: 'Comando inválido' };
    if (!SUPERVISOR_COMMAND_TYPES.includes(command.type)) return { valid: false, error: 'Tipo de comando no permitido' };
    if (typeof command.commandId !== 'string' || command.commandId.length < 8 || command.commandId.length > MAX_COMMAND_ID_LENGTH) {
        return { valid: false, error: 'commandId inválido' };
    }
    if (typeof command.targetDeviceId !== 'string' || !targetDeviceId || command.targetDeviceId !== targetDeviceId) {
        return { valid: false, error: 'Target no autorizado' };
    }
    if (typeof command.monitorDeviceId !== 'string' || !monitorDeviceId || command.monitorDeviceId !== monitorDeviceId) {
        return { valid: false, error: 'Monitor no autorizado' };
    }
    if (!Number.isFinite(command.issuedAt) || !Number.isFinite(command.expiresAt)) {
        return { valid: false, error: 'Ventana temporal inválida' };
    }
    const durationMs = command.expiresAt - command.issuedAt;
    const maxTtlMs = Math.min(getCommandMaxTtlMs(command.type), COMMAND_ABSOLUTE_MAX_TTL_MS);
    if (command.expiresAt <= command.issuedAt || durationMs > maxTtlMs || now > command.expiresAt) {
        return { valid: false, error: 'Comando expirado o TTL inválido' };
    }
    if (!validateCommandPayload(command.type, command.payload)) {
        return { valid: false, error: 'Payload inválido' };
    }

    return { valid: true, error: null };
}

export class AppliedCommandGuard {
    constructor({ maxEntries = 1000, now = () => Date.now() } = {}) {
        this.maxEntries = maxEntries;
        this.now = now;
        this.entries = new Map();
    }

    has(commandId) {
        this._prune();
        return this.entries.has(commandId);
    }

    accept(commandId, expiresAt) {
        this._prune();
        if (typeof commandId !== 'string' || this.entries.has(commandId)) return false;
        this.entries.set(commandId, expiresAt);
        while (this.entries.size > this.maxEntries) {
            this.entries.delete(this.entries.keys().next().value);
        }
        return true;
    }

    _prune() {
        const now = this.now();
        for (const [commandId, expiresAt] of this.entries) {
            if (!Number.isFinite(expiresAt) || expiresAt <= now) this.entries.delete(commandId);
        }
    }
}

export default {
    PAIRING_STATES,
    SUPERVISOR_SYNC_KEYS,
    SUPERVISOR_COMMAND_TYPES,
    canTransitionPairing,
    canMonitorRead,
    isSupervisorSyncKey,
    validateSupervisorSyncDocument,
    validateSupervisorCommand,
    validateInventoryBatchV2Payload,
    buildInventoryBatchV2Payload,
    AppliedCommandGuard,
    buildProductRevision,
    extractEditableProductPatch,
    resolveEffectivePriceUsd,
    EDITABLE_PRODUCT_FIELDS,
    normalizeProductFieldValue,
};
