// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { EMPTY_SNAPSHOT_KEYS, resetPOSDataToEmpty } from '../src/hooks/useCloudSync';

function createFakeIdb(initial = {}) {
    const entries = new Map(Object.entries(initial));
    return {
        entries,
        getItem: vi.fn(async (key) => (entries.has(key) ? entries.get(key) : null)),
        setItem: vi.fn(async (key, value) => { entries.set(key, value); }),
    };
}

describe('resetPOSDataToEmpty (F3: snapshot vacío publicable)', () => {
    it('escribe [] en las claves críticas y publica el estado vacío', async () => {
        const idbStore = createFakeIdb({ bodega_products_v1: [{ id: 'fantasma' }] });
        const publish = vi.fn(async () => ({ ok: true }));

        const result = await resetPOSDataToEmpty({ idbStore, publish });

        expect(result.ok).toBe(true);
        for (const key of EMPTY_SNAPSHOT_KEYS) {
            expect(idbStore.entries.get(key)).toEqual([]);
        }
        expect(publish).toHaveBeenCalledTimes(1);
    });

    it('reporta fallo de publicación sin lanzar excepción', async () => {
        const idbStore = createFakeIdb();
        const publish = vi.fn(async () => ({ ok: false, error: 'La sincronización no está activa' }));

        const result = await resetPOSDataToEmpty({ idbStore, publish });

        expect(result.ok).toBe(false);
        expect(result.result?.error).toMatch(/sincronización/i);
    });

    it('no publica claves ausentes como vacío: solo las claves del snapshot crítico', async () => {
        const idbStore = createFakeIdb();
        const publish = vi.fn(async () => ({ ok: true }));

        await resetPOSDataToEmpty({ idbStore, publish });

        expect(EMPTY_SNAPSHOT_KEYS).toEqual([
            'bodega_sales_v1',
            'bodega_products_v1',
            'bodega_customers_v1',
            'bodega_customer_ledger_v1',
            'bodega_accounts_v2',
        ]);
        expect(idbStore.entries.size).toBe(EMPTY_SNAPSHOT_KEYS.length);
    });
});
