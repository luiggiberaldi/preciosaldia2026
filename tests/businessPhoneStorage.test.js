import { describe, expect, it, vi } from 'vitest';
import { migrateBusinessPhoneToLocalStorage } from '../src/utils/businessPhoneStorage.js';

function createLocalStorage(initialEntries = []) {
    const entries = new Map(initialEntries);
    return {
        getItem: (key) => entries.has(key) ? entries.get(key) : null,
        setItem: (key, value) => entries.set(String(key), String(value)),
    };
}

function createStore(initialValue = null) {
    let value = initialValue;
    return {
        getItem: vi.fn(async () => value),
        removeItem: vi.fn(async () => { value = null; }),
        read: () => value,
    };
}

describe('migrateBusinessPhoneToLocalStorage', () => {
    it('moves a legacy IndexedDB value only after verifying the local copy', async () => {
        const store = createStore('04121234567');
        const local = createLocalStorage();

        await expect(migrateBusinessPhoneToLocalStorage({ indexedDbStore: store, localStorageRef: local }))
            .resolves.toBe('04121234567');

        expect(local.getItem('business_phone')).toBe('04121234567');
        expect(store.read()).toBeNull();
        expect(store.removeItem).toHaveBeenCalledTimes(1);
    });

    it('keeps localStorage authoritative and preserves a conflicting IndexedDB value', async () => {
        const store = createStore('04149999999');
        const local = createLocalStorage([['business_phone', '04121234567']]);

        await expect(migrateBusinessPhoneToLocalStorage({ indexedDbStore: store, localStorageRef: local }))
            .resolves.toBe('04121234567');

        expect(store.read()).toBe('04149999999');
        expect(store.removeItem).not.toHaveBeenCalled();
    });

    it('leaves the IndexedDB copy intact when the local write fails', async () => {
        const store = createStore('04121234567');
        const local = { getItem: () => null, setItem: () => { throw new Error('storage unavailable'); } };

        await expect(migrateBusinessPhoneToLocalStorage({ indexedDbStore: store, localStorageRef: local }))
            .rejects.toThrow('storage unavailable');
        expect(store.read()).toBe('04121234567');
        expect(store.removeItem).not.toHaveBeenCalled();
    });
});
