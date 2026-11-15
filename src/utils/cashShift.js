import { getLocalISODate } from './dateHelpers.js';

/**
 * Reglas comunes para identificar la caja abierta.
 *
 * La caja no se reinicia por cambio de fecha: permanece abierta hasta que
 * exista un cierre manual que marque sus movimientos como cajaCerrada.
 */
export const CASH_SHIFT_TYPES = new Set([
    'VENTA',
    'VENTA_FIADA',
    'VENTA_CASHEA',
    'COBRO_DEUDA',
    'COBRO_CASHEA',
    'PAGO_PROVEEDOR',
    'GASTO_INTERNO',
    'APERTURA_CAJA',
    'AVANCE_EFECTIVO',
    'APORTE_CAJA',
]);

function timestampMs(record) {
    const value = record?.timestamp ? new Date(record.timestamp).getTime() : NaN;
    return Number.isFinite(value) ? value : NaN;
}

export function findOpenCashShift(records = []) {
    return records
        .filter(record => record?.tipo === 'APERTURA_CAJA' && record.cajaCerrada !== true)
        .sort((left, right) => {
            const leftTime = timestampMs(left);
            const rightTime = timestampMs(right);
            if (!Number.isFinite(leftTime) && !Number.isFinite(rightTime)) return 0;
            if (!Number.isFinite(leftTime)) return 1;
            if (!Number.isFinite(rightTime)) return -1;
            return rightTime - leftTime;
        })[0] || null;
}

export function isRecordInOpenCashShift(record, opening) {
    if (!record || !opening || record.cajaCerrada === true) return false;
    if (record.id === opening.id) return true;

    const openingTime = timestampMs(opening);
    const recordTime = timestampMs(record);
    return Number.isFinite(openingTime)
        && Number.isFinite(recordTime)
        && recordTime >= openingTime;
}

/**
 * ¿Este movimiento mueve efectivo de la caja abierta? Es la misma regla que usa
 * el "Efectivo esperado" del Inicio y el cierre, para que el cobro (fondo en
 * gaveta) vea exactamente el mismo número (CAJA-FONDO-001).
 *
 * - Ignora anuladas, tipos que no son de caja y egresos marcados `afectaCaja: false`.
 * - Con caja abierta: todo lo del turno, aunque cruce la medianoche.
 * - Sin caja abierta: lo de hoy sin cerrar (comportamiento anterior).
 */
export function isShiftCashMovement(record, opening, today = getLocalISODate()) {
    if (!record || record.status === 'ANULADA') return false;
    if (!CASH_SHIFT_TYPES.has(record.tipo)) return false;
    if ((record.tipo === 'PAGO_PROVEEDOR' || record.tipo === 'GASTO_INTERNO') && record.afectaCaja === false) return false;
    if (opening) return isRecordInOpenCashShift(record, opening);
    const day = record.localDate
        || (record.timestamp ? getLocalISODate(new Date(record.timestamp)) : today);
    return day === today && record.cajaCerrada !== true;
}
