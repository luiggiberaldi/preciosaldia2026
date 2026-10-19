import { describe, expect, it } from 'vitest';
import {
    applyOptimisticProductEcho,
    isOptimisticEchoSettled,
} from '../src/services/supervisorProductCommand';

// Eco optimista: el catálogo del supervisor muestra el cambio de producto al
// instante mientras la caja confirma. Estas reglas son solo presentación: no
// escriben almacenamiento ni nube y se retiran cuando el eco real llega.

const baseProducts = () => ([
    { id: 'p1', name: 'Arroz', priceUsdt: 10, priceUsd: 10, stock: 5, lots: ['l1'], updatedAt: 'T0' },
    { id: 'p2', name: 'Aceite', priceUsdt: 3, priceUsd: 3, stock: 2, updatedAt: 'T0' },
]);

describe('applyOptimisticProductEcho', () => {
    it('create: agrega el producto arriba sin duplicar si ya llegó el eco', () => {
        const nuevo = { id: 'p9', name: 'Queso', priceUsdt: 7, priceUsd: 7, stock: 0 };
        const conEcho = applyOptimisticProductEcho(baseProducts(), { action: 'create', product: nuevo });
        expect(conEcho).toHaveLength(3);
        expect(conEcho[0]).toBe(nuevo);

        // Si la base ya lo tiene (eco llegado), la entrada no debe duplicarlo.
        const yaEco = applyOptimisticProductEcho(conEcho, { action: 'create', product: nuevo });
        expect(yaEco).toHaveLength(3);
        expect(yaEco.filter(p => p.id === 'p9')).toHaveLength(1);
    });

    it('edit: fusiona el patch enviado y conserva stock y lotes de la caja', () => {
        const lista = applyOptimisticProductEcho(baseProducts(), {
            action: 'edit',
            productId: 'p1',
            patch: { name: 'Arroz Premium', priceUsd: 12.5, priceUsdt: 12.5 },
        });
        const p1 = lista.find(p => p.id === 'p1');
        expect(p1.name).toBe('Arroz Premium');
        expect(p1.priceUsd).toBe(12.5);
        expect(p1.priceUsdt).toBe(12.5);
        // El inventario jamás viaja en el patch: queda como lo tiene la caja.
        expect(p1.stock).toBe(5);
        expect(p1.lots).toEqual(['l1']);
        // Los demás productos no se tocan.
        expect(lista.find(p => p.id === 'p2').name).toBe('Aceite');
    });

    it('edit: el par de alias de precio se mueve junto (FIN-030)', () => {
        const lista = applyOptimisticProductEcho(baseProducts(), {
            action: 'edit',
            productId: 'p2',
            patch: { priceUsdt: 9 },
        });
        const p2 = lista.find(p => p.id === 'p2');
        expect(p2.priceUsdt).toBe(9);
        expect(p2.priceUsd).toBe(9);
    });

    it('delete: retira el producto de la vista al instante', () => {
        const lista = applyOptimisticProductEcho(baseProducts(), { action: 'delete', productId: 'p1' });
        expect(lista.map(p => p.id)).toEqual(['p2']);
    });

    it('acciones desconocidas o vacías no cambian la lista', () => {
        const original = baseProducts();
        expect(applyOptimisticProductEcho(original, { action: 'misterio' })).toBe(original);
        expect(applyOptimisticProductEcho(original, {})).toBe(original);
    });
});

describe('isOptimisticEchoSettled: cuándo se retira la entrada', () => {
    it('create: se retira cuando el producto aparece en la base (eco llegado)', () => {
        const entry = { action: 'create', product: { id: 'p9' } };
        expect(isOptimisticEchoSettled(entry, baseProducts())).toBe(false);
        expect(isOptimisticEchoSettled(entry, [...baseProducts(), { id: 'p9', updatedAt: 'T1' }])).toBe(true);
    });

    it('delete: se retira cuando el producto desaparece de la base', () => {
        const entry = { action: 'delete', productId: 'p1' };
        expect(isOptimisticEchoSettled(entry, baseProducts())).toBe(false);
        const sinP1 = baseProducts().filter(p => p.id !== 'p1');
        expect(isOptimisticEchoSettled(entry, sinP1)).toBe(true);
    });

    it('edit: sigue activa mientras llega el eco y se retira con la versión nueva', () => {
        const entry = { action: 'edit', productId: 'p1', baseUpdatedAt: 'T0' };
        // Mismo updatedAt: el eco no ha llegado, el valor optimista se mantiene.
        expect(isOptimisticEchoSettled(entry, baseProducts())).toBe(false);
        // Eco llegado: la caja estampó una versión nueva.
        const eco = baseProducts().map(p => (p.id === 'p1' ? { ...p, updatedAt: 'T1' } : p));
        expect(isOptimisticEchoSettled(entry, eco)).toBe(true);
    });

    it('edit sobre un producto que ya no existe: la entrada sobra', () => {
        const entry = { action: 'edit', productId: 'p1', baseUpdatedAt: 'T0' };
        const sinP1 = baseProducts().filter(p => p.id !== 'p1');
        expect(isOptimisticEchoSettled(entry, sinP1)).toBe(true);
    });

    it('edit sin baseUpdatedAt no se retira por un eco sin timestamp', () => {
        const entry = { action: 'edit', productId: 'p1', baseUpdatedAt: null };
        const eco = baseProducts().map(p => (p.id === 'p1' ? { ...p, updatedAt: undefined } : p));
        expect(isOptimisticEchoSettled(entry, eco)).toBe(false);
    });
});
