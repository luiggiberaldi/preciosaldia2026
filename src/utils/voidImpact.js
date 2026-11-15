/**
 * voidImpact.js — Vista previa de lo que una anulación le hace a la cuenta del
 * cliente (F3 del PLAN-FIXEO-CLIENTES-BILLETERA, decisión D4).
 *
 * Anular siempre se permite; este módulo solo explica el resultado ANTES de
 * confirmar, con la misma regla que `processVoidSale` (`buildVoidReversalMovements`).
 * El caso que motivó el aviso: anular una venta cuyo vuelto a la billetera ya
 * se gastó deja al cliente debiendo lo gastado, y el cajero no lo sabía.
 *
 * Funciones puras: sin React ni storage.
 */
import { round2, sumR, mulR } from './dinero.js';
import { getCustomerBalance, normalizeCustomer } from './customerLedger.js';
import { buildVoidReversalMovements } from './voidSaleProcessor.js';

const COLLECTION_TYPES = new Set(['COBRO_DEUDA']);

/**
 * @returns {null | { customerName: string, antesUsd: number, despuesUsd: number,
 *   cambioUsd: number, quedaDebiendoUsd: number }}
 *   null si la venta no tiene cliente o la anulación no mueve su cuenta.
 */
export function previewVoidCustomerImpact(sale, customer, ledger) {
    if (!sale || !sale.customerId || !customer) return null;
    const movements = buildVoidReversalMovements(sale, ledger);
    if (!movements.length) return null;
    const cambioUsd = round2(sumR(movements.map(m => (m.direction === 'DEBIT' ? -1 : 1) * (Number(m.amountUsd) || 0))));
    if (Math.abs(cambioUsd) < 0.005) return null;
    const antesUsd = getCustomerBalance(normalizeCustomer(customer));
    const despuesUsd = round2(antesUsd + cambioUsd);
    // Deuda NUEVA que crea la anulación (no la que ya tenía).
    const deudaAntes = Math.max(0, -antesUsd);
    const deudaDespues = Math.max(0, -despuesUsd);
    return {
        customerName: customer.name || sale.customerName || 'el cliente',
        antesUsd,
        despuesUsd,
        cambioUsd,
        quedaDebiendoUsd: round2(Math.max(0, deudaDespues - deudaAntes)),
        esAbono: COLLECTION_TYPES.has(sale.tipo),
    };
}

const fmtUsd = (v) => `$${Math.abs(round2(v)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtBs = (v) => `Bs ${Math.abs(v).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** «debe $5,00» / «$3,00 a favor» / «al día» */
export function describeBalance(usd) {
    if (usd < -0.004) return `debe ${fmtUsd(usd)}`;
    if (usd > 0.004) return `${fmtUsd(usd)} a favor`;
    return 'al día';
}

/**
 * Líneas extra para el mensaje de confirmación de la anulación.
 * @returns {string[]}
 */
export function describeVoidImpact(impact, rate = 0) {
    if (!impact) return [];
    const lines = [`Cuenta de ${impact.customerName}: ${describeBalance(impact.antesUsd)} → ${describeBalance(impact.despuesUsd)}.`];
    if (impact.quedaDebiendoUsd > 0.004) {
        const bs = rate > 0 ? ` (${fmtBs(round2(mulR(impact.quedaDebiendoUsd, rate)))})` : '';
        lines.push(impact.esAbono
            ? `⚠ Se borra el abono: la deuda sube ${fmtUsd(impact.quedaDebiendoUsd)}${bs}.`
            : `⚠ El cliente quedará debiendo ${fmtUsd(impact.quedaDebiendoUsd)}${bs}: ya usó el saldo a favor que le dio esta venta.`);
    }
    return lines;
}
