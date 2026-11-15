/**
 * customerBalanceText.js — Textos cortos de la cuenta del cliente (F7 del
 * PLAN-FIXEO-CLIENTES-BILLETERA). Funciones puras, sin React.
 *
 * Decisión D3: la cuenta se lleva en dólares; los Bs son solo referencia a la
 * tasa del día (cambian si cambia la tasa).
 */
import { round2, mulR, sumR, subR } from './dinero.js';
import { formatUsd, formatBs } from './calculatorUtils.js';
import { fiadoCoveredByCredit } from './receivablesReport.js';

const isInternalCreditPayment = (p) => p && (p.methodId === 'saldo_favor' || p.isInternalCredit === true || p.currency === 'INTERNAL_CREDIT');

/**
 * «Debe $5.00 · Bs 200,00» / «Favor $3.00 · Bs 120,00» / null si está al día.
 * @returns {null | { text: string, tone: 'debt' | 'credit' }}
 */
export function customerBalanceChip(customer, rate = 0) {
    const deuda = round2(Number(customer?.deuda) || 0);
    const favor = round2(Number(customer?.favor) || 0);
    if (deuda <= 0.01 && favor <= 0.01) return null;
    const isDebt = deuda > 0.01;
    const usd = isDebt ? deuda : favor;
    const bs = rate > 0 ? ` · Bs ${formatBs(round2(mulR(usd, rate)))}` : '';
    return { text: `${isDebt ? 'Debe' : 'Favor'} $${formatUsd(usd)}${bs}`, tone: isDebt ? 'debt' : 'credit' };
}

/**
 * Notas de cartera de una venta para el historial del cliente, en español
 * sencillo. Las de vuelto acreditado y sobrante de abono ya las pinta la vista;
 * aquí van las que faltaban en pantalla.
 * @returns {Array<{ key: string, text: string }>}
 */
export function saleWalletNotes(sale) {
    if (!sale) return [];
    const notes = [];
    const usadoUsd = round2(sumR((Array.isArray(sale.payments) ? sale.payments : [])
        .filter(isInternalCreditPayment)
        .map(p => Number(p.amountUsd) || 0)));
    if (usadoUsd > 0) notes.push({ key: 'saldo_usado', text: `Pagó con su saldo a favor: −$${formatUsd(usadoUsd)}` });

    if (sale.tipo === 'VENTA_FIADA') {
        const fiadoUsd = round2(Number(sale.fiadoUsd != null ? sale.fiadoUsd : sale.totalUsd) || 0);
        const pagadoUsd = round2(Math.max(0, subR(Number(sale.totalUsd) || 0, fiadoUsd)));
        if (pagadoUsd > 0.004 && fiadoUsd > 0) {
            notes.push({ key: 'fiado_parcial', text: `Pagó $${formatUsd(pagadoUsd)} · fió $${formatUsd(fiadoUsd)}` });
        }
        const cubiertoUsd = fiadoCoveredByCredit(sale, fiadoUsd);
        if (cubiertoUsd > 0) {
            notes.push({
                key: 'fiado_cubierto',
                text: cubiertoUsd >= fiadoUsd - 0.004
                    ? `El fiado lo cubrió su saldo a favor ($${formatUsd(cubiertoUsd)}): la deuda no subió`
                    : `$${formatUsd(cubiertoUsd)} del fiado los cubrió su saldo a favor`,
            });
        }
    }
    return notes;
}
