// @vitest-environment jsdom

// Techo de 500 KB por documento de sync_documents (REPORTE-CAUSA-RAIZ-EGRESS):
// helpers puros de medida/presupuesto y su wiring real en pushCloudSync. La
// política sellada aquí es "medir y avisar, nunca bloquear": un doc sobre techo
// se publica igual (bloquearlo rompería la sincronización) pero queda advertido
// con su diagnóstico; la herramienta real para caber es la migración de
// imágenes base64 → Storage (tests/productImageMigration.test.js).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => ({ upserts: [] }));

vi.mock('../src/config/supabaseCloud', () => ({
    supabaseCloud: {
        from: () => ({
            upsert: async (doc) => {
                h.upserts.push(doc);
                return { data: [doc], error: null };
            },
        }),
    },
}));

vi.mock('../src/components/Toast', () => ({ showToast: vi.fn() }));

import {
    SYNC_DOC_BUDGET_BYTES,
    measureSyncDocBytes,
    countInlineBase64Images,
    assessSyncDocBudget,
} from '../src/utils/syncDocBudget';
import { pushCloudSync } from '../src/hooks/useCloudSync';

describe('syncDocBudget (helpers puros)', () => {
    it('mide el JSON serializado del valor (string se mide tal cual)', () => {
        expect(measureSyncDocBytes('abcd')).toBe(4);
        expect(measureSyncDocBytes({ a: 1 })).toBe(JSON.stringify({ a: 1 }).length);
        expect(measureSyncDocBytes(undefined)).toBe(0);
    });

    it('un valor circular no tira la medición (devuelve 0)', () => {
        const circular = {};
        circular.self = circular;
        expect(measureSyncDocBytes(circular)).toBe(0);
    });

    it('cuenta solo las imágenes base64 embebidas del payload', () => {
        const payload = [
            { id: 'p1', image: 'data:image/png;base64,AAAA' },
            { id: 'p2', image: 'https://demo.supabase.co/storage/v1/object/public/product-images/x/y.webp' },
            { id: 'p3', image: '' },
            { id: 'p4' },
        ];
        expect(countInlineBase64Images(payload)).toBe(1);
        expect(countInlineBase64Images('nope')).toBe(0);
    });

    it('el techo es inclusivo: exactamente el presupuesto pasa, un byte más no', () => {
        const atBudget = assessSyncDocBudget({ envelope: 'x'.repeat(SYNC_DOC_BUDGET_BYTES) });
        const overBudget = assessSyncDocBudget({ envelope: 'x'.repeat(SYNC_DOC_BUDGET_BYTES + 1) });
        expect(atBudget.over).toBe(false);
        expect(overBudget.over).toBe(true);
        expect(overBudget.bytes).toBe(SYNC_DOC_BUDGET_BYTES + 1);
    });

    it('assess reporta docId e imágenes base64 para el diagnóstico', () => {
        const budget = assessSyncDocBudget({
            docId: 'bodega_products_v1',
            envelope: 'x'.repeat(SYNC_DOC_BUDGET_BYTES + 1),
            payload: [{ id: 'p1', image: 'data:image/png;base64,AAAA' }],
        });
        expect(budget).toMatchObject({
            docId: 'bodega_products_v1',
            over: true,
            inlineBase64Images: 1,
            budgetBytes: SYNC_DOC_BUDGET_BYTES,
        });
    });
});

describe('pushCloudSync · techo al publicar', () => {
    let warnSpy;

    beforeEach(() => {
        h.upserts = [];
        localStorage.clear();
        warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
        warnSpy.mockRestore();
    });

    it('un documento bajo techo se publica sin avisos y reporta su presupuesto', async () => {
        const products = [{ id: 'p1', name: 'Café', image: 'https://demo.supabase.co/storage/v1/object/public/product-images/x/y.webp' }];
        const result = await pushCloudSync('bodega_products_v1', products, true, true, 'dev-test-1');

        expect(result.ok).toBe(true);
        expect(result.budget.over).toBe(false);
        expect(result.budget.inlineBase64Images).toBe(0);
        expect(warnSpy).not.toHaveBeenCalled();
        expect(h.upserts).toHaveLength(1);
    });

    it('sobre techo se publica igual pero avisa con bytes y base64 embebidos (nunca bloquea)', async () => {
        const products = [{
            id: 'p1',
            name: 'Mayonesa',
            image: `data:image/png;base64,${'A'.repeat(600_000)}`,
        }];
        const result = await pushCloudSync('bodega_products_v1', products, true, true, 'dev-test-1');

        // La política es "medir y avisar": el upsert se hizo aunque pasara la cota.
        expect(result.ok).toBe(true);
        expect(h.upserts).toHaveLength(1);
        expect(result.budget.over).toBe(true);
        expect(result.budget.inlineBase64Images).toBe(1);
        expect(result.budget.bytes).toBeGreaterThan(SYNC_DOC_BUDGET_BYTES);
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('sobre el techo'));
    });
});
