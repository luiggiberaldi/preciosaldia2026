// @vitest-environment jsdom
// IVA del cierre de caja: EXENTO (E) / BASE IMPONIBLE n% / IVA n% sumados de las ventas del período.
import { describe, expect, it } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { FinancialEngine } from '../src/core/FinancialEngine';
import { resolveLineIvaRate } from '../src/config/taxConfig';
import { buildCloseTaxSummary } from '../src/utils/closeTaxSummary';
import { buildDailyCloseHtml } from '../src/utils/dailyCloseHtmlTemplate';
import { getPaperConfig } from '../src/utils/ticketConstants';
import CierreCajaSummaryModal from '../src/components/Dashboard/CierreCajaSummaryModal';
import { round2, sumR } from '../src/utils/dinero';

const RATE = 895;
const TAX = { ivaEnabled: true, ivaRate: 16 };
const opts = { enabled: true, resolveRate: (i) => resolveLineIvaRate(i, TAX) };

function venta(id, cart, extra = {}) {
    const t = FinancialEngine.buildCartTotals(cart, null, RATE, 0, false, opts);
    return {
        id, tipo: 'VENTA', status: 'COMPLETADA', rate: RATE,
        items: cart.map((i) => ({ ...i, ivaRate: resolveLineIvaRate(i, TAX) })),
        totalUsd: t.totalUsd, totalBs: t.totalBs, baseUsd: t.baseUsd, ivaUsd: t.ivaUsd, ivaBs: t.ivaBs, ivaBreakdown: t.ivaBreakdown,
        ...extra,
    };
}

const A = venta('a', [
    { name: 'Harina', priceUsd: 1.2, qty: 2, ivaRate: 0 },
    { name: 'Aceite', priceUsd: 3.5, qty: 1 },
    { name: 'Jabón', priceUsd: 0.9, qty: 2 },
]);
const B = venta('b', [{ name: 'Pan', priceUsd: 2, qty: 1, ivaRate: 8 }, { name: 'Arroz', priceUsd: 1.1, qty: 3, ivaRate: 0 }]);
const VIEJA = { id: 'v', tipo: 'VENTA', status: 'COMPLETADA', rate: RATE, totalUsd: 10.15, baseUsd: 8.75, ivaUsd: 1.4, totalBs: 9084.25 };
const ANULADA = { ...venta('x', [{ name: 'Caro', priceUsd: 50, qty: 1 }]), status: 'ANULADA' };
const SIN_IVA = { id: 's', tipo: 'VENTA', status: 'COMPLETADA', rate: RATE, totalUsd: 5, totalBs: 4475 };

describe('buildCloseTaxSummary', () => {
    it('suma el exento y agrupa base e IVA por alícuota (16% antes que 8%)', () => {
        const s = buildCloseTaxSummary([A, B]);
        expect(s.exemptUsd).toBe(round2(A.ivaBreakdown.exemptUsd + B.ivaBreakdown.exemptUsd));
        expect(s.groups.map((g) => g.rate)).toEqual([16, 8]);
        expect(s.groups[0].ivaUsd).toBe(A.ivaBreakdown.groups[0].ivaUsd);
        expect(s.groups[1]).toMatchObject({ rate: 8, baseUsd: 2, ivaUsd: 0.16 });
        expect(s.ivaUsd).toBe(round2(A.ivaUsd + B.ivaUsd));
        expect(s.ivaBs).toBe(round2(A.ivaBs + B.ivaBs));
        expect(s.unclassified).toBeNull();
    });

    it('exento + bases + IVA = lo vendido (en USD y en Bs)', () => {
        const s = buildCloseTaxSummary([A, B]);
        const totalUsd = round2(s.exemptUsd + sumR(s.groups.map((g) => g.baseUsd + g.ivaUsd)));
        const totalBs = round2(s.exemptBs + sumR(s.groups.map((g) => g.baseBs + g.ivaBs)));
        expect(totalUsd).toBe(round2(A.totalUsd + B.totalUsd));
        expect(totalBs).toBe(round2(A.totalBs + B.totalBs));
    });

    it('ventas anteriores sin desglose van aparte, sin inventar exento', () => {
        const s = buildCloseTaxSummary([A, VIEJA]);
        expect(s.unclassified).toMatchObject({ count: 1, baseUsd: 8.75, ivaUsd: 1.4 });
        expect(s.unclassified.ivaBs).toBe(round2(1.4 * RATE));
        expect(s.exemptUsd).toBe(A.ivaBreakdown.exemptUsd);
        expect(s.ivaUsd).toBe(round2(A.ivaUsd + 1.4));
        expect(s.rows.map((r) => r.label)).toContain('IVA sin desglose');
    });

    it('no cuenta anuladas, ventas sin IVA ni otros tipos de transacción', () => {
        const s = buildCloseTaxSummary([A, ANULADA, SIN_IVA, { tipo: 'GASTO_INTERNO', totalUsd: -3 }, { tipo: 'COBRO_DEUDA', totalUsd: 4 }, null]);
        expect(s.ivaUsd).toBe(A.ivaUsd);
        expect(s.noTaxCount).toBe(1);
        expect(s.saleCount).toBe(1);
    });

    it('sin IVA en el período: no hay resumen', () => {
        const s = buildCloseTaxSummary([SIN_IVA]);
        expect(s.hasTax).toBe(false);
        expect(s.rows).toEqual([]);
        expect(buildCloseTaxSummary([]).hasTax).toBe(false);
        expect(buildCloseTaxSummary(undefined).hasTax).toBe(false);
    });

    it('venta toda exenta: aparece EXENTO sin líneas de base ni IVA', () => {
        const s = buildCloseTaxSummary([venta('e', [{ name: 'Arroz', priceUsd: 1, qty: 3, ivaRate: 0 }])]);
        expect(s.hasTax).toBe(true);
        expect(s.rows.map((r) => r.label)).toEqual(['EXENTO (E)', 'TOTAL IVA RECAUDADO']);
        expect(s.ivaUsd).toBe(0);
    });

    it('el total de IVA recaudado cierra el resumen', () => {
        const s = buildCloseTaxSummary([A, B, VIEJA]);
        const last = s.rows[s.rows.length - 1];
        expect(last).toMatchObject({ key: 'total_iva', label: 'TOTAL IVA RECAUDADO', usd: s.ivaUsd, bs: s.ivaBs, bold: true });
    });
});

describe('cierre impreso (HTML térmico)', () => {
    const render = (extra = {}) => buildDailyCloseHtml(
        { todayTotalUsd: 30, todayTotalBs: 26850, todayItemsSold: 5, paymentBreakdown: {}, topProducts: [], bcvRate: RATE, allSales: [A, B, ANULADA], sales: [], ...extra },
        getPaperConfig('80'),
        {},
    );

    it('muestra EXENTO (E), BASE IMPONIBLE e IVA por alícuota y el total', () => {
        const html = render();
        expect(html).toContain('IVA del Período');
        expect(html).toContain('EXENTO (E)');
        expect(html).toContain('BASE IMPONIBLE 16%');
        expect(html).toContain('IVA 8%');
        expect(html).toContain('TOTAL IVA RECAUDADO');
    });

    it('la tasa del cierre dice "Tasa activa" (automática o manual), no "Tasa BCV"', () => {
        const html = render();
        expect(html).toContain('Tasa activa: Bs 895,00');
        expect(html).not.toContain('Tasa BCV');
    });

    it('sin IVA en el período el cierre queda como antes', () => {
        const html = render({ allSales: [SIN_IVA] });
        expect(html).not.toContain('IVA del Período');
        expect(html).not.toContain('EXENTO');
    });
});

describe('pantalla Cierre Completado', () => {
    const summaryData = { sales: [A, B], allSales: [A, B, ANULADA], todayTotalUsd: 30, todayTotalBs: 26850, todayItemsSold: 5, reconData: {} };
    const render = (props = {}) => renderToStaticMarkup(
        React.createElement(CierreCajaSummaryModal, { isOpen: true, onClose: () => {}, summaryData, onPrint: () => {}, onDownload: () => {}, onShare: () => {}, ...props }),
    );

    it('muestra el IVA del período con exento y alícuotas', () => {
        const html = render();
        expect(html).toContain('cierre-iva-summary');
        expect(html).toContain('EXENTO (E)');
        expect(html).toContain('BASE IMPONIBLE 16%');
        expect(html).toContain('TOTAL IVA RECAUDADO');
    });

    it('en cierre ciego no se muestran los montos de IVA', () => {
        expect(render({ blindClose: true })).not.toContain('cierre-iva-summary');
    });

    it('sin IVA en el período no aparece el bloque', () => {
        expect(render({ summaryData: { ...summaryData, sales: [SIN_IVA], allSales: [SIN_IVA] } })).not.toContain('cierre-iva-summary');
    });
});
