import { describe, it, expect } from 'vitest';
import { nameKey, findSimilarNameProduct, shouldCheckName } from '../src/utils/similarName';

const products = [
    { id: 'a', name: 'Harina P.A.N. 1 Kg' },
    { id: 'b', name: 'Acetaminofén', concentracion: '500 mg', presentacion: 'Tabletas' },
];

describe('similarName', () => {
    it('ignora mayúsculas, acentos, espacios y signos', () => {
        expect(nameKey('  Harina P.A.N. 1 Kg ')).toBe(nameKey('harina pan 1kg'));
        expect(nameKey('Acetaminofén')).toBe(nameKey('ACETAMINOFEN'));
    });

    it('encuentra el producto con nombre parecido', () => {
        expect(findSimilarNameProduct(products, { name: 'harina pan 1kg' })?.id).toBe('a');
        expect(findSimilarNameProduct(products, { name: 'Harina PAN 2kg' })).toBeNull();
    });

    it('no se compara consigo mismo ni con ids ignorados', () => {
        expect(findSimilarNameProduct(products, { name: 'harina pan 1kg' }, { exceptId: 'a' })).toBeNull();
        expect(findSimilarNameProduct(products, { name: 'harina pan 1kg' }, { ignoreIds: ['a'] })).toBeNull();
    });

    it('con campos extra, distinta concentración no es parecido', () => {
        const fields = ['concentracion', 'presentacion'];
        expect(findSimilarNameProduct(products, { name: 'acetaminofen', concentracion: '650 mg', presentacion: 'Tabletas' }, { fields })).toBeNull();
        expect(findSimilarNameProduct(products, { name: 'acetaminofen', concentracion: '500mg', presentacion: 'tabletas' }, { fields })?.id).toBe('b');
    });

    it('nombre vacío no coincide con nada', () => {
        expect(findSimilarNameProduct([{ id: 'x', name: '' }], { name: '  ' })).toBeNull();
    });

    it('al editar solo revisa si el nombre cambió', () => {
        expect(shouldCheckName({ name: 'Harina' }, null)).toBe(true);
        expect(shouldCheckName({ name: 'harina ' }, { name: 'Harina' })).toBe(false);
        expect(shouldCheckName({ name: 'Harina PAN' }, { name: 'Harina' })).toBe(true);
    });
});

import { findSimilarNames } from '../src/utils/similarName';

describe('findSimilarNames (aviso en vivo)', () => {
    const list = [
        { id: 'a', name: 'Harina P.A.N. 1 Kg' },
        { id: 'b', name: 'Harina de trigo' },
        { id: 'c', name: 'Arroz Mary' },
        { id: 'd', name: 'harina pan' },
    ];
    it('el igual va primero y marcado', () => {
        const r = findSimilarNames(list, 'Harina Pan');
        expect(r[0]).toEqual({ product: list[3], exact: true });
        expect(r.map((x) => x.product.id)).toContain('a');
        expect(r.map((x) => x.product.id)).not.toContain('b');
    });
    it('menos de 3 letras no busca', () => {
        expect(findSimilarNames(list, 'ha')).toEqual([]);
    });
    it('no se compara consigo mismo', () => {
        expect(findSimilarNames(list, 'harina pan', { exceptId: 'd' }).map((x) => x.product.id)).toEqual(['a']);
    });
    it('sin coincidencias devuelve vacío', () => {
        expect(findSimilarNames(list, 'Aceite')).toEqual([]);
    });
});
