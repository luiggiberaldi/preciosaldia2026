import { jsPDF } from 'jspdf';
import { formatBs, formatCop, formatUsd } from './calculatorUtils';
import { getPaymentLabel, toTitleCase } from '../config/paymentMethods';
// FIN-025: copEnabled/tasaCop se reciben como parámetros; localStorage solo como fallback.
import { round2, mulR, divR } from './dinero';

/**
 * Genera un PDF de Cierre del Día con reporte detallado.
 * Formato: 80mm ancho (estilo recibo) para compartir fácilmente por WhatsApp.
 *
 * FIN-025: `copEnabled` y `tasaCop` ahora se reciben como parámetros opcionales.
 *   Si NO se pasan, se cae al localStorage con `console.warn` (legacy behavior).
 */
export async function generateDailyClosePDF({
    sales,           // Ventas del día (netas, sin anuladas)
    allSales,        // Todas las transacciones del día (incluye anuladas para contarlas)
    bcvRate,
    paymentBreakdown,
    topProducts,
    todayTotalUsd,
    todayTotalBs,
    todayProfit,
    todayItemsSold,
    reconData, // Datos del cuadre físico
    apertura,  // Registro de apertura de caja: { openingUsd, openingBs, sellerName }
    // FIN-025: preferir pasar copEnabled/tasaCop explícitamente desde el caller
    // (DashboardView ya los tiene en scope). Fallback a localStorage solo si no se pasan.
    copEnabled: copEnabledParam,
    tasaCop: tasaCopParam,
    action = 'share', // 'share' | 'print' | 'download'
}) {
    const WIDTH = 80;
    const M = 5;
    const CX = WIDTH / 2;
    const RIGHT = WIDTH - M;

    // Calcular altura dinámica
    const paymentRows = Object.keys(paymentBreakdown).length;
    const topProdRows = topProducts.length;
    const saleRows = allSales.length;
    // Calculate dynamic base height. Increase to 45mm per sale to fit detailed change rows
    const H = 200
        + (paymentRows * 7)
        + (topProdRows * 10)
        + (saleRows * 45);

    const doc = new jsPDF('p', 'mm', [WIDTH, H]);

    // FIN-025: COP mode detection — preferir parámetros explícitos del caller.
    // Fallback a localStorage con warning (legacy path).
    let isCop;
    let tasaCop;
    if (copEnabledParam != null) {
        isCop = !!copEnabledParam && (tasaCopParam != null ? tasaCopParam > 0 : false);
        tasaCop = tasaCopParam != null ? tasaCopParam : 0;
    } else {
        if (import.meta.env?.DEV) {
            console.warn('[dailyCloseGenerator] copEnabled/tasaCop NO pasados como parámetros; cayendo a localStorage (deprecado, FIN-025).');
        }
        // FIN-025: fallback a localStorage (legacy). Number() en vez de parseFloat.
        const copFlag = localStorage.getItem('cop_enabled');
        const tasaCopRaw = localStorage.getItem('tasa_cop') || '0';
        const tasaCopParsed = Number(tasaCopRaw) || 0;
        isCop = copFlag === 'true' && tasaCopParsed > 0;
        tasaCop = tasaCopParsed;
    }
    // FIN-016-pattern: formatUsd en vez de parseFloat(v).toFixed(2).
    const fmtUsd = (v) => `$${formatUsd(v)}`;

    // ── Paleta ──
    const INK = [33, 37, 41];
    const BODY = [73, 80, 87];
    const MUTED = [134, 142, 150];
    const GREEN = [16, 124, 65];
    const RULE = [206, 212, 218];
    const RED = [220, 53, 69];
    const BLUE = [37, 99, 235];

    let y = 6;

    // ── Helper: línea punteada ──
    const dash = (yy) => {
        doc.setDrawColor(...RULE);
        doc.setLineWidth(0.3);
        doc.setLineDashPattern([1, 1], 0);
        doc.line(M, yy, RIGHT, yy);
        doc.setLineDashPattern([], 0);
    };

    // ── Helper: sección header ──
    const sectionTitle = (text, yy) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        doc.setTextColor(...BLUE);
        doc.text(text, M, yy);
        return yy + 5;
    };

    // ════════════════════════════════════
    //  LOGO
    // ════════════════════════════════════
    try {
        const img = new Image();
        img.src = './logo.png';
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
        const logoW = 46;
        const logoH = 11;
        doc.addImage(img, 'PNG', CX - logoW / 2, y, logoW, logoH);
        y += logoH + 3;
    } catch (_) { y += 2; }

    // ════════════════════════════════════
    //  TÍTULO: CIERRE DEL DÍA
    // ════════════════════════════════════
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.setTextColor(...INK);
    doc.text('CIERRE DEL DÍA', CX, y, { align: 'center' });
    y += 5;

    const now = new Date();
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.setTextColor(...MUTED);
    doc.text(now.toLocaleDateString('es-VE', {
        weekday: 'long', day: '2-digit', month: 'long', year: 'numeric'
    }), CX, y, { align: 'center' });
    y += 4;
    doc.text('Emitido: ' + now.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }), CX, y, { align: 'center' });
    y += 5;

    dash(y); y += 6;

    // ════════════════════════════════════
    //  RESUMEN GENERAL
    // ════════════════════════════════════
    y = sectionTitle('RESUMEN GENERAL', y);

    const usdLabel = '$';
    const statsRows = [
        ['Ventas realizadas', `${sales.length}`],
        ['Artículos vendidos', `${todayItemsSold}`],
        [`Ingresos brutos (${usdLabel})`, fmtUsd(todayTotalUsd)],
        ['Ingresos brutos (Bs)', `Bs ${formatBs(todayTotalBs)}`],
        // FIN-024-pattern: divR en vez de raw division.
        [`Ganancia estimada (${usdLabel})`, fmtUsd(bcvRate > 0 ? divR(todayProfit, bcvRate) : 0)],
        ['Ganancia estimada (Bs)', `Bs ${formatBs(todayProfit)}`],
        ['Tasa BCV', `Bs ${formatBs(bcvRate)} / $1`],
    ];

    if (isCop && tasaCop > 0) {
        statsRows.push(['Tasa COP', `${tasaCop.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} / $1`]);
        // FIN-024-pattern: mulR en vez de raw multiplication.
        statsRows.splice(3, 0, ['Ingresos brutos (COP)', `${formatCop(mulR(todayTotalUsd, tasaCop))} COP`]);
    }

    statsRows.forEach(([label, value]) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(...BODY);
        doc.text(label, M, y);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...INK);
        doc.text(value, RIGHT, y, { align: 'right' });
        y += 5;
    });

    y += 2;
    dash(y); y += 6;

    // ════════════════════════════════════
    //  DESGLOSE POR MÉTODO DE PAGO
    // ════════════════════════════════════
    if (paymentRows > 0) {
        y = sectionTitle('PAGOS POR MÉTODO', y);

        Object.entries(paymentBreakdown).forEach(([methodId, data]) => {
            const label = toTitleCase(getPaymentLabel(methodId, data.label));
            const val = data.currency === 'USD'
                ? fmtUsd(data.total)
                : data.currency === 'COP'
                ? `COP ${data.total.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : `Bs ${formatBs(data.total)}`;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(...BODY);
            doc.text(label, M, y);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...INK);
            doc.text(val, RIGHT, y, { align: 'right' });
            y += 5;
        });

        y += 2;
        dash(y); y += 6;
    }

    // ════════════════════════════════════
    //  RECONCILIACIÓN DE CAJA (CUADRE)
    // ════════════════════════════════════
    if (reconData) {
        y = sectionTitle('CUADRE DE CAJA FISICA', y);

        const reconRows = [
            ['Declarado (USD)', fmtUsd(reconData.declaredUsd)],
            ['Declarado (Bs)', `Bs ${formatBs(reconData.declaredBs)}`],
            ['Diferencia USD', fmtUsd(reconData.diffUsd)],
            ['Diferencia Bs', `Bs ${formatBs(reconData.diffBs)}`]
        ];

        // Add COP rows if COP data exists
        // FIN-024-pattern: COP es entero por convención → parseInt(round2(...), 10) en vez de Math.round.
        if (reconData.declaredCop != null && (reconData.declaredCop > 0 || reconData.diffCop !== 0)) {
            reconRows.push(['Declarado (COP)', `COP ${parseInt(round2(reconData.declaredCop), 10).toLocaleString('es-CO')}`]);
            reconRows.push(['Diferencia COP', `COP ${parseInt(round2(reconData.diffCop), 10).toLocaleString('es-CO')}`]);
        }

        reconRows.forEach(([label, value], _i) => {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(...BODY);
            doc.text(label, M, y);

            doc.setFont('helvetica', 'bold');
            const isDiffRow = label.startsWith('Diferencia');
            if (isDiffRow) {
                const rawDiff = label.includes('USD') ? reconData.diffUsd : label.includes('Bs') ? reconData.diffBs : reconData.diffCop;
                const threshold = label.includes('USD') ? 0.05 : label.includes('Bs') ? 1 : 100;
                if (Math.abs(rawDiff) <= threshold) doc.setTextColor(...MUTED);
                else if (rawDiff < 0) doc.setTextColor(...RED);
                else doc.setTextColor(...GREEN);
            } else {
                doc.setTextColor(...INK);
            }
            doc.text(value, RIGHT, y, { align: 'right' });
            y += 5;
        });

        y += 2;
        dash(y); y += 6;
    }

    // ════════════════════════════════════
    //  APERTURA DE CAJA
    // ════════════════════════════════════
    if (apertura && (apertura.openingUsd > 0 || apertura.openingBs > 0 || (apertura.openingCop && apertura.openingCop > 0))) {
        y = sectionTitle('FONDO INICIAL (APERTURA)', y);

        const aperturaRows = [];
        if (apertura.openingUsd > 0) aperturaRows.push(['Efectivo USD inicial', fmtUsd(apertura.openingUsd)]);
        if (apertura.openingBs > 0) aperturaRows.push(['Efectivo Bs inicial', `Bs ${formatBs(apertura.openingBs)}`]);
        if (apertura.openingCop > 0) aperturaRows.push(['Efectivo COP inicial', `${formatCop(apertura.openingCop)} COP`]);
        if (apertura.sellerName) aperturaRows.push(['Cajero apertura', apertura.sellerName]);

        aperturaRows.forEach(([label, value]) => {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7);
            doc.setTextColor(...BODY);
            doc.text(label, M, y);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...INK);
            doc.text(value, RIGHT, y, { align: 'right' });
            y += 5;
        });

        y += 2;
        dash(y); y += 6;
    }

    // ════════════════════════════════════
    //  TOP PRODUCTOS
    // ════════════════════════════════════
    if (topProdRows > 0) {
        y = sectionTitle('PRODUCTOS MÁS VENDIDOS', y);

        topProducts.forEach((p, i) => {
            const rank = `${i + 1}.`;
            const name = p.name.length > 22 ? p.name.substring(0, 22) + '…' : p.name;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7);
            doc.setTextColor(...INK);
            doc.text(rank, M, y);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...BODY);
            doc.text(name, M + 5, y);
            y += 4;

            doc.setFontSize(6);
            doc.setTextColor(...MUTED);
            // FIN-024-pattern: mulR en vez de raw multiplication.
            doc.text(`${p.qty} vendidos · ${fmtUsd(p.revenue)} · Bs ${formatBs(mulR(p.revenue, bcvRate))}`, M + 5, y);
            y += 5;
        });

        y += 2;
        dash(y); y += 6;
    }

    // ════════════════════════════════════
    //  DETALLE DE VENTAS
    // ════════════════════════════════════
    y = sectionTitle('DETALLE DE VENTAS', y);

    allSales.forEach((s) => {
        const d = new Date(s.timestamp);
        const hora = d.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
        const isCanceled = s.status === 'ANULADA';
        const cliente = s.customerName || 'Consumidor Final';

        // Hora + Cliente + Total
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7);
        if (isCanceled) { doc.setTextColor(...RED); } else { doc.setTextColor(...INK); }
        doc.text(`${hora}`, M, y);
        doc.setFont('helvetica', 'normal');
        if (isCanceled) { doc.setTextColor(...RED); } else { doc.setTextColor(...BODY); }
        const clienteStr = cliente.length > 18 ? cliente.substring(0, 18) + '…' : cliente;
        doc.text(clienteStr, M + 12, y);

        doc.setFont('helvetica', 'bold');
        if (isCanceled) { doc.setTextColor(...RED); } else { doc.setTextColor(...GREEN); }
        const totalStr = isCanceled ? 'ANULADA' : fmtUsd(s.totalUsd || 0);
        doc.text(totalStr, RIGHT, y, { align: 'right' });
        y += 4;

        // Items resumidos
        if (s.items && s.items.length > 0 && !isCanceled) {
            s.items.forEach(item => {
                // FIN-024-pattern: formatUsd en vez de toFixed(2).
                const qty = item.isWeight ? `${formatUsd(item.qty)}kg` : `${item.qty}u`;
                const name = item.name.length > 22 ? item.name.substring(0, 22) + '…' : item.name;
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(6);
                doc.setTextColor(...MUTED);
                doc.text(`  ${qty} ${name}`, M, y);
                // FIN-024-pattern: mulR en vez de raw multiplication.
                doc.text(fmtUsd(mulR(item.priceUsd, item.qty)), RIGHT, y, { align: 'right' });
                y += 3.5;
            });

            // Show discount line if applied
            if (s.discountAmountUsd && s.discountAmountUsd > 0) {
                doc.setFont('helvetica', 'italic');
                doc.setFontSize(6);
                doc.setTextColor(...RED);
                doc.text(`  Descuento aplicado`, M, y);
                doc.text(`-${fmtUsd(s.discountAmountUsd)}`, RIGHT, y, { align: 'right' });
                y += 3.5;
            }
        }

        // Método de pago detallado
        if (!isCanceled && s.payments && s.payments.length > 0) {
            s.payments.forEach(p => {
                const label = toTitleCase(p.methodLabel || getPaymentLabel(p.methodId) || 'Pago');
                const val = p.currency === 'USD'
                    ? fmtUsd(p.amountUsd !== undefined ? p.amountUsd : p.amount)
                    : `Bs ${formatBs(p.amountBs !== undefined ? p.amountBs : p.amount)}`;
                doc.setFontSize(6);
                doc.setTextColor(...MUTED);
                doc.text(`  Recibido: ${label} (${val})`, M, y);
                y += 3.5;
            });
        } else if (!isCanceled && s.paymentMethod) {
            // Legacy fallback
            doc.setFontSize(6);
            doc.setTextColor(...MUTED);
            doc.text(`  Pago: ${getPaymentLabel(s.paymentMethod)}`, M, y);
            y += 3.5;
        }

        // Vuelto detallado (si aplica)
        if (!isCanceled && ((s.changeUsd && s.changeUsd > 0) || (s.changeBs && s.changeBs > 0))) {
            doc.setFontSize(6);
            doc.setTextColor(...MUTED); 
            
            let changeText = '  Vuelto Entregado: ';
            if (s.changeUsd > 0) changeText += fmtUsd(s.changeUsd);
            if (s.changeBs > 0 && s.changeUsd > 0) changeText += ` + `;
            if (s.changeBs > 0) changeText += `Bs ${formatBs(s.changeBs)}`;
            
            doc.text(changeText, M, y);
            y += 3.5;
        }

        // Referencia final Bs
        if (!isCanceled) {
            doc.setFontSize(6);
            doc.setTextColor(...MUTED);
            doc.text(`Ref Venta: Bs ${formatBs(s.totalBs || 0)}`, RIGHT, y, { align: 'right' });
            y += 3.5;
        }

        y += 3;
    });

    y += 2;
    dash(y); y += 6;

    // ════════════════════════════════════
    //  PIE
    // ════════════════════════════════════
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    doc.text('Precios Al Día', CX, y, { align: 'center' });
    y += 4;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(6);
    doc.setTextColor(...MUTED);
    doc.text('Reporte generado automáticamente · Sin valor fiscal', CX, y, { align: 'center' });

    // ── ACCIÓN DE SALIDA (IMPRIMIR / DESCARGAR / COMPARTIR) ──
    const getLocalISODate = (d = new Date()) => {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    };
    const dateStr = getLocalISODate(now);
    const filename = `cierre_${dateStr}.pdf`;

    if (action === 'print') {
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:80mm;height:auto;';
        document.body.appendChild(iframe);
        const blob = doc.output('blob');
        const blobUrl = URL.createObjectURL(blob);
        iframe.src = blobUrl;
        iframe.onload = () => {
            setTimeout(() => {
                iframe.contentWindow.print();
                setTimeout(() => {
                    document.body.removeChild(iframe);
                    URL.revokeObjectURL(blobUrl);
                }, 2000);
            }, 300);
        };
    } else if (action === 'download') {
        doc.save(filename);
    } else {
        // default: share via native API or fallback to download
        const blob = doc.output('blob');
        const file = new File([blob], filename, { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            navigator.share({ title: `Cierre del Día ${dateStr}`, files: [file] })
                .catch(() => doc.save(filename));
        } else {
            doc.save(filename);
        }
    }
}
