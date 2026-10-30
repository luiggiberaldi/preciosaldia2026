// @vitest-environment jsdom
// Pestaña «Compras»: cargar, corregir y borrar compras; el supervisor solo lee.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ReportsPurchasesTab from '../src/components/Reports/ReportsPurchasesTab';
import { getLocalISODate } from '../src/utils/dateHelpers';

const today = getLocalISODate(new Date());
const PURCHASE = { id: 'p1', date: today, supplier: 'Distribuidora Polar', amountUsd: 50.65, currency: 'USD', rate: 40, createdAt: 'x', updatedAt: 'x' };

let container;
let root;

beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});

afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
});

const render = (props) => act(async () => root.render(
    <ReportsPurchasesTab from={today} to={today} rate={40} salesUsd={100} onSave={vi.fn()} onDelete={vi.fn()} {...props} />,
));
const input = (label) => container.querySelector(`[aria-label="${label}"]`);
const type = (element, value) => {
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
    setter.call(element, value);
    element.dispatchEvent(new Event('input', { bubbles: true }));
};
const button = (text) => [...container.querySelectorAll('button')].find((b) => (b.getAttribute('aria-label') || b.textContent).includes(text));

describe('ReportsPurchasesTab', () => {
    it('agrega una compra en $ y limpia el formulario', async () => {
        const onSave = vi.fn(async () => {});
        await render({ onSave });
        await act(async () => { type(input('Proveedor'), 'Colorantes'); type(input('Monto'), '37'); });
        await act(async () => { container.querySelector('[data-testid="purchase-form"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
        expect(onSave).toHaveBeenCalledTimes(1);
        const [purchase, meta] = onSave.mock.calls[0];
        expect(purchase).toMatchObject({ date: today, supplier: 'Colorantes', amountUsd: 37, currency: 'USD', rate: 40 });
        expect(meta).toEqual({ isEdit: false });
        expect(input('Proveedor').value).toBe('');
    });

    it('en Bs convierte con la tasa; sin datos muestra el error', async () => {
        const onSave = vi.fn(async () => {});
        await render({ onSave });
        await act(async () => { container.querySelector('[data-testid="purchase-form"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
        expect(container.querySelector('[role="alert"]').textContent).toContain('proveedor');
        await act(async () => { type(input('Proveedor'), 'Repo Plast'); type(input('Monto'), '1280'); button('Bs').click(); });
        await act(async () => { container.querySelector('[data-testid="purchase-form"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
        expect(onSave.mock.calls[0][0]).toMatchObject({ amountUsd: 32, amountBs: 1280, currency: 'BS' });
    });

    it('muestra el total y permite corregir y borrar', async () => {
        const onSave = vi.fn(async () => {});
        const onDelete = vi.fn(async () => {});
        await render({ purchases: [PURCHASE], onSave, onDelete });
        expect(container.querySelector('[data-testid="purchases-total"]').textContent).toBe('$50.65');

        await act(async () => button('Corregir compra de Distribuidora Polar').click());
        expect(input('Proveedor').value).toBe('Distribuidora Polar');
        await act(async () => { type(input('Monto'), '60'); });
        await act(async () => { container.querySelector('[data-testid="purchase-form"]').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
        expect(onSave.mock.calls[0][0]).toMatchObject({ id: 'p1', amountUsd: 60 });
        expect(onSave.mock.calls[0][1]).toEqual({ isEdit: true });

        await act(async () => button('Borrar compra de Distribuidora Polar').click());
        await act(async () => button('Sí, borrar').click());
        expect(onDelete).toHaveBeenCalledWith(PURCHASE);
    });

    it('modo supervisor: solo lectura, sin formulario ni botones de corregir', async () => {
        await render({ purchases: [PURCHASE], readOnly: true, salesUsd: null });
        expect(container.querySelector('[data-testid="purchase-form"]')).toBeNull();
        expect(button('Corregir compra')).toBeUndefined();
        expect(container.textContent).not.toContain('Ventas del período');
        expect(container.textContent).toContain('Distribuidora Polar');
    });
});
