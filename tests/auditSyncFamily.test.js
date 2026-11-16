import { describe, expect, it } from 'vitest';
import {
    AUDIT_SYNC_BASE_KEY,
    auditDocIdForSlot,
    buildAuditSyncPlan,
    getAuditSlotOfTs,
    getAuditWindowStart,
    isAuditSlotInWindow,
    isAuditSyncDocId,
    mergeAuditSyncDoc,
    parseAuditSyncDocId,
    projectAuditSyncPayload,
} from '../src/utils/auditSyncFamily';

// 14-nov-2026 15:30 UTC
const NOW = Date.parse('2026-11-14T15:30:00Z');
const H = 3_600_000;

const entry = (id, ts, extra = {}) => ({ id, ts, cat: 'VENTA', action: 'VENTA_COMPLETADA', desc: `Evento ${id}`, ...extra });

describe('familia del audit log por franjas de 2 h (egress F1)', () => {
    it('calcula la franja UTC y reconoce los doc_id', () => {
        expect(getAuditSlotOfTs(Date.parse('2026-11-14T15:59:59Z'))).toBe('2026-11-14T14');
        expect(getAuditSlotOfTs(Date.parse('2026-11-14T16:00:00Z'))).toBe('2026-11-14T16');
        expect(getAuditSlotOfTs(Date.parse('2026-11-14T03:00:00Z'))).toBe('2026-11-14T02');
        expect(parseAuditSyncDocId('abasto_audit_log_v1:2026-11-14T22')).toBe('2026-11-14T22');
        expect(parseAuditSyncDocId('abasto_audit_log_v1:2026-11-14T13')).toBeNull();
        expect(parseAuditSyncDocId('abasto_audit_log_v1:2026-11-14T24')).toBeNull();
        expect(parseAuditSyncDocId(AUDIT_SYNC_BASE_KEY)).toBeNull();
        expect(isAuditSyncDocId(AUDIT_SYNC_BASE_KEY)).toBe(true);
        expect(isAuditSyncDocId('abasto_audit_log_v1:2026-11-14T12')).toBe(true);
        expect(isAuditSyncDocId('bodega_sales_v1')).toBe(false);
    });

    it('la ventana son 7 días UTC contando hoy', () => {
        expect(new Date(getAuditWindowStart(NOW)).toISOString()).toBe('2026-11-08T00:00:00.000Z');
        expect(isAuditSlotInWindow('2026-11-08T00', NOW)).toBe(true);
        expect(isAuditSlotInWindow('2026-11-07T20', NOW)).toBe(false);
    });

    it('la proyección deja solo la ventana y conserva el orden local', () => {
        const log = [entry('n', NOW - H), entry('m', NOW - 3 * 24 * H), entry('viejo', NOW - 9 * 24 * H)];
        expect(projectAuditSyncPayload(log, { now: NOW }).map((e) => e.id)).toEqual(['n', 'm']);
        expect(projectAuditSyncPayload('x', { now: NOW })).toBe('x');
    });

    it('arma un doc por franja, en orden ascendente estable', () => {
        const log = [
            entry('c', Date.parse('2026-11-14T15:00:00Z')),
            entry('b', Date.parse('2026-11-14T13:00:00Z')),
            entry('a', Date.parse('2026-11-14T09:00:00Z')),
        ];
        const plan = buildAuditSyncPlan(log, { now: NOW });
        expect(plan.map((s) => s.docId)).toEqual([
            'abasto_audit_log_v1:2026-11-14T08',
            'abasto_audit_log_v1:2026-11-14T12',
            'abasto_audit_log_v1:2026-11-14T14',
        ]);
        expect(plan[2].records.map((e) => e.id)).toEqual(['c']);
    });

    it('una entrada nueva solo cambia la franja en curso', () => {
        const base = Array.from({ length: 300 }, (_, i) => entry(`e${i}`, NOW - i * 20 * 60_000));
        const before = buildAuditSyncPlan(base, { now: NOW });
        const after = buildAuditSyncPlan([entry('nueva', NOW), ...base], { now: NOW });
        const changed = after.filter((slice) => {
            const prev = before.find((s) => s.docId === slice.docId);
            return JSON.stringify(prev?.records) !== JSON.stringify(slice.records);
        });
        expect(changed.map((s) => s.docId)).toEqual(['abasto_audit_log_v1:2026-11-14T14']);
    });

    it('una franja de una caja muy activa queda muy por debajo de los 407 KB de antes', () => {
        // 450 eventos/día (13-nov) concentrados en menos de 4 h, ~340 B c/u.
        const desc = 'x'.repeat(230);
        const log = Array.from({ length: 450 }, (_, i) => entry(`e${i}`, Date.parse('2026-11-14T12:00:00Z') + i * 30_000, { desc }));
        const plan = buildAuditSyncPlan(log, { now: Date.parse('2026-11-14T20:00:00Z') });
        const biggest = Math.max(...plan.map((s) => JSON.stringify(s.records).length));
        expect(biggest).toBeLessThan(100_000);
    });

    describe('merge del lector', () => {
        const slotDoc = auditDocIdForSlot('2026-11-14T12'); // 12:00–13:59

        it('supervisor: la franja reemplaza la suya, [] la vacía y se recorta a la ventana', () => {
            const local = [
                entry('vieja', NOW - 10 * 24 * H),
                entry('otra-franja', Date.parse('2026-11-14T09:00:00Z')),
                entry('borrada', Date.parse('2026-11-14T13:00:00Z')),
            ];
            const merged = mergeAuditSyncDoc(local, slotDoc, [entry('nueva', Date.parse('2026-11-14T13:30:00Z'))], { trimToWindow: true, now: NOW });
            expect(merged.map((e) => e.id)).toEqual(['nueva', 'otra-franja']);
            expect(mergeAuditSyncDoc(merged, slotDoc, [], { now: NOW }).map((e) => e.id)).toEqual(['otra-franja']);
        });

        it('caja (replaceSlot: false): solo une y nunca quita lo local', () => {
            const local = [entry('local-reciente', Date.parse('2026-11-14T15:00:00Z'))];
            const merged = mergeAuditSyncDoc(local, slotDoc, [entry('remota', Date.parse('2026-11-14T13:00:00Z'))], { replaceSlot: false });
            expect(merged.map((e) => e.id)).toEqual(['local-reciente', 'remota']);
            expect(mergeAuditSyncDoc(local, slotDoc, [], { replaceSlot: false })).toEqual(local);
        });

        it('el legacy se une con «lo local gana» y [] no limpia', () => {
            const local = [entry('a', NOW, { desc: 'local' })];
            const merged = mergeAuditSyncDoc(local, AUDIT_SYNC_BASE_KEY, [entry('a', NOW, { desc: 'remoto' }), entry('b', NOW - H)]);
            expect(merged.map((e) => `${e.id}:${e.desc}`)).toEqual(['a:local', 'b:Evento b']);
            expect(mergeAuditSyncDoc(local, AUDIT_SYNC_BASE_KEY, [])).toEqual(local);
        });

        it('payload inválido o doc ajeno → lo local intacto', () => {
            const local = [entry('a', NOW)];
            expect(mergeAuditSyncDoc(local, slotDoc, null)).toBe(local);
            expect(mergeAuditSyncDoc(local, 'abasto_audit_log_v1:basura', [entry('z', NOW)])).toBe(local);
        });
    });
});
