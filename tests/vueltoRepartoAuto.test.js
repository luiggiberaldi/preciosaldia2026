// CASO-056: vuelto «En $ y Bs» — el otro campo se llena solo con lo que falta.
import { describe, it, expect } from 'vitest';
import { restoEnLaOtra, completarCampo, otroEsAutomatico } from '../src/components/Sales/CheckoutModalPOS/parts/changeReparto';

const TASA = 911.62;

describe('restoEnLaOtra', () => {
    it('vuelto $7.68: escribo $5 → faltan Bs 2443.14 (el caso de la captura)', () => {
        expect(restoEnLaOtra('usd', '5', 7.68, TASA)).toBe('2443.14');
    });
    it('escribo los Bs → el resto sale en $', () => {
        expect(restoEnLaOtra('bs', '2443.14', 7.68, TASA)).toBe('5');
    });
    it('si cubro todo el vuelto, el otro queda vacío', () => {
        expect(restoEnLaOtra('usd', '7.68', 7.68, TASA)).toBe('');
        expect(restoEnLaOtra('usd', '9', 7.68, TASA)).toBe('');
    });
    it('campo vacío → todo el vuelto va al otro', () => {
        expect(restoEnLaOtra('usd', '', 7.68, TASA)).toBe('7001.24');
    });
    it('con tasa inválida no se rompe', () => {
        expect(restoEnLaOtra('bs', '1', 2, 0)).toBe('1');
    });
});

describe('completarCampo («⚡ Completar»)', () => {
    it('pone en Bs lo que falta tras los $ ya puestos', () => {
        expect(completarCampo('bs', '5', 7.68, TASA)).toBe('2443.14');
    });
    it('pone en $ lo que falta tras los Bs ya puestos', () => {
        expect(completarCampo('usd', '911.62', 7.68, TASA)).toBe('6.68');
    });
    it('si ya está repartido no hay nada que completar', () => {
        expect(completarCampo('usd', '7001.24', 7.68, TASA)).toBe('');
    });
});

describe('otroEsAutomatico', () => {
    it('vacío o en cero: se puede llenar solo', () => {
        expect(otroEsAutomatico('', null, 'bs')).toBe(true);
        expect(otroEsAutomatico('0', null, 'bs')).toBe(true);
    });
    it('lo llenó la app: se sigue recalculando', () => {
        expect(otroEsAutomatico('2443.14', 'bs', 'bs')).toBe(true);
    });
    it('lo escribió el cajero: no se toca', () => {
        expect(otroEsAutomatico('1000', null, 'bs')).toBe(false);
        expect(otroEsAutomatico('1000', 'usd', 'bs')).toBe(false);
    });
});
