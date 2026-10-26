/**
 * mockCajaSimulada.js — Caja SIMULADA para los e2e del Supervisor.
 *
 * Reemplaza la «caja controlada» física: ningún POS real, staging ni nube.
 * Todo el tráfico Supabase del navegador se intercepta y este arnés responde
 * como la caja vinculada:
 *
 *   - POST /auth/v1/signup (signInAnonymously) → sesión de dispositivo con un
 *     actorId estable; su user.id es el monitor autorizado del pairing.
 *   - GET  /rest/v1/device_pairings → vínculo monitor↔caja autorizado para ese
 *     actorId (sendSupervisorCommand exige monitor_auth_id === session.user.id).
 *   - POST /rest/v1/rpc/create_supervisor_command → registra la orden
 *     (status 'pending') tal como la envía el monitor.
 *   - GET  /rest/v1/supervisor_commands?command_id=eq.… → devuelve la fila con
 *     el estado actual. Sin filtro por command_id (avisos del panel) responde
 *     lista vacía. maybeSingle() espera listas y las desenvuelve a fila/null.
 *   - La caja "aplica" la orden applyAfterMs ms después de recibirla y publica
 *     el ACK como un UPDATE de supervisor_commands por Realtime (payload con la
 *     forma aplanada RealtimePostgresChangesPayload y la envuelta payload.data;
 *     si el cliente no la despatcha igual llega el ACK por la lectura final de
 *     waitForCommandAck a los 10 s, así el flujo nunca depende del canal).
 *   - Realtime → servidor Phoenix mínimo: responde phx_reply ok a phx_join y
 *     heartbeats para que los canales queden SUBSCRIBED. Sin eso el monitor se
 *     considera desconectado (isConnected) y bloquea las acciones remotas.
 *     (page.route NO intercepta WebSockets; routeWebSocket sí.)
 *
 * Debe instalarse DESPUÉS de neutralizeExternalNetwork() para que sus rutas
 * específicas tengan prioridad sobre el catch-all del arnés de red.
 */

export const CAJA_AUTH_ID = 'e2e-monitor-auth';
export const CAJA_MONITOR_DEVICE_ID = 'e2e-monitor-device';

/** JWT sintácticamente válido (el código de producto decodifica claims). */
function fakeJwt(sub) {
    const b64 = (obj) => Buffer.from(JSON.stringify(obj)).toString('base64url');
    const nowSec = Math.floor(Date.now() / 1000);
    const header = { alg: 'HS256', typ: 'JWT' };
    const payload = {
        sub,
        aud: 'authenticated',
        role: 'authenticated',
        email: '',
        iat: nowSec,
        exp: nowSec + 3600,
        session_id: 'e2e-session',
    };
    return `${b64(header)}.${b64(payload)}.e2e-signature`;
}

function sessionBody() {
    const nowSec = Math.floor(Date.now() / 1000);
    return {
        access_token: fakeJwt(CAJA_AUTH_ID),
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: nowSec + 3600,
        refresh_token: 'e2e-refresh-token',
        user: {
            id: CAJA_AUTH_ID,
            aud: 'authenticated',
            role: 'authenticated',
            email: '',
            phone: '',
            created_at: '2026-01-01T00:00:00.000Z',
            updated_at: '2026-01-01T00:00:00.000Z',
            app_metadata: { provider: 'anonymous', providers: ['anonymous'] },
            user_metadata: {},
            identities: [{
                id: CAJA_AUTH_ID,
                user_id: CAJA_AUTH_ID,
                identity_id: 'e2e-identity',
                provider: 'anonymous',
                created_at: '2026-01-01T00:00:00.000Z',
                updated_at: '2026-01-01T00:00:00.000Z',
            }],
            is_anonymous: true,
        },
    };
}

const PAIRING_ROW = {
    monitor_device_id: CAJA_MONITOR_DEVICE_ID,
    monitor_auth_id: CAJA_AUTH_ID,
    paired_at: '2026-01-01T00:00:00.000Z',
    revoked_at: null,
    token_expires_at: '2027-01-01T00:00:00.000Z',
    monitor_device_id_2: null,
    monitor_auth_id_2: null,
    paired_at_2: null,
};

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

/**
 * Instala la caja simulada en la página. Devuelve un handle con el registro de
 * órdenes recibidas:
 *   - caja.received       → filas crudas recibidas (con su ack_payload),
 *   - caja.commandTypes() → ['supervisor.product.create', …] en orden.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ applyAfterMs?: number, warnings?: string[] }} options
 *        applyAfterMs: retardo con el que la caja "aplica" la orden (simula el
 *        procesamiento real antes del ACK). warnings: reservas que viajan en el
 *        ACK (prueba el aviso ámbar del tracker).
 */
export async function installCajaSimulada(page, { applyAfterMs = 400, warnings = [] } = {}) {
    const received = [];
    const sockets = new Set();

    // ── Realtime simulado: servidor Phoenix mínimo ────────────────────────────
    // Responde phx_reply ok a todo mensaje con ref (phx_join, heartbeat…) para
    // que los canales queden SUBSCRIBED. Acepta el formato JSON (vsn 1.0) y el
    // de tuplas (vsn 2.0: [join_ref, ref, topic, event, payload]).
    await page.routeWebSocket(/supabase\.(co|in)\/realtime/i, (ws) => {
        sockets.add(ws);
        ws.onClose(() => sockets.delete(ws));
        ws.onMessage((raw) => {
            let msg;
            try { msg = JSON.parse(String(raw)); } catch { return; }
            let reply;
            if (Array.isArray(msg)) {
                const [joinRef, ref, topic, , payload] = msg;
                if (!ref) return;
                reply = JSON.stringify([joinRef, ref, topic, 'phx_reply', { status: 'ok', response: payload?.config ? {} : {} }]);
            } else if (msg && typeof msg === 'object' && msg.ref) {
                reply = JSON.stringify({
                    topic: msg.topic,
                    event: 'phx_reply',
                    ref: msg.ref,
                    join_ref: msg.join_ref ?? null,
                    payload: { status: 'ok', response: {} },
                });
            } else {
                return;
            }
            try { ws.send(reply); } catch { /* socket caído */ }
        });
    });

    const broadcastCommandUpdate = (row) => {
        const ts = new Date().toISOString();
        const record = {
            command_id: row.command_id,
            status: row.status,
            ack_payload: row.ack_payload,
            error_message: row.error_message,
        };
        const event = {
            topic: `realtime:supervisor-ack:${row.command_id}`,
            event: 'postgres_changes',
            ref: null,
            join_ref: null,
            payload: {
                // Forma envuelta (walrus/realtime server).
                ids: [1],
                columns: [
                    { name: 'command_id', type: 'text' },
                    { name: 'status', type: 'text' },
                    { name: 'ack_payload', type: 'jsonb' },
                    { name: 'error_message', type: 'text' },
                ],
                commit_timestamp: ts,
                errors: [],
                schema: 'public',
                table: 'supervisor_commands',
                data: { type: 'UPDATE', record, old: { command_id: row.command_id }, errors: null },
                // El filtro del binding compara payload.event (rama sin id del
                // SDK) y payload.data.type (rama con id): ambos cubiertos.
                event: 'UPDATE',
                // Forma aplanada (RealtimePostgresChangesPayload del SDK).
                eventType: 'UPDATE',
                new: record,
                old: { command_id: row.command_id },
            },
        };
        const wire = JSON.stringify(event);
        sockets.forEach((ws) => {
            try { ws.send(wire); } catch { /* socket caído */ }
        });
    };

    const applyRow = (row) => {
        row.status = 'applied';
        row.ack_payload = { applied: true, warnings, appliedAt: new Date().toISOString() };
        broadcastCommandUpdate(row);
    };

    // ── Auth: sesión de dispositivo (signInAnonymously → POST /auth/v1/signup) ─
    await page.route(/\/auth\/v1\//, (route) => route.fulfill(json(sessionBody())));

    // ── Pairing: el monitor autorizado es exactamente la sesión de arriba ─────
    await page.route(/\/rest\/v1\/device_pairings(\?|$)/, (route) => route.fulfill(json([PAIRING_ROW])));

    // ── Alta de comando: la caja lo recibe pendiente y lo aplica tras un retardo ─
    await page.route(/\/rest\/v1\/rpc\/create_supervisor_command(\?|$)/, async (route) => {
        const body = route.request().postDataJSON() || {};
        const row = {
            command_id: body.p_command_id,
            target_device_id: body.p_target_device_id,
            command_type: body.p_command_type,
            status: 'pending',
            issued_at: body.p_issued_at,
            expires_at: body.p_expires_at,
            payload: body.p_payload,
            schema_version: 1,
            ack_payload: null,
            error_message: null,
        };
        received.push(row);
        setTimeout(() => applyRow(row), applyAfterMs);
        await route.fulfill(json([row]));
    });

    // ── Lecturas/inspección del comando: estado actual de la fila ─────────────
    await page.route(/\/rest\/v1\/supervisor_commands(\?|$)/, async (route) => {
        const url = new URL(route.request().url());
        const commandId = (url.searchParams.get('command_id') || '').replace(/^eq\./, '');
        const entry = received.find((row) => row.command_id === commandId);
        // Sin filtro por command_id o comando desconocido: sin filas.
        await route.fulfill(json(entry ? [entry] : []));
    });

    return {
        received,
        commandTypes: () => received.map((row) => row.command_type),
    };
}
