/**
 * Monitor: envío de una venta remota y espera de su resultado (G9).
 *
 * El vendedor solo ve «registrada» con un ACK applied/applied_with_warnings.
 * La espera normal de órdenes (10 s) no basta para una venta, así que aquí:
 *   - se espera el ACK en vivo y, si tarda, se consulta el estado de la orden;
 *   - si la caja no la TOMÓ dentro de su ventana (2 min), se cancela en el
 *     servidor y se informa que la venta no se registró;
 *   - si la caja ya la tomó ('received'), NUNCA se da por perdida: se sigue
 *     esperando (una orden tomada no caduca).
 *   - el vendedor puede cancelarla mientras la caja NO la haya tomado: el
 *     servidor solo anula órdenes 'pending', así que una venta que la caja ya
 *     está registrando no se puede cancelar (se avisa y se sigue esperando).
 */
import { supabaseCloud } from '../config/supabaseCloud.js';
import { inspectSupervisorCommandState, sendSupervisorCommand } from './supervisorCommandService.js';
import { cancelSupervisorCommand } from './supervisorControlService.js';

export const REMOTE_SALE_TYPE = 'supervisor.sale.create';
export const REMOTE_SALE_POLL_MS = 2500;
export const REMOTE_SALE_MAX_WAIT_MS = 15 * 60_000;

const TERMINAL_OK = new Set(['applied', 'applied_with_warnings']);

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Normaliza el resultado para la pantalla del vendedor. */
export function toRemoteSaleOutcome(ack) {
    if (!ack) return { phase: 'unresolved', error: 'Sin respuesta de la caja principal' };
    if (TERMINAL_OK.has(ack.status)) {
        return {
            phase: 'registered',
            status: ack.status,
            saleNumber: ack.ack?.saleNumber ?? null,
            sale: ack.ack?.sale ?? null,
            warnings: ack.ack?.warnings || [],
            duplicate: ack.ack?.duplicate === true,
        };
    }
    if (ack.status === 'rejected') {
        return {
            phase: 'rejected',
            error: ack.ack?.error || ack.error || 'La caja principal rechazó la venta',
            code: ack.ack?.code || null,
            newTotalUsd: ack.ack?.newTotalUsd ?? null,
            priceChanges: ack.ack?.priceChanges || [],
        };
    }
    if (ack.status === 'cancelled' && ack.byUser) {
        return { phase: 'not_registered', error: 'Cancelaste la venta antes de que la caja la tomara. No se registró ni se cobró.' };
    }
    if (ack.status === 'cancelled') {
        return { phase: 'not_registered', error: 'La caja principal no tomó la venta a tiempo. No se registró: puedes volver a enviarla.' };
    }
    // failed: la caja no pudo procesarla (p. ej. versión vieja sin soporte).
    const unsupported = /no soportado/i.test(ack.error || '');
    return {
        phase: 'failed',
        error: unsupported
            ? 'La caja principal no tiene la versión con ventas remotas. Actualízala (recarga la app) y vuelve a enviar.'
            : (ack.error || 'La caja principal no pudo registrar la venta'),
    };
}

/**
 * Espera el resultado final de una venta ya enviada.
 * @param {object} p
 * @param {string} p.commandId
 * @param {Promise|null} p.ackPromise  ACK en vivo devuelto por sendSupervisorCommand.
 * @param {Function} [p.onProgress]    ('waiting'|'received'|'cancel_refused') para la pantalla.
 * @param {Function} [p.isCancelRequested] true cuando el vendedor pidió cancelar.
 */
export async function waitRemoteSaleOutcome({
    commandId,
    ackPromise = null,
    onProgress = () => {},
    isCancelRequested = () => false,
    inspect = (id) => inspectSupervisorCommandState(id, { client: supabaseCloud }),
    cancel = (id, reason = 'Venta remota: la caja no la tomó a tiempo') => cancelSupervisorCommand({ commandId: id, reason }),
    sleep = defaultSleep,
    now = () => Date.now(),
    pollMs = REMOTE_SALE_POLL_MS,
    maxWaitMs = REMOTE_SALE_MAX_WAIT_MS,
}) {
    // Mientras llega el ACK en vivo, un pedido de cancelar no espera los 10 s.
    let stopWatching = false;
    const cancelWatch = (async () => {
        while (!stopWatching && !isCancelRequested()) await defaultSleep(250);
        return null;
    })();
    if (ackPromise) {
        const live = await Promise.race([ackPromise.catch(() => null), cancelWatch]);
        if (live && live.status && live.status !== 'timeout') { stopWatching = true; return toRemoteSaleOutcome(live); }
    }
    stopWatching = true;

    const deadline = now() + maxWaitMs;
    let announcedReceived = false;
    let cancelHandled = false;
    while (now() < deadline) {
        if (!cancelHandled && isCancelRequested()) {
            cancelHandled = true;
            const cancelled = await cancel(commandId, 'Venta remota: cancelada por el vendedor').catch(() => ({ ok: false }));
            if (cancelled?.ok) return toRemoteSaleOutcome({ status: 'cancelled', byUser: true });
            // La caja ya la tomó (o terminó): se sigue esperando su resultado real.
            onProgress('cancel_refused');
        }
        let state;
        try {
            state = await inspect(commandId);
        } catch {
            state = { state: 'unknown' };
        }

        if (state.state === 'terminal') return toRemoteSaleOutcome(state.ack);

        if (state.state === 'expired') {
            // Nadie la tomó: se cancela para que nunca se aplique tarde.
            const cancelled = await cancel(commandId).catch(() => ({ ok: false }));
            if (cancelled?.ok) return toRemoteSaleOutcome({ status: 'cancelled' });
            // La cancelación falló porque la caja la tomó justo ahora: seguir esperando.
        } else if (state.state === 'active' && state.row?.status === 'received' && !announcedReceived) {
            announcedReceived = true;
            onProgress('received');
        } else if (state.state === 'absent') {
            return { phase: 'failed', error: 'La venta no llegó al servidor. No se registró: vuelve a enviarla.' };
        }
        await sleep(pollMs);
    }
    return {
        phase: 'unresolved',
        error: 'La caja principal aún no confirma la venta. No la vuelvas a cobrar: revisa en Control o en la caja.',
    };
}

/** Envía la venta. Devuelve `{ ok, commandId, ackPromise }` o `{ ok:false, error }`. */
export async function sendRemoteSale({ targetDeviceId, payload, send = sendSupervisorCommand }) {
    try {
        const result = await send({ type: REMOTE_SALE_TYPE, targetDeviceId, payload });
        if (!result?.ok) {
            return {
                ok: false,
                error: result?.status === 'disabled'
                    ? 'Las ventas remotas no están habilitadas.'
                    : (result?.error || 'No se pudo enviar la venta'),
                status: result?.status || 'failed',
            };
        }
        return result;
    } catch (error) {
        return { ok: false, status: 'failed', error: error?.message || 'No se pudo enviar la venta' };
    }
}
