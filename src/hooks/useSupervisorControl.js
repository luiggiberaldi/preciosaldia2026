import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import {
    CONTROL_PAGE_SIZE,
    CONTROL_POLL_INTERVAL_MS,
    CONTROL_STATUS,
    cancelSupervisorCommand,
    fetchSupervisorControlCommands,
    fetchSupervisorControlCounts,
    fetchSupervisorControlDetail,
    getControlStatus,
} from '../services/supervisorControlService';
import { sendSupervisorCommand } from '../services/supervisorCommandService';
import { describeSupervisorCommand, trackSupervisorCommand } from '../services/supervisorCommandTracker';
import { getVerifications, readVerifications } from '../services/supervisorCommandDiagnostics';

export function useSupervisorControl({ targetDeviceId, enabled = false, onCommandRow = null } = {}) {
    const [commands, setCommands] = useState([]);
    const [counts, setCounts] = useState({ total: 0, pending: 0, applied: 0, warnings: 0, failed: 0, cancelled: 0 });
    const [page, setPage] = useState(0);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(false);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState('');
    const [selectedCommand, setSelectedCommand] = useState(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [actionId, setActionId] = useState(null);
    // Sellos de verificación (propuesta 7): uno por commandId, la última gana.
    const [verifications, setVerifications] = useState([]);
    const refreshTimerRef = useRef(null);
    // El canal de comandos vive fuera del gating de la pestaña Control (propuesta
    // 8: avisos de equipo con Control cerrado). Estas refs evitan re-crear el
    // canal y capturan el último callback/flag en cada render.
    const onCommandRowRef = useRef(onCommandRow);
    onCommandRowRef.current = onCommandRow;
    const enabledRef = useRef(enabled);
    enabledRef.current = enabled;

    const refreshVerifications = useCallback(() => {
        setVerifications(getVerifications());
    }, []);

    const refresh = useCallback(async ({ silent = false, nextPage = page } = {}) => {
        if (!enabled || !targetDeviceId) return;
        if (silent) setRefreshing(true); else setLoading(true);
        setError('');
        const [listResult, countResult] = await Promise.all([
            fetchSupervisorControlCommands({ targetDeviceId, page: nextPage, pageSize: CONTROL_PAGE_SIZE }),
            fetchSupervisorControlCounts({ targetDeviceId }),
        ]);
        if (listResult.error) setError(listResult.error.message || 'No se pudo cargar Control');
        else {
            setCommands(listResult.data);
            setTotal(listResult.count);
            setPage(nextPage);
        }
        if (!countResult.error && countResult.counts) {
            const raw = countResult.counts;
            setCounts({
                total: Number(raw.total || 0),
                pending: Number(raw.pending || 0),
                applied: Number(raw.applied || 0),
                warnings: Number(raw.warnings || raw.applied_with_warnings || 0),
                failed: Number(raw.failed || 0) + Number(raw.rejected || 0),
                cancelled: Number(raw.cancelled || 0),
            });
        } else {
            // Compatibilidad mientras la migración del RPC de conteos aún no
            // esté aplicada: el listado sigue funcionando con un conteo local
            // de la página actual, sin abrir otra consulta pesada.
            const pageCounts = listResult.data.reduce((result, command) => {
                const status = command.status;
                result.total += 1;
                if (status === 'pending') result.pending += 1;
                if (status === 'applied') result.applied += 1;
                if (status === 'applied_with_warnings') result.warnings += 1;
                if (status === 'failed' || status === 'rejected') result.failed += 1;
                if (status === 'cancelled') result.cancelled += 1;
                return result;
            }, { total: listResult.count, pending: 0, applied: 0, warnings: 0, failed: 0, cancelled: 0 });
            setCounts(pageCounts);
        }
        setLoading(false);
        setRefreshing(false);
    }, [enabled, page, targetDeviceId]);

    // Canal ÚNICO de `supervisor_commands`: vive mientras hay caja vinculada,
    // sin depender de la pestaña Control (propuesta 8). Cada evento se reenvía
    // por onCommandRow (avisos de equipo) y solo pinta la lista cuando la
    // pestaña está abierta (enabledRef). Abrir/cerrar Control no re-crea ni
    // duplica el canal.
    useEffect(() => {
        if (!targetDeviceId) return undefined;
        const channel = supabaseCloud?.channel(`supervisor-control:${targetDeviceId}`)
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'supervisor_commands',
                filter: `target_device_id=eq.${targetDeviceId}`,
            }, (payload) => {
                const row = payload?.new;
                onCommandRowRef.current?.(row, { eventType: payload?.eventType || null });
                if (!row?.command_id || !enabledRef.current) return;
                setCommands(current => {
                    const without = current.filter(command => command.command_id !== row.command_id);
                    return [row, ...without].sort((a, b) => new Date(b.created_at || b.issued_at) - new Date(a.created_at || a.issued_at)).slice(0, CONTROL_PAGE_SIZE);
                });
                // Los conteos son baratos y solo se consultan cuando cambia una orden.
                fetchSupervisorControlCounts({ targetDeviceId }).then(result => {
                    if (!result.error && result.counts) {
                        const raw = result.counts;
                        setCounts({ total: Number(raw.total || 0), pending: Number(raw.pending || 0), applied: Number(raw.applied || 0), warnings: Number(raw.warnings || raw.applied_with_warnings || 0), failed: Number(raw.failed || 0) + Number(raw.rejected || 0), cancelled: Number(raw.cancelled || 0) });
                    }
                });
            })
            .subscribe();

        return () => {
            if (channel) supabaseCloud.removeChannel(channel).catch(() => {});
        };
    }, [targetDeviceId]);

    useEffect(() => {
        if (!enabled || !targetDeviceId) {
            setCommands([]);
            setCounts({ total: 0, pending: 0, applied: 0, warnings: 0, failed: 0, cancelled: 0 });
            setSelectedCommand(null);
            setVerifications([]);
            return undefined;
        }
        refresh({ nextPage: 0 });
        // Los sellos persistidos se restauran al abrir; los nuevos se leen con
        // refreshVerifications() tras cada evaluación del eco.
        readVerifications().then(entries => setVerifications(entries)).catch(() => {});
        return undefined;
    }, [enabled, targetDeviceId]);

    useEffect(() => {
        if (!enabled || !targetDeviceId || counts.pending <= 0) return undefined;
        refreshTimerRef.current = window.setInterval(() => refresh({ silent: true }), CONTROL_POLL_INTERVAL_MS);
        return () => window.clearInterval(refreshTimerRef.current);
    }, [counts.pending, enabled, refresh, targetDeviceId]);

    const openDetail = useCallback(async (command) => {
        setSelectedCommand(command);
        setDetailLoading(true);
        const result = await fetchSupervisorControlDetail({ commandId: command.command_id });
        if (!result.error && result.data) setSelectedCommand(result.data);
        setDetailLoading(false);
    }, []);

    const cancel = useCallback(async (commandId) => {
        setActionId(commandId);
        const result = await cancelSupervisorCommand({ commandId });
        if (!result.ok) setError(result.error);
        else await refresh({ silent: true });
        setActionId(null);
        return result;
    }, [refresh]);

    // Propuesta 6 ("poder arrepentirse"): anula TODOS los pendientes propios.
    // Nunca promete más de lo que el RPC confirma: cada comando devuelve su
    // resultado real y lo que la caja ya tomó se reporta como no anulado.
    const cancelAll = useCallback(async () => {
        const pending = commands.filter(command => getControlStatus(command) === CONTROL_STATUS.PENDING);
        let cancelled = 0;
        const notCancelled = [];
        for (const command of pending) {
            const result = await cancelSupervisorCommand({ commandId: command.command_id });
            if (result.ok) cancelled += 1;
            else notCancelled.push({
                commandId: command.command_id,
                status: result.status || 'unknown',
                error: result.error,
            });
        }
        if (pending.length) await refresh({ silent: true });
        return { total: pending.length, cancelled, notCancelled };
    }, [commands, refresh]);

    const retry = useCallback(async (command) => {
        if (!command?.payload || !['failed', 'rejected'].includes(command.status)) {
            return { ok: false, error: 'Solo se pueden reintentar órdenes fallidas o rechazadas' };
        }
        setActionId(command.command_id);
        const result = await sendSupervisorCommand({
            type: command.command_type,
            targetDeviceId: command.target_device_id,
            payload: command.payload,
        });
        if (!result.ok) {
            setError(result.error);
        } else {
            // "Confirma y sigue": el reintento también termina en aviso final.
            trackSupervisorCommand({
                commandId: result.commandId,
                type: command.command_type,
                payload: command.payload,
                label: `el reintento de ${describeSupervisorCommand(command.command_type, command.payload)}`,
                ackPromise: result.ackPromise,
            });
            await refresh({ silent: true });
        }
        setActionId(null);
        return result;
    }, [refresh]);

    return {
        commands,
        counts,
        page,
        pageSize: CONTROL_PAGE_SIZE,
        total,
        loading,
        refreshing,
        error,
        selectedCommand,
        detailLoading,
        actionId,
        verifications,
        refresh,
        refreshVerifications,
        openDetail,
        closeDetail: () => setSelectedCommand(null),
        cancel,
        cancelAll,
        retry,
        setPage: nextPage => refresh({ nextPage }),
    };
}

export default useSupervisorControl;

