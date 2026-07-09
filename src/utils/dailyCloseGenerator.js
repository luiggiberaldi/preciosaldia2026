import { jsPDF } from 'jspdf';
import { formatBs, formatCop, formatUsd } from './calculatorUtils';
import { getPaymentLabel, toTitleCase } from '../config/paymentMethods';
import { round2, mulR, divR } from './dinero';

/**
 * Genera un PDF de Cierre del Día con reporte detallado.
 * 
 * - Si action === 'download': Genera un reporte detallado en tamaño CARTA (Letter) con diseño premium.
 * - Si action === 'print' | 'share': Genera un ticket térmico de RESUMEN continuo en 58mm o 80mm
 *   (dependiendo del ancho de papel guardado en la configuración).
 */
export async function generateDailyClosePDF({
    sales = [],           // Ventas del día (netas, sin anuladas)
    allSales = [],        // Todas las transacciones del día (incluye anuladas)
    bcvRate = 0,
    paymentBreakdown = {},
    topProducts = [],
    todayTotalUsd = 0,
    todayTotalBs = 0,
    todayProfit = 0,
    todayItemsSold = 0,
    reconData = null, // Datos del cuadre físico
    apertura = null,  // Registro de apertura de caja
    copEnabled: copEnabledParam,
    tasaCop: tasaCopParam,
    action = 'share', // 'share' | 'print' | 'download'
}) {
    const now = new Date();
    const usdLabel = '$';
    const fmtUsd = (v) => `$${formatUsd(v)}`;

    // Detección de configuración de COP
    let isCop = false;
    let tasaCop = 0;
    if (copEnabledParam != null) {
        isCop = !!copEnabledParam && (tasaCopParam != null ? tasaCopParam > 0 : false);
        tasaCop = tasaCopParam != null ? tasaCopParam : 0;
    } else {
        const copFlag = localStorage.getItem('cop_enabled');
        const tasaCopRaw = localStorage.getItem('tasa_cop') || '0';
        const tasaCopParsed = Number(tasaCopRaw) || 0;
        isCop = copFlag === 'true' && tasaCopParsed > 0;
        tasaCop = tasaCopParsed;
    }

    // Colores del tema de impresión premium
    const INK = [33, 37, 41];
    const BODY = [73, 80, 87];
    const MUTED = [134, 142, 150];
    const GREEN = [16, 124, 65];
    const RED = [220, 53, 69];
    const BLUE = [1, 105, 111]; // Tono brand "Precios Al Día"
    const RULE = [222, 226, 230];
    const BG_CARD = [248, 249, 250];
    const BORDER_CARD = [233, 236, 239];

    // Precargar la imagen del logo en base64 o local
    let imgLogo = null;
    try {
        const img = new Image();
        img.src = './logo.png';
        await new Promise((res, rej) => { img.onload = res; img.onerror = rej; });
        imgLogo = img;
    } catch (_) {}

    // =========================================================================
    //  OPCIÓN A: DESCARGAR PDF (TAMAÑO CARTA DETALLADO PREMIUM)
    // =========================================================================
    if (action === 'download') {
        const doc = new jsPDF('p', 'mm', 'letter');
        const WIDTH = 215.9;
        const HEIGHT = 279.4;
        const M = 15;
        const RIGHT = WIDTH - M;
        let y = 15;
        let pageNum = 1;

        // Helper para agregar footer elegante en cada página
        const addFooter = (pNum) => {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(8);
            doc.setTextColor(...MUTED);
            doc.text(`Precios Al Día Bodega · Reporte de Cierre de Caja · Página ${pNum}`, WIDTH / 2, HEIGHT - 10, { align: 'center' });
        };

        // Helper para controlar saltos de página
        const checkPageBreak = (neededHeight) => {
            if (y + neededHeight > HEIGHT - 20) {
                addFooter(pageNum);
                doc.addPage();
                pageNum++;
                y = 20;
                drawHeader();
            }
        };

        // Helper para dibujar la cabecera corporativa limpia en cada página
        const drawHeader = () => {
            // Fondo de cabecera limpio
            doc.setFillColor(255, 255, 255);
            doc.rect(M, y, RIGHT - M, 24, 'F');

            // Logo
            if (imgLogo) {
                const logoW = 38;
                const logoH = 9;
                doc.addImage(imgLogo, 'PNG', M, y + 4, logoW, logoH);
            } else {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(14);
                doc.setTextColor(...BLUE);
                doc.text('Precios Al Día', M, y + 9);
            }

            // Título y Subtítulo
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(14);
            doc.setTextColor(...BLUE);
            doc.text('PRECIOS AL DÍA BODEGA', M + 45, y + 8);

            doc.setFontSize(8.5);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...BODY);
            doc.text('REPORTE DETALLADO DE CIERRE DE CAJA', M + 45, y + 13);

            // Metadatos
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(7.5);
            doc.setTextColor(...INK);
            doc.text(`CIERRE: #${now.toLocaleDateString('es-VE').replace(/\//g, '')}`, RIGHT, y + 7, { align: 'right' });
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...MUTED);
            doc.text(`Fecha: ${now.toLocaleDateString('es-VE')}`, RIGHT, y + 12, { align: 'right' });
            doc.text(`Generado: ${now.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' })}`, RIGHT, y + 16, { align: 'right' });

            // Línea divisoria decorativa
            y += 20;
            doc.setDrawColor(...BLUE);
            doc.setLineWidth(0.6);
            doc.line(M, y, RIGHT, y);
            y += 6;
        };

        // Dibujar cabecera inicial
        drawHeader();

        // Helper para dibujar cards Bento
        const drawCard = (x, yy, w, h, title) => {
            doc.setFillColor(...BG_CARD);
            doc.rect(x, yy, w, h, 'F');
            
            doc.setDrawColor(...BORDER_CARD);
            doc.setLineWidth(0.25);
            doc.rect(x, yy, w, h, 'S');
            
            doc.setFillColor(...BLUE);
            doc.rect(x, yy, w, 1.2, 'F');

            doc.setFont('helvetica', 'bold');
            doc.setFontSize(8);
            doc.setTextColor(...BLUE);
            doc.text(title.toUpperCase(), x + 4, yy + 5);

            return yy + 8.5;
        };

        // 1. & 2. COLUMNA IZQUIERDA Y DERECHA (Bento Layout)
        checkPageBreak(85);

        const colW = 90;
        const colGap = 5.9;
        const colR_X = M + colW + colGap;

        // --- COLUMNA IZQUIERDA ---
        let leftY = y;
        
        // Tarjeta Apertura
        const aptRows = [
            ['Operador / Cajero', apertura?.sellerName || 'Administrador'],
            ['Fondo Inicial USD', fmtUsd(apertura?.openingUsd || 0)],
            ['Fondo Inicial Bs', `Bs ${formatBs(apertura?.openingBs || 0)}`],
        ];
        if (isCop && tasaCop > 0) {
            aptRows.push(['Fondo Inicial COP', `${formatCop(apertura?.openingCop || 0)} COP`]);
        }
        aptRows.push(['Tasa de Cambio BCV', `Bs ${formatBs(bcvRate)}`]);
        if (isCop && tasaCop > 0) {
            aptRows.push(['Tasa de Cambio COP', `${tasaCop.toLocaleString('es-CO')} COP`]);
        }

        const aptH = 10 + (aptRows.length * 4.5);
        let contentY = drawCard(M, leftY, colW, aptH, 'Apertura y Tasas');
        aptRows.forEach(([lbl, val]) => {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(...BODY);
            doc.text(lbl, M + 4, contentY);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...INK);
            doc.text(val, M + colW - 4, contentY, { align: 'right' });
            contentY += 4.5;
        });

        leftY += aptH + 4;

        // Tarjeta Resumen Operaciones
        const opsRows = [
            ['Operaciones Realizadas', `${sales.length} ventas`],
            ['Artículos Vendidos', `${todayItemsSold} unidades`],
            ['Ingresos Brutos USD', fmtUsd(todayTotalUsd)],
            ['Ingresos Brutos Bs', `Bs ${formatBs(todayTotalBs)}`],
        ];
        if (isCop && tasaCop > 0) {
            opsRows.push(['Ingresos Brutos COP', `${formatCop(mulR(todayTotalUsd, tasaCop))} COP`]);
        }
        opsRows.push(['Ganancia Estimada USD', fmtUsd(bcvRate > 0 ? divR(todayProfit, bcvRate) : 0)]);
        opsRows.push(['Ganancia Estimada Bs', `Bs ${formatBs(todayProfit)}`]);

        const opsH = 10 + (opsRows.length * 4.5);
        contentY = drawCard(M, leftY, colW, opsH, 'Resumen de Operaciones');
        opsRows.forEach(([lbl, val]) => {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(7.5);
            doc.setTextColor(...BODY);
            doc.text(lbl, M + 4, contentY);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...INK);
            doc.text(val, M + colW - 4, contentY, { align: 'right' });
            contentY += 4.5;
        });

        leftY += opsH;

        // --- COLUMNA DERECHA ---
        let rightY = y;

        // Tarjeta Cuadre Físico (si existe)
        if (reconData) {
            const reRows = [
                ['Efectivo Declarado USD', fmtUsd(reconData.declaredUsd), 'USD'],
                ['Efectivo Declarado Bs', `Bs ${formatBs(reconData.declaredBs)}`, 'Bs'],
                ['Diferencia USD', fmtUsd(reconData.diffUsd), 'diffUSD'],
                ['Diferencia Bs', `Bs ${formatBs(reconData.diffBs)}`, 'diffBs']
            ];
            if (reconData.declaredCop != null && (reconData.declaredCop > 0 || reconData.diffCop !== 0)) {
                reRows.push(['Efectivo Declarado COP', `${parseInt(round2(reconData.declaredCop), 10).toLocaleString('es-CO')} COP`, 'COP']);
                reRows.push(['Diferencia COP', `${parseInt(round2(reconData.diffCop), 10).toLocaleString('es-CO')} COP`, 'diffCop']);
            }

            const reH = 10 + (reRows.length * 4.5);
            contentY = drawCard(colR_X, rightY, colW, reH, 'Cuadre de Caja Física');
            reRows.forEach(([lbl, val, key]) => {
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7.5);
                doc.setTextColor(...BODY);
                doc.text(lbl, colR_X + 4, contentY);

                doc.setFont('helvetica', 'bold');
                if (key.startsWith('diff')) {
                    const diffVal = key === 'diffUSD' ? reconData.diffUsd : key === 'diffBs' ? reconData.diffBs : reconData.diffCop;
                    const threshold = key === 'diffUSD' ? 0.05 : key === 'diffBs' ? 1 : 100;
                    if (Math.abs(diffVal) <= threshold) doc.setTextColor(...MUTED);
                    else if (diffVal < 0) doc.setTextColor(...RED);
                    else doc.setTextColor(...GREEN);
                } else {
                    doc.setTextColor(...INK);
                }
                doc.text(val, colR_X + colW - 4, contentY, { align: 'right' });
                contentY += 4.5;
            });

            rightY += reH + 4;
        }

        // Tarjeta Pagos por Método
        const paymentEntries = Object.entries(paymentBreakdown);
        if (paymentEntries.length > 0) {
            const payH = 10 + (paymentEntries.length * 4.5);
            contentY = drawCard(colR_X, rightY, colW, payH, 'Ingresos por Método');
            paymentEntries.forEach(([methodId, data]) => {
                const label = toTitleCase(getPaymentLabel(methodId, data.label));
                const val = data.currency === 'USD'
                    ? fmtUsd(data.total)
                    : data.currency === 'COP'
                    ? `${data.total.toLocaleString('es-CO')} COP`
                    : `Bs ${formatBs(data.total)}`;

                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7.5);
                doc.setTextColor(...BODY);
                doc.text(label, colR_X + 4, contentY);
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...INK);
                doc.text(val, colR_X + colW - 4, contentY, { align: 'right' });
                contentY += 4.5;
            });
            rightY += payH;
        }

        // Sincronizar Y
        y = Math.max(leftY, rightY) + 6;

        // 3. Productos Más Vendidos
        if (topProducts.length > 0) {
            checkPageBreak(25 + topProducts.length * 6);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9.5);
            doc.setTextColor(...BLUE);
            doc.text('PRODUCTOS MÁS VENDIDOS DEL DÍA', M, y);
            y += 4.5;

            doc.setFillColor(248, 249, 250);
            doc.rect(M, y, RIGHT - M, 10 + topProducts.length * 5.5, 'F');
            doc.setDrawColor(...BORDER_CARD);
            doc.setLineWidth(0.25);
            doc.rect(M, y, RIGHT - M, 10 + topProducts.length * 5.5, 'S');

            let topY = y + 6;
            topProducts.forEach((p, idx) => {
                doc.setFont('helvetica', 'bold');
                doc.setFontSize(7.5);
                doc.setTextColor(...INK);
                doc.text(`${idx + 1}.`, M + 6, topY);
                
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(...BODY);
                doc.text(p.name, M + 14, topY);
                
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(...INK);
                const revenueStr = `${p.qty} u/kg  ·  Total: ${fmtUsd(p.revenue)} · (Bs ${formatBs(mulR(p.revenue, bcvRate))})`;
                doc.text(revenueStr, RIGHT - 6, topY, { align: 'right' });
                
                topY += 5.5;
            });

            y += 10 + topProducts.length * 5.5 + 6;
        }

        // 4. Detalle de Ventas (Tabla Impecable)
        if (allSales.length > 0) {
            checkPageBreak(35);
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(9.5);
            doc.setTextColor(...BLUE);
            doc.text('DETALLE INDIVIDUAL DE TRANSACCIONES', M, y);
            y += 5;

            // Dibujar cabecera de la tabla
            const drawTableHeaders = (yy) => {
                doc.setFillColor(240, 244, 248);
                doc.rect(M, yy - 4, RIGHT - M, 6.5, 'F');
                doc.setDrawColor(...BORDER_CARD);
                doc.rect(M, yy - 4, RIGHT - M, 6.5, 'S');

                doc.setFont('helvetica', 'bold');
                doc.setFontSize(7.5);
                doc.setTextColor(...BLUE);
                doc.text('Hora', M + 4, yy + 0.2);
                doc.text('Cliente / Estado', M + 18, yy + 0.2);
                doc.text('Artículos / Desglose de Pago', M + 68, yy + 0.2);
                doc.text('Total (USD / Bs)', RIGHT - 4, yy + 0.2, { align: 'right' });
            };

            drawTableHeaders(y);
            y += 5.5;

            allSales.forEach((s, idx) => {
                const isCanceled = s.status === 'ANULADA';
                const hora = new Date(s.timestamp).toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' });
                const cliente = s.customerName || 'Consumidor Final';

                // Items
                let itemsText = '';
                if (s.items && s.items.length > 0) {
                    itemsText = s.items.map(item => {
                        const qty = item.isWeight ? `${formatUsd(item.qty)}kg` : `${item.qty}u`;
                        return `${qty} ${item.name} (${fmtUsd(item.priceUsd)})`;
                    }).join(', ');
                }

                // Pagos
                let paymentsText = '';
                if (s.payments && s.payments.length > 0) {
                    paymentsText = 'Pagos: ' + s.payments.map(p => {
                        const label = toTitleCase(p.methodLabel || getPaymentLabel(p.methodId) || 'Pago');
                        const val = p.currency === 'USD' ? fmtUsd(p.amountUsd) : `Bs ${formatBs(p.amountBs)}`;
                        return `${label} (${val})`;
                    }).join(' • ');
                }

                // Vuelto
                if (s.changeUsd > 0 || s.changeBs > 0) {
                    let changeStr = 'Vuelto: ';
                    if (s.changeUsd > 0) changeStr += fmtUsd(s.changeUsd);
                    if (s.changeBs > 0) changeStr += `${s.changeUsd > 0 ? ' + ' : ''}Bs ${formatBs(s.changeBs)}`;
                    paymentsText += ` | ${changeStr}`;
                }

                const fullDetail = `${itemsText}\n${paymentsText}`;
                const detailLines = doc.splitTextToSize(fullDetail, 105);
                const rowHeight = Math.max(12, detailLines.length * 4.2 + 4);

                checkPageBreak(rowHeight);

                // Alternar colores de fondo de fila (zebra stripe) para legibilidad extrema
                if (idx % 2 === 0) {
                    doc.setFillColor(252, 253, 254);
                    doc.rect(M, y - 4, RIGHT - M, rowHeight, 'F');
                }

                // Dibujar línea inferior sutil de fila
                doc.setDrawColor(...BORDER_CARD);
                doc.setLineWidth(0.15);
                doc.line(M, y - 4 + rowHeight, RIGHT, y - 4 + rowHeight);

                // Renderizar columnas
                doc.setFont('helvetica', 'normal');
                doc.setFontSize(7.5);
                doc.setTextColor(...BODY);
                
                doc.text(hora, M + 4, y);

                // Cliente
                if (isCanceled) {
                    doc.setTextColor(...RED);
                    doc.setFont('helvetica', 'bold');
                    doc.text(`${cliente}\n(ANULADA)`, M + 18, y);
                } else {
                    doc.setTextColor(...BODY);
                    doc.setFont('helvetica', 'normal');
                    doc.text(cliente, M + 18, y);
                }

                // Detalle
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(...MUTED);
                doc.text(detailLines, M + 68, y);

                // Total
                doc.setFont('helvetica', 'bold');
                if (isCanceled) {
                    doc.setTextColor(...RED);
                    doc.text('ANULADA', RIGHT - 4, y, { align: 'right' });
                } else {
                    doc.setTextColor(...GREEN);
                    doc.text(fmtUsd(s.totalUsd || 0), RIGHT - 4, y, { align: 'right' });
                    doc.setFont('helvetica', 'normal');
                    doc.setFontSize(6.5);
                    doc.setTextColor(...MUTED);
                    doc.text(`Bs ${formatBs(s.totalBs || 0)}`, RIGHT - 4, y + 3.5, { align: 'right' });
                }

                y += rowHeight;
            });
        }

        // Agregar footer final y descargar
        addFooter(pageNum);

        const dateStr = now.toISOString().slice(0, 10);
        doc.save(`cierre_detallado_${dateStr}.pdf`);
        return;
    }

    // =========================================================================
    //  OPCIÓN B: TICKET TÉRMICO DE RESUMEN (58 U 80 MM)
    // =========================================================================
    const paperWidthSetting = localStorage.getItem('printer_paper_width') || '58';
    const is80 = paperWidthSetting === '80';
    
    const WIDTH = is80 ? 80 : 58;
    const M = is80 ? 6 : 4;
    const RIGHT = is80 ? 74 : 44.5;
    const CX = WIDTH / 2;
    const HEADER_CX = is80 ? CX : (CX - 5.5);

    const fTitle = is80 ? 11 : 8.5;
    const fSection = is80 ? 7.5 : 7;
    const fBody = is80 ? 7 : 6.2;
    const fMuted = is80 ? 6.5 : 5.8;

    const paymentRows = Object.keys(paymentBreakdown || {}).length;
    const topProdRows = topProducts ? topProducts.length : 0;
    const H = 145
        + (paymentRows * 6.5)
        + (topProdRows * 9.5)
        + (apertura ? 24 : 0)
        + (reconData ? 32 : 0);

    const doc = new jsPDF('p', 'mm', [WIDTH, H]);
    let y = 6;

    const dash = (yy) => {
        doc.setDrawColor(...RULE);
        doc.setLineWidth(0.3);
        doc.setLineDashPattern([1, 1], 0);
        doc.line(M, yy, RIGHT, yy);
        doc.setLineDashPattern([], 0);
    };

    const sectionTitle = (text, yy) => {
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(fSection);
        doc.setTextColor(...BLUE);
        doc.text(text, M, yy);
        return yy + 5;
    };

    // Logo
    try {
        if (imgLogo) {
            const logoW = is80 ? 46 : 38;
            const logoH = is80 ? 11 : 9;
            doc.addImage(imgLogo, 'PNG', HEADER_CX - logoW / 2, y, logoW, logoH);
            y += logoH + 3;
        } else {
            y += 2;
        }
    } catch (_) { y += 2; }

    // Título principal
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fTitle);
    doc.setTextColor(...INK);
    doc.text('RESUMEN DE CIERRE', HEADER_CX, y, { align: 'center' });
    y += 5;

    // Fecha y hora
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fMuted);
    doc.setTextColor(...MUTED);
    doc.text(now.toLocaleDateString('es-VE', {
        weekday: 'short', day: '2-digit', month: 'short', year: 'numeric'
    }) + '  ' + now.toLocaleTimeString('es-VE', { hour: '2-digit', minute: '2-digit' }), HEADER_CX, y, { align: 'center' });
    y += 5;

    dash(y); y += 6;

    // Apertura
    if (apertura && (apertura.openingUsd > 0 || apertura.openingBs > 0 || apertura.openingCop > 0)) {
        y = sectionTitle('FONDO DE CAJA (APERTURA)', y);

        const aperturaRows = [];
        if (apertura.openingUsd > 0) aperturaRows.push(['Efectivo Inicial USD', fmtUsd(apertura.openingUsd)]);
        if (apertura.openingBs > 0) aperturaRows.push(['Efectivo Inicial Bs', `Bs ${formatBs(apertura.openingBs)}`]);
        if (apertura.openingCop > 0) aperturaRows.push(['Efectivo Inicial COP', `${formatCop(apertura.openingCop)} COP`]);
        if (apertura.sellerName) aperturaRows.push(['Cajero de Apertura', apertura.sellerName]);

        aperturaRows.forEach(([label, value]) => {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(fBody);
            doc.setTextColor(...BODY);
            doc.text(label, M, y);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...INK);
            doc.text(value, RIGHT, y, { align: 'right' });
            y += 5;
        });

        y += 1;
        dash(y); y += 6;
    }

    // Resumen de operaciones
    y = sectionTitle('RESUMEN DE OPERACIONES', y);

    const statsRows = [
        ['Operaciones realizadas', `${sales.length}`],
        ['Artículos vendidos', `${todayItemsSold}`],
        [`Ingresos brutos (${usdLabel})`, fmtUsd(todayTotalUsd)],
        ['Ingresos brutos (Bs)', `Bs ${formatBs(todayTotalBs)}`],
        [`Ganancia estimada (${usdLabel})`, fmtUsd(bcvRate > 0 ? divR(todayProfit, bcvRate) : 0)],
        ['Ganancia estimada (Bs)', `Bs ${formatBs(todayProfit)}`],
        ['Tasa oficial BCV', `Bs ${formatBs(bcvRate)}`],
    ];

    if (isCop && tasaCop > 0) {
        statsRows.push(['Tasa de Cambio COP', `${tasaCop.toLocaleString('es-CO')} / $1`]);
        statsRows.splice(3, 0, ['Ingresos brutos (COP)', `${formatCop(mulR(todayTotalUsd, tasaCop))} COP`]);
    }

    statsRows.forEach(([label, value]) => {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(fBody);
        doc.setTextColor(...BODY);
        doc.text(label, M, y);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(...INK);
        doc.text(value, RIGHT, y, { align: 'right' });
        y += 5;
    });

    y += 1;
    dash(y); y += 6;

    // Desglose por método de pago
    if (paymentRows > 0) {
        y = sectionTitle('INGRESOS POR MÉTODO', y);

        Object.entries(paymentBreakdown).forEach(([methodId, data]) => {
            const label = toTitleCase(getPaymentLabel(methodId, data.label));
            const val = data.currency === 'USD'
                ? fmtUsd(data.total)
                : data.currency === 'COP'
                ? `${data.total.toLocaleString('es-CO')} COP`
                : `Bs ${formatBs(data.total)}`;

            doc.setFont('helvetica', 'normal');
            doc.setFontSize(fBody);
            doc.setTextColor(...BODY);
            doc.text(label, M, y);
            doc.setFont('helvetica', 'bold');
            doc.setTextColor(...INK);
            doc.text(val, RIGHT, y, { align: 'right' });
            y += 5;
        });

        y += 1;
        dash(y); y += 6;
    }

    // Cuadre físico de caja
    if (reconData) {
        y = sectionTitle('CUADRE DE CAJA FISICA', y);

        const reconRows = [
            ['Declarado (USD)', fmtUsd(reconData.declaredUsd), 'USD'],
            ['Declarado (Bs)', `Bs ${formatBs(reconData.declaredBs)}`, 'Bs'],
            ['Diferencia USD', fmtUsd(reconData.diffUsd), 'diffUSD'],
            ['Diferencia Bs', `Bs ${formatBs(reconData.diffBs)}`, 'diffBs']
        ];

        if (reconData.declaredCop != null && (reconData.declaredCop > 0 || reconData.diffCop !== 0)) {
            reconRows.push(['Declarado (COP)', `${parseInt(round2(reconData.declaredCop), 10).toLocaleString('es-CO')} COP`, 'COP']);
            reconRows.push(['Diferencia COP', `${parseInt(round2(reconData.diffCop), 10).toLocaleString('es-CO')} COP`, 'diffCop']);
        }

        reconRows.forEach(([label, value, key]) => {
            doc.setFont('helvetica', 'normal');
            doc.setFontSize(fBody);
            doc.setTextColor(...BODY);
            doc.text(label, M, y);

            doc.setFont('helvetica', 'bold');
            if (key.startsWith('diff')) {
                const diffVal = key === 'diffUSD' ? reconData.diffUsd : key === 'diffBs' ? reconData.diffBs : reconData.diffCop;
                const threshold = key === 'diffUSD' ? 0.05 : key === 'diffBs' ? 1 : 100;
                if (Math.abs(diffVal) <= threshold) doc.setTextColor(...MUTED);
                else if (diffVal < 0) doc.setTextColor(...RED);
                else doc.setTextColor(...GREEN);
            } else {
                doc.setTextColor(...INK);
            }
            doc.text(value, RIGHT, y, { align: 'right' });
            y += 5;
        });

        y += 1;
        dash(y); y += 6;
    }

    // Top Productos
    if (topProdRows > 0) {
        y = sectionTitle('PRODUCTOS MÁS VENDIDOS', y);

        topProducts.forEach((p, i) => {
            const rank = `${i + 1}.`;
            const maxLen = is80 ? 22 : 12;
            const name = p.name.length > maxLen ? p.name.substring(0, maxLen) + '…' : p.name;
            doc.setFont('helvetica', 'bold');
            doc.setFontSize(fBody);
            doc.setTextColor(...INK);
            doc.text(rank, M, y);
            doc.setFont('helvetica', 'normal');
            doc.setTextColor(...BODY);
            doc.text(name, M + 4, y);
            y += 4;

            doc.setFontSize(fMuted);
            doc.setTextColor(...MUTED);
            doc.text(`${p.qty} vend. · ${fmtUsd(p.revenue)} · Bs ${formatBs(mulR(p.revenue, bcvRate))}`, M + 4, y);
            y += 5.5;
        });

        y += 1;
        dash(y); y += 6;
    }

    // Pie
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fBody + 1);
    doc.setTextColor(...INK);
    doc.text('Precios Al Día', HEADER_CX, y, { align: 'center' });
    y += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(fMuted);
    doc.setTextColor(...MUTED);
    doc.text('Reporte de Cierre de Caja · Sin valor fiscal', HEADER_CX, y, { align: 'center' });

    // Salida
    const dateStr = now.toISOString().slice(0, 10);
    const filename = `resumen_cierre_${dateStr}.pdf`;

    if (action === 'print') {
        const iframe = document.createElement('iframe');
        iframe.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:' + WIDTH + 'mm;height:auto;';
        document.body.appendChild(iframe);
        const blob = doc.output('blob');
        const blobUrl = URL.createObjectURL(blob);
        iframe.src = blobUrl;
        iframe.onload = () => {
            setTimeout(() => {
                iframe.contentWindow.print();
                // Aumentamos el tiempo de retención a 60 segundos para evitar que Chrome
                // destruya el iframe y el Blob URL mientras el usuario tiene el diálogo de impresión abierto.
                setTimeout(() => {
                    try {
                        document.body.removeChild(iframe);
                        URL.revokeObjectURL(blobUrl);
                    } catch (_) {}
                }, 60000);
            }, 300);
        };
    } else if (action === 'download') {
        doc.save(filename);
    } else {
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
