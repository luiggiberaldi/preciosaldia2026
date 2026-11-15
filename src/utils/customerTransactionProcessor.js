import { storageService } from './storageService.js';
import { divR, mulR, round2, sumR } from './dinero.js';
import { withLock } from './withLock.js';
import { deepFreeze } from './deepFreeze.js';
import { CurrencyService } from '../services/CurrencyService.js';
import { useAuthStore } from '../hooks/store/useAuthStore.js';
import { applyCustomerMovementsWithinLock } from '../services/customerWalletService.js';
import { CUSTOMER_MOVEMENT_TYPES, normalizeCustomer } from './customerLedger.js';

const SALES_KEY = 'bodega_sales_v1';
const CUSTOMERS_KEY = 'bodega_customers_v1';

export async function processCustomerTransaction({
    transactionAmount,
    currencyMode,
    type,
    customer,
    paymentMethod,
    bcvRate,
    tasaCop,
    copEnabled,
    // F5 (abono mixto): [{ currency: 'USD'|'BS'|'COP', amount, methodId }]. Solo
    // para ABONO; si viene, reemplaza a transactionAmount/currencyMode/paymentMethod.
    payments: mixedPayments = null,
}) {
    const toUsd = (raw, currency) => {
        if (currency === 'BS') {
            if (!bcvRate || bcvRate <= 0) return { error: 'Tasa BCV no configurada' };
            return { usd: divR(raw, bcvRate) };
        }
        if (currency === 'COP') {
            if (!tasaCop || tasaCop <= 0) return { error: 'Tasa COP no configurada' };
            return { usd: divR(raw, tasaCop) };
        }
        return { usd: round2(raw) };
    };

    // Partes del pago: una sola (lo de siempre) o varias (abono mixto).
    let parts;
    if (type === 'ABONO' && Array.isArray(mixedPayments) && mixedPayments.length > 0) {
        parts = [];
        for (const p of mixedPayments) {
            const raw = CurrencyService.safeParse(p?.amount);
            if (!Number.isFinite(raw) || raw <= 0) continue;
            const currency = p.currency === 'BS' || p.currency === 'COP' ? p.currency : 'USD';
            const conv = toUsd(raw, currency);
            if (conv.error) return { error: conv.error };
            parts.push({ currency, raw, methodId: p.methodId || (currency === 'BS' ? 'efectivo_bs' : currency === 'COP' ? 'efectivo_cop' : 'efectivo_usd'), amountUsd: conv.usd });
        }
        if (parts.length === 0) return { error: 'Monto inválido' };
    } else {
        const raw = CurrencyService.safeParse(transactionAmount);
        if (!Number.isFinite(raw) || raw <= 0) return { error: 'Monto inválido' };
        const conv = toUsd(raw, currencyMode);
        if (conv.error) return { error: conv.error };
        parts = [{ currency: currencyMode, raw, methodId: paymentMethod, amountUsd: conv.usd }];
    }
    const amountUsd = parts.length > 1 ? round2(sumR(parts.map(p => p.amountUsd))) : parts[0].amountUsd;
    const partBs = (p) => (p.currency === 'BS' ? p.raw : mulR(p.amountUsd, bcvRate));

    return withLock('pos_write_lock', async () => {
        const freshCustomers = await storageService.getItem(CUSTOMERS_KEY, []);
        const freshCustomer = freshCustomers.find(c => c.id === customer?.id) || customer;
        if (!freshCustomer) return { error: 'El cliente no existe o fue actualizado.' };
        const effectiveCustomers = freshCustomers.some(c => c.id === freshCustomer.id)
            ? freshCustomers
            : [freshCustomer, ...freshCustomers];
        const normalizedFreshCustomer = normalizeCustomer(freshCustomer);

        const sales = await storageService.getItem(SALES_KEY, []);
        const nextSaleNumber = sales.reduce((mx, s) => Math.max(mx, s.saleNumber || 0), 0) + 1;
        const saleId = crypto.randomUUID();
        const totalEnBs = parts.length > 1 ? round2(sumR(parts.map(partBs))) : partBs(parts[0]);
        const totalEnCop = parts.length === 1 && parts[0].currency === 'COP' ? parts[0].raw : mulR(amountUsd, tasaCop);
        const mainMethod = parts[0].methodId;
        const isPayment = type === 'ABONO';
        // Un abono mayor que la deuda liquida la deuda y convierte únicamente
        // el sobrante en saldo a favor. Se persiste explícitamente para que
        // ticket, reportes y anulación conozcan la intención sin confundirlo
        // con el vuelto de una venta de productos.
        const saldoFavorGeneradoUsd = isPayment
            ? Math.max(0, round2(amountUsd - (Number(normalizedFreshCustomer.deuda) || 0)))
            : 0;

        const record = isPayment
            ? {
                id: saleId,
                timestamp: new Date().toISOString(),
                tipo: 'COBRO_DEUDA',
                saleNumber: nextSaleNumber,
                rate: bcvRate,
                tasaCop: copEnabled ? tasaCop : 0,
                status: 'COMPLETADA',
                clienteId: freshCustomer.id,
                clienteName: freshCustomer.name,
                totalBs: totalEnBs,
                totalUsd: amountUsd,
                ...(copEnabled && { totalCop: totalEnCop }),
                paymentMethod: mainMethod,
                // Un pago por cada parte (una sola en el abono de siempre).
                payments: parts.map(p => ({
                    methodId: p.methodId,
                    amount: p.currency === 'USD' ? p.amountUsd : p.raw,
                    currency: p.currency,
                    amountUsd: p.amountUsd,
                    amountBs: parts.length > 1 ? round2(partBs(p)) : totalEnBs,
                    methodLabel: String(p.methodId).replace(/_/g, ' '),
                })),
                // El abono puede dejar saldo a favor, pero este campo histórico
                // representa vuelto de una venta y no debe duplicar el ledger.
                vueltoParaMonedero: 0,
                saldoFavorGeneradoUsd,
                customerId: freshCustomer.id,
                customerName: freshCustomer.name,
                items: [{ name: `Abono de deuda: ${freshCustomer.name}`, qty: 1, priceUsd: amountUsd, costBs: 0 }],
            }
            : {
                id: saleId,
                timestamp: new Date().toISOString(),
                tipo: 'VENTA_FIADA',
                saleNumber: nextSaleNumber,
                rate: bcvRate,
                tasaCop: copEnabled ? tasaCop : 0,
                status: 'COMPLETADA',
                clienteId: freshCustomer.id,
                clienteName: freshCustomer.name,
                totalBs: totalEnBs,
                totalUsd: amountUsd,
                ...(copEnabled && { totalCop: totalEnCop }),
                fiadoUsd: amountUsd,
                vueltoParaMonedero: 0,
                customerId: freshCustomer.id,
                customerName: freshCustomer.name,
                items: [{ name: `Crédito manual: ${freshCustomer.name}`, qty: 1, priceUsd: amountUsd, costBs: 0 }],
            };

        const walletResult = await applyCustomerMovementsWithinLock({
            customerId: freshCustomer.id,
            customers: effectiveCustomers,
            user: useAuthStore.getState().usuarioActivo,
            movements: [{
                type: isPayment ? CUSTOMER_MOVEMENT_TYPES.DEBT_PAYMENT : CUSTOMER_MOVEMENT_TYPES.CREDIT_SALE,
                direction: isPayment ? 'CREDIT' : 'DEBIT',
                amountUsd,
                sourceType: 'SALE',
                sourceId: `${saleId}:cartera`,
                sourceSaleId: saleId,
                paymentMethodId: isPayment ? mainMethod : null,
                reason: isPayment ? 'Abono de deuda' : 'Crédito manual',
            }],
        });

        await storageService.setItem(SALES_KEY, [record, ...sales]);
        deepFreeze(walletResult.updatedCustomers);
        return {
            updatedCustomer: walletResult.updatedCustomer,
            newCustomers: walletResult.updatedCustomers,
            sale: record,
        };
    });
}
