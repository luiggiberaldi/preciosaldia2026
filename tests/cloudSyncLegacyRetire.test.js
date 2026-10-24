// @vitest-environment jsdom

// Retiro del doc legacy `bodega_sales_v1` (migración perezosa completada).
// Medido en producción el 2026-10-24: la fila legacy del dispositivo activo
// medía 5,29 MB / 3.345 ventas mientras sus shards cubrían el historial
// completo (3.345/3.345 ids, 0 faltantes). Tras publicar la familia por
// shards, el cliente borra la fila legacy UNA sola vez por dispositivo:
//   - `[]` no sirve: significa «vaciar todas las ventas» (semántica F3), así
//     que el retiro es un DELETE, nunca un tombstone.
//   - Sin la política `device_delete_own_sync_doc` (migración 20261024), RLS
//     filtra el delete (0 filas pero la fila sigue ahí): no se marca el flag y
//     el reintento queda diferido 24 h.
import { describe, expect, it, vi, beforeEach } from 'vitest';

const supabaseMock = vi.hoisted(() => ({
    from: vi.fn(),
    channel: vi.fn(),
    removeChannel: vi.fn(),
    rpc: vi.fn(),
}));

vi.mock('../src/config/supabaseCloud', () => ({
    supabaseCloud: supabaseMock,
    supabaseCloudUrl: 'https://test.supabase.co',
}));

import { SALES_SYNC_BASE_KEY, pushCloudSync } from '../src/hooks/useCloudSync';

function makeSale(id, timestamp) {
    return { id, tipo: 'VENTA', timestamp, items: [], payments: [], totalUsd: 1 };
}

function setupRetireMock({ deletedRows = [{ id: 271780 }], deleteError = null, remainingRows = [] } = {}) {
    const upserts = [];
    const calls = { deletes: 0, confirms: 0 };
    supabaseMock.from.mockImplementation(() => ({
        upsert: async (document) => {
            upserts.push(document);
            return { data: [document], error: null };
        },
        delete: () => {
            calls.deletes += 1;
            const chain = {
                eq: () => chain,
                select: () => Promise.resolve({ data: deletedRows, error: deleteError }),
            };
            return chain;
        },
        select: () => {
            calls.confirms += 1;
            const chain = {
                eq: () => chain,
                limit: () => Promise.resolve({ data: remainingRows, error: null }),
            };
            return chain;
        },
    }));
    return { upserts, calls };
}

beforeEach(() => {
    localStorage.clear();
    supabaseMock.from.mockReset();
});

describe('retiro del doc legacy de ventas', () => {
    it('tras publicar los shards borra la fila legacy, una sola vez', async () => {
        const { upserts, calls } = setupRetireMock();
        const sales = [makeSale('a', '2026-10-01T10:00:00.000Z'), makeSale('b', '2026-10-02T10:00:00.000Z')];

        const first = await pushCloudSync(SALES_SYNC_BASE_KEY, sales, false, true, 'PDA-V2-TEST');
        expect(first.ok).toBe(true);
        // Los shards cubren el historial; la fila legacy NO se vuelve a escribir…
        expect(upserts.length).toBeGreaterThan(0);
        expect(upserts.every((doc) => doc.doc_id !== SALES_SYNC_BASE_KEY)).toBe(true);
        // …y se retira con un DELETE (no con `[]`).
        expect(calls.deletes).toBe(1);
        expect(localStorage.getItem('pda_sales_legacy_retired_v1')).toBe('1');

        // Segunda publicación (venta nueva): el retiro ya está hecho, no se repite.
        const second = await pushCloudSync(
            SALES_SYNC_BASE_KEY,
            [...sales, makeSale('c', '2026-10-03T10:00:00.000Z')],
            false,
            true,
            'PDA-V2-TEST',
        );
        expect(second.ok).toBe(true);
        expect(calls.deletes).toBe(1);
    });

    it('sin política de DELETE (RLS filtra) no marca el flag y difiere el reintento', async () => {
        // 0 filas borradas y la fila sigue visible = RLS la protegió.
        const { calls } = setupRetireMock({ deletedRows: [], remainingRows: [{ id: 271780 }] });

        const result = await pushCloudSync(
            SALES_SYNC_BASE_KEY,
            [makeSale('a', '2026-10-01T10:00:00.000Z')],
            false,
            true,
            'PDA-V2-TEST',
        );
        expect(result.ok).toBe(true);
        expect(calls.deletes).toBe(1);
        expect(calls.confirms).toBe(1);
        expect(localStorage.getItem('pda_sales_legacy_retired_v1')).toBe(null);
        // El reintento queda diferido (24 h): un push inmediato no vuelve a llamar.
        await pushCloudSync(
            SALES_SYNC_BASE_KEY,
            [makeSale('a', '2026-10-01T10:00:00.000Z'), makeSale('b', '2026-10-02T10:00:00.000Z')],
            false,
            true,
            'PDA-V2-TEST',
        );
        expect(calls.deletes).toBe(1);
    });

    it('si la fila ya no existe, el retiro queda confirmado igualmente', async () => {
        const { calls } = setupRetireMock({ deletedRows: [], remainingRows: [] });
        await pushCloudSync(
            SALES_SYNC_BASE_KEY,
            [makeSale('a', '2026-10-01T10:00:00.000Z')],
            false,
            true,
            'PDA-V2-TEST',
        );
        expect(calls.deletes).toBe(1);
        expect(calls.confirms).toBe(1);
        expect(localStorage.getItem('pda_sales_legacy_retired_v1')).toBe('1');
    });

    it('un fallo de transporte no rompe la publicación ni marca el flag', async () => {
        const { upserts, calls } = setupRetireMock({ deleteError: { message: 'fetch failed' } });
        const result = await pushCloudSync(
            SALES_SYNC_BASE_KEY,
            [makeSale('a', '2026-10-01T10:00:00.000Z')],
            false,
            true,
            'PDA-V2-TEST',
        );
        expect(result.ok).toBe(true);
        expect(upserts.length).toBeGreaterThan(0);
        expect(calls.deletes).toBe(1);
        expect(localStorage.getItem('pda_sales_legacy_retired_v1')).toBe(null);
    });

    it('el vaciado total sigue tumbando la familia con `[]` (semántica F3 intacta)', async () => {
        const { upserts } = setupRetireMock();
        const result = await pushCloudSync(SALES_SYNC_BASE_KEY, [], false, true, 'PDA-V2-TEST');
        expect(result.ok).toBe(true);
        expect(upserts.length).toBeGreaterThan(0);
        expect(upserts.every((doc) => doc.data.payload.length === 0)).toBe(true);
    });
});
