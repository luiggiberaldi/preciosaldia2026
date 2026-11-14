// ============================================================
// FIA-CIERRE-001 — Resumen del día para el cierre de caja
// ------------------------------------------------------------
// Réplica del puente que faltaba entre «Ingresos brutos» (devengado) y
// «Efectivo esperado» (caja) en el PDF del cierre.
//
// El cierre ya imprimía el total del día y la ganancia, pero nada explicaba
// por qué la caja no coincide con ese total: las ventas fiadas y de Cashea
// suman al ingreso y no entran al cajón. Este núcleo produce las tres cifras
// que el operador necesita (ventas netas, créditos del día, ganancia) más el
// desglose que las concilia.
//
// Invariante que el módulo garantiza por construcción:
//   cobradoUsd + creditosUsd === ventasNetasUsd
//
// Núcleo puro: sin React, sin storage, sin acceso a localStorage.
// ============================================================

import { round2, sumR, mulR, divR, subR } from './dinero';
import { computeReceivablesMovements } from './receivablesReport';
import { getGeneratedWalletCredit } from './customerLedger';

const SALE_TYPES = new Set(['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA']);

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** Ventas netas derivadas de las transacciones (excluye anuladas y cobros). */
function salesFromTransactions(allSales = []) {
    const netas = (Array.isArray(allSales) ? allSales : []).filter(
        s => s && s.status !== 'ANULADA' && SALE_TYPES.has(s.tipo)
    );
    return {
        usd: round2(sumR(netas.map(s => Math.abs(num(s.totalUsd))))),
        bs: round2(sumR(netas.map(s => Math.abs(num(s.totalBs))))),
    };
}

const isInternalCreditPayment = (p) => p && (p.methodId === 'saldo_favor' || p.isInternalCredit === true || p.currency === 'INTERNAL_CREDIT');

/**
 * F4 (PLAN-FIXEO-CLIENTES-BILLETERA): lo pagado hoy con saldo a favor. Es parte
 * de «Cobrado» (la venta sí se cobró) pero ese dinero entró a la caja el día que
 * se generó el saldo (vuelto a billetera o sobrante de abono), no hoy.
 */
function internalCreditUsed(allSales = []) {
    let usd = 0;
    let bs = 0;
    (Array.isArray(allSales) ? allSales : []).forEach(sale => {
        if (!sale || sale.status === 'ANULADA' || !SALE_TYPES.has(sale.tipo)) return;
        (Array.isArray(sale.payments) ? sale.payments : []).filter(isInternalCreditPayment).forEach(p => {
            const pUsd = num(p.amountUsd);
            usd = sumR([usd, pUsd]);
            bs = sumR([bs, num(p.amountBs) || (num(sale.rate) > 0 ? mulR(pUsd, num(sale.rate)) : 0)]);
        });
    });
    return { usd: round2(usd), bs: round2(bs) };
}

/**
 * Resumen de cierre del día.
 *
 * @param {{
 *   allSales?: Array,        // transacciones del día (incluye anuladas)
 *   bcvRate?: number,
 *   todayTotalUsd?: number,  // ventas netas del día (devengado)
 *   todayTotalBs?: number,
 *   todayProfit?: number,    // ganancia estimada en Bs
 *   todayItemsSold?: number,
 *   carteraUsd?: number|null // deuda pendiente acumulada (stock), si se conoce
 * }} input
 */
export function buildCloseDaySummary({
    allSales = [],
    bcvRate = 0,
    todayTotalUsd = 0,
    todayTotalBs = 0,
    todayProfit = 0,
    carteraUsd = null,
} = {}) {
    const receivables = computeReceivablesMovements(allSales);
    // ERR-015: saldo a favor generado = vuelto enviado a la billetera + sobrante
    // de abonos (la misma regla del Inicio). Antes solo contaba los abonos.
    const saldoFavorGeneradoUsd = round2(sumR(
        (Array.isArray(allSales) ? allSales : []).map(s => getGeneratedWalletCredit(s))
    ));

    // Desglose del crédito otorgado por contraparte: cliente (fiado) vs
    // financiador (Cashea). Se toma de los movimientos, no del bucket del motor,
    // porque el motor descarta los buckets en 0 y no distingue el origen.
    const fiadoMovs = receivables.fiados.filter(f => f.tipo === 'VENTA_FIADA');
    const casheaMovs = receivables.fiados.filter(f => f.tipo === 'VENTA_CASHEA');
    const fiadoUsd = round2(sumR(fiadoMovs.map(f => f.montoUsd)));
    const casheaUsd = round2(sumR(casheaMovs.map(f => f.montoUsd)));
    const creditosUsd = round2(sumR([fiadoUsd, casheaUsd]));
    // Bs del crédito a la tasa de CADA venta (no a la tasa de hoy): una venta
    // fiada ayer no debe revalorizarse con la tasa del cierre.
    const creditosBs = round2(sumR(receivables.fiados.map(f => f.montoBs)));

    const derived = salesFromTransactions(allSales);
    const ventasNetasUsd = round2(num(todayTotalUsd) || derived.usd);
    const ventasNetasBs = round2(num(todayTotalBs) || derived.bs);

    // Cobrado de esas ventas: el resto de las ventas netas. Por construcción
    // cierra la invariante con `creditosUsd`.
    const cobradoUsd = round2(subR(ventasNetasUsd, creditosUsd));
    const cobradoBs = round2(subR(ventasNetasBs, creditosBs));

    const saldoFavorUsado = internalCreditUsed(allSales);
    const saldoFavorUsadoUsd = saldoFavorUsado.usd;

    const cobranzasUsd = round2(receivables.cobranzasUsd);
    const cobranzasBs = round2(sumR(receivables.cobranzas.map(c => c.montoBs)));

    const gananciaBs = round2(num(todayProfit));
    const gananciaUsd = bcvRate > 0 ? round2(divR(gananciaBs, bcvRate)) : 0;

    const hasCartera = carteraUsd !== null && carteraUsd !== undefined && Number.isFinite(Number(carteraUsd));
    const cartera = hasCartera ? round2(Number(carteraUsd)) : null;

    const rows = [];
    const push = (row) => rows.push({ level: 0, tone: 'ink', ...row });

    push({
        key: 'ventas_netas',
        label: 'Ventas netas del día',
        short: 'Ventas netas',
        hint: 'Mercancía vendida (sin anuladas). Incluye fiado y Cashea',
        usd: ventasNetasUsd,
        bs: ventasNetasBs,
    });
    push({
        key: 'cobrado',
        label: 'Cobrado de esas ventas',
        short: 'Cobrado',
        hint: saldoFavorUsadoUsd > 0
            ? 'Incluye lo pagado con saldo a favor, que no entró hoy a la caja'
            : 'Efectivo y otros medios: es lo que puede estar en la caja',
        level: 1,
        tone: 'muted',
        usd: cobradoUsd,
        bs: cobradoBs,
    });
    if (saldoFavorUsadoUsd > 0) {
        push({
            key: 'cobrado_saldo_favor',
            label: 'De eso, pagado con saldo a favor',
            short: 'Con saldo a favor',
            hint: 'El dinero entró el día que se generó el saldo (vuelto o abono)',
            level: 1,
            tone: 'muted',
            usd: saldoFavorUsadoUsd,
            bs: saldoFavorUsado.bs,
        });
        push({
            key: 'cobrado_caja',
            label: 'Entró hoy a caja y bancos',
            short: 'Entró a caja/bancos',
            hint: 'Cobrado menos lo pagado con saldo a favor',
            level: 1,
            tone: 'muted',
            usd: round2(subR(cobradoUsd, saldoFavorUsadoUsd)),
            bs: round2(subR(cobradoBs, saldoFavorUsado.bs)),
        });
    }
    push({
        key: 'a_credito',
        label: 'A crédito (por cobrar)',
        short: 'A crédito',
        hint: 'Mercancía entregada que aún no se cobró',
        level: 1,
        tone: 'credit',
        usd: creditosUsd,
        bs: creditosBs,
    });

    if (fiadoUsd > 0) {
        push({ key: 'fiado', label: 'Fiado a clientes', hint: 'Créditos del día entregados a clientes', short: 'Créditos: Fiado', level: 1, tone: 'credit', usd: fiadoUsd, bs: round2(sumR(fiadoMovs.map(f => f.montoBs))) });
        // F6: parte del fiado que se cubrió con saldo a favor (no sumó deuda).
        const cubiertoUsd = round2(receivables.fiadoCubiertoConFavorUsd || 0);
        if (cubiertoUsd > 0) {
            const rateOf = (f) => (f.montoUsd > 0 ? f.montoBs / f.montoUsd : 0);
            push({
                key: 'fiado_cubierto',
                label: 'De eso, cubierto con saldo a favor',
                hint: 'No sumó deuda: lo pagó el saldo que el cliente ya tenía',
                short: 'Fiado con saldo',
                level: 1,
                tone: 'muted',
                usd: cubiertoUsd,
                bs: round2(sumR(fiadoMovs.map(f => mulR(f.cubiertoConFavorUsd || 0, rateOf(f))))),
            });
        }
    }
    if (casheaUsd > 0) {
        push({ key: 'cashea', label: 'Cashea (financiado)', hint: 'Créditos del día financiados por Cashea', short: 'Créditos: Cashea', level: 1, tone: 'credit', usd: casheaUsd, bs: round2(sumR(casheaMovs.map(f => f.montoBs))) });
    }
    if (cobranzasUsd > 0) {
        push({
            key: 'cobranzas',
            label: 'Cobranzas de deudas anteriores',
            short: 'Cobranzas previas',
            hint: 'Dinero que entró a la caja pero no es venta de hoy',
            level: 0,
            tone: 'green',
            usd: cobranzasUsd,
            bs: cobranzasBs,
        });
    }
    if (saldoFavorGeneradoUsd > 0) {
        push({
            key: 'saldo_favor',
            label: 'Saldo a favor generado',
            short: 'Saldo a favor',
            hint: 'Vuelto a la billetera y sobrante de abonos. No es ingreso: queda acreditado al cliente',
            level: 1,
            tone: 'muted',
            usd: saldoFavorGeneradoUsd,
            bs: 0,
        });
    }

    push({
        key: 'ganancia',
        label: 'Ganancia estimada (devengada)',
        short: 'Ganancia estimada',
        hint: 'Incluye el margen de lo vendido a crédito, aunque todavía no se cobre',
        usd: gananciaUsd,
        bs: gananciaBs,
        tone: 'ink',
    });

    if (cartera !== null) {
        push({
            key: 'cartera',
            label: 'Cartera pendiente al cierre',
            short: 'Cartera pendiente',
            hint: 'Deuda acumulada de clientes y Cashea. No es flujo del día',
            usd: cartera,
            bs: bcvRate > 0 ? round2(mulR(cartera, bcvRate)) : 0,
            tone: 'muted',
        });
    }

    const invarianteDiff = round2(subR(round2(sumR([cobradoUsd, creditosUsd])), ventasNetasUsd));

    // Reparto en dos columnas para el PDF carta: a la izquierda el devengado
    // (qué se vendió y cuánto se cobró), a la derecha el crédito y el resultado.
    const SPLIT_KEYS = new Set(['ventas_netas', 'cobrado', 'cobrado_saldo_favor', 'cobrado_caja', 'a_credito']);
    const columns = [
        { title: 'Ventas y Cobros', rows: rows.filter(r => SPLIT_KEYS.has(r.key)) },
        { title: 'Créditos y Resultado', rows: rows.filter(r => !SPLIT_KEYS.has(r.key)) },
    ];

    return {
        rows,
        columns,
        ventasNetasUsd,
        ventasNetasBs,
        cobradoUsd,
        cobradoBs,
        creditosUsd,
        creditosBs,
        fiadoUsd,
        casheaUsd,
        cobranzasUsd,
        cobranzasBs,
        saldoFavorGeneradoUsd,
        saldoFavorUsadoUsd,
        gananciaUsd,
        gananciaBs,
        carteraUsd: cartera,
        // Hay algo que contar si hubo ventas, crédito o cobranza.
        hasMovement: ventasNetasUsd !== 0 || creditosUsd !== 0 || cobranzasUsd !== 0,
        invariante: {
            ok: invarianteDiff === 0,
            diff: invarianteDiff,
        },
    };
}
