// @vitest-environment jsdom

// Panel de estado de cuenta de proveedores del supervisor: MODO SOLO LECTURA
// (nunca escribe). Presentacional con datos de entrada (props) como el resto de
// paneles del monitor; deriva con buildSupplierLedger la misma semántica que la
// caja: deuda publicada + reparto FIFO de pagos + vencidas por dueDate.
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import SupplierLedgerPanel from '../src/components/Monitor/SupplierLedgerPanel';

const TODAY = new Date('2026-10-26T12:00:00.000Z');

describe('SupplierLedgerPanel', () => {
    let container;
    let root;

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root?.unmount());
        container?.remove();
    });

    const renderPanel = async (props) => {
        await act(async () => {
            root.render(<SupplierLedgerPanel today={TODAY} {...props} />);
        });
    };

    it('muestra la deuda total y las filas por proveedor', async () => {
        await renderPanel({
            suppliers: [
                { id: 's1', name: 'Distribuidora Norte', deuda: 250 },
                { id: 's2', name: 'Importadora Sur', deuda: 0 },
            ],
            invoices: [
                { id: 'i1', supplierId: 's1', invoiceNumber: '001', amountUsd: 250, date: '2026-10-01T12:00:00.000Z', dueDate: null },
            ],
            sales: [],
        });

        const panel = container.querySelector('[data-testid="supplier-ledger-panel"]');
        expect(panel).toBeTruthy();
        expect(panel.textContent).toContain('USD 250.00');
        expect(panel.textContent).toContain('Distribuidora Norte');
        expect(panel.textContent).toContain('Importadora Sur');
        expect(panel.textContent).toContain('1 factura');
    });

    it('marca VENCIDA con saldo pendiente y expande el detalle de facturas', async () => {
        await renderPanel({
            suppliers: [{ id: 's1', name: 'Distribuidora Norte', deuda: 300 }],
            invoices: [
                { id: 'i1', supplierId: 's1', invoiceNumber: '001', amountUsd: 300, date: '2026-01-01T12:00:00.000Z', dueDate: '2026-02-01' },
            ],
            sales: [],
        });

        expect(container.textContent).toContain('1 vencida');

        const rowButton = container.querySelector('[data-testid="supplier-ledger-list"] button');
        await act(async () => {
            rowButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });

        expect(container.textContent).toContain('Factura #001');
        expect(container.textContent).toContain('VENCIDA');
        expect(container.textContent).toContain('de USD 300.00');
    });

    it('una factura pagada con vencimiento pasado no se marca como vencida', async () => {
        await renderPanel({
            suppliers: [{ id: 's1', name: 'Distribuidora Norte', deuda: 0 }],
            invoices: [
                { id: 'i1', supplierId: 's1', invoiceNumber: '001', amountUsd: 300, date: '2026-01-01T12:00:00.000Z', dueDate: '2026-02-01' },
            ],
            sales: [
                {
                    id: 'p1', tipo: 'PAGO_PROVEEDOR', supplierId: 's1', totalUsd: -300,
                    date: '2026-01-15T12:00:00.000Z',
                },
            ],
        });

        expect(container.textContent).not.toContain('1 vencida');
        const rowButton = container.querySelector('[data-testid="supplier-ledger-list"] button');
        await act(async () => {
            rowButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(container.textContent).toContain('PAGADA');
    });

    it('muestra el indicador de divergencia cuando la deuda publicada no coincide con las facturas', async () => {
        await renderPanel({
            suppliers: [
                { id: 's1', name: 'Con Divergencia', deuda: 500 },
                { id: 's2', name: 'Sin Divergencia', deuda: 120 },
            ],
            invoices: [
                { id: 'i1', supplierId: 's1', invoiceNumber: '001', amountUsd: 100, date: '2026-10-01T12:00:00.000Z', dueDate: null },
                { id: 'i2', supplierId: 's2', invoiceNumber: '002', amountUsd: 120, date: '2026-10-01T12:00:00.000Z', dueDate: null },
            ],
            sales: [],
        });

        // Badge por fila solo donde la deuda publicada se desvía del derivado.
        expect(container.querySelector('[data-testid="supplier-divergence-s1"]')).toBeTruthy();
        expect(container.textContent).toContain('Δ USD 400.00');
        expect(container.querySelector('[data-testid="supplier-divergence-s2"]')).toBeNull();

        // El detalle ampliado explica ambas cifras y la diferencia.
        const rowButton = container.querySelector('[data-testid="supplier-ledger-row-s1"] button');
        await act(async () => {
            rowButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        });
        expect(container.textContent).toContain('Divergencia: la deuda publicada por la caja (USD 500.00)');
        expect(container.textContent).toContain('el saldo derivado de las facturas (USD 100.00)');
        expect(container.textContent).toContain('Diferencia: USD 400.00');
    });

    it('estado vacío explica que la caja aún no publica proveedores', async () => {
        await renderPanel({ suppliers: [], invoices: [], sales: [] });
        expect(container.textContent).toContain('La caja aún no tiene proveedores registrados');
    });
});
