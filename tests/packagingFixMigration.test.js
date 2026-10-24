// @vitest-environment jsdom
// FIX-EMPAQUE-002: corrección automática del empaque. Pruebas de las garantías:
// se aplica una sola vez, hace backup ANTES de escribir, solo toca 2 campos,
// respeta el canary (primero el equipo del dueño) y se puede deshacer en 1 clic.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    maybeRunPackagingFixMigration,
    undoPackagingFixMigration,
    hasPackagingFixUndo,
    isPackagingFixEnabled,
    PACKAGING_FIX_STATUS_KEY,
    PACKAGING_FIX_BACKUP_KEY,
    PACKAGING_FIX_LOG_KEY,
    PACKAGING_FIX_ROLLOUT,
    PACKAGING_FIX_CANARY_DEVICES,
} from '../src/utils/packagingFixMigration';
import { PRODUCTS_KEY } from '../src/utils/catalogLock';

// Almacén falso con registro de llamadas (para verificar el orden backup→escritura).
function makeStorage(initial = {}) {
    const data = new Map(Object.entries(initial).map(([k, v]) => [k, structuredClone(v)]));
    const calls = [];
    return {
        calls,
        _data: data,
        async getItem(key, fallback = null) {
            calls.push(['get', key]);
            return data.has(key) ? structuredClone(data.get(key)) : fallback;
        },
        async setItem(key, value) {
            calls.push(['set', key]);
            data.set(key, structuredClone(value));
        },
        async removeItem(key) {
            calls.push(['remove', key]);
            data.delete(key);
        },
    };
}

const SAL = {
    id: 'p-sal', name: 'SAL DEL MAR 1 KG', packagingType: 'unidad',
    unit: 'unidad', granelUnit: 'kg', stock: 25, priceUsdt: 1, costUsd: 0.6,
};
const GRANOLA = {
    id: 'p-granola', name: 'GRANOLA CEREAL', packagingType: 'unidad',
    unit: 'gramo', stock: 2.5, priceUsdt: 6, costUsd: 3,
};
const QUESO = {
    id: 'p-queso', name: 'QUESO FRESCO', packagingType: 'granel',
    unit: 'kg', granelUnit: 'kg', stock: 2.5, priceUsdt: 8, costUsd: 5,
};

const catalogo = () => [structuredClone(SAL), structuredClone(GRANOLA), structuredClone(QUESO)];

// Equipo de prueba dentro de la etapa canary (se registra solo mientras dura cada prueba).
const EQUIPO = 'PDA-V2-PRUEBA';
const inscribirCanary = () => PACKAGING_FIX_CANARY_DEVICES.push(EQUIPO);
const retirarCanary = () => {
    const i = PACKAGING_FIX_CANARY_DEVICES.indexOf(EQUIPO);
    if (i >= 0) PACKAGING_FIX_CANARY_DEVICES.splice(i, 1);
};

describe('isPackagingFixEnabled — despliegue por etapas (canary)', () => {
    it('con rollout canary, solo los equipos de la lista reciben la corrección', () => {
        expect(PACKAGING_FIX_ROLLOUT).toBe('canary');
        expect(isPackagingFixEnabled('PDA-V2-OTRO-EQUIPO')).toBe(false);
        PACKAGING_FIX_CANARY_DEVICES.push('PDA-V2-PRUEBA');
        try {
            expect(isPackagingFixEnabled('PDA-V2-PRUEBA')).toBe(true);
        } finally {
            PACKAGING_FIX_CANARY_DEVICES.pop();
        }
    });
});

describe('maybeRunPackagingFixMigration — corrección automática', () => {
    beforeEach(() => { localStorage.clear(); inscribirCanary(); });
    afterEach(retirarCanary);

    it('se aplica sola, con backup ANTES de escribir, y solo toca empaque/granelUnit', async () => {
        const storage = makeStorage({ [PRODUCTS_KEY]: catalogo() });
        const res = await maybeRunPackagingFixMigration({ storage, deviceId: EQUIPO });
        expect(res).toMatchObject({ ran: true, total: 3, corregidos: 2 }); // sal + granola; queso ya bien

        // Orden de seguridad: primero el backup, después la escritura del catálogo.
        const setCalls = storage.calls.filter(([op]) => op === 'set').map(([, key]) => key);
        expect(setCalls.indexOf(PACKAGING_FIX_BACKUP_KEY)).toBeLessThan(setCalls.indexOf(PRODUCTS_KEY));

        // Bitácora con valores anteriores para poder deshacer.
        expect(storage._data.get(PACKAGING_FIX_LOG_KEY)).toHaveLength(2);

        // Anti-daño: stock, precios, unidades e IDs intactos.
        const [sal, granola, queso] = storage._data.get(PRODUCTS_KEY);
        expect(sal).toMatchObject({ id: 'p-sal', stock: 25, priceUsdt: 1, costUsd: 0.6, unit: 'unidad' });
        expect(sal.packagingType).toBe('suelto');
        expect(sal.granelUnit).toBeNull();
        expect(granola).toMatchObject({ id: 'p-granola', stock: 2.5, unit: 'gramo', priceUsdt: 6 });
        expect(granola.packagingType).toBe('granel'); // SIGUE vendiéndose por peso
        expect(queso).toMatchObject({ id: 'p-queso', stock: 2.5, packagingType: 'granel' });
    });

    it('no corre dos veces: correr 1 vez o 5 da el mismo resultado', async () => {
        const storage = makeStorage({ [PRODUCTS_KEY]: catalogo() });
        await maybeRunPackagingFixMigration({ storage, deviceId: EQUIPO });
        const despues = structuredClone(storage._data.get(PRODUCTS_KEY));
        const segunda = await maybeRunPackagingFixMigration({ storage, deviceId: EQUIPO });
        expect(segunda).toMatchObject({ ran: false, reason: 'ya-corrido' });
        expect(storage._data.get(PRODUCTS_KEY)).toEqual(despues);
    });

    it('no escribe nada si el equipo no está en la etapa canary', async () => {
        const storage = makeStorage({ [PRODUCTS_KEY]: catalogo() });
        const res = await maybeRunPackagingFixMigration({ storage, deviceId: 'PDA-V2-OTRO-EQUIPO' });
        expect(res).toMatchObject({ ran: false, reason: 'canary' });
        expect(storage.calls.filter(([op]) => op === 'set')).toHaveLength(0);
    });

    it('no toca un catálogo vacío', async () => {
        const storage = makeStorage();
        const res = await maybeRunPackagingFixMigration({ storage, deviceId: EQUIPO });
        expect(res).toMatchObject({ ran: false, reason: 'sin-productos' });
        expect(storage.calls.filter(([op]) => op === 'set')).toHaveLength(0);
    });
});

describe('undoPackagingFixMigration — deshacer en 1 clic', () => {
    beforeEach(() => { localStorage.clear(); inscribirCanary(); });
    afterEach(retirarCanary);

    it('devuelve cada producto a su valor anterior y no se repite sola', async () => {
        const storage = makeStorage({ [PRODUCTS_KEY]: catalogo() });
        await maybeRunPackagingFixMigration({ storage, deviceId: EQUIPO });
        expect(await hasPackagingFixUndo({ storage })).toBe(true);

        const res = await undoPackagingFixMigration({ storage });
        expect(res.undone).toBe(2);

        const [sal, granola] = storage._data.get(PRODUCTS_KEY);
        expect(sal).toMatchObject({ packagingType: 'unidad', granelUnit: 'kg' }); // valor original
        expect(granola).toMatchObject({ packagingType: 'unidad', unit: 'gramo', stock: 2.5 });

        // Deshecho = no hay nada que deshacer, y la app NO vuelve a aplicarlo sola.
        expect(await hasPackagingFixUndo({ storage })).toBe(false);
        const reintent = await maybeRunPackagingFixMigration({ storage, deviceId: EQUIPO });
        expect(reintent).toMatchObject({ ran: false, reason: 'ya-corrido' });
    });

    it('el estado queda registrado para no repetir la corrección', async () => {
        const storage = makeStorage({ [PRODUCTS_KEY]: catalogo() });
        await maybeRunPackagingFixMigration({ storage, deviceId: EQUIPO });
        await undoPackagingFixMigration({ storage });
        expect(localStorage.getItem(PACKAGING_FIX_STATUS_KEY)).toBe('undone');
    });
});
