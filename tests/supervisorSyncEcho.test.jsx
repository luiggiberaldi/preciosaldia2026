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
        dispatchRow,
        dispatchCommand,
        dispatchDoc,
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

    /**
     * Baseline del catálogo en el monitor: el doc de productos que la caja
     * publica en su arranque/vinculación (con su `stockAsOf`). Desde el desacople
     * (2026-10-22) un lote de inventario ya NO re-publica el catálogo — su
     * movimiento viaja en la familia de ventas y el monitor lo pliega sobre este
     * baseline. Sin baseline no hay nada que plegar (y en producción siempre lo
     * hay: es el mismo doc que llega en el pull inicial del monitor).
     */
    async function seedMonitorCatalogBaseline() {
        h.dispatchDoc({
            device_id: CAJA_DEVICE_ID,
            collection: 'store',
            doc_id: 'bodega_products_v1',
            data: {
                schemaVersion: 1,
                payload: structuredClone(CAJA_PRODUCTS),
                updatedAt: '2026-10-21T12:00:00.000Z',
                stockAsOf: '2026-10-21T12:00:00.000Z',
            },
            updated_at: '2026-10-21T12:00:00.000Z',
        });
        await waitFor(async () => (await monitorProducts())[0]?.stock === 22);
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

    it('plan de stock delta: el stock del monitor se deriva del baseline + los efectos de la venta', async () => {
        await mountBothDevices();

        // 1. El doc de productos publica el baseline: stock 22 con stockAsOf
        //    12:00 (todo lo anterior ya está incluido en el stock del payload).
        h.dispatchDoc({
            device_id: CAJA_DEVICE_ID,
            collection: 'store',
            doc_id: 'bodega_products_v1',
            data: {
                schemaVersion: 1,
                payload: [{ id: 'p1', name: 'Mayonesa E2E', stock: 22 }],
                updatedAt: '2026-10-21T12:00:00.000Z',
                stockAsOf: '2026-10-21T12:00:00.000Z',
            },
            updated_at: '2026-10-21T12:00:00.000Z',
        });
        await waitFor(async () => (await monitorProducts())[0]?.stock === 22);

        // 2. La venta de las 12:05 viaja en la familia de ventas con su efecto
        //    embebido: el monitor la pliega y el stock derivado queda en 20.
        h.dispatchDoc({
            device_id: CAJA_DEVICE_ID,
            collection: 'store',
            doc_id: 'bodega_sales_v1:2026-10',
            data: {
                schemaVersion: 1,
                payload: [{
                    id: 'v-delta-1',
                    tipo: 'VENTA',
                    status: 'COMPLETADA',
                    timestamp: '2026-10-21T12:05:00.000Z',
                    stockEffects: [{ productId: 'p1', delta: -2, stockBefore: 22, stockAfter: 20, at: '2026-10-21T12:05:00.000Z' }],
                }],
                updatedAt: '2026-10-21T12:05:30.000Z',
            },
            updated_at: '2026-10-21T12:05:30.000Z',
        });
        await waitFor(async () => (await monitorProducts())[0]?.stock === 20);

        // Re-derivable: la misma venta re-entregada no vuelve a descontar.
        h.dispatchDoc({
            device_id: CAJA_DEVICE_ID,
            collection: 'store',
            doc_id: 'bodega_sales_v1:2026-10',
            data: {
                schemaVersion: 1,
                payload: [{
                    id: 'v-delta-1',
                    tipo: 'VENTA',
                    status: 'COMPLETADA',
                    timestamp: '2026-10-21T12:05:00.000Z',
                    stockEffects: [{ productId: 'p1', delta: -2, stockBefore: 22, stockAfter: 20, at: '2026-10-21T12:05:00.000Z' }],
                }],
                updatedAt: '2026-10-21T12:06:30.000Z',
            },
            updated_at: '2026-10-21T12:06:30.000Z',
        });
        await flush();
        expect((await monitorProducts())[0].stock).toBe(20);
    });

    it('un ajuste pedido por el monitor termina en el stock del MONITOR (eco end-to-end)', async () => {
        await mountBothDevices();
        await seedMonitorCatalogBaseline();

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

        // 3. EL ECO: el monitor deriva 30 = baseline 22 + el efecto del
        //    movimiento publicado en la familia de ventas (desacople: el lote ya
        //    no re-publica el catálogo).
        await waitFor(async () => (await monitorProducts())?.[0]?.stock === 30);
        expect((await monitorProducts())[0].stock).toBe(30);

        // 4. La venta/movimiento quedó registrada en la caja.
        const sales = await storageService.getItem('bodega_sales_v1');
        expect(sales).toHaveLength(1);
        expect(sales[0].unitsDelta).toBe(8);
    });

    it('alta y baja de producto desde el supervisor: inmediatas en la caja y eco al monitor', async () => {
        await mountBothDevices();

        // La "pantalla" de la caja se refresca por app_storage_update (sin
        // recargar): su ausencia sería el síntoma exacto de "no es inmediata".
        const refreshes = [];
        const onStorage = (event) => refreshes.push({ key: event.detail?.key, source: event.detail?.source });
        window.addEventListener('app_storage_update', onStorage);

        // ── ALTA ──
        const nuevo = {
            id: 'p-nuevo',
            name: 'Arroz E2E',
            priceUsd: 1.25,
            priceUsdt: 1.25,
            stock: 3,
            updatedAt: new Date().toISOString(),
        };
        const created = await sendSupervisorCommand({
            type: 'supervisor.product.create',
            targetDeviceId: CAJA_DEVICE_ID,
            payload: { product: nuevo },
        });
        expect(created.ok).toBe(true);
        // El ACK de producto sale tras publicar: al resolverse, la caja YA tiene
        // el producto aplicado en su catálogo local (sin recarga)…
        const createAck = await created.ackPromise;
        expect(createAck).toMatchObject({ ok: true, status: 'applied' });
        expect((await storageService.getItem('bodega_products_v1')).some(p => p.id === 'p-nuevo')).toBe(true);
        // …y la UI fue notificada al instante con el marcado de origen remoto.
        expect(refreshes.some(r => r.key === 'bodega_products_v1' && r.source === 'remote')).toBe(true);

        // Eco end-to-end: el monitor ve el alta sin recargar.
        await waitFor(async () => ((await monitorProducts()) || []).some(p => p.id === 'p-nuevo'));

        // ── BAJA ──
        refreshes.length = 0;
        const deleted = await sendSupervisorCommand({
            type: 'supervisor.product.delete',
            targetDeviceId: CAJA_DEVICE_ID,
            payload: { productId: 'p-nuevo', productName: 'Arroz E2E' },
        });
        expect(deleted.ok).toBe(true);
        const deleteAck = await deleted.ackPromise;
        expect(deleteAck).toMatchObject({ ok: true, status: 'applied' });
        // La baja es igual de inmediata: el catálogo local ya no lo tiene…
        expect((await storageService.getItem('bodega_products_v1')).some(p => p.id === 'p-nuevo')).toBe(false);
        // …y la UI volvió a ser notificada sin recargar.
        expect(refreshes.some(r => r.key === 'bodega_products_v1' && r.source === 'remote')).toBe(true);

        // Eco: el monitor también pierde el producto sin recargar.
        await waitFor(async () => !((await monitorProducts()) || []).some(p => p.id === 'p-nuevo'));

        window.removeEventListener('app_storage_update', onStorage);
    });

    it('reintentar el mismo lote tras el eco es un no-op aplicado: no se crea otro comando', async () => {
        await mountBothDevices();
        await seedMonitorCatalogBaseline();

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
        await seedMonitorCatalogBaseline();

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
