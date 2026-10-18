// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

// SmartImage toca IndexedDB/fetch de imágenes: se aísla para probar solo los modos.
vi.mock('../src/components/SmartImage', () => ({
    default: () => null,
}));

import SearchBar from '../src/components/Sales/SearchBar';
import CategoryBar from '../src/components/Sales/CategoryBar';

const product = (id, name, extra = {}) => ({
    id,
    name,
    category: 'Viveres',
    stock: 5,
    minStock: 1,
    priceUsdt: 1,
    priceUsd: 1,
    ...extra,
});

const baseSearchProps = {
    searchTerm: 'arroz',
    onSearchChange: vi.fn(),
    onKeyDown: vi.fn(),
    searchResults: [product('p1', 'Arroz Mary 1kg')],
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
};

const baseCategoryProps = (overrides = {}) => ({
    selectedCategory: 'todos',
    setSelectedCategory: vi.fn(),
    filteredByCategory: [
        product('p1', 'Azúcar Refinada 1kg'),
        product('p2', 'Arroz Mary 1kg'),
    ],
    products: [
        product('p1', 'Azúcar Refinada 1kg'),
        product('p2', 'Arroz Mary 1kg'),
    ],
    addToCart: vi.fn(),
    searchTerm: 'azucar',
    deferredSearchTerm: 'azucar',
    posSearchViewMode: 'hybrid',
    categories: [],
    ...overrides,
});

describe('Modos de vista del buscador (híbrido / lista / galería)', () => {
    it('SearchBar ofrece los 3 modos y notifica el cambio', () => {
        const onViewModeChange = vi.fn();
        render(<SearchBar {...baseSearchProps} posSearchViewMode="hybrid" onViewModeChange={onViewModeChange} />);

        fireEvent.click(screen.getByTitle('Modo Lista: Desplegable ultra-rápido para teclado'));
        fireEvent.click(screen.getByTitle('Modo Galería: Cuadrícula visual para pantalla táctil'));
        fireEvent.click(screen.getByTitle('Modo Híbrido: Desplegable rápido + Cuadrícula táctil'));

        expect(onViewModeChange).toHaveBeenNthCalledWith(1, 'list');
        expect(onViewModeChange).toHaveBeenNthCalledWith(2, 'grid');
        expect(onViewModeChange).toHaveBeenNthCalledWith(3, 'hybrid');
    });

    it('en modo galería el desplegable NO renderiza aunque haya resultados', () => {
        render(<SearchBar {...baseSearchProps} posSearchViewMode="grid" onViewModeChange={vi.fn()} />);
        expect(screen.queryByText('Arroz Mary 1kg')).toBeNull();
    });

    it('en modo híbrido y lista el desplegable renderiza los resultados', () => {
        const { unmount } = render(<SearchBar {...baseSearchProps} posSearchViewMode="hybrid" onViewModeChange={vi.fn()} />);
        expect(screen.getAllByText('Arroz Mary 1kg').length).toBeGreaterThanOrEqual(1);
        unmount();

        render(<SearchBar {...baseSearchProps} posSearchViewMode="list" onViewModeChange={vi.fn()} />);
        expect(screen.getAllByText('Arroz Mary 1kg').length).toBeGreaterThanOrEqual(1);
    });
});

describe('Filtro unificado grid/desplegable (mismo motor matchesSearch)', () => {
    it('modo híbrido: el grid se filtra en vivo ignorando tildes y mayúsculas', () => {
        render(<CategoryBar {...baseCategoryProps({ posSearchViewMode: 'hybrid', searchTerm: 'AZUCAR', deferredSearchTerm: 'AZUCAR' })} />);

        // 'AZUCAR' coincide con 'Azúcar Refinada 1kg' (misma normalización que el desplegable)
        expect(screen.getAllByText('Azúcar Refinada 1kg').length).toBeGreaterThanOrEqual(1);
        expect(screen.queryByText('Arroz Mary 1kg')).toBeNull();
    });

    it('modo híbrido: cada palabra de la consulta debe coincidir (multi-palabra)', () => {
        const both = render(<CategoryBar {...baseCategoryProps({ posSearchViewMode: 'hybrid', searchTerm: 'refinada azucar', deferredSearchTerm: 'refinada azucar' })} />);
        expect(within(both.container).getAllByText('Azúcar Refinada 1kg').length).toBeGreaterThanOrEqual(1);
        both.unmount();

        const none = render(<CategoryBar {...baseCategoryProps({ posSearchViewMode: 'hybrid', searchTerm: 'azucar maiz', deferredSearchTerm: 'azucar maiz' })} />);
        expect(within(none.container).queryByText('Azúcar Refinada 1kg')).toBeNull();
        expect(within(none.container).getAllByText('Sin coincidencias para tu búsqueda').length).toBeGreaterThanOrEqual(1);
    });

    it('modo lista: el grid se oculta mientras se busca (solo desplegable)', () => {
        render(<CategoryBar {...baseCategoryProps({ posSearchViewMode: 'list' })} />);
        expect(screen.queryByText('Azúcar Refinada 1kg')).toBeNull();
        expect(screen.queryByText('Arroz Mary 1kg')).toBeNull();
    });

    it('modo galería: el grid queda visible y filtrado', () => {
        render(<CategoryBar {...baseCategoryProps({ posSearchViewMode: 'grid' })} />);
        expect(screen.getAllByText('Azúcar Refinada 1kg').length).toBeGreaterThanOrEqual(1);
        expect(screen.queryByText('Arroz Mary 1kg')).toBeNull();
    });

    it('sin término de búsqueda muestra el catálogo completo en todos los modos', () => {
        const { unmount } = render(<CategoryBar {...baseCategoryProps({ searchTerm: '', deferredSearchTerm: '' })} />);
        expect(screen.getAllByText('Azúcar Refinada 1kg').length).toBeGreaterThanOrEqual(1);
        expect(screen.getAllByText('Arroz Mary 1kg').length).toBeGreaterThanOrEqual(1);
        unmount();

        render(<CategoryBar {...baseCategoryProps({ posSearchViewMode: 'list', searchTerm: '', deferredSearchTerm: '' })} />);
        expect(screen.getAllByText('Arroz Mary 1kg').length).toBeGreaterThanOrEqual(1);
    });
});
