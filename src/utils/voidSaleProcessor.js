import { storageService } from './storageService';
import { logEvent } from '../services/auditService';
import { useAuthStore } from '../hooks/store/useAuthStore';
import { divR, subR, sumR, round2 } from './dinero';
import { withLock } from './withLock';          // FIN-007: feature detection + fallback.
import { deepFreeze } from './deepFreeze';      // FIN-008: deep-freeze antes de retornar.

const SALES_KEY = 'bodega_sales_v1';
const CUSTOMERS_KEY = 'bodega_customers_v1';
const PRODUCTS_KEY = 'bodega_products_v1';

/**
 * Handles the logic of voiding a transaction, reverting stock, and reverting customer balances.
 *
 * FIN-001: void de COBRO_DEUDA revierte el impacto al cliente (deuda o favor).
 * FIN-007: usa withLock (no navigator.locks directo).
 * FIN-008: deep-freeza updatedProducts/updatedCustomers antes de retornar.
 * FIN-012: resta vueltoParaMonedero de favor al anular (si el sale lo registra).
 * FIN-027: re-lee bodega_products_v1 fresco dentro del lock (no usa currentProducts stale).
 * FIN-032: remueve console.log de producción (vía logEvent en su lugar).
 */
export async function processVoidSale(sale, currentSales, currentProducts) {
    if (!sale) throw new Error("Sale object is required to void.");
    if (sale.status === 'ANULADA') throw new Error("Esta venta ya fue anulada.");

    // FIN-007: withLock reemplaza navigator.locks.request directo.
    return withLock('pos_write_lock', async () => {
        // Re-read fresh sales from storage to prevent stale data
        const freshSales = await storageService.getItem(SALES_KEY, []);
        const freshSale = freshSales.find(s => s.id === sale.id);
        if (!freshSale || freshSale.status === 'ANULADA') throw new Error("Esta venta ya fue anulada.");

        // 1. Marcar venta como ANULADA
        const updatedSales = freshSales.map(s => {
            if (s.id === sale.id) return { ...s, status: 'ANULADA' };
            return s;
        });

        // 2. Revertir Stock
        // FIN-027: re-leer productos fresco dentro del lock en vez de usar currentProducts stale.
        const freshProducts = await storageService.getItem(PRODUCTS_KEY, currentProducts || []);
        let updatedProducts = freshProducts;
        if (sale.items && sale.items.length > 0) {
            updatedProducts = freshProducts.map(p => {
                // Un producto puede estar múltiples veces (como unidad y paquete)
                const itemsInSale = sale.items.filter(i => (i._originalId || i.id) === p.id);
                if (itemsInSale.length > 0) {
                    const totalToRestore = itemsInSale.reduce((sum, item) => {
                        if (item.isWeight) return sumR(sum, item.qty);
                        if (item._mode === 'unit') return sumR(sum, divR(item.qty, item._unitsPerPackage || 1));
                        return sumR(sum, item.qty);
                    }, 0);
                    return { ...p, stock: sumR(p.stock || 0, totalToRestore) };
                }
                return p;
            });
        }

        // 3. Revertir Deuda/Saldo a Favor del Cliente
        const savedCustomers = await storageService.getItem(CUSTOMERS_KEY, []);
        let updatedCustomers = savedCustomers;

        // FIN-001, FIN-012: Cantidades a revertir según tipo de venta.
        const fiadoAmountUsd = sale.fiadoUsd || (sale.tipo === 'VENTA_FIADA' ? sale.totalUsd : 0) || 0;
        const favorUsed = sumR((sale.payments?.filter(p => p.methodId === 'saldo_favor') || []).map(p => p.amountUsd));
        const vueltoParaMonedero = round2(sale.vueltoParaMonedero || 0);

        // FIN-001: Para COBRO_DEUDA, revertir el abono. Heurística:
        // - Si el cliente tiene favor >= cobroAmount, era un abono que dejó sobra → restar de favor.
        // - Si tiene favor pero < cobroAmount, parte era favor y parte deuda.
        // - Si no tiene favor, era un abono que redujo deuda → sumar a deuda.
        const isCobroDeuda = sale.tipo === 'COBRO_DEUDA';
        const cobroAmount = isCobroDeuda ? round2(sale.totalUsd || 0) : 0;

        // CASHEA: anular la VENTA cancela la cuenta por cobrar a Cashea;
        // anular la REMESA la vuelve a abrir. Sin esto, la casheaDeuda quedaba viva
        // para siempre tras anular la venta que la originó.
        const casheaVentaUsd  = sale.tipo === 'VENTA_CASHEA'  ? round2(sale.casheaUsd || 0) : 0;
        const casheaRemesaUsd = sale.tipo === 'COBRO_CASHEA' ? round2(sale.totalUsd || 0) : 0;

        const shouldTouchCustomer = sale.customerId
            && (fiadoAmountUsd > 0 || favorUsed > 0 || vueltoParaMonedero > 0 || cobroAmount > 0
                || casheaVentaUsd > 0 || casheaRemesaUsd > 0);

        if (shouldTouchCustomer) {
            updatedCustomers = savedCustomers.map(c => {
                if (c.id !== sale.customerId) return c;

                let newDeuda = round2(c.deuda || 0);
                let newFavor = round2(c.favor || 0);

                if (isCobroDeuda && cobroAmount > 0) {
                    // FIN-001: Revertir COBRO_DEUDA (abono). El abono original redujo deuda
                    // o sumó a favor; al anular, revertimos en la dirección opuesta.
                    if (newFavor >= cobroAmount) {
                        // Todo el abono estaba como favor → quitar de favor.
                        newFavor = subR(newFavor, cobroAmount);
                    } else if (newFavor > 0) {
                        // Parte favor, parte deuda.
                        const remaining = subR(cobroAmount, newFavor);
                        newFavor = 0;
                        newDeuda = sumR(newDeuda, remaining);
                    } else {
                        // Sin favor → el abono había reducido deuda, devolverla.
                        newDeuda = sumR(newDeuda, cobroAmount);
                    }
                } else {
                    // VENTA / VENTA_FIADA: revertir favor usado, fiado generado y vuelto digital.
                    if (favorUsed > 0) {
                        newFavor = sumR(newFavor, favorUsed);
                    }
                    if (fiadoAmountUsd > 0) {
                        newDeuda = subR(newDeuda, fiadoAmountUsd);
                    }
                    // FIN-012: revertir vuelto digital que quedó como favor.
                    if (vueltoParaMonedero > 0) {
                        newFavor = subR(newFavor, vueltoParaMonedero);
                    }
                }

                // CASHEA: se revierte fuera del if/else de arriba porque es un
                // bucket independiente de deuda/favor (contraparte distinta).
                let newCasheaDeuda = round2(c.casheaDeuda || 0);
                if (casheaVentaUsd > 0)  newCasheaDeuda = subR(newCasheaDeuda, casheaVentaUsd);
                if (casheaRemesaUsd > 0) newCasheaDeuda = sumR(newCasheaDeuda, casheaRemesaUsd);

                // Normalización: no permitir negativos.
                if (newDeuda < 0) newDeuda = 0;
                if (newFavor < 0) newFavor = 0;
                if (newCasheaDeuda < 0) newCasheaDeuda = 0;

                return { ...c, deuda: newDeuda, favor: newFavor, casheaDeuda: newCasheaDeuda };
            });
        }

        // 4. Guardar todo
        await storageService.setItem(SALES_KEY, updatedSales);
        await storageService.setItem(CUSTOMERS_KEY, updatedCustomers);
        await storageService.setItem(PRODUCTS_KEY, updatedProducts);

        // FIN-008: deep-freeze outputs antes de retornar (defensa contra mutaciones posteriores).
        deepFreeze(updatedProducts);
        deepFreeze(updatedCustomers);

        // FIN-032: era console.log — movido a logEvent para auditoría.
        const user = useAuthStore.getState().usuarioActivo;
        logEvent('VENTA', 'VENTA_ANULADA',
            `Venta #${sale.saleNumber || '?'} anulada - $${round2(sale.totalUsd || 0)}`,
            user,
            { saleId: sale.id, tipo: sale.tipo, totalUsd: sale.totalUsd }
        );

        return { updatedSales, updatedProducts, updatedCustomers };
    });
}
