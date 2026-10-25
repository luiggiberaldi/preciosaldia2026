// @vitest-environment jsdom
//
// Medición del costo de UN comando del supervisor en la caja, con los datos
// REALES del backup de producción (backups/supabase/…2026-10-19…json: el doc de
// productos más grande del parque, 2434 productos ≈ 1.32 MB, y su historial,
// 496 ventas/movimientos ≈ 666 KB).
//
// Responde: ¿es real el "la caja se cuelga un poco" cuando el supervisor
// cambia cosas? Mide el trabajo por comando:
//   - serializaciones (JSON.stringify) y clones (structuredClone) del catálogo
//     y el historial completos (journal write-ahead + writeVerified + sombra);
//   - bytes reales subidos a la nube por comando (transporte);
//   - cuánto de eso se lleva la Fase 4 (familia de ventas por periodos).
//
// Fidelidad: se ejecuta el código REAL (`applySupervisorInventoryBatchTransaction`,
// `applySupervisorProductCommand`, `pushCloudSync`). Solo se sustituyen:
//   - el storage por un shim que clona igual que IndexedDB/localforage
//     (structuredClone en cada lectura y escritura) + sombra, como hace
//     storageService.setItem (lee el catálogo actual, guarda sombra, escribe);
//   - el transporte de supabase-js por JSON.stringify del documento (el mismo
//     trabajo que hace supabase-js al serializar el upsert HTTP).
// Los tiempos salen de esta máquina de desarrollo: en una caja gama baja los
// mismos bytes son varias veces más caros. Lo que no cambia entre máquinas son
// los CONTEOS (serializaciones y bytes por comando).
import { describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    pushCloudSync,
    SALES_SYNC_BASE_KEY,
} from '../src/hooks/useCloudSync';
import { applySupervisorInventoryBatchTransaction } from '../src/services/supervisorInventoryCommand';
import {
    applySupervisorProductCommand,
    buildProductRevision,
} from '../src/services/supervisorProductCommand';
import { isGranelProduct } from '../src/utils/granel';
import { supabaseCloud } from '../src/config/supabaseCloud'; // el propio mock (transporte medido)

// ── Contadores de serialización/clonado sobre el código medido ──────────────
const stats = vi.hoisted(() => ({
    stringifyCalls: 0,
    stringifyChars: 0,
    cloneCalls: 0,
    uploadBytes: 0,
    uploadDocs: 0,
}));

const realStringify = JSON.stringify.bind(JSON);
const realClone = typeof structuredClone === 'function' ? structuredClone : null;

function instrumentStart() {
    stats.stringifyCalls = 0;
    stats.stringifyChars = 0;
    stats.cloneCalls = 0;
    stats.uploadBytes = 0;
    stats.uploadDocs = 0;
    JSON.stringify = (value, ...rest) => {
        stats.stringifyCalls += 1;
        const out = realStringify(value, ...rest);
        stats.stringifyChars += typeof out === 'string' ? out.length : 0;
        return out;
    };
    if (realClone) {
        globalThis.structuredClone = (value, ...rest) => {
            stats.cloneCalls += 1;
            return realClone(value, ...rest);
        };
    }
}

function instrumentStop() {
    JSON.stringify = realStringify;
    if (realClone) globalThis.structuredClone = realClone;
    return { ...stats };
}

// ── Transporte simulado: mismo trabajo que supabase-js al subir el upsert ───
const upsertMock = vi.hoisted(() => ({ onUpsert: null, docIds: [] }));
vi.mock('../src/config/supabaseCloud', () => ({
    supabaseCloud: {
        from: () => ({
            upsert: async (document) => {
                const body = JSON.stringify(document); // serialización real del transporte
                if (upsertMock.onUpsert) upsertMock.onUpsert(document, body.length);
                return { data: [document], error: null };
            },
        }),
        channel: () => ({ on: () => ({ subscribe: () => {} }) }),
        removeChannel: () => {},
        rpc: async () => ({ data: null, error: null }),
    },
    supabaseCloudUrl: 'https://perf.invalid',
}));

// ── Backup real (misma puerta que cloudSyncSalesPeriodsRealData.test.js) ────
// Datos REALES de producción (2026-10-19): el doc de productos más grande del
// parque es 2434 productos ≈ 1.32 MB y su historial 496 ventas ≈ 666 KB.
const BACKUP_PATH = path.resolve(
    process.cwd(),
    'backups/supabase/backup_sodgzkablshladvbtnes_2026-10-19T01-11-34-291Z.json',
);
const run = fs.existsSync(BACKUP_PATH);

function loadBackup() {
    const raw = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
    const docs = (raw.tables?.sync_documents || []).filter((d) => Array.isArray(d.data?.payload));
    // El documento más pesado por BYTES (no por cantidad de registros).
    const heaviest = (docId) => docs
        .filter((d) => d.doc_id === docId)
        .map((d) => ({ payload: d.data.payload, bytes: realStringify(d.data.payload).length }))
        .sort((a, b) => b.bytes - a.bytes)[0] || { payload: [], bytes: 0 };
    return {
        products: heaviest('bodega_products_v1').payload,
        sales: heaviest('bodega_sales_v1').payload,
    };
}

// ── Shim de storage con el mismo perfil de clonado que storageService ───────
// storageService.setItem: lee el valor actual (clon), guarda sombra (clon) y
// escribe (clon). getItem: clon de lectura. writeVerified hace set+get y dos
// JSON.stringify de comparación — eso se ejecuta en el código real medido.
function makeStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    // Usa el structuredClone GLOBAL (instrumentado durante la medición) para que
    // cada clon de IndexedDB/localforage cuente en los contadores.
    const clone = (value) => globalThis.structuredClone(value);
    // Espejo del interceptor de storageService.setItem (storageService.js:137):
    // una escritura SIN `skipSyncPush` encola su push vía queueCloudSync →
    // _debouncePush → pushCloudSync (debounce de 3 s, coalescido por clave).
    const autoEnqueue = new Map();
    return {
        async getItem(key, defaultValue = null) {
            return map.has(key) ? clone(map.get(key)) : defaultValue;
        },
        async setItem(key, value, options) {
            const current = map.has(key) ? clone(map.get(key)) : null; // lectura previa
            if (Array.isArray(current) && current.length > 0) clone(current); // sombra
            map.set(key, clone(value));
            if (!options?.skipSyncPush) autoEnqueue.set(key, clone(value));
        },
        async removeItem(key) {
            map.delete(key);
        },
        autoEnqueueKeys() {
            return [...autoEnqueue.keys()];
        },
        // Drena el debounce como lo haría _debouncePush a los 3 s: mismo push
        // real y por tanto mismo transporte medido.
        async drainAutoEnqueue() {
            const queued = [...autoEnqueue.entries()];
            autoEnqueue.clear();
            for (const [key, value] of queued) {
                await pushCloudSync(key, value, false, true, DEVICE_ID);
            }
        },
    };
}

const DEVICE_ID = 'PDA-V2-PERF';

describe.skipIf(!run)('costo real de un comando del supervisor en la caja (backup 2026-10-19)', () => {
    it('edit de producto: solo sube SU bucket (~40 KB), no el monolito de 1.32 MB', async () => {
        const { products, sales } = loadBackup();
        const target = products.find((p) => !isGranelProduct(p) && Number.isFinite(Number(p.stock)));
        expect(target).toBeTruthy();

        const storage = makeStorage({
            bodega_products_v1: products,
            bodega_sales_v1: sales,
        });

        upsertMock.onUpsert = (document, bytes) => {
            stats.uploadBytes += bytes;
            stats.uploadDocs += 1;
        };

        // Primera publicación (estado fresco): los 32 buckets — la referencia
        // del monolito que la Fase 5 debe reducir por cambio.
        const prime = await pushCloudSync('bodega_products_v1', products, true, true, DEVICE_ID);
        expect(prime.ok).toBe(true);
        const primeDocs = stats.uploadDocs;
        const primeBytes = stats.uploadBytes;

        const currentProducts = await storage.getItem('bodega_products_v1', []);
        const payload = {
            action: 'edit',
            product: { id: target.id, name: target.name, priceCop: Number(target.priceCop || 0) + 1 },
            baseRevision: buildProductRevision(target),
        };

        instrumentStart(); // resetea los contadores: mide SOLO el edit
        const t0 = performance.now();

        const result = applySupervisorProductCommand(currentProducts, payload);
        await storage.setItem('bodega_products_v1', result.products);
        // El push del comando es forceUnconditional (producción: comandos y
        // cloudPublishQueue), pero el diff por hash es SIEMPRE el mecanismo:
        // solo el bucket del producto editado sale por la red.
        const pushResult = await pushCloudSync('bodega_products_v1', result.products, true, true, DEVICE_ID);

        const ms = performance.now() - t0;
        const counters = instrumentStop();

        expect(result.products.length).toBe(currentProducts.length);
        expect(pushResult.ok).toBe(true);
        console.info(
            `[PERF] edit de producto → ${ms.toFixed(0)} ms bloqueando; `
            + `${counters.stringifyCalls} stringify (${(counters.stringifyChars / 1e6).toFixed(1)} M chars), `
            + `${counters.cloneCalls} clones; primera publicación ${primeDocs} docs / ${(primeBytes / 1e6).toFixed(2)} MB `
            + `→ el edit sube ${stats.uploadDocs} doc / ${stats.uploadBytes} B`,
        );
        // Gate de la Fase 5 (§8.6 del plan): el edit sube SU bucket (~40 KB),
        // no el catálogo completo. Falla si el diff por hash se revierte.
        expect(stats.uploadDocs).toBe(1);
        expect(stats.uploadBytes).toBeLessThan(100_000);
    }, 120_000);

    it('lote de inventario de 20 líneas: journal + escrituras verificadas + publicación', async () => {
        const { products, sales } = loadBackup();
        const targets = products
            .filter((p) => !isGranelProduct(p) && Number.isFinite(Number(p.stock)) && Number(p.stock) >= 0)
            .slice(0, 20);
        expect(targets.length).toBe(20);

        const storage = makeStorage({
            bodega_products_v1: products,
            bodega_sales_v1: sales,
        });

        const payload = {
            direction: 'ingreso',
            reason: 'ingreso de mercancía',
            lotReference: 'PERF-1',
            lines: targets.map((p, i) => ({
                lineId: String(i),
                productId: String(p.id),
                expectedStock: Number(p.stock || 0),
                quantityInput: 1,
                inputUnit: 'unidades',
                unitsPerPackage: 1,
            })),
        };

        upsertMock.docIds.length = 0;
        upsertMock.onUpsert = (document, bytes) => {
            stats.uploadBytes += bytes;
            stats.uploadDocs += 1;
            upsertMock.docIds.push(document.doc_id);
        };
        instrumentStart();
        const t0 = performance.now();

        const adjustment = await applySupervisorInventoryBatchTransaction({
            storage,
            pushSync: (key, value, force) => pushCloudSync(key, value, force, true, DEVICE_ID),
            payload,
            commandId: 'perf-lote-20',
            onLocalApplied: async () => {},
        });

        // Espejo del interceptor: las escrituras locales SIN skipSyncPush
        // encolan su push; el drenaje corre ese push real por el transporte
        // medido (es el camino que el auto-enqueue toma a los 3 s). La lista de
        // encolados se captura ANTES de drenar (el drenaje la vacía).
        const enqueuedKeys = storage.autoEnqueueKeys();
        const docsBeforeDrain = stats.uploadDocs;
        await storage.drainAutoEnqueue();

        const ms = performance.now() - t0;
        const counters = instrumentStop();

        expect(adjustment.status).toBe('applied');
        console.info(
            `[PERF] lote inventario 20 líneas → ${ms.toFixed(0)} ms bloqueando; `
            + `${counters.stringifyCalls} stringify (${(counters.stringifyChars / 1e6).toFixed(1)} M chars), `
            + `${counters.cloneCalls} clones; sube ${stats.uploadDocs} docs / ${(stats.uploadBytes / 1e6).toFixed(2)} MB (catálogo: 0 docs)`,
        );
        // El journal write-ahead duplica ambos documentos (before+after).
        expect(counters.stringifyChars).toBeGreaterThan(2 * 1_000_000);

        // ── EL GATE (§8.1 del plan de desacople 2026-10-22) ──────────────────
        // Un lote de inventario sube 0 bytes de catálogo: ni por la publicación
        // del journal (pendingKeys solo familia de ventas) ni por el auto-enqueue
        // del interceptor (skipSyncPush en la escritura local de productos).
        // Falla si cualquiera de los dos se revierte — ese es su fail-first.
        expect(upsertMock.docIds).not.toContain('bodega_products_v1');
        expect(stats.uploadBytes).toBeLessThan(1_000_000);
        // Seam: solo la familia de ventas se encola desde la transacción.
        expect(enqueuedKeys).toContain('bodega_sales_v1');
        expect(enqueuedKeys).not.toContain('bodega_products_v1');
        // La red de seguridad (§3.1.6) no duplica viajes: la familia ya estaba
        // publicada y el dedup por hash se saltó el push diferido.
        expect(stats.uploadDocs).toBe(docsBeforeDrain);

        // Control positivo: con los hashes del catálogo al día, una escritura
        // legacy (sin skipSyncPush) que CAMBIA un producto sube exactamente SU
        // bucket. Si este control falla, el 0 de arriba sería vacío y el gate
        // no probaría nada: el detector debe ver los bytes que el gate dice
        // que no hay.
        await pushCloudSync('bodega_products_v1', await storage.getItem('bodega_products_v1', []), false, true, DEVICE_ID);
        upsertMock.docIds.length = 0;
        const docsBeforeControl = stats.uploadDocs;
        const catalog = await storage.getItem('bodega_products_v1', []);
        const edited = catalog.map((p, i) => (i === 0 ? { ...p, priceCop: Number(p.priceCop || 0) + 1 } : p));
        await storage.setItem('bodega_products_v1', edited);
        await storage.drainAutoEnqueue();
        expect(stats.uploadDocs).toBe(docsBeforeControl + 1);
        expect(upsertMock.docIds).toHaveLength(1);
        expect(upsertMock.docIds[0]).toMatch(/^bodega_products_v1:b[0-9a-f]{2}$/);
        console.info(
            `[PERF] control positivo (escritura legacy que cambia 1 producto) → 1 bucket más (${upsertMock.docIds[0]}) — `
            + `el detector ve los bytes que el gate dice que no hay`,
        );
    }, 120_000);

    it('publicación de ventas: monolito legacy vs Fase 4 (completa y por venta nueva)', async () => {
        const { sales } = loadBackup();

        upsertMock.onUpsert = (document, bytes) => {
            stats.uploadBytes += bytes;
            stats.uploadDocs += 1;
        };

        // (1) Legacy (pre-Fase 4): quickHash del doc COMPLETO + un upsert con el
        // historial entero — lo que salía por cada escritura de ventas.
        instrumentStart();
        const t0Mono = performance.now();
        const monoDoc = {
            device_id: DEVICE_ID,
            collection: 'store',
            doc_id: SALES_SYNC_BASE_KEY,
            data: { payload: sales },
        };
        const hashStr = JSON.stringify(sales); // quickHash legacy: stringify del valor…
        let h = 0;
        for (let i = 0; i < hashStr.length; i++) h = (Math.imul(31, h) + hashStr.charCodeAt(i)) | 0; // …+ barrido del doc
        void h;
        await supabaseCloud.from('sync_documents').upsert(monoDoc);
        const monoMs = performance.now() - t0Mono;
        const monoBytes = stats.uploadBytes;

        // (2) Fase 4, publicación completa (force, como el lote de inventario).
        stats.uploadBytes = 0;
        stats.uploadDocs = 0;
        const t0F4 = performance.now();
        const full = await pushCloudSync(SALES_SYNC_BASE_KEY, sales, true, true, DEVICE_ID);
        const f4FullMs = performance.now() - t0F4;
        const f4Docs = stats.uploadDocs;
        const f4Bytes = stats.uploadBytes;

        // (3) Fase 4, estado estacionario: UNA venta nueva más (la caja cobra y
        // publica). Solo debe reescribir el periodo/shard tocado.
        const newSale = {
            id: 'venta-nueva-perf',
            timestamp: `${sales[sales.length - 1].timestamp || '2026-10-15T10:00:00.000Z'}`,
            items: [{ productId: 'p-1', quantity: 1, price: 10 }],
            total: 10,
            status: 'COMPLETADA',
        };
        stats.uploadBytes = 0;
        stats.uploadDocs = 0;
        const t0Inc = performance.now();
        const inc = await pushCloudSync(SALES_SYNC_BASE_KEY, [...sales, newSale], false, true, DEVICE_ID);
        const f4IncMs = performance.now() - t0Inc;
        const incDocs = stats.uploadDocs;
        const incBytes = stats.uploadBytes;
        const counters = instrumentStop();

        expect(full.ok).toBe(true);
        expect(inc.ok).toBe(true);
        console.info(
            `[PERF] push de ventas (${sales.length} movimientos):\n`
            + `  monolito legacy      : 1 doc / ${(monoBytes / 1e6).toFixed(2)} MB / ${monoMs.toFixed(0)} ms\n`
            + `  Fase 4 completa      : ${f4Docs} docs / ${(f4Bytes / 1e6).toFixed(2)} MB / ${f4FullMs.toFixed(0)} ms\n`
            + `  Fase 4 + 1 venta nueva: ${incDocs} docs / ${(incBytes / 1e3).toFixed(0)} KB / ${f4IncMs.toFixed(0)} ms `
            + `(${counters.stringifyCalls} stringify, ${counters.cloneCalls} clones en total)`,
        );
        // Sella la semántica medible: la escritura incremental toca menos que la
        // completa, y ninguna de las dos supera el doc monolítico.
        expect(incBytes).toBeLessThan(f4Bytes);
        expect(f4Bytes).toBeLessThanOrEqual(monoBytes + 20_000);
    }, 120_000);
});
