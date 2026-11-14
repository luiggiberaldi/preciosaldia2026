// CASO-056 fase 3: teclado numérico propio del cobro y detector táctil.
import { describe, it, expect } from 'vitest';
import { applyKey } from '../src/components/Sales/CheckoutModalPOS/parts/keypadInput';
import { resolveTouch, setTouchMode, getTouchMode, TOUCH_MODE_KEY, TOUCH_MODE_EVENT } from '../src/hooks/useCoarsePointer';

const type = (keys, start = '') => keys.reduce((acc, k) => applyKey(acc, k), start);

describe('applyKey (teclado numérico del cobro)', () => {
    it('escribe números en orden', () => {
        expect(type(['1', '2', '3'])).toBe('123');
    });

    it('la coma pone un solo punto y antepone 0 si está vacío', () => {
        expect(type(['.', '5'])).toBe('0.5');
        expect(type(['6', '.', '7', '.', '3'])).toBe('6.73');
    });

    it('no deja más de 2 decimales', () => {
        expect(type(['1', '.', '2', '3', '4'])).toBe('1.23');
    });

    it('no deja más de 9 enteros', () => {
        expect(type('1234567890'.split(''))).toBe('123456789');
    });

    it('un 0 solo se reemplaza por el siguiente número', () => {
        expect(type(['0', '5'])).toBe('5');
        expect(type(['0', '.', '5'])).toBe('0.5');
    });

    it('⌫ borra el último y Borrar deja vacío', () => {
        expect(applyKey('6.73', 'back')).toBe('6.7');
        expect(applyKey('', 'back')).toBe('');
        expect(applyKey('6.73', 'clear')).toBe('');
    });

    it('acepta el valor guardado como número (pagos de «Completar» o $10)', () => {
        expect(applyKey(10, '5')).toBe('105');
        expect(applyKey(undefined, '7')).toBe('7');
    });

    it('ignora teclas desconocidas', () => {
        expect(applyKey('12', 'x')).toBe('12');
    });
});

describe('resolveTouch (¿pantalla táctil?)', () => {
    it('automático sigue lo que dice el navegador', () => {
        expect(resolveTouch('auto', true)).toBe(true);
        expect(resolveTouch('auto', false)).toBe(false);
    });

    it('«on» y «off» mandan sobre el navegador', () => {
        expect(resolveTouch('on', false)).toBe(true);
        expect(resolveTouch('off', true)).toBe(false);
    });
});

describe('setTouchMode (Ajustes → Ventas → Teclado numérico)', () => {
    it('guarda «on» y «off», y «Automático» borra el ajuste', () => {
        expect(setTouchMode('on')).toBe('on');
        expect(localStorage.getItem(TOUCH_MODE_KEY)).toBe('on');
        expect(setTouchMode('off')).toBe('off');
        expect(getTouchMode()).toBe('off');
        expect(setTouchMode('auto')).toBe('auto');
        expect(localStorage.getItem(TOUCH_MODE_KEY)).toBeNull();
        expect(getTouchMode()).toBe('auto');
    });
    it('un valor raro queda en automático', () => {
        expect(setTouchMode('x')).toBe('auto');
    });
    it('avisa a la pantalla abierta para que cambie sin recargar', () => {
        let avisos = 0;
        const oir = () => { avisos += 1; };
        window.addEventListener(TOUCH_MODE_EVENT, oir);
        setTouchMode('on');
        window.removeEventListener(TOUCH_MODE_EVENT, oir);
        setTouchMode('auto');
        expect(avisos).toBe(1);
    });
});
