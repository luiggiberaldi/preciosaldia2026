import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import SettingsTabVentas from '../src/components/Settings/tabs/SettingsTabVentas';

// Mocks de módulos pesados que interactúan con hardware / storage externo
vi.mock('../src/components/Settings/PaymentMethodsManager', () => ({
    default: () => <div data-testid="mock-payment-methods">Mock Payment Methods</div>,
}));

vi.mock('../src/components/Settings/PrinterHardwareManager', () => ({
    default: () => <div data-testid="mock-printer-hardware">Mock Printer Hardware</div>,
}));

vi.mock('../src/components/CasheaIcon', () => ({
    default: () => <span data-testid="mock-cashea-icon">CasheaIcon</span>,
}));

const mockContextState = {
    checkoutMode: 'auto',
    setCheckoutMode: vi.fn(),
    granelUnitMode: 'gr_ml',
    setGranelUnitMode: vi.fn(),
};

vi.mock('../src/context/ProductContext', () => ({
    useProductContext: () => mockContextState,
}));

describe('SettingsTabVentas - Sub-Pestañas Segmentadas', () => {
    let container;
    let root;

    const mockProps = {
        allowNegativeStock: false,
        setAllowNegativeStock: vi.fn(),
        forceHeartbeat: vi.fn(),
        showToast: vi.fn(),
        triggerHaptic: vi.fn(),
        paperWidth: '58',
        setPaperWidth: vi.fn(),
    };

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        localStorage.clear();
        vi.clearAllMocks();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        if (root) {
            await act(async () => {
                root.unmount();
            });
        }
        if (container && container.parentNode) {
            container.parentNode.removeChild(container);
        }
        localStorage.clear();
    });

    const renderComponent = async (props = {}) => {
        await act(async () => {
            root.render(<SettingsTabVentas {...mockProps} {...props} />);
        });
    };

    it('renderiza la barra de navegación con las 4 sub-pestañas', async () => {
        await renderComponent();
        const tablist = container.querySelector('[role="tablist"]');
        expect(tablist).not.toBeNull();

        const tabs = container.querySelectorAll('[role="tab"]');
        expect(tabs.length).toBe(4);

        const tabTexts = Array.from(tabs).map(t => t.textContent);
        expect(tabTexts.some(t => t.includes('Terminal & Cobro'))).toBe(true);
        expect(tabTexts.some(t => t.includes('Caja & Vuelto'))).toBe(true);
        expect(tabTexts.some(t => t.includes('Políticas & Crédito'))).toBe(true);
        expect(tabTexts.some(t => t.includes('Ticketera & Hardware'))).toBe(true);
    });

    it('por defecto abre en la sub-pestaña Terminal & Cobro', async () => {
        await renderComponent();
        // Debe mostrar Modo de Cobro, Ticket de Venta y Granel
        expect(container.textContent).toContain('Modo de Cobro (Interfaz)');
        expect(container.textContent).toContain('Ticket de Venta');
        expect(container.textContent).toContain('Unidad de Granel');

        // NO debe mostrar los otros paneles en la vista activa
        expect(container.querySelector('[data-testid="mock-payment-methods"]')).toBeNull();
        expect(container.querySelector('[data-testid="mock-printer-hardware"]')).toBeNull();
    });

    it('permite cambiar el modo de cobro y unidad de granel en Terminal & Cobro', async () => {
        await renderComponent();
        const buttons = container.querySelectorAll('button');

        // Buscar botón de Modo Móvil
        const btnMovil = Array.from(buttons).find(b => b.textContent.includes('Modo Móvil'));
        expect(btnMovil).toBeDefined();
        await act(async () => {
            btnMovil.click();
        });
        expect(mockContextState.setCheckoutMode).toHaveBeenCalledWith('basic');

        // Buscar botón de Kg / Litros
        const btnKg = Array.from(buttons).find(b => b.textContent.includes('Kg / Litros'));
        expect(btnKg).toBeDefined();
        await act(async () => {
            btnKg.click();
        });
        expect(mockContextState.setGranelUnitMode).toHaveBeenCalledWith('kg_lt');
    });

    it('permite cambiar la moneda del ticket y persiste en localStorage', async () => {
        await renderComponent();
        const buttons = container.querySelectorAll('button');
        const btnUsd = Array.from(buttons).find(b => b.textContent.includes('Dólares ($)'));
        expect(btnUsd).toBeDefined();

        await act(async () => {
            btnUsd.click();
        });
        expect(localStorage.getItem('receipt_currency_mode')).toBe('usd');
        expect(mockProps.showToast).toHaveBeenCalled();
    });

    it('permite cambiar a la sub-pestaña Caja & Vuelto y persiste en localStorage', async () => {
        await renderComponent();
        const tabs = container.querySelectorAll('[role="tab"]');
        const tabCaja = Array.from(tabs).find(t => t.textContent.includes('Caja & Vuelto'));
        expect(tabCaja).toBeDefined();

        await act(async () => {
            tabCaja.click();
        });

        expect(localStorage.getItem('settings_ventas_active_subtab')).toBe('caja');
        expect(container.textContent).toContain('Cómo entrega la caja el cambio');
        expect(container.querySelector('[data-testid="mock-payment-methods"]')).not.toBeNull();
    });

    it('permite cambiar a la sub-pestaña Políticas & Crédito y alternar vender sin stock', async () => {
        await renderComponent();
        const tabs = container.querySelectorAll('[role="tab"]');
        const tabPoliticas = Array.from(tabs).find(t => t.textContent.includes('Políticas & Crédito'));
        expect(tabPoliticas).toBeDefined();

        await act(async () => {
            tabPoliticas.click();
        });

        expect(localStorage.getItem('settings_ventas_active_subtab')).toBe('politicas');
        expect(container.textContent).toContain('Vender sin Stock');
        expect(container.textContent).toContain('Cashea');

        // Toggle vender sin stock
        const switches = container.querySelectorAll('button[role="switch"]');
        expect(switches.length).toBeGreaterThan(0);
        await act(async () => {
            switches[0].click();
        });
        expect(mockProps.setAllowNegativeStock).toHaveBeenCalledWith(true);
        expect(localStorage.getItem('allow_negative_stock')).toBe('true');
    });

    it('permite cambiar a la sub-pestaña Ticketera & Hardware', async () => {
        await renderComponent();
        const tabs = container.querySelectorAll('[role="tab"]');
        const tabTicketera = Array.from(tabs).find(t => t.textContent.includes('Ticketera & Hardware'));
        expect(tabTicketera).toBeDefined();

        await act(async () => {
            tabTicketera.click();
        });

        expect(localStorage.getItem('settings_ventas_active_subtab')).toBe('ticketera');
        expect(container.querySelector('[data-testid="mock-printer-hardware"]')).not.toBeNull();
    });

    it('respeta la preferencia guardada en localStorage al montar', async () => {
        localStorage.setItem('settings_ventas_active_subtab', 'ticketera');
        await renderComponent();

        expect(container.querySelector('[data-testid="mock-printer-hardware"]')).not.toBeNull();
    });
});
