import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import BarcodeDuplicateHint from '../src/components/Products/BarcodeDuplicateHint';
import SimilarNameHint from '../src/components/Products/SimilarNameHint';
import DuplicateNameConfirm from '../src/components/Products/DuplicateNameConfirm';

vi.mock('../src/context/ProductContext', () => ({
    useProductContext: () => ({ products: [] }),
}));

vi.mock('../src/components/SmartImage', () => ({
    default: ({ alt }) => <img alt={alt} data-testid="smart-img" />,
}));

afterEach(cleanup);

const products = [
    { id: '1', name: 'Harina P.A.N. 1 Kg', barcode: '7591111222233' },
    { id: '2', name: 'Harina PAN Dulce', barcode: '7591111222244' },
];

describe('BarcodeDuplicateHint', () => {
    it('muestra aviso en vivo cuando el código pertenece a otro producto', () => {
        render(<BarcodeDuplicateHint barcode="7591111222233" products={products} />);
        expect(screen.getByTestId('barcode-duplicate-hint').textContent).toContain('Harina P.A.N. 1 Kg');
    });

    it('no muestra aviso si el código pertenece al producto en edición', () => {
        render(<BarcodeDuplicateHint barcode="7591111222233" exceptId="1" products={products} />);
        expect(screen.queryByTestId('barcode-duplicate-hint')).toBeNull();
    });
});

describe('SimilarNameHint', () => {
    it('avisa cuando hay un nombre exacto o parecido', () => {
        render(<SimilarNameHint name="harina pan 1kg" products={products} />);
        expect(screen.getByTestId('similar-name-hint').textContent).toContain('Ya existe «Harina P.A.N. 1 Kg»');
    });

    it('avisa nombres parecidos sin bloquear y respeta exceptId', () => {
        render(<SimilarNameHint name="Harina Pan" exceptId="2" products={products} />);
        const hint = screen.getByTestId('similar-name-hint').textContent;
        expect(hint).toContain('Harina P.A.N. 1 Kg');
        expect(hint).not.toContain('Harina PAN Dulce');
    });
});

describe('DuplicateNameConfirm', () => {
    it('muestra la ficha del artículo existente y dispara sus acciones', () => {
        const onCancel = vi.fn();
        const onViewExisting = vi.fn();
        const onConfirm = vi.fn();
        render(
            <DuplicateNameConfirm
                owner={{ id: '1', name: 'Harina P.A.N. 1 Kg', barcode: '7591111222233', priceUsd: 1.5, stock: 8 }}
                onCancel={onCancel}
                onViewExisting={onViewExisting}
                onConfirm={onConfirm}
            />,
        );
        expect(screen.getByText('Harina P.A.N. 1 Kg')).toBeTruthy();
        expect(screen.getByText(/7591111222233/)).toBeTruthy();
        expect(screen.getByText(/Stock: 8/)).toBeTruthy();
        fireEvent.click(screen.getByText('Abrir el existente'));
        expect(onViewExisting).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByText('Corregir nombre'));
        expect(onCancel).toHaveBeenCalledTimes(1);
        fireEvent.click(screen.getByText('Crear otro igual'));
        expect(onConfirm).toHaveBeenCalledTimes(1);
    });
});
