// @vitest-environment jsdom
import React from 'react';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import SupervisorInventoryCatalog from '../src/components/Monitor/SupervisorInventoryCatalog';

const mockProducts = [
    {
        id: 'prod-1',
        name: 'Harina PAN 1kg',
        barcode: '7591001',
        category: 'Viveres',
        stock: 12,
        minStock: 5,
        costPrice: 0.90,
        priceUsd: 1.20,
    },
    {
        id: 'prod-2',
        name: 'Arroz Mary 1kg',
        barcode: '7591002',
        category: 'Granos',
        stock: 3,
        minStock: 5,
        costPrice: 0.80,
        priceUsd: 1.10,
    },
    {
        id: 'prod-3',
        name: 'Aceite Mazeite 1L',
        barcode: '7591003',
        category: 'Aceites',
        stock: 0,
        minStock: 5,
        costPrice: 2.00,
        priceUsd: 2.80,
    },
];

describe('SupervisorInventoryCatalog Visual Component', () => {
    it('renderiza las fichas Bento con sus testids e indicadores cromáticos', () => {
        render(
            <SupervisorInventoryCatalog
                products={mockProducts}
                paginatedProducts={mockProducts}
                filteredProducts={mockProducts}
                bcvRate={50}
                inventoryMetrics={{
                    count: 3,
                    totalQty: 15,
                    totalCost: 13.20,
                    totalRetail: 17.70,
                    expectedProfit: 4.50,
                    lowStockCount: 1,
                    outOfStockCount: 1,
                }}
                remoteActionsAvailable={true}
                SUPERVISOR_REMOTE_MUTATIONS_ENABLED={true}
                SUPERVISOR_REMOTE_PRODUCTS_ENABLED={true}
                stockOpStatus={{}}
                believedStockOf={(p) => p.stock}
                formatBs={(val) => Number(val).toFixed(2)}
                toTitleCase={(str) => str}
            />
        );

        // Verifica existencia de tarjetas con data-testid
        expect(screen.getByTestId('supervisor-product-row-prod-1')).toBeDefined();
        expect(screen.getByTestId('supervisor-product-row-prod-2')).toBeDefined();
        expect(screen.getByTestId('supervisor-product-row-prod-3')).toBeDefined();

        // Verifica botones de acción remota requeridos por e2e
        const editButtons = screen.getAllByTitle('Editar Producto Remotamente');
        expect(editButtons.length).toBe(3);
        const deleteButtons = screen.getAllByTitle('Eliminar Producto Remotamente');
        expect(deleteButtons.length).toBe(3);
    });
});
