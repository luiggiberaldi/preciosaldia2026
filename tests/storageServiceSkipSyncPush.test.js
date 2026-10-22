// @vitest-environment jsdom
//
// tests/storageServiceSkipSyncPush.test.js — Fase 1 del plan de stock delta:
// la semántica de `skipSyncPush` en el interceptor REAL de storageService:
// una escritura local puede no re-publicar su clave cuando el cambio ya viaja
// dentro de otro documento publicado (el delta de stock embebido en la venta).

import { describe, expect, it, vi, beforeEach } from 'vitest';

const queueCloudSyncMock = vi.hoisted(() => vi.fn());

vi.mock('../src/hooks/useCloudSync', () => ({
    queueCloudSync: queueCloudSyncMock,
}));

const localforageMock = vi.hoisted(() => {
    const store = new Map();
    return {
        store,
        config: vi.fn(),
        getItem: vi.fn(async (key) => (store.has(key) ? JSON.parse(JSON.stringify(store.get(key))) : null)),
        setItem: vi.fn(async (key, value) => { store.set(key, JSON.parse(JSON.stringify(value))); }),
        removeItem: vi.fn(async (key) => { store.delete(key); }),
        createInstance: () => localforageMock,
    };
});

vi.mock('localforage', () => ({ default: localforageMock }));

vi.mock('../src/utils/shadowBackupService', () => ({
    shadowBackupService: { saveShadow: vi.fn(async () => {}) },
}));

vi.mock('../src/utils/syncFlags', () => ({
    isSyncingFromCloud: () => false,
    runWithoutEco: async (fn) => fn(),
}));

import { storageService } from '../src/utils/storageService';

describe('storageService.setItem con skipSyncPush (interceptor real)', () => {
    beforeEach(() => {
        localforageMock.store.clear();
        queueCloudSyncMock.mockClear();
        localforageMock.setItem.mockClear();
    });

    it('sin opciones encola el push de la clave (comportamiento actual)', async () => {
        await storageService.setItem('bodega_sales_v1', [{ id: 'v1' }]);
        expect(queueCloudSyncMock).toHaveBeenCalledWith('bodega_sales_v1', [{ id: 'v1' }]);
    });

    it('con skipSyncPush escribe localmente pero NO encola el push', async () => {
        await storageService.setItem('bodega_products_v1', [{ id: 'p1', stock: 5 }], { skipSyncPush: true });

        // La escritura local es real…
        expect(localforageMock.setItem).toHaveBeenCalledWith('bodega_products_v1', [{ id: 'p1', stock: 5 }]);
        // …y el catálogo no se re-publica por cada cobro.
        expect(queueCloudSyncMock).not.toHaveBeenCalled();
    });
});
