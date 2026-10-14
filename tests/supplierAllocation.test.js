import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { AddInvoiceModal, PayInvoiceModal, SupplierDetailsSheet } from '../src/components/Suppliers/SupplierModals.jsx';
import { allocatePaymentsToInvoices, paidAmountForInvoice } from '../src/utils/supplierAllocation.js';

const inv = (id, amountUsd, date) => ({ id, amountUsd, date });
const pay = (id, totalUsd, date) => ({ id, totalUsd: -totalUsd, date });

describe('tasas BCV real y tasa activa en movimientos de proveedor', () => {
    let container;
    let root;

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        container?.remove();
    });

    it('la factura usa BCV real por defecto y el toggle permite usar la tasa activa del sistema', async () => {
        let savedInvoice;
        await act(async () => root.render(createElement(AddInvoiceModal, {
            supplier: { id: 'supplier-1', name: 'Proveedor de prueba' },
            bcvRate: 87.68,
            systemRate: 36.35,
            onClose: () => {},
            onSave: invoice => { savedInvoice = invoice; },
        })));

        const invoiceNumber = container.querySelector('input[type="text"]');
        const amount = container.querySelector('input[type="number"]');
        const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        await act(async () => {
            setInputValue.call(invoiceNumber, 'F-1313');
            invoiceNumber.dispatchEvent(new Event('input', { bubbles: true }));
            setInputValue.call(amount, '100');
            amount.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(container.textContent).toContain('Tasa aplicada: BCV real · 87,68 Bs/USD');
        expect(container.textContent).toContain('Equivale a 8.768,00 Bs');

        const toggle = container.querySelector('input[aria-label="Usar tasa BCV real"]');
        const setChecked = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked').set;
        await act(async () => {
            setChecked.call(toggle, false);
            toggle.dispatchEvent(new Event('click', { bubbles: true }));
        });
        expect(container.textContent).toContain('Tasa aplicada: tasa del sistema · 36,35 Bs/USD');
        expect(container.textContent).toContain('Equivale a 3.635,00 Bs');

        await act(async () => {
            setChecked.call(toggle, true);
            toggle.dispatchEvent(new Event('click', { bubbles: true }));
        });

        const submitButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent.trim() === 'Registrar Deuda');
        await act(async () => submitButton.click());
        expect(savedInvoice.amountBs).toBe(8_768);
        expect(savedInvoice.rateType).toBe('bcv');
        expect(savedInvoice.exchangeRate).toBe(87.68);
    }, 20_000); // Primera renderización de SupplierModals: bajo carga de la suite completa supera 5 s por defecto.

    it('el panel de detalle calcula contadores y filtros de facturas sobre el historial completo', async () => {
        const historyData = [
            { id: 'f-old', type: 'INVOICE', invoiceNumber: 'F-100', amountUsd: 10, date: '2026-10-01T10:00:00.000Z' },
            { id: 'f-new', type: 'INVOICE', invoiceNumber: 'F-200', amountUsd: 5, date: '2026-10-05T10:00:00.000Z' },
            { id: 'p-1', type: 'PAYMENT', totalUsd: -10, date: '2026-10-03T10:00:00.000Z', status: 'ACTIVA' },
        ];
        await act(async () => root.render(createElement(SupplierDetailsSheet, {
            supplier: { id: 'supplier-1', name: 'Proveedor de prueba', deuda: 5 },
            isOpen: true,
            isAdmin: false,
            historyData,
            bcvRate: 0,
            tasaCop: 0,
            copEnabled: false,
            copPrimary: false,
            onClose: () => {},
        })));

        // F-100 queda pagada (10 cubre 10); F-200 pendiente con 5.
        const pills = Array.from(container.querySelectorAll('button[aria-pressed]')).map(b => b.textContent.trim());
        expect(pills).toEqual(['Pendientes 1', 'Pagadas 1', 'Todas 2']);
        expect(container.textContent).toContain('Factura #F-200');
        expect(container.textContent).not.toContain('Factura #F-100');

        const allButton = Array.from(container.querySelectorAll('button[aria-pressed]')).find(b => b.textContent.trim().startsWith('Todas'));
        await act(async () => allButton.click());
        expect(container.textContent).toContain('Factura #F-100');
        expect(container.textContent).toContain('Factura #F-200');
    });

    it('el pago dirigido permite buscar y selecciona una factura específica con saldo máximo', async () => {
        let savedPayment;
        const invoices = Array.from({ length: 100 }, (_, index) => ({
            id: `invoice-${index}`,
            invoiceNumber: `F-${String(index + 1).padStart(3, '0')}`,
            amountUsd: 10,
            date: new Date(2026, 0, index + 1, 12).toISOString(),
        }));
        await act(async () => root.render(createElement(PayInvoiceModal, {
            supplier: { id: 'supplier-1', name: 'Proveedor de prueba', deuda: 1000 },
            bcvRate: 10,
            systemRate: 10,
            invoices,
            payments: [],
            onClose: () => {},
            onSave: payment => { savedPayment = payment; },
        })));

        await act(async () => container.querySelector('button[aria-label="Factura específica"]').click());
        expect(container.querySelectorAll('button[aria-label^="Factura #"]')).toHaveLength(0);
        const search = container.querySelector('input[aria-label="Buscar factura"]');
        const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        await act(async () => {
            setInputValue.call(search, 'F-100');
            search.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const target = Array.from(container.querySelectorAll('button[type="button"]')).find(button => button.textContent.includes('Factura #F-100'));
        expect(target).toBeTruthy();
        await act(async () => target.click());
        const amount = container.querySelector('input[type="number"]');
        expect(amount.value).toBe('100.00');
        expect(container.textContent).toContain('Saldo máximo de esta factura: USD 10.00');

        await act(async () => {
            setInputValue.call(amount, '110');
            amount.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(container.querySelector('button[type="submit"]').disabled).toBe(true);
        expect(container.textContent).toContain('El pago supera el máximo permitido de USD 10.00');

        await act(async () => {
            setInputValue.call(amount, '50');
            amount.dispatchEvent(new Event('input', { bubbles: true }));
            container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
        expect(savedPayment.amountUsd).toBe(5);
        expect(savedPayment.invoiceId).toBe('invoice-99');
    });

    it('deshabilita el envío automático cuando el pago supera la deuda total', async () => {
        await act(async () => root.render(createElement(PayInvoiceModal, {
            supplier: { id: 'supplier-1', name: 'Proveedor de prueba', deuda: 10 },
            bcvRate: 1,
            systemRate: 1,
            onClose: () => {},
            onSave: () => {},
        })));
        const amount = container.querySelector('input[type="number"]');
        const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        await act(async () => {
            setInputValue.call(amount, '10.01');
            amount.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(container.querySelector('button[type="submit"]').disabled).toBe(true);
        expect(container.textContent).toContain('El pago supera el máximo permitido de USD 10.00');
    });

    it('el pago usa BCV real por defecto y convierte con la tasa activa al apagar el toggle', async () => {
        let savedPayment;
        await act(async () => root.render(createElement(PayInvoiceModal, {
            supplier: { id: 'supplier-1', name: 'Proveedor de prueba', deuda: 10 },
            bcvRate: 87.68,
            systemRate: 36.35,
            onClose: () => {},
            onSave: payment => { savedPayment = payment; },
        })));

        const amount = container.querySelector('input[type="number"]');
        const setInputValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        await act(async () => {
            setInputValue.call(amount, '363.50');
            amount.dispatchEvent(new Event('input', { bubbles: true }));
        });
        expect(container.textContent).toContain('USD 4.15');
        const toggle = container.querySelector('input[aria-label="Usar tasa BCV real"]');
        const setChecked = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'checked').set;
        await act(async () => {
            setChecked.call(toggle, false);
            toggle.dispatchEvent(new Event('click', { bubbles: true }));
        });
        expect(container.textContent).toContain('USD 10.00');
        await act(async () => {
            setChecked.call(toggle, true);
            toggle.dispatchEvent(new Event('click', { bubbles: true }));
        });
        expect(container.textContent).toContain('USD 4.15');
        await act(async () => {
            const form = container.querySelector('form');
            form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        });
        expect(savedPayment.amountUsd).toBeCloseTo(363.5 / 87.68, 10);
        expect(savedPayment.amountBs).toBe(363.5);
        expect(savedPayment.exchangeRate).toBe(87.68);
        expect(savedPayment.rateType).toBe('bcv');
    });
});

describe('allocatePaymentsToInvoices', () => {
    it('el modo pagadas omite facturas pendientes y el filtro todas conserva todo el historial', async () => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        const container = document.createElement('div');
        document.body.appendChild(container);
        const root = createRoot(container);
        await act(async () => root.render(createElement(SupplierDetailsSheet, {
            supplier: { id: 'supplier-1', name: 'Proveedor de prueba', deuda: 5 },
            isOpen: true,
            isAdmin: false,
            onClose: () => {},
            onAddInvoice: () => {},
            onPayInvoice: () => {},
            onEdit: () => {},
            onDelete: () => {},
            bcvRate: 1,
            historyData: [
                { id: 'open', type: 'INVOICE', invoiceNumber: 'F-OPEN', amountUsd: 5, dueDate: '2026-12-01', date: '2026-10-01T12:00:00.000Z' },
                { id: 'paid', type: 'INVOICE', invoiceNumber: 'F-PAID', amountUsd: 5, date: '2026-10-02T12:00:00.000Z' },
                { id: 'payment', totalUsd: -5, invoiceId: 'paid', timestamp: '2026-10-03T12:00:00.000Z' },
            ],
        })));
        expect(container.textContent).toContain('Factura #F-OPEN');
        expect(container.textContent).not.toContain('Factura #F-PAID');
        expect(container.textContent).toContain('Todas 2');
        expect(container.textContent).toContain('Facturas por estado');
        expect(container.textContent).toContain('Los pagos se muestran en todos los filtros.');

        const setPaid = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Pagadas'));
        await act(async () => setPaid.click());
        expect(container.textContent).toContain('Factura #F-PAID');
        expect(container.textContent).not.toContain('Factura #F-OPEN');

        const setAll = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Todas'));
        await act(async () => setAll.click());
        expect(container.textContent).toContain('Factura #F-OPEN');
        expect(container.textContent).toContain('Factura #F-PAID');
        await act(async () => root.unmount());
        container.remove();
    });

    it('marca una factura sin pagos como PENDIENTE', () => {
        const { byInvoice, unallocatedUsd } = allocatePaymentsToInvoices([inv('a', 5, '2026-10-01')], []);
        expect(byInvoice.get('a')).toEqual({ paidUsd: 0, remainingUsd: 5, status: 'PENDIENTE' });
        expect(unallocatedUsd).toBe(0);
    });

    it('un pago parcial deja la factura PARCIAL con el saldo restante', () => {
        const { byInvoice } = allocatePaymentsToInvoices(
            [inv('a', 5, '2026-10-01')],
            [pay('p1', 3, '2026-10-05')],
        );
        expect(byInvoice.get('a')).toEqual({ paidUsd: 3, remainingUsd: 2, status: 'PARCIAL' });
    });

    it('un pago que cubre la factura completa la deja PAGADA', () => {
        const { byInvoice } = allocatePaymentsToInvoices(
            [inv('a', 5, '2026-10-01')],
            [pay('p1', 5, '2026-10-05')],
        );
        expect(byInvoice.get('a')).toEqual({ paidUsd: 5, remainingUsd: 0, status: 'PAGADA' });
    });

    it('reparte FIFO: el pago cubre la factura más antigua primero', () => {
        const { byInvoice } = allocatePaymentsToInvoices(
            [inv('nueva', 4, '2026-10-10'), inv('vieja', 5, '2026-10-01')],
            [pay('p1', 6, '2026-10-12')],
        );
        expect(byInvoice.get('vieja')).toEqual({ paidUsd: 5, remainingUsd: 0, status: 'PAGADA' });
        expect(byInvoice.get('nueva')).toEqual({ paidUsd: 1, remainingUsd: 3, status: 'PARCIAL' });
    });

    it('un pago puede cubrir varias facturas', () => {
        const { byInvoice } = allocatePaymentsToInvoices(
            [inv('a', 2, '2026-10-01'), inv('b', 2, '2026-10-02'), inv('c', 2, '2026-10-03')],
            [pay('p1', 3, '2026-10-05')],
        );
        expect(byInvoice.get('a').status).toBe('PAGADA');
        expect(byInvoice.get('b')).toEqual({ paidUsd: 1, remainingUsd: 1, status: 'PARCIAL' });
        expect(byInvoice.get('c').status).toBe('PENDIENTE');
    });

    it('aplica los pagos en orden cronológico aunque lleguen desordenados', () => {
        const { byInvoice } = allocatePaymentsToInvoices(
            [inv('a', 4, '2026-10-01')],
            [pay('tarde', 3, '2026-10-09'), pay('temprano', 2, '2026-10-02')],
        );
        expect(byInvoice.get('a')).toEqual({ paidUsd: 4, remainingUsd: 0, status: 'PAGADA' });
    });

    it('reporta el excedente como saldo no asignado cuando el pago supera lo facturado', () => {
        const { byInvoice, unallocatedUsd } = allocatePaymentsToInvoices(
            [inv('a', 2, '2026-10-01')],
            [pay('p1', 5, '2026-10-05')],
        );
        expect(byInvoice.get('a').status).toBe('PAGADA');
        expect(unallocatedUsd).toBe(3);
    });

    it('un pago con invoiceId cubre esa factura aunque no sea la más antigua', () => {
        const { byInvoice } = allocatePaymentsToInvoices(
            [inv('vieja', 5, '2026-10-01'), inv('nueva', 5, '2026-10-10')],
            [{ id: 'p1', totalUsd: -3, invoiceId: 'nueva', date: '2026-10-12' }],
        );
        expect(byInvoice.get('nueva')).toEqual({ paidUsd: 3, remainingUsd: 2, status: 'PARCIAL' });
        expect(byInvoice.get('vieja')).toEqual({ paidUsd: 0, remainingUsd: 5, status: 'PENDIENTE' });
    });

    it('si el pago dirigido excede la factura, el excedente sigue FIFO', () => {
        const { byInvoice, unallocatedUsd } = allocatePaymentsToInvoices(
            [inv('vieja', 5, '2026-10-01'), inv('nueva', 2, '2026-10-10')],
            [{ id: 'p1', totalUsd: -4, invoiceId: 'nueva', date: '2026-10-12' }],
        );
        expect(byInvoice.get('nueva')).toEqual({ paidUsd: 2, remainingUsd: 0, status: 'PAGADA' });
        expect(byInvoice.get('vieja')).toEqual({ paidUsd: 2, remainingUsd: 3, status: 'PARCIAL' });
        expect(unallocatedUsd).toBe(0);
    });

    it('un pago dirigido a una factura inexistente se reparte FIFO', () => {
        const { byInvoice } = allocatePaymentsToInvoices(
            [inv('a', 5, '2026-10-01')],
            [{ id: 'p1', totalUsd: -2, invoiceId: 'borrada', date: '2026-10-05' }],
        );
        expect(byInvoice.get('a')).toEqual({ paidUsd: 2, remainingUsd: 3, status: 'PARCIAL' });
    });

    it('un pago ANULADA no reduce el saldo ni cuenta como pagado', () => {
        const { byInvoice, unallocatedUsd } = allocatePaymentsToInvoices(
            [inv('a', 5, '2026-10-01')],
            [{ id: 'p1', totalUsd: -3, status: 'ANULADA', date: '2026-10-05' }],
        );
        expect(byInvoice.get('a')).toEqual({ paidUsd: 0, remainingUsd: 5, status: 'PENDIENTE' });
        expect(unallocatedUsd).toBe(0);
    });

    it('anular un pago devuelve su monto a la factura, pero el resto de pagos siguen activos', () => {
        const invoices = [inv('a', 5, '2026-10-01')];
        const payments = [
            { id: 'p1', totalUsd: -2, date: '2026-10-03' },
            { id: 'p2', totalUsd: -2, date: '2026-10-04', status: 'ANULADA' },
        ];
        expect(paidAmountForInvoice(invoices, payments, 'a')).toBe(2);
    });

    it('paidAmountForInvoice devuelve lo pagado a una factura concreta', () => {
        const invoices = [inv('a', 5, '2026-10-01'), inv('b', 5, '2026-10-02')];
        const payments = [pay('p1', 7, '2026-10-05')];
        expect(paidAmountForInvoice(invoices, payments, 'a')).toBe(5);
        expect(paidAmountForInvoice(invoices, payments, 'b')).toBe(2);
        expect(paidAmountForInvoice(invoices, payments, 'x')).toBe(0);
    });
});
