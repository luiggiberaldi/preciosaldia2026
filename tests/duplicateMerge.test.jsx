import React from 'react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, act } from '@testing-library/react';
import {
    findDuplicateGroups,
    buildMergedProduct,
    suggestPrimaryId,
    groupSignature,
} from '../src/utils/duplicateMerge';
import DuplicateMergeModal from '../src/components/Products/DuplicateMergeModal';

vi.mock('../src/components/SmartImage', () => ({
    default: ({ alt }) => <div data-testid="smart-img">{alt}</div>,
}));

afterEach(cleanup);

describe('duplicateMerge (motor)', () => {
    it('agrupa códigos compartidos (principal y alternos) y nombres parecidos sin repetir grupos', () => {
        const products = [
            { id: '1', name: 'Harina P.A.N. 1 Kg', barcode: '7591', stock: 5, priceUsd: 1.5 },
            { id: '2', name: 'harina pan 1kg', barcode: '', altBarcodes: ['7591'], stock: 3, priceUsd: 1.5 },
            { id: '3', name: 'Arroz Mary 1 Kg', barcode: '111', stock: 2, priceUsd: 1.2 },
            { id: '4', name: 'arroz mary 1kg', barcode: '222', stock: 4, priceUsd: 1.2 },
            { id: '5', name: 'Café Madrid', barcode: '333', stock: 1, priceUsd: 3.0 },
        ];
        const res = findDuplicateGroups(products);
        expect(res.barcodeGroups).toHaveLength(1);
        expect(res.barcodeGroups[0].products.map((p) => p.id)).toEqual(['1', '2']);
        // 1 y 2 ya están juntos en barcodeGroups, así que NO se repiten en nameGroups
        expect(res.nameGroups).toHaveLength(1);
        expect(res.nameGroups[0].products.map((p) => p.id)).toEqual(['3', '4']);
    });

    it('ignora grupos de nombre descartados pero mantiene los de código repetido', () => {
        const products = [
            { id: '1', name: 'A', barcode: '7591' },
            { id: '2', name: 'A', barcode: '7591' },
            { id: '3', name: 'Arroz', barcode: '111' },
            { id: '4', name: 'arroz', barcode: '222' },
        ];
        const sigCode = groupSignature([products[0], products[1]]);
        const sigName = groupSignature([products[2], products[3]]);
        const res = findDuplicateGroups(products, { ignoredSignatures: [sigCode, sigName] });
        expect(res.barcodeGroups).toHaveLength(1);
        expect(res.nameGroups).toHaveLength(0);
        expect(res.ignoredGroups).toHaveLength(1);
    });

    it('suggestPrimaryId elige el artículo más completo y con stock', () => {
        const id = suggestPrimaryId([
            { id: 'empty', name: 'Harina', stock: 0, priceUsd: 0 },
            { id: 'full', name: 'Harina PAN', stock: 10, priceUsd: 1.5, costUsd: 1.0, barcode: '759' },
        ]);
        expect(id).toBe('full');
    });

    it('buildMergedProduct suma stock, conserva códigos alternos y rellena campos faltantes', () => {
        const keep = { id: '1', name: 'Harina PAN', barcode: '', stock: 5.25, priceUsd: 1.5, category: 'general' };
        const dup = {
            id: '2',
            name: 'harina pan',
            barcode: '7591',
            altBarcodes: ['7592'],
            stock: 2.5,
            costUsd: 1.1,
            image: 'https://img/harina.webp',
            category: 'alimentos',
        };
        const { merged, removeIds, stockDelta } = buildMergedProduct(keep, [dup], { sumStock: true });
        expect(removeIds).toEqual(['2']);
        expect(merged.stock).toBe(7.75);
        expect(stockDelta).toBe(2.5);
        expect(merged.barcode).toBe('7591');
        expect(merged.altBarcodes).toEqual(['7592']);
        expect(merged.costUsd).toBe(1.1);
        expect(merged.image).toBe('https://img/harina.webp');
        expect(merged.category).toBe('alimentos');
    });

    it('buildMergedProduct respeta sumStock=false y actualiza stockInLotes si aplica', () => {
        const keep = {
            id: '1',
            name: 'Refresco',
            barcode: '111',
            packagingType: 'lote',
            unitsPerPackage: 6,
            stockInLotes: 2,
            stock: 12,
        };
        const dup = { id: '2', name: 'Refresco', barcode: '222', stock: 12 };
        const mergedSum = buildMergedProduct(keep, [dup], { sumStock: true });
        expect(mergedSum.merged.stock).toBe(24);
        expect(mergedSum.merged.stockInLotes).toBe(4);

        const mergedNoSum = buildMergedProduct(keep, [dup], { sumStock: false });
        expect(mergedNoSum.merged.stock).toBe(12);
        expect(mergedNoSum.stockDelta).toBe(0);
    });
});

describe('DuplicateMergeModal (UI)', () => {
    it('permite elegir principal, cambiar suma de stock y disparar la fusión o descartar nombre', async () => {
        const products = [
            { id: '1', name: 'Harina PAN', barcode: '7591', stock: 5, priceUsd: 1.5 },
            { id: '2', name: 'Harina PAN copia', barcode: '7591', stock: 3, priceUsd: 1.5 },
            { id: '3', name: 'Aceite Mazeite', barcode: '111', stock: 4, priceUsd: 3.0 },
            { id: '4', name: 'aceite mazeite', barcode: '222', stock: 0, priceUsd: 3.0 },
        ];
        const onMergeGroup = vi.fn();
        const onIgnoreGroup = vi.fn();
        render(
            <DuplicateMergeModal
                isOpen
                onClose={() => {}}
                products={products}
                onMergeGroup={onMergeGroup}
                onIgnoreGroup={onIgnoreGroup}
            />,
        );

        // Cambiar el principal en el grupo de código al id '2'
        fireEvent.click(screen.getByLabelText('Conservar Harina PAN copia'));
        await act(async () => {
            fireEvent.click(screen.getByTestId('merge-btn-code:7591'));
        });
        expect(onMergeGroup).toHaveBeenCalledWith('2', ['1'], expect.objectContaining({ sumStock: true }));

        // En grupo de nombre, marcar como artículos distintos
        fireEvent.click(screen.getByText('Son artículos distintos'));
        expect(onIgnoreGroup).toHaveBeenCalledWith('3|4');
    });
});
