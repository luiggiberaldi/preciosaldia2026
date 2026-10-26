import { useEffect, useRef } from 'react';
import localforage from 'localforage';
import { supabaseCloud } from '../config/supabaseCloud';
import { useAuthStore } from './store/useAuthStore';
import { SUPERVISOR_SYNC_KEYS, validateSupervisorSyncDocument } from '../services/supervisorContracts';
import { ensureSupervisorSession } from '../services/supervisorAuth';
import { ensureDeviceSessionRegistered } from '../utils/deviceIdentity';
import { showToast } from '../components/Toast';
import { isPrimaryPairingActive, readPairingRow } from '../services/supervisorPairingState';
import { mergeLedgerEntries, rebuildCustomersFromLedger } from '../utils/customerLedger';
import { isGranelProduct, normalizeStockValue } from '../utils/granel';
import { assessSyncDocBudget, SYNC_DOC_BUDGET_BYTES } from '../utils/syncDocBudget';
import { migrateCatalogImagesOnce } from '../utils/imageUpload';
import { persistCatalogLocked } from '../utils/catalogLock';
import {
    buildSyncEnvelope,
    getSyncMetadataKey,
    getSupervisorRecoveryIntervalMs,
    isNewerSyncDocument,
    readSyncEnvelope,
    withSyncRetry,
} from '../services/supervisorSyncService';

// Una única allowlist compartida por primary y monitor.
const SYNC_KEYS = SUPERVISOR_SYNC_KEYS;

function shortCloudSyncId(value) {
    if (!value || typeof value !== 'string') return null;
    return value.length > 12 ? `${value.slice(0, 8)}…${value.slice(-4)}` : value;
}

// SEC-002: `abasto-auth-storage` (hashes de PIN) YA NO se sincroniza a sync_documents.
// Las políticas RLS de `sync_documents` en el schema original permiten lectura global
// (ver SEC-002/INFRA-002 — fix del SQL corresponde a Agente D). Aunque se arregle la
// RLS, los hashes de PIN no deben viajar por una tabla compartida entre dispositivos.
const LOCAL_KEYS = [
    'bodega_custom_rate',
    'bodega_use_auto_rate',
    'bodega_rate_mode',
    'tasa_cop',
    'cop_enabled',
    'auto_cop_enabled'
];

/**
 * Hash ligero para detectar cambios sin comparar objetos enteros (mismo patrón
 * que useAutoBackup.js).
 *
 * IMPORTANTE: debe recorrer el valor COMPLETO. Antes cortaba en 5000 caracteres,
 * y con catálogos grandes (miles de productos) un cambio de stock queda muy lejos
 * de ese límite y —si el JSON conserva el largo (110 → 105)— ni siquiera cambia
 * `str.length`: el hash quedaba idéntico y `pushCloudSync` saltaba el push como
 * "Sin cambios", así que las ventas de la caja jamás llegaban al supervisor.
 */
function quickHash(value) {
    const str = typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
    let h = 0;
    for (let i = 0; i < str.length; i++) {
        h = Math.imul(31, h) + str.charCodeAt(i) | 0;
    }
    return `${str.length}_${h >>> 0}`;
}

const LAST_PUSH_HASH_PREFIX = 'bodega_last_periodic_push_hash_';

// ─── Fase 4: familia bodega_sales_v1 por periodos ──────────────────────────
// El documento monolítico de ventas (~600 KB medidos en el backup del
// 2026-10-19) se publica partido por periodos:
//   `bodega_sales_v1:<YYYY-MM>` (shards `#2`, `#3`… cuando el mes es enorme)
//   `bodega_sales_v1:recent` (ventas sin fecha válida)
// El lector (monitor y pull inicial) mergea todos los docs de la familia con
// el legacy `bodega_sales_v1`, que sigue legible pero ya NO se reescribe
// (migración perezosa al escribir). Semántica de merge sellada en tests:
//   - doc legacy: unión; los registros locales ganan por id. `[]` limpia todo.
//   - doc de periodo: unión; lo entrante gana por id (mutaciones como
//     `ANULADA` viajan en el doc del periodo). `[]` limpia SOLO ese periodo.
export const SALES_SYNC_BASE_KEY = 'bodega_sales_v1';
// Cota de aceptación del plan: ningún documento de sync_documents pasa de ~500 KB.
// Misma constante que el techo general (utils/syncDocBudget): una sola fuente.
export const SALES_SYNC_MAX_DOC_BYTES = SYNC_DOC_BUDGET_BYTES;
// Presupuesto de empaquetado por shard (deja margen bajo la cota dura).
export const SALES_SYNC_PACK_BUDGET_BYTES = 400_000;
// Documentos publicados alguna vez por este equipo: el vaciado total debe
// tumbearlos a todos para que ningún lector conserve ventas fantasma.
export const SALES_SYNC_TRACKING_KEY = 'pda_sales_sync_docs_v1';

export function isSalesSyncDocId(docId) {
    return docId === SALES_SYNC_BASE_KEY
        || (typeof docId === 'string' && docId.startsWith(`${SALES_SYNC_BASE_KEY}:`));
}

function salesPeriodFromTimestamp(value) {
    if (typeof value !== 'string') return null;
    const candidate = value.slice(0, 7);
    return /^\d{4}-\d{2}$/.test(candidate) ? candidate : null;
}

/** Periodo de una venta: `YYYY-MM` de su fecha; sin fecha válida → `recent`. */
export function getSalesSyncPeriodOf(record) {
    return salesPeriodFromTimestamp(record?.timestamp)
        || salesPeriodFromTimestamp(record?.fecha)
        || 'recent';
}

function parseSalesSyncDocId(docId) {
    if (!isSalesSyncDocId(docId) || docId === SALES_SYNC_BASE_KEY) return null;
    const rest = docId.slice(SALES_SYNC_BASE_KEY.length + 1);
    const match = rest.match(/^(.*?)(?:#(\d+))?$/);
    if (!match || !match[1]) return null;
    return { period: match[1], shard: match[2] ? Number(match[2]) : 1 };
}

function compareSalesRecords(a, b) {
    const ta = a?.timestamp || a?.fecha || '';
    const tb = b?.timestamp || b?.fecha || '';
    if (ta !== tb) return ta < tb ? -1 : 1;
    const ia = String(a?.id ?? '');
    const ib = String(b?.id ?? '');
    return ia < ib ? -1 : ia > ib ? 1 : 0;
}

// ─── Cache de tamaños por registro (hashing de publicación) ──────────────────
// El empaquetado de shards necesita los bytes del JSON de CADA registro, y
// medirlos serializaba el historial completo en cada publicación: con el backup
// real (496 ventas) eran ~496 stringify solo para el plan — «los 516» del lote,
// con los hashes de slices encima. Los bytes son solo insumo de EMPAQUETADO
// (la cota es advisory: «medir y avisar, nunca bloquear»), así que se cachean
// por id. El cache se auto-repara: cuando un slice se publica, la longitud real
// de su JSON (que `quickHash` devuelve como primer campo de su hash) se compara
// con la suma cacheada; si no cuadra —un registro reemplazado cambió de
// tamaño— las entradas de ese slice se invalidan y el siguiente plan las
// re-mide. La corrección del DIFF jamás depende del cache: los hashes de
// slices siempre salen del contenido real.
const salesRecordBytesCache = new Map(); // id → bytes del JSON del registro
const SALES_RECORD_BYTES_CACHE_MAX = 100_000;

/** Limpia el cache de tamaños (tests; también apto tras importaciones masivas). */
export function resetSalesRecordBytesCache() {
    salesRecordBytesCache.clear();
}

/** Cache de tamaños vivo (solo tests: observar llenado y auto-reparación). */
export function salesRecordBytesCacheView() {
    return salesRecordBytesCache;
}

function salesRecordBytes(record, cache) {
    const id = record?.id;
    if (!cache || id == null) return JSON.stringify(record).length + 1;
    const key = String(id);
    const cached = cache.get(key);
    if (cached != null) return cached;
    const bytes = JSON.stringify(record).length + 1;
    if (cache.size >= SALES_RECORD_BYTES_CACHE_MAX) cache.clear();
    cache.set(key, bytes);
    return bytes;
}

/**
 * Parte las ventas en documentos por periodo (con shards por presupuesto de
 * bytes). El orden es canónico (fecha, id), así que un append al final del
 * periodo solo reescribe el último shard: la escritura incremental toca el
 * periodo y el shard tocados, nunca el historial completo.
 *
 * `recordBytes` es un cache opcional id → bytes del JSON del registro (ver
 * `salesRecordBytesCache`): sin él se mide serializando cada registro (camino
 * exacto de tests y respaldos); con él, los registros ya vistos no se vuelven
 * a serializar. Los valores son idénticos cuando las entradas están frescas.
 */
export function buildSalesSyncPlan(sales, { recordBytes } = {}) {
    const list = Array.isArray(sales) ? sales : [];
    const byPeriod = new Map();
    for (const record of list) {
        const period = getSalesSyncPeriodOf(record);
        if (!byPeriod.has(period)) byPeriod.set(period, []);
        byPeriod.get(period).push(record);
    }

    const plan = [];
    for (const [period, records] of byPeriod) {
        const sorted = [...records].sort(compareSalesRecords);
        let shard = [];
        let shardBytes = 0;
        let shardIndex = 0;
        const flush = () => {
            if (shard.length === 0) return;
            shardIndex += 1;
            plan.push({
                docId: shardIndex === 1
                    ? `${SALES_SYNC_BASE_KEY}:${period}`
                    : `${SALES_SYNC_BASE_KEY}:${period}#${shardIndex}`,
                period,
                shard: shardIndex,
                records: shard,
                bytes: shardBytes,
            });
            shard = [];
            shardBytes = 0;
        };
        for (const record of sorted) {
            const bytes = salesRecordBytes(record, recordBytes);
            if (shard.length > 0 && shardBytes + bytes > SALES_SYNC_PACK_BUDGET_BYTES) flush();
            shard.push(record);
            shardBytes += bytes;
        }
        flush();
    }
    return plan;
}

/**
 * Merge de un documento de la familia en el arreglo local de ventas.
 * El doc legacy es unión con "lo local gana" (nunca pisa: es histórico);
 * los docs de periodo son unión con "lo entrante gana" (llevan las
 * mutaciones frescas). `[]` = tombstone: limpia el periodo del doc, o todo
 * si es el legacy (semántica de snapshot vacío publicable de F3).
 */
export function mergeSalesSyncDoc(localSales, docId, payload) {
    const local = Array.isArray(localSales) ? localSales : [];
    const incoming = Array.isArray(payload) ? payload : [];

    if (docId === SALES_SYNC_BASE_KEY) {
        if (incoming.length === 0) return [];
        const localIds = new Set(local.map((r) => r?.id));
        return [...local, ...incoming.filter((r) => !localIds.has(r?.id))];
    }

    const parsed = parseSalesSyncDocId(docId);
    if (!parsed) return local;

    if (incoming.length === 0) {
        return local.filter((r) => getSalesSyncPeriodOf(r) !== parsed.period);
    }

    const incomingIds = new Set(incoming.map((r) => r?.id));
    const incomingById = new Map(incoming.map((r) => [r?.id, r]));
    const merged = local.map((r) => (incomingIds.has(r?.id) ? incomingById.get(r?.id) : r));
    const localIds = new Set(local.map((r) => r?.id));
    for (const record of incoming) {
        if (!localIds.has(record?.id)) merged.push(record);
    }
    return merged;
}

function readSalesSyncTrackedIds() {
    try {
        const parsed = JSON.parse(localStorage.getItem(SALES_SYNC_TRACKING_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter((id) => isSalesSyncDocId(id)) : [];
    } catch {
        return [];
    }
}

function rememberSalesSyncTrackedIds(ids) {
    const merged = new Set([...readSalesSyncTrackedIds(), ...ids.filter((id) => isSalesSyncDocId(id))]);
    localStorage.setItem(SALES_SYNC_TRACKING_KEY, JSON.stringify([...merged]));
}

// ─── Fase 5: familia bodega_products_v1 por buckets de hash ─────────────────
// docs/plans/2026-10-21-plan-adelgazar-bodega-products-por-shards.md: el doc
// monolítico de productos (~1.32 MB en el backup del 2026-10-19) se publica
// partido en 32 buckets fijos por hash del `id` (inmutable → derivable en
// cualquier dispositivo; NO por categoría, que es un campo mutable):
//   `bodega_products_v1:b<2 hex>` (`:b00` … `:b1f`).
// Un doc = una franja COMPLETA del bucket, en orden canónico por id. La
// semántica del lector es REEMPLAZO DE FRANJA (no unión como ventas): los
// datos son entidades mutables y borrables y el borrado debe propagarse. El
// legacy `bodega_products_v1` se congela (migración perezosa M1: no se
// reescribe más que para tumbas de vaciado) y se mergea con unión "lo local
// gana"; `[]` en el legacy limpia TODO, `[]` en un bucket limpia esa franja.
export const PRODUCTS_SYNC_BASE_KEY = 'bodega_products_v1';
// Cota dura por bucket (gate del escritor): un bucket sobre techo significa que
// la partición 32 se quedó corta y toca re-bucketizar (§2/§7 del plan), no
// publicar un doc que volvería a romper Realtime (413).
export const PRODUCTS_SYNC_MAX_DOC_BYTES = SYNC_DOC_BUDGET_BYTES;
// Documentos de productos publicados alguna vez por este equipo: el vaciado
// total debe tumbearlos a todos (espejo de SALES_SYNC_TRACKING_KEY).
export const PRODUCTS_SYNC_TRACKING_KEY = 'pda_products_sync_docs_v1';
export const PRODUCTS_SYNC_BUCKET_COUNT = 32;

// fnv1a32: hash estable de 32 bits, idéntico en escritor y lector (el bucket de
// un producto debe derivarse igual en cualquier dispositivo, sin estado).
function fnv1a32(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i += 1) {
        h ^= str.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
}

/** Bucket fijo (0-31) de un producto, derivado SOLO de su `id`. */
export function productBucketOf(id) {
    return fnv1a32(String(id)) & (PRODUCTS_SYNC_BUCKET_COUNT - 1);
}

/** Doc id del bucket (`bodega_products_v1:b00` … `:b1f`). */
export function productsDocIdFor(bucket) {
    return `${PRODUCTS_SYNC_BASE_KEY}:b${Number(bucket).toString(16).padStart(2, '0')}`;
}

export function isProductsSyncDocId(docId) {
    return docId === PRODUCTS_SYNC_BASE_KEY
        || (typeof docId === 'string' && docId.startsWith(`${PRODUCTS_SYNC_BASE_KEY}:`));
}

/** Bucket de un doc de la familia; null si no es un doc de bucket (`:bNN`). */
export function parseProductsSyncDocId(docId) {
    if (typeof docId !== 'string' || docId === PRODUCTS_SYNC_BASE_KEY) return null;
    const rest = docId.slice(PRODUCTS_SYNC_BASE_KEY.length + 1);
    const match = rest.match(/^b([0-9a-f]{2})$/);
    if (!match) return null;
    const bucket = Number.parseInt(match[1], 16);
    return bucket < PRODUCTS_SYNC_BUCKET_COUNT ? bucket : null;
}

function compareProductsById(a, b) {
    const ia = String(a?.id ?? '');
    const ib = String(b?.id ?? '');
    return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/**
 * Parte el catálogo en documentos por bucket de hash. Un doc = la franja
 * completa del bucket, en orden canónico por id (round-trip sin pérdidas ni
 * duplicados: cada producto cae exactamente en un bucket).
 */
export function buildProductsSyncPlan(products) {
    const list = Array.isArray(products) ? products : [];
    const byBucket = new Map();
    for (const record of list) {
        const bucket = productBucketOf(record?.id);
        if (!byBucket.has(bucket)) byBucket.set(bucket, []);
        byBucket.get(bucket).push(record);
    }
    return [...byBucket.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([bucket, records]) => {
            const sorted = [...records].sort(compareProductsById);
            return {
                docId: productsDocIdFor(bucket),
                bucket,
                records: sorted,
                bytes: JSON.stringify(sorted).length + 1,
            };
        });
}

/**
 * Merge de un documento de la familia de productos en el catálogo local.
 *  - doc legacy: unión con "lo local gana" (histórico congelado; nunca pisa).
 *    `skipBuckets` (franjas con doc de bucket aplicado) se excluyen de la
 *    unión: el bucket es la autoridad de SU franja y el legacy congelado no
 *    puede resucitar un producto borrado que su bucket ya no trae. `[]` limpia
 *    TODO (semántica F3 del snapshot vacío publicable).
 *  - doc de bucket: REEMPLAZO DE FRANJA — sustituye exactamente los ids del
 *    bucket por el payload entrante, así el borrado se propaga. `[]` limpia
 *    SOLO esa franja (tombstone del bucket).
 * Payload no-arreglo → no-op (devuelve el local tal cual).
 */
export function mergeProductsSyncDoc(localProducts, docId, payload, { skipBuckets = [] } = {}) {
    const local = Array.isArray(localProducts) ? localProducts : [];
    if (!Array.isArray(payload)) return local;

    if (docId === PRODUCTS_SYNC_BASE_KEY) {
        if (payload.length === 0) return [];
        const skip = new Set(skipBuckets);
        const localIds = new Set(local.map((p) => p?.id));
        return [
            ...local,
            ...payload.filter((p) => !localIds.has(p?.id) && !skip.has(productBucketOf(p?.id))),
        ];
    }

    const bucket = parseProductsSyncDocId(docId);
    if (bucket === null) return local;

    const withoutStripe = local.filter((p) => productBucketOf(p?.id) !== bucket);
    return payload.length === 0 ? withoutStripe : [...withoutStripe, ...payload];
}

function readProductsSyncTrackedIds() {
    try {
        const parsed = JSON.parse(localStorage.getItem(PRODUCTS_SYNC_TRACKING_KEY) || '[]');
        return Array.isArray(parsed) ? parsed.filter((id) => isProductsSyncDocId(id)) : [];
    } catch {
        return [];
    }
}

function rememberProductsSyncTrackedIds(ids) {
    const merged = new Set([...readProductsSyncTrackedIds(), ...ids.filter((id) => isProductsSyncDocId(id))]);
    localStorage.setItem(PRODUCTS_SYNC_TRACKING_KEY, JSON.stringify([...merged]));
}

/**
 * Franjas cuyo doc de bucket YA se aplicó en este equipo (su watermark
 * persiste). El legacy congelado no debe re-añadir sus ids: el bucket es la
 * autoridad de SU franja y así el borrado se propaga sin importar el orden de
 * aplicación de los docs en un pull inicial.
 */
function readAppliedProductsStripeBuckets() {
    const buckets = [];
    for (let bucket = 0; bucket < PRODUCTS_SYNC_BUCKET_COUNT; bucket += 1) {
        const docId = productsDocIdFor(bucket);
        if (localStorage.getItem(getSyncMetadataKey(docId)) != null) buckets.push(bucket);
    }
    return buckets;
}

/**
 * Baseline del catálogo (plan de stock delta, Fase 5) por franjas: cada bucket
 * guarda SU `stockAsOf` en `stripeAsOf` y el legacy el suyo en `stockAsOf`.
 * Al aplicar un doc de la familia, el bucket es la autoridad de SU franja
 * (reemplazo, también con `[]` = franja vacía) y queda registrado para que el
 * legacy congelado no resucite sus ids. `[]` en el legacy limpia TODO.
 */
export function applyProductsDocToBaseline(baseline, docId, payload, { stockAsOf = null } = {}) {
    const current = baseline && typeof baseline === 'object' && Array.isArray(baseline.products)
        ? baseline
        : { products: [], stockAsOf: null, stripeAsOf: {} };
    if (!Array.isArray(payload)) return current;
    const stripeAsOf = { ...(current.stripeAsOf || {}) };

    if (docId === PRODUCTS_SYNC_BASE_KEY) {
        if (payload.length === 0) return { products: [], stockAsOf: null, stripeAsOf: {} };
        const skipBuckets = Object.keys(stripeAsOf)
            .map((key) => parseProductsSyncDocId(key))
            .filter((bucket) => bucket !== null);
        return {
            products: mergeProductsSyncDoc(current.products, docId, payload, { skipBuckets }),
            stockAsOf: stockAsOf ?? null,
            stripeAsOf,
        };
    }

    const bucket = parseProductsSyncDocId(docId);
    if (bucket === null) return current;
    stripeAsOf[docId] = stockAsOf ?? null;
    return {
        products: mergeProductsSyncDoc(current.products, docId, payload),
        stockAsOf: current.stockAsOf ?? null,
        stripeAsOf,
    };
}

/**
 * Vista derivada del catálogo: baseline por franjas + efectos de la familia de
 * ventas que el baseline todavía no incluye. Cada producto pliega los efectos
 * posteriores al cutoff de SU franja (los grupos por cutoff se pliegan con la
 * misma `reconcileStockFromEffects` de siempre).
 */
export function deriveProductsFromBaseline(baseline, sales) {
    const products = Array.isArray(baseline?.products) ? baseline.products : [];
    const stripeAsOf = baseline?.stripeAsOf && typeof baseline.stripeAsOf === 'object'
        ? baseline.stripeAsOf
        : {};
    const legacyCutoff = baseline?.stockAsOf ?? null;
    const groups = new Map();
    for (const product of products) {
        const docId = productsDocIdFor(productBucketOf(product?.id));
        const cutoff = Object.prototype.hasOwnProperty.call(stripeAsOf, docId)
            ? stripeAsOf[docId]
            : legacyCutoff;
        if (!groups.has(cutoff)) groups.set(cutoff, []);
        groups.get(cutoff).push(product);
    }
    const derived = [];
    for (const [cutoff, group] of groups) {
        derived.push(...reconcileStockFromEffects(group, sales, cutoff));
    }
    return derived;
}

// ─── Fase 1 del plan de stock delta ──────────────────────────────────────────
// docs/plans/2026-10-21-plan-stock-delta-en-doc-de-venta.md: el movimiento de
// stock de cada cobro/anulación viaja embebido en el registro de la familia de
// ventas (`stockEffects: [{ productId, delta, at }]`, log append-only: la
// anulación agrega sus efectos inversos al mismo registro), y los movimientos
// de lote del supervisor ya traen stockBefore/stockAfter. El lector deriva el
// stock visible:
//     stock = baseline (payload del catálogo publicado, con su `stockAsOf`)
//           + Σ efectos con `at` POSTERIOR a `stockAsOf`
// Es una suma sobre registros completos: idempotente, insensible al orden y
// re-derivable desde cero. Sin `stockAsOf` válido no se pliega nada (el doc de
// catálogo se usa tal cual: compatibilidad con escritores legacy).

function effectIsAfter(effectAt, stockAsOf) {
    if (typeof effectAt !== 'string' || typeof stockAsOf !== 'string') return false;
    const at = Date.parse(effectAt);
    const asOf = Date.parse(stockAsOf);
    return !Number.isNaN(at) && !Number.isNaN(asOf) && at > asOf;
}

/**
 * Suma neta de deltas de stock por producto para los efectos posteriores a
 * `stockAsOf`. Fuentes: `stockEffects` de cada registro (cobros y anulaciones)
 * y los movimientos de lote del supervisor (delta = stockAfter − stockBefore).
 */
export function collectStockEffectsDeltas(sales, stockAsOf) {
    const deltas = new Map();
    if (typeof stockAsOf !== 'string' || Number.isNaN(Date.parse(stockAsOf))) return deltas;
    const add = (productId, delta, at) => {
        if (productId == null || !Number.isFinite(delta) || delta === 0) return;
        if (!effectIsAfter(at, stockAsOf)) return;
        const key = String(productId);
        deltas.set(key, (deltas.get(key) || 0) + delta);
    };
    for (const record of Array.isArray(sales) ? sales : []) {
        if (!record) continue;
        if (Array.isArray(record.stockEffects)) {
            for (const effect of record.stockEffects) {
                add(effect?.productId, Number(effect?.delta), effect?.at);
            }
        } else if (typeof record.movementId === 'string' && record.productId != null
            && Number.isFinite(Number(record.stockAfter)) && Number.isFinite(Number(record.stockBefore))) {
            add(record.productId, Number(record.stockAfter) - Number(record.stockBefore), record.timestamp);
        }
    }
    return deltas;
}

/**
 * Stock derivado: baseline del catálogo + efectos no incluidos en él. Devuelve
 * la lista tal cual cuando no hay nada que plegar (o no hay baseline).
 */
export function reconcileStockFromEffects(products, sales, stockAsOf) {
    const list = Array.isArray(products) ? products : [];
    const deltas = collectStockEffectsDeltas(sales, stockAsOf);
    if (deltas.size === 0) return list;
    return list.map(product => {
        const delta = deltas.get(String(product?.id));
        if (!delta || !product) return product;
        const base = Number(product.stock) || 0;
        return { ...product, stock: normalizeStockValue(base + delta, isGranelProduct(product)) };
    });
}

/**
 * Evidencia de que este equipo ya sincronizó antes (hashes de push confirmados
 * o metadotos de documentos aplicados). Un equipo verdaderamente nuevo no tiene
 * ninguna de las dos. Sirve para distinguir "aún no se vincula" de "la fila del
 * vínculo existe pero esta caja ya no puede verla" (identidad desfasada, ver
 * migración 20261017_supervisor_pairing_identity_selfheal.sql).
 */
function hasPriorSyncEvidence() {
    try {
        for (let i = 0; i < localStorage.length; i += 1) {
            const key = localStorage.key(i);
            if (key && key.startsWith(LAST_PUSH_HASH_PREFIX)) return true;
        }
        return SYNC_KEYS.some((docId) => localStorage.getItem(getSyncMetadataKey(docId)) != null);
    } catch {
        return false;
    }
}

// Fase F3: claves del snapshot crítico. `[]` es un estado PUBLICABLE (vacío
// confirmado); `null` (clave ausente) NO se publica. Esa distinción es la que
// permite purgar el estado fantasma desde un POS vacío.
export const EMPTY_SNAPSHOT_KEYS = ['bodega_sales_v1', 'bodega_products_v1', 'bodega_customers_v1', 'bodega_customer_ledger_v1', 'bodega_accounts_v2'];

// ─── Estado Global del Motor ───────────────────────────────────────────────
let globalSubscription = null;
let isSyncingFromCloud = false; // true mientras aplicamos cambios de la nube → evita eco
let pendingPush = {};           // Debounce: { [key]: { timer, capturedAt } }
let _currentDeviceId = '';      // Device ID activo para pushCloudSync
let isCloudSyncActive = false;   // Evita empujar a la nube si el dispositivo no está autenticado/emparejado

// SEC-009 / HOOK-011: ELIMINADO el monkeypatch global de `localStorage.setItem`.
// Antes se reemplazaba `localStorage.setItem` a nivel módulo, interceptando TODAS
// las escrituras (incluyendo extensiones y devtools) y empujando a sync_documents.
// Eso causaba:
//   1. Recursión si el módulo se importa dos veces (HMR, tests).
//   2. Filtrado de hashes de PIN a una tabla pública (SEC-002).
//
// Ahora, los puntos de escritura explícitos llaman a `storageService.setItem` (que
// invoca `pushCloudSync` internamente). Para localStorage writes directos, los
// callers deben usar `pushLocalSync(key, value)` explícitamente.
//
// Mantenemos `originalSetItem` como referencia interna solo para aplicar cambios
// venidos de la nube sin disparar re-eco.

const originalSetItem = localStorage.setItem.bind(localStorage);

// Keys pesadas (arrays grandes con imágenes) usan debounce más largo para agrupar ediciones
const HEAVY_KEYS = ['bodega_products_v1', 'bodega_sales_v1', 'bodega_customers_v1', 'bodega_customer_ledger_v1', 'abasto_audit_log_v1'];
const DEBOUNCE_LIGHT_MS = 300;
const DEBOUNCE_HEAVY_MS = 3000;

function _debouncePush(key, value) {
    if (pendingPush[key]) clearTimeout(pendingPush[key].timer);
    const delay = HEAVY_KEYS.includes(key) ? DEBOUNCE_HEAVY_MS : DEBOUNCE_LIGHT_MS;
    // Fase 1 del plan de stock delta: `capturedAt` es el instante en que el
    // valor quedó producido (la escritura local que lo encoló), NO el del push:
    // una venta entre captura y push no está reflejada en el payload y su
    // efecto debe plegarse aparte en el lector (ver stockAsOfFor).
    const capturedAt = new Date().toISOString();
    pendingPush[key] = {
        capturedAt,
        timer: setTimeout(() => {
            delete pendingPush[key];
            pushCloudSync(key, value, false, false, null, capturedAt).catch(() => {});
        }, delay),
    };
}

/**
 * Solo el doc de productos sella baseline de stock: su payload es un snapshot
 * del catálogo cuyo `stock` ya incluye todos los efectos con `at <= stockAsOf`.
 */
function stockAsOfFor(key, capturedAt) {
    if (key !== 'bodega_products_v1') return null;
    return capturedAt || new Date().toISOString();
}

// ─── Proyección de sincronización del audit log ─────────────────────────────
// La copia LOCAL de `abasto_audit_log_v1` conserva MAX_ENTRIES (15.000) y la
// retención fiscal de 5 años de auditService; la copia SINCRONIZADA solo
// publica las entradas más recientes (el log está ordenado «más reciente
// primero», así que slice(0, N) son las N frescas). Medido en producción el
// 2026-10-24: 5.743 entradas ≈ 1,78 MB — sobre el límite de ~1 MB de Realtime
// (eventos 413) y el techo de 500 KB de syncDocBudget. Con 1.200 la copia
// publicada queda en ~370 KB. El historial completo viaja en los respaldos
// (cloud_backups / backup local), que no pasan por sync_documents.
export const AUDIT_SYNC_MAX_ENTRIES = 1_200;

/** Proyección por clave del payload PUBLICADO (no del valor local). */
export function projectSyncPayload(key, value) {
    if (key === 'abasto_audit_log_v1' && Array.isArray(value)) {
        return value.slice(0, AUDIT_SYNC_MAX_ENTRIES);
    }
    return value;
}

export const pushCloudSync = async (key, value, forceUnconditional = false, allowBeforePairing = false, deviceIdOverride = null, capturedAt = null) => {
    if (!supabaseCloud) return { ok: false, skipped: true, error: 'Supabase no disponible' };
    if (isSyncingFromCloud) return { ok: false, skipped: true, error: 'Cambio remoto en aplicación' };
    // El primer pairing necesita publicar el snapshot antes de que exista
    // monitor_device_id. Solo forceSyncAllPOSData(..., allowBeforePairing=true)
    // puede abrir esta excepción; los pushes normales siguen bloqueados.
    if (!isCloudSyncActive && !allowBeforePairing) return { ok: false, skipped: true, error: 'Sync no activo' };
    if (!SYNC_KEYS.includes(key)) return { ok: false, skipped: true, error: 'Clave no allowlisted' };
    // El documento se estampa con el deviceId REGISTRADO cuando el caller lo conoce
    // (forceSyncAllPOSData): is_own_device_row(device_id) debe coincidir con la fila
    // de device_sessions o el upsert muere con RLS "new row violates…".
    const stampDeviceId = deviceIdOverride || _currentDeviceId;
    if (!stampDeviceId) return { ok: false, skipped: true, error: 'Dispositivo no definido' };

    // SEC-002: jamás empujar `abasto-auth-storage` aunque accidentalmente lo pidan.
    if (key === 'abasto-auth-storage') return { ok: false, skipped: true, error: 'Documento de autenticación bloqueado' };

    // Proyección por clave (audit log): el hash y el upsert ven la copia
    // PUBLICADA, no el valor local completo — hashear el completo haría que
    // cualquier escritura local re-publicara siempre el mismo payload recortado.
    const syncValue = projectSyncPayload(key, value);

    const hashKey = LAST_PUSH_HASH_PREFIX + key;
    const currentHash = quickHash(syncValue);
    if (!forceUnconditional && localStorage.getItem(hashKey) === currentHash) {
        return { ok: true, skipped: true, reason: 'Sin cambios' };
    }

    // Fase 4: la familia de ventas se publica partido por periodos.
    if (key === SALES_SYNC_BASE_KEY) {
        return pushSalesFamilySync(value, { stampDeviceId, forceUnconditional, hashKey, currentHash });
    }

    // Fase 5: la familia de productos se publica por buckets de hash.
    if (key === PRODUCTS_SYNC_BASE_KEY) {
        return pushProductsFamilySync(value, { stampDeviceId, hashKey, currentHash, capturedAt });
    }

    const result = await upsertSyncDocument(stampDeviceId, key, syncValue, { stockAsOf: stockAsOfFor(key, capturedAt) });
    if (!result.ok) return { ok: false, skipped: false, error: result.error };

    // Solo confirmar el hash después de que Supabase confirmó el upsert.
    localStorage.setItem(hashKey, currentHash);
    return { ok: true, skipped: false, updatedAt: result.updatedAt, data: result.data ?? null, budget: result.budget ?? null };
};

/**
 * Tumbas de un vaciado total (F3): `[]` publicable en el legacy más todos los
 * docs de la familia publicados alguna vez por este equipo. Compartida por las
 * familias de ventas y productos (Fase 5).
 */
async function publishFamilyTombstones(stampDeviceId, baseKey, trackedIds) {
    const tombstones = [...new Set([baseKey, ...trackedIds])];
    for (const docId of tombstones) {
        const result = await upsertSyncDocument(stampDeviceId, docId, []);
        if (!result.ok) return { ok: false, error: result.error, published: tombstones };
        localStorage.setItem(LAST_PUSH_HASH_PREFIX + docId, quickHash([]));
    }
    return { ok: true, published: tombstones };
}

/**
 * Fase 4: publica `bodega_sales_v1` partido por periodos.
 *  - Solo reescribe los documentos cuyo contenido cambió (hash por documento):
 *    una venta nueva toca el periodo (y shard) suyos, no el historial entero.
 *  - El doc legacy NO se reescribe (migración perezosa al escribir): queda
 *    como histórico legible que los lectores mergean con los periodos.
 *  - Con el arreglo vacío (vaciado confirmado) se tumba el legacy y todos los
 *    periodos publicados: el snapshot vacío es publicable (F3) y ningún lector
 *    conserva ventas fantasma.
 */
async function pushSalesFamilySync(value, { stampDeviceId, forceUnconditional, hashKey, currentHash }) {
    const list = Array.isArray(value) ? value : null;
    if (!list) return { ok: false, skipped: false, error: 'Documento de ventas inválido' };

    const updatedAt = new Date().toISOString();

    if (list.length === 0) {
        const tombstoned = await publishFamilyTombstones(stampDeviceId, SALES_SYNC_BASE_KEY, readSalesSyncTrackedIds());
        if (!tombstoned.ok) return { ok: false, skipped: false, error: tombstoned.error };
        localStorage.setItem(hashKey, currentHash);
        return { ok: true, skipped: false, updatedAt, published: tombstoned.published };
    }

    const plan = buildSalesSyncPlan(list, { recordBytes: salesRecordBytesCache });
    const published = [];
    for (const slice of plan) {
        const sliceHash = quickHash(slice.records);
        const sliceHashKey = LAST_PUSH_HASH_PREFIX + slice.docId;
        if (!forceUnconditional && localStorage.getItem(sliceHashKey) === sliceHash) continue;
        const result = await upsertSyncDocument(stampDeviceId, slice.docId, slice.records);
        if (!result.ok) return { ok: false, skipped: false, error: result.error, published };
        // Auto-reparación del cache de tamaños: `quickHash` devuelve
        // `"<len>_<hash>"` y `len` es la longitud REAL del JSON del slice
        // (nunca cacheada). Si no cuadra con la suma cacheada (`len − 1`), algún
        // registro de este slice fue reemplazado con otro tamaño (una
        // anulación, una importación): sus entradas quedan inválidas y el
        // siguiente plan las re-mide. El diff no depende del cache: este hash
        // salió del contenido real del slice.
        const realJsonLength = Number(sliceHash.slice(0, sliceHash.indexOf('_')));
        if (realJsonLength !== slice.bytes + 1) {
            for (const record of slice.records) {
                if (record?.id != null) salesRecordBytesCache.delete(String(record.id));
            }
        }
        localStorage.setItem(sliceHashKey, sliceHash);
        published.push(slice.docId);
    }
    rememberSalesSyncTrackedIds(published);
    localStorage.setItem(hashKey, currentHash);
    // Migración perezosa completada: una vez que los shards cubren el
    // historial, la fila legacy se retira (best-effort; nunca rompe el push).
    await retireLegacySalesDoc(stampDeviceId);
    return { ok: true, skipped: false, updatedAt, published };
}

// Retiro del doc legacy `bodega_sales_v1` (migración perezosa completada).
// Tras partir el historial en shards, la fila legacy queda como peso muerto:
// ningún escritor moderno la vuelve a tocar y solo genera eventos 413 y
// egress (en producción: 5,29 MB / 3.345 ventas). Como el plan de shards se
// reconstruye desde la lista local COMPLETA, la unión de los docs publicados
// cubre todo lo que la fila legacy contiene (verificado contra producción el
// 2026-10-24: 3.345/3.345 ids presentes, 0 faltantes), así que la fila se
// BORRA una sola vez por dispositivo. No se usa `[]`: cualquier lector lo
// interpretaría como «vaciar todas las ventas» (semántica F3 del vaciado
// total). Requiere la política `device_delete_own_sync_doc` (migración
// 20261024); sin ella RLS filtra el delete y se reintenta más tarde.
const LEGACY_RETIRED_FLAG = 'pda_sales_legacy_retired_v1';
const LEGACY_RETIRED_LAST_TRY_KEY = 'pda_sales_legacy_retire_try_v1';
const LEGACY_RETIRED_RETRY_MS = 24 * 60 * 60 * 1000;

async function retireLegacySalesDoc(stampDeviceId) {
    try {
        if (localStorage.getItem(LEGACY_RETIRED_FLAG)) return;
        const lastTry = Date.parse(localStorage.getItem(LEGACY_RETIRED_LAST_TRY_KEY) || '') || 0;
        if (lastTry && Date.now() - lastTry < LEGACY_RETIRED_RETRY_MS) return;
        localStorage.setItem(LEGACY_RETIRED_LAST_TRY_KEY, new Date().toISOString());

        const table = supabaseCloud?.from?.('sync_documents');
        if (typeof table?.delete !== 'function') return;
        const { data: deleted, error } = await table
            .delete()
            .eq('device_id', stampDeviceId)
            .eq('doc_id', SALES_SYNC_BASE_KEY)
            .select('id');
        if (error) {
            console.warn('[CloudSync] No se pudo retirar el doc legacy de ventas:', error.message || error);
            return;
        }
        if (Array.isArray(deleted) && deleted.length > 0) {
            localStorage.setItem(LEGACY_RETIRED_FLAG, '1');
            return;
        }
        // 0 filas borradas: o la fila ya no existe (retirada por otro camino) o
        // RLS la filtró. Confirmar la ausencia antes de dar el retiro por bueno;
        // si sigue ahí, el reintento vence en 24 h.
        if (typeof table?.select !== 'function') return;
        const chain = table.select('id').eq('device_id', stampDeviceId).eq('doc_id', SALES_SYNC_BASE_KEY);
        const { data: remaining, error: readError } = await (chain.limit ? chain.limit(1) : chain);
        if (!readError && Array.isArray(remaining) && remaining.length === 0) {
            localStorage.setItem(LEGACY_RETIRED_FLAG, '1');
        }
    } catch (error) {
        // Best-effort: el retiro nunca rompe la publicación de ventas.
        console.warn('[CloudSync] No se pudo retirar el doc legacy de ventas:', error?.message || error);
    }
}

/**
 * Fase 5: publica `bodega_products_v1` por buckets de hash (32 fijos).
 *  - Solo reescribe los buckets cuyo contenido cambió (hash por documento):
 *    un edit de producto toca SU doc de ~40 KB, no el monolito de 1.32 MB.
 *    El diff por hash es SIEMPRE el mecanismo (también con forceUnconditional):
 *    los llamadores legacy (comandos, cloudPublishQueue, forceSyncAllPOSData)
 *    siguen mandando force, pero eso ya no puede re-mandar el catálogo entero —
 *    sería volver al monolito que esta fase elimina (gate: edit → ~40 KB).
 *  - El legacy NO se reescribe (migración perezosa M1: queda congelado como
 *    histórico que los lectores mergean con los buckets); solo se tumba con un
 *    vaciado total. El retiro del legacy es una decisión aparte (M2).
 *  - Con el arreglo vacío (vaciado confirmado) se tumba el legacy y todos los
 *    buckets publicados: snapshot vacío publicable, sin fantasmas.
 *  - Una baja que vacía SU bucket tumba ese doc con `[]`: sin la tumba, la
 *    franja vieja del doc sobrevive en la nube y el monitor conserva el
 *    producto fantasma (regresión de Fase 5, 2026-10-26). La tumba solo sale
 *    con evidencia de que este equipo publicó ese doc antes (hash por doc o
 *    tracking): un doc nunca publicado no tiene franja que limpiar.
 *  - Un bucket sobre PRODUCTS_SYNC_MAX_DOC_BYTES NO bloquea la publicación
 *    (política sellada de syncDocBudget: «medir y avisar, nunca bloquear» —
 *    bloquear rompería la sincronización de catálogos con productos gigantes),
 *    pero queda advertido con SU bucket señalado: significa que la partición 32
 *    se quedó corta y toca re-bucketizar (§2/§7 del plan), antes de que esos
 *    docs vuelvan a degradar Realtime con eventos 413.
 */
async function pushProductsFamilySync(value, { stampDeviceId, hashKey, currentHash, capturedAt = null }) {
    const list = Array.isArray(value) ? value : null;
    if (!list) return { ok: false, skipped: false, error: 'Documento de productos inválido' };

    const updatedAt = new Date().toISOString();

    if (list.length === 0) {
        const tombstoned = await publishFamilyTombstones(stampDeviceId, PRODUCTS_SYNC_BASE_KEY, readProductsSyncTrackedIds());
        if (!tombstoned.ok) return { ok: false, skipped: false, error: tombstoned.error };
        localStorage.setItem(hashKey, currentHash);
        return { ok: true, skipped: false, updatedAt, published: tombstoned.published };
    }

    const plan = buildProductsSyncPlan(list);
    // Mismo baseline de stock para todos los buckets de este push: el lector
    // pliega por franja los efectos posteriores a este instante (plan de stock
    // delta), igual que hace con el doc de catálogo completo.
    const stockAsOf = stockAsOfFor(PRODUCTS_SYNC_BASE_KEY, capturedAt);
    const published = [];
    let worstBudget = null;
    for (const slice of plan) {
        if (slice.bytes > PRODUCTS_SYNC_MAX_DOC_BYTES) {
            // Nunca bloquear (política sellada): publicar igual, pero dejar la
            // señal explícita de que la partición se quedó corta.
            console.warn(
                `[CloudSync] Bucket sobre el techo: ${slice.docId} (${slice.bytes} bytes) `
                + '— publicado igual, pero toca re-bucketizar la familia de productos',
            );
        }
        const sliceHash = quickHash(slice.records);
        const sliceHashKey = LAST_PUSH_HASH_PREFIX + slice.docId;
        // Hash por doc SIEMPRE (el force ya no re-emite buckets intactos): un
        // bucket sin hash (nunca publicado) sale siempre; uno intacto se salta.
        if (localStorage.getItem(sliceHashKey) === sliceHash) continue;
        const result = await upsertSyncDocument(stampDeviceId, slice.docId, slice.records, { stockAsOf });
        if (!result.ok) return { ok: false, skipped: false, error: result.error, published, budget: worstBudget };
        if (result.budget && (!worstBudget || result.budget.bytes > worstBudget.bytes)) worstBudget = result.budget;
        localStorage.setItem(sliceHashKey, sliceHash);
        published.push(slice.docId);
    }
    // Tumba de buckets que la baja dejó VACÍOS: `buildProductsSyncPlan` solo
    // emite buckets con productos, así que un doc cuya franja se vació por
    // completo desaparece del plan — sin la tumba `[]` su fila en la nube
    // conserva los productos borrados y el monitor no ve la baja. Solo se
    // tumba con evidencia de publicación previa de este equipo (hash por doc o
    // tracking); un doc nunca publicado no puede tener franja vieja que
    // limpiar, y un doc ya tumbado (hash = quickHash([])) no se re-emite.
    const plannedBuckets = new Set(plan.map((slice) => slice.bucket));
    const trackedIds = new Set(readProductsSyncTrackedIds());
    const emptyHash = quickHash([]);
    for (let bucket = 0; bucket < PRODUCTS_SYNC_BUCKET_COUNT; bucket += 1) {
        if (plannedBuckets.has(bucket)) continue;
        const docId = productsDocIdFor(bucket);
        const sliceHashKey = LAST_PUSH_HASH_PREFIX + docId;
        const previousHash = localStorage.getItem(sliceHashKey);
        if (previousHash == null && !trackedIds.has(docId)) continue;
        if (previousHash === emptyHash) continue;
        const result = await upsertSyncDocument(stampDeviceId, docId, [], { stockAsOf });
        if (!result.ok) return { ok: false, skipped: false, error: result.error, published, budget: worstBudget };
        if (result.budget && (!worstBudget || result.budget.bytes > worstBudget.bytes)) worstBudget = result.budget;
        localStorage.setItem(sliceHashKey, emptyHash);
        published.push(docId);
    }
    rememberProductsSyncTrackedIds(published);
    localStorage.setItem(hashKey, currentHash);
    return { ok: true, skipped: false, updatedAt, published, budget: worstBudget };
}

async function upsertSyncDocument(stampDeviceId, docId, value, { stockAsOf = null } = {}) {
    const collectionType = LOCAL_KEYS.includes(docId) ? 'local' : 'store';
    const updatedAt = new Date().toISOString();
    const document = {
        device_id: stampDeviceId,
        collection: collectionType,
        doc_id: docId,
        data: buildSyncEnvelope(value, updatedAt, { stockAsOf }),
        updated_at: updatedAt,
    };

    // Techo de 500 KB (REPORTE-CAUSA-RAIZ-EGRESS): medir TODO documento al
    // publicarlo. Un doc sobre techo se publica igual (bloquearlo rompería la
    // sincronización), pero queda advertido con su diagnóstico — la herramienta
    // real para caber es la migración de imágenes base64 → Storage.
    const budget = assessSyncDocBudget({ docId, envelope: document.data, payload: value });
    if (budget.over) {
        console.warn(
            `[CloudSync] Documento sobre el techo de ${Math.round(budget.budgetBytes / 1000)} KB: ${docId} `
            + `(${budget.bytes} bytes; ${budget.inlineBase64Images} imágenes base64 embebidas)`,
        );
    }

    try {
        const result = await withSyncRetry(async () => {
            const response = await supabaseCloud
                .from('sync_documents')
                .upsert(document, { onConflict: 'device_id,collection,doc_id' });
            if (response.error) throw response.error;
            return response;
        });
        return { ok: true, updatedAt, data: result.data ?? null, budget };
    } catch (error) {
        console.warn('[CloudSync] No se pudo confirmar el push:', error?.message ?? error);
        return { ok: false, error: error?.message || 'Error de sincronización', budget };
    }
}

/**
 * SEC-009 / HOOK-011: Reemplazo EXPLÍCITO del antiguo monkeypatch.
 *
 * Los callers que escriban directamente en localStorage con una clave en LOCAL_KEYS
 * deben invocar esta función (o usar `storageService.setItem`) para que el cambio
 * se propague a la nube. Ya NO se intercepta automáticamente `localStorage.setItem`.
 *
 * @param {string} key
 * @param {any} value
 */
export const pushLocalSync = (key, value) => {
    if (!LOCAL_KEYS.includes(key) && !SYNC_KEYS.includes(key)) return;
    if (key === 'abasto-auth-storage') return; // SEC-002
    _debouncePush(key, value);
};

/**
 * EGRESS-FIX (RC2 + RC5): encola un push de una key `store` a la nube a través
 * del debounce por-key (`_debouncePush`), en vez de empujar directo. Esto:
 *   • Agrupa ráfagas de ediciones en las keys pesadas (HEAVY_KEYS → 3000ms).
 *   • Colapsa el antiguo doble-push (storageService.setItem + listener de este
 *     hook) en un solo upsert, ya que ambos caían en la misma key del debounce.
 * `_debouncePush` → `pushCloudSync`, que respeta isSyncingFromCloud /
 * isCloudSyncActive / SYNC_KEYS, así que la seguridad anti-eco se preserva.
 *
 * @param {string} key
 * @param {any} value
 */
export const queueCloudSync = (key, value) => {
    if (!SYNC_KEYS.includes(key)) return;
    if (key === 'abasto-auth-storage') return; // SEC-002
    _debouncePush(key, value);
};

/**
 * Empuja de forma forzada TODOS los datos del punto de venta a la nube Supabase.
 * Se invoca al iniciar la app o al vincular el dispositivo.
 */
export const forceSyncAllPOSData = async (overrideDeviceId, forceUnconditional = false, allowBeforePairing = false) => {
    if (!supabaseCloud) return { ok: false, error: 'Supabase no disponible', pushed: 0 };
    const isMonitor = localStorage.getItem('pda_pairing_mode') === 'monitor';
    if (isMonitor) return { ok: false, error: 'El modo supervisor no puede publicar datos', pushed: 0 };

    const activeDeviceId = overrideDeviceId || _currentDeviceId || localStorage.getItem('pda_device_id');
    if (!activeDeviceId) return { ok: false, error: 'Dispositivo no definido', pushed: 0 };

    if (!isCloudSyncActive && !allowBeforePairing) return { ok: false, error: 'La sincronización no está activa', pushed: 0 };

    try {
        const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });

        // Nivel B (egress): antes de publicar, terminar la migración de imágenes
        // base64 → Storage sobre el catálogo (mismo barrido que ProductsView, con
        // merge 3-way bajo pos_write_lock). Un doc de productos sin base64 cabe
        // bajo el techo de 500 KB y deja de re-emitir imágenes por Realtime.
        // Best-effort: un fallo no bloquea el snapshot (se reintenta en el próximo
        // arranque); nunca se pierde una imagen.
        try {
            await migrateCatalogImagesOnce({
                readProducts: async () => (await lf.getItem('bodega_products_v1')) || [],
                saveProducts: async (out, base) => {
                    await persistCatalogLocked({
                        local: out,
                        base,
                        storage: {
                            getItem: async (key, fallback = null) => (await lf.getItem(key)) ?? fallback,
                            setItem: (key, value) => lf.setItem(key, value),
                        },
                    });
                },
            });
        } catch {
            // La migración es best-effort; el snapshot crítico no la espera.
        }

        const criticalKeys = ['bodega_sales_v1', 'bodega_products_v1', 'bodega_customers_v1', 'bodega_customer_ledger_v1', 'bodega_accounts_v2'];
        let pushed = 0;
        for (const key of criticalKeys) {
            const val = await lf.getItem(key);
            if (val !== null) {
                const result = await pushCloudSync(key, val, forceUnconditional, allowBeforePairing, activeDeviceId);
                if (!result.ok && !result.skipped) {
                    return { ok: false, error: result.error || `No se pudo sincronizar ${key}`, pushed };
                }
                pushed += 1;
            }
        }
        return { ok: true, error: null, pushed };
    } catch (e) {
        console.warn('[CloudSync] Error en sincronización forzada POS:', e);
        return { ok: false, error: e?.message || 'Error de sincronización', pushed: 0 };
    }
};

/**
 * Fase F3: "Empezar desde cero". Escribe `[]` (vacío CONFIRMADO, publicable) en las
 * claves del snapshot crítico y publica el estado vacío a la nube, para que el
 * monitor deje de ver productos/ventas fantasma. `null` (clave ausente) NO se
 * publica; `[]` sí — esa es la semántica de tombstone. Nota: el ledger es
 * append-only en el receptor, así que en el monitor se fusiona en vez de vaciarse.
 */
export async function resetPOSDataToEmpty({ idbStore, publish } = {}) {
    const lf = idbStore || localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
    for (const key of EMPTY_SNAPSHOT_KEYS) {
        await lf.setItem(key, []);
    }
    const result = await (publish ? publish() : forceSyncAllPOSData());
    return { ok: result?.ok !== false, keys: EMPTY_SNAPSHOT_KEYS, result: result || null };
}

// ─── Validación de Esquema para Sincronización Remota (DATA-001) ─────────────
const STORE_SCHEMAS = {
    'bodega_products_v1': (data) => Array.isArray(data),
    'bodega_sales_v1': (data) => Array.isArray(data),
    'bodega_customers_v1': (data) => Array.isArray(data),
    'bodega_customer_ledger_v1': (data) => Array.isArray(data) && data.every(movement => Boolean(movement?.id && movement?.customerId)
        && Number.isFinite(Number(movement?.amountUsd)) && Number(movement.amountUsd) >= 0
        && ['CREDIT', 'DEBIT'].includes(movement?.direction)),
    'bodega_payment_methods_v1': (data) => Array.isArray(data),
    'bodega_accounts_v2': (data) => Array.isArray(data),
    'bodega_categories_v1': (data) => Array.isArray(data),
    'monitor_rates_v12': (data) => typeof data === 'object' && data !== null,
    'abasto_audit_log_v1': (data) => Array.isArray(data),
    'pda_rate_mode': (data) => typeof data === 'string' && ['bcv', 'paralelo', 'promedio', 'custom'].includes(data),
};

/**
 * Aplica un documento recibido de la nube al almacenamiento local.
 * Garantiza que isSyncingFromCloud esté activo durante toda la operación.
 */
// Exportada para las pruebas del lector (familias de ventas y productos): la
// semántica de merge/watermark/hashes se sella conduciendo esta función real.
export async function _applyFromCloud(docId, collection, data) {
    isSyncingFromCloud = true;
    try {
        if (!['store', 'local'].includes(collection)) return false;
        const envelope = readSyncEnvelope(data);
        if (!envelope.valid) {
            console.warn(`[CloudSync] Envelope remoto rechazado: ${envelope.error}`);
            return false;
        }

        const { payload } = envelope;
        let payloadToStore = payload;
        // Fase 5: el hash del doc de la familia refleja SU contenido tal como
        // quedó tras su transformación (merge/fold) — coincide con el slice que
        // el escritor volvería a calcular, así el push periódico lo salta sin
        // re-subirlo. Se declara aquí porque se sella al final del apply.
        let familyDocHashValue = null;
        if (docId === 'abasto-auth-storage') return false;

        const metadataKey = getSyncMetadataKey(docId);
        const previousUpdatedAt = localStorage.getItem(metadataKey);
        if (!isNewerSyncDocument(envelope.updatedAt, previousUpdatedAt)) {
            // Fase D1 (H3): dejar evidencia cuando un doc se descarta por watermark.
            console.info('[CloudSync] Doc omitido por watermark', {
                docId,
                remoto: envelope.updatedAt,
                local: previousUpdatedAt,
            });
            return false;
        }

        // Fase 4/5: los docs de las familias de ventas y productos se validan
        // como su clave base (el contrato conoce `bodega_sales_v1` /
        // `bodega_products_v1`, no los periodos ni los buckets).
        const isSalesFamily = isSalesSyncDocId(docId);
        const isProductsFamily = isProductsSyncDocId(docId);
        const contractKey = isSalesFamily ? SALES_SYNC_BASE_KEY
            : isProductsFamily ? PRODUCTS_SYNC_BASE_KEY : docId;

        // Contrato común del supervisor: incluso el primary debe rechazar
        // documentos no allowlisted antes de aplicarlos localmente.
        const supervisorValidation = validateSupervisorSyncDocument(contractKey, payload);
        if (!supervisorValidation.valid) {
            console.warn(`[CloudSync] Documento remoto rechazado: ${supervisorValidation.error}`);
            return false;
        }

        // DATA-001: Validación de Schema antes de escribir en almacenamiento local
        const validator = STORE_SCHEMAS[contractKey];
        if (validator) {
            let dataToValidate = payload;
            if (typeof payload === 'string' && (payload.startsWith('[') || payload.startsWith('{'))) {
                try { dataToValidate = JSON.parse(payload); } catch { /* silenciar parse error */ }
            }
            if (!validator(dataToValidate)) {
                console.warn(`[CloudSync] Schema validation falló para ${docId}, ignorando payload remoto.`, payload);
                return false;
            }
        }

        if (collection === 'local') {
            const stringPayload = typeof payload === 'string' ? payload : JSON.stringify(payload);
            originalSetItem(docId, stringPayload);   // Escribe sin pasar por interceptor (no existe ya)
            window.dispatchEvent(new StorageEvent('storage', {
                key: docId,
                newValue: stringPayload,
                storageArea: localStorage
            }));
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: docId, source: 'remote' } }));
        } else {
            // Colección 'store' → IndexedDB directo, sin pasar por storageService.setItem.
            // El ledger es append-only: nunca se reemplaza por un snapshot remoto.
            const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
            if (docId === 'bodega_customer_ledger_v1') {
                const localLedger = await lf.getItem(docId);
                const merged = mergeLedgerEntries(localLedger, payload);
                payloadToStore = merged.ledger;
                if (merged.conflicts.length > 0) {
                    console.warn(`[CloudSync] Conflictos de ledger retenidos localmente: ${merged.conflicts.length}`);
                }
            }
            let writeKey = docId;
            if (isSalesFamily) {
                // Fase 4: merge en el lector — los periodos (y el legacy) se
                // fusionan en la clave local única que leen las vistas.
                writeKey = SALES_SYNC_BASE_KEY;
                const localSales = await lf.getItem(SALES_SYNC_BASE_KEY);
                payloadToStore = mergeSalesSyncDoc(localSales, docId, payload);
                familyDocHashValue = payload;
            } else if (isProductsFamily) {
                // Fase 5: merge por franja en el lector — los buckets (y el
                // legacy congelado) se fusionan en la clave local única.
                writeKey = PRODUCTS_SYNC_BASE_KEY;
                // Plan de stock delta: el payload es el baseline de SU franja
                // (su `stock` incluye los efectos con at <= stockAsOf); el stock
                // visible pliega los efectos posteriores de la familia de ventas.
                const localSales = await lf.getItem(SALES_SYNC_BASE_KEY);
                const folded = reconcileStockFromEffects(payload, localSales, envelope.stockAsOf ?? null);
                const localProducts = await lf.getItem(PRODUCTS_SYNC_BASE_KEY);
                // El legacy congelado no puede resucitar productos de franjas
                // cuyo bucket ya se aplicó: el bucket es la autoridad de SU
                // franja (y así el borrado se propaga sin importar el orden).
                const skipBuckets = docId === PRODUCTS_SYNC_BASE_KEY
                    ? readAppliedProductsStripeBuckets()
                    : [];
                payloadToStore = mergeProductsSyncDoc(localProducts, docId, folded, { skipBuckets });
                familyDocHashValue = folded;
            }
            await lf.setItem(writeKey, payloadToStore);
            if (docId === 'bodega_customer_ledger_v1') {
                const localCustomers = await lf.getItem('bodega_customers_v1');
                if (Array.isArray(localCustomers)) {
                    await lf.setItem('bodega_customers_v1', rebuildCustomersFromLedger(localCustomers, payloadToStore));
                    window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: 'bodega_customers_v1', source: 'remote' } }));
                }
            }

            // Notificar a los componentes React que lean este store
            window.dispatchEvent(new CustomEvent('app_storage_update', { detail: { key: writeKey, source: 'remote' } }));
        }

        // Update local hash to prevent periodic push from re-uploading what we just downloaded
        const hashKey = LAST_PUSH_HASH_PREFIX + docId;
        // Fase 4/5: el hash del doc de la familia refleja SU contenido (el
        // escritor lo salta sin re-subir); el de la clave base refleja el
        // arreglo fusionado.
        const familyBaseKey = isSalesFamily ? SALES_SYNC_BASE_KEY
            : isProductsFamily ? PRODUCTS_SYNC_BASE_KEY : null;
        localStorage.setItem(hashKey, quickHash(familyDocHashValue ?? payloadToStore));
        if (familyBaseKey) {
            localStorage.setItem(LAST_PUSH_HASH_PREFIX + familyBaseKey, quickHash(payloadToStore));
        }
        if (envelope.updatedAt) localStorage.setItem(metadataKey, envelope.updatedAt);
        return true;
    } finally {
        isSyncingFromCloud = false;
    }
}

// ─── Hook de React ─────────────────────────────────────────────────────────
export function useCloudSync(deviceId) {
    const isInitialized = useRef(false);
    const pairingRecoveryHandlerRef = useRef(null);

    useEffect(() => {
        if (!supabaseCloud || !deviceId) {
            console.info('[CloudSync] Listener no iniciado', {
                reason: !supabaseCloud ? 'supabase_no_disponible' : 'device_id_no_definido',
                deviceId: shortCloudSyncId(deviceId),
            });
            isCloudSyncActive = false;
            if (globalSubscription) {
                try { supabaseCloud.removeChannel(globalSubscription).catch(() => {}); } catch { }
                globalSubscription = null;
                isInitialized.current = false;
                _currentDeviceId = '';
            }
            return;
        }

        // Si el deviceId cambió con respecto al inicializado, forzar reinicio y cleanup de suscripción
        if (isInitialized.current && _currentDeviceId !== deviceId) {
            if (globalSubscription) {
                try { supabaseCloud.removeChannel(globalSubscription).catch(() => {}); } catch { }
                globalSubscription = null;
            }
            isInitialized.current = false;
        }

        if (isInitialized.current) return;

        _currentDeviceId = deviceId;

        const initSync = async () => {
            try {
                const { session, error: sessionError } = await ensureSupervisorSession();
                if (sessionError || !session) {
                    isCloudSyncActive = false;
                    console.warn('[CloudSync] Sesión no disponible para sincronizar', {
                        deviceId: shortCloudSyncId(deviceId),
                        error: sessionError?.message || 'sin sesión',
                    });
                    return;
                }

                console.info('[CloudSync] Sesión Auth lista', {
                    deviceId: shortCloudSyncId(deviceId),
                    authUserId: shortCloudSyncId(session.user?.id),
                });

                // RLS-IDENTITY: las políticas own-row de sync_documents exigen que
                // device_sessions vincule este deviceId con la sesión actual. Las
                // sesiones anónimas se regeneran, así que reconciliar en cada arranque
                // (fail-soft: el error de RLS posterior se reporta igualmente).
                const registration = await ensureDeviceSessionRegistered(deviceId);
                if (!registration.ok) {
                    console.warn('[CloudSync] device_sessions no disponible:', registration.error);
                }

                const { data: pairing, error: pairingError } = await readPairingRow({
                    supabase: supabaseCloud,
                    primaryDeviceId: deviceId,
                });

                const handlePairingChange = async () => {
                    const latest = await readPairingRow({
                        supabase: supabaseCloud,
                        primaryDeviceId: deviceId,
                    });
                    if (latest.error) return;

                    const active = isPrimaryPairingActive(latest.data);
                    window.dispatchEvent(new CustomEvent(
                        active ? 'supervisor_pairing_active' : 'supervisor_pairing_revoked',
                        { detail: { deviceId, source: 'pairing_realtime' } }
                    ));

                    const shouldRestart = active ? !isInitialized.current : isInitialized.current;
                    if (shouldRestart) {
                        isCloudSyncActive = false;
                        isInitialized.current = false;
                        const staleChannel = globalSubscription;
                        globalSubscription = null;
                        if (staleChannel) await supabaseCloud.removeChannel(staleChannel).catch(() => {});
                        void initSync();
                    }
                };
                pairingRecoveryHandlerRef.current = handlePairingChange;

                const subscribeToPairingChanges = () => {
                    if (globalSubscription) return;
                    globalSubscription = supabaseCloud
                        .channel(`device_pairings:${deviceId}`)
                        .on('postgres_changes', {
                            event: '*',
                            schema: 'public',
                            table: 'device_pairings',
                            filter: `primary_device_id=eq.${deviceId}`
                        }, () => {
                            void handlePairingChange();
                        })
                        .subscribe();
                };

                console.info('[CloudSync] Pairing consultado', {
                    deviceId: shortCloudSyncId(deviceId),
                    paired: isPrimaryPairingActive(pairing),
                    monitorDeviceId: shortCloudSyncId(pairing?.monitor_device_id || pairing?.monitor_device_id_2),
                    error: pairingError?.message || null,
                });

                if (pairingError || !isPrimaryPairingActive(pairing)) {
                    isCloudSyncActive = false;
                    // "data null sin error" = la fila del pairing no es legible para
                    // esta caja. Con evidencia de sync previo, es un desfase de
                    // identidad: sin aviso, el POS se quedaría pausado en silencio y
                    // ningún cambio local llegaría al Supervisor.
                    const pairingRowHidden = !pairingError && !pairing;
                    const hadPriorSync = hasPriorSyncEvidence();
                    console.warn('[CloudSync] Sincronización pausada hasta completar el pairing', {
                        reason: pairingError?.message || (pairingRowHidden ? 'pairing_no_legible' : 'pairing_sin_monitor'),
                        pairingRowHidden,
                        hadPriorSync,
                        deviceId: shortCloudSyncId(deviceId),
                    });
                    if (pairingRowHidden && hadPriorSync) {
                        showToast('No se pudo comprobar el vínculo con el Supervisor. Genera un nuevo código QR desde Ajustes para restaurar la sincronización.', 'error');
                    }
                    subscribeToPairingChanges();
                    return;
                }

                isCloudSyncActive = true;
                isInitialized.current = true;
                subscribeToPairingChanges();
                console.info('[CloudSync] Receptor activo', {
                    deviceId: shortCloudSyncId(deviceId),
                    monitorDeviceId: shortCloudSyncId(pairing.monitor_device_id || pairing.monitor_device_id_2),
                });

                // Reconciliación inicial protegida por hash: evita volver a
                // subir documentos completos que no cambiaron desde el último push.
                forceSyncAllPOSData(deviceId, false).catch(() => {});

                // ── Pull Inicial / Sincronización de Importación ──
                // Declarar el snapshot fuera de la rama condicional: el bloque de
                // auto-recuperación posterior también necesita conocer qué claves
                // llegaron desde la nube.
                let docs = [];
                const backupImported = localStorage.getItem('pda_backup_imported_flag') === 'true';
                
                if (backupImported) {
                    console.log('[CloudSync] Detectado backup importado localmente. Subiendo incondicionalmente a la nube...');
                    isCloudSyncActive = true;
                    const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
                    const criticalKeys = ['bodega_sales_v1', 'bodega_products_v1', 'bodega_customers_v1', 'bodega_customer_ledger_v1', 'bodega_accounts_v2'];
                    for (const key of criticalKeys) {
                        const localValue = await lf.getItem(key);
                        if (localValue !== null) {
                            const result = await pushCloudSync(key, localValue);
                            if (result?.ok) {
                                const hashKey = LAST_PUSH_HASH_PREFIX + key;
                                localStorage.setItem(hashKey, quickHash(localValue));
                            }
                        }
                    }
                    localStorage.setItem('cloud_sync_ts', new Date().toISOString());
                    localStorage.removeItem('pda_backup_imported_flag');
                    console.log('[CloudSync] Sincronización incondicional de importación completada.');
                } else {
                    const { data: initialDocs, error: docsError } = await supabaseCloud
                        .from('sync_documents')
                        .select('collection, doc_id, data')
                        .eq('device_id', deviceId)
                        .in('collection', ['store', 'local']);

                    if (docsError) {
                        // Fase D1 (H2): el fallo del pull inicial debe dejar código y motivo.
                        console.error('[CloudSync] Pull inicial falló', {
                            code: docsError.code,
                            message: docsError.message,
                        });
                        throw docsError;
                    }
                    docs = initialDocs || [];

                    // Fase D1/F4: ¿el almacén local está vacío? (escenario de estado fantasma)
                    const lfCheck = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
                    let localWasEmpty = true;
                    for (const key of EMPTY_SNAPSHOT_KEYS) {
                        const localValue = await lfCheck.getItem(key);
                        if (Array.isArray(localValue) && localValue.length > 0) { localWasEmpty = false; break; }
                    }

                    if (docs.length > 0) {
                        let aplicados = 0;
                        let omitidos = 0;
                        for (const doc of docs) {
                            // SEC-002: nunca aplicar `abasto-auth-storage` desde la nube.
                            if (doc.doc_id === 'abasto-auth-storage') continue;
                            try {
                                const applied = await _applyFromCloud(doc.doc_id, doc.collection, doc.data);
                                if (applied) { aplicados += 1; } else { omitidos += 1; }
                            } catch (e) {
                                // HOOK-023: try/catch por documento para no abortar el pull completo.
                                omitidos += 1;
                                console.warn(`[CloudSync] Error aplicando doc ${doc.doc_id}:`, e);
                            }
                        }
                        // Fase D1: diagnóstico estructurado para distinguir H1/H2/H3 en producción.
                        console.info('[CloudSync] Pull inicial diagnóstico', {
                            deviceId: shortCloudSyncId(deviceId),
                            leidos: docs.length,
                            aplicados,
                            omitidos,
                            localWasEmpty,
                            sesionRegistrada: registration.ok,
                        });
                        if (localWasEmpty && aplicados > 0) {
                            showToast('Se restauró un respaldo previo de este equipo en la nube', 'info');
                            window.dispatchEvent(new CustomEvent('cloud_restore_applied', { detail: { aplicados, omitidos } }));
                        }
                    } else {
                        console.info('[CloudSync] Pull inicial diagnóstico', {
                            deviceId: shortCloudSyncId(deviceId),
                            leidos: 0,
                            aplicados: 0,
                            omitidos: 0,
                            localWasEmpty,
                            sesionRegistrada: registration.ok,
                        });
                    }
                }

                // ── Auto-recuperación: Purgar/subir datos locales que no llegaron a enviarse debido al bug anterior ──
                try {
                    const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
                    const criticalKeys = ['bodega_sales_v1', 'bodega_products_v1', 'bodega_customers_v1', 'bodega_customer_ledger_v1', 'bodega_accounts_v2'];
                    const existingCloudKeys = new Set((docs || []).map(d => d.doc_id));

                    for (const key of criticalKeys) {
                        const localValue = await lf.getItem(key);
                        if (!localValue) continue;

                        const hashKey = LAST_PUSH_HASH_PREFIX + key;
                        const currentHash = quickHash(localValue);
                        if (existingCloudKeys.has(key) && localStorage.getItem(hashKey) === currentHash) continue;

                        // Subimos los datos locales a la base de datos para sincronizar el historial.
                        // El hash solo se confirma si el upsert fue aceptado.
                        const result = await pushCloudSync(key, localValue);
                        if (result?.ok) localStorage.setItem(hashKey, currentHash);
                    }
                } catch (e) {
                    // Silencioso
                }

                // ── Suscripción WebSocket Realtime ─────────────────────────
                // EGRESS-FIX (RC3): ELIMINADA la auto-suscripción a `sync:${deviceId}`.
                // El dispositivo principal es el ÚNICO escritor de su propio device_id,
                // así que ese canal solo le devolvía el ECO de sus propias escrituras
                // (egress puro de Realtime, sin valor). El monitor del dueño mantiene su
                // propia suscripción independiente en useMonitorSync (canal
                // `monitor:${pairedDeviceId}`), por lo que sigue recibiendo cambios en
                // vivo. El estado inicial se obtiene con el pull por PostgREST de arriba.

            } catch (err) {
                console.error('[CloudSync] Fallo en inicialización:', err);
                isInitialized.current = false;
                // Fase F1: el fallo solo es visible para el usuario cuando importa
                // (local vacío = posible estado fantasma). Sin datos locales y sin
                // red no se avisa, para no enojar al POS offline-first en cada arranque.
                try {
                    const lfCheck = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
                    let localEmpty = true;
                    for (const key of EMPTY_SNAPSHOT_KEYS) {
                        const localValue = await lfCheck.getItem(key);
                        if (Array.isArray(localValue) && localValue.length > 0) { localEmpty = false; break; }
                    }
                    if (localEmpty) {
                        showToast('No se pudo restaurar el respaldo de este equipo en la nube. Revisa la conexión o vuelve a iniciar sesión.', 'error');
                    }
                } catch { /* sin storage no hay nada que restaurar ni que avisar */ }
            }
        };

        initSync();

        // Fallback económico si Realtime está temporalmente desconectado.
        // Realtime es la vía primaria; esta lectura pequeña solo es respaldo.
        const pairingRecoveryTimer = setInterval(() => {
            void pairingRecoveryHandlerRef.current?.();
        }, getSupervisorRecoveryIntervalMs());

        // ── MECANISMOS DE SINCRONIZACIÓN AUTOMÁTICA Y CONTINUA ──
        //
        // EGRESS-FIX (RC2): ELIMINADO el listener de `app_storage_update` que
        // re-empujaba a la nube. Era la segunda mitad del doble-push: cada escritura
        // por `storageService.setItem` ya encola el push (ahora vía queueCloudSync),
        // así que este listener solo duplicaba el upsert (y su broadcast de Realtime).
        // Ningún write local dependía SOLO de este listener.

        // Escuchar evento 'online' y temporizador periódico para sincronizar datos locales pendientes
        // HOOK: solo re-sube una key si cambió desde el último push (evita gastar cuota de
        // Supabase/Realtime subiendo el mismo dato sin cambios cada 20s — ver quickHash arriba).
        const forcePushLocalData = async () => {
            if (isSyncingFromCloud || !deviceId) return;
            try {
                const lf = localforage.createInstance({ name: 'BodegaApp', storeName: 'bodega_app_data' });
                const criticalKeys = ['bodega_sales_v1', 'bodega_products_v1', 'bodega_customers_v1', 'bodega_customer_ledger_v1', 'bodega_accounts_v2'];
                for (const key of criticalKeys) {
                    const localValue = await lf.getItem(key);
                    if (!localValue) continue;

                    const hashKey = LAST_PUSH_HASH_PREFIX + key;
                    const currentHash = quickHash(localValue);
                    if (localStorage.getItem(hashKey) === currentHash) continue;

                    const result = await pushCloudSync(key, localValue);
                    if (result?.ok) localStorage.setItem(hashKey, currentHash);
                }
            } catch (e) {
                // Silencioso
            }
        };

        const handleVisibilityChange = () => {
            if (document.visibilityState === 'hidden') {
                forcePushLocalData();
            }
        };

        window.addEventListener('online', forcePushLocalData);
        document.addEventListener('visibilitychange', handleVisibilityChange);

        return () => {
            isCloudSyncActive = false;
            pairingRecoveryHandlerRef.current = null;
            clearInterval(pairingRecoveryTimer);
            window.removeEventListener('online', forcePushLocalData);
            document.removeEventListener('visibilitychange', handleVisibilityChange);

            // HOOK-012: limpiar suscripción en cleanup para evitar leaks.
            if (globalSubscription) {
                try { supabaseCloud.removeChannel(globalSubscription).catch(() => {}); } catch { }
                globalSubscription = null;
                isInitialized.current = false;
                _currentDeviceId = '';
            }
        };
    }, [deviceId]);
}
