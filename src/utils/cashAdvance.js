/**
 * Avance de efectivo — ÚNICA fórmula de la línea de cesta, usada por la caja
 * (SalesView) y por las ventas remotas (monitor arma, caja re-arma y valida).
 *
 * El cliente recibe `montoEfectivo` en efectivo y paga `totalCobrado`
 * (efectivo + comisión) con otro método. El arqueo resta el efectivo entregado
 * y registra la comisión (FinancialEngine, `item.isCashAdvance`).
 */
import { round2, sumR } from './dinero.js';

export const CASH_ADVANCE_CURRENCIES = Object.freeze(['BS', 'USD']);
export const CASH_ADVANCE_MAX_PCT = 100;

/** Monto, comisión y total cobrado, redondeados como en el modal de la caja. */
export function computeCashAdvance({ montoEfectivo, comisionPct }) {
    const monto = round2(Number(montoEfectivo) || 0);
    const pct = Number(comisionPct) || 0;
    const montoComision = round2((monto * pct) / 100);
    return { montoEfectivo: monto, comisionPct: pct, montoComision, totalCobrado: round2(sumR([monto, montoComision])) };
}

/**
 * Producto sintético del avance (lo que recibe `addToCart`). El precio en USD
 * sale de la moneda del avance: en Bs se divide por la tasa y conserva el
 * monto exacto en Bs; en USD el total ya está en dólares.
 */
export function buildCashAdvanceProduct({ currency, montoEfectivo, comisionPct }, effectiveRate, id) {
    const isBs = currency === 'BS';
    const advance = computeCashAdvance({ montoEfectivo, comisionPct });
    const rate = Number(effectiveRate) || 0;
    return {
        id,
        name: `Avance Efectivo (${isBs ? 'BS' : 'USD'})`,
        priceUsdt: isBs ? (rate > 0 ? advance.totalCobrado / rate : 0) : advance.totalCobrado,
        exactBs: isBs ? advance.totalCobrado : null,
        costBs: 0,
        costUsd: 0,
        unit: 'servicio',
        category: 'otros',
        stock: 9999,
        isCashAdvance: true,
        montoEfectivo: advance.montoEfectivo,
        montoComision: advance.montoComision,
        comisionPct: advance.comisionPct,
        currency: isBs ? 'BS' : 'USD',
    };
}

/** Línea de cesta del avance (mismos campos que deja `addToCart`). */
export function buildCashAdvanceCartLine(advance, effectiveRate, id) {
    const product = buildCashAdvanceProduct(advance, effectiveRate, id);
    return {
        ...product,
        priceUsd: product.priceUsdt,
        priceCop: null,
        qty: 1,
        isWeight: false,
        _originalId: id,
        _mode: 'package',
        _unitsPerPackage: 1,
    };
}
