/**
 * cajaAporte.js — Aporte de efectivo a la caja durante el turno.
 *
 * Funciones puras (sin I/O) para poder probarlas aisladamente.
 *
 * El aporte se guarda como registro `APORTE_CAJA` en el mismo listado de ventas
 * que la apertura. `FinancialEngine.calculatePaymentBreakdown` lo suma a los
 * buckets de efectivo (no a ingresos), así el cierre no marca faltante.
 *
 * @module utils/cajaAporte
 */

import { round2 } from './dinero';

export const APORTE_CAJA_TIPO = 'APORTE_CAJA';
const MOTIVO_MAX = 200;

/**
 * Valida y construye el registro de aporte. Lanza Error con mensaje en español
 * si los datos no son válidos.
 *
 * @param {{ aporteUsd?: number|string, aporteBs?: number|string, aporteCop?: number|string,
 *           motivo?: string, usuario?: { id?: string, nombre?: string } | null, now?: Date }} args
 * @returns {object} Registro APORTE_CAJA listo para guardar.
 */
export function buildAporteCajaRecord({ aporteUsd, aporteBs, aporteCop, motivo, usuario = null, now = new Date() }) {
    const usd = round2(Number(aporteUsd) || 0);
    const bs = round2(Number(aporteBs) || 0);
    const cop = round2(Number(aporteCop) || 0);

    if (usd < 0 || bs < 0 || cop < 0) {
        throw new Error('Los montos del aporte no pueden ser negativos.');
    }
    if (usd + bs + cop <= 0) {
        throw new Error('Ingresa un monto mayor a cero.');
    }
    const motivoTrim = String(motivo ?? '').trim();
    if (!motivoTrim) {
        throw new Error('Indica el motivo del aporte.');
    }

    return {
        id: `aporte_${now.getTime()}`,
        tipo: APORTE_CAJA_TIPO,
        aporteUsd: usd,
        aporteBs: bs,
        aporteCop: cop,
        motivo: motivoTrim.slice(0, MOTIVO_MAX),
        registradoPor: usuario?.nombre ?? 'Sin sesión',
        registradoPorId: usuario?.id ?? null,
        timestamp: now.toISOString(),
        cajaCerrada: false,
    };
}
