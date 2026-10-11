import localforage from 'localforage';

export const BUSINESS_PHONE_KEY = 'business_phone';
const businessStorage = localforage.createInstance({
    name: 'BodegaApp',
    storeName: 'bodega_app_data',
});

/**
 * Recovers business_phone values left in IndexedDB by an older export flow.
 * localStorage remains authoritative because synchronous settings and ticket
 * consumers read from it. The IndexedDB copy is removed only after the local
 * write is verified; conflicting copies are preserved for manual recovery.
 */
export async function migrateBusinessPhoneToLocalStorage({
    indexedDbStore = businessStorage,
    localStorageRef = globalThis.localStorage,
} = {}) {
    const currentPhone = localStorageRef.getItem(BUSINESS_PHONE_KEY);
    const legacyPhone = await indexedDbStore.getItem(BUSINESS_PHONE_KEY);

    if (currentPhone !== null) {
        if (legacyPhone === currentPhone) {
            await indexedDbStore.removeItem(BUSINESS_PHONE_KEY);
        }
        return currentPhone;
    }

    if (legacyPhone === null || legacyPhone === undefined) return null;

    const phone = String(legacyPhone);
    localStorageRef.setItem(BUSINESS_PHONE_KEY, phone);
    if (localStorageRef.getItem(BUSINESS_PHONE_KEY) !== phone) {
        throw new Error('No se pudo verificar la migración del teléfono del negocio.');
    }

    await indexedDbStore.removeItem(BUSINESS_PHONE_KEY);
    return phone;
}
