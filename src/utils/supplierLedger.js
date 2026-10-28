import { allocatePaymentsToInvoices } from './supplierAllocation';
import { getLocalISODate } from './dateHelpers';
import { round2 } from './dinero';

/**
 * Estado de cuenta derivado por proveedor (puro, sin I/O): lo que el supervisor
 * ve en modo lectura. La deuda publicada por la caja (`supplier.deuda`) es la
 * cifra de cabecera; el saldo por factura se deriva repartiendo los pagos
 * (`PAGO_PROVEEDOR` en ventas) en orden FIFO, igual que hace la caja.
 *
 * @param {Array} suppliers  `bodega_suppliers_v1`
 * @param {Array} invoices   `bodega_supplier_invoices_v1`
 * @param {Array} sales      `bodega_sales_v1` (solo se usan los PAGO_PROVEEDOR)
 * @param {Object} [opts]
 * @param {Date}   [opts.today] Referencia de "hoy" para vencimientos (tests).
 * Cada fila lleva además `divergenceUsd`/`divergent`: la comparación entre la
 * deuda publicada y el saldo derivado de facturas (tolerancia de medio
 * centavo; ambas cifras ya vienen redondeadas a centavos).
 *
 * @returns {Array<{supplier, deudaUsd, pendingUsd, divergenceUsd, divergent, overdueCount, invoiceCount, invoiceRows}>}
 */
export function buildSupplierLedger(suppliers, invoices, sales, { today = new Date() } = {}) {
    const allInvoices = Array.isArray(invoices) ? invoices : [];
    const allSales = Array.isArray(sales) ? sales : [];
    const todayKey = getLocalISODate(today);

    return (Array.isArray(suppliers) ? suppliers : [])
        .filter((supplier) => supplier && supplier.id != null)
        .map((supplier) => {
            const supplierInvoices = allInvoices.filter((inv) => inv?.supplierId === supplier.id);
            const supplierPayments = allSales.filter((sale) => (
                sale?.tipo === 'PAGO_PROVEEDOR' && sale?.supplierId === supplier.id
            ));
            const { byInvoice } = allocatePaymentsToInvoices(supplierInvoices, supplierPayments);

            const invoiceRows = [...supplierInvoices]
                .sort((a, b) => {
                    const ta = a?.date || a?.timestamp || '';
                    const tb = b?.date || b?.timestamp || '';
                    if (ta !== tb) return ta < tb ? 1 : -1; // más reciente primero
                    return String(a?.id ?? '') < String(b?.id ?? '') ? -1 : 1;
                })
                .map((inv) => {
                    const alloc = byInvoice.get(inv.id) || {
                        paidUsd: 0,
                        remainingUsd: Math.max(0, Number(inv.amountUsd) || 0),
                        status: 'PENDIENTE',
                    };
                    const overdue = Boolean(inv.dueDate)
                        && String(inv.dueDate) < todayKey
                        && alloc.remainingUsd > 0.005;
                    return {
                        id: inv.id,
                        invoiceNumber: inv.invoiceNumber || '',
                        date: inv.date || inv.timestamp || null,
                        dueDate: inv.dueDate || null,
                        amountUsd: round2(Math.max(0, Number(inv.amountUsd) || 0)),
                        paidUsd: round2(alloc.paidUsd),
                        remainingUsd: round2(alloc.remainingUsd),
                        status: overdue ? 'VENCIDA' : alloc.status,
                        overdue,
                    };
                });

            const pendingUsd = round2(invoiceRows.reduce((sum, row) => sum + row.remainingUsd, 0));
            const deudaUsd = round2(Math.max(0, Number(supplier.deuda) || 0));
            // Divergencia: la deuda publicada puede desviarse del saldo que
            // resulta de las facturas (deuda manual de un alta, ajustes legacy,
            // facturas sin publicar). Se marca para que el supervisor la vea en
            // vez de confiar en una cifra que las facturas no respaldan.
            const divergenceUsd = round2(deudaUsd - pendingUsd);
            return {
                supplier,
                deudaUsd,
                pendingUsd,
                divergenceUsd,
                divergent: Math.abs(divergenceUsd) > 0.005,
                overdueCount: invoiceRows.filter((row) => row.overdue).length,
                invoiceCount: invoiceRows.length,
                invoiceRows,
            };
        })
        .sort((a, b) => (
            b.deudaUsd - a.deudaUsd
            || String(a.supplier?.name ?? '').localeCompare(String(b.supplier?.name ?? ''))
        ));
}
