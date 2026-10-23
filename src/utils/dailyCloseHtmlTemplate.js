/**
 * dailyCloseHtmlTemplate.js
 *
 * Genera el HTML completo para impresión térmica del Cierre de Caja.
 * Reemplaza la ruta jsPDF→blob→iframe del action:'print' para producir
 * salida nítida, negro puro sobre blanco, adaptada a 58mm o 80mm.
 *
 * La ruta action:'download' (jsPDF, carta) NO se toca.
 *
 * @module utils/dailyCloseHtmlTemplate
 */

import { formatBs, formatCop, formatUsd } from './calculatorUtils.js';
import { round2 } from './dinero.js';

function escHtml(str) {
    if (str === null || str === undefined) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function fmtUsd(v) {
    return `$${formatUsd(v)}`;
}

function rowHtml(label, value, fBase, opts = {}) {
    const { bold = false, color = '#000', borderTop = false } = opts;
    const fw = bold ? '900' : 'bold';
    const border = borderTop ? 'border-top:1px dashed #000;padding-top:4px;' : '';
    return `
        <tr style="${border}">
            <td style="font-size:${fBase};font-weight:${fw};color:${color};text-align:left;padding:2px 4px 2px 0;width:62%;vertical-align:top;word-break:break-word;">${escHtml(label)}</td>
            <td style="font-size:${fBase};font-weight:${fw};color:${color};text-align:right;padding:2px 0;width:38%;vertical-align:top;white-space:nowrap;">${value}</td>
        </tr>`;
}

/**
 * Construye el HTML completo del cierre de caja para impresión térmica.
 *
 * @param {object} cierreData  - Los datos del cierre (misma forma que generateDailyClosePDF recibe).
 * @param {object} paperConfig - Resultado de getPaperConfig(paperWidth).
 * @param {object} settings    - { name, rif, address, phone }.
 * @returns {string} HTML completo listo para openPrintWindow().
 */
export function buildDailyCloseHtml(cierreData, paperConfig, settings) {
    const {
        cssPageSize, cssBodyWidth, cssLogoW,
        fDisclaimer, fTiny, fSmall, fBase, fTitle, fTotalU, fTotalB,
        is80,
    } = paperConfig;

    const {
        todayTotalUsd = 0,
        todayTotalBs = 0,
        todayItemsSold = 0,
        paymentBreakdown = {},
        topProducts = [],
        reconData = null,
        apertura = null,
        copEnabled = false,
        bcvRate = 1,
        isReprint = false,
        cierreNumber = null,
        sales = [],
    } = cierreData;

    const now = new Date();
    const fecha = now.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const hora = now.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });

    // ── Fondo inicial ──────────────────────────────────────────────
    const fondoUsd = apertura ? (Number(apertura.openingUsd) || 0) : 0;
    const fondoBs = apertura ? (Number(apertura.openingBs) || 0) : 0;
    const fondoCop = apertura ? (Number(apertura.openingCop) || 0) : 0;
    const hasFondo = fondoUsd > 0 || fondoBs > 0 || (copEnabled && fondoCop > 0);

    const aperturaSectionHtml = hasFondo ? `
        <div style="margin-bottom:6px;">
            <div style="font-size:${fTiny};font-weight:bold;color:#000;margin-bottom:2px;text-transform:uppercase;letter-spacing:0.5px;">Fondo Inicial</div>
            <table style="width:100%;">
                ${fondoUsd > 0 ? rowHtml('Efectivo USD', fmtUsd(fondoUsd), fSmall) : ''}
                ${fondoBs > 0 ? rowHtml('Efectivo Bs', 'Bs ' + formatBs(fondoBs), fSmall) : ''}
                ${copEnabled && fondoCop > 0 ? rowHtml('Efectivo COP', 'COP ' + formatCop(fondoCop), fSmall) : ''}
            </table>
        </div>
        <hr class="dash">` : '';

    // ── Desglose de ingresos ───────────────────────────────────────
    const breakdownEntries = Object.values(paymentBreakdown)
        .filter(entry => entry && (Number(entry.total) || 0) > 0);

    const breakdownHtml = breakdownEntries.length > 0 ? `
        <div style="margin-bottom:6px;">
            <div style="font-size:${fTiny};font-weight:bold;color:#000;margin-bottom:2px;text-transform:uppercase;letter-spacing:0.5px;">Ingresos por Método</div>
            <table style="width:100%;">
                ${breakdownEntries.map(entry => {
                    const currency = entry.currency || 'USD';
                    let valStr = '';
                    if (currency === 'BS' || currency === 'VES') {
                        valStr = 'Bs ' + formatBs(entry.total);
                    } else if (currency === 'COP') {
                        valStr = 'COP ' + formatCop(entry.total);
                    } else {
                        valStr = fmtUsd(entry.total);
                    }
                    return rowHtml(entry.label || entry.methodId || '—', valStr, fSmall);
                }).join('')}
            </table>
        </div>
        <hr class="dash">` : '';

    // ── Egresos (gastos/autoconsumos) ──────────────────────────────
    const gastos = (sales || []).filter(s =>
        s.tipo === 'GASTO_INTERNO' || s.tipo === 'AUTOCONSUMO' || s.tipo === 'APERTURA_CAJA'
    );
    const totalGastosUsd = gastos.reduce((acc, s) => acc + (Number(s.totalUsd) || 0), 0);
    const egresosHtml = totalGastosUsd > 0 ? `
        <div style="margin-bottom:6px;">
            <div style="font-size:${fTiny};font-weight:bold;color:#000;margin-bottom:2px;text-transform:uppercase;letter-spacing:0.5px;">Egresos</div>
            <table style="width:100%;">
                ${gastos.map(s => rowHtml(
                    s.tipo === 'GASTO_INTERNO' ? (s.description || 'Gasto interno') :
                    s.tipo === 'AUTOCONSUMO' ? 'Autoconsumo' : 'Apertura/Aporte',
                    '-' + fmtUsd(Number(s.totalUsd) || 0),
                    fSmall
                )).join('')}
                ${rowHtml('Total Egresos', '-' + fmtUsd(totalGastosUsd), fSmall, { bold: true, borderTop: true })}
            </table>
        </div>
        <hr class="dash">` : '';

    // ── Totales principales ────────────────────────────────────────
    const netUsd = todayTotalUsd - totalGastosUsd;

    // ── Arqueo físico ──────────────────────────────────────────────
    let arqueoHtml = '';
    if (reconData) {
        const expectedUsd = Number(reconData.expectedUsd) || 0;
        const expectedBs = Number(reconData.expectedBs) || 0;
        const cashUsd = Number(reconData.cashUsd) || reconData.countedUsd || 0;
        const cashBs = Number(reconData.cashBs) || reconData.countedBs || 0;
        const diffUsd = cashUsd - expectedUsd;
        const diffBs = cashBs - expectedBs;

        const diffColorUsd = diffUsd >= 0 ? '#000' : '#000';
        const diffColorBs = diffBs >= 0 ? '#000' : '#000';
        const diffUsdStr = (diffUsd >= 0 ? '+' : '') + fmtUsd(Math.abs(diffUsd));
        const diffBsStr = (diffBs >= 0 ? '+' : '-') + 'Bs ' + formatBs(Math.abs(diffBs));

        arqueoHtml = `
            <div style="margin-bottom:6px;">
                <div style="font-size:${fTiny};font-weight:bold;color:#000;margin-bottom:2px;text-transform:uppercase;letter-spacing:0.5px;">Arqueo de Caja</div>
                <table style="width:100%;">
                    ${rowHtml('Esperado USD', fmtUsd(expectedUsd), fSmall)}
                    ${rowHtml('Contado USD', fmtUsd(cashUsd), fSmall)}
                    ${rowHtml('Diferencia USD', diffUsdStr, fSmall, { bold: true, color: diffColorUsd })}
                    ${expectedBs > 0 || cashBs > 0 ? rowHtml('Esperado Bs', 'Bs ' + formatBs(expectedBs), fSmall) : ''}
                    ${expectedBs > 0 || cashBs > 0 ? rowHtml('Contado Bs', 'Bs ' + formatBs(cashBs), fSmall) : ''}
                    ${expectedBs > 0 || cashBs > 0 ? rowHtml('Diferencia Bs', diffBsStr, fSmall, { bold: true, color: diffColorBs }) : ''}
                </table>
            </div>
            <hr class="dash">`;
    }

    // ── Top productos ──────────────────────────────────────────────
    const topHtml = topProducts.length > 0 ? `
        <div style="margin-bottom:6px;">
            <div style="font-size:${fTiny};font-weight:bold;color:#000;margin-bottom:2px;text-transform:uppercase;letter-spacing:0.5px;">Productos Más Vendidos</div>
            <table style="width:100%;">
                ${topProducts.slice(0, 5).map((p, i) => `
                    <tr>
                        <td style="font-size:${fSmall};text-align:left;padding:1px 4px 1px 0;width:75%;word-break:break-word;">${i + 1}. ${escHtml(p.name)}</td>
                        <td style="font-size:${fSmall};text-align:right;padding:1px 0;width:25%;white-space:nowrap;">${
                            p.isWeight ? `${round2(p.qty || 0)} kg` : `${p.qty || 0} uds`
                        }</td>
                    </tr>`).join('')}
            </table>
        </div>
        <hr class="dash">` : '';

    // ── COP total ──────────────────────────────────────────────────
    const copTotalEntry = copEnabled && paymentBreakdown
        ? Object.values(paymentBreakdown).find(e => e && (e.currency === 'COP' || (e.methodId || '').includes('cop')))
        : null;
    const totalCop = copTotalEntry ? (Number(copTotalEntry.total) || 0) : 0;

    const cierreNumStr = cierreNumber != null ? ` #${cierreNumber}` : '';
    const titleLabel = isReprint ? `REIMPRESIÓN CIERRE${cierreNumStr}` : `CIERRE DE CAJA${cierreNumStr}`;

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>${titleLabel}</title>
<style>
    @page {
        size: ${cssPageSize};
        margin: 0;
    }
    * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
        font-weight: bold !important;
        color: #000 !important;
    }
    body {
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-weight: bold;
        width: ${cssBodyWidth};
        max-width: ${cssBodyWidth};
        margin: 0 auto;
        padding: 4mm 2mm;
        color: #000;
        background: #fff;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
    }
    .center { text-align: center; }
    .bold { font-weight: 900; }
    .dash {
        border: none;
        border-top: 1px dashed #000 !important;
        margin: ${is80 ? '8px 0' : '6px 0'};
    }
    .total-usd {
        font-size: ${fTotalU};
        font-weight: 900;
        color: #000;
        text-align: center;
        margin: 4px 0;
    }
    .total-bs {
        font-size: ${fTotalB};
        font-weight: bold;
        text-align: center;
        margin-bottom: 4px;
    }
    table { width: 100%; border-collapse: collapse; }
    @media print {
        body { width: ${cssBodyWidth}; max-width: ${cssBodyWidth}; }
    }
    @media screen {
        body {
            border: 1px solid #ccc;
            margin-top: 10px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.15);
        }
    }
</style>
</head>
<body>

    <!-- Logo -->
    <div class="center" style="margin-bottom:6px;">
        <img src="./logo.png" alt="Logo" style="max-width:${cssLogoW};max-height:16mm;" onerror="this.style.display='none'">
    </div>

    <!-- Encabezado del negocio -->
    <div class="center" style="margin-bottom:6px;line-height:1.2;">
        ${settings.name ? `<div class="bold" style="font-size:${fTitle};text-transform:uppercase;">${escHtml(settings.name)}</div>` : ''}
        ${settings.rif ? `<div style="font-size:${fTiny};">RIF: ${escHtml(settings.rif)}</div>` : ''}
        ${settings.address ? `<div style="font-size:${fTiny};">${escHtml(settings.address)}</div>` : ''}
        ${settings.phone ? `<div style="font-size:${fTiny};">Tel: ${escHtml(settings.phone)}</div>` : ''}
    </div>

    <hr class="dash">

    <!-- Título del documento -->
    <div class="center" style="font-size:${fBase};font-weight:900;margin:4px 0;">${escHtml(titleLabel)}</div>
    <div style="font-size:${fTiny};color:#000;margin:2px 0 6px;">Fecha: ${fecha} ${hora}</div>
    <div style="font-size:${fTiny};color:#000;margin-bottom:2px;">Tasa BCV: Bs ${formatBs(bcvRate)}</div>
    <div style="font-size:${fTiny};color:#000;margin-bottom:2px;">Operaciones: ${todayItemsSold}</div>

    <hr class="dash">

    <!-- Fondo inicial -->
    ${aperturaSectionHtml}

    <!-- Desglose de ingresos -->
    ${breakdownHtml}

    <!-- Egresos -->
    ${egresosHtml}

    <!-- Total del día -->
    <div style="margin-bottom:6px;">
        <div style="font-size:${fTiny};font-weight:bold;color:#000;margin-bottom:2px;text-transform:uppercase;letter-spacing:0.5px;">Total del Día</div>
        <div class="center bold" style="font-size:${fSmall};margin-bottom:4px;">TOTAL NETO</div>
        <div class="total-usd">${fmtUsd(todayTotalUsd)}</div>
        ${copEnabled && totalCop > 0 ? `<div class="total-bs" style="font-size:${is80 ? '16px' : '13px'};">COP ${formatCop(totalCop)}</div>` : ''}
        <div class="total-bs">Bs ${formatBs(todayTotalBs)}</div>
        ${totalGastosUsd > 0 ? `
        <div style="margin-top:4px;padding-top:4px;border-top:1px dashed #000;">
            <table style="width:100%;">
                ${rowHtml('Neto (sin egresos)', fmtUsd(netUsd), fSmall, { bold: true })}
            </table>
        </div>` : ''}
    </div>

    <hr class="dash">

    <!-- Arqueo físico -->
    ${arqueoHtml}

    <!-- Top productos -->
    ${topHtml}

    <!-- Pie -->
    <div class="center bold" style="font-size:${fBase};margin:8px 0 4px;">¡Caja cerrada!</div>
    <div class="center" style="font-size:${fDisclaimer};color:#888;margin-top:4px;line-height:1.4;">Reporte de control interno.<br>Sin valor fiscal ni tributario.</div>

</body>
</html>`;
}
