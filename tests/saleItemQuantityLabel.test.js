// BULTOS-001: las líneas de venta se etiquetan según el MODO DE VENTA real —
// un bulto de 12 ya no se pinta como "1 u". Regla: bulto (packagingType 'lote'
// o unit 'paquete' con uPP > 1, modo 'package') → "1 bulto · 12 uds";
// unidad suelta (_mode 'unit') o producto suelto → "1 ud(s)"; granel → kg/g.
import { describe, it, expect } from 'vitest';
import { formatSaleItemQuantity, formatSaleQuantity, formatPresentationLabel } from '../src/utils/granel';

const bultoItem = {
    id: 'p1',
    name: 'Mayonesa Kraft 175gr',
    packagingType: 'lote',
    unit: 'paquete',
    unitsPerPackage: 12,
    _unitsPerPackage: 12,
    _mode: 'package',
    qty: 1,
};

describe('formatSaleItemQuantity — bulto vs unidad', () => {
    it('d1: 1 bulto de 12 → "1 bulto · 12 uds" (la línea de recibo/ticket)', () => {
        expect(formatSaleItemQuantity(bultoItem)).toBe('1 bulto · 12 uds');
    });

    it('d2: variante corta para chips compactos → "1 bulto"', () => {
        expect(formatSaleItemQuantity(bultoItem, undefined, { short: true })).toBe('1 bulto');
    });

    it('d3: pluraliza bultos y muestra la equivalencia total', () => {
        expect(formatSaleItemQuantity({ ...bultoItem, qty: 2 })).toBe('2 bultos · 24 uds');
    });

    it('d4: unidad suelta de un producto de bulto → "ud", nunca "bulto"', () => {
        expect(formatSaleItemQuantity({ ...bultoItem, _mode: 'unit', qty: 1 })).toBe('1 ud');
        expect(formatSaleItemQuantity({ ...bultoItem, _mode: 'unit', qty: 3 })).toBe('3 uds');
    });

    it('d5: producto suelto con uPP conservado NO se etiqueta como bulto', () => {
        const suelto = {
            id: 'p2',
            name: 'Golosina suelta',
            packagingType: 'suelto',
            unit: 'unidad',
            unitsPerPackage: 12,
            _unitsPerPackage: 12,
            _mode: 'package',
            qty: 2,
        };
        expect(formatSaleItemQuantity(suelto)).toBe('2 uds');
    });

    it('d6: item histórico sin _mode pero de bulto → bulto con equivalencia', () => {
        const legacy = { id: 'p3', unit: 'paquete', unitsPerPackage: 6, qty: 1 };
        expect(formatSaleItemQuantity(legacy)).toBe('1 bulto · 6 uds');
    });

    it('d7: venta libre / item sin datos de producto → "uds"', () => {
        expect(formatSaleItemQuantity({ id: 'custom_1', name: 'Venta libre', qty: 3 })).toBe('3 uds');
    });

    it('d8: granel conserva su formato kg/g (sin cambios)', () => {
        const granel = { id: 'p4', unit: 'kg', granelUnit: 'kg', packagingType: 'granel', qty: 0.35 };
        expect(formatSaleItemQuantity(granel, 'gr_ml')).toBe('350 g');
        expect(formatSaleItemQuantity(granel, 'kg_lt')).toBe('0.35 kg');
    });

    it('d9: el alias formatSaleQuantity comparte el comportamiento', () => {
        expect(formatSaleQuantity(bultoItem)).toBe('1 bulto · 12 uds');
    });

    it('d10: item histórico sin _mode con id sufijado "_unit" → unidad suelta', () => {
        const legacyUnit = { id: 'p1_unit', name: 'Mayonesa (Ud.)', unit: 'paquete', packagingType: 'lote', qty: 1 };
        expect(formatSaleItemQuantity(legacyUnit)).toBe('1 ud');
    });

    it('d11: bulto histórico sin factor conocido → "1 bulto" (sin equivalencia, nunca "ud")', () => {
        const legacyBulto = { id: 'p1', name: 'Mayonesa', unit: 'paquete', packagingType: 'lote', qty: 1 };
        expect(formatSaleItemQuantity(legacyBulto)).toBe('1 bulto');
        expect(formatSaleItemQuantity({ ...legacyBulto, qty: 3 })).toBe('3 bultos');
        expect(formatSaleItemQuantity(legacyBulto, undefined, { short: true })).toBe('1 bulto');
    });
});

describe('formatPresentationLabel — badge de presentación', () => {
    it('d12: producto de bulto → "Bulto · 12 uds"', () => {
        expect(formatPresentationLabel(bultoItem)).toBe('Bulto · 12 uds');
        // Un producto del catálogo (sin _mode) muestra el mismo badge.
        expect(formatPresentationLabel({ unit: 'paquete', unitsPerPackage: 12 })).toBe('Bulto · 12 uds');
    });

    it('d13: línea de unidad suelta no muestra badge redundante (solo aplica cuando es bulto)', () => {
        expect(formatPresentationLabel({ ...bultoItem, _mode: 'unit', qty: 1 })).toBeNull();
    });

    it('d14: granel, suelto y factor desconocido no llevan badge', () => {
        expect(formatPresentationLabel({ unit: 'kg', packagingType: 'granel', unitsPerPackage: 1 })).toBeNull();
        expect(formatPresentationLabel({ unit: 'unidad', packagingType: 'suelto', unitsPerPackage: 12 })).toBeNull();
        expect(formatPresentationLabel({ unit: 'paquete', packagingType: 'lote' })).toBeNull();
        expect(formatPresentationLabel(null)).toBeNull();
    });
});
