import { useCallback, useEffect, useRef, useState } from 'react';
import { supabaseCloud } from '../config/supabaseCloud';
import {
    CONTROL_PAGE_SIZE,
    CONTROL_POLL_INTERVAL_MS,
    cancelSupervisorCommand,
    fetchSupervisorControlCommands,
    fetchSupervisorControlCounts,
    fetchSupervisorControlDetail,
} from '../services/supervisorControlService';
import { sendSupervisorCommand } from '../services/supervisorCommandService';

export function useSupervisorControl({ targetDeviceId, enabled = false } = {}) {
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
    const refreshTimerRef = useRef(null);

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

    useEffect(() => {
        if (!enabled || !targetDeviceId) {
            setCommands([]);
            setCounts({ total: 0, pending: 0, applied: 0, warnings: 0, failed: 0, cancelled: 0 });
            setSelectedCommand(null);
            return undefined;
        }
        refresh({ nextPage: 0 });
        const channel = supabaseCloud?.channel(`supervisor-control:${targetDeviceId}`)
            .on('postgres_changes', {
                event: '*', schema: 'public', table: 'supervisor_commands',
                filter: `target_device_id=eq.${targetDeviceId}`,
            }, ({ new: row }) => {
                if (!row?.command_id) return;
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
        if (!result.ok) setError(result.error);
        else await refresh({ silent: true });
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
        refresh,
        openDetail,
        closeDetail: () => setSelectedCommand(null),
        cancel,
        retry,
        setPage: nextPage => refresh({ nextPage }),
    };
}

export default useSupervisorControl;

