// @vitest-environment jsdom

// Plan de egress Realtime F2: las ventas de HOY (UTC) van en tramos aparte de
// ~100 KB; los tramos cerrados siguen en 400 KB. Antes cada venta reescribía el
// último tramo del mes, que crecía hasta 400 KB (≈ 200 KB por venta).
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

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

import {
    SALES_SYNC_OPEN_PACK_BUDGET_BYTES,
    SALES_SYNC_PACK_BUDGET_BYTES,
    SALES_SYNC_TRACKING_KEY,
    buildSalesSyncPlan,
    pushCloudSync,
    resetSalesRecordBytesCache,
} from '../src/hooks/useCloudSync';

const NOW = Date.parse('2026-11-14T15:30:00Z');
const MIN = 60_000;

// ~1.6 KB por venta, como las reales.
const sale = (id, ts) => ({
    id,
    tipo: 'VENTA',
    status: 'COMPLETADA',
    timestamp: new Date(ts).toISOString(),
    totalUsd: 3.5,
    notes: 'x'.repeat(1_450),
});

// 285 ventas/día durante 14 días (medido en noviembre), la última hace 1 min.
function monthOfSales(days = 14, perDay = 285) {
    const list = [];
    const start = Date.parse('2026-11-01T12:00:00Z');
    for (let d = 0; d < days; d += 1) {
        for (let i = 0; i < perDay; i += 1) {
            const ts = start + d * 86_400_000 + i * 2 * MIN;
            if (ts < NOW) list.push(sale(`s-${d}-${i}`, ts));
        }
    }
    return list;
}

function setupSupabaseMock() {
    const upserts = [];
    const deletes = [];
    supabaseMock.from.mockImplementation(() => ({
        upsert: async (document) => {
            upserts.push(document);
            return { data: [document], error: null };
        },
        delete: () => {
            const filters = {};
            const del = {
                eq: (col, val) => { filters[col] = val; return del; },
                in: async (col, ids) => { deletes.push({ ...filters, [col]: ids }); return { error: null }; },
            };
            return del;
        },
        select: () => {
            const sel = { eq: () => sel, in: async () => ({ data: [], error: null }) };
            return sel;
        },
    }));
    return { upserts, deletes };
}

beforeEach(() => {
    localStorage.clear();
    supabaseMock.from.mockReset();
    resetSalesRecordBytesCache();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('tramo abierto de ventas (egress F2)', () => {
    it('las ventas de hoy empiezan tramo propio y no pasan de 100 KB', () => {
        const plan = buildSalesSyncPlan(monthOfSales(), { now: NOW });
        const todayStart = '2026-11-14T00:00:00.000Z';
        const open = plan.filter((s) => s.records[0].timestamp >= todayStart);
        const closed = plan.filter((s) => s.records[0].timestamp < todayStart);
        expect(open.length).toBeGreaterThan(0);
        // Ningún tramo mezcla ayer y hoy.
        expect(open.every((s) => s.records.every((r) => r.timestamp >= todayStart))).toBe(true);
        expect(closed.every((s) => s.records.every((r) => r.timestamp < todayStart))).toBe(true);
        expect(Math.max(...open.map((s) => s.bytes))).toBeLessThanOrEqual(SALES_SYNC_OPEN_PACK_BUDGET_BYTES);
        expect(Math.max(...closed.map((s) => s.bytes))).toBeLessThanOrEqual(SALES_SYNC_PACK_BUDGET_BYTES);
    });

    it('una venta nueva solo republica el último tramo de hoy (≤ 100 KB)', async () => {
        const { upserts } = setupSupabaseMock();
        const list = monthOfSales();
        await pushCloudSync('bodega_sales_v1', list, false, true, 'PDA-V2-TEST');
        const first = upserts.length;

        await pushCloudSync('bodega_sales_v1', [...list, sale('nueva', NOW)], false, true, 'PDA-V2-TEST');
        const round = upserts.slice(first);
        expect(round).toHaveLength(1);
        expect(JSON.stringify(round[0].data.payload).length).toBeLessThanOrEqual(SALES_SYNC_OPEN_PACK_BUDGET_BYTES + 2_000);
        expect(round[0].data.payload.at(-1).id).toBe('nueva');
    });

    it('al cambiar de día se reacomoda una vez y los tramos sobrantes se borran (no se tumban)', async () => {
        const { upserts, deletes } = setupSupabaseMock();
        const list = monthOfSales();
        await pushCloudSync('bodega_sales_v1', list, false, true, 'PDA-V2-TEST');
        const trackedBefore = JSON.parse(localStorage.getItem(SALES_SYNC_TRACKING_KEY));

        // Día siguiente: las ventas de ayer pasan a tramos cerrados de 400 KB.
        vi.setSystemTime(NOW + 86_400_000);
        const before = upserts.length;
        await pushCloudSync('bodega_sales_v1', [...list, sale('manana', NOW + 86_400_000)], false, true, 'PDA-V2-TEST');
        const round = upserts.slice(before);
        // Nunca una tumba `[]` en un doc de periodo (vaciaría el mes en el lector).
        expect(round.some((u) => Array.isArray(u.data.payload) && u.data.payload.length === 0)).toBe(false);
        expect(deletes).toHaveLength(1);
        const staleIds = deletes[0].doc_id;
        expect(staleIds.length).toBeGreaterThan(0);
        expect(staleIds.every((id) => trackedBefore.includes(id))).toBe(true);
        const trackedAfter = JSON.parse(localStorage.getItem(SALES_SYNC_TRACKING_KEY));
        expect(staleIds.some((id) => trackedAfter.includes(id))).toBe(false);

        // Toda venta sigue publicada exactamente una vez entre los tramos vivos.
        const live = new Map();
        for (const u of upserts) live.set(u.doc_id, u.data.payload);
        for (const id of staleIds) live.delete(id);
        const ids = [...live.values()].flat().map((r) => r.id);
        expect(new Set(ids).size).toBe(ids.length);
        expect(ids.length).toBe(list.length + 1);
    });
});
