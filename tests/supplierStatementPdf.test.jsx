import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { texts, saved } = vi.hoisted(() => ({ texts: [], saved: [] }));

vi.mock('jspdf', () => ({
    jsPDF: class {
        setFont() {}
        setFontSize() {}
        setTextColor() {}
        setFillColor() {}
        setDrawColor() {}
        setLineWidth() {}
        rect() {}
        line() {}
        addPage() {}
        text(value) { texts.push(String(value)); }
        save(name) { saved.push(name); }
    },
}));

import { generateGlobalSuppliersPDF, generateSupplierHistoryPDF } from '../src/utils/supplierReportGenerator';
import { SupplierReportRangeModal } from '../src/components/Suppliers/SupplierModals';
import { REPORT_RANGE_OPTIONS, buildSupplierActivityLines, resolveReportRange } from '../src/utils/supplierReportRange';
import { getPaymentLabel } from '../src/config/paymentMethods';

const NOW = new Date('2026-10-29T15:00:00'); // jueves

describe('períodos del reporte', () => {
    it('resuelve cada opción a un rango local', () => {
        expect(resolveReportRange('today', {}, NOW)).toEqual({ desde: '2026-10-29', hasta: '2026-10-29' });
        expect(resolveReportRange('yesterday', {}, NOW)).toEqual({ desde: '2026-10-28', hasta: '2026-10-28' });
        expect(resolveReportRange('week', {}, NOW)).toEqual({ desde: '2026-10-25', hasta: '2026-10-29' });
        expect(resolveReportRange('month', {}, NOW)).toEqual({ desde: '2026-10-01', hasta: '2026-10-29' });
        expect(resolveReportRange('lastMonth', {}, NOW)).toEqual({ desde: '2026-09-01', hasta: '2026-09-30' });
        expect(resolveReportRange('all', {}, NOW)).toEqual({ desde: '', hasta: '' });
        expect(resolveReportRange('custom', { desde: '2026-10-05', hasta: '2026-10-10' }, NOW)).toEqual({ desde: '2026-10-05', hasta: '2026-10-10' });
        expect(REPORT_RANGE_OPTIONS.map(o => o.id)).toEqual(['today', 'yesterday', 'week', 'month', 'lastMonth', 'all', 'custom']);
    });

    it('«Pago externo» tiene etiqueta legible', () => {
        expect(getPaymentLabel('pago_externo')).toBe('Pago Externo');
    });
});

describe('PDF de estado de cuenta', () => {
    beforeEach(() => { texts.length = 0; saved.length = 0; });

    const supplier = { id: 's', name: 'Prueba', deuda: 0 };
    const history = [
        { id: 'i1', type: 'INVOICE', invoiceNumber: 'jose', amountUsd: 150, date: '2026-10-29T12:00:00' },
        { id: 'p1', type: 'PAGO_PROVEEDOR', description: 'Pago de factura #jose (al registrarla)', totalUsd: -150, afectaCaja: false, paymentMethod: 'pago_externo', timestamp: '2026-10-29T12:00:00' },
        { id: 'i0', type: 'INVOICE', invoiceNumber: 'vieja', amountUsd: 30, date: '2026-09-02T12:00:00' },
        { id: 'pv', type: 'PAGO_PROVEEDOR', status: 'ANULADA', description: 'Pago anulado', totalUsd: -40, paymentMethod: 'efectivo_usd', timestamp: '2026-10-20T12:00:00' },
    ];

    it('usa un menos ASCII, nombra el método y muestra período y totales', async () => {
        await generateSupplierHistoryPDF({ supplier, historyData: history, desde: '2026-10-01', hasta: '2026-10-31' });

        expect(texts).toContain('- 150.00');
        expect(texts).toContain('+ 150.00');
        expect(texts.join('')).not.toContain('\u2212');
        expect(texts).toContain('Pago Externo');
        expect(texts).toContain('Pago de factura #jose (al registrarla)');
        expect(texts).not.toContain('Pago_externo');
        expect(texts).toContain('Período: Del 01/10/2026 al 31/10/2026');
        expect(texts).toContain('USD 150.00'); // facturas y pagos del período
        expect(texts.some(t => t.includes('#vieja'))).toBe(false); // fuera del rango
        expect(saved[0]).toBe('Estado_Cuenta_Prueba.pdf');
        // El pago anulado no sale ni en filas ni en el total de pagos.
        expect(texts).not.toContain('Pago anulado');
        expect(texts).not.toContain('- 40.00');
        expect(texts.filter(t => t === 'USD 150.00')).toHaveLength(2);
    });
});

describe('ticket de proveedores', () => {
    it('no incluye pagos anulados', () => {
        const { lines, pagosUsd } = buildSupplierActivityLines({
            invoices: [],
            payments: [
                { id: 'a', totalUsd: -10, timestamp: '2026-10-01T12:00:00' },
                { id: 'b', status: 'ANULADA', totalUsd: -99, timestamp: '2026-10-02T12:00:00' },
            ],
        });
        expect(lines).toHaveLength(1);
        expect(pagosUsd).toBe(10);
    });
});

describe('PDF de reporte general', () => {
    beforeEach(() => { texts.length = 0; saved.length = 0; });

    it('usa un menos ASCII, abrevia la operación y respeta el rango', async () => {
        await generateGlobalSuppliersPDF({
            suppliers: [{ id: 's', name: 'prueba', deuda: 0 }],
            invoices: [
                { id: 'i1', supplierId: 's', supplierName: 'prueba', invoiceNumber: 'jose', amountUsd: 150, date: '2026-10-29T12:00:00' },
                { id: 'i0', supplierId: 's', supplierName: 'prueba', invoiceNumber: 'vieja', amountUsd: 30, date: '2026-09-02T12:00:00' },
            ],
            allSales: [{
                id: 'p1', tipo: 'PAGO_PROVEEDOR', supplierId: 's', supplierName: 'prueba', totalUsd: -150, afectaCaja: false,
                paymentMethod: 'pago_externo', description: 'Pago de factura #jose (al registrarla)', timestamp: '2026-10-29T12:00:00',
            }],
            desde: '2026-10-01',
            hasta: '2026-10-31',
        });

        expect(texts).toContain('- 150.00');
        expect(texts.join('')).not.toContain('−');
        expect(texts).toContain('Pago Externo');
        expect(texts).toContain('Pago de factura #jose');
        expect(texts).toContain('Rango: Del 01/10/2026 al 31/10/2026');
        expect(texts.some(t => t.includes('#vieja'))).toBe(false);
    });
});

describe('SupplierReportRangeModal', () => {
    let container;
    let root;
    const onGenerate = vi.fn();
    const history = [
        { id: 'i1', type: 'INVOICE', amountUsd: 10, date: new Date().toISOString() },
        { id: 'i0', type: 'INVOICE', amountUsd: 10, date: '2020-01-05T12:00:00' },
        { id: 'pv', type: 'PAGO_PROVEEDOR', status: 'ANULADA', totalUsd: -5, timestamp: new Date().toISOString() },
    ];

    beforeEach(async () => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        onGenerate.mockReset();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => root.render(createElement(SupplierReportRangeModal, {
            supplierName: 'Prueba', historyData: history, onClose: vi.fn(), onGenerate,
        })));
    });

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        container?.remove();
    });

    const click = (label) => act(async () => [...container.querySelectorAll('button')].find(b => b.textContent.trim() === label).click());

    it('ofrece los períodos y genera con el rango elegido', async () => {
        for (const label of ['Hoy', 'Ayer', 'Esta semana', 'Este mes', 'Mes anterior', 'Todo el historial', 'Personalizado']) {
            expect([...container.querySelectorAll('button')].some(b => b.textContent.trim() === label)).toBe(true);
        }
        await click('Hoy');
        expect(container.textContent).toContain('1 movimiento');
        await click('Generar PDF');
        expect(onGenerate).toHaveBeenCalledWith(expect.objectContaining({ desde: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) }));
    });

    it('con «Todo el historial» cuenta todo y sin movimientos en el período bloquea el botón', async () => {
        await click('Todo el historial');
        expect(container.textContent).toContain('Todo el historial · 2 movimientos');
        await click('Ayer');
        expect(container.textContent).toContain('0 movimientos');
        const generate = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Generar PDF'));
        expect(generate.disabled).toBe(true);
    });
});
