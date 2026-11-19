/**
 * duplicateMerge.js — Detección de grupos duplicados (por código o nombre) y fusión segura.
 *
 * Fase 4 (Precios al Día Nube):
 * - Agrupa artículos que comparten código de barras (principal, alternos o blíster).
 * - Agrupa artículos con el mismo nombre normalizado (mayúsculas, acentos y signos aparte).
 * - Calcula el producto resultante al fusionar un grupo en un «principal» (stock, códigos y
 *   datos faltantes) sin perder existencias ni códigos alternos.
 */
import { productNameKey } from './similarName';
import { round3 } from './dinero';

export const IGNORED_DUP_KEY = 'pda_ignored_dup_groups_v1';
export const CHECK_DUPS_AFTER_IMPORT_KEY = 'pda_check_dups_after_import';

const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());

function productCodes(product) {
    const codes = [
        product?.barcode,
        ...(Array.isArray(product?.altBarcodes) ? product.altBarcodes : []),
        product?.midPack?.barcode,
    ];
    return [...new Set(codes.map(clean).filter(Boolean))];
}

/** Firma estable de un conjunto de productos (ids ordenados), para recordar grupos ignorados. */
export function groupSignature(products = []) {
    return products
        .map((p) => String(p?.id ?? ''))
        .filter(Boolean)
        .sort()
        .join('|');
}

export function loadIgnoredDupSignatures() {
    try {
        const raw = localStorage.getItem(IGNORED_DUP_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.filter((s) => typeof s === 'string' && s) : [];
    } catch {
        return [];
    }
}

export function saveIgnoredDupSignatures(signatures) {
    try {
        localStorage.setItem(IGNORED_DUP_KEY, JSON.stringify([...new Set(signatures)]));
    } catch { /* sin almacenamiento */ }
}

export function suggestPrimaryId(groupProducts = []) {
    if (!groupProducts.length) return null;
    const score = (p) => (
        ((Number(p?.stock) || 0) > 0 ? 4 : 0)
        + ((Number(p?.priceUsd) || 0) > 0 ? 3 : 0)
        + ((Number(p?.costUsd) || 0) > 0 ? 2 : 0)
        + (clean(p?.barcode) ? 2 : 0)
        + (clean(p?.image || p?.image_path) ? 1 : 0)
    );
    const sorted = [...groupProducts].sort((a, b) => {
        const diff = score(b) - score(a);
        if (diff !== 0) return diff;
        const ta = a?.createdAt ? Date.parse(a.createdAt) : Number.MAX_SAFE_INTEGER;
        const tb = b?.createdAt ? Date.parse(b.createdAt) : Number.MAX_SAFE_INTEGER;
        return (Number.isFinite(ta) ? ta : Number.MAX_SAFE_INTEGER) - (Number.isFinite(tb) ? tb : Number.MAX_SAFE_INTEGER);
    });
    return sorted[0]?.id ?? null;
}

/**
 * Encuentra grupos de artículos duplicados:
 *  - `kind: 'barcode'`: 2+ productos que comparten algún código de barras (union-find).
 *  - `kind: 'name'`: 2+ productos con el mismo nombre normalizado que no están ya todos en el mismo grupo de código.
 */
export function findDuplicateGroups(products = [], { ignoredSignatures = [], nameFields = [] } = {}) {
    const list = Array.isArray(products) ? products.filter((p) => p && p.id != null) : [];
    const byId = new Map(list.map((p) => [String(p.id), p]));

    // 1. Grupos por código compartido (componentes conexos)
    const parent = new Map(list.map((p) => [String(p.id), String(p.id)]));
    const find = (x) => {
        let cur = x;
        while (parent.get(cur) !== cur) {
            parent.set(cur, parent.get(parent.get(cur)));
            cur = parent.get(cur);
        }
        return cur;
    };
    const unite = (a, b) => {
        const ra = find(a);
        const rb = find(b);
        if (ra !== rb) parent.set(rb, ra);
    };

    const byCode = new Map();
    for (const p of list) {
        const id = String(p.id);
        for (const code of productCodes(p)) {
            if (!byCode.has(code)) byCode.set(code, []);
            byCode.get(code).push(id);
        }
    }
    const sharedCodesByPairRoot = new Map();
    for (const [code, ids] of byCode.entries()) {
        const unique = [...new Set(ids)];
        if (unique.length < 2) continue;
        for (let i = 1; i < unique.length; i += 1) unite(unique[0], unique[i]);
        sharedCodesByPairRoot.set(code, unique[0]);
    }

    const codeBuckets = new Map();
    for (const p of list) {
        const id = String(p.id);
        const root = find(id);
        if (!codeBuckets.has(root)) codeBuckets.set(root, []);
        codeBuckets.get(root).push(p);
    }

    const barcodeGroups = [];
    const productBarcodeRoot = new Map();
    for (const [root, items] of codeBuckets.entries()) {
        if (items.length < 2) continue;
        const codes = [];
        for (const [code, sampleId] of sharedCodesByPairRoot.entries()) {
            if (find(sampleId) === root) codes.push(code);
        }
        codes.sort();
        for (const p of items) productBarcodeRoot.set(String(p.id), root);
        barcodeGroups.push({
            id: `code:${codes[0] || root}`,
            kind: 'barcode',
            label: codes.join(', '),
            products: items,
            signature: groupSignature(items),
            suggestedKeepId: suggestPrimaryId(items),
        });
    }

    // 2. Grupos por nombre normalizado
    const byName = new Map();
    for (const p of list) {
        const key = productNameKey(p, nameFields);
        if (!key || key.length < 2) continue;
        if (!byName.has(key)) byName.set(key, []);
        byName.get(key).push(p);
    }

    const ignoredSet = new Set(ignoredSignatures);
    const nameGroups = [];
    const ignoredGroups = [];
    for (const [key, items] of byName.entries()) {
        if (items.length < 2) continue;
        // Si todos los artículos del grupo ya están juntos en el mismo grupo de código, no repetirlo.
        const roots = new Set(items.map((p) => productBarcodeRoot.get(String(p.id)) || `solo:${p.id}`));
        if (roots.size <= 1) continue;

        const sig = groupSignature(items);
        const group = {
            id: `name:${key}`,
            kind: 'name',
            label: items[0]?.name || key,
            products: items,
            signature: sig,
            suggestedKeepId: suggestPrimaryId(items),
        };
        if (ignoredSet.has(sig)) ignoredGroups.push(group);
        else nameGroups.push(group);
    }

    // Estabilidad: los críticos (código) primero, ordenados alfabéticamente por nombre/código
    barcodeGroups.sort((a, b) => a.label.localeCompare(b.label));
    nameGroups.sort((a, b) => a.label.localeCompare(b.label));

    return {
        groups: [...barcodeGroups, ...nameGroups],
        barcodeGroups,
        nameGroups,
        ignoredGroups,
        byId,
    };
}

/**
 * Construye el artículo fusionado a partir de `keep` y `absorbedList`.
 * - Suma existencias si `sumStock` es true.
 * - Conserva códigos alternos distintos (y promueve uno si el principal no tenía código).
 * - Rellena foto, precio, costo o categoría si el principal los tenía vacíos.
 */
export function buildMergedProduct(keep, absorbedList = [], { sumStock = true } = {}) {
    if (!keep) return null;
    const absorbed = (Array.isArray(absorbedList) ? absorbedList : []).filter(
        (p) => p && String(p.id) !== String(keep.id),
    );
    const next = { ...keep };

    // 1. Stock
    const keepStock = Number(keep.stock) || 0;
    const extraStock = absorbed.reduce((acc, p) => acc + (Number(p.stock) || 0), 0);
    const nextStock = sumStock ? round3(keepStock + extraStock) : round3(keepStock);
    if (sumStock || keep.stock !== undefined) {
        next.stock = nextStock;
        if (keep.packagingType === 'lote' && Number(keep.unitsPerPackage) > 1 && keep.stockInLotes !== undefined) {
            next.stockInLotes = Math.trunc(Math.max(0, nextStock) / Number(keep.unitsPerPackage));
        }
    }

    // 2. Códigos de barras
    let mainCode = clean(keep.barcode);
    if (!mainCode) {
        const firstWithCode = absorbed.find((p) => clean(p.barcode));
        if (firstWithCode) mainCode = clean(firstWithCode.barcode);
    }
    const altSet = new Set();
    for (const c of Array.isArray(keep.altBarcodes) ? keep.altBarcodes : []) {
        const cc = clean(c);
        if (cc && cc !== mainCode) altSet.add(cc);
    }
    for (const p of absorbed) {
        const bc = clean(p.barcode);
        if (bc && bc !== mainCode) altSet.add(bc);
        for (const c of Array.isArray(p.altBarcodes) ? p.altBarcodes : []) {
            const cc = clean(c);
            if (cc && cc !== mainCode) altSet.add(cc);
        }
    }
    if (mainCode || keep.barcode !== undefined) next.barcode = mainCode;
    if (altSet.size > 0 || Array.isArray(keep.altBarcodes)) {
        next.altBarcodes = [...altSet];
    }

    // 3. Rellenar datos faltantes sin pisar lo que el principal ya tiene
    if (!clean(next.image) && !clean(next.image_path)) {
        const withImg = absorbed.find((p) => clean(p.image) || clean(p.image_path));
        if (withImg) {
            if (clean(withImg.image)) next.image = withImg.image;
            if (clean(withImg.image_path)) next.image_path = withImg.image_path;
        }
    }
    if (!(Number(next.priceUsd) > 0)) {
        const withPrice = absorbed.find((p) => Number(p.priceUsd) > 0);
        if (withPrice) {
            next.priceUsd = withPrice.priceUsd;
            if (withPrice.priceUsdt !== undefined) next.priceUsdt = withPrice.priceUsdt;
            if (withPrice.priceBs !== undefined) next.priceBs = withPrice.priceBs;
            if (withPrice.priceCop !== undefined) next.priceCop = withPrice.priceCop;
        }
    }
    if (!(Number(next.costUsd) > 0)) {
        const withCost = absorbed.find((p) => Number(p.costUsd) > 0);
        if (withCost) {
            next.costUsd = withCost.costUsd;
            if (withCost.costBs !== undefined) next.costBs = withCost.costBs;
            if (withCost.costCop !== undefined) next.costCop = withCost.costCop;
            if (withCost.costFactor !== undefined) next.costFactor = withCost.costFactor;
        }
    }
    if (!clean(next.category) || next.category === 'general') {
        const withCat = absorbed.find((p) => clean(p.category) && p.category !== 'general');
        if (withCat) next.category = withCat.category;
    }

    next.updatedAt = new Date().toISOString();

    return {
        merged: next,
        removeIds: absorbed.map((p) => p.id),
        stockDelta: round3(nextStock - keepStock),
    };
}
