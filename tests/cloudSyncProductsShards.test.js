// @vitest-environment jsdom

// Fase 5 (plan 2026-10-21-plan-adelgazar-bodega-products-por-shards.md): partir
// el documento monolítico `bodega_products_v1` (~1.32 MB en el backup del
// 2026-10-19) en 32 buckets fijos por hash del `id` (`bodega_products_v1:b00`
// … `:b1f`), SIN split `#N` intra-bucket (rompería la propagación de borrados).
// Semántica sellada aquí:
//   - Bucket = fnv1a32(id) & 31, derivable en cualquier dispositivo sin estado.
//   - Un doc = la franja COMPLETA del bucket, en orden canónico por id.
//   - Lector: REEMPLAZO de franja — el borrado de un producto se propaga; `[]`
//     limpia SOLO esa franja.
//   - Legacy `bodega_products_v1`: unión «lo local gana» (histórico congelado),
//     `[]` limpia TODO; nunca resucita ids de franjas cuyo bucket ya se aplicó
//     (el bucket es la autoridad de SU franja, en cualquier orden de llegada).
//   - Escritura incremental: solo se reescribe el bucket cuyo contenido cambió,
//     TAMBIÉN con forceUnconditional (el diff por hash es el mecanismo; el force
//     de los llamadores legacy no puede volver a mandar el catálogo entero).
//   - Gate: un bucket sobre el techo se advierte con SU bucket señalado
//     (política sellada «medir y avisar, nunca bloquear» — re-bucketizar).
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

import localforage from 'localforage';
import {
    PRODUCTS_SYNC_BASE_KEY,
    PRODUCTS_SYNC_MAX_DOC_BYTES,
    PRODUCTS_SYNC_TRACKING_KEY,
    _applyFromCloud,
    applyProductsDocToBaseline,
    buildProductsSyncPlan,
    deriveProductsFromBaseline,
    isProductsSyncDocId,
    mergeProductsSyncDoc,
    parseProductsSyncDocId,
    productBucketOf,
    productsDocIdFor,
    pushCloudSync,
} from '../src/hooks/useCloudSync';
import { buildSyncEnvelope, getSyncMetadataKey } from '../src/services/supervisorSyncService';

function makeProduct(id, extra = {}) {
    return {
        id,
        name: `Producto ${id}`,
        priceUsd: 1.25,
        costUsd: 0.8,
        stock: 10,
        unit: 'unidades',
        packagingType: 'suelto',
        category: 'Abarrotes',
        ...extra,
    };
}

function makeProducts(count, { prefix = 'p', size = 0 } = {}) {
    const list = [];
    for (let i = 0; i < count; i += 1) {
        const id = `${prefix}-${String(i).padStart(5, '0')}`;
        list.push(makeProduct(id, size > 0 ? { notas: 'x'.repeat(size) } : {}));
    }
    return list;
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
});

describe('bucket derivable solo del id (estable en cualquier dispositivo)', () => {
    it('el mismo producto cae siempre en el mismo bucket y doc', () => {
        for (const id of ['p-1', 'PDA-V2-ABCDEF12', 42, 'ñandú/único']) {
            expect(productBucketOf(id)).toBe(productBucketOf(id));
            expect(productBucketOf(id)).toBeGreaterThanOrEqual(0);
            expect(productBucketOf(id)).toBeLessThan(32);
            expect(productsDocIdFor(productBucketOf(id))).toMatch(/^bodega_products_v1:b[0-9a-f]{2}$/);
        }
    });

    it('reconoce los doc ids de la familia y parsea el bucket del doc', () => {
        expect(isProductsSyncDocId('bodega_products_v1')).toBe(true);
        expect(isProductsSyncDocId('bodega_products_v1:b00')).toBe(true);
        expect(isProductsSyncDocId('bodega_products_v1:b1f')).toBe(true);
        expect(isProductsSyncDocId('bodega_sales_v1:2026-08')).toBe(false);

        expect(parseProductsSyncDocId('bodega_products_v1')).toBeNull();
        expect(parseProductsSyncDocId('bodega_products_v1:b00')).toBe(0);
        expect(parseProductsSyncDocId('bodega_products_v1:b1f')).toBe(31);
        // El marker de generación (M2) y los ids ajenos no son buckets.
        expect(parseProductsSyncDocId('bodega_products_v1:gen2')).toBeNull();
        expect(parseProductsSyncDocId('bodega_products_v1:b20')).toBeNull();
    });
});

describe('(2) buildProductsSyncPlan: round-trip, un doc por bucket, orden canónico', () => {
    it('parte el catálogo sin pérdidas ni duplicados y respeta la derivación del bucket', () => {
        const products = makeProducts(500);
        const plan = buildProductsSyncPlan(products);

        const merged = plan.flatMap((slice) => slice.records);
        expect(sortedIds(merged)).toEqual(sortedIds(products));
        expect(new Set(merged.map((r) => r.id)).size).toBe(products.length);

        const seen = new Set();
        for (const slice of plan) {
            expect(seen.has(slice.bucket)).toBe(false);
            seen.add(slice.bucket);
            for (const record of slice.records) {
                expect(productBucketOf(record.id)).toBe(slice.bucket);
            }
            // Orden canónico por String(id) asc.
            const ids = slice.records.map((r) => String(r.id));
            expect(ids).toEqual([...ids].sort());
            expect(slice.docId).toBe(productsDocIdFor(slice.bucket));
            expect(slice.bytes).toBe(JSON.stringify(slice.records).length + 1);
        }
    });

    it('un catálogo entero en un solo bucket produce exactamente un doc', () => {
        // Fuerza un bucket: todos los ids comparten hash de bucket.
        const bucket = productBucketOf('ancla');
        const list = [];
        let i = 0;
        while (list.length < 5 && i < 10000) {
            const id = `x-${i}`;
            if (productBucketOf(id) === bucket) list.push(makeProduct(id));
            i += 1;
        }
        const plan = buildProductsSyncPlan(list);
        expect(plan).toHaveLength(1);
        expect(plan[0].records).toHaveLength(5);
    });
});

describe('(3) mergeProductsSyncDoc: reemplazo de franja y propagación de borrados', () => {
    it('el reemplazo de franja propaga el borrado y deja los otros buckets intactos', () => {
        const deleted = makeProduct('borrado-1');
        const kept = makeProduct('kept-1');
        const otherBucket = makeProduct('other-1');
        // Encuentra un producto cuyo bucket difiera del de `deleted`.
        const foreign = makeProducts(200).find((p) => productBucketOf(p.id) !== productBucketOf(deleted.id));
        const local = [deleted, kept, otherBucket, foreign];
        const deletedBucket = productBucketOf(deleted.id);

        const stripeIds = local.filter((p) => productBucketOf(p.id) === deletedBucket).map((p) => p.id);
        const incoming = local
            .filter((p) => productBucketOf(p.id) === deletedBucket && p.id !== deleted.id)
            .map((p) => ({ ...p, priceUsd: 9.99 }));

        const after = mergeProductsSyncDoc(local, productsDocIdFor(deletedBucket), incoming);

        // El borrado se propagó…
        expect(after.map((p) => p.id)).not.toContain('borrado-1');
        // …la franja entrante reemplazó exactamente la suya…
        for (const id of stripeIds.filter((i) => i !== 'borrado-1')) {
            expect(after.find((p) => p.id === id).priceUsd).toBe(9.99);
        }
        // …y los otros buckets quedaron intactos.
        for (const id of ['kept-1', 'other-1', foreign.id].filter((i) => productBucketOf(i) !== deletedBucket)) {
            expect(after.map((p) => p.id)).toContain(id);
        }
    });

    it('`[]` en un doc de bucket limpia SOLO esa franja (tombstone)', () => {
        const list = makeProducts(100);
        const bucket = productBucketOf(list[0].id);
        const after = mergeProductsSyncDoc(list, productsDocIdFor(bucket), []);
        expect(after).toHaveLength(list.filter((p) => productBucketOf(p.id) !== bucket).length);
        expect(after.map((p) => p.id)).not.toContain(list[0].id);
    });

    it('el legacy es unión «lo local gana» y `[]` limpia todo', () => {
        const local = [makeProduct('a', { priceUsd: 1 }), makeProduct('b')];
        const incoming = [makeProduct('a', { priceUsd: 2 }), makeProduct('c')];
        const merged = mergeProductsSyncDoc(local, PRODUCTS_SYNC_BASE_KEY, incoming);
        expect(merged.find((p) => p.id === 'a').priceUsd).toBe(1);
        expect(sortedIds(merged)).toEqual(['a', 'b', 'c']);

        expect(mergeProductsSyncDoc(merged, PRODUCTS_SYNC_BASE_KEY, [])).toEqual([]);
    });

    it('el legacy congelado NO resucita productos de franjas cuyo bucket ya se aplicó (ambos órdenes)', () => {
        const survivor = makeProduct('sobrevive');
        const deleted = makeProduct('borrado-2');
        const deletedBucket = productBucketOf(deleted.id);
        // El legacy congelado aún trae el producto borrado; su bucket ya no.
        const legacyCopy = [survivor, deleted];
        const bucketPayload = [survivor, deleted].filter((p) => (
            productBucketOf(p.id) === deletedBucket && p.id !== deleted.id
        ));
        const otherStripe = [survivor, deleted].filter((p) => productBucketOf(p.id) !== deletedBucket);

        // Orden 1: legacy primero, bucket después → el reemplazo de franja lo borra.
        let local = mergeProductsSyncDoc([], PRODUCTS_SYNC_BASE_KEY, legacyCopy);
        local = mergeProductsSyncDoc(local, productsDocIdFor(deletedBucket), bucketPayload);
        expect(local.map((p) => p.id)).not.toContain('borrado-2');

        // Orden 2 (el delicado): bucket primero, legacy después — el guardián
        // `skipBuckets` impide que el legacy re-añada el id borrado.
        let local2 = mergeProductsSyncDoc([], productsDocIdFor(deletedBucket), bucketPayload);
        local2 = mergeProductsSyncDoc(local2, PRODUCTS_SYNC_BASE_KEY, legacyCopy, { skipBuckets: [deletedBucket] });
        expect(local2.map((p) => p.id)).not.toContain('borrado-2');
        expect(local2.map((p) => p.id)).toContain('sobrevive');

        // Sin el guardián, el legacy sí lo re-añadiría (por eso existe).
        const unguarded = mergeProductsSyncDoc(
            mergeProductsSyncDoc([], productsDocIdFor(deletedBucket), bucketPayload),
            PRODUCTS_SYNC_BASE_KEY,
            legacyCopy,
        );
        expect(unguarded.map((p) => p.id)).toContain('borrado-2');
        void otherStripe;
    });

    it('payload no-arreglo es no-op, y un doc que no es de la familia tampoco toca nada', () => {
        const local = makeProducts(20);
        expect(mergeProductsSyncDoc(local, productsDocIdFor(0), 'basura')).toBe(local);
        expect(mergeProductsSyncDoc(local, productsDocIdFor(0), { no: 'array' })).toBe(local);
        // El marker de generación (M2) no es un bucket: no aplica nada.
        expect(mergeProductsSyncDoc(local, 'bodega_products_v1:gen2', [makeProduct('x')])).toBe(local);
    });
});

describe('(4) fail-first: un cambio de producto reescribe SOLO su bucket', () => {
    it('la primera escritura publica los buckets; un edit solo toca el suyo', async () => {
        const upserts = setupUpsertMock();
        const products = makeProducts(300);

        const first = await pushCloudSync(PRODUCTS_SYNC_BASE_KEY, products, false, true, 'PDA-V2-TEST');
        expect(first.ok).toBe(true);
        const firstDocs = upserts.map((d) => d.doc_id);
        expect(firstDocs.length).toBeGreaterThan(1);
        expect(firstDocs.every((id) => isProductsSyncDocId(id) && id !== PRODUCTS_SYNC_BASE_KEY)).toBe(true);

        upserts.length = 0;
        const target = products[7];
        const edited = products.map((p) => (p.id === target.id ? { ...p, priceUsd: 4.44 } : p));
        const second = await pushCloudSync(PRODUCTS_SYNC_BASE_KEY, edited, false, true, 'PDA-V2-TEST');
        expect(second.ok).toBe(true);
        expect(upserts).toHaveLength(1);
        expect(upserts[0].doc_id).toBe(productsDocIdFor(productBucketOf(target.id)));

        upserts.length = 0;
        const third = await pushCloudSync(PRODUCTS_SYNC_BASE_KEY, edited, false, true, 'PDA-V2-TEST');
        expect(third.ok).toBe(true);
        expect(third.skipped).toBe(true); // Sin cambios: hash por doc salta todo.
        expect(upserts).toHaveLength(0);
    });

    it('el forceUnconditional NO re-manda buckets intactos: solo sale el bucket del cambio', async () => {
        const upserts = setupUpsertMock();
        const products = makeProducts(120);

        // Estado fresco: el primer push (aunque sea forzado) publica todo.
        const first = await pushCloudSync(PRODUCTS_SYNC_BASE_KEY, products, true, true, 'PDA-V2-TEST');
        expect(first.ok).toBe(true);
        expect(upserts.length).toBeGreaterThan(1);

        // Force sobre catálogo intacto: cero re-escrituras (sería volver al monolito).
        upserts.length = 0;
        const again = await pushCloudSync(PRODUCTS_SYNC_BASE_KEY, products, true, true, 'PDA-V2-TEST');
        expect(again.ok).toBe(true);
        expect(upserts).toHaveLength(0);

        // Force con un producto editado: exactamente SU bucket (~40 KB).
        upserts.length = 0;
        const target = products[3];
        const edited = products.map((p) => (p.id === target.id ? { ...p, priceUsd: 9.99 } : p));
        const pushed = await pushCloudSync(PRODUCTS_SYNC_BASE_KEY, edited, true, true, 'PDA-V2-TEST');
        expect(pushed.ok).toBe(true);
        expect(upserts).toHaveLength(1);
        expect(upserts[0].doc_id).toBe(productsDocIdFor(productBucketOf(target.id)));
    });

    it('el vaciado total tumba el legacy y todos los buckets publicados', async () => {
        const upserts = setupUpsertMock();
        const products = makeProducts(50);
        await pushCloudSync(PRODUCTS_SYNC_BASE_KEY, products, false, true, 'PDA-V2-TEST');
        upserts.length = 0;

        const empty = await pushCloudSync(PRODUCTS_SYNC_BASE_KEY, [], false, true, 'PDA-V2-TEST');
        expect(empty.ok).toBe(true);
        const docs = upserts.map((d) => d.doc_id);
        expect(docs).toContain(PRODUCTS_SYNC_BASE_KEY);
        for (const doc of upserts) {
            expect(doc.data.payload).toEqual([]);
        }
        // Todos los buckets publicados alguna vez quedaron tumbados.
        const tracked = JSON.parse(localStorage.getItem(PRODUCTS_SYNC_TRACKING_KEY) || '[]');
        for (const docId of tracked) {
            expect(docs).toContain(docId);
        }
        expect(docs.length).toBe(tracked.length + 1);
    });

    it('la baja que vacía SU bucket tumba su doc con `[]` (el borrado llega al monitor)', async () => {
        const upserts = setupUpsertMock();
        // Producto SOLO en su bucket — el caso que rompía: al darlo de baja,
        // buildProductsSyncPlan ya no trae su bucket y, sin la tumba `[]`, la
        // franja vieja del doc sobrevive en la nube y el monitor nunca ve la
        // baja (regresión de Fase 5).
        const lone = makeProduct('lone-baja');
        const loneBucket = productBucketOf(lone.id);
        const others = [];
        const seenBuckets = new Set([loneBucket]);
        let i = 0;
        while (others.length < 3 && i < 10000) {
            const id = `o-${i}`;
            const bucket = productBucketOf(id);
            if (!seenBuckets.has(bucket)) {
                seenBuckets.add(bucket);
                others.push(makeProduct(id));
            }
            i += 1;
        }
        const products = [lone, ...others];
        const seeded = await pushCloudSync(PRODUCTS_SYNC_BASE_KEY, products, false, true, 'PDA-V2-TEST');
        expect(seeded.ok).toBe(true);
        upserts.length = 0;

        // La baja (con force, como el eco real del comando de producto)…
        const afterDelete = products.filter((p) => p.id !== lone.id);
        const result = await pushCloudSync(PRODUCTS_SYNC_BASE_KEY, afterDelete, true, true, 'PDA-V2-TEST');
        expect(result.ok).toBe(true);
        expect(result.published).toContain(productsDocIdFor(loneBucket));

        // …tumba exactamente SU franja con `[]` y no toca los demás buckets.
        expect(upserts).toHaveLength(1);
        expect(upserts[0].doc_id).toBe(productsDocIdFor(loneBucket));
        expect(upserts[0].data.payload).toEqual([]);

        // Y la tumba no se re-emite: el hash por doc la sella.
        upserts.length = 0;
        const again = await pushCloudSync(PRODUCTS_SYNC_BASE_KEY, afterDelete, true, true, 'PDA-V2-TEST');
        expect(again.ok).toBe(true);
        expect(upserts).toHaveLength(0);
    });

    it('un bucket vacío SIN publicación previa no inventa docs (el primer push solo sube franjas con productos)', async () => {
        const upserts = setupUpsertMock();
        const lone = makeProduct('lone-inicial');
        const result = await pushCloudSync(PRODUCTS_SYNC_BASE_KEY, [lone], false, true, 'PDA-V2-TEST');
        expect(result.ok).toBe(true);
        // Solo el bucket del producto: los otros 31 vacíos no tienen franja
        // vieja que limpiar y no se convierten en docs `[]` innecesarios.
        expect(upserts).toHaveLength(1);
        expect(upserts[0].doc_id).toBe(productsDocIdFor(productBucketOf(lone.id)));
    });
});

describe('(gate) un bucket sobre el techo se advierte con SU bucket señalado', () => {
    it('publica igual (nunca bloquea) y avisa que toca re-bucketizar', async () => {
        // Política sellada de syncDocBudget (24-oct): «medir y avisar, nunca
        // bloquear» — bloquear rompería la sincronización. La señal para
        // re-bucketizar (§2/§7 del plan) viaja como aviso con el doc id.
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            const upserts = setupUpsertMock();
            const huge = makeProducts(10, { size: PRODUCTS_SYNC_MAX_DOC_BYTES });
            const result = await pushCloudSync(PRODUCTS_SYNC_BASE_KEY, huge, false, true, 'PDA-V2-TEST');
            expect(result.ok).toBe(true);
            expect(upserts.length).toBeGreaterThan(0);
            expect(result.budget.over).toBe(true);
            expect(warnSpy).toHaveBeenCalledWith(expect.stringMatching(/Bucket sobre el techo: bodega_products_v1:b[0-9a-f]{2}/));
        } finally {
            warnSpy.mockRestore();
        }
    });
});

describe('baseline por franjas (plan de stock delta, Fase 5)', () => {
    const at = (iso) => iso;

    it('cada franja pliega los efectos posteriores a SU stockAsOf', () => {
        const old = makeProduct('viejo', { stock: 10 });
        const fresh = makeProduct('fresco', { stock: 10 });
        const oldBucket = productsDocIdFor(productBucketOf(old.id));
        const freshBucket = productsDocIdFor(productBucketOf(fresh.id));

        let baseline = applyProductsDocToBaseline(null, oldBucket, [old], { stockAsOf: at('2026-10-24T10:00:00.000Z') });
        baseline = applyProductsDocToBaseline(baseline, freshBucket, [fresh], { stockAsOf: at('2026-10-24T12:00:00.000Z') });

        // Un efecto a las 11:00: posterior al cutoff de `old` (se pliega) pero
        // anterior al de `fresh` (ya está en su baseline: NO se pliega dos veces).
        const sales = [{
            id: 's1',
            tipo: 'VENTA',
            timestamp: at('2026-10-24T11:00:00.000Z'),
            stockEffects: [
                { productId: old.id, delta: -2, at: at('2026-10-24T11:00:00.000Z') },
                { productId: fresh.id, delta: -2, at: at('2026-10-24T11:00:00.000Z') },
            ],
        }];

        const derived = deriveProductsFromBaseline(baseline, sales);
        expect(derived.find((p) => p.id === old.id).stock).toBe(8);
        expect(derived.find((p) => p.id === fresh.id).stock).toBe(10);
    });

    it('el bucket es la autoridad de SU franja en el baseline (borrado propagado, legacy no resucita)', () => {
        const survivor = makeProduct('sobrevive-b');
        const deleted = makeProduct('borrado-b');
        const deletedBucket = productBucketOf(deleted.id);

        // Bucket primero (sin el borrado), legacy congelado después (aún lo trae).
        let baseline = applyProductsDocToBaseline(null, productsDocIdFor(deletedBucket), [survivor, deleted].filter((p) => (
            productBucketOf(p.id) === deletedBucket && p.id !== deleted.id
        )), { stockAsOf: null });
        baseline = applyProductsDocToBaseline(baseline, PRODUCTS_SYNC_BASE_KEY, [survivor, deleted], { stockAsOf: null });

        expect(baseline.products.map((p) => p.id)).not.toContain('borrado-b');
        const derived = deriveProductsFromBaseline(baseline, []);
        expect(derived.map((p) => p.id)).not.toContain('borrado-b');
    });

    it('`[]` en un bucket limpia su franja del baseline; `[]` en el legacy limpia todo', () => {
        const list = makeProducts(40);
        const bucket = productBucketOf(list[0].id);
        let baseline = applyProductsDocToBaseline(null, PRODUCTS_SYNC_BASE_KEY, list, { stockAsOf: null });
        baseline = applyProductsDocToBaseline(baseline, productsDocIdFor(bucket), [], { stockAsOf: null });
        expect(baseline.products.filter((p) => productBucketOf(p.id) === bucket)).toHaveLength(0);

        baseline = applyProductsDocToBaseline(baseline, PRODUCTS_SYNC_BASE_KEY, [], { stockAsOf: null });
        expect(baseline.products).toEqual([]);
        expect(baseline.stripeAsOf).toEqual({});
    });

    it('compatibilidad: un baseline viejo (sin stripeAsOf) sigue derivando con su stockAsOf', () => {
        const product = makeProduct('legacy-baseline', { stock: 5 });
        const legacyBaseline = {
            products: [product],
            stockAsOf: at('2026-10-24T10:00:00.000Z'),
        };
        const sales = [{
            id: 's1',
            tipo: 'VENTA',
            timestamp: at('2026-10-24T11:00:00.000Z'),
            stockEffects: [{ productId: product.id, delta: -3, at: at('2026-10-24T11:00:00.000Z') }],
        }];
        const derived = deriveProductsFromBaseline(legacyBaseline, sales);
        expect(derived.find((p) => p.id === product.id).stock).toBe(2);
    });
});

describe('lector real (_applyFromCloud): merge, watermark y hashes del push', () => {
    const LAST_PUSH_HASH = 'bodega_last_periodic_push_hash_';

    async function readLocalCatalog() {
        const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
        return (await lf.getItem(PRODUCTS_SYNC_BASE_KEY)) || [];
    }

    it('aplica bucket + legacy en el peor orden SIN resucitar el borrado y sella los hashes por doc', async () => {
        const survivor = makeProduct('sobrevive-r', { stock: 4 });
        const deleted = makeProduct('borrado-r', { stock: 7 });
        const deletedBucket = productBucketOf(deleted.id);
        const bucketDocId = productsDocIdFor(deletedBucket);
        const bucketPayload = [survivor, deleted].filter((p) => (
            productBucketOf(p.id) === deletedBucket && p.id !== deleted.id
        ));
        const legacyPayload = [survivor, deleted];

        // Orden delicado: el bucket (que ya NO trae el borrado) se aplica
        // PRIMERO y el legacy congelado (que aún lo trae) DESPUÉS.
        const appliedBucket = await _applyFromCloud(
            bucketDocId,
            'store',
            buildSyncEnvelope(bucketPayload, '2026-10-24T13:00:00.000Z'),
        );
        expect(appliedBucket).toBe(true);
        const appliedLegacy = await _applyFromCloud(
            PRODUCTS_SYNC_BASE_KEY,
            'store',
            buildSyncEnvelope(legacyPayload, '2026-10-24T12:00:00.000Z'),
        );
        expect(appliedLegacy).toBe(true);

        const catalog = await readLocalCatalog();
        expect(catalog.map((p) => p.id)).not.toContain('borrado-r');
        expect(catalog.map((p) => p.id)).toContain('sobrevive-r');

        // Hash bookkeeping: el push periódico no vuelve a subir lo aplicado.
        expect(localStorage.getItem(LAST_PUSH_HASH + bucketDocId)).toBeTruthy();
        expect(localStorage.getItem(LAST_PUSH_HASH + PRODUCTS_SYNC_BASE_KEY)).toBeTruthy();
        // Y el watermark por doc quedó sellado.
        expect(localStorage.getItem(getSyncMetadataKey(bucketDocId))).toBe('2026-10-24T13:00:00.000Z');
    });

    it('un doc de bucket vacío (tombstone) limpia su franja en la clave local', async () => {
        const list = makeProducts(40);
        const bucket = productBucketOf(list[0].id);
        const bucketDocId = productsDocIdFor(bucket);
        await _applyFromCloud(PRODUCTS_SYNC_BASE_KEY, 'store', buildSyncEnvelope(list, '2026-10-24T12:00:00.000Z'));
        await _applyFromCloud(bucketDocId, 'store', buildSyncEnvelope([], '2026-10-24T13:00:00.000Z'));

        const catalog = await readLocalCatalog();
        expect(catalog.filter((p) => productBucketOf(p.id) === bucket)).toHaveLength(0);
        expect(catalog.length).toBe(list.length - list.filter((p) => productBucketOf(p.id) === bucket).length);
    });
});
