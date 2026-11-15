/**
 * payrollReceipt.js — Recibo de nómina (ticket térmico y PDF).
 *
 * Plan: docs/plans/2026-11-14-plan-nomina-simple-bodega.md (F3; el dueño pidió ticket y PDF).
 * `buildPayrollReceiptData` es puro (se prueba); imprimir y bajar el PDF usan el navegador.
 *
 * @module utils/payrollReceipt
 */

import { escapeHtml, openPrintWindow } from './printerUtils';
import { formatBs, formatUsd } from './calculatorUtils';
import { ENTRY_TYPE_LABELS, FRECUENCIA_LABELS, GOODS_TYPE, GOODS_VALUATION_LABELS, periodLabel } from './payrollModel';
import { getPaymentLabel } from '../config/paymentMethods';

function businessSettings() {
    const get = (k, d = '') => {
        try { return localStorage.getItem(k) || d; } catch { return d; }
    };
    return { name: get('business_name', 'Bodega'), rif: get('business_rif'), phone: get('business_phone') };
}

/**
 * Datos del recibo, ya en texto. `saldoDespuesUsd` es el saldo del periodo
 * después del movimiento.
 */
export function buildPayrollReceiptData({ entry, employee, saldoDespuesUsd, business = businessSettings(), methodLabel }) {
    const fecha = new Date(entry.timestamp);
    const rows = [
        ['Empleado', employee?.nombre || '—'],
        ...(employee?.cedula ? [['Cédula', employee.cedula]] : []),
        ...(employee?.cargo ? [['Cargo', employee.cargo]] : []),
        ['Frecuencia', FRECUENCIA_LABELS[employee?.frecuencia] || '—'],
        ['Periodo', periodLabel(entry.periodoId)],
        ['Concepto', ENTRY_TYPE_LABELS[entry.tipo] || entry.tipo],
    ];
    if (entry.metodoId) rows.push(['Forma de pago', methodLabel || getPaymentLabel(entry.metodoId) || entry.metodoId]);
    if (entry.tipo === GOODS_TYPE && Array.isArray(entry.items)) {
        rows.push(['Precio', GOODS_VALUATION_LABELS[entry.valoracion] || 'Precio de costo']);
        for (const i of entry.items) rows.push([`${i.qty} × ${i.name}`, `$${formatUsd(i.subtotalUsd)}`]);
    }
    const montoPrincipal = entry.moneda === 'BS' ? `Bs ${formatBs(entry.montoBs)}` : `$${formatUsd(entry.montoUsd)}`;
    const montoSecundario = entry.moneda === 'BS'
        ? `Equivale a $${formatUsd(entry.montoUsd)} (tasa ${entry.tasa})`
        : (entry.tasa ? `Equivale a Bs ${formatBs(entry.montoBs)} (tasa ${entry.tasa})` : '');
    return {
        business,
        titulo: `Recibo de ${(ENTRY_TYPE_LABELS[entry.tipo] || 'nómina').toLowerCase()}`,
        numero: String(entry.id).slice(-8).toUpperCase(),
        fecha: fecha.toLocaleString('es-VE', { timeZone: 'America/Caracas', dateStyle: 'short', timeStyle: 'short' }),
        rows,
        montoPrincipal,
        montoSecundario,
        saldo: `Queda por pagar en el periodo: $${formatUsd(Math.max(0, saldoDespuesUsd ?? 0))}`,
        nota: entry.nota || '',
        anulado: entry.status === 'ANULADO',
        firma: entry.tipo === 'ADELANTO' || entry.tipo === 'PAGO' || entry.tipo === GOODS_TYPE,
        actor: entry.actor || '',
    };
}

export function buildPayrollReceiptHtml(data, paperWidth = '58') {
    const w = paperWidth === '80' ? '80mm' : '58mm';
    const e = escapeHtml;
    const rows = data.rows.map(([k, v]) => `<tr><td class="k">${e(k)}</td><td class="v">${e(v)}</td></tr>`).join('');
    return `<!doctype html><html><head><meta charset="utf-8"><title>${e(data.titulo)}</title>
<style>
  @page { size: ${w} auto; margin: 0; }
  body { width: ${w}; margin: 0; padding: 3mm; font-family: Arial, sans-serif; font-size: 11px; color: #000; box-sizing: border-box; }
  h1 { font-size: 14px; text-align: center; margin: 0 0 2px; }
  .c { text-align: center; } .m { color: #444; font-size: 10px; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; } td { padding: 1px 0; vertical-align: top; }
  .k { color: #444; padding-right: 4px; } .v { text-align: right; font-weight: bold; }
  .monto { font-size: 18px; font-weight: bold; text-align: center; margin: 4px 0 0; }
  .anulado { text-align: center; font-weight: bold; border: 2px solid #000; padding: 2px; margin: 4px 0; }
  .firma { margin-top: 24px; border-top: 1px solid #000; text-align: center; padding-top: 2px; }
</style></head><body>
  <h1>${e(data.business.name)}</h1>
  ${data.business.rif ? `<div class="c m">RIF ${e(data.business.rif)}</div>` : ''}
  <hr>
  <div class="c"><b>${e(data.titulo.toUpperCase())}</b></div>
  <div class="c m">N.º ${e(data.numero)} · ${e(data.fecha)}</div>
  ${data.anulado ? '<div class="anulado">ANULADO</div>' : ''}
  <hr>
  <table>${rows}</table>
  <hr>
  <div class="monto">${e(data.montoPrincipal)}</div>
  ${data.montoSecundario ? `<div class="c m">${e(data.montoSecundario)}</div>` : ''}
  <hr>
  <div class="c">${e(data.saldo)}</div>
  ${data.nota ? `<div class="c m">Nota: ${e(data.nota)}</div>` : ''}
  ${data.firma ? '<div class="firma">Recibí conforme</div>' : ''}
  <div class="c m" style="margin-top:6px">Registrado por ${e(data.actor)} · comprobante interno</div>
</body></html>`;
}

export function printPayrollReceipt(data) {
    let paper = '58';
    try { paper = localStorage.getItem('printer_paper_width') || '58'; } catch { /* sin almacenamiento */ }
    openPrintWindow(buildPayrollReceiptHtml(data, paper));
}

/** Baja el recibo como PDF (para enviarlo por WhatsApp). */
export async function downloadPayrollReceiptPdf(data) {
    const { jsPDF } = await import('jspdf');
    const W = 80;
    const M = 6;
    const H = 120 + data.rows.length * 6 + (data.nota ? 8 : 0) + (data.firma ? 16 : 0);
    const doc = new jsPDF('p', 'mm', [W, H]);
    let y = 10;
    const center = (txt, size = 9, bold = false) => {
        doc.setFont('helvetica', bold ? 'bold' : 'normal');
        doc.setFontSize(size);
        doc.splitTextToSize(String(txt), W - 2 * M).forEach(line => { doc.text(line, W / 2, y, { align: 'center' }); y += size * 0.45; });
        y += 1;
    };
    const rule = () => { doc.setLineDashPattern([1, 1], 0); doc.line(M, y, W - M, y); doc.setLineDashPattern([], 0); y += 4; };

    center(data.business.name, 12, true);
    if (data.business.rif) center(`RIF ${data.business.rif}`, 8);
    rule();
    center(data.titulo.toUpperCase(), 10, true);
    center(`N.º ${data.numero} · ${data.fecha}`, 7);
    if (data.anulado) center('ANULADO', 12, true);
    rule();
    doc.setFontSize(8);
    data.rows.forEach(([k, v]) => {
        doc.setFont('helvetica', 'normal'); doc.text(String(k), M, y);
        doc.setFont('helvetica', 'bold'); doc.text(String(v).slice(0, 38), W - M, y, { align: 'right' });
        y += 5;
    });
    rule();
    center(data.montoPrincipal, 16, true);
    if (data.montoSecundario) center(data.montoSecundario, 7);
    rule();
    center(data.saldo, 8);
    if (data.nota) center(`Nota: ${data.nota}`, 7);
    if (data.firma) { y += 10; doc.line(M + 8, y, W - M - 8, y); y += 4; center('Recibí conforme', 8); }
    center(`Registrado por ${data.actor} · comprobante interno`, 6);
    doc.save(`recibo_nomina_${data.numero}.pdf`);
}
