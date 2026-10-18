// @vitest-environment jsdom
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardCashControls from '../src/components/Dashboard/DashboardCashControls';

vi.mock('../src/components/Dashboard/TasaOficialCard', () => ({
    default: () => React.createElement('div', { 'data-testid': 'tasa-oficial-card' })
}));

describe('DashboardCashControls - Registrar Aporte direct trigger', () => {
    let container;
    let root;

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    it('calls onOpenAporte when Registrar Aporte is clicked', async () => {
        const onOpenAporte = vi.fn();
        const onGoVentas = vi.fn();
        const triggerHaptic = vi.fn();

        await act(async () => {
            root.render(
                <DashboardCashControls
                    isAdmin={true}
                    todayApertura={{ id: 'ap_1', montoTotalBs: 100 }}
                    onOpenGasto={vi.fn()}
                    onOpenAporte={onOpenAporte}
                    onGoVentas={onGoVentas}
                    triggerHaptic={triggerHaptic}
                />
            );
        });

        const buttons = Array.from(container.querySelectorAll('button'));
        const aporteBtn = buttons.find(b => b.textContent.includes('Registrar Aporte'));

        expect(aporteBtn).toBeTruthy();

        await act(async () => {
            aporteBtn.click();
        });

        expect(onOpenAporte).toHaveBeenCalledTimes(1);
        expect(onGoVentas).not.toHaveBeenCalled();
        expect(triggerHaptic).toHaveBeenCalledTimes(1);
    });

    it('falls back to onGoVentas if onOpenAporte is not provided', async () => {
        const onGoVentas = vi.fn();

        await act(async () => {
            root.render(
                <DashboardCashControls
                    isAdmin={true}
                    todayApertura={{ id: 'ap_1', montoTotalBs: 100 }}
                    onOpenGasto={vi.fn()}
                    onGoVentas={onGoVentas}
                />
            );
        });

        const buttons = Array.from(container.querySelectorAll('button'));
        const aporteBtn = buttons.find(b => b.textContent.includes('Registrar Aporte'));

        expect(aporteBtn).toBeTruthy();

        await act(async () => {
            aporteBtn.click();
        });

        expect(onGoVentas).toHaveBeenCalledTimes(1);
    });
});
