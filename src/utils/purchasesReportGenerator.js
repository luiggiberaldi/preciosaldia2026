// PDF «Compras de mercancía»: total del período, por proveedor, por día y detalle.
import { jsPDF } from 'jspdf';
import { formatBs, formatUsd } from './calculatorUtils';
import { rangeLabel } from './supplierReportRange';
import { summarizePurchases } from './merchandisePurchases';

const fmtDate = (iso) => {
    const [y, m, d] = String(iso || '').split('-');
    return d && m && y ? `${d}/${m}/${y}` : String(iso || '');
};

/**
 * @param {{purchases:Array, from:string, to:string, businessName?:string, salesUsd?:number|null}} params
 */
export function generatePurchasesReportPDF({ purchases = [], from = '', to = '', businessName = '', salesUsd = null }) {
    const summary = summarizePurchases(purchases, from, to);
    const doc = new jsPDF('p', 'mm', 'letter');
    const WIDTH = 215.9;
    const HEIGHT = 279.4;
    const M = 15;
    const RIGHT = WIDTH - M;
    let y = 15;
    let pageNum = 1;

    const INK = [33, 37, 41];
    const BODY = [73, 80, 87];
    const MUTED = [134, 142, 150];
    const BLUE = [1, 105, 111];
    const RED = [180, 40, 50];
    const RULE = [222, 226, 230];
    const BAND = [241, 245, 245];

    const addFooter = (pNum) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...MUTED);
        doc.text(`Precios Al Día Bodega · Compras de mercancía · Página ${pNum}`, WIDTH / 2, HEIGHT - 10, { align: 'center' });
    };
    const ensure = (needed) => {
        if (y + needed > HEIGHT - 20) {
            addFooter(pageNum);
            doc.addPage();
            pageNum += 1;
            y = 15;
        }
    };
    const sectionTitle = (text) => {
        ensure(14);
        y += 4;
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(10);
        doc.setTextColor(...BLUE);
        doc.text(text, M, y);
        y += 2;
        doc.setDrawColor(...BLUE);
        doc.setLineWidth(0.4);
        doc.line(M, y, RIGHT, y);
        y += 5;
    };
    const row = (left, right, { bold = false, color = BODY, mid = null, size = 9 } = {}) => {
        ensure(6);
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(size);
        doc.setTextColor(...color);
        doc.text(doc.splitTextToSize(left, mid ? 95 : 140)[0], M + 2, y);
        if (mid) doc.text(mid, M + 120, y, { align: 'right' });
        doc.text(right, RIGHT - 2, y, { align: 'right' });
        y += 5.5;
    };

    // ── Encabezado ──
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.setTextColor(...BLUE);
    doc.text('COMPRAS DE MERCANCÍA', M, y);
    y += 6;
    doc.setFontSize(11);
    doc.setTextColor(...BODY);
    doc.text(businessName ? businessName.toUpperCase() : 'MI NEGOCIO', M, y);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    const nowStr = new Date().toLocaleString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
    doc.text(`Emitido: ${nowStr}`, RIGHT, y, { align: 'right' });
    y += 5;
    doc.text(rangeLabel(from, to), M, y);
    y += 6;

    // ── Total ──
    doc.setFillColor(...BAND);
    doc.roundedRect(M, y, RIGHT - M, 26, 3, 3, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text('TOTAL GASTADO EN MERCANCÍA', M + 5, y + 7);
    doc.setFontSize(22);
    doc.setTextColor(...RED);
    doc.text(`$ ${formatUsd(summary.totalUsd)}`, M + 5, y + 17);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...BODY);
    doc.text(`Aprox. Bs ${formatBs(summary.totalBs)} (a la tasa de cada día)`, M + 5, y + 23);
    const stats = [
        `Facturas: ${summary.count}`,
        `Días con compras: ${summary.days.length}`,
        `Promedio por día: $ ${formatUsd(summary.avgPerDay)}`,
    ];
    if (Number.isFinite(salesUsd) && salesUsd !== null) stats.push(`Ventas del período: $ ${formatUsd(salesUsd)}`);
    stats.forEach((line, i) => doc.text(line, RIGHT - 5, y + 7 + i * 5, { align: 'right' }));
    y += 32;

    if (summary.count === 0) {
        doc.setFontSize(10);
        doc.setTextColor(...MUTED);
        doc.text('No hay compras registradas en este período.', M, y);
        addFooter(pageNum);
        doc.save(`Compras_${from || 'todo'}_${to || ''}.pdf`);
        return;
    }

    // ── Por proveedor ──
    sectionTitle('POR PROVEEDOR');
    summary.suppliers.forEach((s) => {
        row(s.name, `$ ${formatUsd(s.totalUsd)}`, { mid: `${formatUsd(s.pct)} % · ${s.count} fact.` });
    });

    // ── Por día ──
    sectionTitle('POR DÍA');
    [...summary.days].reverse().forEach((d) => {
        row(fmtDate(d.date), `$ ${formatUsd(d.totalUsd)}`, { mid: `${d.count} fact.` });
    });

    // ── Detalle ──
    sectionTitle('DETALLE');
    [...summary.days].reverse().forEach((d) => {
        ensure(14);
        row(fmtDate(d.date), `$ ${formatUsd(d.totalUsd)}`, { bold: true, color: INK });
        [...d.items].reverse().forEach((p) => {
            const label = p.note ? `${p.supplier} — ${p.note}` : p.supplier;
            const mid = p.currency === 'BS' ? `Bs ${formatBs(p.amountBs)}` : null;
            row(`   ${label}`, `$ ${formatUsd(p.amountUsd)}`, { mid });
        });
        doc.setDrawColor(...RULE);
        doc.setLineWidth(0.2);
        doc.line(M, y - 3, RIGHT, y - 3);
        y += 1;
    });

    ensure(10);
    y += 3;
    row('TOTAL DEL PERÍODO', `$ ${formatUsd(summary.totalUsd)}`, { bold: true, color: RED, size: 11 });

    addFooter(pageNum);
    doc.save(`Compras_${from || 'todo'}_${to || ''}.pdf`);
}
