import { describe, expect, it } from 'vitest';
import { calcularEfectivoEsperado } from '../src/utils/cajaEsperada';

describe('calcularEfectivoEsperado', () => {
    it('suma efectivo y resta vuelto en USD y Bs', () => {
        const result = calcularEfectivoEsperado({
            efectivo_usd: { total: 20 },
            _vuelto_usd: { total: 3.5 },
            efectivo_bs: { total: 1000 },
            _vuelto_bs: { total: 150 },
        });

        expect(result.expectedUsd).toBe(16.5);
        expect(result.expectedBs).toBe(850);
        expect(result.expectedCop).toBe(0);
    });

    it('devuelve ceros cuando no hay movimientos de efectivo', () => {
        expect(calcularEfectivoEsperado({})).toEqual({ expectedUsd: 0, expectedBs: 0, expectedCop: 0 });
    });

    it('incluye el efectivo COP sin restar vuelto', () => {
        const result = calcularEfectivoEsperado({ efectivo_cop: { total: 45000 } });
        expect(result.expectedCop).toBe(45000);
    });
});
