import { describe, it, expect } from 'vitest';
import { formatRateStamp } from '../src/utils/rateStamp';

describe('formatRateStamp', () => {
    const now = new Date(2026, 10, 13, 23, 30);
    it('hoy', () => expect(formatRateStamp(new Date(2026, 10, 13, 9, 5), now)).toMatch(/^hoy 9:05/));
    it('ayer', () => expect(formatRateStamp(new Date(2026, 10, 12, 16, 30), now)).toMatch(/^ayer 4:30/));
    it('fecha vieja lleva día y mes', () => expect(formatRateStamp(new Date(2026, 10, 3, 9, 0), now)).toMatch(/^0?3\/11 9:00/));
    it('vacío o inválido no muestra nada', () => {
        expect(formatRateStamp(null, now)).toBe('');
        expect(formatRateStamp('no-es-fecha', now)).toBe('');
    });
});
