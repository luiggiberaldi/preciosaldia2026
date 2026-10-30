import { supabaseCloud } from '../config/supabaseCloud';

export const CONTROL_PAGE_SIZE = 25;
export const CONTROL_POLL_INTERVAL_MS = 45_000;

export const CONTROL_LIST_COLUMNS = [
    'command_id',
    'target_device_id',
    'actor_auth_id',
    'command_type',
    'status',
    'issued_at',
    'expires_at',
    'created_at',
    'updated_at',
    'error_message',
    'ack_payload',
    'payload',
].join(',');

export const CONTROL_STATUS = Object.freeze({
    LOCAL_PENDING: 'local_pending',
    PENDING: 'pending',
    RECEIVED: 'received',
    APPLIED: 'applied',
    APPLIED_WITH_WARNINGS: 'applied_with_warnings',
    FAILED: 'failed',
    REJECTED: 'rejected',
    CANCELLED: 'cancelled',
    EXPIRED: 'expired',
    CONFLICT: 'conflict',
});

export const CONTROL_FILTERS = Object.freeze([
    { id: 'all', label: 'Todos' },
    { id: 'pending', label: 'En espera' },
    { id: 'applied', label: 'Aplicados' },
    { id: 'warnings', label: 'Advertencias' },
    { id: 'failed', label: 'Fallidos' },
    { id: 'cancelled', label: 'Anulados' },
]);

export const COMMAND_TYPE_LABELS = Object.freeze({
    'supervisor.rate.set': 'Cambio de tasa',
    'supervisor.product.create': 'Crear producto',
    'supervisor.product.update': 'Editar producto',
    'supervisor.product.delete': 'Eliminar producto',
    'supervisor.user.create': 'Crear usuario',
    'supervisor.user.pin.change': 'Cambiar PIN',
    'supervisor.user.update': 'Editar usuario',
    'supervisor.user.delete': 'Eliminar usuario',
    'supervisor.shift.close': 'Cerrar turno',
    'supervisor.shift.reopen': 'Reabrir turno',
    'supervisor.inventory.batch.adjust': 'Movimiento de inventario',
    'supervisor.supplier.create': 'Crear proveedor',
    'supervisor.supplier.update': 'Editar proveedor',
    'supervisor.supplier.delete': 'Eliminar proveedor',
    'supervisor.invoice.create': 'Registrar factura',
    'supervisor.invoice.update': 'Editar factura',
    'supervisor.invoice.delete': 'Eliminar factura',
    'supervisor.sale.create': 'Venta remota',
    'supervisor.sale.void': 'Anular venta',
    'supervisor.purchase.upsert': 'Compra de mercancía',
    'supervisor.purchase.delete': 'Borrar compra',
});

function isWarningCommand(command) {
    return command?.status === CONTROL_STATUS.APPLIED_WITH_WARNINGS
        || Boolean(command?.ack_payload?.warnings?.length)
        || Boolean(command?.ack_payload?.warning);
}

export function getControlStatus(command = {}) {
    if (isWarningCommand(command)) return CONTROL_STATUS.APPLIED_WITH_WARNINGS;
    if (command.status === CONTROL_STATUS.PENDING && command.expires_at
        && Date.parse(command.expires_at) <= Date.now()) return CONTROL_STATUS.EXPIRED;
    if (Object.values(CONTROL_STATUS).includes(command.status)) return command.status;
    return CONTROL_STATUS.CONFLICT;
}

export function getControlStatusMeta(command = {}) {
    const status = getControlStatus(command);
    const meta = {
        [CONTROL_STATUS.LOCAL_PENDING]: { label: 'Sin enviar', tone: 'info' },
        [CONTROL_STATUS.PENDING]: { label: 'En espera de la caja', tone: 'warning' },
        [CONTROL_STATUS.RECEIVED]: { label: 'Recibido por la caja', tone: 'info' },
        [CONTROL_STATUS.APPLIED]: { label: 'Aplicado correctamente', tone: 'success' },
        [CONTROL_STATUS.APPLIED_WITH_WARNINGS]: { label: 'Aplicado con advertencias', tone: 'warning' },
        [CONTROL_STATUS.FAILED]: { label: 'Falló', tone: 'danger' },
        [CONTROL_STATUS.REJECTED]: { label: 'Rechazado por la caja', tone: 'danger' },
        [CONTROL_STATUS.CANCELLED]: { label: 'Anulado', tone: 'muted' },
        [CONTROL_STATUS.EXPIRED]: { label: 'Expirado', tone: 'danger' },
        [CONTROL_STATUS.CONFLICT]: { label: 'Requiere revisión', tone: 'danger' },
    };
    return { status, ...(meta[status] || meta[CONTROL_STATUS.CONFLICT]) };
}

export function matchesControlFilter(command, filter) {
    const status = getControlStatus(command);
    if (filter === 'all') return true;
    if (filter === 'pending') return [CONTROL_STATUS.PENDING, CONTROL_STATUS.RECEIVED, CONTROL_STATUS.EXPIRED].includes(status);
    if (filter === 'applied') return status === CONTROL_STATUS.APPLIED;
    if (filter === 'warnings') return status === CONTROL_STATUS.APPLIED_WITH_WARNINGS;
    if (filter === 'failed') return [CONTROL_STATUS.FAILED, CONTROL_STATUS.REJECTED, CONTROL_STATUS.CONFLICT].includes(status);
    if (filter === 'cancelled') return status === CONTROL_STATUS.CANCELLED;
    return true;
}

export function getCommandTitle(command = {}) {
    const payload = command.payload || {};
    if (command.command_type === 'supervisor.inventory.batch.adjust') {
        const direction = payload.direction === 'egreso' ? 'Egreso' : 'Ingreso';
        return `${direction} de inventario`;
    }
    return COMMAND_TYPE_LABELS[command.command_type] || 'Orden del supervisor';
}

export function getCommandDetails(command = {}) {
    const payload = command.payload || {};
    const details = [];
    if (payload.productName || payload.product?.name) details.push(payload.productName || payload.product.name);
    if (payload.productId) details.push(`Producto ${String(payload.productId).slice(0, 10)}`);
    if (payload.quantityInput != null) details.push(`${payload.quantityInput} ${payload.inputUnit || 'unidades'}`);
    if (payload.unitsPerPackage != null && payload.inputUnit && payload.inputUnit !== 'unidades') {
        details.push(`${payload.unitsPerPackage} u/${payload.inputUnit === 'cajas' ? 'caja' : 'bulto'}`);
    }
    if (payload.reason) details.push(payload.reason);
    if (payload.rateMode) details.push(`Modo: ${payload.rateMode}`);
    const supplierName = payload.supplier?.name || payload.supplierName;
    if (supplierName) details.push(supplierName);
    const invoiceNumber = payload.invoice?.invoiceNumber || payload.invoiceNumber;
    if (invoiceNumber) details.push(`Factura #${invoiceNumber}`);
    if (payload.invoice?.amountUsd != null) details.push(`USD ${Number(payload.invoice.amountUsd).toFixed(2)}`);
    return details;
}

export async function fetchSupervisorControlCommands({
    targetDeviceId,
    page = 0,
    pageSize = CONTROL_PAGE_SIZE,
    client = supabaseCloud,
} = {}) {
    if (!client || !targetDeviceId) return { data: [], count: 0, error: new Error('No hay caja vinculada') };
    const from = Math.max(0, page) * pageSize;
    const to = from + pageSize - 1;
    const { data, count, error } = await client
        .from('supervisor_commands')
        .select(CONTROL_LIST_COLUMNS, { count: 'exact' })
        .eq('target_device_id', targetDeviceId)
        .order('created_at', { ascending: false })
        .range(from, to);
    return { data: Array.isArray(data) ? data : [], count: count || 0, error: error || null };
}

export async function fetchSupervisorControlCounts({ targetDeviceId, client = supabaseCloud } = {}) {
    if (!client || !targetDeviceId) return { counts: null, error: new Error('No hay caja vinculada') };
    const { data, error } = await client.rpc('get_supervisor_command_control_counts', {
        p_target_device_id: targetDeviceId,
    });
    if (error) return { counts: null, error };
    return { counts: Array.isArray(data) ? data[0] || null : data || null, error: null };
}

export async function fetchSupervisorControlDetail({ commandId, client = supabaseCloud } = {}) {
    if (!client || !commandId) return { data: null, error: new Error('Comando inválido') };
    const { data, error } = await client
        .from('supervisor_commands')
        .select(CONTROL_LIST_COLUMNS)
        .eq('command_id', commandId)
        .maybeSingle();
    return { data: data || null, error: error || null };
}

export async function cancelSupervisorCommand({ commandId, reason = 'Cancelado desde Control', client = supabaseCloud } = {}) {
    if (!client || !commandId) return { ok: false, error: 'Comando inválido' };
    const { data, error } = await client.rpc('cancel_supervisor_command', {
        p_command_id: commandId,
        p_reason: reason,
    });
    if (error) return { ok: false, error: error.message || 'No se pudo anular el comando' };

    const result = Array.isArray(data) ? data[0] : data;
    if (result?.status === CONTROL_STATUS.CANCELLED) return { ok: true, status: result.status, data: result };
    return {
        ok: false,
        status: result?.status || 'unknown',
        error: result?.status
            ? `La orden ya no está pendiente (estado: ${result.status}) y no se anuló`
            : 'El servidor no confirmó la anulación de la orden',
        data: result || null,
    };
}

