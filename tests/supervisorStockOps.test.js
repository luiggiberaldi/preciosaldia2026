// Operaciones de stock por producto (unificadas entre el ajuste de fila +/− y el
// panel de lote de inventario): estado optimistic, resultados por producto y la
// reconciliación que decide promociones, retiros de franja e inspecciones.
import { describe, expect, it } from 'vitest';
import {
    applyBatchStockTargets,
    applyStockOpResult,
    beginBatchStockTargets,
    beginStockAdjust,
    believedStockOf,
    buildInventoryBatchTargets,
    classifyStockOpResult,
    clearStockOp,
    isStockAdjustBlocked,
    nextStockOpAfterInspection,
    patchProductStock,
    planStockOpReconciliation,
    shouldAnnounceStockOpFailure,
    withStockOp,
} from '../src/services/supervisorStockOps';

const product = (id, stock) => ({ id, name: `Prod ${id}`, stock });

describe('supervisorStockOps · estado por producto', () => {
    it('believedStockOf usa el objetivo mientras la operación no ha fallado', () => {
        const product10 = product('p1', 10);
        expect(believedStockOf(product10, {})).toBe(10);
        const sending = withStockOp({}, 'p1', { state: 'sending', targetStock: 12 });
        expect(believedStockOf(product10, sending)).toBe(12);
        const failed = withStockOp(sending, 'p1', { state: 'failed', targetStock: 12 });
        expect(believedStockOf(product10, failed)).toBe(10);
    });

    it('con dos ajustes encadenados el objetivo creído es el más reciente', () => {
        let map = beginStockAdjust({}, { productId: 'p1', targetStock: 12 });
        map = applyStockOpResult(map, { productId: 'p1', targetStock: 12, commandId: 'c1' }, { ok: true });
        map = beginStockAdjust(map, { productId: 'p1', targetStock: 15 });
        expect(believedStockOf(product('p1', 10), map)).toBe(15);
    });

    it('clearStockOp con onlyAppliedTarget solo retira ese ajuste aplicado', () => {
        const applied = applyStockOpResult(
            beginStockAdjust({}, { productId: 'p1', targetStock: 12 }),
            { productId: 'p1', targetStock: 12 },
            { ok: true },
        );
        expect(clearStockOp(applied, 'p1', { onlyAppliedTarget: 12 })).toEqual({});
        // Un ajuste nuevo en vuelo nunca se borra con el retiro del anterior.
        const inFlight = beginStockAdjust(applied, { productId: 'p1', targetStock: 15 });
        expect(clearStockOp(inFlight, 'p1', { onlyAppliedTarget: 12 })).toBe(inFlight);
        expect(clearStockOp(inFlight, 'p1', { onlyAppliedTarget: 15 })).toBe(inFlight);
        expect(clearStockOp(inFlight, 'p1')).toEqual({});
    });

    it('isStockAdjustBlocked solo bloquea con envío en vuelo o confirmación pendiente', () => {
        const sending = beginStockAdjust({}, { productId: 'p1', targetStock: 12 });
        expect(isStockAdjustBlocked(sending, 'p1')).toBe(true);
        expect(isStockAdjustBlocked(sending, 'p2')).toBe(false);
        const applied = applyStockOpResult(sending, { productId: 'p1', targetStock: 12 }, { ok: true });
        expect(isStockAdjustBlocked(applied, 'p1')).toBe(false);
        const failed = applyStockOpResult(sending, { productId: 'p1', targetStock: 12 }, { ok: false, uncertain: false });
        expect(isStockAdjustBlocked(failed, 'p1')).toBe(false);
    });

    it('patchProductStock solo reemplaza el stock del producto pedido', () => {
        const products = [product('p1', 10), product('p2', 4)];
        expect(patchProductStock(products, 'p1', 12)).toEqual([{ ...product('p1', 12) }, product('p2', 4)]);
    });
});

describe('supervisorStockOps · clasificación de resultados y avisos', () => {
    it('applied / pending (incierto) / failed según el resultado', () => {
        expect(classifyStockOpResult({ ok: true })).toBe('applied');
        expect(classifyStockOpResult({ ok: false, status: 'applied' })).toBe('applied');
        expect(classifyStockOpResult({ ok: false, status: 'applied_with_warnings' })).toBe('applied');
        expect(classifyStockOpResult({ uncertain: true })).toBe('pending');
        expect(classifyStockOpResult({ ok: false, status: 'timeout', uncertain: true })).toBe('pending');
        expect(classifyStockOpResult({ ok: false, uncertain: false, status: 'rejected' })).toBe('failed');
        expect(classifyStockOpResult(null)).toBe('failed');
    });

    it('solo se anuncia el fallo del ajuste único (los lotes son silent)', () => {
        expect(shouldAnnounceStockOpFailure({ state: 'failed' })).toBe(true);
        expect(shouldAnnounceStockOpFailure({ state: 'failed', silent: true })).toBe(false);
        expect(shouldAnnounceStockOpFailure({ state: 'applied' })).toBe(false);
    });
});

describe('supervisorStockOps · contrato por producto de los dos flujos', () => {
    it('beginStockAdjust (fila) marca sending del producto con su objetivo', () => {
        expect(beginStockAdjust({ p0: { state: 'applied', targetStock: 1 } }, { productId: 'p1', targetStock: 11 }))
            .toEqual({
                p0: { state: 'applied', targetStock: 1 },
                p1: { state: 'sending', targetStock: 11, silent: false },
            });
    });

    it('beginBatchStockTargets (lote) marca sending silent de cada producto', () => {
        const map = beginBatchStockTargets({}, [
            { productId: 'p1', targetStock: 11 },
            { productId: 'p2', targetStock: 3 },
        ]);
        expect(map).toEqual({
            p1: { state: 'sending', targetStock: 11, silent: true },
            p2: { state: 'sending', targetStock: 3, silent: true },
        });
    });

    it('applyStockOpResult: applied preserva el objetivo y el commandId', () => {
        const sending = beginStockAdjust({}, { productId: 'p1', targetStock: 11 });
        const map = applyStockOpResult(sending, { productId: 'p1', targetStock: 11, commandId: 'c1' }, { ok: true }, { announce: true });
        expect(map.p1).toEqual({ state: 'applied', targetStock: 11, commandId: 'c1' });
    });

    it('applyStockOpResult: incierto queda pending con el commandId para reconciliar', () => {
        const sending = beginStockAdjust({}, { productId: 'p1', targetStock: 11 });
        const map = applyStockOpResult(sending, { productId: 'p1', targetStock: 11, commandId: 'c1' }, { uncertain: true }, { announce: true });
        expect(map.p1).toEqual({ state: 'pending', targetStock: 11, commandId: 'c1' });
    });

    it('applyStockOpResult: fallo con announce guarda el error; sin announce revierte', () => {
        const sending = beginStockAdjust({}, { productId: 'p1', targetStock: 11 });
        const failed = applyStockOpResult(sending, { productId: 'p1', targetStock: 11 }, { ok: false, uncertain: false, error: 'rechazado' }, { announce: true });
        expect(failed.p1).toEqual({ state: 'failed', targetStock: 11, commandId: null, error: 'rechazado' });
        // Lote: reversión pura al stock sincronizado (sin franja ni toast).
        expect(applyStockOpResult(sending, { productId: 'p1', targetStock: 11 }, { ok: false, uncertain: false }, { announce: false })).toEqual({});
    });

    it('applyBatchStockTargets replica applied/pending/fallo por cada producto del lote', () => {
        const targets = [{ productId: 'p1', targetStock: 11 }, { productId: 'p2', targetStock: 3 }];
        const applied = applyBatchStockTargets({}, { ok: true, commandId: 'c1' }, targets);
        expect(applied).toEqual({
            p1: { state: 'applied', targetStock: 11, commandId: 'c1', silent: true },
            p2: { state: 'applied', targetStock: 3, commandId: 'c1', silent: true },
        });
        const uncertain = applyBatchStockTargets({}, { ok: false, uncertain: true, commandId: 'c1' }, targets);
        expect(uncertain.p1.state).toBe('pending');
        expect(uncertain.p2.state).toBe('pending');
        expect(applyBatchStockTargets({ p9: { state: 'applied', targetStock: 1 } }, { ok: false, uncertain: false }, targets))
            .toEqual({ p9: { state: 'applied', targetStock: 1 } });
    });
});

describe('supervisorStockOps · buildInventoryBatchTargets', () => {
    it('acumula líneas del mismo producto y excluye las inválidas', () => {
        const targets = buildInventoryBatchTargets([
            { valid: true, productId: 'p1', stock: 10, projectedStock: 12 },
            { valid: true, productId: 'p1', stock: 12, projectedStock: 15 },
            { valid: true, productId: 'p2', stock: 5, projectedStock: 4 },
            { valid: false, productId: 'p3', stock: 1, projectedStock: 99 },
        ]);
        expect(targets).toEqual([
            { productId: 'p1', targetStock: 15 },
            { productId: 'p2', targetStock: 4 },
        ]);
    });

    it('redondea a 3 decimales (granel)', () => {
        const targets = buildInventoryBatchTargets([
            { valid: true, productId: 'p1', stock: 1.23456, projectedStock: 2.34567 },
        ]);
        expect(targets).toEqual([{ productId: 'p1', targetStock: 2.346 }]);
    });
});

describe('supervisorStockOps · reconciliación', () => {
    it('promociona a applied cuando el stock sincronizado ya muestra el objetivo', () => {
        const map = beginStockAdjust({}, { productId: 'p1', targetStock: 11 });
        const plan = planStockOpReconciliation(map, [product('p1', 11)]);
        expect(plan.promoted).toEqual(['p1']);
        expect(plan.retire).toEqual([]);
        expect(plan.inspect).toEqual([]);
        expect(plan.map.p1.state).toBe('applied');
    });

    it('programa el retiro de la franja cuando un applied ya coincide con la sincronía', () => {
        const map = applyStockOpResult(beginStockAdjust({}, { productId: 'p1', targetStock: 11 }), { productId: 'p1', targetStock: 11 }, { ok: true });
        const plan = planStockOpReconciliation(map, [product('p1', 11)]);
        expect(plan.retire).toEqual([{ id: 'p1', targetStock: 11 }]);
        expect(plan.promoted).toEqual([]);
    });

    it('un pending con commandId sin sincronizar pasa a inspección (lectura sola)', () => {
        const map = applyStockOpResult(beginStockAdjust({}, { productId: 'p1', targetStock: 11 }), { productId: 'p1', targetStock: 11, commandId: 'c1' }, { uncertain: true });
        const plan = planStockOpReconciliation(map, [product('p1', 10)]);
        expect(plan.inspect).toHaveLength(1);
        expect(plan.inspect[0].id).toBe('p1');
        expect(plan.inspect[0].op.commandId).toBe('c1');
    });

    it('no mira estados terminales (failed) ni operaciones sin objetivo', () => {
        const map = {
            p1: { state: 'failed', targetStock: 11, commandId: 'c1' },
            p2: { state: 'applied' },
        };
        const plan = planStockOpReconciliation(map, [product('p1', 10), product('p2', 10)]);
        expect(plan.promoted).toEqual([]);
        expect(plan.retire).toEqual([]);
        expect(plan.inspect).toEqual([]);
    });

    it('nextStockOpAfterInspection: terminal applied, rechazo, expiración y sin cambio', () => {
        const op = { state: 'pending', targetStock: 11, commandId: 'c1' };
        expect(nextStockOpAfterInspection(op, { state: 'terminal', ack: { status: 'applied' } }))
            .toEqual({ ...op, state: 'applied' });
        expect(nextStockOpAfterInspection(op, { state: 'terminal', ack: { status: 'applied_with_warnings' } }))
            .toEqual({ ...op, state: 'applied' });
        expect(nextStockOpAfterInspection(op, { state: 'terminal', ack: { status: 'rejected', error: 'no' } }))
            .toEqual({ ...op, state: 'failed', error: 'no' });
        expect(nextStockOpAfterInspection(op, { state: 'terminal', ack: null }))
            .toEqual({ ...op, state: 'failed', error: 'La caja rechazó el cambio de stock' });
        expect(nextStockOpAfterInspection(op, { state: 'expired' }))
            .toEqual({ ...op, state: 'failed', error: 'La orden expiró en la caja sin aplicarse' });
        expect(nextStockOpAfterInspection(op, { state: 'active' })).toBe(null);
        // 'absent': la orden NUNCA llegó a crearse — resuelve fallido en
        // segundos en vez de dejar el badge esperar el TTL por un comando
        // inexistente (y el reintento puede reutilizar el mismo commandId).
        expect(nextStockOpAfterInspection(op, { state: 'absent' }))
            .toEqual({ ...op, state: 'failed', error: 'La orden no llegó a la caja y no se aplicó' });
        // 'unknown': no se pudo consultar — nada se concluye.
        expect(nextStockOpAfterInspection(op, { state: 'unknown' })).toBe(null);
    });
});

describe('supervisorStockOps · una venta en la caja se descuenta en la fila', () => {
    const W0 = '2026-10-18T10:00:00.000Z';
    const W1 = '2026-10-18T10:05:00.000Z';

    it('el eco MÁS NUEVO que el ajuste, con otro stock, retira el objetivo creído', () => {
        // Ajuste aplicado con objetivo 11 cuando el eco vigente era W0.
        let map = beginStockAdjust({}, { productId: 'p1', targetStock: 11, sinceWatermark: W0 });
        map = applyStockOpResult(map, { productId: 'p1', targetStock: 11, commandId: 'c1' }, { ok: true });

        // Llega un eco posterior (W1) con el stock ya descontado por una venta: 8.
        const plan = planStockOpReconciliation(map, [product('p1', 8)], { productsUpdatedAt: W1 });

        // El objetivo quedó viejo: se retira al instante…
        expect(plan.superseded).toEqual([{ id: 'p1', targetStock: 11 }]);
        expect(plan.retire).toEqual([]);
        // …y la fila pasa a mostrar el stock sincronizado (8), no el objetivo.
        const cleared = clearStockOp(map, 'p1', { onlyAppliedTarget: 11 });
        expect(believedStockOf(product('p1', 8), cleared)).toBe(8);
    });

    it('mientras el eco no es más nuevo que el ajuste, el objetivo creído se conserva', () => {
        let map = beginStockAdjust({}, { productId: 'p1', targetStock: 11, sinceWatermark: W0 });
        map = applyStockOpResult(map, { productId: 'p1', targetStock: 11, commandId: 'c1' }, { ok: true });
        // El eco va detrás (sigue en 10) pero no es posterior al ajuste.
        const plan = planStockOpReconciliation(map, [product('p1', 10)], { productsUpdatedAt: W0 });
        expect(plan.superseded).toEqual([]);
        expect(plan.retire).toEqual([]);
        expect(believedStockOf(product('p1', 10), map)).toBe(11);
    });

    it('sin marca de eco en la op nunca se retira por suposición (cubre ops heredadas)', () => {
        const map = applyStockOpResult(
            beginStockAdjust({}, { productId: 'p1', targetStock: 11 }),
            { productId: 'p1', targetStock: 11, commandId: 'c1' },
            { ok: true },
        );
        const plan = planStockOpReconciliation(map, [product('p1', 8)], { productsUpdatedAt: W1 });
        expect(plan.superseded).toEqual([]);
        expect(believedStockOf(product('p1', 8), map)).toBe(11);
    });

    it('el objetivo que nació de la inspección también se retira si una venta lo dejó viejo', () => {
        const pendingMap = applyStockOpResult(
            beginStockAdjust({}, { productId: 'p1', targetStock: 11, sinceWatermark: W0 }),
            { productId: 'p1', targetStock: 11, commandId: 'c1' },
            { uncertain: true },
        );
        // La inspección promueve la entrada de la op a applied (conserva la marca).
        const applied = nextStockOpAfterInspection(pendingMap.p1, { state: 'terminal', ack: { status: 'applied' } });
        const plan = planStockOpReconciliation({ p1: applied }, [product('p1', 8)], { productsUpdatedAt: W1 });
        expect(plan.superseded).toEqual([{ id: 'p1', targetStock: 11 }]);
    });

    it('applyStockOpResult conserva la marca del eco del ajuste', () => {
        const map = applyStockOpResult(
            beginStockAdjust({}, { productId: 'p1', targetStock: 11, sinceWatermark: W0 }),
            { productId: 'p1', targetStock: 11, commandId: 'c1' },
            { ok: true },
        );
        expect(map.p1.sinceWatermark).toBe(W0);
    });
});
