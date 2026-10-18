/**
 * catalogLock.js — Escrituras del catálogo serializadas bajo `pos_write_lock`.
 *
 * Cierre del hueco documentado en docs/FIX-VENTAS-STOCK-SUPERVISOR.md §4:
 * las ventas y las órdenes del supervisor ya escribían `bodega_products_v1`
 * dentro de `withLock('pos_write_lock')`, pero los guardados locales del cajero
 * (auto-save del catálogo, ajustes rápidos de stock) escribían SIN el candado.
 * Dos escritores sin turnarse = lost update silencioso: el último que escribe
 * arrastra su snapshot completo y revierte el cambio del otro.
 *
 * Estrategia de cierre (dos capas):
 *  1. Toda escritura del catálogo pasa por `withLock('pos_write_lock')` — el
 *     mismo candado de ventas, anulaciones y comandos del supervisor.
 *  2. El auto-save del cajero no "pinta por encima": hace un merge 3-way
 *     (local / base / remoto) por CAMPO. Los campos que el cajero tocó ganan;
 *     los que no tocó se toman del estado remoto fresco. Así una venta o una
 *     orden del supervisor que se aplicó entre el render del cajero y su
 *     guardado sobrevive al guardado.
 *
 * Semántica del merge 3-way (`mergeCatalog3Way`):
 *  - Producto en local y remoto → merge por campo (local dife de base ⇒ local
 *    gana; si no, remoto gana). Base es el último snapshot de storage con el
 *    que el estado local estaba sincronizado.
 *  - Solo en local (creado localmente, o borrado remotamente pero modificado
 *    localmente) → se conserva.
 *  - Solo en remoto (creado remotamente, o borrado localmente sin tocar) → se
 *    conserva / se respeta el borrado según el base.
 *
 * @module utils/catalogLock
 */

import { withLock } from './withLock.js';

export const PRODUCTS_KEY = 'bodega_products_v1';

/** Igualdad de valores de campo (primitivos y objetos/arrays planos). */
function sameValue(a, b) {
    if (a === b) return true;
    if (a == null && b == null) return true;
    if (a == null || b == null) return false;
    if (typeof a !== 'object' || typeof b !== 'object') return false;
    try {
        return JSON.stringify(a) === JSON.stringify(b);
    } catch {
        return false;
    }
}

/**
 * Merge 3-way de UN producto: conserva los campos que local tocó respecto a
 * `base` y toma del `remote` fresco todo lo demás (incluido lo que otros
 * escritores — ventas, órdenes — cambiaron en ese intervalo).
 */
export function mergeProduct3Way(localProduct, baseProduct, remoteProduct) {
    if (!remoteProduct) return localProduct;
    if (!baseProduct) return { ...localProduct };

    const merged = { ...remoteProduct };
    const keys = new Set([...Object.keys(baseProduct), ...Object.keys(localProduct)]);
    for (const key of keys) {
        const localHas = Object.prototype.hasOwnProperty.call(localProduct, key);
        if (!sameValue(localProduct[key], baseProduct[key])) {
            // Campo tocado localmente (o borrado localmente): gana lo local.
            if (localHas) merged[key] = localProduct[key];
            else delete merged[key];
        }
    }
    return merged;
}

/**
 * Merge 3-way del catálogo completo. `base` = último snapshot de storage sobre
 * el que el estado `local` estaba basado; `remote` = contenido fresco de
 * storage al momento de persistir.
 */
export function mergeCatalog3Way({ local = [], base = [], remote = [] }) {
    const baseById = new Map(base.map(p => [String(p.id), p]));
    const localById = new Map(local.map(p => [String(p.id), p]));
    const remoteById = new Map(remote.map(p => [String(p.id), p]));

    // Orden: primero los del estado local (respetan el orden que ve el cajero),
    // luego los que solo existan en remoto.
    const ids = [...localById.keys(), ...[...remoteById.keys()].filter(id => !localById.has(id))];
    const result = [];

    for (const id of ids) {
        const l = localById.get(id);
        const b = baseById.get(id);
        const r = remoteById.get(id);

        if (l && r) {
            result.push(mergeProduct3Way(l, b, r));
        } else if (l && !r) {
            // Solo local: creado aquí, o el remoto lo borró. Si estaba en base y
            // local NO lo tocó, se respeta el borrado remoto; si lo tocó (o es
            // nuevo), se conserva.
            if (!b || !sameValue(l, b)) result.push(l);
        } else if (!l && r) {
            // Solo remoto: creado remotamente (se conserva), o borrado localmente
            // (estaba en base y ya no está en local → se respeta el borrado).
            if (!b) result.push(r);
        }
    }
    return result;
}

/**
 * Persiste el catálogo con merge 3-way bajo el candado. Lee storage fresco
 * dentro del lock, mergea con los cambios locales no persistidos y escribe el
 * resultado. Devuelve el array escrito (= contenido de storage).
 */
export async function persistCatalogLocked({ local = [], base = [], storage }) {
    return withLock('pos_write_lock', async () => {
        const remote = (await storage.getItem(PRODUCTS_KEY, [])) || [];
        const merged = mergeCatalog3Way({ local, base, remote });
        // Nada nuevo que persistir (el merge solo confirmó lo que ya estaba):
        // evitar la escritura también evita su eco de sincronización.
        if (JSON.stringify(merged) === JSON.stringify(remote)) return merged;
        await storage.setItem(PRODUCTS_KEY, merged);
        return merged;
    });
}

/**
 * Read-modify-write del catálogo bajo el candado: `mutator` recibe el catálogo
 * fresco de storage y devuelve el siguiente. Devuelve el array escrito.
 */
export async function mutateCatalogLocked(mutator, { storage }) {
    return withLock('pos_write_lock', async () => {
        const remote = (await storage.getItem(PRODUCTS_KEY, [])) || [];
        const next = mutator(remote) || remote;
        await storage.setItem(PRODUCTS_KEY, next);
        return next;
    });
}

export default {
    PRODUCTS_KEY,
    mergeProduct3Way,
    mergeCatalog3Way,
    persistCatalogLocked,
    mutateCatalogLocked,
};
