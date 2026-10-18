import { describe, expect, it } from 'vitest';
import {
    mergeCatalog3Way,
    persistCatalogLocked,
    mutateCatalogLocked,
    PRODUCTS_KEY,
} from '../src/utils/catalogLock';

function memoryStorage(initial = []) {
    const map = new Map([[PRODUCTS_KEY, initial]]);
    const writes = { count: 0 };
    return {
        writes,
        getItem: async (key, defaultValue = null) => (map.has(key) ? map.get(key) : defaultValue),
        setItem: async (key, value) => {
            writes.count += 1;
            map.set(key, value);
        },
        removeItem: async (key) => { map.delete(key); },
    };
}

const P1 = { id: 'p1', name: 'Café', priceUsd: 4, priceUsdt: 4, stock: 10 };

describe('mergeCatalog3Way (semántica del cierre §4)', () => {
    it('edición local y cambio remoto concurrente sobreviven los dos (por campo)', () => {
        const base = [{ ...P1 }];
        const local = [{ ...P1, name: 'Café Premium' }];      // cajero editó nombre
        const remote = [{ ...P1, priceUsd: 5, priceUsdt: 5 }]; // supervisor cambió precio

        const merged = mergeCatalog3Way({ local, base, remote });
        expect(merged).toHaveLength(1);
        expect(merged[0].name).toBe('Café Premium'); // local gana su campo
        expect(merged[0].priceUsd).toBe(5);         // remoto gana el no tocado
    });

    it('el stock de una venta concurrente sobrevive al guardado del cajero', () => {
        const base = [{ ...P1 }];
        const local = [{ ...P1, name: 'Café Premium' }];
        const remote = [{ ...P1, stock: 7 }]; // venta descontó 3

        const merged = mergeCatalog3Way({ local, base, remote });
        expect(merged[0].stock).toBe(7);
        expect(merged[0].name).toBe('Café Premium');
    });

    it('si ambos tocan el MISMO campo, gana lo local (último escritor, límite documentado)', () => {
        const base = [{ ...P1 }];
        const local = [{ ...P1, priceUsd: 6, priceUsdt: 6 }];
        const remote = [{ ...P1, priceUsd: 5, priceUsdt: 5 }];

        const merged = mergeCatalog3Way({ local, base, remote });
        expect(merged[0].priceUsd).toBe(6);
    });

    it('respeta borrados y creaciones de ambos lados', () => {
        const base = [{ ...P1 }, { id: 'p2', name: 'Arroz', stock: 5 }];
        const local = [{ ...P1 }];                              // cajero borró p2
        const remote = [{ ...P1 }, { id: 'p2', name: 'Arroz', stock: 5 }, { id: 'p3', name: 'Aceite', stock: 2 }];

        const merged = mergeCatalog3Way({ local, base, remote });
        expect(merged.map(p => p.id)).toEqual(['p1', 'p3']); // p2 borrado local, p3 creado remoto
    });

    it('conserva un producto que el remoto borró si el local lo modificó', () => {
        const base = [{ ...P1 }];
        const local = [{ ...P1, name: 'Café Premium' }];
        const remote = []; // orden delete del supervisor

        const merged = mergeCatalog3Way({ local, base, remote });
        expect(merged).toHaveLength(1);
        expect(merged[0].name).toBe('Café Premium');
    });
});

describe('persistCatalogLocked (auto-save de ProductContext, guardados de vistas)', () => {
    it('persiste bajo el candado y mergea con lo que otros escritores aplicaron', async () => {
        const storage = memoryStorage([{ ...P1 }]);
        const base = [{ ...P1 }];

        // Otro escritor (venta/orden) cambia el precio ANTES de que el guardado
        // del cajero se despache.
        await storage.setItem(PRODUCTS_KEY, [{ ...P1, priceUsd: 5, priceUsdt: 5 }]);

        const written = await persistCatalogLocked({
            local: [{ ...P1, name: 'Café Premium' }],
            base,
            storage,
        });

        expect(written[0].name).toBe('Café Premium');
        expect(written[0].priceUsd).toBe(5);
        expect((await storage.getItem(PRODUCTS_KEY))[0].name).toBe('Café Premium');
    });

    it('sin cambios locales no escribe (evita eco de sincronización)', async () => {
        const storage = memoryStorage([{ ...P1 }]);
        const result = await persistCatalogLocked({
            local: [{ ...P1 }],
            base: [{ ...P1 }],
            storage,
        });
        expect(result).toEqual([{ ...P1 }]);
        expect(writesOf(storage)).toBe(0);
    });
});

describe('mutateCatalogLocked (ajuste de stock, ajuste masivo de precios, empaque)', () => {
    it('aplica el patch sobre el catálogo FRESCO: lo no tocado sobrevive', async () => {
        const storage = memoryStorage([{ ...P1 }]);
        // Una venta descuenta stock justo antes del patch de precios.
        await storage.setItem(PRODUCTS_KEY, [{ ...P1, stock: 7 }]);

        const written = await mutateCatalogLocked(
            fresh => fresh.map(p => ({ ...p, priceUsd: 8, priceUsdt: 8 })),
            { storage }
        );

        expect(written[0].stock).toBe(7);   // la venta sobrevive
        expect(written[0].priceUsd).toBe(8); // el patch se aplicó
    });

    it('dos mutaciones encadenadas se serializan: ambas se aplican', async () => {
        const storage = memoryStorage([{ ...P1 }]);

        const [, second] = await Promise.all([
            mutateCatalogLocked(fresh => fresh.map(p => ({ ...p, stock: p.stock - 3 })), { storage }),
            mutateCatalogLocked(fresh => fresh.map(p => ({ ...p, name: 'Café Premium' })), { storage }),
        ]);

        const saved = await storage.getItem(PRODUCTS_KEY);
        expect(saved[0].stock).toBe(7);            // 10 − 3
        expect(saved[0].name).toBe('Café Premium'); // y el rename
        expect(second[0].name).toBe('Café Premium');
    });
});

function writesOf(storage) {
    return storage.writes.count;
}
