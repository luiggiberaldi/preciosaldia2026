// @vitest-environment jsdom

// Regresión del bug real de producción: con un catálogo grande (miles de
// productos), un cambio de stock ocurría muy lejos del carácter 5000 del JSON y
// (con números de igual cantidad de dígitos) sin cambiar el largo total. El
// "hash ligero" de pushCloudSync solo recorría los primeros 5000 caracteres, así
// que el push se saltaba como "Sin cambios" y las ventas de la caja JAMÁS
// llegaban al supervisor. Los ajustes pedidos desde el supervisor sí llegaban
// porque se publican con forceUnconditional=true (saltan el hash): esa asimetría
// era la firma del bug, invisible en tests con catálogos de 1-3 productos.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({
    upserts: [],
}));

vi.mock('../src/config/supabaseCloud', () => ({
    supabaseCloud: {
        from: () => ({
            upsert: async (document) => {
                h.upserts.push(document);
                return { error: null, data: [document] };
            },
        }),
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: () => Promise.resolve(),
    },
}));

import { pushCloudSync } from '../src/hooks/useCloudSync';

// Catálogo cuyo JSON queda MUY por encima de 5000 caracteres, como el catálogo
// real (~2434 productos).
function bigCatalog(stock) {
    return Array.from({ length: 400 }, (_, i) => ({
        id: `p${i}`,
        name: `Producto de prueba ${i} ${'x'.repeat(40)}`,
        barcode: `759${String(i).padStart(10, '0')}`,
        category: 'General',
        stock,
        priceUsd: 1 + (i % 7),
        costPrice: 0.5,
        minStock: 5,
        isWeight: false,
        isActive: true,
    }));
}

describe('pushCloudSync · cambios profundos en catálogos grandes', () => {
    beforeEach(() => {
        localStorage.clear();
        h.upserts.length = 0;
    });

    it('una venta (stock cambia lejos del carácter 5000, mismo largo) NO se salta como "Sin cambios"', async () => {
        const catalog = bigCatalog(110);
        expect(JSON.stringify(catalog).length).toBeGreaterThan(50000);

        // Primer push de la caja (allowBeforePairing para el test; en producción
        // lo autoriza la sesión/pairing) → registra el hash como en producción.
        const first = await pushCloudSync('bodega_products_v1', catalog, false, true, 'device-test');
        expect(first.ok).toBe(true);
        expect(first.skipped).toBe(false);

        // Venta de 5 unidades de un producto profundo del array: 110 → 105, el
        // JSON conserva el mismo largo y el cambio queda muy allá del carácter
        // 5000 → el hash truncado de antes no lo veía y saltaba el push.
        const afterSale = catalog.map(product => (product.id === 'p350' ? { ...product, stock: 105 } : product));
        expect(JSON.stringify(afterSale).length).toBe(JSON.stringify(catalog).length);

        const second = await pushCloudSync('bodega_products_v1', afterSale, false, true, 'device-test');

        // El eco de la venta DEBE publicarse: sin esto el supervisor nunca
        // descuenta la venta.
        expect(second.ok).toBe(true);
        expect(second.skipped).toBe(false);
        expect(h.upserts).toHaveLength(2);
    });

    it('el valor verdaderamente idéntico sí se salta (la deduplicación anti-eco no se pierde)', async () => {
        const catalog = bigCatalog(110);
        await pushCloudSync('bodega_products_v1', catalog, false, true, 'device-test');
        const again = await pushCloudSync('bodega_products_v1', catalog, false, true, 'device-test');

        expect(again).toMatchObject({ ok: true, skipped: true, reason: 'Sin cambios' });
        expect(h.upserts).toHaveLength(1);
    });

    it('un cambio en los primeros caracteres también se detecta (comportamiento previo)', async () => {
        const catalog = bigCatalog(110);
        await pushCloudSync('bodega_products_v1', catalog, false, true, 'device-test');
        const renamed = catalog.map((product, i) => (i === 0 ? { ...product, name: 'Renombrado' } : product));

        const result = await pushCloudSync('bodega_products_v1', renamed, false, true, 'device-test');
        expect(result.skipped).toBe(false);
        expect(h.upserts).toHaveLength(2);
    });
});
