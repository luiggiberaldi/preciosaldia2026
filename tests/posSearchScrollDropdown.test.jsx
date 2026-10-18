// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/components/SmartImage', () => ({
    default: () => null,
}));

import SearchBar from '../src/components/Sales/SearchBar';

const generateMockProducts = (count) => {
    return Array.from({ length: count }, (_, i) => ({
        id: `prod_${i + 1}`,
        name: `Producto de Prueba ${i + 1}`,
        category: 'Viveres',
        stock: 10,
        priceUsd: 1.5,
        priceUsdt: 1.5,
    }));
};

const baseProps = {
    searchTerm: 'producto',
    onSearchChange: vi.fn(),
    onKeyDown: vi.fn(),
    selectedIndex: 0,
    setSelectedIndex: vi.fn(),
    effectiveRate: 10,
    addToCart: vi.fn(),
    isRecording: false,
    isProcessingAudio: false,
    startRecording: vi.fn(),
    stopRecording: vi.fn(),
    hierarchyPending: null,
    setHierarchyPending: vi.fn(),
    weightPending: null,
    setWeightPending: vi.fn(),
    posSearchViewMode: 'hybrid',
    onViewModeChange: vi.fn(),
};

describe('SearchBar - Desplegable con scroll y más de 6 resultados', () => {
    it('renderiza más de 6 resultados con contenedor desplazable (overflow-y-auto)', () => {
        const products = generateMockProducts(12);

        const { container } = render(
            <SearchBar
                {...baseProps}
                searchResults={products}
                selectedIndex={0}
            />
        );

        // Verifica que todos los 12 productos están presentes en el DOM para poder scrollear
        expect(screen.getByText('Producto de Prueba 1')).toBeTruthy();
        expect(screen.getByText('Producto de Prueba 12')).toBeTruthy();

        // Verifica que el contenedor con scroll exista
        const scrollContainer = container.querySelector('[data-testid="search-results-scroll-container"]');
        expect(scrollContainer).toBeTruthy();
        expect(scrollContainer.className).toContain('overflow-y-auto');

        // Verifica que el pie muestre el contador total de coincidencias
        expect(screen.getByText(/12 coincidencias|12 resultados/i)).toBeTruthy();
    });

    it('soporta navegación y mantiene el elemento resaltado', () => {
        const products = generateMockProducts(8);

        const { container } = render(
            <SearchBar
                {...baseProps}
                searchResults={products}
                selectedIndex={4}
            />
        );

        const buttons = container.querySelectorAll('[data-testid="search-results-scroll-container"] button');
        expect(buttons.length).toBe(8);
        // El 5to elemento (índice 4) debe tener la clase de selección
        expect(buttons[4].className).toContain('border-l-emerald-500');
    });
});
