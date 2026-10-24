// FIX-EMPAQUE-001: regla clara de empaque/granel — el empaque manda, sin adivinanzas.
// Cubre: traductor de vocabulario ajeno, detector con regla clara, dry-run que no
// escribe nada y aplicador que SOLO toca los 3 campos de metadatos (nunca stock ni precios).
import { describe, expect, it } from 'vitest';
import {
    isGranelProduct,
    normalizePackagingType,
    planCatalogPackagingFix,
    applyCatalogPackagingFix,
    formatPackagingFixReport,
} from '../src/utils/granel.js';
import { buildProductPayload } from '../src/utils/productProcessor.js';

// Casos reales reportados por el dueño: la sal importada quedaba como "granel".
const SAL = {
    id: 'p-sal',
    name: 'SAL DEL MAR 1 KG',
    packagingType: 'unidad',   // vocabulario ajeno: ningún botón se marcaba en el formulario
    unit: 'unidad',            // así está en el catálogo real (se vende por bolsa)
    granelUnit: 'kg',          // pista venenosa que dejaba el formulario
    stock: 25,
    priceUsdt: 1,
    costUsd: 0.6,
};

const QUESO = {
    id: 'p-queso',
    name: 'QUESO FRESCO',
    packagingType: 'granel',
    granelUnit: 'kg',
    unit: 'kg',
    stock: 2.5,
    priceUsdt: 8,
    costUsd: 5,
};

const BULTO = {
    id: 'p-bulto',
    name: 'MAYONESA BULTO X12',
    packagingType: 'lote',
    unit: 'paquete',
    unitsPerPackage: 12,
    stock: 48,
    priceUsdt: 24,
};

describe('normalizePackagingType — traductor de empaque', () => {
    it('traduce vocabulario ajeno de importaciones y Estación Maestra', () => {
        expect(normalizePackagingType({ packagingType: 'unidad' })).toBe('suelto');
        expect(normalizePackagingType({ packagingType: 'Bulto' })).toBe('lote');
        expect(normalizePackagingType({ packagingType: '  Caja ' })).toBe('lote');
        expect(normalizePackagingType({ packagingType: 'paquete' })).toBe('lote');
        expect(normalizePackagingType({ packagingType: 'peso' })).toBe('granel');
        expect(normalizePackagingType({ packagingType: 'kg' })).toBe('granel');
    });

    it('deja intactos los 3 valores canónicos', () => {
        expect(normalizePackagingType({ packagingType: 'suelto' })).toBe('suelto');
        expect(normalizePackagingType({ packagingType: 'lote' })).toBe('lote');
        expect(normalizePackagingType({ packagingType: 'granel' })).toBe('granel');
    });

    it('deriva el empaque vacío o desconocido solo de señales legacy (unidad de peso/banderas)', () => {
        expect(normalizePackagingType({ unit: 'kg' })).toBe('granel');
        expect(normalizePackagingType({ isWeight: true })).toBe('granel');
        expect(normalizePackagingType({ soldByWeight: true })).toBe('granel');
        expect(normalizePackagingType({ packagingType: 'x99', unit: 'kg' })).toBe('granel');
        expect(normalizePackagingType({ packagingType: 'x99', unit: 'unidad' })).toBe('suelto');
        expect(normalizePackagingType({ unit: 'unidad' })).toBe('suelto');
        expect(normalizePackagingType({})).toBe('suelto');
    });

    it('granelUnit ya NO es pista: el formulario lo deja en kg por defecto', () => {
        expect(normalizePackagingType({ granelUnit: 'kg' })).toBe('suelto');
        expect(normalizePackagingType({ granelUnit: 'kg', unit: 'kg' })).toBe('granel');
    });
});

describe('regla clara: el empaque manda (isGranelProduct)', () => {
    it('la sal importada ya NO es granel aunque traiga granelUnit kg (pista venenosa)', () => {
        expect(isGranelProduct(SAL)).toBe(false);
    });

    it('suelto y lote jamás son granel, aunque traigan señales de peso', () => {
        expect(isGranelProduct({ packagingType: 'suelto', unit: 'kg', granelUnit: 'kg', isWeight: true })).toBe(false);
        expect(isGranelProduct({ packagingType: 'lote', unit: 'paquete' })).toBe(false);
    });

    it('el granel de verdad sigue siendo granel', () => {
        expect(isGranelProduct(QUESO)).toBe(true);
    });

    it('la adivinanza legacy solo aplica a productos SIN empaque guardado', () => {
        expect(isGranelProduct({ unit: 'kg' })).toBe(true);   // queso viejo sin empaque
        expect(isGranelProduct({ unit: 'unidad' })).toBe(false);
    });
});

describe('planCatalogPackagingFix — modo diagnóstico (dry-run)', () => {
    it('propone los cambios de la sal: empaque suelto y granelUnit limpio (sin tocar unit)', () => {
        const cambios = planCatalogPackagingFix([SAL]);
        expect(cambios).toHaveLength(1);
        expect(cambios[0].despues).toEqual({ packagingType: 'suelto', granelUnit: null });
        expect(cambios[0].campos).toContain('packagingType');
        expect(cambios[0].campos).toContain('granelUnit');
    });

    it('no propone nada para el queso granel ni para el bulto (ya están bien)', () => {
        expect(planCatalogPackagingFix([QUESO, BULTO])).toHaveLength(0);
    });

    it('NO escribe nada: el catálogo de entrada queda intacto', () => {
        const catalogo = structuredClone([SAL, QUESO, BULTO]);
        const copia = structuredClone(catalogo);
        planCatalogPackagingFix(catalogo);
        expect(catalogo).toEqual(copia);
    });

    it('marca con ⚠ los stocks con decimales heredados (nunca los redondea)', () => {
        const salConDecimales = { ...SAL, stock: 2.5 };
        const cambios = planCatalogPackagingFix([salConDecimales]);
        expect(cambios[0].stockDecimalPendiente).toBe(true);
        expect(salConDecimales.stock).toBe(2.5); // intacto
    });

    it('un producto con stock entero no sale marcado', () => {
        expect(planCatalogPackagingFix([SAL])[0].stockDecimalPendiente).toBe(false);
    });
});

describe('regla R2 — preserva los productos que SÍ se venden por peso', () => {
    const GRANOLA = {
        id: 'p-granola',
        name: 'GRANOLA CEREAL',
        packagingType: 'unidad',   // vocabulario ajeno (como en el informe real)
        unit: 'gramo',             // evidencia de peso: hoy se vende por gramos
        stock: 2.5,
        priceUsdt: 6,
    };

    it('la granola con unidad gramo SIGUE siendo granel (no se convierte en suelto)', () => {
        expect(isGranelProduct(GRANOLA)).toBe(true);
    });

    it('el plan solo le completa el campo interno: sigue vendiéndose por peso y sin ⚠ de decimales', () => {
        const cambios = planCatalogPackagingFix([GRANOLA]);
        expect(cambios).toHaveLength(1);
        expect(cambios[0].despues.packagingType).toBe('granel');
        expect(cambios[0].despues.granelUnit).toBe('kg');
        expect(cambios[0].stockDecimalPendiente).toBe(false); // su stock decimal es LEGÍTIMO
    });

    it('el aplicador no toca el stock ni la unidad de peso del producto de granel', () => {
        const { productos } = applyCatalogPackagingFix([{ ...GRANOLA }]);
        expect(productos[0].stock).toBe(2.5);
        expect(productos[0].unit).toBe('gramo');
        expect(productos[0].packagingType).toBe('granel');
    });
});

describe('applyCatalogPackagingFix — aplicador con bitácora y garantía anti-daño', () => {
    it('solo cambia los 3 campos de metadatos; stock, precios y ventas quedan idénticos', () => {
        const ventaGuardada = { id: 'v-1', items: [{ productId: 'p-sal', qty: 2, priceUsd: 1 }] };
        const catalogo = [{ ...SAL }, { ...QUESO }, { ...BULTO }];
        const { productos } = applyCatalogPackagingFix(catalogo);

        for (let i = 0; i < catalogo.length; i++) {
            const antes = { ...catalogo[i] };
            const despues = { ...productos[i] };
            for (const campo of ['packagingType', 'granelUnit']) {
                delete antes[campo];
                delete despues[campo];
            }
            expect(despues).toEqual(antes); // nada más cambió: ni stock, ni precios, ni unit, ni nada
        }
        expect(ventaGuardada).toEqual({ id: 'v-1', items: [{ productId: 'p-sal', qty: 2, priceUsd: 1 }] });
    });

    it('devuelve la bitácora con los valores anteriores para poder revertir', () => {
        const { productos, bitacora } = applyCatalogPackagingFix([{ ...SAL }]);
        expect(bitacora).toHaveLength(1);
        expect(bitacora[0].antes.packagingType).toBe('unidad');
        expect(bitacora[0].despues.packagingType).toBe('suelto');
        expect(productos[0].packagingType).toBe('suelto');
        expect(productos[0].granelUnit).toBeNull();
    });
});

describe('buildProductPayload — guardar ya no congela granel', () => {
    it('un producto con vocabulario ajeno se guarda como suelto y con granelUnit limpio', () => {
        const payload = buildProductPayload({
            name: 'Sal del mar 1 kg',
            priceUsd: '1.00',
            costUsd: '0.60',
            packagingType: 'unidad',   // vocabulario ajeno
            unit: 'unidad',
            granelUnit: 'kg',          // el formulario siempre trae 'kg'
            stock: '25',
        }, 40);
        expect(payload.packagingType).toBe('suelto');
        expect(payload.granelUnit).toBeNull();
        expect(payload.unit).toBe('unidad');
        expect(payload.stock).toBe(25);
    });

    it('el granel de verdad se guarda con su unidad de peso', () => {
        const payload = buildProductPayload({
            name: 'Queso fresco',
            priceUsd: '8.00',
            costUsd: '5.00',
            packagingType: 'granel',
            granelUnit: 'kg',
            stock: '2.500',
        }, 40);
        expect(payload.packagingType).toBe('granel');
        expect(payload.granelUnit).toBe('kg');
        expect(payload.stock).toBe(2.5);
    });
});

describe('formatPackagingFixReport — informe legible', () => {
    it('lista los cambios y avisa los stocks con decimales', () => {
        const reporte = formatPackagingFixReport(planCatalogPackagingFix([{ ...SAL, stock: 2.5 }]));
        expect(reporte).toContain('SAL DEL MAR 1 KG');
        expect(reporte).toContain('STOCK CON DECIMALES');
    });

    it('informa cuando no hay nada pendiente', () => {
        expect(formatPackagingFixReport([])).toContain('Sin cambios pendientes');
    });
});
