import { act } from 'react';
import { createElement, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { generateDailyClosePDF } = vi.hoisted(() => ({
    generateDailyClosePDF: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/utils/dailyCloseGenerator', () => ({ generateDailyClosePDF }));

import { useReportExport } from '../src/hooks/useReportExport';
import TermsOverlay from '../src/components/TermsOverlay';

describe('reporte PDF y primer uso', () => {
    let container;
    let root;

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        localStorage.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        generateDailyClosePDF.mockClear();
    });

    afterEach(async () => {
        if (root) {
            await act(async () => root.unmount());
        }
        container?.remove();
    });

    it('exporta el botón de reportes como PDF descargable, no como compartir/impresión', async () => {
        let exportPdf;
        function HookHarness() {
            const { handleExportPDF } = useReportExport({ triggerHaptic: vi.fn() });
            useEffect(() => { exportPdf = handleExportPDF; }, [handleExportPDF]);
            return null;
        }
        await act(async () => root.render(createElement(HookHarness)));
        await act(async () => exportPdf({
            salesForCashFlow: [],
            salesForStats: [],
            bcvRate: 0,
            paymentBreakdown: {},
            topProducts: [],
            totalUsd: 0,
            totalBs: 0,
            profit: 0,
            totalItems: 0,
        }));

        expect(generateDailyClosePDF).toHaveBeenCalledWith(expect.objectContaining({ action: 'download' }));
    });

    it('no vuelve a pedir términos ni datos del negocio a un equipo con licencia activa', async () => {
        await act(async () => {
            root.render(<TermsOverlay isLicenseLoading={false} isPremium isDemo={false} />);
        });

        expect(container.textContent).not.toContain('Términos y Condiciones');
        expect(container.textContent).not.toContain('Configuración del Negocio');
        expect(localStorage.getItem('pda_terms_accepted')).toBeNull();
    });

    it('mantiene el registro inicial para equipos nuevos sin licencia', async () => {
        await act(async () => {
            root.render(<TermsOverlay isLicenseLoading={false} isPremium={false} isDemo={false} />);
        });

        expect(container.textContent).toContain('Términos y Condiciones');
        expect(container.textContent).not.toContain('Configuración del Negocio');
    });
});
