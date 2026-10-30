/**
 * Compras de mercancía — núcleo PURO (sin storage ni UI).
 *
 * Registro de facturas de mercancía YA PAGADAS para saber cuánto se gastó en
 * el mes. Es solo un control: NO toca el efectivo de la caja, el cierre, el
 * stock ni las deudas con proveedores.
 *
 * Registro: { id, date:'YYYY-MM-DD', supplier, amountUsd, currency:'USD'|'BS',
 *             amountBs?, rate, note?, createdAt, updatedAt }
 *   - `amountUsd` es la base de todos los totales.
 *   - `rate` es la tasa del día de la compra (para el equivalente en Bs);
 *     si se cargó en Bs, `amountBs` guarda el monto original.
 */
import { divR, mulR, round2, sumR } from './dinero';

export const MERCHANDISE_PURCHASES_KEY = 'bodega_merchandise_purchases_v1';
export const PURCHASE_LIMITS = Object.freeze({ MAX_SUPPLIER: 80, MAX_NOTE: 120, MAX_AMOUNT_USD: 1_000_000 });

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const NAME_COLLATOR = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

const cleanText = (value, max) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const toNumber = (value) => {
    if (typeof value === 'number') return value;
    const parsed = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : NaN;
};

/**
 * Arma (o corrige, si se pasa `previous`) una compra validada.
 * @returns {{ok:true, purchase:object}|{ok:false, error:string}}
 */
export function buildPurchase({ date, supplier, amount, currency = 'USD', rate, note, id, now, previous } = {}) {
    const fail = (error) => ({ ok: false, error });
    if (typeof date !== 'string' || !DATE_RE.test(date)) return fail('Elige la fecha de la compra');
    const name = cleanText(supplier, PURCHASE_LIMITS.MAX_SUPPLIER);
    if (!name) return fail('Escribe el proveedor o qué se compró');
    const value = toNumber(amount);
    if (!Number.isFinite(value) || value <= 0) return fail('Escribe un monto mayor a 0');
    const cur = currency === 'BS' ? 'BS' : 'USD';
    const tasa = toNumber(rate);
    if (cur === 'BS' && !(tasa > 0)) return fail('No hay tasa del día para convertir de Bs a $');

    const amountUsd = cur === 'BS' ? divR(value, tasa) : round2(value);
    if (!(amountUsd > 0)) return fail('El monto es demasiado pequeño');
    if (amountUsd > PURCHASE_LIMITS.MAX_AMOUNT_USD) return fail('El monto es demasiado grande');

    const stamp = (now ? new Date(now) : new Date()).toISOString();
    const purchase = {
        id: previous?.id || id || (globalThis.crypto?.randomUUID?.() ?? `cmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`),
        date,
        supplier: name,
        amountUsd,
        currency: cur,
        rate: tasa > 0 ? tasa : 0,
        createdAt: previous?.createdAt || stamp,
        updatedAt: stamp,
    };
    if (cur === 'BS') purchase.amountBs = round2(value);
    const cleanNote = cleanText(note, PURCHASE_LIMITS.MAX_NOTE);
    if (cleanNote) purchase.note = cleanNote;
    return { ok: true, purchase };
}

/** Equivalente en Bs de una compra (monto original si se cargó en Bs). */
export function purchaseAmountBs(purchase) {
    if (purchase?.currency === 'BS' && Number.isFinite(purchase.amountBs)) return purchase.amountBs;
    return purchase?.rate > 0 ? mulR(purchase.amountUsd, purchase.rate) : 0;
}

const isValidPurchase = (p) => p && typeof p.date === 'string' && DATE_RE.test(p.date) && Number.isFinite(p.amountUsd);

/** Más reciente primero; mismo día → la cargada de último arriba. */
export function comparePurchasesDesc(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    const ca = a.createdAt || '';
    const cb = b.createdAt || '';
    return ca === cb ? 0 : (ca < cb ? 1 : -1);
}

/**
 * Resumen del período [from, to] (fechas 'YYYY-MM-DD', inclusivas).
 */
export function summarizePurchases(purchases, from, to) {
    const list = (Array.isArray(purchases) ? purchases : [])
        .filter(isValidPurchase)
        .filter((p) => (!from || p.date >= from) && (!to || p.date <= to))
        .sort(comparePurchasesDesc);

    const totalUsd = sumR(list.map((p) => p.amountUsd));
    const totalBs = sumR(list.map(purchaseAmountBs));

    const dayMap = new Map();
    const supplierMap = new Map();
    for (const p of list) {
        if (!dayMap.has(p.date)) dayMap.set(p.date, []);
        dayMap.get(p.date).push(p);
        const key = p.supplier.toLocaleLowerCase('es');
        if (!supplierMap.has(key)) supplierMap.set(key, { name: p.supplier, items: [] });
        supplierMap.get(key).items.push(p);
    }

    const days = [...dayMap.entries()].map(([date, items]) => ({
        date,
        count: items.length,
        totalUsd: sumR(items.map((p) => p.amountUsd)),
        items,
    }));

    const suppliers = [...supplierMap.values()]
        .map(({ items }) => {
            const total = sumR(items.map((p) => p.amountUsd));
            return {
                name: preferredSpelling(items),
                count: items.length,
                totalUsd: total,
                pct: totalUsd > 0 ? divR(mulR(total, 100), totalUsd) : 0,
            };
        })
        .sort((a, b) => (b.totalUsd - a.totalUsd) || NAME_COLLATOR.compare(a.name, b.name));

    return {
        list,
        count: list.length,
        totalUsd,
        totalBs,
        days,
        suppliers,
        avgPerDay: days.length > 0 ? divR(totalUsd, days.length) : 0,
    };
}

/** Escritura más usada de un proveedor (empate → la más antigua). */
function preferredSpelling(items) {
    const counts = new Map();
    [...items].reverse().forEach((p, order) => {
        const entry = counts.get(p.supplier) || { count: 0, order };
        entry.count += 1;
        counts.set(p.supplier, entry);
    });
    return [...counts.entries()].sort((a, b) => (b[1].count - a[1].count) || (a[1].order - b[1].order))[0][0];
}

/** Proveedores ya usados, del más frecuente al menos (para sugerir al escribir). */
export function purchaseSupplierSuggestions(purchases, limit = 50) {
    const counts = new Map();
    for (const p of Array.isArray(purchases) ? purchases : []) {
        const name = cleanText(p?.supplier, PURCHASE_LIMITS.MAX_SUPPLIER);
        if (!name) continue;
        const key = name.toLocaleLowerCase('es');
        const entry = counts.get(key) || { name, count: 0 };
        entry.count += 1;
        counts.set(key, entry);
    }
    return [...counts.values()]
        .sort((a, b) => (b.count - a.count) || NAME_COLLATOR.compare(a.name, b.name))
        .slice(0, limit)
        .map((e) => e.name);
}

/** Inserta o reemplaza por id. */
export function upsertPurchase(purchases, purchase) {
    const list = Array.isArray(purchases) ? purchases : [];
    const index = list.findIndex((p) => p?.id === purchase.id);
    if (index === -1) return [...list, purchase];
    const next = [...list];
    next[index] = purchase;
    return next;
}

export function removePurchase(purchases, id) {
    return (Array.isArray(purchases) ? purchases : []).filter((p) => p?.id !== id);
}

// ── Órdenes del Supervisor (supervisor.purchase.*) ─────────────────────────
// El supervisor arma la compra y la caja la guarda (es quien publica la
// familia por mes). Upsert por id: reentregas y correcciones son idempotentes.
export const PURCHASE_UPSERT_TYPE = 'supervisor.purchase.upsert';
export const PURCHASE_DELETE_TYPE = 'supervisor.purchase.delete';
export const PURCHASE_COMMAND_VERSION = 1;
const MAX_ID = 128;

/** Forma de una compra que viaja por el canal (espejo del validador SQL). */
export function validatePurchaseRecord(p) {
    const fail = (error) => ({ ok: false, error });
    if (!p || typeof p !== 'object' || Array.isArray(p)) return fail('Compra inválida');
    if (typeof p.id !== 'string' || !p.id.trim() || p.id.length > MAX_ID) return fail('Compra inválida');
    if (typeof p.date !== 'string' || !DATE_RE.test(p.date)) return fail('Fecha de compra inválida');
    if (typeof p.supplier !== 'string' || !p.supplier.trim() || p.supplier.length > PURCHASE_LIMITS.MAX_SUPPLIER) return fail('Proveedor inválido');
    if (typeof p.amountUsd !== 'number' || !Number.isFinite(p.amountUsd) || p.amountUsd <= 0 || p.amountUsd > PURCHASE_LIMITS.MAX_AMOUNT_USD) return fail('Monto inválido');
    if (!['USD', 'BS'].includes(p.currency)) return fail('Moneda inválida');
    if (p.note != null && (typeof p.note !== 'string' || p.note.length > PURCHASE_LIMITS.MAX_NOTE)) return fail('Nota inválida');
    return { ok: true };
}

export function buildPurchaseUpsertPayload(purchase) {
    return { v: PURCHASE_COMMAND_VERSION, purchase };
}

export function buildPurchaseDeletePayload(purchase) {
    return {
        v: PURCHASE_COMMAND_VERSION,
        purchaseId: String(purchase?.id || ''),
        // Solo para mostrar en Control y en el ACK (la caja no confía en esto).
        supplier: String(purchase?.supplier || '').slice(0, PURCHASE_LIMITS.MAX_SUPPLIER),
    };
}

export function validatePurchaseCommandPayload(type, payload) {
    if (!payload || typeof payload !== 'object' || payload.v !== PURCHASE_COMMAND_VERSION) return { ok: false, error: 'Orden de compra inválida' };
    if (type === PURCHASE_UPSERT_TYPE) return validatePurchaseRecord(payload.purchase);
    if (type === PURCHASE_DELETE_TYPE) {
        return typeof payload.purchaseId === 'string' && payload.purchaseId.trim() && payload.purchaseId.length <= MAX_ID
            ? { ok: true }
            : { ok: false, error: 'Compra inválida' };
    }
    return { ok: false, error: 'Tipo de orden de compra desconocido' };
}

/**
 * Decide en la caja (puro). Solo se guardan los campos conocidos; la fecha de
 * creación original se conserva al corregir.
 * @returns {{status:'apply', list, purchase?}|{status:'already_applied', list}|{status:'rejected', error}}
 */
export function planPurchaseCommand(type, payload, purchases) {
    const check = validatePurchaseCommandPayload(type, payload);
    if (!check.ok) return { status: 'rejected', error: check.error };
    const list = Array.isArray(purchases) ? purchases : [];
    if (type === PURCHASE_DELETE_TYPE) {
        if (!list.some((p) => p?.id === payload.purchaseId)) return { status: 'already_applied', list };
        return { status: 'apply', list: removePurchase(list, payload.purchaseId) };
    }
    const incoming = payload.purchase;
    const existing = list.find((p) => p?.id === incoming.id);
    const purchase = {
        id: incoming.id,
        date: incoming.date,
        supplier: incoming.supplier.trim(),
        amountUsd: round2(incoming.amountUsd),
        currency: incoming.currency,
        rate: Number.isFinite(incoming.rate) && incoming.rate > 0 ? incoming.rate : 0,
        createdAt: existing?.createdAt || incoming.createdAt || incoming.updatedAt || new Date().toISOString(),
        updatedAt: incoming.updatedAt || new Date().toISOString(),
    };
    if (incoming.currency === 'BS' && Number.isFinite(incoming.amountBs)) purchase.amountBs = round2(incoming.amountBs);
    if (typeof incoming.note === 'string' && incoming.note.trim()) purchase.note = incoming.note.trim();
    const same = existing && JSON.stringify(existing) === JSON.stringify(purchase);
    if (same) return { status: 'already_applied', list, purchase };
    return { status: 'apply', list: upsertPurchase(list, purchase), purchase };
}
