/**
 * Ventas remotas (`supervisor.sale.create`) — núcleo PURO, sin Supabase ni React.
 *
 * El monitor arma el carrito con el catálogo sincronizado y cobra; la caja
 * principal decide si la venta se registra. Todo lo de negocio vive aquí para
 * que el transporte (nube hoy, LAN mañana) sea intercambiable:
 *   - `buildRemoteCartLine` / `buildRemoteSalePayload` → monitor.
 *   - `validateRemoteSalePayload` → monitor, contrato y caja.
 *   - `planRemoteSale` → caja: decide `apply` / `already_applied` / `rejected`.
 *
 * Guardarraíles (plan 2026-10-29):
 *   G1 la caja re-precia con SU catálogo y tasa; si el total difiere del visto
 *      por el vendedor, se rechaza con el total nuevo.
 *   G2 `saleId` del monitor: una reentrega nunca registra dos ventas.
 *   G4 sin turno abierto no se vende.
 *   G5 solo contado: sin fiado, Cashea, saldo a favor, descuentos ni líneas libres.
 *   G6 el pago cubre el total.
 *   G7 sin stock negativo permitido, falta de existencia = rechazo.
 *   G8 límites de tamaño.
 *   G12 avances de efectivo solo si la caja los tiene activos; la línea se
 *       re-arma en la caja con utils/cashAdvance (misma fórmula que la caja).
 */
import { FinancialEngine } from '../core/FinancialEngine.js';
import { deriveCartFields, cartLineName } from '../utils/cartSync.js';
import { findOpenCashShift } from '../utils/cashShift.js';
import { round2, round3, subR, sumR } from '../utils/dinero.js';
import { formatUsd } from '../utils/calculatorUtils.js';
import { calculateItemStockDeduction, isGranelProduct } from '../utils/granel.js';
import { CASH_ADVANCE_CURRENCIES, CASH_ADVANCE_MAX_PCT, buildCashAdvanceCartLine } from '../utils/cashAdvance.js';

export const REMOTE_SALE_PAYLOAD_VERSION = 1;

export const REMOTE_SALE_LIMITS = Object.freeze({
    MAX_ITEMS: 100,
    MAX_PAYMENTS: 10,
    MAX_QTY: 100000,
    MAX_AMOUNT_USD: 1000000,
    MAX_AMOUNT_LOCAL: 100000000000,
    MAX_SELLER_NAME: 60,
    MAX_CASH_ADVANCES: 5,
});

/** Diferencia máxima aceptada entre el total visto por el vendedor y el de la caja. */
export const REMOTE_SALE_TOTAL_TOLERANCE_USD = 0.01;

/** Métodos que no son dinero recibido o requieren cliente (fuera de v1). */
export const REMOTE_SALE_FORBIDDEN_METHODS = Object.freeze(['saldo_favor', 'cashea', 'fiado']);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CURRENCIES = new Set(['USD', 'BS', 'COP']);

const isFiniteNonNegative = (value, max) => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= max;

/**
 * Línea de carrito idéntica a la que arma `addToCart` en la caja.
 * Se usa en el monitor (para mostrar) y en la caja (para re-preciar).
 */
export function buildRemoteCartLine(product, { mode = 'package', qty }, ctx = {}) {
    const lineMode = mode === 'unit' ? 'unit' : 'package';
    const granel = isGranelProduct(product);
    const derived = deriveCartFields(product, lineMode, product.unitsPerPackage, ctx);
    return {
        ...product,
        id: lineMode === 'unit' ? `${product.id}_unit` : product.id,
        name: cartLineName(product.name, lineMode),
        priceUsd: derived.priceUsd,
        priceCop: derived.priceCop,
        exactBs: derived.exactBs,
        costBs: derived.costBs,
        costUsd: derived.costUsd,
        qty,
        isWeight: granel,
        unit: product.unit ?? null,
        granelUnit: granel ? (product.granelUnit ?? product.unit ?? null) : null,
        packagingType: product.packagingType ?? null,
        _originalId: product.id,
        _mode: lineMode,
        _unitsPerPackage: product.unitsPerPackage || 1,
    };
}

/** Subconjunto del vuelto que viaja: sin crédito a cartera (no hay cliente). */
function sanitizeChange(change = {}) {
    const tip = change?.tipDonated;
    return {
        changeUsdGiven: round2(Math.max(0, Number(change?.changeUsdGiven) || 0)),
        changeBsGiven: round2(Math.max(0, Number(change?.changeBsGiven) || 0)),
        changeAllocationExplicit: change?.changeAllocationExplicit === true,
        tipDonated: tip && Number(tip.amountUsd) > 0
            ? { amountUsd: round2(Number(tip.amountUsd)), currency: tip.currency === 'BS' ? 'BS' : 'USD' }
            : null,
    };
}

/** Payload v1 que el monitor envía. `cart` son líneas de `buildRemoteCartLine`. */
export function buildRemoteSalePayload({ saleId, seller, cart, payments, changeBreakdown, totals, rate }) {
    return {
        v: REMOTE_SALE_PAYLOAD_VERSION,
        saleId,
        seller: {
            name: String(seller?.name || '').trim().slice(0, REMOTE_SALE_LIMITS.MAX_SELLER_NAME),
            deviceId: seller?.deviceId ? String(seller.deviceId) : null,
        },
        items: (cart || []).filter((line) => !line.isCashAdvance).map((line) => ({
            productId: String(line._originalId || line.id),
            mode: line._mode === 'unit' ? 'unit' : 'package',
            qty: Number(line.qty),
            priceUsdSeen: round2(Number(line.priceUsd) || 0),
        })),
        // Solo si hay avances: una caja vieja nunca ve la clave en ventas normales.
        ...((cart || []).some((line) => line.isCashAdvance) ? {
            cashAdvances: cart.filter((line) => line.isCashAdvance).map((line) => ({
                currency: line.currency === 'BS' ? 'BS' : 'USD',
                montoEfectivo: round2(Number(line.montoEfectivo) || 0),
                comisionPct: Number(line.comisionPct) || 0,
            })),
        } : {}),
        payments: (payments || []).map((p) => ({
            methodId: String(p.methodId || ''),
            currency: p.currency || 'USD',
            amountUsd: round2(Number(p.amountUsd) || 0),
            amountBs: round2(Number(p.amountBs) || 0),
            amountCop: round2(Number(p.amountCop) || 0),
            ...(p.methodLabel ? { methodLabel: String(p.methodLabel).slice(0, 60) } : {}),
        })),
        change: sanitizeChange(changeBreakdown),
        totalsSeen: {
            totalUsd: round2(Number(totals?.totalUsd) || 0),
            totalBs: round2(Number(totals?.totalBs) || 0),
        },
        rateSeen: Number(rate) || 0,
    };
}

/** Forma y límites del payload (G8). Devuelve `{ ok }` o `{ ok:false, error }`. */
export function validateRemoteSalePayload(payload) {
    const fail = (error) => ({ ok: false, error });
    if (!payload || typeof payload !== 'object') return fail('Venta remota inválida');
    if (payload.v !== REMOTE_SALE_PAYLOAD_VERSION) return fail('Versión de venta remota no soportada');
    if (typeof payload.saleId !== 'string' || !UUID_RE.test(payload.saleId)) return fail('Identificador de venta inválido');

    const sellerName = payload.seller?.name;
    if (typeof sellerName !== 'string' || !sellerName.trim() || sellerName.length > REMOTE_SALE_LIMITS.MAX_SELLER_NAME) {
        return fail('Falta el nombre del vendedor');
    }

    const { items, payments } = payload;
    const advances = payload.cashAdvances ?? [];
    if (!Array.isArray(advances) || advances.length > REMOTE_SALE_LIMITS.MAX_CASH_ADVANCES) return fail('Avances de efectivo inválidos');
    for (const a of advances) {
        if (!a || !CASH_ADVANCE_CURRENCIES.includes(a.currency)) return fail('Moneda del avance inválida');
        const max = a.currency === 'BS' ? REMOTE_SALE_LIMITS.MAX_AMOUNT_LOCAL : REMOTE_SALE_LIMITS.MAX_AMOUNT_USD;
        if (!isFiniteNonNegative(a.montoEfectivo, max) || a.montoEfectivo <= 0) return fail('Monto del avance inválido');
        if (!isFiniteNonNegative(a.comisionPct, CASH_ADVANCE_MAX_PCT)) return fail('Comisión del avance inválida');
    }
    if (!Array.isArray(items) || (items.length === 0 && advances.length === 0)) return fail('La venta no tiene productos');
    if (items.length > REMOTE_SALE_LIMITS.MAX_ITEMS) return fail(`Máximo ${REMOTE_SALE_LIMITS.MAX_ITEMS} productos por venta`);
    for (const item of items) {
        if (!item || typeof item.productId !== 'string' || !item.productId || item.productId.length > 128) return fail('Producto inválido en la venta');
        if (item.productId.startsWith('custom_')) return fail('Las ventas libres no se permiten en ventas remotas');
        if (item.mode !== 'package' && item.mode !== 'unit') return fail('Modo de venta inválido');
        if (!(typeof item.qty === 'number' && Number.isFinite(item.qty) && item.qty > 0 && item.qty <= REMOTE_SALE_LIMITS.MAX_QTY)) {
            return fail('Cantidad inválida en la venta');
        }
        if (!isFiniteNonNegative(item.priceUsdSeen, REMOTE_SALE_LIMITS.MAX_AMOUNT_USD)) return fail('Precio inválido en la venta');
    }

    if (!Array.isArray(payments) || payments.length === 0) return fail('La venta no tiene pagos');
    if (payments.length > REMOTE_SALE_LIMITS.MAX_PAYMENTS) return fail('Demasiados pagos en la venta');
    for (const p of payments) {
        if (!p || typeof p.methodId !== 'string' || !p.methodId) return fail('Método de pago inválido');
        if (REMOTE_SALE_FORBIDDEN_METHODS.includes(p.methodId)) return fail('Las ventas remotas son solo de contado');
        if (!CURRENCIES.has(p.currency)) return fail('Moneda de pago inválida');
        if (!isFiniteNonNegative(p.amountUsd, REMOTE_SALE_LIMITS.MAX_AMOUNT_USD)
            || !isFiniteNonNegative(p.amountBs, REMOTE_SALE_LIMITS.MAX_AMOUNT_LOCAL)
            || !isFiniteNonNegative(p.amountCop, REMOTE_SALE_LIMITS.MAX_AMOUNT_LOCAL)) {
            return fail('Monto de pago inválido');
        }
    }

    const totals = payload.totalsSeen;
    if (!totals || !isFiniteNonNegative(totals.totalUsd, REMOTE_SALE_LIMITS.MAX_AMOUNT_USD) || totals.totalUsd <= 0.01) {
        return fail('Total de la venta inválido');
    }
    if (!isFiniteNonNegative(totals.totalBs, REMOTE_SALE_LIMITS.MAX_AMOUNT_LOCAL)) return fail('Total de la venta inválido');
    return { ok: true };
}

const rejected = (error, extra = {}) => ({ status: 'rejected', error, ...extra });

/**
 * Decide en la caja qué hacer con una venta remota. Puro: recibe todo el
 * estado leído y devuelve el input listo para `processSaleTransaction`.
 *
 * @returns {{status:'apply', saleInput, warnings:string[]}
 *          |{status:'already_applied', sale}
 *          |{status:'rejected', error, code?, newTotalUsd?, priceChanges?}}
 */
export function planRemoteSale(payload, {
    products = [],
    sales = [],
    paymentMethods = [],
    effectiveRate = 0,
    tasaCop = 0,
    copEnabled = false,
    ivaOpts = null,
    allowNegativeStock = false,
    allowCashAdvance = false,
    useAutoRate = false,
} = {}) {
    const check = validateRemoteSalePayload(payload);
    if (!check.ok) return rejected(check.error);

    // G2: la venta ya existe (reentrega, reintento o reenvío) → no se repite.
    const existing = sales.find((s) => s?.id === payload.saleId);
    if (existing) return { status: 'already_applied', sale: existing };

    // G4: sin turno abierto no se vende.
    if (!findOpenCashShift(sales)) return rejected('La caja principal está cerrada. Ábrela para recibir ventas remotas.', { code: 'CASH_CLOSED' });
    if (!(effectiveRate > 0)) return rejected('La caja principal no tiene tasa de cambio configurada.', { code: 'NO_RATE' });

    // G1: re-precio con el catálogo y la tasa de la caja.
    const ctx = { tasaCop, effectiveRate };
    const byId = new Map(products.map((p) => [String(p?.id), p]));
    const cart = [];
    const priceChanges = [];
    for (const item of payload.items) {
        const product = byId.get(item.productId);
        if (!product) return rejected('Un producto de la venta ya no existe en la caja principal.', { code: 'PRODUCT_MISSING', productId: item.productId });
        if (!(Number(product.priceUsdt) > 0)) return rejected(`${product.name}: no tiene precio válido en la caja principal.`, { code: 'PRODUCT_NO_PRICE' });
        if (item.mode === 'unit' && !(product.sellByUnit && (Number(product.unitPriceUsd) > 0 || Number(product.unitPriceCop) > 0))) {
            return rejected(`${product.name}: no se vende por unidad.`, { code: 'UNIT_NOT_ALLOWED' });
        }
        const granel = isGranelProduct(product);
        const qty = granel ? round3(item.qty) : item.qty;
        if (!granel && !Number.isInteger(qty)) return rejected(`${product.name}: la cantidad debe ser entera.`, { code: 'QTY_NOT_INTEGER' });

        const line = buildRemoteCartLine(product, { mode: item.mode, qty }, ctx);
        const priceNow = round2(Number(line.priceUsd) || 0);
        if (Math.abs(subR(priceNow, item.priceUsdSeen)) > REMOTE_SALE_TOTAL_TOLERANCE_USD) {
            priceChanges.push({ productId: product.id, name: line.name, from: item.priceUsdSeen, to: priceNow });
        }
        cart.push(line);
    }

    // G12: avances de efectivo, re-armados con la fórmula de la caja.
    const advances = payload.cashAdvances ?? [];
    if (advances.length > 0 && !allowCashAdvance) {
        return rejected('Los avances de efectivo están desactivados en la caja principal.', { code: 'CASH_ADVANCE_DISABLED' });
    }
    const productLines = cart.slice();
    advances.forEach((a, i) => cart.push(buildCashAdvanceCartLine(a, effectiveRate, `advance_${payload.saleId}_${i}`)));

    const isBsPayment = payload.payments.some((p) => p.currency === 'BS' && p.amountBs > 0);
    const totals = FinancialEngine.buildCartTotals(cart, null, effectiveRate, copEnabled ? tasaCop : 0, isBsPayment, ivaOpts);
    if (Math.abs(subR(totals.totalUsd, payload.totalsSeen.totalUsd)) > REMOTE_SALE_TOTAL_TOLERANCE_USD) {
        return rejected(
            `Los precios cambiaron en la caja principal: el total ahora es USD ${formatUsd(totals.totalUsd)}. Revisa y vuelve a cobrar.`,
            { code: 'PRICE_CHANGED', newTotalUsd: totals.totalUsd, priceChanges },
        );
    }

    // G5: métodos activos en la caja y con la moneda correcta.
    const methodsById = new Map(paymentMethods.map((m) => [m.id, m]));
    for (const p of payload.payments) {
        const method = methodsById.get(p.methodId);
        if (!method || method.isEnabled === false || method.isVirtual) {
            return rejected(`El método de pago «${p.methodLabel || p.methodId}» no está activo en la caja principal.`, { code: 'METHOD_NOT_ALLOWED' });
        }
        if (method.currency !== p.currency) return rejected('La moneda del pago no coincide con el método.', { code: 'METHOD_CURRENCY' });
    }

    // G6: el pago cubre el total (contado).
    const paidUsd = sumR(payload.payments.map((p) => p.amountUsd));
    if (paidUsd + REMOTE_SALE_TOTAL_TOLERANCE_USD < totals.totalUsd) {
        return rejected('El pago no cubre el total. Las ventas remotas son solo de contado.', { code: 'UNDERPAID' });
    }

    // G7: existencia.
    const warnings = [];
    const neededByProduct = new Map();
    for (const line of productLines) {
        neededByProduct.set(line._originalId, (neededByProduct.get(line._originalId) || 0) + calculateItemStockDeduction(line));
    }
    for (const [productId, needed] of neededByProduct) {
        const product = byId.get(productId);
        const stock = Number(product.stock) || 0;
        if (needed > stock) {
            if (!allowNegativeStock) {
                return rejected(`${product.name}: sin existencia suficiente en la caja principal (hay ${stock}).`, { code: 'NO_STOCK' });
            }
            warnings.push(`${product.name}: quedó con existencia negativa`);
        }
    }

    return {
        status: 'apply',
        warnings,
        saleInput: {
            cart,
            cartTotalUsd: totals.totalUsd,
            cartTotalBs: totals.totalBs,
            cartSubtotalUsd: totals.subtotalUsd,
            cartBaseUsd: totals.baseUsd,
            cartIvaUsd: totals.ivaUsd,
            payments: payload.payments.map((p) => ({ ...p, methodLabel: p.methodLabel || methodsById.get(p.methodId)?.label || p.methodId })),
            changeBreakdown: { ...payload.change, esCredito: false, vueltoCredito: false },
            selectedCustomerId: null,
            customers: [],
            products,
            effectiveRate,
            tasaCop,
            copEnabled,
            discountData: null,
            useAutoRate,
            saleId: payload.saleId,
            remoteSale: {
                sellerName: payload.seller.name.trim(),
                monitorDeviceId: payload.seller.deviceId || null,
            },
        },
    };
}
