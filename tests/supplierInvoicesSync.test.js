// @vitest-environment jsdom

// Familia `bodega_supplier_invoices_v1:<año>` (Fase 6 / visibilidad de
// proveedores en el supervisor). Sella la semántica que evita los dos fantasmas
// conocidos: (1) una factura editada/borrada debe propagarse (reemplazo de
// franja, no unión), y (2) un año que se vacía debe tumbear SU doc con `[]`
// (misma regresión que Fase 5 dejó en productos el 2026-10-26).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ upserts: [] }));

vi.mock('../src/config/supabaseCloud', () => ({
    supabaseCloud: {
        from: () => ({
            upsert: async (document) => {
                h.upserts.push(document);
                return { error: null, data: [document] };
            },
        }),
        channel: () => ({ on() { return this; }, subscribe() { return this; } }),
        removeChannel: () => Promise.resolve(),
    },
}));

import {
    SUPPLIER_INVOICES_SYNC_BASE_KEY,
    buildSupplierInvoicesSyncPlan,
    getSupplierInvoicesSyncPeriodOf,
    isSupplierInvoicesSyncDocId,
    mergeSupplierInvoicesSyncDoc,
    parseSupplierInvoicesSyncDocId,
    pushCloudSync,
} from '../src/hooks/useCloudSync';
import { validateSupervisorSyncDocument } from '../src/services/supervisorContracts';

const inv = (id, date, amountUsd = 100, extra = {}) => ({
    id,
    supplierId: 's1',
    invoiceNumber: id.toUpperCase(),
    date,
    dueDate: null,
    amountUsd,
    ...extra,
});

describe('familia de facturas · ids y periodos', () => {
    it('reconoce la familia por prefijo y deriva el año de la fecha', () => {
        expect(isSupplierInvoicesSyncDocId('bodega_supplier_invoices_v1')).toBe(true);
        expect(isSupplierInvoicesSyncDocId('bodega_supplier_invoices_v1:2026')).toBe(true);
        expect(isSupplierInvoicesSyncDocId('bodega_suppliers_v1')).toBe(false);

        expect(getSupplierInvoicesSyncPeriodOf(inv('a', '2026-03-15T12:00:00.000Z'))).toBe('2026');
        expect(getSupplierInvoicesSyncPeriodOf(inv('a', 'no-es-fecha'))).toBe('recent');
        expect(getSupplierInvoicesSyncPeriodOf({ id: 'a' })).toBe('recent');
    });

    it('parsea solo ids de la forma base:periodo', () => {
        expect(parseSupplierInvoicesSyncDocId('bodega_supplier_invoices_v1:2025')).toBe('2025');
        expect(parseSupplierInvoicesSyncDocId('bodega_supplier_invoices_v1:recent')).toBe('recent');
        expect(parseSupplierInvoicesSyncDocId('bodega_supplier_invoices_v1')).toBeNull();
        expect(parseSupplierInvoicesSyncDocId('bodega_supplier_invoices_v1:raro')).toBeNull();
    });
});

describe('buildSupplierInvoicesSyncPlan', () => {
    it('parte por año, orden canónico (fecha, id) y sin pérdidas ni duplicados', () => {
        const invoices = [
            inv('i3', '2026-02-01T12:00:00.000Z'),
            inv('i1', '2025-12-31T12:00:00.000Z'),
            inv('i2', '2026-01-15T12:00:00.000Z'),
            inv('i0', '2025-12-31T12:00:00.000Z'),
            inv('ix', undefined),
        ];
        const plan = buildSupplierInvoicesSyncPlan(invoices);

        expect(plan.map((s) => s.docId)).toEqual([
            'bodega_supplier_invoices_v1:2025',
            'bodega_supplier_invoices_v1:2026',
            'bodega_supplier_invoices_v1:recent',
        ]);
        expect(plan.find((s) => s.period === '2025').records.map((r) => r.id)).toEqual(['i0', 'i1']);
        expect(plan.find((s) => s.period === '2026').records.map((r) => r.id)).toEqual(['i2', 'i3']);
        expect(plan.find((s) => s.period === 'recent').records.map((r) => r.id)).toEqual(['ix']);
        const total = plan.reduce((sum, s) => sum + s.records.length, 0);
        expect(total).toBe(invoices.length);
    });

    it('lista vacía → plan vacío', () => {
        expect(buildSupplierInvoicesSyncPlan([])).toEqual([]);
        expect(buildSupplierInvoicesSyncPlan(undefined)).toEqual([]);
    });
});

describe('mergeSupplierInvoicesSyncDoc', () => {
    const local = [
        inv('a', '2025-01-01T12:00:00.000Z', 50),
        inv('b', '2026-01-01T12:00:00.000Z', 80),
    ];

    it('doc de año = REEMPLAZO de franja: edit y borrado se propagan', () => {
        const merged = mergeSupplierInvoicesSyncDoc(
            local,
            'bodega_supplier_invoices_v1:2026',
            [inv('b', '2026-01-01T12:00:00.000Z', 999)],
        );
        expect(merged.find((r) => r.id === 'b')?.amountUsd).toBe(999);
        expect(merged.find((r) => r.id === 'a')?.amountUsd).toBe(50); // otro año intacto

        const afterDelete = mergeSupplierInvoicesSyncDoc(
            local,
            'bodega_supplier_invoices_v1:2026',
            [],
        );
        expect(afterDelete.map((r) => r.id)).toEqual(['a']); // `[]` vacía SOLO 2026
    });

    it('doc base (defensivo) es unión con «lo entrante gana» y nunca limpia', () => {
        const merged = mergeSupplierInvoicesSyncDoc(
            local,
            SUPPLIER_INVOICES_SYNC_BASE_KEY,
            [inv('b', '2026-01-01T12:00:00.000Z', 999), inv('c', '2026-05-01T12:00:00.000Z')],
        );
        expect(merged.map((r) => r.id).sort()).toEqual(['a', 'b', 'c']);
        expect(merged.find((r) => r.id === 'b')?.amountUsd).toBe(999);

        expect(mergeSupplierInvoicesSyncDoc(local, SUPPLIER_INVOICES_SYNC_BASE_KEY, [])).toEqual(local);
    });

    it('payload no-arreglo es no-op y doc desconocido no toca nada', () => {
        expect(mergeSupplierInvoicesSyncDoc(local, 'bodega_supplier_invoices_v1:2026', 'basura')).toEqual(local);
        expect(mergeSupplierInvoicesSyncDoc(local, 'otra_clave', [inv('z', '2026-01-01T12:00:00.000Z')])).toEqual(local);
    });
});

describe('contratos de sync', () => {
    it('acepta los payloads de proveedores y facturas y rechaza no-arreglos', () => {
        expect(validateSupervisorSyncDocument('bodega_suppliers_v1', []).valid).toBe(true);
        expect(validateSupervisorSyncDocument('bodega_supplier_invoices_v1', [inv('a', '2026-01-01T12:00:00.000Z')]).valid).toBe(true);
        expect(validateSupervisorSyncDocument('bodega_supplier_invoices_v1', { no: 'array' }).valid).toBe(false);
    });
});

describe('pushCloudSync · familia de facturas', () => {
    beforeEach(() => {
        localStorage.clear();
        h.upserts.length = 0;
    });

    it('publica un doc por año y solo re-escribe el año tocado', async () => {
        const first = await pushCloudSync('bodega_supplier_invoices_v1', [
            inv('a', '2025-06-01T12:00:00.000Z'),
            inv('b', '2026-02-01T12:00:00.000Z'),
        ], false, true, 'device-test');
        expect(first.ok).toBe(true);
        expect(h.upserts.map((d) => d.doc_id)).toEqual([
            'bodega_supplier_invoices_v1:2025',
            'bodega_supplier_invoices_v1:2026',
        ]);
        expect(h.upserts[0].data.payload.map((r) => r.id)).toEqual(['a']);

        h.upserts.length = 0;
        // Edit de la factura de 2026: solo SU año viaja.
        const second = await pushCloudSync('bodega_supplier_invoices_v1', [
            inv('a', '2025-06-01T12:00:00.000Z'),
            inv('b', '2026-02-01T12:00:00.000Z', 999),
        ], false, true, 'device-test');
        expect(second.ok).toBe(true);
        expect(h.upserts).toHaveLength(1);
        expect(h.upserts[0].doc_id).toBe('bodega_supplier_invoices_v1:2026');

        h.upserts.length = 0;
        // Valor idéntico: la deduplicación anti-eco no se pierde.
        const third = await pushCloudSync('bodega_supplier_invoices_v1', [
            inv('a', '2025-06-01T12:00:00.000Z'),
            inv('b', '2026-02-01T12:00:00.000Z', 999),
        ], false, true, 'device-test');
        expect(third).toMatchObject({ ok: true, skipped: true, reason: 'Sin cambios' });
        expect(h.upserts).toHaveLength(0);
    });

    it('un año que se vacía se tumba con [] (sin facturas fantasma en el monitor)', async () => {
        await pushCloudSync('bodega_supplier_invoices_v1', [
            inv('a', '2025-06-01T12:00:00.000Z'),
            inv('b', '2026-02-01T12:00:00.000Z'),
        ], false, true, 'device-test');

        h.upserts.length = 0;
        // Toda la factura de 2026 se borró (o se movió a otro año): su doc debe
        // tumbearse, NO quedar como franja vieja con datos fantasma.
        const result = await pushCloudSync('bodega_supplier_invoices_v1', [
            inv('a', '2025-06-01T12:00:00.000Z'),
        ], false, true, 'device-test');

        expect(result.ok).toBe(true);
        expect(h.upserts).toHaveLength(1);
        expect(h.upserts[0].doc_id).toBe('bodega_supplier_invoices_v1:2026');
        expect(h.upserts[0].data.payload).toEqual([]);

        // La tumba no se re-emite.
        h.upserts.length = 0;
        await pushCloudSync('bodega_supplier_invoices_v1', [
            inv('a', '2025-06-01T12:00:00.000Z'),
            inv('b', '2026-02-01T12:00:00.000Z'),
        ], false, true, 'device-test');
        await pushCloudSync('bodega_supplier_invoices_v1', [
            inv('a', '2025-06-01T12:00:00.000Z'),
        ], false, true, 'device-test');
        const tombstones = h.upserts.filter((d) => d.doc_id === 'bodega_supplier_invoices_v1:2026'
            && Array.isArray(d.data.payload) && d.data.payload.length === 0);
        expect(tombstones).toHaveLength(1);
    });

    it('la lista vacía (vaciado total, F3) tumba todos los docs publicados', async () => {
        await pushCloudSync('bodega_supplier_invoices_v1', [
            inv('a', '2025-06-01T12:00:00.000Z'),
            inv('b', '2026-02-01T12:00:00.000Z'),
        ], false, true, 'device-test');

        h.upserts.length = 0;
        const result = await pushCloudSync('bodega_supplier_invoices_v1', [], false, true, 'device-test');

        expect(result.ok).toBe(true);
        expect(h.upserts.map((d) => d.doc_id)).toEqual([
            'bodega_supplier_invoices_v1:2025',
            'bodega_supplier_invoices_v1:2026',
        ]);
        for (const doc of h.upserts) expect(doc.data.payload).toEqual([]);
    });
});
