// CAJA-APERTURA-001: no se crea una segunda apertura si ya hay una caja abierta.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const store = vi.hoisted(() => ({ data: {} }));
vi.mock('../src/utils/storageService', () => ({
    storageService: {
        getItem: vi.fn((key, fallback) => Promise.resolve(store.data[key] ?? fallback)),
        setItem: vi.fn((key, value) => { store.data[key] = value; return Promise.resolve(); }),
    },
}));
const toast = vi.hoisted(() => vi.fn());
vi.mock('../src/components/Toast', () => ({ showToast: toast }));

import { useCheckoutFlow } from '../src/hooks/useCheckoutFlow';
import { SALES_KEY } from '../src/hooks/useSalesData';

function setup() {
    const setTodayAperturaData = vi.fn();
    const setIsAperturaOpen = vi.fn();
    const { result } = renderHook(() => useCheckoutFlow({
        cart: [], customers: [], products: [],
        setTodayAperturaData, setIsAperturaOpen,
    }));
    return { result, setTodayAperturaData, setIsAperturaOpen };
}

beforeEach(() => { store.data = {}; toast.mockClear(); });

describe('handleSaveApertura', () => {
    it('abre la caja cuando no hay ninguna abierta', async () => {
        const { result, setTodayAperturaData } = setup();
        await act(() => result.current.handleSaveApertura({ openingUsd: 20, openingBs: 500 }));
        const aperturas = store.data[SALES_KEY].filter(r => r.tipo === 'APERTURA_CAJA');
        expect(aperturas).toHaveLength(1);
        expect(aperturas[0].openingBs).toBe(500);
        expect(setTodayAperturaData).toHaveBeenCalledWith(aperturas[0]);
        expect(toast).toHaveBeenCalledWith('Caja abierta exitosamente', 'success');
    });

    it('si ya hay una caja abierta (otra pestaña) usa esa y no crea otra', async () => {
        const existente = { id: 'apertura_vieja', tipo: 'APERTURA_CAJA', openingUsd: 10, openingBs: 0, timestamp: '2026-11-13T10:00:00.000Z', cajaCerrada: false };
        store.data[SALES_KEY] = [existente];
        const { result, setTodayAperturaData, setIsAperturaOpen } = setup();

        await act(() => result.current.handleSaveApertura({ openingUsd: 50, openingBs: 900 }));

        expect(store.data[SALES_KEY]).toEqual([existente]);
        expect(setTodayAperturaData).toHaveBeenCalledWith(existente);
        expect(setIsAperturaOpen).toHaveBeenCalledWith(false);
        expect(toast).toHaveBeenCalledWith('La caja ya estaba abierta. Se usa la apertura existente.', 'info');
    });

    it('una caja ya cerrada no impide abrir otra', async () => {
        store.data[SALES_KEY] = [{ id: 'a0', tipo: 'APERTURA_CAJA', openingUsd: 5, timestamp: '2026-11-12T10:00:00.000Z', cajaCerrada: true }];
        const { result } = setup();
        await act(() => result.current.handleSaveApertura({ openingUsd: 20, openingBs: 0 }));
        expect(store.data[SALES_KEY].filter(r => r.tipo === 'APERTURA_CAJA')).toHaveLength(2);
    });
});
