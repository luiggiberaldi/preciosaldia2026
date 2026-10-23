// ─────────────────────────────────────────────────────────────────────────────
// Techo de 500 KB por documento de `sync_documents` (REPORTE-CAUSA-RAIZ-EGRESS).
//
// Los documentos monolíticos con imágenes base64 embebidas llegaron a 1.29 MB:
// pasan el límite de Realtime (~1 MB → eventos 413 sin cuerpo), vuelven lenta
// la serialización de PostgREST y multiplican el egress (cada pull pesado baja
// el paquete entero). La familia de ventas ya se publica partida por periodos
// con esta misma cota (`SALES_SYNC_MAX_DOC_BYTES`); este módulo la convierte en
// una constante única y mide TODO documento al publicarlo.
//
// Política honesta del techo:
//   - La herramienta real para caber bajo la cota es la migración de imágenes
//     base64 → Storage (`imageUpload.migrateCatalogImagesOnce`), que corre antes
//     de publicar y encoge el doc sin perder datos.
//   - Medir y AVISAR es obligatorio: un doc que siga sobre techo tras la
//     migración (catálogo enorme de URLs) se publica igual — bloquearlo rompería
//     la sincronización — pero queda advertido en consola y en el resultado del
//     push. Partir `bodega_products_v1` en shards es un cambio de protocolo
//     aparte (ver docs/plans/2026-10-21-plan-adelgazar-bodega-products-por-shards.md).
// ─────────────────────────────────────────────────────────────────────────────

/** Cota dura de aceptación: ningún documento de sync pasa de ~500 KB. */
export const SYNC_DOC_BUDGET_BYTES = 500_000;

/** Tamaño aproximado de un valor serializado para `sync_documents.data`. */
export function measureSyncDocBytes(value) {
    try {
        const str = typeof value === 'string' ? value : JSON.stringify(value);
        return typeof str === 'string' ? str.length : 0;
    } catch {
        return 0;
    }
}

/** Cuántos productos del payload todavía cargan su imagen como base64 embebido. */
export function countInlineBase64Images(payload) {
    if (!Array.isArray(payload)) return 0;
    return payload.reduce((count, item) => (
        count + (typeof item?.image === 'string' && item.image.startsWith('data:') ? 1 : 0)
    ), 0);
}

/**
 * Evalúa un documento contra el techo. `envelope` es lo que viaja en la columna
 * `data` (el objeto envelope de `buildSyncEnvelope`); `payload` es su contenido
 * para poder diagnosticar imágenes base64 embebidas.
 *
 * @returns {{ docId: string|null, bytes: number, budgetBytes: number, over: boolean, inlineBase64Images: number }}
 */
export function assessSyncDocBudget({ docId = null, envelope, payload = null, budgetBytes = SYNC_DOC_BUDGET_BYTES } = {}) {
    const bytes = measureSyncDocBytes(envelope);
    return {
        docId,
        bytes,
        budgetBytes,
        over: bytes > budgetBytes,
        inlineBase64Images: countInlineBase64Images(payload),
    };
}

export default {
    SYNC_DOC_BUDGET_BYTES,
    measureSyncDocBytes,
    countInlineBase64Images,
    assessSyncDocBudget,
};
