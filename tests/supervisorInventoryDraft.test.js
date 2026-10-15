import { describe, expect, it } from 'vitest';
import {
    addInventoryDraftLine,
    createInventoryDraft,
    getInventoryDraftSummary,
    removeInventoryDraftLine,
    updateInventoryDraftLine,
} from '../src/services/supervisorInventoryDraft';

const products = [
    { id: 'a', name: 'Arroz', stock: 10 },
    { id: 'b', name: 'Aceite', stock: 2 },
];

describe('supervisor inventory draft', () => {
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
});
