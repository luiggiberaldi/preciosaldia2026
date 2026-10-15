import { describe, expect, it } from 'vitest';
import { findOpenCashShift, isRecordInOpenCashShift } from '../src/utils/cashShift.js';

describe('cash shift lifecycle', () => {
    it('mantiene abierta la caja después de medianoche', () => {
        const opening = {
            id: 'opening-1',
            tipo: 'APERTURA_CAJA',
            timestamp: '2026-10-14T23:58:00.000Z',
            cajaCerrada: false,
        };

        expect(findOpenCashShift([opening])).toEqual(opening);
        expect(isRecordInOpenCashShift({
            id: 'sale-1',
            tipo: 'VENTA',
            timestamp: '2026-10-15T00:04:00.000Z',
            cajaCerrada: false,
        }, opening)).toBe(true);
    });

    it('solo deja de considerar activa la caja después de un cierre manual', () => {
        const closedOpening = {
            id: 'opening-closed',
            tipo: 'APERTURA_CAJA',
            timestamp: '2026-10-14T23:58:00.000Z',
            cajaCerrada: true,
            cierreId: 123,
        };
        const openOpening = {
            id: 'opening-open',
            tipo: 'APERTURA_CAJA',
            timestamp: '2026-10-15T08:00:00.000Z',
            cajaCerrada: false,
        };

        expect(findOpenCashShift([closedOpening, openOpening])).toEqual(openOpening);
        expect(isRecordInOpenCashShift({
            id: 'sale-closed',
            tipo: 'VENTA',
            timestamp: '2026-10-15T00:04:00.000Z',
            cajaCerrada: true,
        }, openOpening)).toBe(false);
    });
});
