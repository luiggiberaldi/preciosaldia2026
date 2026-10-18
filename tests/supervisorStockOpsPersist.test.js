import { describe, expect, it } from 'vitest';
import {
    STOCK_OP_STORAGE_KEY,
    loadStockOpMap,
    saveStockOpMap,
} from '../src/services/supervisorStockOps';

function memoryStorage() {
    const map = new Map();
    return {
        getItem: key => (map.has(key) ? map.get(key) : null),
        setItem: (key, value) => { map.set(key, String(value)); },
        removeItem: key => { map.delete(key); },
    };
}

describe('persistencia del mapa de ops de stock', () => {
    it('guarda y restaura las ops: el stock creído sobrevive a una recarga', () => {
        const storage = memoryStorage();
        const ops = {
            p1: { state: 'applied', targetStock: 30, commandId: 'c1' },
            p2: { state: 'sending', targetStock: 5 },
        };
        saveStockOpMap(ops, storage);
        expect(loadStockOpMap(storage)).toEqual(ops);
    });

    it('descarta entradas corruptas o sin stock objetivo válido', () => {
        const storage = memoryStorage();
        storage.setItem(STOCK_OP_STORAGE_KEY, JSON.stringify({
            ok: { state: 'applied', targetStock: 30 },
            corrupta: { state: 'applied', targetStock: 'no-numero' },
            sinEstado: { targetStock: 3 },
            fantasma: 'esto no es una op',
        }));
        expect(loadStockOpMap(storage)).toEqual({ ok: { state: 'applied', targetStock: 30 } });
    });

    it('sin entradas elimina la clave (nada que restaurar)', () => {
        const storage = memoryStorage();
        saveStockOpMap({ p1: { state: 'applied', targetStock: 30 } }, storage);
        saveStockOpMap({}, storage);
        expect(storage.getItem(STOCK_OP_STORAGE_KEY)).toBeNull();
        expect(loadStockOpMap(storage)).toEqual({});
    });

    it('JSON inválido no rompe: devuelve mapa vacío', () => {
        const storage = memoryStorage();
        storage.setItem(STOCK_OP_STORAGE_KEY, '{no-json');
        expect(loadStockOpMap(storage)).toEqual({});
    });
});
