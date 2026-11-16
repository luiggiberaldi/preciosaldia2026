// @vitest-environment jsdom

// Publicación del audit log (plan de egress Realtime, F1). La copia LOCAL
// conserva las 15.000 entradas / 5 años de retención fiscal (auditService);
// la copia PUBLICADA es la ventana de los últimos 7 días partida en franjas de
// 2 h. Antes era UN doc con las 1.200 más recientes (~407 KB) reescrito en
// cada venta: el 81 % de lo subido a sync_documents el 13-nov-2026.
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

import { projectSyncPayload, pushCloudSync } from '../src/hooks/useCloudSync';

const NOW = Date.parse('2026-11-14T15:30:00Z');
const H = 3_600_000;
const CURRENT_SLOT_DOC = 'abasto_audit_log_v1:2026-11-14T14';

function makeEntries(count, stepMs = 10 * 60_000) {
    // «Más reciente primero», como auditService.unshift.
    return Array.from({ length: count }, (_, i) => ({
        id: `e-${i}`,
        ts: NOW - i * stepMs,
        cat: 'VENTA',
        action: 'VENTA_COMPLETADA',
        desc: `Evento ${i}`,
    }));
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
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOW);
});

afterEach(() => {
    vi.useRealTimers();
});

describe('publicación del audit log por franjas', () => {
    it('la proyección deja solo la ventana de 7 días y deja pasar las demás claves', () => {
        const log = [...makeEntries(5), { id: 'viejo', ts: NOW - 30 * 24 * H }];
        expect(projectSyncPayload('abasto_audit_log_v1', log).map((e) => e.id)).toEqual(['e-0', 'e-1', 'e-2', 'e-3', 'e-4']);
        expect(projectSyncPayload('bodega_products_v1', [{ id: 'p1' }])).toEqual([{ id: 'p1' }]);
        expect(projectSyncPayload('abasto_audit_log_v1', 'no-array')).toBe('no-array');
    });

    it('el primer push publica una franja por doc y nunca el doc monolítico', async () => {
        const { upserts } = setupSupabaseMock();
        // 24 h de eventos cada 10 min → 12–13 franjas.
        const result = await pushCloudSync('abasto_audit_log_v1', makeEntries(144), false, true, 'PDA-V2-TEST');
        expect(result.ok).toBe(true);
        expect(upserts.length).toBeGreaterThanOrEqual(12);
        expect(upserts.every((u) => /^abasto_audit_log_v1:\d{4}-\d{2}-\d{2}T\d{2}$/.test(u.doc_id))).toBe(true);
        expect(upserts.some((u) => u.doc_id === 'abasto_audit_log_v1')).toBe(false);
    });

    it('una entrada nueva solo republica la franja en curso', async () => {
        const { upserts } = setupSupabaseMock();
        const log = makeEntries(144);
        await pushCloudSync('abasto_audit_log_v1', log, false, true, 'PDA-V2-TEST');
        const firstRound = upserts.length;

        const withNew = [{ id: 'e-nueva', ts: NOW + 1_000, cat: 'VENTA', action: 'X', desc: 'nueva' }, ...log];
        await pushCloudSync('abasto_audit_log_v1', withNew, false, true, 'PDA-V2-TEST');
        expect(upserts.length).toBe(firstRound + 1);
        expect(upserts.at(-1).doc_id).toBe(CURRENT_SLOT_DOC);
        expect(upserts.at(-1).data.payload.at(-1).id).toBe('e-nueva');
    });

    it('una mutación fuera de la ventana no republica nada', async () => {
        const { upserts } = setupSupabaseMock();
        const log = [...makeEntries(10), { id: 'viejo', ts: NOW - 30 * 24 * H, desc: 'a' }];
        await pushCloudSync('abasto_audit_log_v1', log, false, true, 'PDA-V2-TEST');
        const count = upserts.length;
        const mutated = [...log];
        mutated[10] = { ...mutated[10], desc: 'editada' };
        const third = await pushCloudSync('abasto_audit_log_v1', mutated, false, true, 'PDA-V2-TEST');
        expect(third.skipped).toBe(true);
        expect(upserts.length).toBe(count);
    });

    it('borrar el log tumba con [] las franjas publicadas de la ventana', async () => {
        const { upserts } = setupSupabaseMock();
        await pushCloudSync('abasto_audit_log_v1', makeEntries(30), false, true, 'PDA-V2-TEST');
        const publishedIds = new Set(upserts.map((u) => u.doc_id));
        const before = upserts.length;

        const cleared = [{ id: 'clear', ts: NOW + 1_000, cat: 'AUDIT', action: 'CLEAR_AUDIT', desc: 'borrado' }];
        await pushCloudSync('abasto_audit_log_v1', cleared, false, true, 'PDA-V2-TEST');
        const round = upserts.slice(before);
        const tombstones = round.filter((u) => Array.isArray(u.data.payload) && u.data.payload.length === 0);
        // Las franjas que tenían datos y ya no: tumba; la en curso: el aviso del borrado.
        expect(tombstones.length).toBe(publishedIds.size - 1);
        expect(round.find((u) => u.doc_id === CURRENT_SLOT_DOC).data.payload.map((e) => e.id)).toEqual(['clear']);
    });

    it('una vez al día borra de la nube el doc monolítico y las franjas vencidas', async () => {
        const { deletes } = setupSupabaseMock();
        localStorage.setItem('pda_audit_sync_docs_v1', JSON.stringify(['abasto_audit_log_v1:2026-11-01T08']));
        await pushCloudSync('abasto_audit_log_v1', makeEntries(3), false, true, 'PDA-V2-TEST');
        expect(deletes).toHaveLength(1);
        expect(deletes[0].device_id).toBe('PDA-V2-TEST');
        expect(deletes[0].doc_id).toEqual(['abasto_audit_log_v1', 'abasto_audit_log_v1:2026-11-01T08']);
        // Confirmado ausente → deja de rastrearse.
        expect(JSON.parse(localStorage.getItem('pda_audit_sync_docs_v1'))).not.toContain('abasto_audit_log_v1:2026-11-01T08');

        // Mismo día: no vuelve a intentar.
        await pushCloudSync('abasto_audit_log_v1', makeEntries(4), false, true, 'PDA-V2-TEST');
        expect(deletes).toHaveLength(1);
    });
});
