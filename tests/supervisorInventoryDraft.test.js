import { describe, expect, it } from 'vitest';
import {
    addInventoryDraftLine,
    createInventoryDraft,
    getInventoryDraftSummary,
    readConfiguredPresentationFactor,
    removeInventoryDraftLine,
    resolveInventoryPresentationFactor,
    updateInventoryDraftLine,
} from '../src/services/supervisorInventoryDraft';

const products = [
    { id: 'a', name: 'Arroz', stock: 10, unitsPerPackage: 24 },
    { id: 'b', name: 'Aceite', stock: 2, unitsPerPackage: 12 },
    { id: 'c', name: 'Sal', stock: 5 },
];

describe('supervisor inventory draft', () => {
    describe('resolveInventoryPresentationFactor', () => {
        it('devuelve 1 para unidades sin importar el factor del producto', () => {
            expect(resolveInventoryPresentationFactor(products[0], 'unidades')).toBe(1);
            expect(resolveInventoryPresentationFactor(products[1], 'unidades')).toBe(1);
            expect(resolveInventoryPresentationFactor(products[2], 'unidades')).toBe(1);
            expect(resolveInventoryPresentationFactor(null, 'unidades')).toBe(1);
        });

        it('devuelve el factor configurado del producto para cajas o bultos', () => {
            expect(resolveInventoryPresentationFactor(products[0], 'cajas')).toBe(24);
            expect(resolveInventoryPresentationFactor(products[0], 'bultos')).toBe(24);
            expect(resolveInventoryPresentationFactor(products[1], 'cajas')).toBe(12);
        });

        it('aplica fallback seguro 1 para productos sin factor configurado o con factor inválido', () => {
            expect(resolveInventoryPresentationFactor(products[2], 'cajas')).toBe(1);
            expect(resolveInventoryPresentationFactor({ unitsPerPackage: 0 }, 'cajas')).toBe(1);
            expect(resolveInventoryPresentationFactor({ unitsPerPackage: -5 }, 'cajas')).toBe(1);
            expect(resolveInventoryPresentationFactor({ unitsPerPackage: null }, 'cajas')).toBe(1);
            expect(resolveInventoryPresentationFactor({ unitsPerPackage: 'abc' }, 'bultos')).toBe(1);
            expect(resolveInventoryPresentationFactor(null, 'cajas')).toBe(1);
        });
    });

    it('fuerza factor 1 para unidades al agregar una línea aunque se envíe un factor de paquete', () => {
        let draft = createInventoryDraft('ingreso');
        const res = addInventoryDraftLine(draft, {
            productId: 'a',
            productName: 'Arroz',
            inputUnit: 'unidades',
            quantityInput: 5,
            unitsPerPackage: 24,
        });

        expect(res.draft.lines[0].unitsPerPackage).toBe(1);
        expect(res.draft.lines[0].quantityInput).toBe(5);
    });

    it('conserva el factor de paquete al agregar una línea con cajas o bultos', () => {
        let draft = createInventoryDraft('ingreso');
        const res = addInventoryDraftLine(draft, {
            productId: 'a',
            productName: 'Arroz',
            inputUnit: 'cajas',
            quantityInput: 2,
            unitsPerPackage: 24,
        });

        expect(res.draft.lines[0].unitsPerPackage).toBe(24);
    });

    it('consolida líneas del mismo producto y presentación', () => {
        let draft = createInventoryDraft('ingreso');
        draft = addInventoryDraftLine(draft, { productId: 'a', productName: 'Arroz', inputUnit: 'cajas', quantityInput: 2, unitsPerPackage: 12 }).draft;
        draft = addInventoryDraftLine(draft, { productId: 'a', productName: 'Arroz', inputUnit: 'cajas', quantityInput: 3, unitsPerPackage: 12 }).draft;

        expect(draft.lines).toHaveLength(1);
        expect(draft.lines[0].quantityInput).toBe(5);
    });

    it('no consolida presentaciones distintas y calcula el resumen', () => {
        let draft = createInventoryDraft('egreso', { reason: 'Daño', reasonCategory: 'danio' });
        draft = addInventoryDraftLine(draft, { productId: 'a', inputUnit: 'cajas', quantityInput: 1, unitsPerPackage: 6 }).draft;
        draft = addInventoryDraftLine(draft, { productId: 'a', inputUnit: 'unidades', quantityInput: 2, unitsPerPackage: 1 }).draft;

        const summary = getInventoryDraftSummary(draft, products);
        expect(summary.totalLines).toBe(2);
        expect(summary.totalUnits).toBe(8);
        expect(summary.lines[0].projectedStock).toBe(4);
        expect(summary.canSubmit).toBe(true);
    });

    it('marca egresos que dejarían stock negativo como inválidos', () => {
        let draft = createInventoryDraft('egreso', { reason: 'Merma', reasonCategory: 'merma' });
        draft = addInventoryDraftLine(draft, { productId: 'b', inputUnit: 'cajas', quantityInput: 1, unitsPerPackage: 3 }).draft;
        expect(getInventoryDraftSummary(draft, products).canSubmit).toBe(false);
    });

    it('permite editar y quitar líneas', () => {
        let draft = createInventoryDraft();
        draft = addInventoryDraftLine(draft, { productId: 'a', inputUnit: 'unidades', quantityInput: 1, unitsPerPackage: 1 }).draft;
        const lineId = draft.lines[0].id;
        draft = updateInventoryDraftLine(draft, lineId, { quantityInput: 4 });
        expect(draft.lines[0].quantityInput).toBe(4);
        expect(removeInventoryDraftLine(draft, lineId).lines).toHaveLength(0);
    });

    it.each(['cajas', 'bultos'])('rechaza factores inválidos en borradores de %s sin aplicar fallback', (inputUnit) => {
        for (const unitsPerPackage of [0, -2, 'abc', NaN, Infinity, undefined, null]) {
            const draft = createInventoryDraft('ingreso', {
                lines: [{ id: 'legacy', productId: 'a', inputUnit, quantityInput: 2, unitsPerPackage }],
            });
            const summary = getInventoryDraftSummary(draft, products);
            expect(summary.canSubmit).toBe(false);
            expect(summary.invalidLines).toHaveLength(1);
            expect(summary.lines[0].valid).toBe(false);
        }
    });

    it('normaliza el factor stale de unidades tanto en el cálculo como en la línea para envío', () => {
        const draft = createInventoryDraft('ingreso', {
            lines: [{ id: 'legacy', productId: 'a', inputUnit: 'unidades', quantityInput: 2, unitsPerPackage: 24 }],
        });
        const summary = getInventoryDraftSummary(draft, products);
        expect(summary.canSubmit).toBe(true);
        expect(summary.totalUnits).toBe(2);
        expect(summary.lines[0].unitsPerPackage).toBe(1);
        expect(summary.lines[0].projectedStock).toBe(12);
        expect(draft.lines[0].unitsPerPackage).toBe(24);
    });

    it('fuerza factor 1 al actualizar una línea a unidades', () => {
        let draft = createInventoryDraft();
        draft = addInventoryDraftLine(draft, { productId: 'a', inputUnit: 'cajas', quantityInput: 2, unitsPerPackage: 24 }).draft;
        const lineId = draft.lines[0].id;
        draft = updateInventoryDraftLine(draft, lineId, { inputUnit: 'unidades' });
        expect(draft.lines[0].unitsPerPackage).toBe(1);
    });
});

describe('readConfiguredPresentationFactor', () => {
    it('devuelve el empaque configurado del producto', () => {
        expect(readConfiguredPresentationFactor(products[0])).toBe(24);
        expect(readConfiguredPresentationFactor({ unitsPerPackage: '30' })).toBe(30);
    });

    it('distingue "sin configurado" de "configurado en 1" y descarta valores inválidos', () => {
        expect(readConfiguredPresentationFactor(products[2])).toBeNull();
        expect(readConfiguredPresentationFactor(null)).toBeNull();
        expect(readConfiguredPresentationFactor({ unitsPerPackage: 0 })).toBeNull();
        expect(readConfiguredPresentationFactor({ unitsPerPackage: -5 })).toBeNull();
        expect(readConfiguredPresentationFactor({ unitsPerPackage: 'abc' })).toBeNull();
        expect(readConfiguredPresentationFactor({ unitsPerPackage: undefined })).toBeNull();
        // Un bulto configurado explícitamente en 1 SÍ es un valor válido.
        expect(readConfiguredPresentationFactor({ unitsPerPackage: 1 })).toBe(1);
    });
});

describe('base estampada de la línea (expectedStock)', () => {
    const products = [{ id: 'p1', stock: 30 }];

    it('la base estampada al componer la línea manda sobre el stock del producto', () => {
        const draft = addInventoryDraftLine(createInventoryDraft('ingreso'), {
            productId: 'p1',
            inputUnit: 'unidades',
            quantityInput: 8,
            unitsPerPackage: 1,
            baseStock: 22,
        }).draft;
        const summary = getInventoryDraftSummary(draft, products);
        expect(summary.lines[0].stock).toBe(22);
        expect(summary.lines[0].projectedStock).toBe(30);
    });

    it('una línea sin base estampada (legacy) usa el stock del producto', () => {
        const draft = addInventoryDraftLine(createInventoryDraft('ingreso'), {
            productId: 'p1',
            inputUnit: 'unidades',
            quantityInput: 8,
        }).draft;
        const summary = getInventoryDraftSummary(draft, products);
        expect(summary.lines[0].stock).toBe(30);
    });

    it('fusionar líneas del mismo producto conserva la base estampada de la primera', () => {
        let draft = addInventoryDraftLine(createInventoryDraft('ingreso'), {
            productId: 'p1', inputUnit: 'unidades', quantityInput: 8, baseStock: 22,
        }).draft;
        draft = addInventoryDraftLine(draft, {
            productId: 'p1', inputUnit: 'unidades', quantityInput: 4, baseStock: 30,
        }).draft;
        const summary = getInventoryDraftSummary(draft, products);
        expect(summary.lines).toHaveLength(1);
        expect(summary.lines[0].stock).toBe(22);
        expect(summary.lines[0].unitsDelta).toBe(12);
    });
});

describe('semántica de objetivo (idempotencia de raíz del lote)', () => {
    const products = [{ id: 'p1', stock: 22 }];

    function addTargetLine(draft, { quantityInput = 8, inputUnit = 'unidades', unitsPerPackage = 1, baseStock = 22, targetStock = 30 } = {}) {
        return addInventoryDraftLine(draft, {
            productId: 'p1',
            productName: 'P1',
            inputUnit,
            quantityInput,
            unitsPerPackage,
            baseStock,
            targetStock,
        }).draft;
    }

    it('una línea ya en su objetivo se satisface y no genera movimiento', () => {
        const draft = addTargetLine(createInventoryDraft('ingreso'));
        const summary = getInventoryDraftSummary(draft, [{ id: 'p1', stock: 30 }]);
        expect(summary.lines[0].satisfied).toBe(true);
        expect(summary.lines[0].valid).toBe(true);
        expect(summary.lines[0].unitsDelta).toBe(0);
        expect(summary.pendingLines).toHaveLength(0);
    });

    it('el movimiento se deriva del stock actual, no de la base estampada', () => {
        const draft = addTargetLine(createInventoryDraft('ingreso'));
        const summary = getInventoryDraftSummary(draft, [{ id: 'p1', stock: 19 }]);
        expect(summary.lines[0].stock).toBe(19);
        expect(summary.lines[0].unitsDelta).toBe(11);
        expect(summary.lines[0].quantityInput).toBe(11);
        expect(summary.lines[0].inputUnit).toBe('unidades');
        expect(summary.lines[0].projectedStock).toBe(30);
    });

    it('si el stock ya pasó el objetivo, la línea queda inválida con mensaje claro', () => {
        const draft = addTargetLine(createInventoryDraft('ingreso'));
        const summary = getInventoryDraftSummary(draft, [{ id: 'p1', stock: 32 }]);
        expect(summary.lines[0].valid).toBe(false);
        expect(String(summary.lines[0].error)).toContain('ya pasó tu objetivo');
    });

    it('conserva la unidad compuesta cuando su conversión coincide con el movimiento derivado', () => {
        const draft = addTargetLine(createInventoryDraft('ingreso'), {
            inputUnit: 'cajas', quantityInput: 2, unitsPerPackage: 6, targetStock: 34,
        });
        const summary = getInventoryDraftSummary(draft, products);
        expect(summary.lines[0].inputUnit).toBe('cajas');
        expect(summary.lines[0].quantityInput).toBe(2);
        expect(summary.lines[0].unitsDelta).toBe(12);
        expect(summary.lines[0].projectedStock).toBe(34);
    });

    it('si el stock actual cambió, la unidad compuesta se reemplaza por el movimiento derivado', () => {
        const draft = addTargetLine(createInventoryDraft('ingreso'), {
            inputUnit: 'cajas', quantityInput: 2, unitsPerPackage: 6, targetStock: 34,
        });
        // La caja quedó en 25: el objetivo 34 pide 9 (no las 12 unidades de 2 cajas).
        const summary = getInventoryDraftSummary(draft, [{ id: 'p1', stock: 25 }]);
        expect(summary.lines[0].inputUnit).toBe('unidades');
        expect(summary.lines[0].quantityInput).toBe(9);
    });

    it('fusionar contribuciones acumula el objetivo', () => {
        let draft = addTargetLine(createInventoryDraft('ingreso'), { quantityInput: 8, targetStock: 30 });
        draft = addTargetLine(draft, { quantityInput: 4, baseStock: 22, targetStock: 26 });
        const summary = getInventoryDraftSummary(draft, products);
        expect(summary.lines).toHaveLength(1);
        expect(summary.lines[0].targetStock).toBe(34);
        expect(summary.lines[0].unitsDelta).toBe(12);
    });

    it('varias líneas del mismo producto se encadenan y comparten el expectedStock del contrato', () => {
        let draft = addTargetLine(createInventoryDraft('ingreso'), { quantityInput: 8, targetStock: 30 });
        draft = addTargetLine(draft, { inputUnit: 'cajas', quantityInput: 1, unitsPerPackage: 3, baseStock: 22, targetStock: 25 });
        const summary = getInventoryDraftSummary(draft, products);
        expect(summary.lines).toHaveLength(2);
        expect(summary.lines[0].stock).toBe(22);
        expect(summary.lines[1].stock).toBe(22);
        expect(summary.lines[0].unitsDelta).toBe(8);
        expect(summary.lines[1].unitsDelta).toBe(3);
        expect(summary.lines[1].targetStock).toBe(33);
        expect(summary.lines[1].projectedStock).toBe(33);
    });

    it('en egreso el objetivo por debajo del actual deriva la salida', () => {
        const draft = addTargetLine(createInventoryDraft('egreso', { reason: 'Merma del día', reasonCategory: 'merma' }), {
            quantityInput: 5, baseStock: 22, targetStock: 17,
        });
        const summary = getInventoryDraftSummary(draft, products);
        expect(summary.lines[0].unitsDelta).toBe(5);
        expect(summary.lines[0].signedDelta).toBe(-5);
        expect(summary.lines[0].valid).toBe(true);
    });
});
