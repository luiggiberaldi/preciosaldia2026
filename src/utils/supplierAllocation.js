/**
 * Reparte los pagos de un proveedor entre sus facturas (FIFO: la más antigua primero).
 *
 * Los pagos no guardan a qué factura corresponden: se calcula al mostrar, en orden
 * cronológico, para no cambiar el formato de los pagos que usan caja y reportes.
 *
 * @param {Array} invoices  Facturas del proveedor: { id, amountUsd, date|timestamp }
 * @param {Array} payments  Pagos del proveedor: { id, totalUsd, date|timestamp }
 * @returns {{ byInvoice: Map<string, { paidUsd: number, remainingUsd: number, status: 'PAGADA'|'PARCIAL'|'PENDIENTE' }>,
 *             unallocatedUsd: number }}
 *   unallocatedUsd: pagos que exceden el total facturado (saldo a favor).
 */
export function allocatePaymentsToInvoices(invoices = [], payments = []) {
    const timeOf = (r) => new Date(r.date || r.timestamp).getTime() || 0;
    const sortedInvoices = [...invoices].sort((a, b) => timeOf(a) - timeOf(b));
    // Un pago ANULADA no cuenta: ni reduce deuda ni se reparte.
    const sortedPayments = payments
        .filter(p => p && p.status !== 'ANULADA')
        .sort((a, b) => timeOf(a) - timeOf(b));

    const byInvoice = new Map();
    const remaining = new Map();
    for (const inv of sortedInvoices) {
        const amount = Math.max(0, Number(inv.amountUsd) || 0);
        remaining.set(inv.id, amount);
        byInvoice.set(inv.id, { paidUsd: 0, remainingUsd: amount, status: 'PENDIENTE' });
    }

    // Un pago con invoiceId cubre primero esa factura; el resto (o un pago sin factura) va FIFO.
    const applyTo = (invId, left) => {
        const due = remaining.get(invId);
        if (due === undefined || due <= 0 || left <= 0) return left;
        const applied = Math.min(due, left);
        remaining.set(invId, due - applied);
        return left - applied;
    };

    let unallocatedUsd = 0;
    for (const pay of sortedPayments) {
        let left = Math.abs(Number(pay.totalUsd) || 0);
        if (pay.invoiceId) left = applyTo(pay.invoiceId, left);
        for (const inv of sortedInvoices) {
            if (left <= 0) break;
            left = applyTo(inv.id, left);
        }
        unallocatedUsd += left;
    }

    for (const inv of sortedInvoices) {
        const amount = Math.max(0, Number(inv.amountUsd) || 0);
        const rem = Math.max(0, remaining.get(inv.id));
        const paid = amount - rem;
        const status = rem <= 0 ? 'PAGADA' : paid > 0 ? 'PARCIAL' : 'PENDIENTE';
        byInvoice.set(inv.id, { paidUsd: paid, remainingUsd: rem, status });
    }

    return { byInvoice, unallocatedUsd };
}

/** Lo ya pagado a una factura concreta, según la asignación FIFO. */
export function paidAmountForInvoice(invoices, payments, invoiceId) {
    return allocatePaymentsToInvoices(invoices, payments).byInvoice.get(invoiceId)?.paidUsd ?? 0;
}
