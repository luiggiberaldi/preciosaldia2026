// COBRO fase 7 (copiada de Farmacia CASO-058, ajustada a Bodega): referencia de pago (últimos 4) en ticket, historial, cierre y aviso de repetida.
import { describe, it, expect } from 'vitest';
import { refSuffix, refParen, paymentHasRef, findDuplicateRef, collectPaymentRefs, localDayKey, nextDuplicateWarning } from '../src/utils/paymentReference';
import { FACTORY_PAYMENT_METHODS, normalizeRefMode } from '../src/config/paymentMethods';

const hoy = new Date(2026, 10, 13, 9, 30);
const ayer = new Date(2026, 10, 12, 9, 30);
const venta = (id, saleNumber, ts, payments, extra = {}) => ({ id, saleNumber, timestamp: ts.toISOString(), payments, ...extra });

describe('refSuffix y búsqueda', () => {
    it('agrega « · Ref. 1234» solo si hay referencia', () => {
        expect(refSuffix({ referencia: '1234' })).toBe(' · Ref. 1234');
        expect(refSuffix({ referencia: '' })).toBe('');
        expect(refSuffix({})).toBe('');
        expect(refSuffix({ referencia: '1234' }, ' ')).toBe(' Ref. 1234');
    });
    it('encuentra el pago por su referencia', () => {
        expect(paymentHasRef({ referencia: 'AB12' }, 'ab1')).toBe(true);
        expect(paymentHasRef({ referencia: '1234' }, '99')).toBe(false);
        expect(paymentHasRef({}, '12')).toBe(false);
    });
});

describe('findDuplicateRef (aviso de referencia repetida)', () => {
    const ventas = [
        venta('a', 1, hoy, [{ methodId: 'pago_movil', referencia: '1234' }]),
        venta('b', 2, ayer, [{ methodId: 'pago_movil', referencia: '5555' }]),
        venta('c', 3, hoy, [{ methodId: 'zelle', referencia: '7777' }], { status: 'ANULADA' }),
    ];
    const dia = localDayKey(hoy);
    it('avisa si el mismo método y referencia ya se usaron hoy', () => {
        expect(findDuplicateRef(ventas, 'pago_movil', '1234', dia)?.id).toBe('a');
    });
    it('no avisa si es otro método, otro día o una venta anulada', () => {
        expect(findDuplicateRef(ventas, 'zelle', '1234', dia)).toBeNull();
        expect(findDuplicateRef(ventas, 'pago_movil', '5555', dia)).toBeNull();
        expect(findDuplicateRef(ventas, 'zelle', '7777', dia)).toBeNull();
    });
});

describe('collectPaymentRefs (sección del cierre)', () => {
    it('una fila por pago con referencia, por método y hora, y marca las repetidas', () => {
        const filas = collectPaymentRefs([
            venta('a', 1, hoy, [{ methodId: 'pago_movil', methodLabel: 'Pago Móvil', referencia: '1234', currency: 'BS', amountBs: 100 }]),
            venta('b', 2, hoy, [{ methodId: 'zelle', methodLabel: 'Zelle', referencia: 'ab12', currency: 'USD', amountUsd: 5 }, { methodId: 'efectivo_usd', currency: 'USD', amountUsd: 1 }]),
            venta('c', 3, hoy, [{ methodId: 'pago_movil', methodLabel: 'Pago Móvil', referencia: '1234', currency: 'BS', amountBs: 50 }]),
            venta('d', 4, hoy, [{ methodId: 'pago_movil', methodLabel: 'Pago Móvil', referencia: '9999', currency: 'BS', amountBs: 10 }], { status: 'ANULADA' }),
        ]);
        expect(filas.map(f => [f.metodo, f.referencia, f.repetida])).toEqual([
            ['Pago Móvil', '1234', true],
            ['Pago Móvil', '1234', true],
            ['Zelle', 'AB12', false],
        ]);
        expect(filas[0].venta).toBe('#0000001');
        expect(filas[2]).toMatchObject({ moneda: 'USD', monto: 5 });
    });
});

describe('Modo de referencia de los métodos de fábrica', () => {
    const modo = (id) => FACTORY_PAYMENT_METHODS.find(m => m.id === id)?.refMode || 'none';
    it('de fábrica ningún método pide referencia (decisión del dueño, 2026-11-14)', () => {
        expect(FACTORY_PAYMENT_METHODS.map(m => modo(m.id)).every(x => x === 'none')).toBe(true);
    });
    it('Bodega no trae Zelle ni Binance de fábrica (decisión del dueño, 2026-11-14)', () => {
        expect(FACTORY_PAYMENT_METHODS.some(m => m.id === 'zelle' || m.id === 'binance')).toBe(false);
    });
    it('un modo desconocido se trata como «no pide»', () => {
        expect(normalizeRefMode('x')).toBe('none');
        expect(normalizeRefMode('optional')).toBe('optional');
    });
});

describe('ERR-110: dos referencias repetidas en la misma venta', () => {
    const ventas = [
        venta('a', 1, hoy, [{ methodId: 'pago_movil', referencia: '1234' }]),
        venta('b', 2, hoy, [{ methodId: 'punto_venta', referencia: '5678' }]),
    ];
    const metodos = [{ id: 'pago_movil', nombre: 'Pago Móvil' }, { id: 'punto_venta', nombre: 'Punto de Venta' }];
    const refs = { pago_movil: '1234', punto_venta: '5678' };
    it('avisa de cada una una sola vez y luego deja cobrar', () => {
        const avisadas = new Set();
        const dia = localDayKey(hoy);
        const toque = () => {
            const r = nextDuplicateWarning(metodos, refs, ventas, dia, avisadas);
            if (r) avisadas.add(r.clave);
            return r?.metodo.id ?? 'cobra';
        };
        expect([toque(), toque(), toque(), toque()]).toEqual(['pago_movil', 'punto_venta', 'cobra', 'cobra']);
    });
    it('referencias incompletas o sin repetir no avisan', () => {
        expect(nextDuplicateWarning(metodos, { pago_movil: '123' }, ventas, localDayKey(hoy), new Set())).toBeNull();
        expect(nextDuplicateWarning(metodos, { pago_movil: '9999' }, ventas, localDayKey(hoy), new Set())).toBeNull();
    });
});

describe('ERR-112: referencia en el recibo y WhatsApp', () => {
    it('va entre paréntesis, antes de los dos puntos', () => {
        expect(`Pago Móvil${refParen({ referencia: '1234' })}:`).toBe('Pago Móvil (Ref. 1234):');
        expect(refParen({})).toBe('');
    });
});
