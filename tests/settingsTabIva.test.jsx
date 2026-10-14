import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import SettingsTabVentas from '../src/components/Settings/tabs/SettingsTabVentas';
import { loadTaxConfig, saveTaxConfig } from '../src/config/taxConfig';

vi.mock('../src/components/Settings/PaymentMethodsManager', () => ({
    default: () => <div>Mock Payment Methods</div>,
}));
vi.mock('../src/components/Settings/PrinterHardwareManager', () => ({
    default: () => <div>Mock Printer Hardware</div>,
}));
vi.mock('../src/components/CasheaIcon', () => ({
    default: () => <span>CasheaIcon</span>,
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

describe('Ajustes → Ventas → Terminal: tarjeta IVA', () => {
    let container;
    let root;

    const props = {
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

    const render = async () => {
        await act(async () => {
            root.render(<SettingsTabVentas {...props} />);
        });
    };

    const rateInput = () => container.querySelector('input[aria-label="Tasa de IVA en porcentaje"]');
    const toggle = () => container.querySelector('button[aria-label="Cobrar IVA"]');
    const restoreBtn = () =>
        [...container.querySelectorAll('button')].find((b) => b.textContent.includes('Restaurar 16%'));

    const typeInto = async (input, value) => {
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
        await act(async () => {
            setter.call(input, value);
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
    };

    it('muestra la tarjeta IVA con el valor de fábrica (desactivado, 16%)', async () => {
        await render();
        expect(container.textContent).toContain('Cobrar IVA');
        expect(rateInput().value).toBe('16');
        expect(toggle().getAttribute('aria-checked') ?? toggle().getAttribute('aria-pressed')).not.toBe('true');
    });

    it('el campo de tasa queda deshabilitado mientras el IVA está apagado', async () => {
        await render();
        expect(rateInput().disabled).toBe(true);
    });

    it('activar el toggle guarda ivaEnabled y habilita la tasa', async () => {
        await render();
        await act(async () => {
            toggle().click();
        });
        expect(loadTaxConfig().ivaEnabled).toBe(true);
        expect(rateInput().disabled).toBe(false);
        expect(props.showToast).toHaveBeenCalledWith('IVA activado', 'success');
    });

    it('cambiar la tasa a un valor válido lo guarda', async () => {
        saveTaxConfig({ ivaEnabled: true, ivaRate: 16 });
        await render();
        await typeInto(rateInput(), '12');
        expect(loadTaxConfig().ivaRate).toBe(12);
    });

    it('un valor fuera de rango no se guarda y vuelve al último válido al salir', async () => {
        saveTaxConfig({ ivaEnabled: true, ivaRate: 16 });
        await render();
        await typeInto(rateInput(), '150');
        expect(loadTaxConfig().ivaRate).toBe(16);
        await act(async () => {
            // React escucha focusout para onBlur (no el evento 'blur' nativo).
            rateInput().dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
        });
        expect(rateInput().value).toBe('16');
    });

    it('restaurar 16% deja la tasa de fábrica y el IVA apagado', async () => {
        saveTaxConfig({ ivaEnabled: true, ivaRate: 7 });
        await render();
        await act(async () => {
            restoreBtn().click();
        });
        expect(loadTaxConfig()).toEqual({ ivaEnabled: false, ivaRate: 16 });
        expect(rateInput().value).toBe('16');
    });

    it('la tarjeta IVA aparece antes del bloque Ticket de Venta', async () => {
        await render();
        const text = container.textContent;
        expect(text.indexOf('Cobrar IVA')).toBeGreaterThan(-1);
        expect(text.indexOf('Cobrar IVA')).toBeLessThan(text.indexOf('Ticket de Venta'));
    });
});
