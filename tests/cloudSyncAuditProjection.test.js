// @vitest-environment jsdom

// Proyección de sincronización del audit log: la copia LOCAL conserva las
// 15.000 entradas / 5 años de retención fiscal (auditService), pero la copia
// PUBLICADA solo lleva las AUDIT_SYNC_MAX_ENTRIES más recientes (el log está
// ordenado «más reciente primero», así que slice(0, N) son las frescas).
// Medido en producción el 2026-10-24: 5.743 entradas ≈ 1,78 MB — sobre el
// límite de ~1 MB de Realtime (eventos 413) y el techo de 500 KB de
// syncDocBudget. El historial completo viaja en los respaldos.
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

import {
    AUDIT_SYNC_MAX_ENTRIES,
    projectSyncPayload,
    pushCloudSync,
} from '../src/hooks/useCloudSync';

function makeEntries(count) {
    return Array.from({ length: count }, (_, i) => ({
        id: `e-${i}`,
        ts: 1_700_000_000_000 + i,
        cat: 'VENTA',
        action: 'VENTA_COMPLETADA',
        desc: `Evento ${i}`,
    }));
}

function setupUpsertMock() {
    const upserts = [];
    supabaseMock.from.mockImplementation(() => ({
        upsert: async (document) => {
            upserts.push(document);
            return { data: [document], error: null };
        },
    }));
    return upserts;
}

beforeEach(() => {
    localStorage.clear();
    supabaseMock.from.mockReset();
});

describe('proyección del audit log sincronizado', () => {
    it('recorta a las entradas más recientes y deja pasar las demás claves', () => {
        const log = makeEntries(AUDIT_SYNC_MAX_ENTRIES + 500);
        const projected = projectSyncPayload('abasto_audit_log_v1', log);
        // El orden «más reciente primero» se conserva: se corta la cola vieja.
        expect(projected).toHaveLength(AUDIT_SYNC_MAX_ENTRIES);
        expect(projected[0].id).toBe('e-0');
        expect(projected[projected.length - 1].id).toBe(`e-${AUDIT_SYNC_MAX_ENTRIES - 1}`);

        expect(projectSyncPayload('bodega_products_v1', [{ id: 'p1' }])).toEqual([{ id: 'p1' }]);
        expect(projectSyncPayload('abasto_audit_log_v1', 'no-array')).toBe('no-array');
    });

    it('el push publica la copia recortada, nunca el log completo', async () => {
        const upserts = setupUpsertMock();
        const log = makeEntries(3_000);

        const result = await pushCloudSync('abasto_audit_log_v1', log, false, true, 'PDA-V2-TEST');
        expect(result.ok).toBe(true);
        expect(upserts).toHaveLength(1);
        const published = upserts[0].data.payload;
        expect(published).toHaveLength(AUDIT_SYNC_MAX_ENTRIES);
    });

    it('una mutación lejos de las primeras entradas no re-publica (hash de la copia publicada)', async () => {
        const upserts = setupUpsertMock();
        const log = makeEntries(3_000);
        await pushCloudSync('abasto_audit_log_v1', log, false, true, 'PDA-V2-TEST');
        expect(upserts).toHaveLength(1);

        // Entrada nueva al frente (como hace auditService.unshift): sí cambia
        // la copia publicada y se re-publica.
        const withNew = [{ id: 'e-nueva', ts: 2_000_000_000_000, cat: 'VENTA', action: 'X', desc: 'nueva' }, ...log];
        await pushCloudSync('abasto_audit_log_v1', withNew, false, true, 'PDA-V2-TEST');
        expect(upserts).toHaveLength(2);
        expect(upserts[1].data.payload[0].id).toBe('e-nueva');

        // Mutación en la cola (posición 2.500): fuera de la proyección → sin
        // cambios. Si se hasheara el log completo esto re-publicaría 370 KB
        // idénticos en cada escritura.
        const mutatedTail = [...withNew];
        mutatedTail[2_500] = { ...mutatedTail[2_500], desc: 'editada' };
        const third = await pushCloudSync('abasto_audit_log_v1', mutatedTail, false, true, 'PDA-V2-TEST');
        expect(third.skipped).toBe(true);
        expect(upserts).toHaveLength(2);
    });
});
