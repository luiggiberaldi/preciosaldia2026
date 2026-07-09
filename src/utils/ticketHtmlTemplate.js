import { formatBs, formatCop, formatUsd } from './calculatorUtils';
// FIN-024: reemplazar `* rate` raw y `.toFixed(2)` con mulR + formatUsd (sin Math.round/toFixed).
import { mulR } from './dinero';

function escapeHtml(str) {
    if (str === null || str === undefined) return '';
    const s = String(str);
    return s
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Genera el HTML completo para impresión térmica de un ticket de venta.
 */
export function buildTicketHtml(sale, bcvRate, paperConfig, settings) {
    const {
        is80, cssPageSize, cssBodyWidth, cssLogoW,
        fDisclaimer, fTiny, fSmall, fBase, fTitle, fTotalU, fTotalB,
    } = paperConfig;

    const rate = sale.rate || bcvRate || 1;
    const isCop = sale.copEnabled && sale.tasaCop > 0;
    // FIN-024: formatUsd en vez de parseFloat(v).toFixed(2).
    const fmtUsd = (v) => isCop ? `USD ${formatUsd(v)}` : `$${formatUsd(v)}`;
    const saleNum = String(sale.saleNumber || 0).padStart(7, '0');
    const d = new Date(sale.timestamp);
    const fecha = d.toLocaleDateString('es-VE');
    const hora = d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
    const hasFiado = sale.fiadoUsd > 0;

    // Generar filas de productos
    const itemsHtml = (sale.items || []).map(item => {
        // FIN-024: formatUsd para qty peso, sin toFixed.
        const qty = item.isWeight ? formatUsd(item.qty) : String(item.qty);
        const unit = item.isWeight ? 'Kg' : 'u';
        // FIN-024: mulR en vez de multiplicación raw.
        const sub = mulR(item.priceUsd, item.qty);
        const subBs = mulR(sub, rate);
        const name = escapeHtml(item.name);
        const importeStr = fmtUsd(sub);
        const detailStr = isCop
            ? 'USD ' + formatUsd(item.priceUsd) + ' c/u - ' + formatCop(item.priceCop ? mulR(item.priceCop, item.qty) : mulR(sub, sale.tasaCop)) + ' COP - Bs ' + formatBs(subBs)
            : '$' + formatUsd(item.priceUsd) + ' c/u - Bs ' + formatBs(subBs);
        return `
            <tr>
                <td style="text-align:left;font-size:${fBase};padding:2px 6px 2px 0;width:15%;white-space:nowrap;vertical-align:top;">${qty}${unit}</td>
                <td style="text-align:left;font-size:${fBase};padding:2px 4px 2px 0;line-height:1.2;width:55%;vertical-align:top;word-break:break-word;">${name}</td>
                <td style="text-align:right;font-size:${fBase};font-weight:bold;padding:2px 0;width:30%;vertical-align:top;white-space:nowrap;">${importeStr}</td>
            </tr>
            <tr>
                <td></td>
                <td colspan="2" style="font-size:${fTiny};color:#888;padding:0 0 4px;word-break:break-word;">${detailStr}</td>
            </tr>`;
    }).join('');

    // Generar filas de pagos
    const paymentsHtml = (sale.payments || []).map(p => {
        const pIsCop = p.currency === 'COP';
        const isBs = !pIsCop && (p.currency ? p.currency !== 'USD' : (p.methodId?.includes('_bs') || p.methodId === 'pago_movil'));
        // FIN-024: mulR en vez de multiplicación raw.
        const val = pIsCop
            ? 'COP ' + (p.amountInput || mulR(p.amountUsd, (sale.tasaCop || 1))).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
            : isBs
            ? 'Bs ' + formatBs(p.amountBs || mulR(p.amountUsd, rate))
            : fmtUsd(p.amountUsd || 0);
        return `
            <tr>
                <td style="font-size:11px;padding:2px 0;">${escapeHtml(p.methodLabel || 'Pago')}</td>
                <td style="font-size:11px;font-weight:bold;text-align:right;padding:2px 0;">${val}</td>
            </tr>`;
    }).join('');

    const fiadoRate = bcvRate || rate;
    // FIN-024: mulR en vez de multiplicación raw.
    const fiadoHtml = hasFiado ? `
        <div style="margin-top:6px;padding:4px 0;border-top:1px dashed #000;">
            <table style="width:100%"><tr>
                <td style="color:#000;font-weight:bold;font-size:11px;">Deuda pendiente:</td>
                <td style="color:#000;font-weight:bold;font-size:11px;text-align:right;">${fmtUsd(sale.fiadoUsd)}</td>
            </tr><tr>
                <td></td>
                <td style="color:#000;font-size:9px;text-align:right;">Bs ${formatBs(mulR(sale.fiadoUsd, fiadoRate))} (tasa actual)</td>
            </tr></table>
        </div>` : '';

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<title>Ticket #${saleNum}</title>
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
        font-family: 'Courier New', 'Lucida Console', monospace;
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
    .bold { font-weight: bold; }
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

    <!-- Info del Negocio -->
    <div class="center" style="margin-bottom:6px;line-height:1.2;">
        ${settings.name ? `<div class="bold" style="font-size:${fTitle};text-transform:uppercase;">${escapeHtml(settings.name)}</div>` : ''}
        ${settings.rif ? `<div style="font-size:${fTiny};">RIF: ${escapeHtml(settings.rif)}</div>` : ''}
        ${settings.address ? `<div style="font-size:${fTiny};">${escapeHtml(settings.address)}</div>` : ''}
        ${settings.phone ? `<div style="font-size:${fTiny};">Tel: ${escapeHtml(settings.phone)}</div>` : ''}
        ${settings.instagram ? `<div style="font-size:${fTiny};">Ig: ${escapeHtml(settings.instagram)}</div>` : ''}
    </div>

    <hr class="dash">

    <!-- Info -->
    <div style="font-size:${fSmall};font-weight:bold;margin-bottom:2px;text-align:left;">N: #${saleNum}</div>
    <div style="font-size:${fTiny};color:#000;margin-bottom:4px;text-align:left;">Fecha: ${fecha} ${hora}</div>
    <div style="font-size:${fSmall};margin:3px 0 2px;">
        <span style="font-weight:bold;">Cliente:</span> ${escapeHtml(sale.customerName || 'Consumidor Final')}
    </div>
    ${sale.customerDocument ? `<div style="font-size:${fTiny};color:#000;">C.I/RIF: ${escapeHtml(sale.customerDocument)}</div>` : ''}

    <hr class="dash">

    <!-- Productos Header -->
    <table style="margin-bottom:4px;width:100%;">
        <tr style="font-size:${fTiny};color:#000;font-weight:bold;">
            <td style="text-align:left;width:15%;">CANT</td>
            <td style="text-align:left;width:55%;">DESCRIPCION</td>
            <td style="text-align:right;width:30%;">IMPORTE</td>
        </tr>
    </table>

    <!-- Productos -->
    <table style="width:100%;">${itemsHtml}</table>



    <!-- Total -->
    <div style="margin:8px 0;">
        ${sale.discountAmountUsd > 0 ? `
        <table style="margin-bottom:6px; font-size:${fTiny}; border-bottom: 1px dashed #000; padding-bottom: 4px;">
            <tr>
                <td style="text-align:left; color:#000; font-weight:bold;">SUBTOTAL:</td>
                <td style="text-align:right; color:#000; font-weight:bold;">${fmtUsd(sale.cartSubtotalUsd || (sale.totalUsd + sale.discountAmountUsd))}</td>
            </tr>
            <tr>
                <td style="text-align:left; color:#000; font-weight:bold;">${sale.discountType === 'percentage' ? `DESCUENTO (${sale.discountValue}%):` : 'DESCUENTO:'}</td>
                <td style="text-align:right; color:#000; font-weight:bold;">-${fmtUsd(sale.discountAmountUsd)}</td>
            </tr>
        </table>
        ` : ''}
        <div class="center bold" style="font-size:${fSmall};color:#000;margin-bottom:4px;">TOTAL A PAGAR</div>
        <div class="total-usd">${fmtUsd(sale.totalUsd || 0)}</div>
        ${isCop ? `<div class="total-bs" style="font-size:${is80 ? '16px' : '13px'};">COP ${formatCop(sale.totalCop || mulR(sale.totalUsd, sale.tasaCop))}</div>` : ''}
        <div class="total-bs" style="margin-bottom:4px">Bs ${formatBs(sale.totalBs || 0)}</div>
    </div>

    <hr class="dash">

    <!-- Pagos -->
    ${(sale.payments && sale.payments.length > 0) || hasFiado ? `
    <div style="margin:4px 0;">
        <div style="font-size:${fTiny};color:#000;font-weight:bold;margin-bottom:4px;">PAGOS REALIZADOS</div>
        <table>${paymentsHtml}</table>
        ${fiadoHtml}
    </div>
    <hr class="dash">
    ` : ''}

    <!-- Pie -->
    <div class="center bold" style="font-size:${fBase};margin:8px 0 4px;">Gracias por tu compra!</div>
    <div class="center" style="font-size:${fDisclaimer};color:#888;margin-top:4px;line-height:1.4;">Este documento no constituye factura fiscal.<br>Comprobante de control interno sin validez tributaria.</div>
</body>
</html>`;
}
