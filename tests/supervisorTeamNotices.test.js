// Propuesta 8 (avisos de equipo) — Fase 1: núcleo puro, sin React ni red.
// Reglas del plan: los cambios PROPIOS no avisan (el tracker ya los anuncia),
// un cambio = un aviso (dedupe por commandId), ráfagas agrupadas y tono
// informativo NUNCA de error (que otro compañero trabaje no es un problema).
import { describe, expect, it } from 'vitest';
import {
    TEAM_NOTICE_INVENTORY_TITLE,
    TEAM_NOTICE_SEEN_MAX,
    appendSeenCommandId,
    classifyTeamNotice,
    formatTeamNotice,
    groupTeamNotices,
} from '../src/services/supervisorTeamNotices';

const MY = 'auth-mine';

const baseCommand = {
    command_id: 'cmd-1',
    actor_auth_id: 'auth-other',
    command_type: 'supervisor.inventory.batch.adjust',
    status: 'pending',
    created_at: '2026-10-18T10:00:00.000Z',
    payload: {
        direction: 'ingreso',
        productName: 'Detodito Grande',
        quantityInput: 5,
        inputUnit: 'unidades',
    },
};

describe('classifyTeamNotice', () => {
    it('un comando de OTRO actor produce un aviso con título, detalle y actor', () => {
        const notice = classifyTeamNotice({ command: baseCommand, myActorId: MY, seenCommandIds: [] });
        expect(notice).toMatchObject({
            commandId: 'cmd-1',
            kind: 'single',
            title: TEAM_NOTICE_INVENTORY_TITLE,
            actorLabel: 'Otro supervisor',
            at: '2026-10-18T10:00:00.000Z',
        });
        expect(notice.detail).toContain('Detodito Grande');
    });

    it('mis propios cambios NUNCA generan aviso de equipo', () => {
        expect(classifyTeamNotice({
            command: { ...baseCommand, actor_auth_id: MY },
            myActorId: MY,
            seenCommandIds: [],
        })).toBeNull();
    });

    it('sin actor_auth_id o sin mi identidad no se adivina: silencio', () => {
        expect(classifyTeamNotice({
            command: { ...baseCommand, actor_auth_id: null },
            myActorId: MY,
            seenCommandIds: [],
        })).toBeNull();
        expect(classifyTeamNotice({ command: baseCommand, myActorId: null, seenCommandIds: [] })).toBeNull();
    });

    it('un commandId ya visto no se anuncia dos veces', () => {
        expect(classifyTeamNotice({ command: baseCommand, myActorId: MY, seenCommandIds: ['cmd-1'] })).toBeNull();
    });

    it('un UPDATE con final triste (cancelled/failed) no anuncia que "actualizó el inventario"', () => {
        for (const status of ['cancelled', 'failed', 'rejected', 'expired']) {
            expect(classifyTeamNotice({
                command: { ...baseCommand, status },
                myActorId: MY,
                seenCommandIds: [],
                eventType: 'UPDATE',
            })).toBeNull();
        }
    });

    it('cada tipo de comando produce una etiqueta legible del catálogo del panel', () => {
        const cases = [
            ['supervisor.rate.set', 'Cambio de tasa'],
            ['supervisor.product.create', 'Crear producto'],
            ['supervisor.product.update', 'Editar producto'],
            ['supervisor.product.delete', 'Eliminar producto'],
            ['supervisor.user.create', 'Crear usuario'],
            ['supervisor.user.pin.change', 'Cambiar PIN'],
            ['supervisor.user.delete', 'Eliminar usuario'],
            ['supervisor.shift.close', 'Cerrar turno'],
        ];
        for (const [type, label] of cases) {
            const notice = classifyTeamNotice({
                command: { ...baseCommand, command_type: type, payload: {} },
                myActorId: MY,
                seenCommandIds: [],
            });
            expect(notice.title).toContain(label);
        }
    });
});

describe('groupTeamNotices', () => {
    const at = (iso, id) => ({ commandId: id, kind: 'single', title: TEAM_NOTICE_INVENTORY_TITLE, detail: `detalle ${id}`, actorLabel: 'Otro supervisor', at: iso });

    it('una ráfaga de 3 en la ventana produce UN aviso agrupado', () => {
        const group = groupTeamNotices([
            at('2026-10-18T10:00:00.000Z', 'a'),
            at('2026-10-18T10:00:01.000Z', 'b'),
            at('2026-10-18T10:00:02.000Z', 'c'),
        ], { windowMs: 5000 });
        expect(group.kind).toBe('group');
        expect(group.title).toBe('3 cambios de otro supervisor mientras no estabas');
        expect(group.detail).toContain('detalle a');
        expect(group.detail).toContain('y 1 más');
        expect(group.commandIds).toEqual(['a', 'b', 'c']);
    });

    it('un solo aviso pasa sin agrupar', () => {
        const single = at('2026-10-18T10:00:00.000Z', 'a');
        expect(groupTeamNotices([single], { windowMs: 5000 })).toBe(single);
    });

    it('un aviso viejo (fuera de la ventana) no se cuela en la ráfaga actual', () => {
        const group = groupTeamNotices([
            at('2026-10-18T09:00:00.000Z', 'viejo'),
            at('2026-10-18T10:00:00.000Z', 'a'),
            at('2026-10-18T10:00:01.000Z', 'b'),
        ], { windowMs: 5000 });
        expect(group.commandIds).toEqual(['a', 'b']);
        expect(group.title).toBe('2 cambios de otro supervisor mientras no estabas');
    });

    it('sin avisos devuelve null', () => {
        expect(groupTeamNotices([], { windowMs: 5000 })).toBeNull();
    });
});

describe('formatTeamNotice', () => {
    it('el tono de actividad de equipo es SIEMPRE informativo, nunca error', () => {
        const single = classifyTeamNotice({ command: baseCommand, myActorId: MY, seenCommandIds: [] });
        expect(formatTeamNotice(single).tone).toBe('info');
        const group = groupTeamNotices([single, { ...single, commandId: 'cmd-2' }], { windowMs: 5000 });
        expect(formatTeamNotice(group).tone).toBe('info');
    });

    it('el mensaje del grupo trae el contador y el detalle resumido', () => {
        const single = classifyTeamNotice({ command: baseCommand, myActorId: MY, seenCommandIds: [] });
        const group = groupTeamNotices([
            single,
            { ...single, commandId: 'cmd-2' },
            { ...single, commandId: 'cmd-3' },
        ], { windowMs: 5000 });
        const { message } = formatTeamNotice(group);
        expect(message).toContain('3 cambios de otro supervisor mientras no estabas');
    });
});

describe('appendSeenCommandId (memoria con tope)', () => {
    it('registra el visto y actualiza la marca de tiempo', () => {
        const state = appendSeenCommandId({ ids: [], lastAt: null }, 'cmd-1', { at: '2026-10-18T10:00:00.000Z' });
        expect(state.ids).toEqual(['cmd-1']);
        expect(state.lastAt).toBe('2026-10-18T10:00:00.000Z');
    });

    it('la lista nunca crece sin límite: conserva los más recientes', () => {
        let state = { ids: [], lastAt: null };
        for (let i = 0; i < TEAM_NOTICE_SEEN_MAX + 25; i += 1) {
            state = appendSeenCommandId(state, `cmd-${i}`);
        }
        expect(state.ids.length).toBe(TEAM_NOTICE_SEEN_MAX);
        expect(state.ids[state.ids.length - 1]).toBe(`cmd-${TEAM_NOTICE_SEEN_MAX + 24}`);
        expect(state.ids[0]).toBe('cmd-25');
    });

    it('repetir un commandId no duplica la entrada', () => {
        let state = appendSeenCommandId({ ids: [], lastAt: null }, 'cmd-1');
        state = appendSeenCommandId(state, 'cmd-1');
        expect(state.ids).toEqual(['cmd-1']);
    });
});
