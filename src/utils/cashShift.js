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
