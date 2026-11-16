/**
 * gastoInterno.js — Reglas puras de los «Gastos internos» (sin leer ni escribir datos).
 *
 * Nómina F0 (docs/plans/2026-11-14-plan-nomina-simple-bodega.md): antes el registro
 * se armaba dentro del hook, sin redondeo y sin anotar quién lo hizo. Aquí queda una
 * sola fuente, que también usará la nómina.
 *
 * @module utils/gastoInterno
 */

import { round2, mulR, divR } from './dinero';

/** Métodos que sacan billetes de la gaveta. */
export const CASH_METHOD_IDS = new Set(['efectivo_usd', 'efectivo_bs', 'efectivo_cop']);

export function isCashMethodId(methodId) {
    return CASH_METHOD_IDS.has(String(methodId || ''));
}

/** Mensaje único cuando un egreso en efectivo llega sin caja abierta. */
export const CAJA_CERRADA_MSG = 'Abre la caja para registrar un egreso en efectivo.';

/** Mensaje cuando se intenta anular un pago de nómina desde la lista de gastos. */
export const PAYROLL_VOID_ELSEWHERE_MSG = 'Este gasto es de nómina: se anula desde Gestión › Nómina.';

function actorOf(usuario) {
    if (!usuario) return { actor: 'Sin sesión', actorId: null };
    return { actor: usuario.nombre || 'Sin nombre', actorId: usuario.id ?? null };
}

/**
 * Construye el registro `GASTO_INTERNO` (montos negativos, como siempre lo leyó el cierre).
 * Lanza Error con mensaje en español si los datos no sirven.
 */
export function buildGastoInternoRecord({
    description,
    category = 'otros',
    amountUsd = 0,
    amountBs = 0,
    methodId,
    currency = 'USD',
    note = '',
    bcvRate = 0,
    tasaCop = 0,
    copEnabled = false,
    usuario = null,
    afectaCaja = true,
    extra = {},
    now = new Date(),
    id = (globalThis.crypto?.randomUUID?.() ?? `gasto_${now.getTime()}`),
}) {
    const desc = String(description ?? '').trim();
    if (!desc) throw new Error('Escribe una descripción del gasto.');
    if (!methodId) throw new Error('Elige el método de pago.');
    if (!['USD', 'BS', 'COP'].includes(currency)) throw new Error('Moneda no válida.');

    const usdIn = Number(amountUsd) || 0;
    const bsIn = Number(amountBs) || 0;
    if (usdIn < 0 || bsIn < 0) throw new Error('El monto no puede ser negativo.');

    let totalUsd;
    let totalBs;
    let totalCop;
    if (currency === 'USD') {
        totalUsd = round2(usdIn);
        totalBs = mulR(totalUsd, bcvRate);
        totalCop = mulR(totalUsd, tasaCop);
    } else if (currency === 'BS') {
        totalBs = round2(bsIn);
        totalUsd = bcvRate > 0 ? divR(totalBs, bcvRate) : 0;
        totalCop = mulR(totalUsd, tasaCop);
    } else {
        // COP: el formulario manda el monto en pesos dentro de `amountBs` (contrato histórico).
        totalCop = round2(bsIn);
        totalUsd = round2(usdIn);
        totalBs = mulR(totalUsd, bcvRate);
    }

    const principal = currency === 'USD' ? totalUsd : currency === 'BS' ? totalBs : totalCop;
    if (!(principal > 0)) throw new Error('Ingresa un monto mayor a cero.');

    const { actor, actorId } = actorOf(usuario);

    return {
        id,
        timestamp: now.toISOString(),
        tipo: 'GASTO_INTERNO',
        cajaCerrada: false,
        afectaCaja: afectaCaja !== false,
        description: desc,
        category: category || 'otros',
        note: String(note ?? '').trim(),
        rate: bcvRate || undefined,
        totalBs: -totalBs,
        totalUsd: -totalUsd,
        ...(copEnabled && { totalCop: -totalCop, tasaCop }),
        paymentMethod: methodId,
        payments: [{
            methodId,
            amountUsd: currency === 'USD' ? -totalUsd : 0,
            amountBs: currency === 'BS' ? -totalBs : 0,
            ...(copEnabled && { amountCop: currency === 'COP' ? -totalCop : 0 }),
            currency,
            methodLabel: extra.methodLabel || 'Gasto Interno',
        }],
        items: [{
            name: `${extra.itemPrefix || 'Gasto'}: ${desc}`,
            qty: 1,
            priceUsd: -totalUsd,
            costBs: 0,
        }],
        actor,
        actorId,
        ...Object.fromEntries(Object.entries(extra).filter(([k]) => k !== 'methodLabel' && k !== 'itemPrefix')),
    };
}

/** ¿El egreso exige caja abierta? Solo si saca efectivo de la gaveta. */
export function requiresOpenCash(record) {
    return record?.afectaCaja !== false && isCashMethodId(record?.paymentMethod);
}

/**
 * ¿Se puede anular este gasto desde la lista de Gastos internos?
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function canVoidGastoFromList(gasto) {
    if (!gasto) return { ok: false, reason: 'No se encontró el gasto.' };
    if (gasto.status === 'ANULADA') return { ok: false, reason: 'El gasto ya estaba anulado.' };
    if (gasto.cajaCerrada === true) return { ok: false, reason: 'El gasto pertenece a una caja ya cerrada.' };
    if (gasto.isPayroll === true) return { ok: false, reason: PAYROLL_VOID_ELSEWHERE_MSG };
    return { ok: true };
}
