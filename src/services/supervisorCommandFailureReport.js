// ── Caja negra de órdenes del supervisor (2026-11-19, caso Bodega mani) ─────
// Cuando una orden NO llega a crearse (la nube la rechaza, el monitor no está
// autorizado o el propio cliente la descarta por inválida), no queda rastro en
// supervisor_commands. Este módulo la anota en supervisor_command_failures vía
// la RPC report_supervisor_command_failure: el servidor agrupa repeticiones y
// agrega el motivo exacto (p. ej. «línea 1: campo no permitido: productName»).
//
// Reglas:
//   - Nunca lanza ni bloquea: es «disparar y olvidar».
//   - Un mismo error se reporta como mucho una vez cada REPORT_THROTTLE_MS por
//     sesión de la app (la cola reintenta cada 30 s; el contador del servidor
//     es aproximado a propósito para no duplicar el tráfico).
//   - Errores de red NO se reportan: no son fallos de la orden y, sin red,
//     tampoco llegaría el reporte.

export const REPORT_THROTTLE_MS = 5 * 60_000;

const lastReportAt = new Map();

const isNetworkLike = (message) => /failed to fetch|network|networkerror|timeout|load failed|offline/i.test(String(message || ''));

export function shouldReportFailure({ status, error } = {}) {
    if (!['rejected', 'invalid', 'unauthorized'].includes(status)) return false;
    return !isNetworkLike(error);
}

/** Solo para pruebas. */
export function resetSupervisorFailureReportThrottle() {
    lastReportAt.clear();
}

export function reportSupervisorCommandFailure({
    client,
    targetDeviceId = null,
    monitorDeviceId = null,
    type = null,
    status,
    error,
    commandId = null,
    payload = null,
    appVersion = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_APP_VERSION) || null,
    now = Date.now(),
} = {}) {
    try {
        if (!client?.rpc || !shouldReportFailure({ status, error })) return Promise.resolve(false);
        const key = [targetDeviceId, type, status, error].join('|');
        const previous = lastReportAt.get(key);
        if (previous != null && now - previous < REPORT_THROTTLE_MS) return Promise.resolve(false);
        lastReportAt.set(key, now);

        return Promise.resolve(client.rpc('report_supervisor_command_failure', {
            p_target_device_id: targetDeviceId,
            p_monitor_device_id: monitorDeviceId,
            p_command_type: type,
            p_stage: status === 'rejected' ? 'rechazada_por_nube' : status === 'unauthorized' ? 'monitor_no_autorizado' : 'invalida_en_monitor',
            p_error_message: String(error || ''),
            p_command_id: commandId,
            p_payload: payload && typeof payload === 'object' ? payload : null,
            p_app_version: appVersion,
        }))
            .then(response => !response?.error && response?.data?.ok !== false)
            .catch(() => false);
    } catch {
        return Promise.resolve(false);
    }
}

export default { reportSupervisorCommandFailure, shouldReportFailure, REPORT_THROTTLE_MS };
