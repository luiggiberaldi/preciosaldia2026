import { describe, it, expect } from 'vitest';
import { productInitials } from '../src/utils/productInitials';

describe('productInitials', () => {
    it('dos palabras', () => expect(productInitials('Mayonesa Kraft 175 GR')).toBe('MK'));
    it('una palabra', () => expect(productInitials('chicharrin')).toBe('CH'));
    it('ignora signos sueltos', () => expect(productInitials('- Sal  Bahía')).toBe('SB'));
    it('vacío', () => expect(productInitials('')).toBe('?'));
});
