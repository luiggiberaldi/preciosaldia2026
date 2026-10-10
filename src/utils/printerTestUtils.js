/**
 * Genera y envía a imprimir un ticket de calibración para ticketeras térmicas.
 *
 * @module utils/printerTestUtils
 */
import { openPrintWindow, escapeHtml } from './printerUtils';
import { getPaperConfig } from './ticketConstants';

/**
 * Imprime un ticket de calibración con regla de caracteres y datos del sistema.
 *
 * @param {'58'|'80'} paperWidth - Ancho del rollo en milímetros.
 */
export function imprimirTicketPrueba(paperWidth = '58') {
    const config = getPaperConfig(paperWidth);
    const is80 = paperWidth === '80';

    const fechaHora = new Date().toLocaleString('es-VE', {
        dateStyle: 'short',
        timeStyle: 'medium',
    });

    // Regla de longitud calibrada por ancho
    const regla80 = '================================================';
    const regla58 = '================================';
    const regla    = is80 ? regla80 : regla58;
    const nums80   = '1234567890123456789012345678901234567890123456789';
    const nums58   = '123456789012345678901234567890123';
    const nums     = is80 ? nums80 : nums58;

    const html = `<!DOCTYPE html>
<html lang="es">
<head>
    <meta charset="utf-8">
    <title>Ticket de Prueba</title>
    <style>
        @page {
            size: ${config.cssPageSize};
            margin: 0;
        }
        * { box-sizing: border-box; }
        body {
            margin: 0;
            padding: 4mm;
            width: ${config.cssBodyWidth};
            font-family: 'Courier New', Courier, monospace;
            color: #000;
            background: #fff;
            font-size: ${config.fSmall};
            line-height: 1.3;
            -webkit-print-color-adjust: exact;
        }
        .c  { text-align: center; }
        .b  { font-weight: bold; }
        .hr { border: none; border-top: 1px dashed #000; margin: 2mm 0; }
        .title { font-size: ${config.fTitle}; }
        .badge {
            display: inline-block;
            border: 1px solid #000;
            padding: 1mm 3mm;
            font-size: ${config.fBase};
            margin: 2mm 0;
        }
        .tiny  { font-size: ${config.fTiny}; }
        .foot  { font-size: ${config.fTiny}; margin-top: 3mm; }
    </style>
</head>
<body>
    <div class="c">
        <div class="b title">PRECIOS AL DIA</div>
        <div class="b">SISTEMA POS &amp; BODEGA</div>
        <div class="badge b">TICKET DE PRUEBA</div>
        <div>${fechaHora}</div>
    </div>

    <hr class="hr">

    <div><b>ANCHO:</b> ${escapeHtml(paperWidth)} mm — ${is80 ? 'Rollo Ancho (80mm)' : 'Rollo Angosto (58mm)'}</div>
    <div><b>ESTADO:</b> CONEXION EXITOSA</div>
    <div><b>ALINEACION:</b> CORRECTA</div>

    <hr class="hr">

    <div class="c tiny">
        ${regla}<br>
        ${nums}<br>
        ${regla}
    </div>

    <hr class="hr">

    <div class="c b">
        Ticketera lista para emitir<br>tickets y recibos de venta!
    </div>

    <div class="c foot">
        *** PRECIOS AL DIA — LISTO ***<br><br>
        .<br>.<br>
    </div>
</body>
</html>`;

    openPrintWindow(html);
}
