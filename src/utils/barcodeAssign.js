/**
 * Códigos de barras: buscar un producto por cualquiera de sus códigos e impedir que dos
 * productos compartan el mismo código (al escanear, la caja agregaría el primero que encuentre).
 * Portado desde preciosaldia-farmacia (src/utils/barcodeAssign.js).
 */

const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());

/** ¿El producto responde a este código? (código principal, códigos alternos o id). */
export function productHasCode(product, code) {
    const c = clean(code);
    if (!product || !c) return false;
    return clean(product.barcode) === c
        || String(product.id) === c
        || (Array.isArray(product.altBarcodes) && product.altBarcodes.some((alt) => clean(alt) === c));
}

/** Primer producto que responde a alguno de los códigos dados. */
export function findProductByCode(products = [], ...codes) {
    const list = Array.isArray(products) ? products : [];
    for (const code of codes) {
        const hit = list.find((p) => productHasCode(p, code));
        if (hit) return hit;
    }
    return null;
}

/** Otro producto que ya usa este código (principal, alterno o id), sin contar `exceptId`. */
export function findOtherProductWithCode(products = [], code, exceptId = null) {
    const list = Array.isArray(products) ? products : [];
    return list.find((p) => (exceptId == null || String(p?.id) !== String(exceptId)) && productHasCode(p, code)) || null;
}

/** Filtro especial del inventario: artículos que comparten código de barras. */
export const DUPLICATE_CODE_FILTER = 'codigo-repetido';

/** Todos los códigos de un producto (principal, alternos y blíster), sin repetidos. */
function productCodes(product) {
    const codes = [product?.barcode, ...(Array.isArray(product?.altBarcodes) ? product.altBarcodes : []), product?.midPack?.barcode];
    return [...new Set(codes.map(clean).filter(Boolean))];
}

/**
 * Artículos que comparten algún código con otro artículo. Pasa cuando el mismo producto se creó
 * en dos cajas (cada una le da su propio id), al restaurar un respaldo o con datos viejos.
 * Devuelve un Map id → código repetido (el primero en orden), para contar y agrupar en la lista.
 */
export function findDuplicateCodeIndex(products = []) {
    const list = Array.isArray(products) ? products : [];
    const byCode = new Map();
    for (const p of list) {
        if (!p || p.id == null) continue;
        for (const code of productCodes(p)) {
            if (!byCode.has(code)) byCode.set(code, new Set());
            byCode.get(code).add(String(p.id));
        }
    }
    const index = new Map();
    const sortedCodes = [...byCode.keys()].sort();
    for (const code of sortedCodes) {
        const ids = byCode.get(code);
        if (ids.size < 2) continue;
        for (const id of ids) if (!index.has(id)) index.set(id, code);
    }
    return index;
}
