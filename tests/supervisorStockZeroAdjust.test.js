// @vitest-environment jsdom
//
// Sella el caso reportado (2026-10-25): producto nuevo con stock 0 → subir
// stock desde el supervisor. El pipeline del supervisor compone la línea,
// valida el contrato batch v2 (expectedStock: 0 es una base legítima) y arma
// el payload; la caja lo aplica sobre el producto en 0 y responde applied.
import { describe, expect, it, vi } from 'vitest';

const supabaseMock = vi.hoisted(() => ({ from: vi.fn(), channel: vi.fn(), removeChannel: vi.fn(), rpc: vi.fn() }));
vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: supabaseMock, supabaseCloudUrl: 'https://test.supabase.co' }));

import {
    buildInventoryBatchV2Payload,
    validateInventoryBatchV2Payload,
} from '../src/services/supervisorContracts';
import {
    addInventoryDraftLine,
    createInventoryDraft,
    getInventoryDraftSummary,
} from '../src/services/supervisorInventoryDraft';
import { applySupervisorInventoryBatchTransaction } from '../src/services/supervisorInventoryCommand';
import { ensureProductPresent } from '../src/services/supervisorStockOps';

function makeProduct(id, stock) {
    return {
        id,
        name: `Producto ${id}`,
        priceUsd: 1, costUsd: 0.5, priceCop: 10, costCop: 5,
        stock,
        unit: 'unidades',
        packagingType: 'suelto',
        category: 'Abarrotes',
        minStockAlert: 2,
    };
}

function makeStorage(initial = {}) {
    const state = structuredClone(initial);
    return {
        async getItem(key, fallback = null) {
            return Object.prototype.hasOwnProperty.call(state, key) ? structuredClone(state[key]) : fallback;
        },
        async setItem(key, value) { state[key] = structuredClone(value); },
        async removeItem(key) { delete state[key]; },
    };
}

describe('repro: producto nuevo con stock 0 → subir stock', () => {
    it('el pipeline del supervisor compone, valida y arma el payload v2', () => {
        const product = makeProduct('p-new', 0);
        const draft = createInventoryDraft('ingreso', { reason: 'Ajuste de stock' });
        const line = addInventoryDraftLine(draft, {
            productId: product.id,
            productName: product.name,
            inputUnit: 'unidades',
            quantityInput: 5,
            unitsPerPackage: 1,
            baseStock: 0,
            targetStock: 5,
        });
        expect(line.error).toBeFalsy();

        const summary = getInventoryDraftSummary(line.draft, [product]);
        expect(summary.invalidLines).toHaveLength(0);
        expect(summary.pendingLines).toHaveLength(1);

        const payload = buildInventoryBatchV2Payload(
            { direction: 'ingreso', reason: 'Ajuste de stock' },
            summary.pendingLines.map((l) => ({
                lineId: l.id,
                productId: l.productId,
                inputUnit: l.inputUnit,
                quantityInput: l.quantityInput,
                unitsPerPackage: l.unitsPerPackage,
                expectedStock: l.stock,
            })),
        );
        expect(validateInventoryBatchV2Payload(payload)).toBe(true);
    });

    it('la caja aplica el ajuste sobre el producto nuevo en 0', async () => {
        const product = makeProduct('p-new', 0);
        const storage = makeStorage({
            bodega_products_v1: [product],
            bodega_sales_v1: [],
        });
        const result = await applySupervisorInventoryBatchTransaction({
            storage,
            pushSync: async () => ({ ok: true }),
            payload: {
                batchVersion: 2,
                direction: 'ingreso',
                reason: 'Ajuste de stock',
                lines: [{
                    lineId: 'line-1',
                    productId: 'p-new',
                    inputUnit: 'unidades',
                    quantityInput: 5,
                    expectedStock: 0,
                }],
            },
            commandId: 'cmd-stock0',
            onLocalApplied: async () => {},
        });
        expect(result.status).toBe('applied');
        const after = await storage.getItem('bodega_products_v1', []);
        expect(after.find((p) => p.id === 'p-new')?.stock).toBe(5);
    });

    it('el producto optimista (alta en vuelo sin eco) no se rechaza como «Producto no encontrado»', () => {
        // Fail-first: si el producto todavía no está en el catálogo del lote
        // (fila optimista de un alta reciente), el resumen lo marca inválido y
        // la UI pide «Revisa las líneas marcadas antes de enviar» aunque el
        // ajuste sea legítimo. Con el producto garantizado el lote es válido.
        const product = makeProduct('p-new', 0);
        const draft = createInventoryDraft('ingreso', { reason: 'Ajuste de stock' });
        const line = addInventoryDraftLine(draft, {
            productId: product.id,
            productName: product.name,
            inputUnit: 'unidades',
            quantityInput: 5,
            unitsPerPackage: 1,
            baseStock: 0,
            targetStock: 5,
        });
        expect(line.error).toBeFalsy();

        const missing = getInventoryDraftSummary(line.draft, []);
        expect(missing.invalidLines).toHaveLength(1);
        expect(missing.invalidLines[0].error).toMatch(/Producto no encontrado/);
        expect(missing.canSubmit).toBe(false);

        const summary = getInventoryDraftSummary(line.draft, ensureProductPresent([], product));
        expect(summary.invalidLines).toHaveLength(0);
        expect(summary.pendingLines).toHaveLength(1);
        expect(summary.canSubmit).toBe(true);
    });
});
