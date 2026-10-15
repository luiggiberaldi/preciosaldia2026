import { describe, expect, it } from 'vitest';
import { applySupervisorProductCommand } from '../src/services/supervisorProductCommand';

describe('Supervisor product command', () => {
    const currentProducts = [
        { id: 'product-1', name: 'Arroz', priceUsd: 2, stock: 10, category: 'Viveres' },
        { id: 'product-2', name: 'Pasta', priceUsd: 1.5, stock: 4, category: 'Viveres' },
    ];

    it('crea un producto sin alterar los existentes', () => {
        const result = applySupervisorProductCommand(currentProducts, {
            action: 'create',
            product: { id: 'product-3', name: 'Aceite', priceUsd: 4, stock: 8 },
        });

        expect(result.product).toMatchObject({ id: 'product-3', name: 'Aceite', priceUsd: 4 });
        expect(result.products).toHaveLength(3);
        expect(result.products.find(item => item.id === 'product-1')).toEqual(currentProducts[0]);
    });

    it('edita solo el producto solicitado y conserva el resto de sus datos', () => {
        const result = applySupervisorProductCommand(currentProducts, {
            action: 'edit',
            product: { id: 'product-1', name: 'Arroz Premium', priceUsd: 2.5 },
        });

        expect(result.product).toMatchObject({
            id: 'product-1',
            name: 'Arroz Premium',
            priceUsd: 2.5,
            stock: 10,
            category: 'Viveres',
        });
        expect(result.products.find(item => item.id === 'product-2')).toEqual(currentProducts[1]);
    });

    it('acepta un patch parcial al editar y conserva los campos no enviados', () => {
        const result = applySupervisorProductCommand(currentProducts, {
            action: 'edit',
            product: { id: 'product-1', priceUsd: 2.75 },
        });

        expect(result.product).toMatchObject({
            id: 'product-1',
            name: 'Arroz',
            priceUsd: 2.75,
            stock: 10,
            category: 'Viveres',
        });
    });

    it('rechaza editar un producto que no existe en la caja', () => {
        expect(() => applySupervisorProductCommand(currentProducts, {
            action: 'edit',
            product: { id: 'missing-product', name: 'No existe' },
        })).toThrow('Producto no encontrado en la caja');
    });

    it('rechaza crear un producto con un id que ya existe', () => {
        expect(() => applySupervisorProductCommand(currentProducts, {
            action: 'create',
            product: { id: 'product-1', name: 'Arroz actualizado', priceUsd: 2.25 },
        })).toThrow('El producto ya existe en la caja');
    });

    it('rechaza editar una versión vieja del producto', () => {
        const products = [{
            ...currentProducts[0],
            updatedAt: '2026-10-15T12:05:00.000Z',
        }];

        expect(() => applySupervisorProductCommand(products, {
            action: 'edit',
            baseUpdatedAt: '2026-10-15T12:00:00.000Z',
            product: { id: 'product-1', name: 'Arroz viejo' },
        })).toThrow('El producto cambió mientras lo editabas');
    });
});
