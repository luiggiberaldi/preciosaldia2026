import { readFileSync } from 'node:fs';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import ProductFormQuick from '../src/components/Products/ProductFormQuick';

vi.mock('../src/context/ProductContext', () => ({
    useProductContext: () => ({ granelUnitMode: 'gr_ml', setGranelUnitMode: vi.fn() }),
}));

describe('cableado del IVA por producto', () => {
    let container;
    let root;

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        container?.remove();
    });

    it('el botón Exento llama al setter con exento', async () => {
        const setIvaMode = vi.fn();
        const noop = () => {};
        const props = {
            setIvaMode, ivaMode: '', packagingType: 'suelto', granelUnit: 'kg',
            stockInLotes: '', unitsPerPackage: '', categories: [], category: 'otros',
            setCategory: noop, setPackagingType: noop, setGranelUnit: noop,
            setUnitsPerPackage: noop, setStockInLotes: noop, setStock: noop,
            setName: noop, setBarcode: noop, setPriceUsd: noop, setPriceBs: noop,
            handleCostUsdChange: noop, handleCostBsChange: noop, handleCostFactorChange: noop,
            handlePriceUsdChange: noop, handlePriceBsChange: noop, handlePriceCopChange: noop,
            handleCostCopChange: noop, setSellByUnit: noop, setUnitPriceUsd: noop,
            setUnitPriceCop: noop, setLowStockAlert: noop, setStockInLotes2: noop,
            effectiveRate: 40, copEnabled: false, copPrimary: false, tasaCop: 0,
            isSearchingImage: false, imageMatches: [], image: null, setImage: noop,
            handleImageUpload: noop, handleLoadImageFromUrl: noop, handleAutoSearchImage: noop,
            isEditing: false, stock: '', name: '', barcode: '', priceUsd: '', priceBs: '',
            costUsd: '', costBs: '', costFactor: '', priceCop: '', costCop: '', lowStockAlert: '5',
            unitPriceUsd: '', unitPriceCop: '', sellByUnit: false, pricingMode: 'tasa_dia',
            priceBsUsdRef: '', granelMode: 'gr_ml', isFormShaking: false, productMovements: null,
        };
        await act(async () => root.render(<ProductFormQuick {...props} />));

        const exentoBtn = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Exento'));
        expect(exentoBtn).toBeTruthy();
        await act(async () => exentoBtn.click());
        expect(setIvaMode).toHaveBeenCalledWith('exento');
    });

    it('ProductsView pasa ivaMode al formulario y lo envía al guardar', () => {
        const src = readFileSync('src/views/ProductsView.jsx', 'utf8');
        expect(src).toMatch(/ivaMode=\{ivaMode\}\s+setIvaMode=\{setIvaMode\}/);
        expect(src).toMatch(/lowStockAlert,\s*ivaMode,/);
    });
});
