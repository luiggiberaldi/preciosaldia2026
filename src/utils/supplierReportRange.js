import { formatUsd } from './calculatorUtils';
import { getLocalISODate } from './dateHelpers';
import { getPaperConfig } from './ticketConstants';
import { escapeHtml, openPrintWindow } from './printerUtils';

/**
 * Deja solo los registros cuyo día local (YYYY-MM-DD) cae en [desde, hasta].
 * Límites vacíos = sin límite. Sin fecha válida = se excluye cuando hay rango.
 */
export function filterActivityByRange(items, desde = '', hasta = '') {
    if (!Array.isArray(items)) return [];
    if (!desde && !hasta) return items;
    return items.filter((item) => {
        const raw = item?.date || item?.timestamp;
        if (!raw) return false;
        const time = new Date(raw);
        if (Number.isNaN(time.getTime())) return false;
        const day = getLocalISODate(time);
        return (!desde || day >= desde) && (!hasta || day <= hasta);
    });
}

/** Registro que cuenta en los reportes: los pagos anulados quedan fuera. */
export const isActiveRecord = (record) => record?.status !== 'ANULADA';

/** Opciones del selector de período del PDF de estado de cuenta. */
export const REPORT_RANGE_OPTIONS = [
    { id: 'today', label: 'Hoy' },
    { id: 'yesterday', label: 'Ayer' },
    { id: 'week', label: 'Esta semana' },
    { id: 'month', label: 'Este mes' },
    { id: 'lastMonth', label: 'Mes anterior' },
    { id: 'all', label: 'Todo el historial' },
    { id: 'custom', label: 'Personalizado' },
];

/**
 * Traduce una opción del selector a { desde, hasta } (YYYY-MM-DD local).
 * 'all' no limita; 'custom' usa las fechas dadas. `now` permite probarlo.
 */
export function resolveReportRange(optionId, { desde = '', hasta = '' } = {}, now = new Date()) {
    if (optionId === 'all') return { desde: '', hasta: '' };
    if (optionId === 'custom') return { desde, hasta };
    const today = getLocalISODate(now);
    switch (optionId) {
        case 'today':
            return { desde: today, hasta: today };
        case 'yesterday': {
            const d = new Date(now);
            d.setDate(d.getDate() - 1);
            const day = getLocalISODate(d);
            return { desde: day, hasta: day };
        }
        case 'week': {
            const d = new Date(now);
            d.setDate(d.getDate() - d.getDay()); // domingo, igual que Reportes
            return { desde: getLocalISODate(d), hasta: today };
        }
        case 'month':
            return { desde: getLocalISODate(new Date(now.getFullYear(), now.getMonth(), 1)), hasta: today };
        case 'lastMonth':
            return {
                desde: getLocalISODate(new Date(now.getFullYear(), now.getMonth() - 1, 1)),
                hasta: getLocalISODate(new Date(now.getFullYear(), now.getMonth(), 0)),
            };
        default:
            return { desde: '', hasta: '' };
    }
}

/** Texto legible del rango: 'Del 01/10/2026 al 09/10/2026', 'Todo el historial', etc. */
export function buildSupplierPeriodSummary({ suppliers = [], invoices = [], payments = [], desde = '', hasta = '' }) {
    const supplierById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
    const totalsBySupplier = new Map();
    const getRow = (record) => {
        const supplier = supplierById.get(record.supplierId);
        const key = record.supplierId || record.supplierName || 'sin-proveedor';
        if (!totalsBySupplier.has(key)) {
            totalsBySupplier.set(key, {
                supplierId: record.supplierId || null,
                supplierName: supplier?.name || record.supplierName || 'Proveedor desconocido',
                invoicesUsd: 0,
                paymentsUsd: 0,
                currentDebtUsd: Number(supplier?.deuda) || 0,
            });
        }
        return totalsBySupplier.get(key);
    };

    filterActivityByRange(invoices, desde, hasta).forEach((invoice) => {
        getRow(invoice).invoicesUsd += Number(invoice.amountUsd) || 0;
    });
    filterActivityByRange(payments, desde, hasta)
        .filter((payment) => payment.status !== 'ANULADA')
        .forEach((payment) => {
            getRow(payment).paymentsUsd += Math.abs(Number(payment.totalUsd) || 0);
        });

    const rows = [...totalsBySupplier.values()].sort((a, b) => a.supplierName.localeCompare(b.supplierName, 'es'));
    return {
        rows,
        totalInvoicesUsd: rows.reduce((total, row) => total + row.invoicesUsd, 0),
        totalPaymentsUsd: rows.reduce((total, row) => total + row.paymentsUsd, 0),
        // Deuda actual no es un total del rango: puede incluir facturas anteriores.
        currentDebtUsd: suppliers.reduce((total, supplier) => total + (Number(supplier.deuda) || 0), 0),
    };
}

export function rangeLabel(desde = '', hasta = '') {
    const fmt = (s) => {
        const [y, m, d] = s.split('-');
        return `${d}/${m}/${y}`;
    };
    if (desde && hasta) return `Del ${fmt(desde)} al ${fmt(hasta)}`;
    if (desde) return `Desde ${fmt(desde)}`;
    if (hasta) return `Hasta ${fmt(hasta)}`;
    return 'Todo el historial';
}

/**
 * Une facturas y pagos en líneas de ticket, filtradas por rango.
 * Facturas suman a la deuda; pagos la reducen (montos en USD positivos).
 */
export function buildSupplierActivityLines({ invoices = [], payments = [], desde = '', hasta = '' }) {
    const facturas = filterActivityByRange(invoices, desde, hasta).map((i) => ({
        time: new Date(i.date || i.timestamp).getTime(),
        date: new Date(i.date || i.timestamp),
        label: `Factura #${i.invoiceNumber || '-'}`,
        amountUsd: Number(i.amountUsd) || 0,
        kind: 'factura',
    }));
    const pagos = filterActivityByRange(payments, desde, hasta).filter(isActiveRecord).map((p) => ({
        time: new Date(p.date || p.timestamp).getTime(),
        date: new Date(p.date || p.timestamp),
        label: 'Pago',
        amountUsd: Math.abs(Number(p.totalUsd) || 0),
        kind: 'pago',
    }));
    const lines = [...facturas, ...pagos].sort((a, b) => b.time - a.time);
    const facturasUsd = facturas.reduce((s, l) => s + l.amountUsd, 0);
    const pagosUsd = pagos.reduce((s, l) => s + l.amountUsd, 0);
    return { lines, facturasUsd, pagosUsd, netoUsd: facturasUsd - pagosUsd };
}

/**
 * HTML de ticket térmico del reporte de proveedores. Puro: recibe el
 * paperConfig y los datos ya filtrados.
 */
export function buildSupplierReportTicketHtml({
    businessName = 'Bodega',
    title = 'Reporte de proveedores',
    rangeText = 'Todo el historial',
    supplierName = '',
    lines = [],
    totals = { facturasUsd: 0, pagosUsd: 0, netoUsd: 0 },
    paperConfig,
}) {
    const { cssPageSize, cssBodyWidth, fTitle, fBase, fSmall, fTotalU } = paperConfig;
    const money = (v) => `$${formatUsd(v)}`;
    const rowsHtml = lines.map((l) => `
        <div class="row" style="font-size:${fSmall}">
            <span>${escapeHtml(l.date.toLocaleDateString('es-VE'))} ${escapeHtml(l.label)}${l.kind === 'pago' ? ' (-)' : ''}</span>
            <span>${l.kind === 'pago' ? '-' : ''}${money(l.amountUsd)}</span>
        </div>`).join('');
    const now = new Date().toLocaleString('es-VE');
    return `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>
    @page { size: ${cssPageSize}; margin: 0; }
    body { width: ${cssBodyWidth}; margin: 0 auto; font-family: monospace; color: #000; }
    .c { text-align: center; }
    .row { display: flex; justify-content: space-between; gap: 4px; }
    .hr { border-top: 1px dashed #000; margin: 4px 0; }
</style></head>
<body>
    <div class="c" style="font-size:${fTitle}"><b>${escapeHtml(businessName)}</b></div>
    <div class="c" style="font-size:${fSmall}">${escapeHtml(title)}</div>
    ${supplierName ? `<div class="c" style="font-size:${fSmall}">${escapeHtml(supplierName)}</div>` : ''}
    <div class="c" style="font-size:${fSmall}">${escapeHtml(rangeText)}</div>
    <div class="hr"></div>
    ${lines.length ? rowsHtml : `<div class="c" style="font-size:${fSmall}">Sin movimientos en el rango</div>`}
    <div class="hr"></div>
    <div class="row" style="font-size:${fBase}"><span>Facturas</span><span>${money(totals.facturasUsd)}</span></div>
    <div class="row" style="font-size:${fBase}"><span>Pagos</span><span>-${money(totals.pagosUsd)}</span></div>
    <div class="row" style="font-size:${fTotalU}"><b>Saldo neto</b><b>${money(totals.netoUsd)}</b></div>
    <div class="hr"></div>
    <div class="c" style="font-size:${fSmall}">Generado ${escapeHtml(now)}</div>
</body></html>`;
}

/** Abre la impresión térmica del reporte con el ancho de papel configurado. */
export function printSupplierReportThermal({ invoices, payments, desde = '', hasta = '', supplierName = '', title }) {
    const paperWidth = localStorage.getItem('printer_paper_width') || '58';
    const paperConfig = getPaperConfig(paperWidth);
    const businessName = localStorage.getItem('business_name') || 'Bodega Sin Nombre';
    const { lines, facturasUsd, pagosUsd, netoUsd } = buildSupplierActivityLines({ invoices, payments, desde, hasta });
    const html = buildSupplierReportTicketHtml({
        businessName,
        title: title || (supplierName ? 'Estado de cuenta' : 'Reporte de proveedores'),
        rangeText: rangeLabel(desde, hasta),
        supplierName,
        lines,
        totals: { facturasUsd, pagosUsd, netoUsd },
        paperConfig,
    });
    openPrintWindow(html);
}
