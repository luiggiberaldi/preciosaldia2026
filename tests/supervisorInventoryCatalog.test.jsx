// @vitest-environment jsdom
import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
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
    {
        id: 'prod-4',
        name: 'Mantequilla Mavesa 500g',
        barcode: '7591004',
        category: 'Lacteos',
        stock: -2,
        minStock: 5,
        costPrice: 1.50,
        priceUsd: 2.00,
    },
];

const defaultProps = {
    products: mockProducts,
    paginatedProducts: mockProducts,
    filteredProducts: mockProducts,
    bcvRate: 50,
    inventoryMetrics: {
        count: 4,
        totalQty: 13,
        totalCost: 16.70,
        totalRetail: 21.70,
        expectedProfit: 5.00,
        lowStockCount: 1,
        outOfStockCount: 2,
    },
    remoteActionsAvailable: true,
    SUPERVISOR_REMOTE_MUTATIONS_ENABLED: true,
    SUPERVISOR_REMOTE_PRODUCTS_ENABLED: true,
    stockOpStatus: {},
    stockPendingConfirm: null,
    setStockPendingConfirm: vi.fn(),
    believedStockOf: (p) => p.stock,
    formatBs: (val) => Number(val).toFixed(2),
    formatStockValue: (p, val) => `${val} u`,
    toTitleCase: (str) => (str ? str.charAt(0).toUpperCase() + str.slice(1).toLowerCase() : ''),
    openStockEditor: vi.fn(),
    commitStockEdit: vi.fn(),
    stepStockEdit: vi.fn(),
    applyTargetStock: vi.fn(),
    setProductToEditRemote: vi.fn(),
    setProductToDeleteRemote: vi.fn(),
    clearStockOp: vi.fn(),
    stockEditProductId: null,
    setStockEditProductId: vi.fn(),
    stockEditValue: '',
    setStockEditValue: vi.fn(),
    triggerHaptic: vi.fn(),
    showToast: vi.fn(),
};

describe('SupervisorInventoryCatalog Visual Component', () => {
    it('renderiza las fichas Bento con sus testids e indicadores cromáticos para cada nivel de stock', () => {
        render(<SupervisorInventoryCatalog {...defaultProps} />);

        // 1. Verifica existencia de tarjetas con data-testid
        const row1 = screen.getByTestId('supervisor-product-row-prod-1');
        const row2 = screen.getByTestId('supervisor-product-row-prod-2');
        const row3 = screen.getByTestId('supervisor-product-row-prod-3');
        const row4 = screen.getByTestId('supervisor-product-row-prod-4');

        expect(row1).toBeDefined();
        expect(row2).toBeDefined();
        expect(row3).toBeDefined();
        expect(row4).toBeDefined();

        // 2. Indicadores cromáticos por nivel de stock
        // prod-1: Disponible (stock: 12 > minStock: 5) -> bg-emerald-500
        expect(within(row1).getAllByText('Disponible').length).toBeGreaterThanOrEqual(1);
        expect(row1.querySelector('.bg-emerald-500')).not.toBeNull();

        // prod-2: Bajo Stock (stock: 3 <= minStock: 5) -> bg-amber-500
        expect(within(row2).getAllByText('Bajo Stock').length).toBeGreaterThanOrEqual(1);
        expect(row2.querySelector('.bg-amber-500')).not.toBeNull();

        // prod-3: Agotado (stock: 0) -> bg-rose-500
        expect(within(row3).getAllByText('Agotado').length).toBeGreaterThanOrEqual(1);
        expect(row3.querySelector('.bg-rose-500')).not.toBeNull();

        // prod-4: Saldo Negativo (stock: -2 < 0) -> bg-rose-600
        expect(within(row4).getAllByText('Saldo Negativo').length).toBeGreaterThanOrEqual(1);
        expect(row4.querySelector('.bg-rose-600')).not.toBeNull();

        // 3. Verifica botones de acción remota requeridos por e2e
        const editButtons = screen.getAllByTitle('Editar Producto Remotamente');
        expect(editButtons.length).toBeGreaterThanOrEqual(4);
        const deleteButtons = screen.getAllByTitle('Eliminar Producto Remotamente');
        expect(deleteButtons.length).toBeGreaterThanOrEqual(4);
    });

    it('muestra el subpanel financiero con Costo, Venta USD/Bs y Margen de ganancia', () => {
        render(<SupervisorInventoryCatalog {...defaultProps} />);

        const row1 = screen.getByTestId('supervisor-product-row-prod-1');
        // Costo: $0.90
        expect(within(row1).getAllByText('$0.90').length).toBeGreaterThanOrEqual(1);
        // Venta: $1.20
        expect(within(row1).getAllByText('$1.20').length).toBeGreaterThanOrEqual(1);
        // Equivalencia en Bs: 1.20 * 50 = 60.00 Bs
        expect(within(row1).getAllByText('60.00 Bs').length).toBeGreaterThanOrEqual(1);
        // Margen: ganancia $0.30 y 25%
        expect(within(row1).getAllByText('$0.30').length).toBeGreaterThanOrEqual(1);
        expect(within(row1).getAllByText('25%').length).toBeGreaterThanOrEqual(1);
    });

    it('usa los campos canónicos priceUsdt/costUsd cuando el alias legacy diverge (regresión mayonesa)', () => {
        // FIN-030: priceUsd/costPrice son alias legacy. Si una escritura parcial deja
        // el alias desactualizado, el monitor debe mostrar el canónico — igual que la
        // caja (getUsd: priceUsdt ?? priceUsd). Antes del fix este caso mostraba $4.25.
        const divergent = [{
            id: 'prod-div',
            name: 'Mayonesa Kraft 445GR',
            category: 'General',
            stock: 7,
            minStock: 5,
            priceUsdt: 5.00,   // canónico — actualizado
            priceUsd: 4.25,    // alias legacy — sin actualizar
            costUsd: 2.00,     // canónico
            costPrice: 1.00,   // alias legacy
        }];
        render(<SupervisorInventoryCatalog {...defaultProps} products={divergent} paginatedProducts={divergent} filteredProducts={divergent} />);

        const row = screen.getByTestId('supervisor-product-row-prod-div');

        // Venta USD: el canónico $5.00, jamás el alias $4.25
        expect(within(row).getAllByText('$5.00').length).toBeGreaterThanOrEqual(1);
        expect(within(row).queryAllByText('$4.25').length).toBe(0);
        // Equivalencia Bs con el canónico: 5.00 * 50 = 250.00 Bs (nunca 212.50 del alias)
        expect(within(row).getAllByText('250.00 Bs').length).toBeGreaterThanOrEqual(1);
        expect(within(row).queryAllByText('212.50 Bs').length).toBe(0);
        // Costo canónico $2.00 (no el alias $1.00) y ganancia $3.00 / 60%
        expect(within(row).getAllByText('$2.00').length).toBeGreaterThanOrEqual(1);
        expect(within(row).queryAllByText('$1.00').length).toBe(0);
        expect(within(row).getAllByText('$3.00').length).toBeGreaterThanOrEqual(1);
        expect(within(row).getAllByText('60%').length).toBeGreaterThanOrEqual(1);
        // El nombre viaja en un solo campo (p.name) — sin alias posible
        expect(within(row).getAllByText('Mayonesa Kraft 445GR').length).toBeGreaterThanOrEqual(1);
    });

    it('los botones stepper llaman a stepStockEdit con +1 y -1', () => {
        const stepStockEditSpy = vi.fn();
        render(<SupervisorInventoryCatalog {...defaultProps} stepStockEdit={stepStockEditSpy} />);

        const row1 = screen.getByTestId('supervisor-product-row-prod-1');
        const plusButtons = within(row1).getAllByTitle('Subir stock en 1');
        const minusButtons = within(row1).getAllByTitle('Bajar stock en 1');

        expect(plusButtons.length).toBeGreaterThanOrEqual(1);
        expect(minusButtons.length).toBeGreaterThanOrEqual(1);

        fireEvent.click(plusButtons[0]);
        expect(stepStockEditSpy).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'prod-1' }),
            1
        );

        fireEvent.click(minusButtons[0]);
        expect(stepStockEditSpy).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'prod-1' }),
            -1
        );
    });

    it('muestra editor directo de stock inline cuando stockEditProductId coincide', () => {
        const commitStockEditSpy = vi.fn();
        const setStockEditProductIdSpy = vi.fn();
        const setStockEditValueSpy = vi.fn();

        render(
            <SupervisorInventoryCatalog
                {...defaultProps}
                stockEditProductId="prod-1"
                stockEditValue="15"
                commitStockEdit={commitStockEditSpy}
                setStockEditProductId={setStockEditProductIdSpy}
                setStockEditValue={setStockEditValueSpy}
            />
        );

        const row1 = screen.getByTestId('supervisor-product-row-prod-1');
        const inputs = within(row1).getAllByLabelText('Nuevo stock de Harina PAN 1kg');
        expect(inputs.length).toBeGreaterThanOrEqual(1);
        expect(inputs[0].value).toBe('15');

        // Confirmar edición
        const confirmButtons = within(row1).getAllByTitle('Confirmar nuevo stock');
        fireEvent.click(confirmButtons[0]);
        expect(commitStockEditSpy).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'prod-1' })
        );

        // Cancelar edición
        const cancelButtons = within(row1).getAllByTitle('Cancelar edición de stock');
        fireEvent.click(cancelButtons[0]);
        expect(setStockEditProductIdSpy).toHaveBeenCalledWith(null);
    });

    it('muestra el banner de confirmación cuando hay stockPendingConfirm para el producto', () => {
        const applyTargetStockSpy = vi.fn();
        const setStockPendingConfirmSpy = vi.fn();

        render(
            <SupervisorInventoryCatalog
                {...defaultProps}
                stockPendingConfirm={{ product: mockProducts[0], nextStock: 20 }}
                applyTargetStock={applyTargetStockSpy}
                setStockPendingConfirm={setStockPendingConfirmSpy}
            />
        );

        const row1 = screen.getByTestId('supervisor-product-row-prod-1');
        // Delta visible
        expect(within(row1).getByText(/12 u →/)).toBeDefined();
        expect(within(row1).getAllByText('20 u').length).toBeGreaterThanOrEqual(1);

        // Botón descartar
        const descartarBtn = within(row1).getByText('Descartar');
        fireEvent.click(descartarBtn);
        expect(setStockPendingConfirmSpy).toHaveBeenCalledWith(null);

        // Botón confirmar cambio
        const confirmarBtn = within(row1).getByText(/Confirmar cambio/);
        fireEvent.click(confirmarBtn);
        expect(applyTargetStockSpy).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'prod-1' }),
            20
        );
    });

    it('mantiene los botones stepper + y - visibles y funcionales cuando hay stockPendingConfirm sin ocultar los controles', () => {
        const stepStockEditSpy = vi.fn();
        const applyTargetStockSpy = vi.fn();

        render(
            <SupervisorInventoryCatalog
                {...defaultProps}
                stockPendingConfirm={{ product: mockProducts[0], nextStock: 13 }}
                stepStockEdit={stepStockEditSpy}
                applyTargetStock={applyTargetStockSpy}
            />
        );

        const row1 = screen.getByTestId('supervisor-product-row-prod-1');
        // Los botones stepper siguen presentes (no desaparecen)
        const plusButtons = within(row1).getAllByTitle('Subir stock en 1');
        const minusButtons = within(row1).getAllByTitle('Bajar stock en 1');
        expect(plusButtons.length).toBeGreaterThanOrEqual(1);
        expect(minusButtons.length).toBeGreaterThanOrEqual(1);

        // Permite seguir subiendo o bajando
        fireEvent.click(plusButtons[0]);
        expect(stepStockEditSpy).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'prod-1' }),
            1
        );

        // Muestra el valor actualizado
        expect(within(row1).getAllByText('13 u').length).toBeGreaterThanOrEqual(1);
    });

    it('muestra estados de stockOpStatus (sending, applied, pending, failed)', () => {
        const clearStockOpSpy = vi.fn();
        const applyTargetStockSpy = vi.fn();

        const { rerender } = render(
            <SupervisorInventoryCatalog
                {...defaultProps}
                stockOpStatus={{
                    'prod-1': { state: 'sending' },
                }}
            />
        );

        const row1 = screen.getByTestId('supervisor-product-row-prod-1');
        expect(within(row1).getByText(/Enviando cambio de stock…/)).toBeDefined();

        // State: applied
        rerender(
            <SupervisorInventoryCatalog
                {...defaultProps}
                clearStockOp={clearStockOpSpy}
                stockOpStatus={{
                    'prod-1': { state: 'applied' },
                }}
            />
        );
        expect(within(row1).getByText(/Stock actualizado en la caja/)).toBeDefined();
        const ocultarBtn = within(row1).getByText('Ocultar');
        fireEvent.click(ocultarBtn);
        expect(clearStockOpSpy).toHaveBeenCalledWith('prod-1');

        // State: pending
        rerender(
            <SupervisorInventoryCatalog
                {...defaultProps}
                stockOpStatus={{
                    'prod-1': { state: 'pending' },
                }}
            />
        );
        expect(
            within(row1).getByText(/La caja aún no confirma; revisa el stock en unos segundos/)
        ).toBeDefined();

        // State: failed
        rerender(
            <SupervisorInventoryCatalog
                {...defaultProps}
                clearStockOp={clearStockOpSpy}
                applyTargetStock={applyTargetStockSpy}
                stockOpStatus={{
                    'prod-1': { state: 'failed', error: 'Falla de red en caja', targetStock: 18 },
                }}
            />
        );
        expect(within(row1).getByText(/Falla de red en caja/)).toBeDefined();
        const reintentarBtn = within(row1).getByText('Reintentar');
        fireEvent.click(reintentarBtn);
        expect(applyTargetStockSpy).toHaveBeenCalledWith(
            expect.objectContaining({ id: 'prod-1' }),
            18
        );
        const descartarFailedBtn = within(row1).getByText('Descartar');
        fireEvent.click(descartarFailedBtn);
        expect(clearStockOpSpy).toHaveBeenCalledWith('prod-1');
    });

    it('renderiza la cápsula stepper móvil ergonómica con botón de stock central', () => {
        render(<SupervisorInventoryCatalog {...defaultProps} />);

        const row1 = screen.getByTestId('supervisor-product-row-prod-1');
        // En móvil hay un botón central de stock con el texto de stock formatStockValue
        const stockButtons = within(row1).getAllByTitle('Toca para escribir el stock exacto');
        expect(stockButtons.length).toBeGreaterThanOrEqual(2); // Desktop y Mobile
    });
});
