import { describe, it, expect } from 'vitest';
import { findDuplicateCodeIndex } from '../src/utils/barcodeAssign';

describe('findDuplicateCodeIndex', () => {
    it('marca los artículos que comparten código principal', () => {
        const index = findDuplicateCodeIndex([
            { id: 'a', barcode: '7591234567890' },
            { id: 'b', barcode: ' 7591234567890 ' },
            { id: 'c', barcode: '7590000000001' },
        ]);
        expect([...index.keys()].sort()).toEqual(['a', 'b']);
        expect(index.get('a')).toBe('7591234567890');
    });

    it('cuenta códigos alternos y de blíster', () => {
        const index = findDuplicateCodeIndex([
            { id: 'a', barcode: '111', altBarcodes: ['222'] },
            { id: 'b', barcode: '222' },
            { id: 'c', barcode: '333', midPack: { barcode: '111' } },
        ]);
        expect(index.size).toBe(3);
    });

    it('un producto con el mismo código repetido en sí mismo no es duplicado', () => {
        const index = findDuplicateCodeIndex([{ id: 'a', barcode: '111', altBarcodes: ['111'] }]);
        expect(index.size).toBe(0);
    });

    it('ignora códigos vacíos y entradas inválidas', () => {
        const index = findDuplicateCodeIndex([{ id: 'a', barcode: '' }, { id: 'b', barcode: '  ' }, null, { barcode: '9' }]);
        expect(index.size).toBe(0);
    });
});
