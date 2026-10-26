// @vitest-environment jsdom

// Fase 4 (plan 2026-10-20): partir el documento monolítico `bodega_sales_v1`
// (~600 KB reales, 4.5 MB reportados en el incidente) en documentos por
// periodo (`bodega_sales_v1:<YYYY-MM>` / `bodega_sales_v1:recent`, con shards
// `#N` cuando un mes es enorme), con merge en el lector y compatibilidad con
// documentos legacy. Semántica sellada aquí:
//   - Periodo = `YYYY-MM` del `timestamp` de la venta; sin fecha válida → `recent`.
//   - Escritura incremental: solo se reescribe el periodo tocado (hash por doc).
//   - Legacy (`bodega_sales_v1`) sigue legible; al escribir NO se reescribe
//     (migración perezosa). Solo el vaciado total lo tumba con `[]`.
//   - `[]` en un doc de periodo limpia ese periodo; `[]` en el legacy limpia todo.
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
    SALES_SYNC_BASE_KEY,
    SALES_SYNC_MAX_DOC_BYTES,
    SALES_SYNC_TRACKING_KEY,
    buildSalesSyncPlan,
    getSalesSyncPeriodOf,
    isSalesSyncDocId,
    mergeSalesSyncDoc,
    productBucketOf,
    productsDocIdFor,
    pushCloudSync,
    resetSalesRecordBytesCache,
    salesRecordBytesCacheView,
} from '../src/hooks/useCloudSync';
import {
    SUPERVISOR_INVENTORY_JOURNAL_KEY,
    retryInventoryPublish,
} from '../src/services/supervisorInventoryCommand';

// Venta con la forma real del checkout (campos principales del backup de
// producción del 2026-10-19: mediana ~1.5 KB por venta).
function makeSale(id, timestamp, extra = {}) {
    return {
        id,
        tipo: 'VENTA',
        status: 'COMPLETADA',
        timestamp,
        rate: 36.5,
        tasaCop: 0,
        copEnabled: false,
        rateSource: 'BCV Auto',
        saleNumber: id.slice(0, 8),
        items: [
            {
                id: 'prod-1',
                name: 'Arroz Diana 1kg',
                qty: 2,
                priceUsd: 1.25,
                pricingMode: 'unit',
                priceBsUsdRef: 45.62,
                priceCop: null,
                costBs: 30,
                costUsd: 0.82,
                isWeight: false,
                unit: 'unidades',
                granelUnit: 'unidades',
                packagingType: null,
                isCashAdvance: null,
                montoEfectivo: null,
                montoComision: null,
                comisionPct: null,
                currency: 'USD',
                exactBs: null,
            },
        ],
        payments: [{ methodId: 'cash', methodLabel: 'Efectivo', amountUsd: 2.5, currency: 'USD' }],
        totalUsd: 2.5,
        totalBs: 91.25,
        totalCop: 0,
        cartSubtotalUsd: 2.5,
        baseUsd: 2.5,
        ivaUsd: 0,
        discountType: null,
        discountValue: 0,
        discountAmountUsd: 0,
        changeUsd: 0,
        changeBs: 0,
        vueltoParaMonedero: 0,
        changeAllocation: {
            totalUsd: 0,
            keptInCashUsd: 0,
            deliveredUsd: 0,
            deliveredBs: 0,
            creditedUsd: 0,
        },
        customerId: null,
        customerName: 'Consumidor Final',
        customerDocument: null,
        customerPhone: null,
        fiadoUsd: 0,
        casheaUsd: 0,
        tipDonated: 0,
        granelUnitMode: 'kg_lt',
        ...extra,
    };
}

function makeSalesInMonth(month, count, { startId = 0, size = 0 } = {}) {
    const sales = [];
    for (let i = 0; i < count; i += 1) {
        const day = String((i % 28) + 1).padStart(2, '0');
        const sale = makeSale(`${month}-${String(startId + i).padStart(6, '0')}`, `${month}-${day}T10:00:00.000Z`);
        if (size > 0) sale.notas = 'x'.repeat(size);
        sales.push(sale);
    }
    return sales;
}

function sortedIds(records) {
    return records.map((r) => r.id).sort();
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
    // El cache de tamaños por registro vive en el módulo (entre pushes): se
    // limpia por test para que un id reutilizado con otro contenido no arrastre
    // bytes viejos al empaquetado de shards.
    resetSalesRecordBytesCache();
});

describe('periodo de una venta', () => {
    it('usa el YYYY-MM del timestamp y cae a recent sin fecha válida', () => {
        expect(getSalesSyncPeriodOf(makeSale('a', '2026-08-05T10:00:00.000Z'))).toBe('2026-08');
        expect(getSalesSyncPeriodOf({ id: 'b' })).toBe('recent');
        expect(getSalesSyncPeriodOf({ id: 'c', timestamp: 'basura' })).toBe('recent');
    });

    it('reconoce los doc ids de la familia y el legacy', () => {
        expect(isSalesSyncDocId('bodega_sales_v1')).toBe(true);
        expect(isSalesSyncDocId('bodega_sales_v1:2026-08')).toBe(true);
        expect(isSalesSyncDocId('bodega_sales_v1:2026-08#2')).toBe(true);
        expect(isSalesSyncDocId('bodega_sales_v1:recent')).toBe(true);
        expect(isSalesSyncDocId('bodega_products_v1')).toBe(false);
        expect(isSalesSyncDocId('bodega_sales_v2:2026-08')).toBe(false);
    });
});

describe('(a) un mes con 10k ventas produce documentos < 500 KB', () => {
    it('parte en shards y ningún documento supera el tope', () => {
        const sales = makeSalesInMonth('2026-08', 10000);
        const plan = buildSalesSyncPlan(sales);

        expect(plan.length).toBeGreaterThan(1);
        for (const slice of plan) {
            expect(JSON.stringify(slice.records).length).toBeLessThan(SALES_SYNC_MAX_DOC_BYTES);
            expect(slice.period).toBe('2026-08');
        }

        // Round-trip de la partición: ninguna venta se pierde ni se duplica.
        const merged = plan.flatMap((slice) => slice.records);
        expect(sortedIds(merged)).toEqual(sortedIds(sales));
        expect(new Set(merged.map((r) => r.id)).size).toBe(sales.length);
    });

    it('los shards llevan el nombre del plan: periodo y sufijo #N', () => {
        const sales = makeSalesInMonth('2026-08', 2000, { size: 700 });
        const plan = buildSalesSyncPlan(sales);
        expect(plan[0].docId).toBe('bodega_sales_v1:2026-08');
        expect(plan[1].docId).toBe('bodega_sales_v1:2026-08#2');
    });
});

describe('(b) el lector mergea periodos sin perder ventas', () => {
    it('round-trip: particionar varios meses y mergear en desorden conserva todo', () => {
        const sales = [
            ...makeSalesInMonth('2026-07', 120, { startId: 0 }),
            ...makeSalesInMonth('2026-08', 300, { startId: 0 }),
            ...makeSalesInMonth('2026-10', 16, { startId: 0 }),
            makeSale('sin-fecha-1', null),
        ];
        const plan = buildSalesSyncPlan(sales);

        // El lector aplica los docs en orden "aleatorio" (como llegan del pull).
        const shuffled = [...plan].reverse();
        let local = [];
        for (const slice of shuffled) {
            local = mergeSalesSyncDoc(local, slice.docId, slice.records);
        }

        expect(sortedIds(local)).toEqual(sortedIds(sales));
    });

    it('mezcla de legacy + periodos sin perder ventas ni versiones', () => {
        const saleVoided = makeSale('venta-anulada', '2026-08-10T09:00:00.000Z');
        const saleOk = makeSale('venta-ok', '2026-08-11T09:00:00.000Z');

        // El legacy congelado trae la versión PREVIA a la anulación.
        const legacyCopy = [
            { ...saleVoided, status: 'COMPLETADA' },
            saleOk,
        ];
        const periodCopy = [
            { ...saleVoided, status: 'ANULADA' },
            saleOk,
        ];

        // Orden 1: legacy primero, periodo después → la anulación gana.
        let local = mergeSalesSyncDoc([], 'bodega_sales_v1', legacyCopy);
        local = mergeSalesSyncDoc(local, 'bodega_sales_v1:2026-08', periodCopy);
        expect(local.find((r) => r.id === 'venta-anulada').status).toBe('ANULADA');

        // Orden 2: periodo primero, legacy después → la anulación sigue ganando
        // (el legacy es union-only: nunca pisa registros existentes).
        let local2 = mergeSalesSyncDoc([], 'bodega_sales_v1:2026-08', periodCopy);
        local2 = mergeSalesSyncDoc(local2, 'bodega_sales_v1', legacyCopy);
        expect(local2.find((r) => r.id === 'venta-anulada').status).toBe('ANULADA');
        expect(sortedIds(local2)).toEqual(['venta-anulada', 'venta-ok']);
    });

    it('un doc de periodo vacío limpia SOLO su periodo (tombstone)', () => {
        const local = [
            makeSale('jul-1', '2026-07-01T10:00:00.000Z'),
            makeSale('ago-1', '2026-08-01T10:00:00.000Z'),
            makeSale('sin-fecha', null),
        ];
        const after = mergeSalesSyncDoc(local, 'bodega_sales_v1:2026-08', []);
        expect(sortedIds(after)).toEqual(['jul-1', 'sin-fecha']);
    });
});

describe('(c) la escritura incremental solo reescribe el periodo tocado', () => {
    it('la primera escritura publica todos los periodos; una venta nueva solo toca el suyo', async () => {
        const upserts = setupUpsertMock();
        const sales = [
            ...makeSalesInMonth('2026-07', 30),
            ...makeSalesInMonth('2026-08', 30),
        ];

        const first = await pushCloudSync(SALES_SYNC_BASE_KEY, sales, false, true, 'PDA-V2-TEST');
        expect(first.ok).toBe(true);
        const firstDocs = upserts.map((d) => d.doc_id);
        expect(firstDocs).toContain('bodega_sales_v1:2026-07');
        expect(firstDocs).toContain('bodega_sales_v1:2026-08');
        expect(firstDocs.every((id) => isSalesSyncDocId(id))).toBe(true);

        upserts.length = 0;
        // Nueva venta en agosto: solo los docs de agosto se reescriben.
        const withNewSale = [...sales, makeSale('ago-nueva', '2026-08-20T10:00:00.000Z')];
        const second = await pushCloudSync(SALES_SYNC_BASE_KEY, withNewSale, false, true, 'PDA-V2-TEST');
        expect(second.ok).toBe(true);

        const secondDocs = upserts.map((d) => d.doc_id);
        expect(secondDocs.length).toBeGreaterThan(0);
        expect(secondDocs.every((id) => id.startsWith('bodega_sales_v1:2026-08'))).toBe(true);
    });

    it('sin cambios locales no se reescribe ningún documento', async () => {
        const upserts = setupUpsertMock();
        const sales = makeSalesInMonth('2026-09', 10);

        await pushCloudSync(SALES_SYNC_BASE_KEY, sales, false, true, 'PDA-V2-TEST');
        upserts.length = 0;

        const again = await pushCloudSync(SALES_SYNC_BASE_KEY, sales, false, true, 'PDA-V2-TEST');
        expect(again.ok).toBe(true);
        expect(again.skipped).toBe(true);
        expect(upserts).toHaveLength(0);
    });

    it('los shards de un mes gigante solo reescriben los tocados cuando crece el final', async () => {
        const upserts = setupUpsertMock();
        const sales = makeSalesInMonth('2026-08', 2000, { size: 700 });

        await pushCloudSync(SALES_SYNC_BASE_KEY, sales, false, true, 'PDA-V2-TEST');
        const firstCount = upserts.length;
        expect(firstCount).toBeGreaterThan(1);
        upserts.length = 0;

        const withNew = [...sales, makeSale('ago-final', '2026-08-28T23:59:00.000Z')];
        await pushCloudSync(SALES_SYNC_BASE_KEY, withNew, false, true, 'PDA-V2-TEST');

        // Appends al final del periodo: no se reescribe el historial completo.
        expect(upserts.length).toBeLessThan(firstCount);
        expect(upserts.every((d) => d.doc_id.startsWith('bodega_sales_v1:2026-08'))).toBe(true);
    });
});

describe('(d) compatibilidad legacy y migración perezosa al escribir', () => {
    it('un documento monolítico viejo sigue leyéndose completo', () => {
        const legacySales = makeSalesInMonth('2026-07', 50);
        const merged = mergeSalesSyncDoc([], SALES_SYNC_BASE_KEY, legacySales);
        expect(sortedIds(merged)).toEqual(sortedIds(legacySales));
    });

    it('al escribir NO se reescribe el doc legacy: solo se publican periodos', async () => {
        const upserts = setupUpsertMock();
        const sales = makeSalesInMonth('2026-08', 20);

        await pushCloudSync(SALES_SYNC_BASE_KEY, sales, false, true, 'PDA-V2-TEST');

        const docs = upserts.map((d) => d.doc_id);
        expect(docs).not.toContain(SALES_SYNC_BASE_KEY);
        expect(docs.every((id) => id.startsWith(`${SALES_SYNC_BASE_KEY}:`))).toBe(true);
    });

    it('el vaciado total tumba el legacy y todos los periodos publicados', async () => {
        const upserts = setupUpsertMock();
        const sales = [
            ...makeSalesInMonth('2026-07', 5),
            ...makeSalesInMonth('2026-08', 5),
        ];
        await pushCloudSync(SALES_SYNC_BASE_KEY, sales, false, true, 'PDA-V2-TEST');
        upserts.length = 0;

        const clear = await pushCloudSync(SALES_SYNC_BASE_KEY, [], false, true, 'PDA-V2-TEST');
        expect(clear.ok).toBe(true);

        const docs = upserts.map((d) => d.doc_id);
        expect(docs).toContain(SALES_SYNC_BASE_KEY);
        expect(docs).toContain('bodega_sales_v1:2026-07');
        expect(docs).toContain('bodega_sales_v1:2026-08');
        expect(upserts.every((d) => d.data.payload.length === 0)).toBe(true);

        // Un lector que aplica esas tumbas queda sin ventas.
        let local = [...sales];
        for (const doc of upserts) {
            local = mergeSalesSyncDoc(local, doc.doc_id, doc.data.payload);
        }
        expect(local).toEqual([]);
    });

    it('un vaciado del legacy ([]) limpia todo lo que el lector tenga', () => {
        const local = makeSalesInMonth('2026-08', 10);
        expect(mergeSalesSyncDoc(local, SALES_SYNC_BASE_KEY, [])).toEqual([]);
    });

    it('recuerda los doc ids publicados para poder tumbarlos después', async () => {
        const upserts = setupUpsertMock();
        await pushCloudSync(SALES_SYNC_BASE_KEY, makeSalesInMonth('2026-08', 4), false, true, 'PDA-V2-TEST');

        const tracked = JSON.parse(localStorage.getItem(SALES_SYNC_TRACKING_KEY) || '[]');
        expect(tracked).toEqual(expect.arrayContaining(['bodega_sales_v1:2026-08']));
        expect(upserts.map((d) => d.doc_id).every((id) => tracked.includes(id))).toBe(true);
    });
});

// Fase 3 (plan 2026-10-21 de cuelgue de caja): la publicación del lote de
// inventario empuja la familia de ventas SIN force, para que el hash por
// periodo/shard se salte los documentos intactos y solo reescriba el periodo
// tocado. Desacople (2026-10-22): el lote ya NO publica productos — solo la
// familia de ventas, salvo un journal legacy que aún la deba. Se sella con la
// publicación real (pushCloudSync) vía retryInventoryPublish, que es
// exactamente como la caja publica un lote después de un corte.
describe('(e) el lote de inventario publica la familia de ventas incrementalmente', () => {
    const JOURNAL = SUPERVISOR_INVENTORY_JOURNAL_KEY;

    function makeMemoryStorage(initial = {}) {
        const state = structuredClone(initial);
        return {
            state,
            async getItem(key, fallback = null) {
                return Object.prototype.hasOwnProperty.call(state, key) ? structuredClone(state[key]) : fallback;
            },
            async setItem(key, value) {
                state[key] = structuredClone(value);
            },
            async removeItem(key) {
                delete state[key];
            },
        };
    }

    // Desacople 2026-10-22: los journals nuevos solo deben la familia de ventas
    // (el catálogo es baseline y su stock viaja como efecto en los movimientos).
    // `pendingKeys` es parámetro para poder simular un journal legacy que aún
    // deba el catálogo.
    function pendingPublishJournal(commandId, { products, sales, pendingKeys = ['bodega_sales_v1'] }) {
        return {
            version: 1,
            commandId,
            state: 'published_pending',
            createdAt: '2026-10-21T12:00:00.000Z',
            pendingKeys,
            docs: [
                { key: 'bodega_products_v1', before: products, after: products },
                { key: 'bodega_sales_v1', before: sales, after: sales },
            ],
        };
    }

    const realPush = (key, value, force) => pushCloudSync(key, value, force, true, 'PDA-V2-TEST');

    /**
     * Siembra los hashes por periodo con una publicación previa completa (como
     * la del primer lote) y devuelve el storage ya listo para un lote pendiente.
     */
    async function seedPublishedState(products, sales) {
        const storage = makeMemoryStorage({ bodega_products_v1: products, bodega_sales_v1: sales });
        const seeded = await pushCloudSync(SALES_SYNC_BASE_KEY, sales, false, true, 'PDA-V2-TEST');
        expect(seeded.ok).toBe(true);
        return storage;
    }

    it('(a) un lote que agrega movimientos al periodo corriente solo reescribe ese periodo', async () => {
        const upserts = setupUpsertMock();
        const products = [{ id: 'p-1', name: 'Arroz Diana 1kg', stock: 10 }];
        const sales = [...makeSalesInMonth('2026-07', 5), ...makeSalesInMonth('2026-08', 5)];
        const storage = await seedPublishedState(products, sales);
        upserts.length = 0;

        // Estado local ya aplicado: el lote agregó UN movimiento en agosto.
        const salesAfter = [...sales, makeSale('ago-lote-1', '2026-08-25T10:00:00.000Z')];
        await storage.setItem('bodega_sales_v1', salesAfter);
        await storage.setItem(JOURNAL, pendingPublishJournal('cmd-inc-1', { products, sales: salesAfter }));

        const retry = await retryInventoryPublish({ storage, pushSync: realPush });
        expect(retry).toEqual({ retried: true, ok: true, commandId: 'cmd-inc-1' });

        const docs = upserts.map((d) => d.doc_id);
        // El lote ya NO publica productos (desacople 2026-10-22): el catálogo es
        // baseline y su stock viaja como efecto en los movimientos de ventas.
        expect(docs).not.toContain('bodega_products_v1');
        // Ventas: solo el periodo tocado; julio quedó intacto en la nube.
        expect(docs.some((id) => id.startsWith('bodega_sales_v1:2026-08'))).toBe(true);
        expect(docs.some((id) => id.startsWith('bodega_sales_v1:2026-07'))).toBe(false);
    });

    it('(b) una mutación en un periodo viejo solo reescribe ese periodo', async () => {
        const upserts = setupUpsertMock();
        const products = [{ id: 'p-1', name: 'Arroz Diana 1kg', stock: 10 }];
        const sales = [...makeSalesInMonth('2026-07', 5), ...makeSalesInMonth('2026-08', 5)];
        const storage = await seedPublishedState(products, sales);
        upserts.length = 0;

        // Anulación de una venta de JULIO: mutación en un periodo viejo.
        const salesAfter = sales.map((s) => (s.id === '2026-07-000003' ? { ...s, status: 'ANULADA' } : s));
        await storage.setItem('bodega_sales_v1', salesAfter);
        await storage.setItem(JOURNAL, pendingPublishJournal('cmd-old-1', { products, sales: salesAfter }));

        const retry = await retryInventoryPublish({ storage, pushSync: realPush });
        expect(retry).toEqual({ retried: true, ok: true, commandId: 'cmd-old-1' });

        const docs = upserts.map((d) => d.doc_id);
        expect(docs.some((id) => id.startsWith('bodega_sales_v1:2026-07'))).toBe(true);
        expect(docs.some((id) => id.startsWith('bodega_sales_v1:2026-08'))).toBe(false);
    });

    it('(c) un fallo de red + retry con el mismo commandId termina con el periodo fallido publicado', async () => {
        const upserts = setupUpsertMock();
        const products = [{ id: 'p-1', name: 'Arroz Diana 1kg', stock: 10 }];
        const sales = [...makeSalesInMonth('2026-07', 5), ...makeSalesInMonth('2026-08', 5)];
        const storage = await seedPublishedState(products, sales);
        upserts.length = 0;

        const salesAfter = [...sales, makeSale('ago-lote-2', '2026-08-26T10:00:00.000Z')];
        await storage.setItem('bodega_sales_v1', salesAfter);
        await storage.setItem(JOURNAL, pendingPublishJournal('cmd-flaky-1', { products, sales: salesAfter }));

        let salesAttempts = 0;
        const flakyPush = async (key, value, force) => {
            if (key === 'bodega_sales_v1') {
                salesAttempts += 1;
                if (salesAttempts === 1) return { ok: false, error: 'red caída' };
            }
            return realPush(key, value, force);
        };

        const first = await retryInventoryPublish({ storage, pushSync: flakyPush });
        expect(first).toEqual({ retried: true, ok: false, commandId: 'cmd-flaky-1', failedKeys: ['bodega_sales_v1'] });
        expect(storage.state[JOURNAL]).toMatchObject({ state: 'published_pending', pendingKeys: ['bodega_sales_v1'] });

        const second = await retryInventoryPublish({ storage, pushSync: flakyPush });
        expect(second).toMatchObject({ retried: true, ok: true, commandId: 'cmd-flaky-1' });
        expect(storage.state[JOURNAL]).toBeUndefined();

        const docs = upserts.map((d) => d.doc_id);
        expect(docs.some((id) => id.startsWith('bodega_sales_v1:2026-08'))).toBe(true);
    });

    it('(d) el vaciado total publica las tumbas de todos los periodos publicados', async () => {
        const upserts = setupUpsertMock();
        const products = [{ id: 'p-1', name: 'Arroz Diana 1kg', stock: 10 }];
        const sales = [...makeSalesInMonth('2026-07', 3), ...makeSalesInMonth('2026-08', 3)];
        const storage = await seedPublishedState(products, sales);
        upserts.length = 0;

        await storage.setItem('bodega_sales_v1', []);
        await storage.setItem(JOURNAL, pendingPublishJournal('cmd-vacio-1', { products, sales: [] }));

        const retry = await retryInventoryPublish({ storage, pushSync: realPush });
        expect(retry).toEqual({ retried: true, ok: true, commandId: 'cmd-vacio-1' });

        const salesDocs = upserts.filter((d) => isSalesSyncDocId(d.doc_id));
        expect(salesDocs.map((d) => d.doc_id)).toEqual(expect.arrayContaining([
            SALES_SYNC_BASE_KEY,
            'bodega_sales_v1:2026-07',
            'bodega_sales_v1:2026-08',
        ]));
        expect(salesDocs.every((d) => d.data.payload.length === 0)).toBe(true);
    });

    it('(e) un journal legacy con ambas claves se liquida publicando lo que dice', async () => {
        const upserts = setupUpsertMock();
        const products = [{ id: 'p-1', name: 'Arroz Diana 1kg', stock: 10 }];
        const sales = makeSalesInMonth('2026-07', 5);
        const storage = await seedPublishedState(products, sales);
        upserts.length = 0;

        const salesAfter = [...sales, makeSale('jul-lote-legacy', '2026-07-20T10:00:00.000Z')];
        await storage.setItem('bodega_sales_v1', salesAfter);
        await storage.setItem(JOURNAL, pendingPublishJournal('cmd-legacy-1', {
            products,
            sales: salesAfter,
            pendingKeys: ['bodega_products_v1', 'bodega_sales_v1'],
        }));

        const retry = await retryInventoryPublish({ storage, pushSync: realPush });
        expect(retry).toEqual({ retried: true, ok: true, commandId: 'cmd-legacy-1' });

        const docs = upserts.map((d) => d.doc_id);
        // Fase 5 (shards de productos): el catálogo ya no se publica como
        // monolito — el journal legacy liquida su pendingKey publicando la
        // familia por buckets de hash.
        expect(docs).toContain(productsDocIdFor(productBucketOf('p-1')));
        expect(docs.some((id) => id.startsWith('bodega_sales_v1:2026-07'))).toBe(true);
        expect(storage.state[JOURNAL]).toBeUndefined();
    });

    it('(f) la red de seguridad: el auto-enqueue de ventas ya no tiene nada que subir (dedup por hash)', async () => {
        const upserts = setupUpsertMock();
        const products = [{ id: 'p-1', name: 'Arroz Diana 1kg', stock: 10 }];
        const sales = makeSalesInMonth('2026-08', 5);
        const storage = await seedPublishedState(products, sales);
        upserts.length = 0;

        const salesAfter = [...sales, makeSale('ago-red-1', '2026-08-25T10:00:00.000Z')];
        await storage.setItem('bodega_sales_v1', salesAfter);
        await storage.setItem(JOURNAL, pendingPublishJournal('cmd-red-1', { products, sales: salesAfter }));

        const retry = await retryInventoryPublish({ storage, pushSync: realPush });
        expect(retry).toMatchObject({ retried: true, ok: true });
        const afterPublish = upserts.length;
        expect(afterPublish).toBeGreaterThan(0);

        // La escritura local de ventas va SIN skipSyncPush (red de seguridad
        // §3.1.6 del plan de desacople): el interceptor la encola y, cuando el
        // debounce dispara, el mismo estado ya está publicado — el dedup por
        // hash evita el segundo viaje (0 upserts).
        const echo = await realPush('bodega_sales_v1', salesAfter, false);
        expect(echo).toEqual({ ok: true, skipped: true, reason: 'Sin cambios' });
        expect(upserts).toHaveLength(afterPublish);
    });
});

describe('cache de tamaños por registro (hashing de publicación del lote)', () => {
    it('mide cada registro UNA vez y reproduce exactamente los bytes del camino sin cache', () => {
        const sales = makeSalesInMonth('2026-08', 40);
        const cache = new Map();
        const cached = buildSalesSyncPlan(sales, { recordBytes: cache });
        const reference = buildSalesSyncPlan(sales);
        expect(cached.map((s) => ({ docId: s.docId, bytes: s.bytes })))
            .toEqual(reference.map((s) => ({ docId: s.docId, bytes: s.bytes })));
        expect(cache.size).toBe(40);

        // Con el cache caliente, re-armar el plan NO serializa ni un registro.
        const realStringify = JSON.stringify;
        let calls = 0;
        JSON.stringify = (value, ...rest) => {
            calls += 1;
            return realStringify(value, ...rest);
        };
        try {
            buildSalesSyncPlan(sales, { recordBytes: cache });
        } finally {
            JSON.stringify = realStringify;
        }
        expect(calls).toBe(0);
    });

    it('auto-reparación: publicar un slice con registro de otro tamaño invalida sus entradas', async () => {
        const upserts = setupUpsertMock();
        const cache = salesRecordBytesCacheView();
        const sales = makeSalesInMonth('2026-08', 5);
        const seeded = await pushCloudSync(SALES_SYNC_BASE_KEY, sales, false, true, 'PDA-V2-TEST');
        expect(seeded.ok).toBe(true);
        expect(cache.size).toBe(5);

        // Anulación realista: el mismo id con contenido de OTRO tamaño (el
        // cache por id quedaría viejo si no se auto-reparara).
        const target = sales[2];
        const replaced = sales.map((r) => (r.id === target.id
            ? { ...r, status: 'ANULADA', notas: 'x'.repeat(200) }
            : r));
        upserts.length = 0;
        const push = await pushCloudSync(SALES_SYNC_BASE_KEY, replaced, false, true, 'PDA-V2-TEST');
        expect(push.ok).toBe(true);
        expect(upserts).toHaveLength(1); // el slice cambió y se re-publicó

        // La suma cacheada ya no cuadra con el JSON real del slice → las
        // entradas de ese slice se invalidaron para que el plan las re-mida.
        expect(cache.has(target.id)).toBe(false);

        // Y el plan siguiente vuelve a medir exacto (misma partición que sin cache).
        const repaired = buildSalesSyncPlan(replaced, { recordBytes: cache });
        const reference = buildSalesSyncPlan(replaced);
        expect(repaired.map((s) => ({ docId: s.docId, bytes: s.bytes })))
            .toEqual(reference.map((s) => ({ docId: s.docId, bytes: s.bytes })));
    });
});
