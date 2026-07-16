import { storageService } from './storageService';
import { procesarImpactoCliente } from './financialLogic';
import { logEvent } from '../services/auditService';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { round2, sumR, subR, divR, mulR } from './dinero';
import { withLock } from './withLock';          // FIN-007: feature detection + fallback.
import { deepFreeze } from './deepFreeze';      // FIN-008: deep freeze (no solo shallow).
import { FINANCIAL_EPSILON } from './securityConstants';

const SALES_KEY = 'bodega_sales_v1';
const PRODUCTS_KEY = 'bodega_products_v1';
const CUSTOMERS_KEY = 'bodega_customers_v1';

export async function processSaleTransaction({
    cart,
    cartTotalUsd,
    cartTotalBs,
    cartSubtotalUsd,
    payments,
    changeBreakdown,
    selectedCustomerId,
    customers,
    products,
    effectiveRate,
    tasaCop,
    copEnabled,
    discountData,
    useAutoRate
}) {
    if (cart.length === 0) return { success: false, error: 'Carrito vacío' };

    const selectedCustomer = customers.find(c => c.id === selectedCustomerId);

    if (isNaN(cartTotalUsd) || cartTotalUsd < 0 || isNaN(cartTotalBs) || cartTotalBs < 0) {
        return { success: false, error: 'Integridad matemática comprometida' };
    }
    if (cartTotalUsd <= 0.01) {
        return { success: false, error: 'No se pueden generar ventas de $0.00' };
    }
    if (!Array.isArray(payments) || payments.some(p => isNaN(p.amountUsd) || p.amountUsd < 0)) {
        return { success: false, error: 'Datos de pago inválidos' };
    }

    // FIN-022: Validación de tasa y consistencia matemática entre USD y Bs.
    if (!effectiveRate || effectiveRate <= 0) {
        return { success: false, error: 'Tasa de cambio BCV inválida (<= 0). Configura la tasa antes de cobrar.' };
    }
    const expectedBs = mulR(cartTotalUsd, effectiveRate);
    const bsDrift = Math.abs(subR(cartTotalBs, expectedBs));
    if (bsDrift > FINANCIAL_EPSILON.CASH_RECONCILE_TOLERANCE_BS) {
        return { success: false, error: `Inconsistencia USD/Bs: drift de ${round2(bsDrift)} Bs (tasa ${effectiveRate}).` };
    }

    // ── Aritmética precisa con dinero.js (elimina IEEE 754 drift) ──
    const totalPaidUsd = sumR(payments.map(p => p.amountUsd));
    const remainingUsd = round2(Math.max(0, subR(cartTotalUsd, totalPaidUsd)));
    const changeUsd    = round2(Math.max(0, subR(totalPaidUsd, cartTotalUsd)));

    const casheaPayment = payments.find(p => p.methodId === 'cashea');
    const casheaUsd = casheaPayment ? round2(casheaPayment.amountUsd) : 0;

    if (!selectedCustomer && (remainingUsd > 0.01 || casheaUsd > 0)) {
        return { success: false, error: remainingUsd > 0.01 ? 'Se requiere cliente para ventas fiadas' : 'Se requiere cliente para ventas con Cashea' };
    }

    // FIN-005: Bloquear ventas con anomalía de vuelto (changeUsd > total * 5).
    const changeAnomalyThresholdUsd = mulR(cartTotalUsd, FINANCIAL_EPSILON.CHANGE_ANOMALY_MULTIPLIER);
    if (changeUsd > FINANCIAL_EPSILON.CHANGE_ANOMALY_MIN_USD && changeUsd > changeAnomalyThresholdUsd) {
        return {
            success: false,
            error: `Vuelto anómalo detectado: $${round2(changeUsd)} para una venta de $${round2(cartTotalUsd)}. Verifica los montos ingresados.`
        };
    }

    const fiadoAmountUsd = remainingUsd > 0.01 ? remainingUsd : 0;
    const tipoVenta = casheaUsd > 0 ? 'VENTA_CASHEA' : (fiadoAmountUsd > 0 ? 'VENTA_FIADA' : 'VENTA');

    // ── Normalizar payments: asegurar currency y methodLabel ──
    // Esto permite que el FinancialEngine calcule el breakdown correctamente
    // sin depender de campos que podían llegar undefined en versiones anteriores.
    const normalizedPayments = payments.map(p => ({
        ...p,
        currency:    p.currency    || 'USD',
        methodLabel: p.methodLabel || p.methodId,
    }));

    const sale = {
        id: crypto.randomUUID(),
        tipo: tipoVenta,
        status: 'COMPLETADA',
        items: cart.map(i => ({
            id: i.id,
            name: i.name,
            qty: i.qty,
            priceUsd: i.priceUsd,
            priceCop: i.priceCop || null,
            costBs: i.costBs || 0,
            costUsd: i.costUsd || 0,
            isWeight: i.isWeight,
            isCashAdvance: i.isCashAdvance || null,
            montoEfectivo: i.montoEfectivo || null,
            montoComision: i.montoComision || null,
            comisionPct: i.comisionPct || null,
            currency: i.currency || null,
            exactBs: i.exactBs || null
        })),
        cartSubtotalUsd: cartSubtotalUsd,
        discountType:       discountData?.type      || null,
        discountValue:      discountData?.value     || 0,
        discountAmountUsd:  discountData?.amountUsd || 0,
        totalUsd:  cartTotalUsd,
        totalBs:   cartTotalBs,
        // FIN-010: totalCop ahora alineado con buildCartTotals (divR + round2).
        totalCop:  copEnabled && tasaCop > 0
            ? (cart.every(i => i.priceCop > 0)
                ? round2(mulR(
                    cart.reduce((s, i) => sumR(s, mulR(i.priceCop, i.qty)), 0),
                    subR(1, divR(discountData?.amountUsd || 0, cartSubtotalUsd || 1))
                ))
                : mulR(cartTotalUsd, tasaCop))
            : 0,
        payments:  normalizedPayments,          // ← Con currency + methodLabel
        rate:      effectiveRate,
        tasaCop:   copEnabled ? tasaCop : 0,
        copEnabled: copEnabled,
        rateSource: useAutoRate ? 'BCV Auto' : 'Manual',
        timestamp: new Date().toISOString(),
        changeUsd: tipoVenta !== 'VENTA' ? 0 : round2(changeBreakdown?.changeUsdGiven || 0),
        changeBs:  tipoVenta !== 'VENTA' ? 0 : round2(changeBreakdown?.changeBsGiven  || 0),
        // FIN-012: Guardar vueltoParaMonedero para revertir al anular.
        // Por ahora el flujo de checkout no enruta vuelto a favor (siempre 0),
        // pero dejamos el campo para ventas futuras y abonos manuales.
        vueltoParaMonedero: 0,
        customerId:       selectedCustomerId || null,
        customerName:     selectedCustomer ? selectedCustomer.name : 'Consumidor Final',
        customerDocument: selectedCustomer?.documentId || null,
        customerPhone:    selectedCustomer?.phone      || null,
        fiadoUsd: fiadoAmountUsd,
        casheaUsd: casheaUsd
    };

    // FIN-008: deepFreeze en lugar de Object.freeze (congela items[] y payments[]).
    deepFreeze(sale);

    // FIN-007: withLock reemplaza navigator.locks.request directo (feature detection + fallback).
    const lockResult = await withLock('pos_write_lock', async () => {
        const existingSales = await storageService.getItem(SALES_KEY, []);
        const saleNumber = existingSales.reduce((mx, s) => Math.max(mx, s.saleNumber || 0), 0) + 1;
        // FIN-008: deep-freeze el sale persistido final.
        const finalPersistedSale = deepFreeze({ ...sale, saleNumber });

        await storageService.setItem(SALES_KEY, [finalPersistedSale, ...existingSales]);

        // Audit log
        const user = useAuthStore.getState().usuarioActivo;
        const tipo = casheaUsd > 0 ? 'VENTA_CASHEA' : (fiadoAmountUsd > 0 ? 'VENTA_FIADA' : 'VENTA_COMPLETADA');
        logEvent('VENTA', tipo,
            `Venta #${saleNumber} - $${round2(cartTotalUsd)} - ${cart.length} items - ${selectedCustomer?.name || 'Consumidor Final'}`,
            user,
            { saleId: finalPersistedSale.id, total: cartTotalUsd, items: cart.length }
        );

        // ── Deducir stock con precisión ──
        // FIN-027-pattern: re-leer productos fresco aquí para evitar stale state.
        const freshProducts = await storageService.getItem(PRODUCTS_KEY, products);
        const allowNeg = localStorage.getItem('allow_negative_stock') === 'true';
        let negativeStockUsed = false;
        const negativeItems = [];

        const updatedProducts = freshProducts.map(p => {
            const cartItemsForThisProduct = cart.filter(i => (i._originalId || i.id) === p.id);
            if (cartItemsForThisProduct.length > 0) {
                const totalDeducted = cartItemsForThisProduct.reduce((sum, item) => {
                    if (item.isWeight)        return sumR(sum, item.qty);
                    if (item._mode === 'unit') return sumR(sum, divR(item.qty, item._unitsPerPackage || 1));
                    return sumR(sum, item.qty);
                }, 0);

                const newStock = subR(p.stock ?? 0, totalDeducted);
                // FIN-014: auditar uso de stock negativo (no mover el flag, solo loguear).
                if (newStock < 0 && allowNeg) {
                    negativeStockUsed = true;
                    negativeItems.push({ productId: p.id, name: p.name, stockBefore: p.stock ?? 0, deducted: totalDeducted, stockAfter: newStock });
                }
                return { ...p, stock: allowNeg ? newStock : Math.max(0, newStock) };
            }
            return p;
        });

        if (negativeStockUsed) {
            const user = useAuthStore.getState().usuarioActivo;
            logEvent('CONFIG', 'NEGATIVE_STOCK_USED',
                `Venta #${saleNumber} usó stock negativo en ${negativeItems.length} producto(s)`,
                user,
                { saleId: finalPersistedSale.id, items: negativeItems }
            );
        }

        // FIN-008: deep-freeze products antes de retornar.
        await storageService.setItem(PRODUCTS_KEY, updatedProducts);
        deepFreeze(updatedProducts);

        let updatedCustomer = null;
        let updatedCustomers = customers;

        if (selectedCustomer) {
            const amount_favor_used = sumR(normalizedPayments
                .filter(p => p.methodId === 'saldo_favor')
                .map(p => p.amountUsd));

            const deudaParaCliente = casheaUsd > 0 ? casheaUsd : fiadoAmountUsd;

            const transaccionOpts = {
                usaSaldoFavor:    amount_favor_used,
                esCredito:        deudaParaCliente > FINANCIAL_EPSILON.PAYMENT_ZERO,
                deudaGenerada:    deudaParaCliente,
                vueltoParaMonedero: 0,
                esCashea:         casheaUsd > 0
            };

            updatedCustomer  = procesarImpactoCliente(selectedCustomer, transaccionOpts);
            updatedCustomers = customers.map(c => c.id === selectedCustomer.id ? updatedCustomer : c);

            await storageService.setItem(CUSTOMERS_KEY, updatedCustomers);
            // FIN-008: deep-freeze customers antes de retornar.
            deepFreeze(updatedCustomers);
        }

        return {
            success: true,
            sale: finalPersistedSale,
            updatedProducts,
            updatedCustomers
        };
    });

    return lockResult;
}
