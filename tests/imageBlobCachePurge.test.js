import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map();

vi.mock('localforage', () => ({
    default: {
        keys: vi.fn(async () => [...store.keys()]),
        removeItem: vi.fn(async (key) => { store.delete(key); }),
        getItem: vi.fn(async () => null),
        setItem: vi.fn(async () => {}),
    },
}));
vi.mock('../src/utils/storageService', () => ({
    storageService: { getItem: vi.fn(async () => null), setItem: vi.fn(async () => {}) },
}));
vi.mock('../src/config/supabaseCloud', () => ({
    supabaseCloudUrl: 'https://sodgzkablshladvbtnes.supabase.co',
}));

import { purgeForeignImageCache } from '../src/services/imageBlobCache';

const OLD = 'https://oshexsmweswzbwaksvra.supabase.co/storage/v1/object/public/product-images/a.webp';
const NEW = 'https://sodgzkablshladvbtnes.supabase.co/storage/v1/object/public/product-images/b.webp';

describe('purgeForeignImageCache', () => {
    beforeEach(() => {
        store.clear();
        localStorage.clear();
    });

    it('borra solo las entradas img_blob_ de otro proyecto Supabase', async () => {
        store.set(`img_blob_${OLD}`, 'data:image/webp;base64,AAAA');
        store.set(`bodega_storage_fallback_v1:nb_neg-1:img_blob_${OLD}`, '{"version":1}');
        store.set(`img_blob_${NEW}`, 'data:image/webp;base64,BBBB');
        store.set('bodega_products_v1', [{ id: 1 }]);
        localStorage.setItem(`img_blob_${OLD}`, 'data:image/webp;base64,CCCC');

        const removed = await purgeForeignImageCache();

        expect(removed).toBe(3);
        expect([...store.keys()].sort()).toEqual(['bodega_products_v1', `img_blob_${NEW}`].sort());
        expect(localStorage.getItem(`img_blob_${OLD}`)).toBeNull();
    });

    it('no toca nada si todas las URLs son del proyecto actual', async () => {
        store.set(`img_blob_${NEW}`, 'data:image/webp;base64,BBBB');
        expect(await purgeForeignImageCache()).toBe(0);
        expect(store.size).toBe(1);
    });
});
