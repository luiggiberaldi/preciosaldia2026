// Contratos y aplicadores puros de los comandos de proveedores y facturas
// (Fase 2: gestión remota desde el Supervisor con ACK-verificado).
//
// La caja es la autoridad del estado local; estos aplicadores replican
// EXACTAMENTE la contabilidad incremental de useSupplierManagement:
//   - registrar factura  → deuda += monto
//   - editar factura     → deuda += (nuevo monto − monto anterior), jamás por
//                          debajo de lo ya pagado a esa factura (reparto FIFO)
//   - eliminar factura   → solo sin pagos aplicados; deuda −= monto (≥ 0)
//   - eliminar proveedor → lo retira; sus facturas quedan como en la caja
//                          (el estado de cuenta las ignora sin proveedor)
// `deuda` NUNCA es editable por patch: es contabilidad, no un campo del
// formulario (igual que `stock` en los productos).
//
// Semántica de resultado (misma taxonomía que el resto del canal):
//   { status: 'applied', ... }    → cambio aplicado (las repeticiones son no-op)
//   { status: 'rejected', error } → rechazo CIERTO de regla de negocio: la caja
//                                   no aplicará nada y repetir no lo resolverá
//   throw Error                   → error inesperado (el receptor lo ACKea 'failed')
import { paidAmountForInvoice } from '../utils/supplierAllocation';
import { round2 } from '../utils/dinero';

const isRecord = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function requireId(value, message) {
    if (typeof value !== 'string' || value.trim() === '') throw new Error(message);
    return value;
}

function deudaOf(supplier) {
    const value = Number(supplier?.deuda);
    return Number.isFinite(value) ? value : 0;
}

/** Suma un delta a la deuda del proveedor; con clamp nunca baja de cero. */
function bumpDeuda(suppliers, supplierId, delta, { clampZero = false } = {}) {
    return suppliers.map((supplier) => {
        if (String(supplier?.id) !== String(supplierId)) return supplier;
        const next = round2(deudaOf(supplier) + delta);
        return { ...supplier, deuda: clampZero ? Math.max(0, next) : next };
    });
}

/**
 * Aplica una orden de proveedor sobre la lista local.
 * @param {Array} suppliers `bodega_suppliers_v1`
 * @param {{ action: 'create'|'edit'|'delete', supplier?, supplierId?, patch? }} payload
 */
export function applySupervisorSupplierCommand(suppliers, payload = {}) {
    const list = Array.isArray(suppliers) ? suppliers : [];
    const action = payload.action;

    if (action === 'create') {
        const supplier = payload.supplier;
        if (!isRecord(supplier)) throw new Error('Proveedor inválido');
        const id = requireId(supplier.id, 'Proveedor inválido');
        if (typeof supplier.name !== 'string' || supplier.name.trim() === '') {
            throw new Error('El nombre del proveedor es obligatorio');
        }
        const existing = list.find((item) => String(item?.id) === id);
        if (existing) {
            // Idempotente: repetir el alta jamás duplica ni regenera la deuda.
            return {
                status: 'applied', action, supplierId: id, suppliers: list, deudaUsd: round2(deudaOf(existing)),
            };
        }
        // La deuda es contabilidad de la caja: un proveedor nuevo nace en 0.
        const { deuda: _ignored, ...fields } = supplier;
        const created = { deuda: 0, ...fields, id };
        return {
            status: 'applied', action, supplierId: id, suppliers: [...list, created], deudaUsd: 0,
        };
    }

    if (action === 'edit') {
        const supplierId = requireId(payload.supplierId, 'Proveedor inválido');
        const patch = payload.patch;
        if (!isRecord(patch)) throw new Error('Patch de proveedor inválido');
        const existing = list.find((item) => String(item?.id) === supplierId);
        if (!existing) {
            return { status: 'rejected', error: 'El proveedor ya no existe en la caja', suppliers: list };
        }
        const { id: _id, deuda: _deuda, ...editable } = patch;
        if (editable.name !== undefined && (typeof editable.name !== 'string' || editable.name.trim() === '')) {
            throw new Error('El nombre del proveedor es obligatorio');
        }
        const updated = { ...existing, ...editable, id: existing.id, deuda: deudaOf(existing) };
        return {
            status: 'applied',
            action,
            supplierId,
            suppliers: list.map((item) => (String(item?.id) === supplierId ? updated : item)),
            deudaUsd: round2(updated.deuda),
        };
    }

    if (action === 'delete') {
        const supplierId = requireId(payload.supplierId, 'Proveedor inválido');
        const exists = list.some((item) => String(item?.id) === supplierId);
        if (!exists) {
            // Idempotente: ya borrado = el estado pedido ya es el real.
            return { status: 'applied', action, supplierId, suppliers: list, deudaUsd: 0 };
        }
        return {
            status: 'applied',
            action,
            supplierId,
            suppliers: list.filter((item) => String(item?.id) !== supplierId),
            deudaUsd: 0,
        };
    }

    throw new Error('Acción de proveedor no soportada');
}

/**
 * Aplica una orden de factura sobre facturas + proveedores (la deuda del
 * proveedor se ajusta como en la caja).
 * @param {{ invoices, suppliers, sales }} state
 * @param {{ action: 'create'|'edit'|'delete', invoice?, invoiceId?, patch? }} payload
 */
export function applySupervisorInvoiceCommand({ invoices, suppliers, sales } = {}, payload = {}) {
    const invoiceList = Array.isArray(invoices) ? invoices : [];
    const supplierList = Array.isArray(suppliers) ? suppliers : [];
    const paymentList = Array.isArray(sales) ? sales : [];
    const action = payload.action;

    const paymentsOf = (supplierId) => paymentList.filter((sale) => (
        sale?.tipo === 'PAGO_PROVEEDOR' && String(sale?.supplierId) === String(supplierId)
    ));
    const paidFor = (invoice) => paidAmountForInvoice(
        invoiceList.filter((item) => String(item?.supplierId) === String(invoice.supplierId)),
        paymentsOf(invoice.supplierId),
        invoice.id,
    );

    if (action === 'create') {
        const invoice = payload.invoice;
        if (!isRecord(invoice)) throw new Error('Factura inválida');
        const id = requireId(invoice.id, 'Factura inválida');
        const supplierId = requireId(invoice.supplierId, 'Proveedor de la factura inválido');
        const amountUsd = round2(Number(invoice.amountUsd));
        if (!Number.isFinite(amountUsd) || amountUsd <= 0) {
            throw new Error('El monto de la factura debe ser mayor que cero');
        }
        const supplier = supplierList.find((item) => String(item?.id) === supplierId);
        if (!supplier) {
            return { status: 'rejected', error: 'El proveedor de la factura ya no existe en la caja', invoices: invoiceList, suppliers: supplierList };
        }
        if (invoiceList.some((item) => String(item?.id) === id)) {
            // Idempotente: repetir el registro jamás duplica la deuda.
            return {
                status: 'applied', action, invoiceId: id, invoices: invoiceList, suppliers: supplierList, deudaUsd: round2(deudaOf(supplier)),
            };
        }
        const { id: _id, ...fields } = invoice;
        const created = {
            ...fields,
            id,
            supplierId,
            amountUsd,
            invoiceNumber: invoice.invoiceNumber || '',
            date: invoice.date || new Date().toISOString(),
            dueDate: invoice.dueDate || null,
        };
        return {
            status: 'applied',
            action,
            invoiceId: id,
            invoices: [...invoiceList, created],
            suppliers: bumpDeuda(supplierList, supplierId, amountUsd),
            deudaUsd: round2(deudaOf(supplier) + amountUsd),
        };
    }

    if (action === 'edit') {
        const invoiceId = requireId(payload.invoiceId, 'Factura inválida');
        const patch = payload.patch;
        if (!isRecord(patch)) throw new Error('Patch de factura inválido');
        const existing = invoiceList.find((item) => String(item?.id) === invoiceId);
        if (!existing) {
            return { status: 'rejected', error: 'La factura ya no existe en la caja', invoices: invoiceList, suppliers: supplierList };
        }
        const { id: _id, supplierId: _supplierId, hasPhoto: _hasPhoto, ...editable } = patch;
        let nextAmount = Number(existing.amountUsd);
        if (editable.amountUsd !== undefined) {
            nextAmount = round2(Number(editable.amountUsd));
            if (!Number.isFinite(nextAmount) || nextAmount <= 0) {
                throw new Error('El monto de la factura debe ser mayor que cero');
            }
            // Misma regla que handleEditInvoice: no bajar por debajo de lo pagado.
            const paid = paidFor(existing);
            if (nextAmount + 0.005 < paid) {
                return {
                    status: 'rejected',
                    error: `No se puede bajar el monto por debajo de lo ya pagado a esta factura (USD ${paid.toFixed(2)})`,
                    invoices: invoiceList,
                    suppliers: supplierList,
                };
            }
        }
        const updated = { ...existing, ...editable, id: existing.id, supplierId: existing.supplierId, amountUsd: nextAmount };
        const diff = round2(nextAmount - (Number(existing.amountUsd) || 0));
        return {
            status: 'applied',
            action,
            invoiceId,
            invoices: invoiceList.map((item) => (String(item?.id) === invoiceId ? updated : item)),
            suppliers: diff !== 0
                ? bumpDeuda(supplierList, existing.supplierId, diff, { clampZero: true })
                : supplierList,
            deudaUsd: diff,
        };
    }

    if (action === 'delete') {
        const invoiceId = requireId(payload.invoiceId, 'Factura inválida');
        const existing = invoiceList.find((item) => String(item?.id) === invoiceId);
        if (!existing) {
            // Idempotente: ya borrada = el estado pedido ya es el real.
            return { status: 'applied', action, invoiceId, invoices: invoiceList, suppliers: supplierList, deudaUsd: 0 };
        }
        // Misma regla que handleDeleteInvoice: facturas con pagos no se eliminan.
        const paid = paidFor(existing);
        if (paid > 0.005) {
            return {
                status: 'rejected',
                error: 'Esta factura ya tiene pagos aplicados; no se puede eliminar',
                invoices: invoiceList,
                suppliers: supplierList,
            };
        }
        return {
            status: 'applied',
            action,
            invoiceId,
            invoices: invoiceList.filter((item) => String(item?.id) !== invoiceId),
            suppliers: bumpDeuda(supplierList, existing.supplierId, -(Number(existing.amountUsd) || 0), { clampZero: true }),
            deudaUsd: -(Number(existing.amountUsd) || 0),
        };
    }

    throw new Error('Acción de factura no soportada');
}
