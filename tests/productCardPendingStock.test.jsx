// @vitest-environment jsdom
/**
 * Inventario: el − / + de la tarjeta acumula un cambio pendiente; solo «Confirmar»
 * guarda, una sola vez y con la diferencia.
 */
import React from 'react';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/components/SmartImage', () => ({ default: () => null }));
const toast = vi.fn();
vi.mock('../src/components/Toast', () => ({ showToast: (...a) => toast(...a) }));

import ProductCard from '../src/components/Products/ProductCard';

const base = { id: 'p1', name: 'Harina', priceUsdt: 1, stock: 14, unit: 'unidad', category: 'otros' };

function renderCard(props = {}) {
    const onAdjustStock = props.onAdjustStock || vi.fn(async () => {});
    const utils = render(
        <ProductCard product={{ ...base, ...(props.product || {}) }} effectiveRate={40} streetRate={0} categories={[]}
            onAdjustStock={onAdjustStock} onSetDirectStock={vi.fn()} onEdit={vi.fn()} onDelete={vi.fn()} onPrint={vi.fn()} />,
    );
    return { ...utils, onAdjustStock };
}
const plus = () => fireEvent.click(screen.getByLabelText(/Sumar 1/));
const minus = () => fireEvent.click(screen.getByLabelText(/Restar 1/));
const pending = () => screen.queryByTestId('stock-pending');

describe('ProductCard · cambio de stock pendiente', () => {
    beforeEach(() => { localStorage.clear(); toast.mockClear(); });
    afterEach(() => cleanup());

    it('los toques se acumulan sin guardar y muestran «14 → 19 (+5)»', () => {
        const { onAdjustStock } = renderCard();
        for (let i = 0; i < 5; i++) plus();
        expect(onAdjustStock).not.toHaveBeenCalled();
        expect(pending().textContent).toContain('14 → 19 (+5)');
        minus(); minus();
        expect(pending().textContent).toContain('14 → 17 (+3)');
    });

    it('cancelar descarta el cambio sin guardar', () => {
        const { onAdjustStock } = renderCard();
        plus(); plus();
        fireEvent.click(screen.getByText('Cancelar'));
        expect(pending()).toBeNull();
        expect(onAdjustStock).not.toHaveBeenCalled();
    });

    it('confirmar guarda UNA vez con la diferencia', async () => {
        const { onAdjustStock } = renderCard();
        for (let i = 0; i < 5; i++) plus();
        await act(async () => { fireEvent.click(screen.getByText('Confirmar')); });
        expect(onAdjustStock).toHaveBeenCalledTimes(1);
        expect(onAdjustStock).toHaveBeenCalledWith('p1', 5);
        expect(pending()).toBeNull();
    });

    it('volver a 0 oculta el cambio pendiente', () => {
        renderCard();
        plus(); minus();
        expect(pending()).toBeNull();
    });

    it('sin stock negativo no baja de 0', () => {
        renderCard({ product: { stock: 1 } });
        minus(); minus(); minus();
        expect(pending().textContent).toContain('1 → 0 (-1)');
    });

    it('granel respeta adjustStockValue (sin drift)', async () => {
        const { onAdjustStock } = renderCard({ product: { stock: 2.3, unit: 'kg' } });
        plus(); plus(); minus();
        expect(pending().textContent).toContain('2.3 → 3.3 (+1)');
        await act(async () => { fireEvent.click(screen.getByText('Confirmar')); });
        expect(onAdjustStock).toHaveBeenCalledWith('p1', 1);
    });

    it('salir de la pantalla con un cambio pendiente lo descarta y avisa', () => {
        const { onAdjustStock, unmount } = renderCard();
        plus();
        unmount();
        expect(onAdjustStock).not.toHaveBeenCalled();
        expect(toast).toHaveBeenCalledWith(expect.stringMatching(/descartó el cambio de stock/), 'warning');
    });

    it('salir sin cambio pendiente no avisa', () => {
        const { unmount } = renderCard();
        unmount();
        expect(toast).not.toHaveBeenCalled();
    });
});
