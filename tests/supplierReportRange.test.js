import { describe, it, expect } from 'vitest';
import {
    filterActivityByRange,
    rangeLabel,
    buildSupplierActivityLines,
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
