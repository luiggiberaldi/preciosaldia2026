/**
 * Anulación remota de ventas (`supervisor.sale.void`) — núcleo PURO.
 *
 * El monitor pide anular una venta del turno abierto; la caja decide y la
 * anula con su flujo normal (`processVoidSale`: devuelve stock, revierte
 * cartera y Cashea, deja auditoría). Mismas reglas que el botón de la caja:
 *   V1 solo ventas (VENTA, VENTA_FIADA, VENTA_CASHEA);
 *   V2 nunca una venta de un turno ya cerrado (el cierre ya se cuadró);
 *   V3 idempotente: si ya está anulada se responde como aplicada sin tocar nada;
 *   V4 motivo obligatorio (queda en la venta y en la auditoría).
 */

export const REMOTE_VOID_TYPE = 'supervisor.sale.void';
export const REMOTE_VOID_PAYLOAD_VERSION = 1;
export const REMOTE_VOID_LIMITS = Object.freeze({ MAX_SALE_ID: 128, MIN_REASON: 3, MAX_REASON: 200, MAX_NAME: 60 });
export const REMOTE_VOIDABLE_TYPES = Object.freeze(['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA']);

/** ¿El monitor puede ofrecer «Anular» para esta venta? (la caja vuelve a decidir) */
export function isRemotelyVoidable(sale) {
    return Boolean(sale?.id)
        && sale.status !== 'ANULADA'
        && !sale.cajaCerrada
        && REMOTE_VOIDABLE_TYPES.includes(sale.tipo);
}

export function buildRemoteVoidPayload({ sale, reason, requestedBy }) {
    return {
        v: REMOTE_VOID_PAYLOAD_VERSION,
        saleId: String(sale?.id || ''),
        reason: String(reason || '').trim().slice(0, REMOTE_VOID_LIMITS.MAX_REASON),
        requestedBy: {
            name: String(requestedBy?.name || 'Supervisor').trim().slice(0, REMOTE_VOID_LIMITS.MAX_NAME) || 'Supervisor',
            deviceId: requestedBy?.deviceId ? String(requestedBy.deviceId) : null,
        },
        // Solo para mostrar en el monitor y en Control (la caja no confía en esto).
        saleNumber: Number.isFinite(Number(sale?.saleNumber)) ? Number(sale.saleNumber) : null,
        totalUsd: Number.isFinite(Number(sale?.totalUsd)) ? Number(sale.totalUsd) : null,
    };
}

export function validateRemoteVoidPayload(payload) {
    const fail = (error) => ({ ok: false, error });
    if (!payload || typeof payload !== 'object') return fail('Anulación inválida');
    if (payload.v !== REMOTE_VOID_PAYLOAD_VERSION) return fail('Versión de anulación no soportada');
    if (typeof payload.saleId !== 'string' || !payload.saleId.trim() || payload.saleId.length > REMOTE_VOID_LIMITS.MAX_SALE_ID) {
        return fail('Venta inválida');
    }
    if (typeof payload.reason !== 'string'
        || payload.reason.trim().length < REMOTE_VOID_LIMITS.MIN_REASON
        || payload.reason.length > REMOTE_VOID_LIMITS.MAX_REASON) {
        return fail(`Escribe el motivo de la anulación (mínimo ${REMOTE_VOID_LIMITS.MIN_REASON} letras)`);
    }
    const name = payload.requestedBy?.name;
    if (typeof name !== 'string' || !name.trim() || name.length > REMOTE_VOID_LIMITS.MAX_NAME) return fail('Falta quién pide la anulación');
    return { ok: true };
}

const rejected = (error, code) => ({ status: 'rejected', error, code });

/**
 * Decide en la caja. @returns {{status:'apply', sale}|{status:'already_applied', sale}|{status:'rejected', error, code}}
 */
export function planRemoteVoid(payload, { sales = [] } = {}) {
    const check = validateRemoteVoidPayload(payload);
    if (!check.ok) return rejected(check.error, 'INVALID');
    const sale = sales.find((s) => s?.id === payload.saleId);
    if (!sale) return rejected('La venta no existe en la caja principal.', 'SALE_MISSING');
    if (sale.status === 'ANULADA') return { status: 'already_applied', sale };
    if (!REMOTE_VOIDABLE_TYPES.includes(sale.tipo)) return rejected('Ese movimiento no es una venta y no se anula desde aquí.', 'NOT_A_SALE');
    if (sale.cajaCerrada) return rejected('La venta pertenece a un turno ya cerrado: no se puede anular.', 'SHIFT_CLOSED');
    return { status: 'apply', sale };
}
