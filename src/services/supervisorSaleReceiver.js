/**
 * Receptor de ventas remotas en la caja principal (supervisor.sale.create).
 * Sin React ni Supabase: todo entra por dependencias, así lo prueba H5 y lo
 * reutilizará el transporte LAN.
 *
 * Orden (plan 2026-10-29, F2):
 *   1. G10: flag de la caja apagado → rechazo.
 *   2. Leer catálogo, ventas y métodos SIN tomar pos_write_lock (G3: el lock
 *      no es reentrante y processSaleTransaction lo toma por su cuenta).
 *   3. planRemoteSale decide: rechazo / ya registrada / registrar.
 *   4. processSaleTransaction con saleId fijo (re-chequea duplicado bajo lock).
 *   5. El ACK lleva número de venta y la venta para el ticket del monitor.
 * Las ventas se publican solas al guardarse (bodega_sales_v1 se sincroniza y
 * lleva sus `stockEffects`), igual que un cobro hecho en la caja.
 */
import { planRemoteSale } from './supervisorSaleCommand.js';
import { planRemoteVoid } from './supervisorSaleVoidCommand.js';

const SALES_KEY = 'bodega_sales_v1';
const PRODUCTS_KEY = 'bodega_products_v1';

/** Venta reducida a lo que el monitor necesita para el ticket y la pantalla. */
export function toRemoteSaleReceipt(sale) {
    if (!sale) return null;
    return {
        id: sale.id,
        saleNumber: sale.saleNumber,
        timestamp: sale.timestamp,
        tipo: sale.tipo,
        status: sale.status,
        items: (sale.items || []).map((i) => ({
            id: i.id, name: i.name, qty: i.qty, priceUsd: i.priceUsd, priceCop: i.priceCop ?? null,
            isWeight: i.isWeight ?? false, unit: i.unit ?? null, granelUnit: i.granelUnit ?? null,
            _mode: i._mode ?? null, _unitsPerPackage: i._unitsPerPackage ?? null,
        })),
        totalUsd: sale.totalUsd,
        totalBs: sale.totalBs,
        totalCop: sale.totalCop ?? 0,
        baseUsd: sale.baseUsd ?? null,
        ivaUsd: sale.ivaUsd ?? 0,
        payments: sale.payments || [],
        changeUsd: sale.changeUsd ?? 0,
        changeBs: sale.changeBs ?? 0,
        rate: sale.rate,
        tasaCop: sale.tasaCop ?? 0,
        copEnabled: sale.copEnabled ?? false,
        customerName: sale.customerName || 'Consumidor Final',
        remoteSale: sale.remoteSale || null,
    };
}

/**
 * @param {object} deps
 * @param {object} deps.payload        Payload v1 de la venta.
 * @param {string} deps.commandId
 * @param {boolean} deps.enabled       Flag VITE_SUPERVISOR_REMOTE_SALES_ENABLED de la caja.
 * @param {object} deps.storage        storageService (getItem).
 * @param {Function} deps.getPaymentMethods  () => Promise<métodos activos>
 * @param {Function} deps.readContext  () => { effectiveRate, tasaCop, copEnabled, useAutoRate, ivaOpts, allowNegativeStock, allowCashAdvance }
 * @param {Function} deps.processSale  processSaleTransaction
 * @returns {Promise<object>} payload de ACK con `status` applied | applied_with_warnings | rejected
 */
export async function applyRemoteSaleOnCaja({ payload, commandId, enabled, storage, getPaymentMethods, readContext, processSale }) {
    const reject = (error, extra = {}) => ({ commandId, status: 'rejected', error, ...extra });
    if (enabled !== true) return reject('Las ventas remotas están desactivadas en la caja principal.', { code: 'DISABLED' });

    const [products, sales, paymentMethods] = await Promise.all([
        storage.getItem(PRODUCTS_KEY, []),
        storage.getItem(SALES_KEY, []),
        getPaymentMethods(),
    ]);
    const context = readContext();
    const plan = planRemoteSale(payload, {
        products: products || [],
        sales: sales || [],
        paymentMethods: paymentMethods || [],
        ...context,
    });

    if (plan.status === 'rejected') {
        const { status: _status, error, ...details } = plan;
        return reject(error, details);
    }

    const applied = (sale, warnings = [], duplicate = false) => ({
        commandId,
        status: warnings.length ? 'applied_with_warnings' : 'applied',
        saleId: sale.id,
        saleNumber: sale.saleNumber,
        totalUsd: sale.totalUsd,
        totalBs: sale.totalBs,
        duplicate,
        sale: toRemoteSaleReceipt(sale),
        ...(warnings.length ? { warnings } : {}),
    });

    if (plan.status === 'already_applied') return applied(plan.sale, [], true);

    const result = await processSale({
        ...plan.saleInput,
        remoteSale: { ...plan.saleInput.remoteSale, commandId },
    });
    if (!result?.success) {
        // Validación financiera de la caja (drift, vuelto, etc.): rechazo cierto.
        return reject(result?.error || 'La caja principal no pudo registrar la venta.', { code: 'CHECKOUT_REJECTED' });
    }
    return applied(result.sale, plan.warnings, result.duplicate === true);
}

/**
 * Anulación remota (supervisor.sale.void). Mismo patrón: decide `planRemoteVoid`
 * y anula `processVoidSale` SIN tomar pos_write_lock aquí (lo toma él).
 * @param {Function} deps.processVoid  processVoidSale(sale, sales, products, { voidInfo })
 * @param {Function} [deps.now]
 */
export async function applyRemoteVoidOnCaja({ payload, commandId, enabled, storage, processVoid, now = () => new Date().toISOString() }) {
    const reject = (error, extra = {}) => ({ commandId, status: 'rejected', error, ...extra });
    if (enabled !== true) return reject('Las ventas remotas están desactivadas en la caja principal.', { code: 'DISABLED' });

    const [sales, products] = await Promise.all([
        storage.getItem(SALES_KEY, []),
        storage.getItem(PRODUCTS_KEY, []),
    ]);
    const plan = planRemoteVoid(payload, { sales: sales || [] });
    if (plan.status === 'rejected') return reject(plan.error, { code: plan.code });

    const applied = (sale, duplicate) => ({
        commandId,
        status: 'applied',
        saleId: sale.id,
        saleNumber: sale.saleNumber ?? null,
        totalUsd: sale.totalUsd ?? null,
        duplicate,
    });
    if (plan.status === 'already_applied') return applied(plan.sale, true);

    try {
        await processVoid(plan.sale, sales, products, {
            voidInfo: {
                remote: true,
                by: payload.requestedBy.name.trim(),
                reason: payload.reason.trim(),
                commandId,
                at: now(),
            },
        });
    } catch (error) {
        // processVoidSale re-chequea bajo lock: si otra vía la anuló primero, es idempotente.
        if (/ya fue anulada/i.test(error?.message || '')) return applied(plan.sale, true);
        return reject(error?.message || 'La caja principal no pudo anular la venta.', { code: 'VOID_FAILED' });
    }
    return applied(plan.sale, false);
}
