import { describe, it, expect, beforeEach } from 'vitest';
import { bumpHot, readHotCounts, sortByHot, topHotProducts } from '../src/utils/hotProducts';

const P = [
    { id: 'a', name: 'A', stock: 5 },
    { id: 'b', name: 'B', stock: 5 },
    { id: 'c', name: 'C', stock: 0 },
];

describe('más vendidos', () => {
    beforeEach(() => localStorage.removeItem('pos_hot_counts'));
    it('sin ventas conserva el orden', () => expect(sortByHot(P).map(p => p.id)).toEqual(['a', 'b', 'c']));
    it('los más agregados van primero', () => {
        bumpHot('b'); bumpHot('b'); bumpHot('c');
        expect(readHotCounts()).toEqual({ b: 2, c: 1 });
        expect(sortByHot(P).map(p => p.id)).toEqual(['b', 'c', 'a']);
    });
    it('frecuentes: solo con ventas y con stock', () => {
        bumpHot('b'); bumpHot('c');
        expect(topHotProducts(P).map(p => p.id)).toEqual(['b']);
    });
    it('sin ventas no hay frecuentes', () => expect(topHotProducts(P)).toEqual([]));
});
