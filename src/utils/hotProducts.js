// «Más vendidos» de la caja: contador local por producto (se suma al agregar a la cesta desde la rejilla).
// Es solo para ordenar la vista de esta caja; no toca inventario ni ventas reales.
// Copiado de Precios al Día Farmacia.
const KEY = 'pos_hot_counts';

export function readHotCounts() {
    try {
        // eslint-disable-next-line no-restricted-properties -- preferencia local de esta caja, igual que en Farmacia
        const raw = JSON.parse(localStorage.getItem(KEY) || '{}');
        return raw && typeof raw === 'object' ? raw : {};
    } catch {
        return {};
    }
}

export function bumpHot(productId) {
    if (productId === undefined || productId === null) return;
    try {
        const counts = readHotCounts();
        const k = String(productId);
        counts[k] = (Number(counts[k]) || 0) + 1;
        // eslint-disable-next-line no-restricted-properties -- preferencia local de esta caja, igual que en Farmacia
        localStorage.setItem(KEY, JSON.stringify(counts));
    } catch { /* almacenamiento lleno o bloqueado: no es crítico */ }
}

/** Copia ordenada: los más agregados primero; empates conservan el orden original. */
export function sortByHot(products, counts = readHotCounts()) {
    return products
        .map((p, i) => ({ p, i, c: Number(counts[String(p.id)]) || 0 }))
        .sort((a, b) => (b.c - a.c) || (a.i - b.i))
        .map((x) => x.p);
}

/** Hasta `limit` productos con ventas registradas, con stock y precio. */
export function topHotProducts(products, limit = 6, counts = readHotCounts()) {
    return sortByHot(products, counts)
        .filter((p) => (Number(counts[String(p.id)]) || 0) > 0 && (p.stock ?? 0) > 0)
        .slice(0, limit);
}
