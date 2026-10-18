// ── Fichas tipo recibo del panel Control (propuesta 3) ──────────────────────
// Inspiradas en `monitorCommandDetails.js` de Donde Juancho, adaptadas a los
// datos REALES de `supervisor_commands`. Cada comando se transforma en una
// ficha legible: qué producto/cambio, qué se pidió (con delta), chips de
// detalle, quién lo pidió, cuándo se envió, cuándo se aplicó, la fecha y el
// sello. Regla: sin inventar datos — si el payload no trae algo, la ficha usa
// un fallback honesto (nunca un valor ficticio).

import { getControlStatus, CONTROL_STATUS } from './supervisorControlService';
import { getVerificationMeta } from './supervisorCommandVerification';

const MINUS = '−'; // signo menos tipográfico (U+2212)

function formatAmount(value) {
    const num = Number(value);
    if (!Number.isFinite(num)) return String(value ?? '');
    const rounded = Math.round(Math.abs(num) * 1000) / 1000;
    return Number.isInteger(rounded) ? String(rounded) : String(rounded);
}

function formatSigned(value) {
    const num = Number(value);
    return `${num < 0 ? MINUS : '+'}${formatAmount(num)}`;
}

function formatDateLabel(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function shortId(value) {
    const id = String(value ?? '');
    return id.length > 12 ? `${id.slice(0, 10)}…` : id;
}

function lineUnits(line = {}) {
    const quantity = Number(line.quantityInput);
    const perPackage = line.inputUnit && line.inputUnit !== 'unidades' ? Number(line.unitsPerPackage) : 1;
    const factor = Number.isFinite(perPackage) && perPackage > 0 ? perPackage : 1;
    return Number.isFinite(quantity) ? quantity * factor : 0;
}

const SEAL_BY_STATUS = Object.freeze({
    [CONTROL_STATUS.LOCAL_PENDING]: { label: 'Sin enviar', tone: 'info' },
    [CONTROL_STATUS.PENDING]: { label: 'En espera de la caja', tone: 'warning' },
    [CONTROL_STATUS.RECEIVED]: { label: 'Recibido por la caja', tone: 'info' },
    [CONTROL_STATUS.APPLIED]: { label: 'Aplicado por la caja', tone: 'success' },
    [CONTROL_STATUS.APPLIED_WITH_WARNINGS]: { label: 'Aplicado con reservas', tone: 'warning' },
    [CONTROL_STATUS.REJECTED]: { label: 'Rechazado por la caja', tone: 'danger' },
    [CONTROL_STATUS.FAILED]: { label: 'Falló en la caja', tone: 'danger' },
    [CONTROL_STATUS.CANCELLED]: { label: 'Anulado', tone: 'muted' },
    [CONTROL_STATUS.EXPIRED]: { label: 'Expiró sin aplicarse', tone: 'danger' },
});

function typeLabelOf(payload = {}, type) {
    switch (type) {
        case 'supervisor.inventory.batch.adjust': {
            const directionLabel = payload.direction === 'egreso' ? 'EGRESO' : 'INGRESO';
            if (Array.isArray(payload.lines) && payload.lines.length) {
                const count = payload.lines.length;
                return `${directionLabel} DE INVENTARIO (${count} movimiento${count === 1 ? '' : 's'})`;
            }
            const sign = payload.direction === 'egreso' ? -1 : 1;
            return `AJUSTE DE STOCK (${formatSigned(sign * lineUnits(payload))})`;
        }
        case 'supervisor.rate.set':
            return 'CAMBIO DE TASA';
        case 'supervisor.product.create':
            return 'ALTA DE PRODUCTO';
        case 'supervisor.product.update':
            return 'EDICIÓN DE PRODUCTO';
        case 'supervisor.product.delete':
            return 'BAJA DE PRODUCTO';
        case 'supervisor.user.create':
            return 'ALTA DE USUARIO';
        case 'supervisor.user.pin.change':
            return 'CAMBIO DE PIN';
        case 'supervisor.user.update':
            return 'EDICIÓN DE USUARIO';
        case 'supervisor.user.delete':
            return 'BAJA DE USUARIO';
        case 'supervisor.shift.close':
            return 'CIERRE DE TURNO';
        case 'supervisor.shift.reopen':
            return 'REAPERTURA DE TURNO';
        default:
            return 'ORDEN DEL SUPERVISOR';
    }
}

function titleOf(command, payload, resolveName) {
    const type = command.command_type;
    const named = (id) => {
        const resolved = resolveName ? resolveName(id) : null;
        return resolved || null;
    };
    switch (type) {
        case 'supervisor.inventory.batch.adjust': {
            const fromLine = Array.isArray(payload.lines)
                ? payload.lines.map(line => line?.productName || named(line?.productId)).find(Boolean)
                : null;
            return payload.productName
                || fromLine
                || named(payload.productId)
                || `Producto ${shortId(payload.productId || payload.lines?.[0]?.productId)}`;
        }
        case 'supervisor.product.create':
            return payload.product?.name || named(payload.product?.id) || `Producto ${shortId(payload.product?.id)}`;
        case 'supervisor.product.update':
            return payload.patch?.name || named(payload.productId) || `Producto ${shortId(payload.productId)}`;
        case 'supervisor.product.delete':
            return payload.productName || named(payload.productId) || `Producto ${shortId(payload.productId)}`;
        case 'supervisor.user.create':
        case 'supervisor.user.update':
        case 'supervisor.user.pin.change':
            return payload.nombre || payload.patch?.nombre || `Usuario ${shortId(payload.userId)}`;
        case 'supervisor.user.delete':
            return payload.nombre || `Usuario ${shortId(payload.userId)}`;
        case 'supervisor.rate.set':
            return 'Tasa de la caja';
        case 'supervisor.shift.close':
        case 'supervisor.shift.reopen':
            return `Turno ${shortId(payload.shiftId)}`;
        default:
            return 'Orden del supervisor';
    }
}

function detailLinesOf(payload = {}, type) {
    const chips = [];
    switch (type) {
        case 'supervisor.inventory.batch.adjust': {
            if (Array.isArray(payload.lines) && payload.lines.length) {
                payload.lines.slice(0, 6).forEach(line => {
                    const sign = payload.direction === 'egreso' ? -1 : 1;
                    const name = line?.productName || shortId(line?.productId);
                    chips.push(`${name}: ${formatSigned(sign * lineUnits(line))} unidades`);
                });
            } else {
                const sign = payload.direction === 'egreso' ? -1 : 1;
                chips.push(`Stock: ${formatSigned(sign * lineUnits(payload))} unidades`);
            }
            if (payload.reason) chips.push(`Motivo: ${payload.reason}`);
            if (payload.lotReference) chips.push(`Lote: ${payload.lotReference}`);
            return chips;
        }
        case 'supervisor.rate.set':
            chips.push(`Modo: ${payload.rateMode || '—'}`);
            if (payload.rateMode === 'manual' && payload.customRate != null) {
                chips.push(`Valor: ${formatAmount(payload.customRate)}`);
            }
            return chips;
        case 'supervisor.user.create':
        case 'supervisor.user.update': {
            const rol = payload.rol || payload.patch?.rol;
            if (rol) chips.push(`Rol: ${rol}`);
            return chips;
        }
        case 'supervisor.user.pin.change':
            chips.push('PIN nuevo');
            return chips;
        case 'supervisor.shift.close':
        case 'supervisor.shift.reopen':
            if (payload.shiftId) chips.push(`Turno: ${payload.shiftId}`);
            if (payload.cierreId) chips.push(`Cierre: ${payload.cierreId}`);
            return chips;
        case 'supervisor.product.update': {
            const ignored = new Set(['baseRevision', 'stock', 'stockInLotes', 'updatedAt', 'updated_at']);
            Object.entries(payload.patch || {})
                .filter(([key, value]) => !ignored.has(key) && value != null)
                .slice(0, 4)
                .forEach(([key, value]) => chips.push(`${key}: ${String(value)}`));
            return chips;
        }
        default:
            return chips;
    }
}

/**
 * Ficha-recibo completa de un comando.
 *
 * @param {Object} command  Fila de `supervisor_commands`.
 * @param {Object} [options]
 * @param {Object|string|null} [options.verification] Resultado del evaluador (o su nivel).
 * @param {(id: string) => string|null} [options.resolveName] Resolutor de nombres desde el eco.
 * @returns {{title, typeLabel, detailLines, actorLabel, sentAt, appliedAt, dateLabel, seal, verification}}
 */
export function getCommandReceipt(command = {}, { verification = null, resolveName = null } = {}) {
    const payload = command.payload || {};
    const status = getControlStatus(command);

    const sentAt = command.issued_at || command.created_at || null;
    const appliedStatuses = [CONTROL_STATUS.APPLIED, CONTROL_STATUS.APPLIED_WITH_WARNINGS];
    const appliedAt = appliedStatuses.includes(status)
        ? (command.applied_at || command.updated_at || null)
        : null;

    const dateLabel = appliedAt
        ? `APLICADO EN CAJA EL ${formatDateLabel(appliedAt)}`
        : (sentAt ? `ENVIADO EL ${formatDateLabel(sentAt)}` : 'SIN FECHA');

    const verificationLevel = typeof verification === 'string' ? verification : verification?.level;
    const verificationMeta = getVerificationMeta(verificationLevel || 'received');

    return {
        title: titleOf(command, payload, resolveName),
        typeLabel: typeLabelOf(payload, command.command_type),
        detailLines: detailLinesOf(payload, command.command_type),
        actorLabel: 'Por: Supervisor',
        sentAt,
        appliedAt,
        dateLabel,
        seal: SEAL_BY_STATUS[status] || { label: 'Requiere revisión', tone: 'danger' },
        verification: {
            ...verificationMeta,
            detail: (typeof verification === 'object' && verification?.detail) || null,
        },
    };
}

export default { getCommandReceipt };
