import { describe, it, expect } from 'vitest';
import {
    filterActivityByRange,
    rangeLabel,
    buildSupplierActivityLines,
    buildSupplierPeriodSummary,
} from '../src/utils/supplierReportRange';

// Fechas con mediodía local para que el día local no dependa de la zona horaria del runner.
const at = (ymd) => new Date(`${ymd}T12:00:00`).toISOString();

describe('filterActivityByRange', () => {
    const items = [
        { id: 'a', date: at('2026-10-01') },
        { id: 'b', date: at('2026-10-05') },
        { id: 'c', date: at('2026-10-09') },
    ];

    it('sin límites devuelve todo', () => {
        expect(filterActivityByRange(items)).toHaveLength(3);
    });

    it('desde/hasta son inclusivos', () => {
        const ids = filterActivityByRange(items, '2026-10-05', '2026-10-09').map((i) => i.id);
        expect(ids).toEqual(['b', 'c']);
    });

    it('excluye registros sin fecha válida cuando hay rango', () => {
        const mixed = [...items, { id: 'x' }, { id: 'y', date: 'no-es-fecha' }];
        const ids = filterActivityByRange(mixed, '2026-10-01', '').map((i) => i.id);
        expect(ids).toEqual(['a', 'b', 'c']);
    });

    it('no es array → lista vacía', () => {
        expect(filterActivityByRange(null, '2026-10-01', '')).toEqual([]);
    });
});

describe('buildSupplierPeriodSummary', () => {
    const suppliers = [
        { id: 's1', name: 'Distribuidora A', deuda: 35 },
        { id: 's2', name: 'Distribuidora B', deuda: 10 },
    ];
    const invoices = [
        { id: 'i1', supplierId: 's1', amountUsd: 80, date: at('2026-10-02') },
        { id: 'i2', supplierId: 's2', amountUsd: 20, date: at('2026-10-10') },
    ];
    const payments = [
        { id: 'p1', supplierId: 's1', totalUsd: -45, timestamp: at('2026-10-03') },
        { id: 'pExternal', supplierId: 's1', totalUsd: -6, timestamp: at('2026-10-04'), afectaCaja: false },
        { id: 'p2', supplierId: 's2', totalUsd: -12, timestamp: at('2026-10-04'), status: 'ANULADA' },
        { id: 'p3', supplierId: 's2', totalUsd: -7, timestamp: at('2026-10-10') },
    ];

    it('separa compras del período, pagos no anulados y deuda actual', () => {
        const summary = buildSupplierPeriodSummary({
            suppliers,
            invoices,
            payments,
            desde: '2026-10-01',
            hasta: '2026-10-05',
        });
        expect(summary.totalInvoicesUsd).toBe(80);
        expect(summary.totalPaymentsUsd).toBe(51);
        expect(summary.currentDebtUsd).toBe(45);
        expect(summary.rows).toEqual([
            { supplierId: 's1', supplierName: 'Distribuidora A', invoicesUsd: 80, paymentsUsd: 51, currentDebtUsd: 35 },
        ]);
    });

    it('incluye facturas y pagos del mismo rango, agrupados por proveedor', () => {
        const summary = buildSupplierPeriodSummary({ suppliers, invoices, payments });
        expect(summary.totalInvoicesUsd).toBe(100);
        expect(summary.totalPaymentsUsd).toBe(58);
        expect(summary.currentDebtUsd).toBe(45);
        expect(summary.rows.map(({ supplierName }) => supplierName)).toEqual(['Distribuidora A', 'Distribuidora B']);
        expect(summary.rows[0].paymentsUsd).toBe(51);
        expect(summary.rows[1].paymentsUsd).toBe(7);
    });
});

describe('rangeLabel', () => {
    it('formatea los cuatro casos', () => {
        expect(rangeLabel()).toBe('Todo el historial');
        expect(rangeLabel('2026-10-01', '2026-10-09')).toBe('Del 01/10/2026 al 09/10/2026');
        expect(rangeLabel('2026-10-01', '')).toBe('Desde 01/10/2026');
        expect(rangeLabel('', '2026-10-09')).toBe('Hasta 09/10/2026');
    });
});

describe('buildSupplierActivityLines', () => {
    const invoices = [
        { id: 'f1', invoiceNumber: '100', amountUsd: 50, date: at('2026-10-01') },
        { id: 'f2', invoiceNumber: '101', amountUsd: 30, date: at('2026-10-09') },
    ];
    const payments = [
        { id: 'p1', totalUsd: -20, date: at('2026-10-05') },
    ];

    it('suma facturas, pagos y calcula el neto (facturas − pagos)', () => {
        const r = buildSupplierActivityLines({ invoices, payments });
        expect(r.facturasUsd).toBe(80);
        expect(r.pagosUsd).toBe(20);
        expect(r.netoUsd).toBe(60);
        expect(r.lines).toHaveLength(3);
    });

    it('ordena las líneas de más reciente a más antigua', () => {
        const r = buildSupplierActivityLines({ invoices, payments });
        const times = r.lines.map((l) => l.time);
        expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    it('con rango solo cuenta lo que cae dentro', () => {
        const r = buildSupplierActivityLines({ invoices, payments, desde: '2026-10-02', hasta: '2026-10-08' });
        expect(r.facturasUsd).toBe(0);
        expect(r.pagosUsd).toBe(20);
        expect(r.netoUsd).toBe(-20);
    });
});
