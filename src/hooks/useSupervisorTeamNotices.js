import { useCallback, useEffect, useRef } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import { ensureSupervisorSession } from '../services/supervisorAuth';
import { isCommandOutcomeOwned } from '../services/supervisorCommandTracker';
import { showToast } from '../components/Toast';
import {
    TEAM_NOTICE_CATCHUP_LIMIT,
    TEAM_NOTICE_CATCHUP_MAX_AGE_MS,
    TEAM_NOTICE_CATCHUP_MIN_INTERVAL_MS,
    TEAM_NOTICE_GROUP_WINDOW_MS,
    appendSeenCommandId,
    classifyTeamNotice,
    formatTeamNotice,
    groupTeamNotices,
    isTeamNoticeCatchUpCandidate,
    loadTeamNoticeSeen,
    saveTeamNoticeSeen,
} from '../services/supervisorTeamNotices';

/**
 * Avisos de equipo (propuesta 8): cuando OTRO supervisor hace un cambio en mi
 * caja, el equipo lo sabe aunque la pestaña Control esté cerrada.
 *
 * El canal Realtime NO vive aquí: lo mantiene `useSupervisorControl` (canal
 * único de `supervisor_commands`) y nos reenvía cada fila por `handleCommandRow`
 * — así nunca se duplica el canal. Este hook solo clasifica (núcleo puro
 * `supervisorTeamNotices`), deduplica por commandId, agrupa ráfagas y emite el
 * toast; más un catch-up acotado ("mientras no estabas") al volver a primer
 * plano o reconectar.
 *
 * Fase 0 (contrato confirmado): `actor_auth_id` es el `auth.uid()` del emisor y
 * mi valor comparable es `session.user.id` de `ensureSupervisorSession()`.
 */
export function useSupervisorTeamNotices({ targetDeviceId } = {}) {
    const bufferRef = useRef([]);
    const flushTimerRef = useRef(null);
    const actorIdRef = useRef(null);
    const actorPromiseRef = useRef(null);
    const lastCatchUpAtRef = useRef(0);
    const seenStateRef = useRef(null);
    if (seenStateRef.current === null) seenStateRef.current = loadTeamNoticeSeen();

    // Identidad comparable del monitor (Fase 0). Se resuelve UNA vez y se cachea:
    // sin identidad no hay comparación honesta y no se avisa (nunca adivinar).
    const resolveActorId = useCallback(async () => {
        if (actorIdRef.current) return actorIdRef.current;
        if (!actorPromiseRef.current) {
            actorPromiseRef.current = ensureSupervisorSession()
                .then(({ session }) => {
                    actorIdRef.current = session?.user?.id || null;
                    return actorIdRef.current;
                })
                .catch(() => null);
        }
        return actorPromiseRef.current;
    }, []);

    const emit = useCallback((notice) => {
        const formatted = formatTeamNotice(notice);
        if (formatted) showToast(formatted.message, formatted.tone);
    }, []);

    const flushBuffer = useCallback(() => {
        if (flushTimerRef.current) {
            clearTimeout(flushTimerRef.current);
            flushTimerRef.current = null;
        }
        const notices = bufferRef.current;
        bufferRef.current = [];
        const notice = groupTeamNotices(notices, { windowMs: TEAM_NOTICE_GROUP_WINDOW_MS });
        if (notice) emit(notice);
    }, [emit]);

    /**
     * Cada fila de `supervisor_commands` que llega por el canal del panel.
     * `eventType` distingue INSERT de UPDATE: un UPDATE con final triste
     * (cancelled/failed/…) nunca anuncia "actualizó el inventario".
     */
    const handleCommandRow = useCallback(async (row, { eventType = null } = {}) => {
        const commandId = String(row?.command_id || '').trim();
        if (!commandId) return;

        // "Un cambio = un aviso": lo ya visto jamás se anuncia otra vez, aunque
        // llegue por Realtime Y además aparezca en un barrido posterior.
        if (seenStateRef.current.ids.includes(commandId)) return;

        // Mis comandos los anuncia el tracker de resultados; aquí solo se marca
        // como visto para que el catch-up no lo repita.
        if (isCommandOutcomeOwned(commandId)) {
            seenStateRef.current = appendSeenCommandId(seenStateRef.current, commandId, { at: row.created_at || null });
            saveTeamNoticeSeen(seenStateRef.current);
            return;
        }

        const myActorId = await resolveActorId();
        const notice = classifyTeamNotice({
            command: row,
            myActorId,
            seenCommandIds: seenStateRef.current.ids,
            eventType,
        });
        if (!notice) return;

        seenStateRef.current = appendSeenCommandId(seenStateRef.current, commandId, { at: notice.at || null });
        saveTeamNoticeSeen(seenStateRef.current);

        // Ráfaga: los eventos que llegan juntos esperan UNA ventana corta y se
        // emiten como un solo aviso agrupado, no como N toasts seguidos.
        bufferRef.current = [...bufferRef.current, notice];
        if (!flushTimerRef.current) {
            flushTimerRef.current = setTimeout(() => {
                flushTimerRef.current = null;
                flushBuffer();
            }, TEAM_NOTICE_GROUP_WINDOW_MS);
        }
    }, [flushBuffer, resolveActorId]);

    /**
     * Catch-up acotado ("mientras no estabas"): consulta los comandos de mi caja
     * emitidos por otros actores desde el último aviso visto (o un tope de
     * minutos si no hay marca) y emite UN aviso agrupado si hubo actividad.
     * Nunca un despliegue histórico, y la memoria de vistos evita repetirlo.
     */
    const runCatchUp = useCallback(async () => {
        if (!targetDeviceId || !supabaseCloud) return { ok: false, skipped: true };

        const now = Date.now();
        if (now - lastCatchUpAtRef.current < TEAM_NOTICE_CATCHUP_MIN_INTERVAL_MS) {
            return { ok: true, skipped: true };
        }
        lastCatchUpAtRef.current = now;

        const myActorId = await resolveActorId();
        if (!myActorId) return { ok: false, skipped: true };

        const seen = seenStateRef.current;
        const sinceMs = seen.lastAt
            ? Math.max(0, Date.parse(seen.lastAt) - 60 * 1000) // pequeño solape; el dedupe cubre el resto
            : now - TEAM_NOTICE_CATCHUP_MAX_AGE_MS;

        try {
            const { data, error } = await supabaseCloud
                .from('supervisor_commands')
                .select('command_id,actor_auth_id,command_type,status,payload,created_at,issued_at')
                .eq('target_device_id', targetDeviceId)
                .gte('created_at', new Date(sinceMs).toISOString())
                .order('created_at', { ascending: true })
                .limit(TEAM_NOTICE_CATCHUP_LIMIT);
            if (error) return { ok: false, skipped: true, error };

            const notices = [];
            for (const row of data || []) {
                const commandId = String(row?.command_id || '').trim();
                if (!commandId || seenStateRef.current.ids.includes(commandId)) continue;
                if (isCommandOutcomeOwned(commandId)) {
                    seenStateRef.current = appendSeenCommandId(seenStateRef.current, commandId, { at: row.created_at || null });
                    continue;
                }
                // Solo actividad que cambió (o puede cambiar) el negocio: un
                // comando cancelado o fallido no es un "cambio mientras no estabas".
                if (!isTeamNoticeCatchUpCandidate(row)) continue;
                const notice = classifyTeamNotice({
                    command: row,
                    myActorId,
                    seenCommandIds: seenStateRef.current.ids,
                    eventType: 'INSERT',
                });
                if (!notice) continue;
                seenStateRef.current = appendSeenCommandId(seenStateRef.current, commandId, { at: notice.at || null });
                notices.push(notice);
            }
            saveTeamNoticeSeen(seenStateRef.current);

            // windowMs 0 = sin recorte temporal: el catch-up ya trae su ventana.
            const grouped = groupTeamNotices(notices, { windowMs: 0 });
            if (grouped) emit(grouped);
            return { ok: true, announced: notices.length };
        } catch {
            // Sin conexión o sin permisos: silencio digno, sin errores en consola.
            return { ok: false, skipped: true };
        }
    }, [emit, resolveActorId, targetDeviceId]);

    useEffect(() => {
        if (!targetDeviceId) return undefined;

        void runCatchUp();

        // "Mientras no estabas": al volver a primer plano o reconectar.
        const onVisible = () => {
            if (document.visibilityState === 'visible') void runCatchUp();
        };
        const onOnline = () => void runCatchUp();
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('online', onOnline);

        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('online', onOnline);
            // Si queda una ráfaga pendiente al desmontar, se emite: los avisos
            // ya están marcados como vistos y no deben perderse en silencio.
            if (bufferRef.current.length) flushBuffer();
        };
    }, [flushBuffer, runCatchUp, targetDeviceId]);

    return { handleCommandRow, runCatchUp };
}

export default useSupervisorTeamNotices;
