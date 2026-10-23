// @vitest-environment jsdom

// Barrido único de migración de imágenes base64 → Storage
// (imageUpload.migrateCatalogImagesOnce): la semántica que comparten ProductsView
// y el arranque de useCloudSync para terminar la FASE 3 (Egress) — encoger
// bodega_products_v1 bajo el techo de 500 KB sin perder NUNCA una imagen.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ failUploads: false, failCalls: new Set(), uploads: 0 }));

vi.mock('../src/config/supabaseCloud', () => ({
    supabaseCloud: {
        storage: {
            from: () => ({
                upload: async () => {
                    h.uploads += 1;
                    return (h.failUploads || h.failCalls.has(h.uploads))
                        ? { data: null, error: { message: 'Storage no disponible' } }
                        : { data: { path: `device/p${h.uploads}.png` }, error: null };
                },
                getPublicUrl: (path) => ({
                    data: { publicUrl: `https://demo.supabase.co/storage/v1/object/public/product-images/${path}` },
                }),
            }),
        },
    },
}));

import {
    IMAGES_MIGRATED_FLAG,
    isStorageImageUrl,
    migrateCatalogImagesOnce,
} from '../src/utils/imageUpload';

const base64Image = `data:image/png;base64,${'A'.repeat(64)}`;
const storageUrl = 'https://demo.supabase.co/storage/v1/object/public/product-images/device/old.webp';

describe('migrateCatalogImagesOnce', () => {
    beforeEach(() => {
        localStorage.clear();
        h.failUploads = false;
        h.failCalls = new Set();
        h.uploads = 0;
        Object.defineProperty(navigator, 'onLine', { value: true, configurable: true });
    });

    it('migra los base64 a URLs de Storage, persiste el catálogo y fija el flag', async () => {
        const catalog = [
            { id: 'p1', name: 'Con foto', image: base64Image },
            { id: 'p2', name: 'Ya migrado', image: storageUrl },
        ];
        const saveProducts = vi.fn(async () => {});

        const res = await migrateCatalogImagesOnce({
            readProducts: async () => catalog,
            saveProducts,
        });

        expect(res.ran).toBe(true);
        expect(res.migrated).toBe(1);
        expect(res.failed).toBe(0);
        expect(saveProducts).toHaveBeenCalledTimes(1);
        const [out, base] = saveProducts.mock.calls[0];
        expect(isStorageImageUrl(out[0].image)).toBe(true);
        expect(out[1].image).toBe(storageUrl);
        // El base original se entrega para el merge 3-way del persistidor.
        expect(base).toBe(catalog);
        expect(localStorage.getItem(IMAGES_MIGRATED_FLAG)).toBe('true');
    });

    it('con fallo total nada se persiste y NO se fija el flag (se reintenta después)', async () => {
        // Regresión: uploadProductImage ignoraba el error del upload y
        // getPublicUrl devolvía una URL muerta — la imagen se perdía.
        h.failUploads = true;
        const catalog = [{ id: 'p1', name: 'Con foto', image: base64Image }];
        const saveProducts = vi.fn(async () => {});

        const res = await migrateCatalogImagesOnce({
            readProducts: async () => catalog,
            saveProducts,
        });

        expect(res.migrated).toBe(0);
        expect(res.failed).toBe(1);
        // Nada que persistir: el catálogo local queda tal cual (base64 intacto).
        expect(saveProducts).not.toHaveBeenCalled();
        expect(localStorage.getItem(IMAGES_MIGRATED_FLAG)).not.toBe('true');
    });

    it('con fallo parcial se persiste la parte migrada y el resto conserva su base64', async () => {
        h.failCalls = new Set([2]);
        const catalog = [
            { id: 'p1', image: base64Image },
            { id: 'p2', image: base64Image },
        ];
        const saveProducts = vi.fn(async () => {});

        const res = await migrateCatalogImagesOnce({
            readProducts: async () => catalog,
            saveProducts,
        });

        expect(res.migrated).toBe(1);
        expect(res.failed).toBe(1);
        const [out] = saveProducts.mock.calls[0];
        expect(isStorageImageUrl(out[0].image)).toBe(true);
        expect(out[1].image).toBe(base64Image);
        // Fallos pendientes → el flag queda sin fijar para reintentarlos.
        expect(localStorage.getItem(IMAGES_MIGRATED_FLAG)).not.toBe('true');
    });

    it('sin base64 fija el flag sin persistir ni subir nada', async () => {
        const saveProducts = vi.fn(async () => {});
        const res = await migrateCatalogImagesOnce({
            readProducts: async () => [{ id: 'p1', image: storageUrl }],
            saveProducts,
        });

        expect(res.ran).toBe(false);
        expect(res.reason).toBe('sin base64');
        expect(saveProducts).not.toHaveBeenCalled();
        expect(h.uploads).toBe(0);
        expect(localStorage.getItem(IMAGES_MIGRATED_FLAG)).toBe('true');
    });

    it('con el flag puesto es un no-op (un solo barrido por dispositivo)', async () => {
        localStorage.setItem(IMAGES_MIGRATED_FLAG, 'true');
        const readProducts = vi.fn(async () => []);
        const res = await migrateCatalogImagesOnce({ readProducts, saveProducts: vi.fn() });

        expect(res.reason).toBe('ya migrado');
        expect(readProducts).not.toHaveBeenCalled();
    });

    it('offline no corre ni fija el flag (se reintenta cuando haya red)', async () => {
        Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
        const res = await migrateCatalogImagesOnce({ readProducts: vi.fn(), saveProducts: vi.fn() });

        expect(res.reason).toBe('offline');
        expect(localStorage.getItem(IMAGES_MIGRATED_FLAG)).not.toBe('true');
    });

    it('force=true ignora el flag y vuelve a barrer (recuperación manual)', async () => {
        localStorage.setItem(IMAGES_MIGRATED_FLAG, 'true');
        const catalog = [{ id: 'p1', image: base64Image }];
        const res = await migrateCatalogImagesOnce({
            readProducts: async () => catalog,
            saveProducts: vi.fn(async () => {}),
            force: true,
        });

        expect(res.ran).toBe(true);
        expect(res.migrated).toBe(1);
    });
});
