// ============================================================
// Resumen de IVA del cierre de caja
// ------------------------------------------------------------
// Suma el IVA de las ventas del período, desglosado como en el ticket:
//   EXENTO (E) / BASE IMPONIBLE n% / IVA n%   (por alícuota, en USD y en Bs)
//
// Fuente de cada venta:
//   - con `ivaBreakdown` (ventas desde que el ticket desglosa el IVA): exacto.
//   - con `ivaUsd > 0` pero sin desglose (ventas anteriores): no se sabe qué
//     productos eran exentos, así que van aparte como «sin desglose» (base e IVA
//     totales) en vez de inventar el exento.
//   - sin IVA: no suman (si el IVA estaba apagado, `noTaxCount` las cuenta).
//
// Excluye anuladas y todo lo que no sea una venta (cobros, gastos, avances…).
// Núcleo puro: sin React ni acceso a storage.
// ============================================================

import { round2, sumR, mulR } from './dinero';

const SALE_TYPES = new Set(['VENTA', 'VENTA_FIADA', 'VENTA_CASHEA']);

const num = (v) => {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
};

/** "16" → "16%", "8.5" → "8,5%". */
const rateLabel = (rate) => `${String(Number(rate)).replace('.', ',')}%`;

/**
 * @param {Array} sales transacciones del período (pueden incluir anuladas y otros tipos)
 * @returns {{
 *   hasTax: boolean, saleCount: number, noTaxCount: number,
 *   exemptUsd: number, exemptBs: number,
 *   groups: Array<{ rate:number, baseUsd:number, baseBs:number, ivaUsd:number, ivaBs:number }>,
 *   unclassified: null | { count:number, baseUsd:number, baseBs:number, ivaUsd:number, ivaBs:number },
 *   ivaUsd: number, ivaBs: number,
 *   rows: Array<{ key:string, label:string, usd:number, bs:number, bold?:boolean }>
 * }}
 */
export function buildCloseTaxSummary(sales = []) {
    const list = (Array.isArray(sales) ? sales : []).filter(
        (s) => s && s.status !== 'ANULADA' && SALE_TYPES.has(s.tipo),
    );

    let exemptUsd = 0;
    let exemptBs = 0;
    const byRate = new Map();
    const unc = { count: 0, baseUsd: 0, baseBs: 0, ivaUsd: 0, ivaBs: 0 };
    let saleCount = 0;
    let noTaxCount = 0;

    for (const sale of list) {
        const b = sale.ivaBreakdown;
        if (b && Array.isArray(b.groups)) {
            saleCount += 1;
            exemptUsd += num(b.exemptUsd);
            exemptBs += num(b.exemptBs);
            for (const g of b.groups) {
                const rate = num(g.rate);
                const acc = byRate.get(rate) || { rate, baseUsd: 0, baseBs: 0, ivaUsd: 0, ivaBs: 0 };
                acc.baseUsd += num(g.baseUsd);
                acc.baseBs += num(g.baseBs);
                acc.ivaUsd += num(g.ivaUsd);
                acc.ivaBs += num(g.ivaBs);
                byRate.set(rate, acc);
            }
        } else if (num(sale.ivaUsd) > 0) {
            saleCount += 1;
            const ivaUsd = round2(num(sale.ivaUsd));
            const baseUsd = round2(sale.baseUsd != null ? num(sale.baseUsd) : num(sale.totalUsd) - ivaUsd);
            const rate = num(sale.rate) || 0;
            unc.count += 1;
            unc.baseUsd += baseUsd;
            unc.ivaUsd += ivaUsd;
            unc.baseBs += sale.baseBs != null ? num(sale.baseBs) : mulR(baseUsd, rate);
            unc.ivaBs += sale.ivaBs != null ? num(sale.ivaBs) : mulR(ivaUsd, rate);
        } else {
            noTaxCount += 1;
        }
    }

    const groups = [...byRate.values()]
        .filter((g) => g.rate > 0)
        .sort((a, b) => b.rate - a.rate)
        .map((g) => ({
            rate: g.rate,
            baseUsd: round2(g.baseUsd),
            baseBs: round2(g.baseBs),
            ivaUsd: round2(g.ivaUsd),
            ivaBs: round2(g.ivaBs),
        }));
    const exempt0 = byRate.get(0);
    if (exempt0) {
        exemptUsd += exempt0.baseUsd;
        exemptBs += exempt0.baseBs;
    }
    exemptUsd = round2(exemptUsd);
    exemptBs = round2(exemptBs);

    const unclassified = unc.count > 0
        ? {
            count: unc.count,
            baseUsd: round2(unc.baseUsd),
            baseBs: round2(unc.baseBs),
            ivaUsd: round2(unc.ivaUsd),
            ivaBs: round2(unc.ivaBs),
        }
        : null;

    const ivaUsd = round2(sumR([...groups.map((g) => g.ivaUsd), unclassified?.ivaUsd || 0]));
    const ivaBs = round2(sumR([...groups.map((g) => g.ivaBs), unclassified?.ivaBs || 0]));
    const hasTax = ivaUsd > 0 || exemptUsd > 0 || exemptBs > 0 || unclassified !== null;

    const rows = [];
    if (exemptUsd > 0 || exemptBs > 0) {
        rows.push({ key: 'exento', label: 'EXENTO (E)', usd: exemptUsd, bs: exemptBs });
    }
    for (const g of groups) {
        rows.push({ key: `base_${g.rate}`, label: `BASE IMPONIBLE ${rateLabel(g.rate)}`, usd: g.baseUsd, bs: g.baseBs });
        rows.push({ key: `iva_${g.rate}`, label: `IVA ${rateLabel(g.rate)}`, usd: g.ivaUsd, bs: g.ivaBs });
    }
    if (unclassified) {
        rows.push({ key: 'sin_desglose_base', label: `BASE sin desglose (${unclassified.count} venta${unclassified.count === 1 ? '' : 's'} anterior${unclassified.count === 1 ? '' : 'es'})`, usd: unclassified.baseUsd, bs: unclassified.baseBs });
        rows.push({ key: 'sin_desglose_iva', label: 'IVA sin desglose', usd: unclassified.ivaUsd, bs: unclassified.ivaBs });
    }
    if (hasTax) {
        rows.push({ key: 'total_iva', label: 'TOTAL IVA RECAUDADO', usd: ivaUsd, bs: ivaBs, bold: true });
    }

    return { hasTax, saleCount, noTaxCount, exemptUsd, exemptBs, groups, unclassified, ivaUsd, ivaBs, rows };
}
