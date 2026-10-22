import { storageService } from './storageService.js';
import { logEvent } from '../services/auditService.js';
import { useAuthStore } from '../hooks/store/useAuthStore.js';
import { sumR, round2, round3, round0 } from './dinero.js';
import { isGranelProduct, adjustStockValue, calculateItemStockDeduction } from './granel.js'; // GRANEL-001
import { withLock } from './withLock.js';
import { deepFreeze } from './deepFreeze.js';
import { applyCustomerMovementsWithinLock } from '../services/customerWalletService.js';
import { CUSTOMER_LEDGER_KEY, CUSTOMER_MOVEMENT_TYPES } from './customerLedger.js';

const SALES_KEY = 'bodega_sales_v1';
const CUSTOMERS_KEY = 'bodega_customers_v1';
const PRODUCTS_KEY = 'bodega_products_v1';

function legacyReversalMovements(sale) {
    const fiadoAmountUsd = round2(sale.fiadoUsd || (sale.tipo === 'VENTA_FIADA' ? sale.totalUsd : 0) || 0);
    const favorUsed = sumR((sale.payments?.filter(p => p.methodId === 'saldo_favor') || []).map(p => p.amountUsd));
    const changeCredited = round2(sale.vueltoParaMonedero || 0);
    const isCobroDeuda = sale.tipo === 'COBRO_DEUDA';
    const amount = isCobroDeuda ? round2(sale.totalUsd || 0) : 0;
    const movements = [];

    if (isCobroDeuda && amount > 0) {
        movements.push({
            type: CUSTOMER_MOVEMENT_TYPES.REVERSAL,
            direction: 'DEBIT',
            amountUsd: amount,
            sourceType: 'REVERSAL',
            sourceId: `legacy-reversal:${sale.id}:cobro`,
            sourceSaleId: sale.id,
            reason: 'Reversión de abono histórico',
        });
        return movements;
    }

    // Reverse in opposite order to restore the balance before a mixed sale.
    if (changeCredited > 0) movements.push({
        type: CUSTOMER_MOVEMENT_TYPES.REVERSAL,
        direction: 'DEBIT',
        amountUsd: changeCredited,
        sourceType: 'REVERSAL',
        sourceId: `legacy-reversal:${sale.id}:vuelto`,
        sourceSaleId: sale.id,
        reason: 'Reversión de vuelto acreditado histórico',
    });
    if (fiadoAmountUsd > 0) movements.push({
        type: CUSTOMER_MOVEMENT_TYPES.REVERSAL,
        direction: 'CREDIT',
        amountUsd: fiadoAmountUsd,
        sourceType: 'REVERSAL',
        sourceId: `legacy-reversal:${sale.id}:fiado`,
        sourceSaleId: sale.id,
        reason: 'Reversión de venta fiada histórica',
    });
    if (favorUsed > 0) movements.push({
        type: CUSTOMER_MOVEMENT_TYPES.REVERSAL,
        direction: 'CREDIT',
        amountUsd: favorUsed,
        sourceType: 'REVERSAL',
        sourceId: `legacy-reversal:${sale.id}:favor`,
        sourceSaleId: sale.id,
        reason: 'Reversión de saldo a favor usado histórico',
    });
    return movements;
}

export async function processVoidSale(saleParam, currentSales, currentProducts) {
    const sale = (saleParam && typeof saleParam === 'object' && saleParam.sale) ? saleParam.sale : saleParam;
    if (!sale) throw new Error('Sale object is required to void.');
    if (sale.status === 'ANULADA') throw new Error('Esta venta ya fue anulada.');

    return withLock('pos_write_lock', async () => {
        const freshSales = await storageService.getItem(SALES_KEY, []);
        const freshSale = freshSales.find(s => s.id === sale.id);
        if (!freshSale || freshSale.status === 'ANULADA') throw new Error('Esta venta ya fue anulada.');

        const freshProducts = await storageService.getItem(PRODUCTS_KEY, currentProducts || []);
        // Plan de stock delta: la restauración se calcula primero porque sus
        // efectos inversos viajan embebidos en el registro de venta anulado.
        const voidAt = new Date().toISOString();
        const voidEffects = [];
        let updatedProducts = freshProducts;
        if (freshSale.items?.length > 0 || freshSale.stockEffects?.length > 0) {
            updatedProducts = freshProducts.map(p => {
                const itemsInSale = (freshSale.items || []).filter(i => (i._originalId || i.id) === p.id);
                const recordedDeltas = (Array.isArray(freshSale.stockEffects) ? freshSale.stockEffects : [])
                    .filter(e => String(e.productId) === String(p.id));
                if (itemsInSale.length === 0 && recordedDeltas.length === 0) return p;
                // BULTOS-001/TAREA 4B: si la venta trae stockEffects registrados, se
                // invierte el delta REAL aplicado en su momento — correcto incluso para
                // ventas pre-fix cuya deducción fue menor (no inflar el stock al anular).
                // Si no hay deltas registrados, se recalcula con la fórmula canónica
                // (con la salvedad documentada para ventas históricas muy antiguas).
                let totalToRestore;
                if (recordedDeltas.length > 0) {
                    const raw = recordedDeltas.reduce((sum, e) => sum + (Number(e.delta) || 0), 0);
                    totalToRestore = isGranelProduct(p) ? round3(-raw) : round0(-raw);
                } else {
                    // GRANEL-001: la suma a restaurar se acumula a 3 decimales para no
                    // perder el tercer decimal del peso vendido (0.125 kg → 0.13 con sumR).
                    totalToRestore = itemsInSale.reduce((sum, item) => {
                        const deduction = calculateItemStockDeduction(item);
                        if (isGranelProduct(item)) return round3(sum + deduction);
                        return sum + deduction;
                    }, 0);
                }
                // GRANEL-001: granel restaura hasta 3 decimales sin drift;
                // el resto permanece entero estricto.
                const stockBefore = p.stock || 0;
                const stockAfter = adjustStockValue(stockBefore, totalToRestore, isGranelProduct(p));
                // Efecto inverso REAL aplicado (post-redondeo), con su propio `at`:
                // cuenta aunque la venta original sea anterior al baseline del
                // catálogo (ver plan de stock delta §4).
                voidEffects.push({
                    productId: p.id,
                    delta: isGranelProduct(p) ? round3(stockAfter - stockBefore) : round0(stockAfter - stockBefore),
                    stockBefore,
                    stockAfter,
                    at: voidAt,
                });
                return { ...p, stock: stockAfter };
            });
        }

        // El registro viaja como reemplazo completo (convención existente) con su
        // log append-only: los efectos del cobro más los inversos de la anulación.
        const updatedSales = freshSales.map(s => s.id === sale.id
            ? {
                ...s,
                status: 'ANULADA',
                stockEffects: [...(Array.isArray(s.stockEffects) ? s.stockEffects : []), ...voidEffects],
            }
            : s);

        const savedCustomers = await storageService.getItem(CUSTOMERS_KEY, []);
        let updatedCustomers = savedCustomers;
        const savedLedger = await storageService.getItem(CUSTOMER_LEDGER_KEY, []);
        let ledgerMovements = savedLedger.filter(m => m.customerId === freshSale.customerId
            && (m.sourceSaleId === freshSale.id || m.sourceId?.startsWith(`${freshSale.id}:`))
            && m.type !== CUSTOMER_MOVEMENT_TYPES.REVERSAL);

        // New sales use their exact ledger movements. Historical sales are mapped
        // conservatively only when no source-linked movements exist.
        let reversalMovements = ledgerMovements.length > 0
            ? ledgerMovements.slice().reverse().map(original => ({
                type: CUSTOMER_MOVEMENT_TYPES.REVERSAL,
                direction: original.direction === 'CREDIT' ? 'DEBIT' : 'CREDIT',
                amountUsd: original.amountUsd,
                sourceType: 'REVERSAL',
                sourceId: `reversal:${original.id}`,
                sourceSaleId: freshSale.id,
                reversalOf: original.id,
                reason: `Anulación de ${original.reason || original.type}`,
            }))
            : legacyReversalMovements(freshSale);

        // Cashea is a separate counterparty and remains outside the customer ledger.
        const casheaVentaUsd = freshSale.tipo === 'VENTA_CASHEA' ? round2(freshSale.casheaUsd || 0) : 0;
        const casheaRemesaUsd = freshSale.tipo === 'COBRO_CASHEA' ? round2(freshSale.totalUsd || 0) : 0;

        if (freshSale.customerId && reversalMovements.length > 0) {
            const walletResult = await applyCustomerMovementsWithinLock({
                customerId: freshSale.customerId,
                customers: savedCustomers,
                user: useAuthStore.getState().usuarioActivo,
                movements: reversalMovements,
            });
            updatedCustomers = walletResult.updatedCustomers;
        }

        if (freshSale.customerId && (casheaVentaUsd > 0 || casheaRemesaUsd > 0)) {
            updatedCustomers = updatedCustomers.map(customer => {
                if (customer.id !== freshSale.customerId) return customer;
                return {
                    ...customer,
                    casheaDeuda: Math.max(0, round2(
                        (customer.casheaDeuda || 0) - casheaVentaUsd + casheaRemesaUsd
                    )),
                };
            });
        }

        await storageService.setItem(SALES_KEY, updatedSales);
        await storageService.setItem(CUSTOMERS_KEY, updatedCustomers);
        // Plan de stock delta: la restauración ya viaja dentro del registro de
        // venta anulado; el catálogo local se escribe SIN re-publicarse.
        await storageService.setItem(PRODUCTS_KEY, updatedProducts, { skipSyncPush: true });

        deepFreeze(updatedProducts);
        deepFreeze(updatedCustomers);

        const user = useAuthStore.getState().usuarioActivo;
        const tipDonadaUsd = round2(freshSale.tipDonated?.amountUsd || 0);
        logEvent('VENTA', 'VENTA_ANULADA',
            `Venta #${freshSale.saleNumber || '?'} anulada - $${round2(freshSale.totalUsd || 0)}`
            + (tipDonadaUsd > 0
                ? ` - ATENCION: incluia propina donada de $${tipDonadaUsd}. Verifica el efectivo en caja.`
                : ''),
            user,
            { saleId: freshSale.id, tipo: freshSale.tipo, totalUsd: freshSale.totalUsd, tipDonatedUsd: tipDonadaUsd }
        );

        return { success: true, updatedSales, updatedProducts, updatedCustomers };
    });
}
