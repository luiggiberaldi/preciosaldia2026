// @vitest-environment jsdom
//
// Fase 4 contra staging REAL (wapczmlwljkrjtfhmqko): round-trip de la familia
// `bodega_sales_v1` por periodos sobre `sync_documents` de verdad, no un mock.
//
// La ruta probada es la real (`pushCloudSync` → `upsertSyncDocument` → upsert
// con `on_conflict=device_id,collection,doc_id`); solo el transporte de
// supabase-js se reemplaza por fetch directo al PostgREST del proyecto para no
// cargar el cliente completo. Usa la service key (bybassea RLS) — la ruta RLS
// con sesión de dispositivo la cubren los tests de staging del clon
// (SUPERVISOR-E2E-STAGING.md).
//
// Convención de pruebas seguras contra staging:
//   - solo corre con SUPERVISOR_STAGING_E2E=true
//   - device_id sintético con prefijo `e2e-test-` (etiqueta de juguete)
//   - limpieza obligatoria por prefijo de device_id al terminar
//
// Ejecución (nunca imprimir las keys):
//   set -a; . ../preciosaldia-supervisor-staging/.env; set +a
//   SUPERVISOR_STAGING_E2E=true npx vitest run tests/cloudSyncSalesPeriodsStaging.test.js
import { afterAll, describe, expect, it, vi } from 'vitest';
import {
    SALES_SYNC_BASE_KEY,
    mergeSalesSyncDoc,
    pushCloudSync,
} from '../src/hooks/useCloudSync';

// vi.mock se eleva por encima de los imports: todo lo que use la factory
// debe salir de vi.hoisted para no chocar con la zona muerta temporal.
const { RUN, SERVICE_KEY, STAGING_URL, DEVICE_ID, restHeaders, upsertedDocIds } = vi.hoisted(() => {
    const run = process.env.SUPERVISOR_STAGING_E2E === 'true';
    const serviceKey = process.env.SUPABASE_STAGING_SERVICE_KEY || '';
    const stagingUrl = (process.env.SUPABASE_STAGING_URL || process.env.VITE_SUPABASE_STAGING_URL || '').replace(/\/$/, '');
    return {
        RUN: run,
        SERVICE_KEY: serviceKey,
        STAGING_URL: stagingUrl,
        DEVICE_ID: `e2e-test-fase4-${Date.now().toString(36)}`,
        restHeaders: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
        },
        upsertedDocIds: [],
    };
});

// Transporte real contra PostgREST: mismo upsert que supabase-js haría.
vi.mock('../src/config/supabaseCloud', () => ({
    supabaseCloud: {
        from: (table) => ({
            upsert: async (document, options = {}) => {
                const onConflict = options.onConflict || 'device_id,collection,doc_id';
                upsertedDocIds.push(document.doc_id);
                const response = await fetch(
                    `${STAGING_URL}/rest/v1/${table}?on_conflict=${onConflict}`,
                    {
                        method: 'POST',
                        headers: {
                            ...restHeaders,
                            Prefer: 'resolution=merge-duplicates,return=representation',
                        },
                        body: JSON.stringify(document),
                    },
                );
                if (!response.ok) {
                    return { data: null, error: { message: `${response.status}: ${await response.text()}` } };
                }
                return { data: await response.json(), error: null };
            },
        }),
        channel: () => ({ on: () => ({ subscribe: () => {} }) }),
        removeChannel: () => {},
        rpc: async () => ({ data: null, error: null }),
    },
    supabaseCloudUrl: STAGING_URL,
}));

async function fetchFamily() {
    const response = await fetch(
        `${STAGING_URL}/rest/v1/sync_documents?device_id=eq.${DEVICE_ID}&select=doc_id,data&order=doc_id.asc`,
        { headers: restHeaders },
    );
    expect(response.ok).toBe(true);
    return response.json();
}

async function wipeDevice() {
    const response = await fetch(
        `${STAGING_URL}/rest/v1/sync_documents?device_id=eq.${DEVICE_ID}`,
        { method: 'DELETE', headers: { ...restHeaders, Prefer: 'return=minimal' } },
    );
    expect(response.ok).toBe(true);
}

function makeSale(id, timestamp, extra = {}) {
    return {
        id,
        timestamp,
        saleNumber: 1,
        items: [{ productId: 'p-1', name: 'Producto', quantity: 1, price: 10, subtotal: 10 }],
        payments: [{ method: 'efectivo', amount: 10 }],
        total: 10,
        status: 'COMPLETADA',
        ...extra,
    };
}

function makeSalesInMonth(month, count, { size = 700, startId = 0 } = {}) {
    return Array.from({ length: count }, (_, i) => {
        const day = String((i % 27) + 1).padStart(2, '0');
        const base = makeSale(`${month}-venta-${startId + i}`, `${month}-${day}T10:00:00.000Z`);
        // Padding de crecimiento ESTRICTO: la nota se alarga en cada vuelta
        // (una nota de largo fijo estabiliza el JSON y el while nunca termina).
        let record = base;
        while (JSON.stringify(record).length < size) {
            record = { ...record, note: `${record.note ?? ''}padding-` };
        }
        return record;
    });
}

function sortedIds(records) {
    return records.map((r) => r.id).sort();
}

const skip = !RUN || !SERVICE_KEY || !STAGING_URL;

// Fixture compartido: la escritura incremental del test 2 empuja ESTOS mismos
// objetos (como la caja empuja su estado local), no una copia releída.
const salesSnapshot = [
    ...makeSalesInMonth('2026-07', 60),
    ...makeSalesInMonth('2026-08', 900, { size: 700 }), // > 1 shard
    ...makeSalesInMonth('2026-10', 16),
    makeSale('sin-fecha-1', null),
];

describe.skipIf(skip)('Fase 4 contra staging wapczm (round-trip real)', () => {
    afterAll(async () => {
        if (!skip) await wipeDevice();
    });

    it('publica la familia por periodos y el merge del lector conserva todas las ventas', async () => {
        const sales = salesSnapshot;

        const result = await pushCloudSync(SALES_SYNC_BASE_KEY, sales, false, true, DEVICE_ID);
        expect(result.ok).toBe(true);
        expect(upsertedDocIds.every((id) => id.startsWith(`${SALES_SYNC_BASE_KEY}:`))).toBe(true);
        // El mes grande se parte en shards reales en la base.
        expect(upsertedDocIds.some((id) => id.includes('#'))).toBe(true);

        const rows = await fetchFamily();
        expect(rows.length).toBe(new Set(upsertedDocIds).size);
        for (const row of rows) {
            expect(row.doc_id.startsWith(`${SALES_SYNC_BASE_KEY}:`)).toBe(true);
            expect(JSON.stringify(row.data).length).toBeLessThan(500_000);
        }

        // El lector aplica los docs como llegan (orden invertido) y no pierde nada.
        let local = [];
        for (const row of [...rows].reverse()) {
            local = mergeSalesSyncDoc(local, row.doc_id, row.data.payload);
        }
        expect(sortedIds(local)).toEqual(sortedIds(sales));
        expect(new Set(local.map((r) => r.id)).size).toBe(sales.length);
    }, 120_000);

    it('una venta nueva reescribe SOLO su periodo y el round-trip sigue completo', async () => {
        // Mismos objetos locales que la primera publicación (el hash por doc
        // compara serializaciones; el jsonb de staging puede reordenar claves
        // al releer, así que el push incremental sale del estado LOCAL, que es
        // lo que hace la caja de verdad).
        const withNew = [...salesSnapshot, makeSale('2026-08-nueva', '2026-08-20T10:00:00.000Z')];

        upsertedDocIds.length = 0;
        const result = await pushCloudSync(SALES_SYNC_BASE_KEY, withNew, false, true, DEVICE_ID);
        expect(result.ok).toBe(true);
        expect(upsertedDocIds.length).toBeGreaterThan(0);
        expect(upsertedDocIds.every((id) => id.startsWith(`${SALES_SYNC_BASE_KEY}:2026-08`))).toBe(true);

        const rows = await fetchFamily();
        let local = [];
        for (const row of [...rows].reverse()) {
            local = mergeSalesSyncDoc(local, row.doc_id, row.data.payload);
        }
        expect(sortedIds(local)).toEqual(sortedIds(withNew));
    }, 120_000);

    it('el vaciado total tumba todos los docs publicados en staging', async () => {
        upsertedDocIds.length = 0;
        const result = await pushCloudSync(SALES_SYNC_BASE_KEY, [], false, true, DEVICE_ID);
        expect(result.ok).toBe(true);

        const rows = await fetchFamily();
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
            expect(row.data.payload).toEqual([]);
        }

        // Un lector con estado previo queda sin ventas tras aplicar las tumbas.
        const stale = makeSalesInMonth('2026-08', 5);
        let local = stale;
        for (const row of rows) {
            local = mergeSalesSyncDoc(local, row.doc_id, row.data.payload);
        }
        expect(local).toEqual([]);
    }, 120_000);

    it('la limpieza por device_id deja cero filas residuales', async () => {
        await wipeDevice();
        const rows = await fetchFamily();
        expect(rows).toEqual([]);
    }, 60_000);
});
