// @vitest-environment jsdom

/**
 * tests/supervisorSyncEcho.test.jsx — Pasada E2E de DOS DISPOSITIVOS:
 * caja (useRemoteCommands + transacción de inventario real con journal) y
 * monitor (useMonitorSync real), conectados por un bus de red falso (RPCs,
 * tablas y realtime de Supabase en memoria).
 *
 * Lo único simulado es la RED. Todo el código de ambos dispositivos es real:
 *  - el draft con semántica de objetivo y el sender con ACK global;
 *  - el command service completo (create/claim/ack_supervisor_command,
 *    waitForCommandAck con su polling);
 *  - la transacción de inventario de la caja (journal write-ahead + ACK
 *    temprano + publicación);
 *  - pushCloudSync real (buildSyncEnvelope + upsert a sync_documents);
 *  - la aplicación del documento en el monitor (readSyncEnvelope + validación
 *    + watermark isNewerSyncDocument + localforage real del navegador).
 *  - el barrido periódico de publicación pendiente de la caja: el setInterval
 *    REAL de 30 s de useRemoteCommands, disparado avanzando un reloj falso de
 *    intervalos (sin invocar retryInventoryPublish a mano).
 *
 * Qué verifica que los unitarios no pueden: el ECO DE SINCRONIZACIÓN
 * end-to-end. Un ajuste pedido por el monitor termina en el stock del MONITOR
 * (el síntoma original era "me dijo exitoso pero realmente no cambió": la caja
 * quedaba en 30 y el monitor nunca se enteraba).
 */

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import localforage from 'localforage';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CAJA_DEVICE_ID = 'caja-e2e';
const MONITOR_DEVICE_ID = 'monitor-e2e';
const ACTOR_AUTH_ID = 'auth-1';

// ── Bus de red falso: RPCs + tablas + realtime en memoria ───────────────────
const h = vi.hoisted(() => {
    const state = {
        commands: new Map(),      // command_id -> fila de supervisor_commands
        docs: new Map(),          // `${device_id}:${doc_id}` -> fila de sync_documents
        pairings: new Map(),      // primary_device_id -> fila de device_pairings
        handlers: [],             // { table, deviceFilter, cb } de channel().on()
        failDocPushes: 0,         // > 0: el upsert de sync_documents falla N veces
        activeDocPushes: 0,       // pushes de docs en vuelo (asentamiento de la cadena de publicación)
    };

    const parseFilter = (filter = '') => {
        const match = /(\w+)=eq\.(.+)$/.exec(String(filter));
        return match ? { key: match[1], value: match[2] } : null;
    };

    // Un evento de fila (INSERT o UPDATE) llega a todos los handlers de esa
    // tabla cuyo filtro coincida (target_device_id / device_id / command_id).
    const dispatchRow = (table, row) => {
        state.handlers.forEach((handler) => {
            if (handler.table !== table) return;
            if (handler.filter && row[handler.filter.key] !== handler.filter.value) return;
            handler.cb({ new: row });
        });
    };
    const dispatchCommand = (row) => dispatchRow('supervisor_commands', row);
    const dispatchDoc = (row) => dispatchRow('sync_documents', row);

    const rowsOf = (table) => {
        if (table === 'supervisor_commands') return [...state.commands.values()];
        if (table === 'sync_documents') return [...state.docs.values()];
        if (table === 'device_pairings') return [...state.pairings.values()];
        return [];
    };

    const runQuery = (q) => {
        const rows = rowsOf(q.table).filter(row => q.filters.every(({ key, value, isIn }) => (
            isIn ? (value || []).includes(row[key]) : row[key] === value
        )));
        return q.mode === 'one' ? (rows[0] || null) : rows;
    };

    const from = (table) => {
        const q = { table, filters: [], mode: 'list' };
        const api = {
            select() { return api; },
            eq(key, value) { q.filters.push({ key, value }); return api; },
            in(key, value) { q.filters.push({ key, value, isIn: true }); return api; },
            maybeSingle() { q.mode = 'one'; return api; },
            // El filtrado fino de recuperación (.or con ventana de expiración,
            // .order, .limit) no es el sujeto de esta pasada: se aceptan sin
            // filtrar y el guard de comandos aplicados cubre los duplicados.
            or() { return api; },
            order() { return api; },
            limit() { return api; },
            gt() { return api; },
            // Forma supabase-js: toda query resuelve { data, error }.
            then(resolve, reject) {
                return Promise.resolve({ data: runQuery(q), error: null }).then(resolve, reject);
            },
            upsert: async (document) => {
                if (table === 'sync_documents') {
                    if (state.failDocPushes > 0) {
                        state.failDocPushes -= 1;
                        return { data: null, error: { message: 'fallo de red simulado' } };
                    }
                    const row = { ...document };
                    state.docs.set(`${row.device_id}:${row.doc_id}`, row);
                    queueMicrotask(() => dispatchDoc(row));
                    return { data: [row], error: null };
                }
                return { data: null, error: null };
            },
        };
        return api;
    };

    const rpc = async (name, args = {}) => {
        if (name === 'create_supervisor_command') {
            const pairing = state.pairings.get(args.p_target_device_id) || {};
            const row = {
                command_id: args.p_command_id,
                target_device_id: args.p_target_device_id,
                command_type: args.p_command_type,
                payload: args.p_payload,
                issued_at: args.p_issued_at,
                expires_at: args.p_expires_at,
                status: 'pending',
                // El servidor registra el monitor autorizado por el pairing.
                actor_auth_id: pairing.monitor_device_id || null,
            };
            state.commands.set(row.command_id, row);
            queueMicrotask(() => dispatchCommand(row));
            return { data: [{ ...row }], error: null };
        }
        if (name === 'claim_supervisor_command') {
            const row = state.commands.get(args.p_command_id);
            if (!row || row.target_device_id !== args.p_target_device_id) {
                return { data: null, error: { message: 'comando no encontrado' } };
            }
            row.status = 'received';
            return {
                data: [{ command_id: row.command_id, status: row.status, claimed: true, expired: false }],
                error: null,
            };
        }
        if (name === 'ack_supervisor_command') {
            const row = state.commands.get(args.p_command_id);
            if (!row) return { data: null, error: { message: 'comando no encontrado' } };
            row.status = args.p_status;
            row.ack_payload = args.p_ack_payload;
            row.error_message = args.p_error_message;
            // El ACK viaja como UPDATE de la fila: el canal del sender lo ve.
            queueMicrotask(() => dispatchCommand({ ...row }));
            return { data: null, error: null };
        }
        return { data: null, error: null };
    };

    const channel = (name) => {
        const ch = {
            name,
            on(_event, spec, cb) {
                state.handlers.push({ table: spec?.table, filter: parseFilter(spec?.filter), cb });
                return ch;
            },
            subscribe(cb) {
                queueMicrotask(() => cb?.('SUBSCRIBED'));
                return ch;
            },
        };
        return ch;
    };

    return {
        state,
        client: {
            from,
            rpc,
            channel,
            removeChannel: vi.fn(() => Promise.resolve()),
        },
    };
});

// La caja registra su listener con el nombre de canal supervisor-commands:<id>;
// el monitor con buildSupervisorRealtimeChannelName(<caja>, ciclo). El bus
// enruta por filtro (target_device_id / device_id), no por nombre.

vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: h.client }));

// pushCloudSync REAL (envelope + upsert). El gate de pairing se abre para el
// entorno: es plomería del test, no la lógica bajo prueba.
vi.mock('../src/hooks/useCloudSync', async (importOriginal) => {
    const real = await importOriginal();
    return {
        ...real,
        pushLocalSync: vi.fn(),
        // El push REAL (envelope + upsert) con el gate de pairing abierto. Cuenta
        // los pushes en vuelo: los reintentos internos (250/500 ms) ocurren
        // DENTRO de cada llamada, así que ver el contador en 0 desde una tarea
        // macrotemporal prueba que la cadena de publicación de la caja terminó.
        pushCloudSync: async (key, value, force) => {
            h.state.activeDocPushes += 1;
            try {
                return await real.pushCloudSync(key, value, force, true, CAJA_DEVICE_ID);
            } finally {
                h.state.activeDocPushes -= 1;
            }
        },
    };
});

// Storage de la CAJA (dispositivo separado del monitor, que usa localforage).
vi.mock('../src/utils/storageService', () => {
    const data = new Map();
    return {
        storageService: {
            getItem: async (key, fallback = null) => (data.has(key) ? structuredClone(data.get(key)) : fallback),
            setItem: async (key, value) => { data.set(key, structuredClone(value)); },
            removeItem: async (key) => { data.delete(key); },
        },
    };
});
vi.mock('../src/utils/withLock', () => ({ withLock: vi.fn(async (_name, fn) => fn()) }));
vi.mock('../src/components/Toast', () => ({ showToast: vi.fn() }));
vi.mock('../src/hooks/store/useAuthStore', () => ({
    useAuthStore: Object.assign(() => ({}), { setState: () => {} }),
}));
vi.mock('../src/services/supervisorAuth', () => ({
    ensureSupervisorSession: vi.fn(async () => ({ session: { user: { id: ACTOR_AUTH_ID } }, error: null })),
}));

import { useRemoteCommands } from '../src/hooks/useRemoteCommands';
import { useMonitorSync } from '../src/hooks/useMonitorSync';
import { storageService } from '../src/utils/storageService';
import { sendSupervisorCommand } from '../src/services/supervisorCommandService';
import { SUPERVISOR_INVENTORY_JOURNAL_KEY } from '../src/services/supervisorInventoryCommand';
import { createInventoryDraft, addInventoryDraftLine } from '../src/services/supervisorInventoryDraft';
import { sendSupervisorInventoryBatch } from '../src/services/supervisorInventoryBatchSender';

// `from`/`rpc`/`channel` del bus se usan también como listener registry: los
// hooks registran sus callbacks vía channel(...).on(...). El registro real
// ocurre dentro de los hooks; el bus despacha por filtro.
function CajaHarness() {
    useRemoteCommands(CAJA_DEVICE_ID, true);
    return null;
}

function MonitorHarness() {
    useMonitorSync(CAJA_DEVICE_ID);
    return null;
}

async function flush(times = 6) {
    await act(async () => {
        for (let i = 0; i < times; i += 1) await Promise.resolve();
    });
}

async function waitFor(predicate, { timeoutMs = 4000, stepMs = 25 } = {}) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        let value;
        // Cada ciclo va en act: los hooks actualizan estado al aplicar eventos
        // del bus y así no se ensucia la salida con avisos de React.
        await act(async () => {
            value = await predicate();
            if (!value) await new Promise(resolve => setTimeout(resolve, stepMs));
        });
        if (value) return value;
    }
    throw new Error('Condición no alcanzada en el tiempo esperado');
}

function buildAdjustmentDraft() {
    // Semántica de objetivo: "la mayonesa debe quedar en 30" (base 22 → +8).
    return addInventoryDraftLine(createInventoryDraft('ingreso', { reason: 'Ajuste de stock' }), {
        productId: 'p1',
        productName: 'Mayonesa E2E',
        inputUnit: 'unidades',
        quantityInput: 8,
        unitsPerPackage: 1,
        baseStock: 22,
        targetStock: 30,
    }).draft;
}

const CAJA_PRODUCTS = [{ id: 'p1', name: 'Mayonesa E2E', stock: 22 }];

describe('E2E caja+monitor: el eco de sincronización de un ajuste de inventario', () => {
    let container;
    let root;
    let setIntervalSpy = null;

    beforeEach(async () => {
        h.state.commands.clear();
        h.state.docs.clear();
        h.state.pairings.clear();
        h.state.handlers = [];
        h.state.failDocPushes = 0;
        h.state.activeDocPushes = 0;
        h.state.pairings.set(CAJA_DEVICE_ID, {
            primary_device_id: CAJA_DEVICE_ID,
            monitor_device_id: MONITOR_DEVICE_ID,
            monitor_auth_id: ACTOR_AUTH_ID,
        });
        localStorage.clear();
        await localforage.clear();
        // Estado inicial de los DOS dispositivos: 22 u.
        await storageService.setItem('bodega_products_v1', structuredClone(CAJA_PRODUCTS));
        await storageService.setItem('bodega_sales_v1', []);
        await localforage.setItem('bodega_products_v1', structuredClone(CAJA_PRODUCTS));
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(async () => {
        await act(async () => { root?.unmount(); });
        container?.remove();
        await localforage.clear();
        setIntervalSpy?.mockRestore();
        setIntervalSpy = null;
        vi.useRealTimers();
    });

    async function mountBothDevices() {
        await act(async () => { root = createRoot(container); });
        await act(async () => {
            root.render(<><CajaHarness /><MonitorHarness /></>);
        });
        await flush();
    }

    async function monitorProducts() {
        return localforage.getItem('bodega_products_v1');
    }

    async function waitForCajaPushQuiescence() {
        // El ACK sale ANTES de la publicación (Fase 11): la cadena de publicación
        // de la caja puede seguir en vuelo cuando el lote ya resolvió. Cada push
        // agota sus reintentos internos DENTRO de la llamada, así que un contador
        // de pushes en 0 visto desde una tarea macrotemporal prueba que la cadena
        // terminó (los huecos entre empujes son solo microtareas).
        await waitFor(async () => {
            if (h.state.activeDocPushes > 0) return false;
            await new Promise(resolve => setTimeout(resolve, 25));
            return h.state.activeDocPushes === 0;
        });
    }

    it('un ajuste pedido por el monitor termina en el stock del MONITOR (eco end-to-end)', async () => {
        await mountBothDevices();

        const result = await sendSupervisorInventoryBatch({
            draft: buildAdjustmentDraft(),
            products: structuredClone(CAJA_PRODUCTS),
            targetDeviceId: CAJA_DEVICE_ID,
            sendCommand: sendSupervisorCommand,
        });

        // 1. El ACK global confirmó el movimiento (la caja real lo aplicó).
        expect(result.ok).toBe(true);
        expect(result.status).toBe('applied');
        expect(result.results[0].stockAfter).toBe(30);

        // 2. La caja quedó en 30.
        const cajaProducts = await storageService.getItem('bodega_products_v1');
        expect(cajaProducts[0].stock).toBe(30);

        // 3. EL ECO: el monitor real aplicó el doc publicado → su stock es 30.
        await waitFor(async () => (await monitorProducts())?.[0]?.stock === 30);
        expect((await monitorProducts())[0].stock).toBe(30);

        // 4. La venta/movimiento quedó registrada en la caja.
        const sales = await storageService.getItem('bodega_sales_v1');
        expect(sales).toHaveLength(1);
        expect(sales[0].unitsDelta).toBe(8);
    });

    it('reintentar el mismo lote tras el eco es un no-op aplicado: no se crea otro comando', async () => {
        await mountBothDevices();

        const first = await sendSupervisorInventoryBatch({
            draft: buildAdjustmentDraft(),
            products: structuredClone(CAJA_PRODUCTS),
            targetDeviceId: CAJA_DEVICE_ID,
            sendCommand: sendSupervisorCommand,
        });
        expect(first.ok).toBe(true);
        await waitFor(async () => (await monitorProducts())?.[0]?.stock === 30);

        // El usuario reintenta con el stock que YA ve el monitor (30 = objetivo).
        const retry = await sendSupervisorInventoryBatch({
            draft: buildAdjustmentDraft(),
            products: await monitorProducts(),
            targetDeviceId: CAJA_DEVICE_ID,
            sendCommand: sendSupervisorCommand,
        });

        expect(retry.ok).toBe(true);
        expect(retry.alreadyApplied).toBe(true);
        // Ni un comando nuevo ni un movimiento duplicado en la caja.
        expect(h.state.commands.size).toBe(1);
        const sales = await storageService.getItem('bodega_sales_v1');
        expect(sales).toHaveLength(1);
    });

    it('si la publicación falla, el barrido real de 30 s la repone y el eco llega al monitor', async () => {
        // Timers falsos SOLO para intervalos: setTimeout y Date quedan reales y
        // el flujo del lote no se entera. El setInterval REAL de 30 s que
        // registra useRemoteCommands queda bajo el reloj falso y se dispara
        // avanzándolo: el barrido se ejercita por su timer, no invocando
        // retryInventoryPublish a mano.
        vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
        setIntervalSpy = vi.spyOn(globalThis, 'setInterval');
        await mountBothDevices();

        // Contrato del timer: el barrido de la caja está cableado cada 30 s.
        expect(setIntervalSpy.mock.calls.some(([, delay]) => delay === 30000)).toBe(true);

        // La red cae durante la publicación (con reintentos internos incluidos).
        h.state.failDocPushes = 99;
        const result = await sendSupervisorInventoryBatch({
            draft: buildAdjustmentDraft(),
            products: structuredClone(CAJA_PRODUCTS),
            targetDeviceId: CAJA_DEVICE_ID,
            sendCommand: sendSupervisorCommand,
        });

        // El ACK fue temprano (estado local durable): el movimiento SÍ aplicó…
        expect(result.ok).toBe(true);
        const cajaProducts = await storageService.getItem('bodega_products_v1');
        expect(cajaProducts[0].stock).toBe(30);
        // …pero el monitor NO se enteró (el "aplicado sin sincronizar" real).
        expect((await monitorProducts())[0].stock).toBe(22);

        // El lote quedó aplicado con publicación pendiente en el journal. La
        // cadena de publicación del proceso (transacción + reintento de proceso)
        // se agota con la red caída antes de "volver la red".
        const journalOf = () => storageService.getItem(SUPERVISOR_INVENTORY_JOURNAL_KEY, null);
        await waitForCajaPushQuiescence();
        expect((await journalOf())?.state).toBe('published_pending');

        // La red vuelve, pero el tiempo pasa y NADA se republica solo (el guard
        // de comandos aplicados bloquea cualquier re-despacho del ACK): el
        // journal sigue pendiente y la nube sigue sin ver el documento.
        h.state.failDocPushes = 0;
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 50)); });
        expect((await journalOf())?.state).toBe('published_pending');
        expect(h.state.docs.size).toBe(0);

        // Hasta que el reloj falso cumple los 30 s y el setInterval REAL de la
        // caja dispara su barrido: re-publica con el pushCloudSync real
        // (envelope + upsert) y el eco llega al monitor. La cadena del barrido
        // (pushes + aplicación del eco) termina en microtareas/timers reales y
        // se asienta dentro de la misma ventana de act.
        await act(async () => {
            await vi.advanceTimersByTimeAsync(30_000);
            await new Promise(resolve => setTimeout(resolve, 50));
        });

        await waitFor(async () => (await monitorProducts())?.[0]?.stock === 30);
        expect((await monitorProducts())[0].stock).toBe(30);
        // El barrido resolvió el journal: la caja no quedó nada pendiente.
        expect(await journalOf()).toBeNull();
    });
});
