import { describe, it, expect } from 'vitest';
import { jsPDF } from 'jspdf';
import { buildCloseDaySummary } from '../src/utils/closeDaySummary.js';

const RATE = 849.56;

const fiada = (over = {}) => ({
    id: 'v-fiada',
    tipo: 'VENTA_FIADA',
    totalUsd: 20,
    totalBs: 16991.2,
    fiadoUsd: 20,
    rate: RATE,
    customerName: 'juan perez',
    status: 'COMPLETADA',
    ...over,
});

const cashea = (over = {}) => ({
    id: 'v-cashea',
    tipo: 'VENTA_CASHEA',
    totalUsd: 30,
    totalBs: 25486.8,
    casheaUsd: 21,
    rate: RATE,
    customerName: 'luis',
    status: 'COMPLETADA',
    ...over,
});

const contado = (over = {}) => ({
    id: 'v-contado',
    tipo: 'VENTA',
    totalUsd: 5,
    totalBs: 4247.8,
    rate: RATE,
    status: 'COMPLETADA',
    ...over,
});

const abono = (over = {}) => ({
    id: 'abono',
    tipo: 'COBRO_DEUDA',
    totalUsd: 8,
    totalBs: 6796.48,
    rate: RATE,
    customerName: 'juan perez',
    status: 'COMPLETADA',
    ...over,
});

/** Día del caso faro: $20 fiado + $30 Cashea + $5 contado, $23 cobrados. */
const diaCompleto = [
    fiada(),
    cashea(),
    contado(),
    abono(),
    abono({ id: 'abono-excedente', totalUsd: 15, totalBs: 12743.4, saldoFavorGeneradoUsd: 5 }),
];

const DIA = {
    allSales: diaCompleto,
    bcvRate: RATE,
    todayTotalUsd: 55,
    todayTotalBs: 46725.8,
    todayProfit: 17000,
    carteraUsd: 53.19,
};

const rowOf = (summary, key) => summary.rows.find(r => r.key === key);

describe('buildCloseDaySummary — resumen del día del cierre', () => {
    it('G1: separa las ventas netas en cobrado y crédito, y cierra la invariante', () => {
        const s = buildCloseDaySummary(DIA);

        expect(s.ventasNetasUsd).toBe(55);
        expect(s.ventasNetasBs).toBe(46725.8);
        expect(s.creditosUsd).toBe(41); // fiado 20 + Cashea 21
        expect(s.cobradoUsd).toBe(14);  // 55 − 41
        expect(s.cobradoBs).toBe(11893.84);

        expect(s.invariante.ok).toBe(true);
        expect(s.invariante.diff).toBe(0);
        expect(s.cobradoUsd + s.creditosUsd).toBe(s.ventasNetasUsd);
    });

    it('G2: el crédito se pesa en Bs a la tasa de cada venta, no a la del cierre', () => {
        // La venta fiada se hizo a 800; el cierre es a 849,56. Debe pesar 800.
        const s = buildCloseDaySummary({
            ...DIA,
            allSales: [fiada({ rate: 800, totalBs: 16000 }), cashea({ rate: 800, totalBs: 24000, casheaUsd: 21 })],
            todayTotalUsd: 50,
            todayTotalBs: 40000,
        });

        expect(s.creditosBs).toBe(32800); // (20 + 21) × 800
        expect(rowOf(s, 'fiado').bs).toBe(16000);
        expect(rowOf(s, 'cashea').bs).toBe(16800);
    });

    it('G3: las ventas anuladas no cuentan ni como venta ni como crédito', () => {
        const s = buildCloseDaySummary({
            ...DIA,
            todayTotalUsd: 0, // fuerza a derivar las ventas de las transacciones
            todayTotalBs: 0,
            allSales: [
                fiada(),
                fiada({ id: 'anulada', status: 'ANULADA', totalUsd: 8, totalBs: 6796.48, fiadoUsd: 8 }),
                contado(),
            ],
        });

        expect(s.ventasNetasUsd).toBe(25); // 20 fiado + 5 contado
        expect(s.creditosUsd).toBe(20);
        expect(s.cobradoUsd).toBe(5);
    });

    it('G4: las cobranzas previas entran aparte y no inflan las ventas netas', () => {
        const s = buildCloseDaySummary(DIA);

        expect(s.cobranzasUsd).toBe(23); // 8 + 15
        expect(s.cobranzasBs).toBe(19539.88);
        expect(s.ventasNetasUsd).toBe(55); // el abono no es venta
        expect(rowOf(s, 'cobranzas').hint).toContain('no es venta de hoy');
    });

    it('G5: el saldo a favor generado se muestra como no ingreso', () => {
        const s = buildCloseDaySummary(DIA);
        const row = rowOf(s, 'saldo_favor');

        expect(s.saldoFavorGeneradoUsd).toBe(5);
        expect(row.usd).toBe(5);
        expect(row.tone).toBe('muted');
        expect(row.hint).toContain('No es ingreso');
    });

    it('G6: la ganancia se expone devengada en Bs y convertida por la tasa BCV', () => {
        const s = buildCloseDaySummary(DIA);

        expect(s.gananciaBs).toBe(17000);
        expect(s.gananciaUsd).toBe(20.01); // 17.000 / 849,56
        expect(rowOf(s, 'ganancia').label).toContain('devengada');
        expect(rowOf(s, 'ganancia').hint).toContain('a crédito');
    });

    it('G7: sin tasa no se inventa la conversión de la ganancia', () => {
        const s = buildCloseDaySummary({ ...DIA, bcvRate: 0 });
        expect(s.gananciaBs).toBe(17000);
        expect(s.gananciaUsd).toBe(0);
    });

    it('G8: la cartera al cierre solo aparece si se conoce', () => {
        expect(rowOf(buildCloseDaySummary({ ...DIA, carteraUsd: null }), 'cartera')).toBeUndefined();
        expect(rowOf(buildCloseDaySummary(DIA), 'cartera').usd).toBe(53.19);
    });

    it('G9: un día sin movimientos no produce bloque', () => {
        const s = buildCloseDaySummary({ allSales: [], todayTotalUsd: 0, todayTotalBs: 0, todayProfit: 0 });
        expect(s.hasMovement).toBe(false);
        expect(s.creditosUsd).toBe(0);
        expect(s.cobranzasUsd).toBe(0);
    });

    it('G10: los montos quedan redondeados a 2 decimales y sin deriva de punto flotante', () => {
        const s = buildCloseDaySummary({
            ...DIA,
            allSales: [
                fiada({ totalUsd: 10.1, totalBs: 8580.5, fiadoUsd: 10.1, rate: 849.555 }),
                abono({ totalUsd: 3.03, totalBs: 2574.15, rate: 849.555 }),
            ],
            todayTotalUsd: 10.1,
            todayTotalBs: 8580.5,
            todayProfit: 1234.567,
            carteraUsd: null,
        });

        s.rows.forEach(row => {
            expect(Number.isInteger(Math.round(row.usd * 100)), row.key).toBe(true);
            expect(Math.abs(row.usd * 100 - Math.round(row.usd * 100))).toBeLessThan(1e-9);
        });
        expect(s.ventasNetasUsd).toBe(10.1);
        expect(s.cobradoUsd).toBe(0); // 10,10 − 10,10 fiado
        expect(s.gananciaBs).toBe(1234.57);
    });

    it('G11: cada fila tiene etiqueta corta para el ticket de 58 mm', () => {
        const s = buildCloseDaySummary(DIA);
        s.rows.forEach(row => {
            expect(row.short, row.key).toBeTruthy();
            expect(row.short.length, row.key).toBeLessThanOrEqual(22);
        });
    });

    it('G13: las filas del PDF carta caben en su columna sin invadir las cifras', () => {
        const s = buildCloseDaySummary(DIA);
        const doc = new jsPDF('p', 'mm', 'letter');
        const M = 15;
        const COL_W = 90; // ancho de columna del bloque de resumen en el PDF carta
        const money = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        // Los dos encabezados de columna deben caber en el ancho de la tarjeta.
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(7.5);
        s.columns.forEach(col => {
            expect(doc.getTextWidth(col.title.toUpperCase()), col.title).toBeLessThan(COL_W - 6);
        });

        s.columns.forEach((col, colIdx) => {
            const x = colIdx === 0 ? M : M + COL_W + 5.9;
            col.rows.forEach(row => {
                const indent = x + 3 + (row.level > 0 ? 3 : 0);

                doc.setFont('helvetica', row.level > 0 ? 'normal' : 'bold');
                doc.setFontSize(7);
                const labelW = doc.getTextWidth(row.label);
                const usdW = doc.getTextWidth(`$${money.format(Math.abs(row.usd))}`);

                doc.setFont('helvetica', 'normal');
                doc.setFontSize(5.8);
                const bsW = row.bs ? doc.getTextWidth(`Bs ${money.format(Math.abs(row.bs))}`) : 0;

                // USD pegado al borde derecho de la tarjeta, su Bs a la izquierda.
                const cifrasLeft = x + COL_W - 5 - usdW - (bsW ? bsW : 0);
                expect(indent + labelW + 2, row.key).toBeLessThanOrEqual(cifrasLeft);
            });
        });
    });

    it('G14: las columnas del PDF carta reparten las filas sin perder ninguna', () => {
        const s = buildCloseDaySummary(DIA);
        const enColumnas = s.columns.flatMap(c => c.rows.map(r => r.key));
        expect(enColumnas.sort()).toEqual(s.rows.map(r => r.key).sort());
        expect(s.columns[0].rows.map(r => r.key)).toEqual(['ventas_netas', 'cobrado', 'a_credito']);
    });

    it('G12: la etiqueta corta y su valor caben en el ancho útil del ticket', () => {
        const s = buildCloseDaySummary(DIA);
        const doc = new jsPDF('p', 'mm', [58, 400]);
        const M = 4;
        const RIGHT = 44.5; // valor de 58 mm en dailyCloseGenerator
        const VALUE_RIGHT = RIGHT;
        const money = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

        s.rows.forEach(row => {
            const indent = M + (row.level > 0 ? 2.5 : 0);
            doc.setFont('helvetica', row.level > 0 ? 'normal' : 'bold');
            doc.setFontSize(row.level > 0 ? 5.8 : 6.2);
            const labelW = doc.getTextWidth(row.short);
            doc.setFont('helvetica', 'bold');
            const valueW = doc.getTextWidth(`$${money.format(Math.abs(row.usd))}`);
            // 1,5 mm de separación mínima entre etiqueta y cifra.
            expect(indent + labelW + 1.5 + valueW, row.key).toBeLessThanOrEqual(VALUE_RIGHT);
        });
    });
});

// F6 (PLAN-FIXEO-CLIENTES-BILLETERA): fiado cubierto con saldo a favor.
describe('buildCloseDaySummary — fiado cubierto con saldo a favor (F6)', () => {
    const DIA_F6 = {
        ...DIA,
        allSales: [...diaCompleto.filter(s => s.id !== 'v-fiada'), fiada({ walletSnapshot: { favorAntes: 12.5, deudaAntes: 0 } })],
    };

    it('bajo «Fiado a clientes» sale «De eso, cubierto con saldo a favor» a la tasa de la venta', () => {
        const s = buildCloseDaySummary(DIA_F6);
        expect(rowOf(s, 'fiado').usd).toBe(20);
        expect(rowOf(s, 'fiado_cubierto')).toMatchObject({ usd: 12.5, bs: 10619.5, level: 1 });
        const derecha = s.columns[1].rows.map(r => r.key);
        expect(derecha.indexOf('fiado_cubierto')).toBe(derecha.indexOf('fiado') + 1);
    });

    it('la fila cabe en la columna del PDF carta y en el ticket de 58 mm', () => {
        const row = rowOf(buildCloseDaySummary(DIA_F6), 'fiado_cubierto');
        const money = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        expect(row.short.length).toBeLessThanOrEqual(22);
        const carta = new jsPDF('p', 'mm', 'letter');
        carta.setFont('helvetica', 'normal');
        carta.setFontSize(7);
        const labelW = carta.getTextWidth(row.label);
        const usdW = carta.getTextWidth(`$${money.format(row.usd)}`);
        carta.setFontSize(5.8);
        const bsW = carta.getTextWidth(`Bs ${money.format(row.bs)}`);
        const x = 15 + 90 + 5.9; // columna derecha
        expect(x + 3 + 3 + labelW + 2).toBeLessThanOrEqual(x + 90 - 5 - usdW - bsW);
        const ticket = new jsPDF('p', 'mm', [58, 400]);
        ticket.setFont('helvetica', 'normal');
        ticket.setFontSize(5.8);
        const shortW = ticket.getTextWidth(row.short);
        ticket.setFont('helvetica', 'bold');
        expect(4 + 2.5 + shortW + 1.5 + ticket.getTextWidth(`$${money.format(row.usd)}`)).toBeLessThanOrEqual(44.5);
    });
});

// F4 (PLAN-FIXEO-CLIENTES-BILLETERA): lo pagado con saldo a favor es parte de
// «Cobrado», pero no entró hoy a la caja. El resumen lo separa.
describe('buildCloseDaySummary — pagado con saldo a favor (F4)', () => {
    const conFavor = contado({
        id: 'v-favor', totalUsd: 6, totalBs: 5097.36,
        payments: [
            { methodId: 'saldo_favor', currency: 'USD', amountUsd: 4, amountBs: 3398.24, isSaldoFavor: true },
            { methodId: 'efectivo_usd', currency: 'USD', amountUsd: 2, amountBs: 1699.12 },
        ],
    });
    const anuladaConFavor = contado({
        id: 'v-favor-anulada', status: 'ANULADA',
        payments: [{ methodId: 'saldo_favor', currency: 'USD', amountUsd: 5, amountBs: 4247.8 }],
    });
    const DIA_FAVOR = { ...DIA, allSales: [...diaCompleto, conFavor, anuladaConFavor], todayTotalUsd: 61, todayTotalBs: 51823.16 };

    it('agrega «De eso, pagado con saldo a favor» y «Entró hoy a caja y bancos» bajo Cobrado', () => {
        const s = buildCloseDaySummary(DIA_FAVOR);
        expect(s.saldoFavorUsadoUsd).toBe(4); // la anulada no cuenta
        expect(rowOf(s, 'cobrado').usd).toBe(20); // 61 − 41 de créditos (20 fiado + 21 Cashea)
        expect(rowOf(s, 'cobrado_saldo_favor')).toMatchObject({ usd: 4, bs: 3398.24, level: 1 });
        expect(rowOf(s, 'cobrado_caja').usd).toBe(16);
        expect(rowOf(s, 'cobrado').hint).toContain('no entró hoy a la caja');
        expect(s.columns[0].rows.map(r => r.key)).toEqual(['ventas_netas', 'cobrado', 'cobrado_saldo_favor', 'cobrado_caja', 'a_credito']);
        expect(s.invariante.ok).toBe(true);
    });

    it('sin pagos con saldo a favor no aparecen las filas nuevas', () => {
        const s = buildCloseDaySummary(DIA);
        expect(s.saldoFavorUsadoUsd).toBe(0);
        expect(rowOf(s, 'cobrado_saldo_favor')).toBeUndefined();
        expect(rowOf(s, 'cobrado_caja')).toBeUndefined();
        expect(rowOf(s, 'cobrado').hint).toContain('puede estar en la caja');
    });

    it('las filas nuevas caben en la columna del PDF carta y en el ticket de 58 mm', () => {
        const s = buildCloseDaySummary(DIA_FAVOR);
        const money = new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        const carta = new jsPDF('p', 'mm', 'letter');
        const ticket = new jsPDF('p', 'mm', [58, 400]);
        ['cobrado_saldo_favor', 'cobrado_caja'].forEach(key => {
            const row = rowOf(s, key);
            expect(row.short.length, key).toBeLessThanOrEqual(22);
            // PDF carta: columna de 90 mm (misma medida que G13).
            carta.setFont('helvetica', 'normal');
            carta.setFontSize(7);
            const labelW = carta.getTextWidth(row.label);
            const usdW = carta.getTextWidth(`$${money.format(Math.abs(row.usd))}`);
            carta.setFontSize(5.8);
            const bsW = row.bs ? carta.getTextWidth(`Bs ${money.format(Math.abs(row.bs))}`) : 0;
            expect(15 + 3 + 3 + labelW + 2, key).toBeLessThanOrEqual(15 + 90 - 5 - usdW - bsW);
            // Ticket de 58 mm (misma medida que G12).
            ticket.setFont('helvetica', 'normal');
            ticket.setFontSize(5.8);
            const shortW = ticket.getTextWidth(row.short);
            ticket.setFont('helvetica', 'bold');
            const valueW = ticket.getTextWidth(`$${money.format(Math.abs(row.usd))}`);
            expect(4 + 2.5 + shortW + 1.5 + valueW, key).toBeLessThanOrEqual(44.5);
        });
    });
});
