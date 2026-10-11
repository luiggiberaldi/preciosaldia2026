import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import SettingsTabNegocio from '../src/components/Settings/tabs/SettingsTabNegocio';

// Mock de labelGenerator (usa jsPDF/canvas no disponible en jsdom)
vi.mock('../src/utils/labelGenerator', () => ({
    generarPreviewLabel: vi.fn().mockResolvedValue('blob:mock-preview-url'),
}));

describe('SettingsTabNegocio - Consolidación y Limpieza de Tarjeta Huérfana', () => {
    let container;
    let root;

    const mockProps = {
        businessName: 'Mi Bodega C.A.',
        setBusinessName: vi.fn(),
        businessRif: 'J-12345678',
        setBusinessRif: vi.fn(),
        businessPhone: '0412 123 4567',
        setBusinessPhone: vi.fn(),
        paperWidth: '58',
        labelCurrencyMode: 'bs',
        setLabelCurrencyMode: vi.fn(),
        labelOffsetNameX: '0', setLabelOffsetNameX: vi.fn(),
        labelOffsetNameY: '0', setLabelOffsetNameY: vi.fn(),
        labelOffsetPriceX: '0', setLabelOffsetPriceX: vi.fn(),
        labelOffsetPriceY: '0', setLabelOffsetPriceY: vi.fn(),
        labelOffsetSecPriceX: '0', setLabelOffsetSecPriceX: vi.fn(),
        labelOffsetSecPriceY: '0', setLabelOffsetSecPriceY: vi.fn(),
        labelOffsetFooterX: '0', setLabelOffsetFooterX: vi.fn(),
        labelOffsetFooterY: '0', setLabelOffsetFooterY: vi.fn(),
        labelOffsetFontName: '8', setLabelOffsetFontName: vi.fn(),
        labelOffsetFontPrice: '10', setLabelOffsetFontPrice: vi.fn(),
        labelOffsetFontSecPrice: '8', setLabelOffsetFontSecPrice: vi.fn(),
        labelOffsetFontFooter: '7', setLabelOffsetFontFooter: vi.fn(),
        copEnabled: false,
        setCopEnabled: vi.fn(),
        autoCopEnabled: false,
        setAutoCopEnabled: vi.fn(),
        tasaCopManual: '4150',
        setTasaCopManual: vi.fn(),
        copPrimary: false,
        setCopPrimary: vi.fn(),
        calculatedTasaCop: 0,
        effectiveRate: 79.5,
        handleSaveBusinessData: vi.fn(),
        forceHeartbeat: vi.fn(),
        showToast: vi.fn(),
        triggerHaptic: vi.fn(),
    };

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
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
        vi.clearAllMocks();
    });

    it('renderiza las secciones propias de la identidad del negocio', async () => {
        await act(async () => {
            root.render(<SettingsTabNegocio {...mockProps} />);
        });
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });

        expect(container.textContent).toContain('Mi Negocio');
        expect(container.textContent).toContain('Teléfono del Negocio');
        expect(container.textContent).toContain('Etiquetas de Productos');
        expect(container.textContent).toContain('Peso Colombiano (COP)');
    });

    it('NO debe renderizar la tarjeta redundante de Tamaño de Ticket (centralizada en Ventas > Ticketera)', async () => {
        await act(async () => {
            root.render(<SettingsTabNegocio {...mockProps} />);
        });
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });

        // La tarjeta duplicada no debe existir en Negocio
        expect(container.textContent).not.toContain('Tamaño de Ticket');
        expect(container.textContent).not.toContain('58 mm (Pequeña)');
        expect(container.textContent).not.toContain('80 mm (Estándar)');
    });

    it('el botón Guardar del negocio sigue funcionando perfectamente', async () => {
        await act(async () => {
            root.render(<SettingsTabNegocio {...mockProps} />);
        });
        await act(async () => { await new Promise(r => setTimeout(r, 0)); });

        const saveBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Guardar'));
        expect(saveBtn).toBeDefined();
        await act(async () => { saveBtn.click(); });
        expect(mockProps.handleSaveBusinessData).toHaveBeenCalledTimes(1);
    });
});
