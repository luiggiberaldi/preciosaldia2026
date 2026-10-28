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
 * Proveedores y facturas (Fase 2): con la opción `ledger` la caja simulada
 * lleva su estado real de proveedores/facturas y las órdenes
 * `supervisor.supplier.*` / `supervisor.invoice.*` se aplican con los MISMOS
 * aplicadores puros del receptor (supervisorSupplierCommand), incluidos los
 * rechazos CIERTOS de regla de negocio. Tras aplicar, la caja publica el eco
 * como en producción: docs sync_documents (snapshot `bodega_suppliers_v1` +
 * familia `bodega_supplier_invoices_v1:<año>`, envueltos en buildSyncEnvelope)
 * servidos por GET /rest/v1/sync_documents y empujados por Realtime a los
 * canales `realtime:monitor:*` que se hayan unido.
 *
 * Debe instalarse DESPUÉS de neutralizeExternalNetwork() para que sus rutas
 * específicas tengan prioridad sobre el catch-all del arnés de red.
 */

import { buildSyncEnvelope } from '../../../src/services/supervisorSyncService.js';
import {
    applySupervisorInvoiceCommand,
    applySupervisorSupplierCommand,
} from '../../../src/services/supervisorSupplierCommand.js';

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

// ── Proveedores/facturas: contratos del eco ──────────────────────────────────
const SUPPLIERS_SYNC_DOC_ID = 'bodega_suppliers_v1';
const SUPPLIER_INVOICES_SYNC_DOC_BASE = 'bodega_supplier_invoices_v1';

// Espejo del despacho del receptor real (useRemoteCommands): el tipo del
// comando se traduce a entity+action de los aplicadores puros.
const LEDGER_COMMAND_ACTIONS = Object.freeze({
    'supervisor.supplier.create': { entity: 'supplier', action: 'create' },
    'supervisor.supplier.update': { entity: 'supplier', action: 'edit' },
    'supervisor.supplier.delete': { entity: 'supplier', action: 'delete' },
    'supervisor.invoice.create': { entity: 'invoice', action: 'create' },
    'supervisor.invoice.update': { entity: 'invoice', action: 'edit' },
    'supervisor.invoice.delete': { entity: 'invoice', action: 'delete' },
});

/**
 * Espejo mínimo de buildSupplierInvoicesSyncPlan (useCloudSync.js): un doc por
 * año de factura con las facturas ordenadas por (fecha, id). No se importa el
 * hook (React) en Node; si este espejo divergiera del contrato real, el
 * validador del monitor rechazaría el doc y el piloto e2e fallaría.
 */
function buildLedgerInvoiceDocs(invoices) {
    const byYear = new Map();
    for (const record of invoices) {
        const value = record?.date || record?.timestamp;
        const year = typeof value === 'string' ? value.slice(0, 4) : '';
        const key = /^\d{4}$/.test(year) ? year : 'recent';
        if (!byYear.has(key)) byYear.set(key, []);
        byYear.get(key).push(record);
    }
    return [...byYear.entries()].map(([year, records]) => ({
        year,
        docId: `${SUPPLIER_INVOICES_SYNC_DOC_BASE}:${year}`,
        records: [...records].sort((a, b) => {
            const ta = a?.date || a?.timestamp || '';
            const tb = b?.date || b?.timestamp || '';
            if (ta !== tb) return ta < tb ? -1 : 1;
            return String(a?.id ?? '') < String(b?.id ?? '') ? -1 : 1;
        }),
    }));
}

/**
 * Instala la caja simulada en la página. Devuelve un handle con el registro de
 * órdenes recibidas:
 *   - caja.received       → filas crudas recibidas (con su ack_payload),
 *   - caja.commandTypes() → ['supervisor.product.create', …] en orden.
 *
 * @param {import('@playwright/test').Page} page
 * @param {{ applyAfterMs?: number, warnings?: string[], primaryDeviceId?: string,
 *           ledger?: { suppliers?: Array, invoices?: Array } }} options
 *        applyAfterMs: retardo con el que la caja "aplica" la orden (simula el
 *        procesamiento real antes del ACK). warnings: reservas que viajan en el
 *        ACK (prueba el aviso ámbar del tracker). ledger: estado inicial de
 *        proveedores/facturas de la caja (se publica como eco desde el arranque).
 */
export async function installCajaSimulada(page, {
    applyAfterMs = 400,
    warnings = [],
    primaryDeviceId = 'e2e-primary-device',
    ledger = {},
} = {}) {
    const received = [];
    const sockets = new Set();
    const joinedTopics = new Set();
    // Formato por socket (Phoenix vsn 2.0 = tuplas [join_ref, ref, topic, event,
    // payload]; vsn 1.0 = objetos). Los frames salientes se codifican en el
    // MISMO formato que habla el cliente: si no, el decoder los descarta.
    const socketFormat = new Map();

    const encodeFrame = (ws, topic, payload) => (socketFormat.get(ws) === 'tuple'
        ? JSON.stringify([null, null, topic, 'postgres_changes', payload])
        : JSON.stringify({ topic, event: 'postgres_changes', ref: null, join_ref: null, payload }));

    const ledgerState = {
        suppliers: [...(Array.isArray(ledger.suppliers) ? ledger.suppliers : [])],
        invoices: [...(Array.isArray(ledger.invoices) ? ledger.invoices : [])],
        // Pagos (PAGO_PROVEEDOR) siguen siendo solo de la caja (Fase 3).
        sales: [...(Array.isArray(ledger.sales) ? ledger.sales : [])],
    };
    const syncDocs = new Map();

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
            // Los tópicos `realtime:monitor:*` que se unen son el canal de eco
            // del monitor; a ellos se empujan los UPDATE de sync_documents.
            socketFormat.set(ws, Array.isArray(msg) ? 'tuple' : 'object');
            const msgTopic = Array.isArray(msg) ? msg[2] : msg?.topic;
            const msgEvent = Array.isArray(msg) ? msg[3] : msg?.event;
            if (msgEvent === 'phx_join' && typeof msgTopic === 'string' && msgTopic.startsWith('realtime:monitor:')) {
                joinedTopics.add(msgTopic);
            }
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
        sockets.forEach((ws) => {
            try { ws.send(encodeFrame(ws, event.topic, event.payload)); } catch { /* socket caído */ }
        });
    };

    // ── Eco de proveedores/facturas: docs sync_documents ────────────────────
    // Contrato real: snapshot `bodega_suppliers_v1` (payload = arreglo de
    // proveedores) + familia `bodega_supplier_invoices_v1:<año>` (un doc por
    // año; reemplazo de franja, `[]` vacía el año), envueltos en
    // buildSyncEnvelope. updated_at estrictamente creciente por doc (el lector
    // descarta watermarks repetidos o hacia atrás).
    const upsertSyncDoc = (docId, payload) => {
        const previous = syncDocs.get(docId);
        const previousAt = previous ? Date.parse(previous.updated_at) : 0;
        const updatedAt = new Date(Math.max(Date.now(), previousAt + 1)).toISOString();
        const row = {
            collection: 'store',
            doc_id: docId,
            device_id: primaryDeviceId,
            updated_at: updatedAt,
            data: buildSyncEnvelope(payload, updatedAt),
        };
        syncDocs.set(docId, row);
        return row;
    };

    const broadcastSyncDocument = (row) => {
        const record = {
            collection: row.collection,
            doc_id: row.doc_id,
            device_id: row.device_id,
            updated_at: row.updated_at,
            data: row.data,
        };
        const columns = [
            { name: 'collection', type: 'text' },
            { name: 'doc_id', type: 'text' },
            { name: 'device_id', type: 'text' },
            { name: 'updated_at', type: 'timestamptz' },
            { name: 'data', type: 'jsonb' },
        ];
        // Misma envuelta que broadcastCommandUpdate (walrus + forma aplanada).
        const payload = {
            ids: [1],
            columns,
            commit_timestamp: row.updated_at,
            errors: [],
            schema: 'public',
            table: 'sync_documents',
            data: { type: 'UPDATE', columns, record, old_record: {}, errors: null },
            event: 'UPDATE',
            eventType: 'UPDATE',
            new: record,
            old: {},
        };
        const topics = [...joinedTopics].filter((topic) => topic.startsWith('realtime:monitor:'));
        for (const topic of topics) {
            sockets.forEach((ws) => {
                try { ws.send(encodeFrame(ws, topic, payload)); } catch { /* socket caído */ }
            });
        }
    };

    const publishLedgerDocs = () => {
        const changed = [upsertSyncDoc(SUPPLIERS_SYNC_DOC_ID, ledgerState.suppliers)];
        const plans = buildLedgerInvoiceDocs(ledgerState.invoices);
        const plannedYears = new Set(plans.map((plan) => plan.year));
        for (const plan of plans) changed.push(upsertSyncDoc(plan.docId, plan.records));
        // Tumba: un año que quedó sin facturas se vacía (reemplazo de franja).
        for (const docId of [...syncDocs.keys()]) {
            const year = docId.startsWith(`${SUPPLIER_INVOICES_SYNC_DOC_BASE}:`)
                ? docId.slice(SUPPLIER_INVOICES_SYNC_DOC_BASE.length + 1)
                : null;
            if (year !== null && !plannedYears.has(year)) changed.push(upsertSyncDoc(docId, []));
        }
        changed.forEach(broadcastSyncDocument);
        return changed;
    };

    // Estado inicial publicado desde el arranque (el pull inicial del monitor
    // lo baja aunque ningún comando haya corrido todavía).
    publishLedgerDocs();

    // La caja aplica las órdenes de proveedores/facturas con los MISMOS
    // aplicadores puros del receptor real: un rechazo de regla de negocio es
    // 'rejected' CIERTO con el motivo real, igual que en producción.
    const applyLedgerCommand = (row) => {
        const mapping = LEDGER_COMMAND_ACTIONS[String(row.command_type || '')];
        if (!mapping) return null;
        const payload = row.payload || {};
        try {
            const { entity, action } = mapping;
            const result = entity === 'invoice'
                ? applySupervisorInvoiceCommand(
                    { invoices: ledgerState.invoices, suppliers: ledgerState.suppliers, sales: ledgerState.sales },
                    {
                        entity, action,
                        ...(action === 'create' ? { invoice: payload.invoice } : {}),
                        ...(action === 'edit' ? { invoiceId: payload.invoiceId, patch: payload.patch } : {}),
                        ...(action === 'delete' ? { invoiceId: payload.invoiceId } : {}),
                    },
                )
                : applySupervisorSupplierCommand(ledgerState.suppliers, {
                    entity, action,
                    ...(action === 'create' ? { supplier: payload.supplier } : {}),
                    ...(action === 'edit' ? { supplierId: payload.supplierId, patch: payload.patch } : {}),
                    ...(action === 'delete' ? { supplierId: payload.supplierId } : {}),
                });
            if (result.status === 'rejected') {
                return { status: 'rejected', error: result.error, ackPayload: { applied: false, error: result.error } };
            }
            ledgerState.suppliers = result.suppliers;
            if (result.invoices) ledgerState.invoices = result.invoices;
            publishLedgerDocs();
            return { status: 'applied', ackPayload: { applied: true, warnings, appliedAt: new Date().toISOString() } };
        } catch (error) {
            const message = error?.message || 'error inesperado de la caja';
            return { status: 'failed', error: message, ackPayload: { applied: false, error: message } };
        }
    };

    const applyRow = (row) => {
        const ledgerResult = applyLedgerCommand(row);
        if (ledgerResult) {
            row.status = ledgerResult.status;
            row.ack_payload = ledgerResult.ackPayload;
            row.error_message = ledgerResult.error ?? null;
        } else {
            row.status = 'applied';
            row.ack_payload = { applied: true, warnings, appliedAt: new Date().toISOString() };
        }
        broadcastCommandUpdate(row);
    };

    // ── Auth: sesión de dispositivo (signInAnonymously → POST /auth/v1/signup) ─
    await page.route(/\/auth\/v1\//, (route) => route.fulfill(json(sessionBody())));

    // ── Pairing: el monitor autorizado es exactamente la sesión de arriba ─────
    // El vínculo autoriza el monitor REAL del navegador: `pda_device_id` se
    // genera en runtime (SEC-008) y la revocación remota compara
    // `monitor_device_id` contra él (isMonitorPairingActive). Mismo eco que
    // hace get_license_status con el device_id consultado.
    await page.route(/\/rest\/v1\/device_pairings(\?|$)/, async (route) => {
        const monitorDeviceId = await page.evaluate(() => localStorage.getItem('pda_device_id')).catch(() => null);
        await route.fulfill(json([{
            ...PAIRING_ROW,
            monitor_device_id: monitorDeviceId || PAIRING_ROW.monitor_device_id,
        }]));
    });

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

    // ── Docs de sincronización publicados por la caja (eco de proveedores) ────
    // Dos consultas como el pull real del monitor: metadatos (sin `data`) y
    // payloads (`select` con `data`, filtrable por `doc_id=in.(…)`).
    await page.route(/\/rest\/v1\/sync_documents(\?|$)/, async (route) => {
        const url = new URL(route.request().url());
        const select = url.searchParams.get('select') || '';
        const docIdParam = url.searchParams.get('doc_id') || '';
        const docs = [...syncDocs.values()];
        if (select.includes('data') || docIdParam.startsWith('in.(')) {
            const wanted = new Set(docIdParam.startsWith('in.(')
                ? docIdParam.slice(4, -1).split(',').map((id) => id.trim())
                : []);
            const rows = docs
                .filter((doc) => wanted.size === 0 || wanted.has(doc.doc_id))
                .map((doc) => ({ ...doc }));
            return route.fulfill(json(rows));
        }
        return route.fulfill(json(docs.map(({ collection, doc_id, device_id, updated_at }) => (
            { collection, doc_id, device_id, updated_at }
        ))));
    });

    return {
        received,
        commandTypes: () => received.map((row) => row.command_type),
        topics: () => [...joinedTopics],
        ledger: () => ({
            suppliers: ledgerState.suppliers.map((supplier) => ({ ...supplier })),
            invoices: ledgerState.invoices.map((invoice) => ({ ...invoice })),
        }),
    };
}
