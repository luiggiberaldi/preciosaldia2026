// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductCostFactorControl from '../src/components/Products/ProductCostFactorControl';
import ProductCard from '../src/components/Products/ProductCard';
import {
    getCostFactorMode,
    setCostFactorMode,
    COST_FACTOR_MODE_FACTOR,
    COST_FACTOR_MODE_KEY,
    COST_FACTOR_MODE_PERCENT,
} from '../src/utils/productCostFactor';

vi.mock('../src/components/SmartImage', () => ({ default: () => null }));

describe('preferencia persistida del modo Factor costo', () => {
    beforeEach(() => localStorage.clear());

    it('de fábrica es el modo porcentaje (margen)', () => {
        expect(getCostFactorMode()).toBe(COST_FACTOR_MODE_PERCENT);
    });

    it('recuerda el modo factor si el usuario lo elige', () => {
        expect(setCostFactorMode(COST_FACTOR_MODE_FACTOR)).toBe(COST_FACTOR_MODE_FACTOR);
        expect(localStorage.getItem(COST_FACTOR_MODE_KEY)).toBe(COST_FACTOR_MODE_FACTOR);
        expect(getCostFactorMode()).toBe(COST_FACTOR_MODE_FACTOR);
    });

    it('un valor corrupto en storage vuelve al modo porcentaje', () => {
        localStorage.setItem(COST_FACTOR_MODE_KEY, 'modo_invalido');
        expect(getCostFactorMode()).toBe(COST_FACTOR_MODE_PERCENT);
    });
});

describe('ProductCostFactorControl — modo de entrada', () => {
    beforeEach(() => localStorage.clear());
    afterEach(() => cleanup());

    it('de fábrica muestra el modo porcentaje (margen)', () => {
        render(<ProductCostFactorControl costFactor="0.6" onChange={() => {}} />);
        expect(screen.getByText(/Margen de ganancia en %/)).toBeTruthy();
        expect(screen.getByPlaceholderText('30')).toBeTruthy();
    });

    it('si el usuario cambia al toggle 0.7, se queda en 0.7 y persiste', () => {
        const { unmount } = render(<ProductCostFactorControl costFactor="0.6" onChange={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: '0.7' }));
        expect(screen.getByPlaceholderText('0.7')).toBeTruthy();
        expect(localStorage.getItem(COST_FACTOR_MODE_KEY)).toBe(COST_FACTOR_MODE_FACTOR);

        // Reabrir el formulario (remontar) conserva el modo elegido.
        unmount();
        render(<ProductCostFactorControl costFactor="0.6" onChange={() => {}} />);
        expect(screen.getByPlaceholderText('0.7')).toBeTruthy();
    });

    it('permite volver al modo porcentaje y también persiste', () => {
        const { unmount } = render(<ProductCostFactorControl costFactor="0.6" onChange={() => {}} />);
        fireEvent.click(screen.getByRole('button', { name: '0.7' }));
        fireEvent.click(screen.getByRole('button', { name: '%' }));
        expect(screen.getByPlaceholderText('30')).toBeTruthy();
        expect(getCostFactorMode()).toBe(COST_FACTOR_MODE_PERCENT);

        unmount();
        render(<ProductCostFactorControl costFactor="0.6" onChange={() => {}} />);
        expect(screen.getByPlaceholderText('30')).toBeTruthy();
    });
});

describe('ProductCard — insignia de margen', () => {
    const baseProps = {
        effectiveRate: 885,
        streetRate: 885,
        categories: [{ id: 'viveres', label: 'Viveres', icon: '◆', color: 'emerald' }],
        daysRemaining: 350,
    };

    beforeEach(() => localStorage.clear());
    afterEach(() => cleanup());

    it('muestra el margen sobre el precio (40% para costo $0.60 y precio $1.00)', () => {
        render(
            <ProductCard
                {...baseProps}
                product={{
                    id: 'p1',
                    name: 'Cigarro Capi Full Flavor',
                    category: 'viveres',
                    unit: 'unidad',
                    priceUsdt: 1,
                    costUsd: 0.6,
                    stock: 25,
                    minStock: 5,
                }}
            />
        );
        expect(screen.getByText('+40%')).toBeTruthy();
    });

    it('oculta la insignia cuando el producto no tiene costo', () => {
        render(
            <ProductCard
                {...baseProps}
                product={{
                    id: 'p2',
                    name: 'Producto sin costo',
                    category: 'viveres',
                    unit: 'unidad',
                    priceUsdt: 1,
                    stock: 10,
                    minStock: 5,
                }}
            />
        );
        expect(screen.queryByText(/[+-]\d+%/)).toBeNull();
    });
});
