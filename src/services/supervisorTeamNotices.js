// ── Propuesta 8: avisos de equipo (núcleo puro) ─────────────────────────────
// Cuando OTRO supervisor hace un cambio en mi caja, el equipo se entera: el
// negocio cambió mientras miraba a otro lado. Reglas de caballero (del plan):
//   1. Los cambios propios NO avisan: el tracker de resultados ya los anuncia.
//   2. Un cambio = un aviso: dedupe por commandId (Realtime + barrido no duplican).
//   3. Ráfagas agrupadas: "N cambios de otro supervisor mientras no estabas".
//   4. Nunca alarmista: el tono es SIEMPRE informativo ('info'); el error queda
//      reservado para fallos reales, no para que un compañero trabaje.
// Sin React ni red: la identidad comparable y los datos llegan por parámetros
// (Fase 0: actor_auth_id = auth.uid() del emisor; mi valor = session.user.id).

import { describeSupervisorCommand } from './supervisorCommandTracker';
import { COMMAND_TYPE_LABELS, getCommandDetails } from './supervisorControlService';

export const TEAM_NOTICE_INVENTORY_TITLE = 'Otro supervisor actualizó el inventario';
export const TEAM_NOTICE_ACTOR_LABEL = 'Otro supervisor';

// Ventana de ráfaga: los eventos que llegan juntos se colapsan en un aviso.
export const TEAM_NOTICE_GROUP_WINDOW_MS = 5000;

// Memoria de commandId vistos: clave localStorage del plan, con tope de tamaño
// (conserva los más recientes) para que nunca crezca sin límite.
export const TEAM_NOTICE_SEEN_KEY = 'pda_team_notice_seen_v1';
export const TEAM_NOTICE_SEEN_MAX = 200;

// Catch-up acotado ("mientras no estabas"): tope de minutos sin marca previa,
// límite de filas consultadas y mínimo entre barridos para no martillar.
export const TEAM_NOTICE_CATCHUP_MAX_AGE_MS = 30 * 60 * 1000;
export const TEAM_NOTICE_CATCHUP_MIN_INTERVAL_MS = 60 * 1000;
export const TEAM_NOTICE_CATCHUP_LIMIT = 20;

// Finales tristes: nada de esto cambió el negocio (cancel solo existe desde
// pending — máquina de estados 20261016110000), así que no anuncian "cambios".
export const TEAM_NOTICE_NEGATIVE_STATUSES = Object.freeze(['cancelled', 'failed', 'rejected', 'expired']);
export const TEAM_NOTICE_CATCHUP_STATUSES = Object.freeze(['pending', 'received', 'applied', 'applied_with_warnings']);

export function createSeenState() {
    return { ids: [], lastAt: null };
}

/**
 * Decide si un comando observado merece aviso de equipo y cómo se ve.
 * Devuelve null (silencio) cuando: falta actor_auth_id, el cambio es MÍO
 * (actor_auth_id === myActorId), el commandId ya se vio, o —en un UPDATE— el
 * comando terminó en un final triste que nunca tocó el negocio.
 */
export function classifyTeamNotice({ command, myActorId, seenCommandIds = [], eventType = null } = {}) {
    const commandId = String(command?.command_id || '').trim();
    const actorId = command?.actor_auth_id == null ? '' : String(command.actor_auth_id).trim();
    if (!commandId || !actorId) return null;
    // Sin identidad propia no hay comparación honesta: silencio, nunca adivinar.
    if (!myActorId || actorId === String(myActorId).trim()) return null;
    if (seenCommandIds.some(id => String(id) === commandId)) return null;
    if (eventType === 'UPDATE' && TEAM_NOTICE_NEGATIVE_STATUSES.includes(command?.status)) return null;

    const type = command.command_type;
    const payload = command.payload || {};
    // Título base para inventario; para el resto, la etiqueta legible del
    // catálogo del panel (COMMAND_TYPE_LABELS) — sin inventar textos nuevos.
    const title = type === 'supervisor.inventory.batch.adjust'
        ? TEAM_NOTICE_INVENTORY_TITLE
        : `Otro supervisor: ${COMMAND_TYPE_LABELS[type] || 'Orden del supervisor'}`;
    const parts = getCommandDetails({ command_type: type, payload });
    const detail = parts.length
        ? parts.join(' · ')
        : describeSupervisorCommand(type, payload);

    return {
        commandId,
        kind: 'single',
        title,
        detail,
        actorLabel: TEAM_NOTICE_ACTOR_LABEL,
        at: command.created_at || command.issued_at || null,
    };
}

/**
 * Colapsa una ráfaga en un solo aviso. Los avisos fuera de la ventana
 * (`windowMs` antes del más reciente) pertenecen a otra ráfaga y no se cuelan.
 * Un solo aviso pasa tal cual; sin avisos, null.
 */
export function groupTeamNotices(notices = [], { windowMs = TEAM_NOTICE_GROUP_WINDOW_MS } = {}) {
    const list = notices
        .filter(Boolean)
        .slice()
        .sort((a, b) => Date.parse(a.at || 0) - Date.parse(b.at || 0));
    if (!list.length) return null;

    const newest = list[list.length - 1];
    const anchorMs = Date.parse(newest.at || 0);
    const inWindow = windowMs > 0
        ? list.filter(notice => anchorMs - Date.parse(notice.at || 0) <= windowMs)
        : list;
    const burst = inWindow.length ? inWindow : list;
    if (burst.length === 1) return burst[0];

    const summary = burst.slice(0, 2).map(notice => notice.detail || notice.title);
    const rest = burst.length - summary.length;
    const detail = rest > 0
        ? `${summary.join(', ')} y ${rest} más`
        : summary.join(', ');

    return {
        commandIds: burst.map(notice => notice.commandId),
        kind: 'group',
        title: `${burst.length} cambios de otro supervisor mientras no estabas`,
        detail,
        actorLabel: TEAM_NOTICE_ACTOR_LABEL,
        at: newest.at || null,
    };
}

/** Traduce el aviso al toast. Tono SIEMPRE 'info': actividad, no error. */
export function formatTeamNotice(notice) {
    if (!notice) return null;
    return {
        message: notice.detail ? `${notice.title} — ${notice.detail}` : notice.title,
        tone: 'info',
    };
}

/** Registra un commandId como visto (con tope) y actualiza la marca de tiempo. */
export function appendSeenCommandId(state, commandId, { max = TEAM_NOTICE_SEEN_MAX, at = null } = {}) {
    const id = String(commandId || '').trim();
    const current = state && Array.isArray(state.ids) ? state : createSeenState();
    const stamped = at || current.lastAt;
    if (!id || current.ids.includes(id)) return { ids: [...current.ids], lastAt: stamped };
    const ids = [...current.ids, id].slice(-Math.max(1, max));
    return { ids, lastAt: stamped };
}

export function loadTeamNoticeSeen(storage = globalThis.localStorage) {
    try {
        const raw = storage?.getItem(TEAM_NOTICE_SEEN_KEY);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!parsed || !Array.isArray(parsed.ids)) return createSeenState();
        return {
            ids: parsed.ids.map(String).slice(-TEAM_NOTICE_SEEN_MAX),
            lastAt: typeof parsed.lastAt === 'string' ? parsed.lastAt : null,
        };
    } catch {
        return createSeenState();
    }
}

export function saveTeamNoticeSeen(state, storage = globalThis.localStorage) {
    try {
        storage?.setItem(TEAM_NOTICE_SEEN_KEY, JSON.stringify({
            ids: (state?.ids || []).map(String).slice(-TEAM_NOTICE_SEEN_MAX),
            lastAt: state?.lastAt || null,
        }));
    } catch { /* best effort: la memoria de vistos es una red de seguridad */ }
}

/**
 * Candidato de catch-up: actividad que cambió (o puede cambiar) el negocio.
 * Los finales tristes no cuentan como "cambios mientras no estabas".
 */
export function isTeamNoticeCatchUpCandidate(command) {
    return Boolean(command?.command_id) && TEAM_NOTICE_CATCHUP_STATUSES.includes(command?.status);
}

export default {
    TEAM_NOTICE_INVENTORY_TITLE,
    TEAM_NOTICE_ACTOR_LABEL,
    TEAM_NOTICE_GROUP_WINDOW_MS,
    TEAM_NOTICE_SEEN_KEY,
    TEAM_NOTICE_SEEN_MAX,
    TEAM_NOTICE_CATCHUP_MAX_AGE_MS,
    TEAM_NOTICE_CATCHUP_MIN_INTERVAL_MS,
    TEAM_NOTICE_CATCHUP_LIMIT,
    TEAM_NOTICE_NEGATIVE_STATUSES,
    TEAM_NOTICE_CATCHUP_STATUSES,
    createSeenState,
    classifyTeamNotice,
    groupTeamNotices,
    formatTeamNotice,
    appendSeenCommandId,
    loadTeamNoticeSeen,
    saveTeamNoticeSeen,
    isTeamNoticeCatchUpCandidate,
};
