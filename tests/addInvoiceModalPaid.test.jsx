import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AddInvoiceModal } from '../src/components/Suppliers/SupplierModals';

const methods = [
    { id: 'efectivo_usd', label: 'Efectivo USD', currency: 'USD' },
    { id: 'efectivo_bs', label: 'Efectivo Bs', currency: 'BS' },
];

describe('AddInvoiceModal › «Ya la pagué»', () => {
    let container;
    let root;
    const onSave = vi.fn();

    const render = () => act(async () => root.render(createElement(AddInvoiceModal, {
        supplier: { id: 'sup-1', name: 'Proveedor Uno' },
        bcvRate: 40,
        activePaymentMethods: methods,
        onClose: vi.fn(),
        onSave,
    })));
    const setInput = async (input, value) => act(async () => {
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        setter.call(input, value);
        input.dispatchEvent(new Event('input', { bubbles: true }));
    });
    const toggle = () => container.querySelector('input[aria-label="Ya la pagué"]');

    beforeEach(async () => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        onSave.mockReset();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await render();
    });

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        container?.remove();
    });

    it('al activarlo desaparece el plazo de pago y cambia el botón', async () => {
        expect(container.textContent).toContain('Plazo de pago');
        expect(container.textContent).toContain('Registrar Deuda');

        await act(async () => toggle().click());

        expect(container.textContent).not.toContain('Plazo de pago');
        expect(container.textContent).not.toContain('Fecha Vencimiento');
        expect(container.textContent).toContain('Registrar Factura Pagada');
    });

    it('envía la factura sin vencimiento aunque se haya llenado el plazo antes', async () => {
        const inputs = () => [...container.querySelectorAll('input')];
        await setInput(inputs().find(i => i.type === 'text'), 'F-100');
        await setInput(inputs().find(i => i.type === 'number'), '50');
        await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === '7 días').click());
        await act(async () => toggle().click());

        await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

        const [invoice, paid] = onSave.mock.calls[0];
        expect(invoice).toMatchObject({ invoiceNumber: 'F-100', amountUsd: 50, dueDate: null });
        expect(paid).toEqual({ paymentMethod: 'efectivo_usd', currencyMode: 'USD', retiraCaja: false });
    });

    it('sin activarlo conserva el vencimiento y no manda datos de pago', async () => {
        const inputs = () => [...container.querySelectorAll('input')];
        await setInput(inputs().find(i => i.type === 'text'), 'F-101');
        await setInput(inputs().find(i => i.type === 'number'), '20');
        await act(async () => [...container.querySelectorAll('button')].find(b => b.textContent === '7 días').click());

        await act(async () => container.querySelector('form').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })));

        const [invoice, paid] = onSave.mock.calls[0];
        expect(invoice.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(paid).toBeNull();
    });
});
