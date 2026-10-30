/**
 * Familia de sync de `bodega_merchandise_purchases_v1` por MES.
 *
 * Mismo modelo que las facturas de proveedores (Fase 6, por año), pero por
 * mes: un año de compras de bodega pasa de 1 MB (límite de Realtime) y cada
 * compra nueva re-subiría el año entero. Con un doc por mes, cargar una
 * compra solo reescribe SU mes (decenas de KB).
 *
 * Semántica del lector: REEMPLAZO DE FRANJA. Un doc = TODAS las compras de su
 * mes en orden canónico (fecha, id); `[]` es la tumba que vacía ese mes. El
 * doc base nunca se publica (la familia nace partida); si llegara, se une con
 * «lo entrante gana» y nunca limpia.
 */
import { MERCHANDISE_PURCHASES_KEY } from './merchandisePurchases';

export const PURCHASES_SYNC_BASE_KEY = MERCHANDISE_PURCHASES_KEY;
export const PURCHASES_SYNC_TRACKING_KEY = 'pda_purchases_sync_docs_v1';

const PERIOD_RE = /^\d{4}-\d{2}$/;

export function isPurchasesSyncDocId(docId) {
    return docId === PURCHASES_SYNC_BASE_KEY
        || (typeof docId === 'string' && docId.startsWith(`${PURCHASES_SYNC_BASE_KEY}:`));
}

/** Periodo de una compra: `YYYY-MM` de su fecha; sin fecha válida → `recent`. */
export function getPurchasesSyncPeriodOf(record) {
    const month = typeof record?.date === 'string' ? record.date.slice(0, 7) : '';
    return PERIOD_RE.test(month) ? month : 'recent';
}

/** Periodo de un doc de la familia; null si no es `<base>:<periodo>`. */
export function parsePurchasesSyncDocId(docId) {
    if (!isPurchasesSyncDocId(docId) || docId === PURCHASES_SYNC_BASE_KEY) return null;
    const period = docId.slice(PURCHASES_SYNC_BASE_KEY.length + 1);
    return PERIOD_RE.test(period) || period === 'recent' ? period : null;
}

function compareRecords(a, b) {
    const ta = a?.date || '';
    const tb = b?.date || '';
    if (ta !== tb) return ta < tb ? -1 : 1;
    const ia = String(a?.id ?? '');
    const ib = String(b?.id ?? '');
    return ia < ib ? -1 : ia > ib ? 1 : 0;
}

/** Parte las compras en documentos por mes (cada uno completo y ordenado). */
export function buildPurchasesSyncPlan(purchases) {
    const byPeriod = new Map();
    for (const record of Array.isArray(purchases) ? purchases : []) {
        const period = getPurchasesSyncPeriodOf(record);
        if (!byPeriod.has(period)) byPeriod.set(period, []);
        byPeriod.get(period).push(record);
    }
    return [...byPeriod.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
        .map(([period, records]) => ({
            docId: `${PURCHASES_SYNC_BASE_KEY}:${period}`,
            period,
            records: [...records].sort(compareRecords),
        }));
}

/**
 * Merge de un doc de la familia en la lista local.
 *  - doc de mes: reemplaza exactamente las compras de ese mes (`[]` lo vacía).
 *  - doc base (defensivo): unión con «lo entrante gana»; nunca limpia.
 * Payload no-arreglo → devuelve el local tal cual.
 *
 * `keepLocalNewerThan` (solo la caja, que es quien escribe): conserva las
 * compras locales del mes actualizadas DESPUÉS de que se escribió el doc. Una
 * descarga vieja (p. ej. el pull inicial al recargar) que llega tarde no
 * borra una compra recién guardada por una orden del Supervisor.
 */
export function mergePurchasesSyncDoc(localPurchases, docId, payload, { keepLocalNewerThan = null } = {}) {
    const local = Array.isArray(localPurchases) ? localPurchases : [];
    if (!Array.isArray(payload)) return local;

    const period = parsePurchasesSyncDocId(docId);
    if (period !== null) {
        const withoutPeriod = local.filter((r) => getPurchasesSyncPeriodOf(r) !== period);
        const incoming = [...payload];
        if (keepLocalNewerThan) {
            const incomingIds = new Set(payload.map((r) => r?.id));
            for (const record of local) {
                if (getPurchasesSyncPeriodOf(record) !== period) continue;
                if (typeof record?.updatedAt !== 'string' || record.updatedAt <= keepLocalNewerThan) continue;
                const index = incoming.findIndex((r) => r?.id === record.id);
                if (index >= 0) incoming[index] = record;
                else if (!incomingIds.has(record.id)) incoming.push(record);
            }
        }
        return incoming.length === 0 ? withoutPeriod : [...withoutPeriod, ...incoming];
    }

    if (docId !== PURCHASES_SYNC_BASE_KEY || payload.length === 0) return local;
    const incomingById = new Map(payload.map((r) => [r?.id, r]));
    const merged = local.map((r) => (incomingById.has(r?.id) ? incomingById.get(r?.id) : r));
    const localIds = new Set(local.map((r) => r?.id));
    for (const record of payload) {
        if (!localIds.has(record?.id)) merged.push(record);
    }
    return merged;
}
