import { describe, expect, it } from 'vitest';
import {
    applySupervisorProductCommand,
    buildProductRevision,
    extractEditableProductPatch,
} from '../src/services/supervisorProductCommand';

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
            baseRevision: buildProductRevision(currentProducts[0]),
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
            baseRevision: buildProductRevision(currentProducts[0]),
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
            baseRevision: buildProductRevision(currentProducts[0]),
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
        const staleProduct = {
            ...currentProducts[0],
            name: 'Arroz Original',
        };
        const productsInCaja = [{
            ...currentProducts[0],
            name: 'Arroz Actualizado En Caja',
            updatedAt: '2026-10-15T12:05:00.000Z',
        }];

        expect(() => applySupervisorProductCommand(productsInCaja, {
            action: 'edit',
            baseRevision: buildProductRevision(staleProduct),
            baseUpdatedAt: '2026-10-15T12:00:00.000Z',
            product: { id: 'product-1', name: 'Arroz viejo' },
        })).toThrow('El producto cambió mientras lo editabas');
    });

    it('ignora campos de stock, lotes, movimientos y timestamps en una edición adversarial', () => {
        const initialProducts = [
            {
                id: 'product-1',
                name: 'Arroz',
                priceUsd: 2,
                stock: 45,
                stockInLotes: 3,
                lots: [{ id: 'lote-1', cantidad: 3 }],
                movements: ['mov-1'],
                initialStock: 45,
                category: 'Viveres',
                updatedAt: '2026-10-15T12:00:00.000Z',
            },
            { id: 'product-2', name: 'Pasta', priceUsd: 1.5, stock: 4, category: 'Viveres' },
        ];

        const adversarialPayload = {
            action: 'edit',
            baseRevision: buildProductRevision(initialProducts[0]),
            baseUpdatedAt: '2026-10-15T12:00:00.000Z',
            product: {
                id: 'product-1',
                name: 'Arroz Modificado',
                priceUsd: 2.5,
                // Campos manipulados que intentan sobreescribir stock e historial:
                stock: 0,
                stockInLotes: 0,
                lots: [],
                movements: [],
                initialStock: 0,
                updatedAt: '1970-01-01T00:00:00.000Z',
            },
        };

        const result = applySupervisorProductCommand(initialProducts, adversarialPayload);

        // 1. Los campos maestros editables sí se actualizan
        expect(result.product.name).toBe('Arroz Modificado');
        expect(result.product.priceUsd).toBe(2.5);

        // 2. El stock y los datos de inventario del producto local se preservan intactos
        expect(result.product.stock).toBe(45);
        expect(result.product.stockInLotes).toBe(3);
        expect(result.product.lots).toEqual([{ id: 'lote-1', cantidad: 3 }]);
        expect(result.product.movements).toEqual(['mov-1']);
        expect(result.product.initialStock).toBe(45);

        // 3. El timestamp no es sobreescrito con el valor adversarial viejo
        expect(result.product.updatedAt).not.toBe('1970-01-01T00:00:00.000Z');

        // 4. El resto del catálogo no se modifica
        expect(result.products.find(p => p.id === 'product-2')).toEqual(initialProducts[1]);
    });

    it('conserva el stock inicial al crear un producto nuevo', () => {
        const result = applySupervisorProductCommand(currentProducts, {
            action: 'create',
            product: {
                id: 'product-new',
                name: 'Harina Pan',
                priceUsd: 1.2,
                stock: 50,
                stockInLotes: 5,
            },
        });

        expect(result.product.stock).toBe(50);
        expect(result.product.stockInLotes).toBe(5);
        expect(result.products.find(p => p.id === 'product-new').stock).toBe(50);
    });

    it('acepta editar cuando la revisión base coincide con el producto local', () => {
        const initialProducts = [
            { id: 'product-1', name: 'Arroz', priceUsd: 2, stock: 10, category: 'Viveres' },
        ];
        const baseRevision = buildProductRevision(initialProducts[0]);

        const result = applySupervisorProductCommand(initialProducts, {
            action: 'edit',
            baseRevision,
            product: { id: 'product-1', name: 'Arroz Extra', priceUsd: 2.2 },
        });

        expect(result.product.name).toBe('Arroz Extra');
        expect(result.product.priceUsd).toBe(2.2);
        expect(result.product.stock).toBe(10);
    });

    it('rechaza editar si la revisión base difiere de la versión local', () => {
        const initialProducts = [
            { id: 'product-1', name: 'Arroz Modificado En Caja', priceUsd: 3, stock: 10, category: 'Viveres' },
        ];
        const staleProduct = { id: 'product-1', name: 'Arroz Original', priceUsd: 2, stock: 10, category: 'Viveres' };
        const staleRevision = buildProductRevision(staleProduct);

        expect(() => applySupervisorProductCommand(initialProducts, {
            action: 'edit',
            baseRevision: staleRevision,
            product: { id: 'product-1', name: 'Arroz Desde Supervisor', priceUsd: 2.5 },
        })).toThrow('El producto cambió mientras lo editabas');
    });

    it('rechaza editar si la revisión base es ausente o inválida', () => {
        const initialProducts = [
            { id: 'product-1', name: 'Arroz', priceUsd: 2, stock: 10, category: 'Viveres' },
        ];

        // Ausente
        expect(() => applySupervisorProductCommand(initialProducts, {
            action: 'edit',
            baseRevision: null,
            product: { id: 'product-1', priceUsd: 2.5 },
        })).toThrow('Revisión base ausente o inválida');

        // Inválida (string vacío)
        expect(() => applySupervisorProductCommand(initialProducts, {
            action: 'edit',
            baseRevision: '   ',
            product: { id: 'product-1', priceUsd: 2.5 },
        })).toThrow('Revisión base ausente o inválida');
    });

    it('rechaza editar si la revisión base está ausente aun cuando baseUpdatedAt sea válida', () => {
        const initialProducts = [
            { id: 'product-1', name: 'Arroz', priceUsd: 2, stock: 10, category: 'Viveres', updatedAt: '2026-10-15T12:00:00.000Z' },
        ];

        expect(() => applySupervisorProductCommand(initialProducts, {
            action: 'edit',
            baseUpdatedAt: '2026-10-15T12:00:00.000Z',
            product: { id: 'product-1', priceUsd: 2.5 },
        })).toThrow('Revisión base ausente o inválida');
    });

    it('rechaza editar si la revisión base es de tipo incorrecto (no string, null, vacía o espacios)', () => {
        const initialProducts = [
            { id: 'product-1', name: 'Arroz', priceUsd: 2, stock: 10, category: 'Viveres' },
        ];

        for (const invalidRevision of [null, undefined, '', '   ', 12345, true, {}, []]) {
            expect(() => applySupervisorProductCommand(initialProducts, {
                action: 'edit',
                baseRevision: invalidRevision,
                product: { id: 'product-1', priceUsd: 2.5 },
            })).toThrow('Revisión base ausente o inválida');
        }
    });

    it('produce la misma revisión para alias de precio priceUsd y priceUsdt con precedencia explícita', () => {
        const base = { id: 'p1', name: 'Arroz', category: 'Viveres' };
        const withUsd = { ...base, priceUsd: 2.5 };
        const withUsdt = { ...base, priceUsdt: 2.5 };
        const withBothSame = { ...base, priceUsd: 2.5, priceUsdt: 2.5 };
        const withBothDiff = { ...base, priceUsd: 2.5, priceUsdt: 99 };

        const revUsd = buildProductRevision(withUsd);
        const revUsdt = buildProductRevision(withUsdt);
        const revBothSame = buildProductRevision(withBothSame);
        const revBothDiff = buildProductRevision(withBothDiff);

        expect(revUsd).toBe(revUsdt);
        expect(revUsd).toBe(revBothSame);
        expect(revUsd).toBe(revBothDiff);
    });

    it('permite editar cuando la caja tiene priceUsdt y el supervisor calcula revisión con priceUsd del mismo precio', () => {
        const inCashier = [{ id: 'p1', name: 'Arroz', priceUsdt: 2.5, stock: 10, category: 'Viveres' }];
        const inSupervisor = { id: 'p1', name: 'Arroz', priceUsd: 2.5, stock: 10, category: 'Viveres' };
        const baseRevision = buildProductRevision(inSupervisor);

        const result = applySupervisorProductCommand(inCashier, {
            action: 'edit',
            baseRevision,
            product: { id: 'p1', name: 'Arroz Súper', priceUsd: 2.5 },
        });

        expect(result.product.name).toBe('Arroz Súper');
    });

    it('extractEditableProductPatch extrae únicamente los campos permitidos y excluye stock, lotes, movimientos y timestamps', () => {
        const raw = {
            name: 'Harina',
            priceUsd: 1.2,
            stock: 99,
            stockInLotes: 10,
            lots: [{ id: 1 }],
            movements: [1, 2],
            initialStock: 50,
            updatedAt: '2026-10-15T12:00:00.000Z',
            baseRevision: 'abc',
            unknownField: 'secret',
        };

        const patch = extractEditableProductPatch(raw);
        expect(patch).toEqual({
            name: 'Harina',
            priceUsd: 1.2,
        });
        expect(patch.stock).toBeUndefined();
        expect(patch.stockInLotes).toBeUndefined();
        expect(patch.lots).toBeUndefined();
        expect(patch.movements).toBeUndefined();
        expect(patch.initialStock).toBeUndefined();
        expect(patch.updatedAt).toBeUndefined();
        expect(patch.baseRevision).toBeUndefined();
        expect(patch.unknownField).toBeUndefined();
    });

    it('evalúa límites temporales deterministas de baseUpdatedAt sin tolerancias arbitrarias', () => {
        const fixedNow = 1_700_000_000_000;
        const products = [{ id: 'product-1', name: 'Arroz', priceUsd: 2, stock: 10, category: 'Viveres' }];
        const baseRevision = buildProductRevision(products[0]);

        // Fecha pasada: aceptada
        const pastResult = applySupervisorProductCommand(products, {
            action: 'edit',
            baseRevision,
            baseUpdatedAt: new Date(fixedNow - 5_000).toISOString(),
            product: { id: 'product-1', priceUsd: 2.1 },
        }, { now: () => fixedNow });
        expect(pastResult.product.priceUsd).toBe(2.1);

        // Fecha igual al reloj de la caja: aceptada
        const exactResult = applySupervisorProductCommand(products, {
            action: 'edit',
            baseRevision,
            baseUpdatedAt: new Date(fixedNow).toISOString(),
            product: { id: 'product-1', priceUsd: 2.2 },
        }, { now: () => fixedNow });
        expect(exactResult.product.priceUsd).toBe(2.2);

        // Fecha futura (1 ms posterior al reloj): rechazada
        expect(() => applySupervisorProductCommand(products, {
            action: 'edit',
            baseRevision,
            baseUpdatedAt: new Date(fixedNow + 1).toISOString(),
            product: { id: 'product-1', priceUsd: 2.3 },
        }, { now: () => fixedNow })).toThrow('La fecha base no puede ser futura');

        // Fecha inválida no parseable: rechazada
        expect(() => applySupervisorProductCommand(products, {
            action: 'edit',
            baseRevision,
            baseUpdatedAt: 'fecha-invalida',
            product: { id: 'product-1', priceUsd: 2.4 },
        }, { now: () => fixedNow })).toThrow('Fecha base inválida');
    });

    it('conserva el stock local ante un cambio concurrente de existencias durante la edición', () => {
        const productAtOpen = { id: 'product-1', name: 'Arroz', priceUsd: 2, stock: 20, category: 'Viveres' };
        const baseRevision = buildProductRevision(productAtOpen);

        // En la caja ocurre una venta concurrente: el stock baja de 20 a 15, sin tocar campos maestros
        const productAfterSale = { id: 'product-1', name: 'Arroz', priceUsd: 2, stock: 15, category: 'Viveres' };

        const result = applySupervisorProductCommand([productAfterSale], {
            action: 'edit',
            baseRevision,
            product: { id: 'product-1', priceUsd: 2.3 },
        });

        expect(result.product.priceUsd).toBe(2.3);
        expect(result.product.stock).toBe(15);
    });

    it('rechaza editar si se envía una fecha base futura con reloj estándar', () => {
        const products = [{ ...currentProducts[0], updatedAt: '2026-10-15T12:00:00.000Z' }];
        const futureDate = new Date(Date.now() + 86_400_000).toISOString();
        const baseRevision = buildProductRevision(products[0]);

        expect(() => applySupervisorProductCommand(products, {
            action: 'edit',
            baseRevision,
            baseUpdatedAt: futureDate,
            product: { id: 'product-1', name: 'Arroz futuro' },
        })).toThrow('La fecha base no puede ser futura');
    });

    it('rechaza editar si la revisión raíz y la revisión anidada en patch difieren', () => {
        const initialProducts = [
            { id: 'product-1', name: 'Arroz', priceUsd: 2, stock: 10, category: 'Viveres' },
        ];
        const baseRevision = buildProductRevision(initialProducts[0]);

        expect(() => applySupervisorProductCommand(initialProducts, {
            action: 'edit',
            baseRevision,
            product: { id: 'product-1', priceUsd: 2.5, baseRevision: '["Arroz",null,999]' },
        })).toThrow('Revisión base ausente o inválida');
    });

    it('acepta editar cuando la revisión viaja anidada en product (puente useRemoteCommands) o en ambos campos coincidentes', () => {
        const initialProducts = [
            { id: 'product-1', name: 'Arroz', priceUsd: 2, stock: 10, category: 'Viveres' },
        ];
        const baseRevision = buildProductRevision(initialProducts[0]);

        // Puente useRemoteCommands: la orden de caja recibe la revisión anidada dentro de product
        const res1 = applySupervisorProductCommand(initialProducts, {
            action: 'edit',
            product: { id: 'product-1', priceUsd: 2.5, baseRevision },
        });
        expect(res1.product.priceUsd).toBe(2.5);

        // Orden enviada por la UI con ambos campos coincidentes
        const res2 = applySupervisorProductCommand(initialProducts, {
            action: 'edit',
            baseRevision,
            product: { id: 'product-1', priceUsd: 2.6, baseRevision },
        });
        expect(res2.product.priceUsd).toBe(2.6);
    });
});
