// @vitest-environment jsdom
//
// Pruebas de las Fases 1–2 del plan
// docs/plans/2026-10-21-plan-fix-cuelgue-caja-comandos-supervisor.md:
// la red de un comando del supervisor debe quedar FUERA de `pos_write_lock`
// (el «Cobrar» del cajero no espera la subida) y la publicación debe llevar el
// estado FRESCO del storage (una venta concurrente del cajero nunca se pierde).
//
// Se usa el código REAL del receptor (useRemoteCommands con el withLock real y
// la transacción de inventario real); solo se mockean el transporte (Supabase),
// el storage (mapa en memoria) y el push cloud (diferible para controlar la
// ventana de publicación desde el test).
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
    const makeDeferred = () => {
        let resolve;
        let reject;
        const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
        return { promise, resolve, reject };
    };

    const state = {
        storage: new Map(),
        getCalls: {},
        getGates: [],       // { key, call, deferred, hit }
        pendingRows: [],
        pushCalls: [],
        pushDeferred: null,
        pushResult: null,
        rpcCalls: [],
        acks: [],
    };

    const reset = () => {
        state.storage.clear();
        state.getCalls = {};
        state.getGates = [];
        state.pendingRows = [];
        state.pushCalls = [];
        state.pushDeferred = null;
        state.pushResult = null;
        state.rpcCalls = [];
        state.acks = [];
    };

    const storageService = {
        getItem: async (key, fallback = null) => {
            state.getCalls[key] = (state.getCalls[key] || 0) + 1;
            if (process.env.DEBUG_GET) console.log('GET', key, state.getCalls[key]);
            const gate = state.getGates.find(g => g.key === key && g.call === state.getCalls[key]);
            if (gate) {
                gate.hit = true;
                await gate.deferred.promise;
            }
            return state.storage.has(key) ? state.storage.get(key) : fallback;
        },
        setItem: async (key, value) => { state.storage.set(key, value); },
        removeItem: async (key) => { state.storage.delete(key); },
    };

    const pushCloudSync = vi.fn(async (key, value, force) => {
        state.pushCalls.push({ key, value, force });
        if (state.pushDeferred) await state.pushDeferred.promise;
        return state.pushResult ?? { ok: true, skipped: false, updatedAt: new Date().toISOString() };
    });

    const channel = {
        on() { return channel; },
        subscribe(cb) { state.statusCallback = cb; return channel; },
    };

    return {
        state,
        reset,
        makeDeferred,
        storageService,
        pushCloudSync,
        client: {
            channel: () => channel,
            removeChannel: vi.fn(async () => {}),
            rpc: vi.fn(async (name, args) => {
                state.rpcCalls.push({ name, args });
                if (name === 'ack_supervisor_command') state.acks.push(args);
                return { data: null, error: null };
            }),
        },
        fetchRecovery: vi.fn(async () => ({ data: state.pendingRows.splice(0), error: null })),
    };
});

vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: h.client, supabaseCloudUrl: 'https://test.invalid' }));
vi.mock('../src/hooks/useCloudSync', () => ({
    pushLocalSync: vi.fn(),
    pushCloudSync: h.pushCloudSync,
    queueCloudSync: vi.fn(),
}));
vi.mock('../src/utils/storageService', () => ({ storageService: h.storageService }));
vi.mock('../src/hooks/store/useAuthStore', () => ({ useAuthStore: () => ({}) }));
vi.mock('../src/components/Toast', () => ({ showToast: vi.fn() }));
vi.mock('../src/services/supervisorAuth', () => ({
    ensureSupervisorSession: vi.fn(async () => ({ session: { user: { id: 'auth-1' } }, error: null })),
}));
vi.mock('../src/services/supervisorCommandService', async (importOriginal) => ({
    ...(await importOriginal()),
    claimSupervisorCommand: vi.fn(async () => ({ ok: true, claimed: true, status: 'received' })),
    fetchSupervisorCommandsForRecovery: h.fetchRecovery,
    readSupervisorCommandAck: vi.fn(),
    SUPERVISOR_TERMINAL_COMMAND_STATUSES: [],
    withSupervisorCommandLock: vi.fn(async (_id, fn) => fn()),
}));
// NO se mockean: withLock (mutex real), supervisorInventoryCommand (transacción
// real), supervisorProductCommand (revisión de producto real), ni la telemetría.

import { useRemoteCommands } from '../src/hooks/useRemoteCommands';
import { withLock } from '../src/utils/withLock';
import {
    SUPERVISOR_INVENTORY_JOURNAL_KEY,
    retryInventoryPublish,
} from '../src/services/supervisorInventoryCommand';
import {
    buildProductRevision,
    readProductPublishPending,
    clearProductPublishPending,
    PRODUCT_PUBLISH_PENDING_KEY,
} from '../src/services/supervisorProductCommand';
import { publishKeyNow, resetCloudPublishQueue } from '../src/services/cloudPublishQueue';

const DEVICE_ID = 'device-12345678';

const baseProduct = {
    id: 'p-1',
    name: 'Producto',
    category: 'General',
    stock: 10,
    priceUsd: 1,
    priceCop: 100,
};

function seedCatalog(extra = {}) {
    h.state.storage.set('bodega_products_v1', [{ ...baseProduct, ...extra }]);
    h.state.storage.set('bodega_sales_v1', []);
}

function makeRow({ commandId, type, payload }) {
    const now = Date.now();
    return {
        command_id: commandId,
        command_type: type,
        actor_auth_id: 'monitor-1',
        target_device_id: DEVICE_ID,
        issued_at: new Date(now - 1000).toISOString(),
        expires_at: new Date(now + 30_000).toISOString(),
        payload,
        schema_version: 1,
        status: 'pending',
    };
}

function productUpdateRow(commandId = 'cmd-prod-1') {
    const revision = buildProductRevision({ ...baseProduct });
    return makeRow({
        commandId,
        type: 'supervisor.product.update',
        payload: {
            productId: 'p-1',
            patch: { name: 'Producto editado', baseRevision: revision },
            baseRevision: revision,
        },
    });
}

function inventoryBatchRow(commandId = 'cmd-batch-1') {
    return makeRow({
        commandId,
        type: 'supervisor.inventory.batch.adjust',
        payload: {
            direction: 'ingreso',
            productId: 'p-1',
            quantityInput: 5,
            inputUnit: 'unidades',
            unitsPerPackage: 1,
            expectedStock: 10,
            reason: 'ingreso de mercancía',
        },
    });
}

function ackFor(commandId) {
    return h.state.acks.find(a => a.p_command_id === commandId) || null;
}

async function waitFor(predicate, { timeoutMs = 1500 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (predicate()) return true;
        await act(async () => { await new Promise(r => setTimeout(r, 5)); });
    }
    return predicate();
}

function Harness() {
    useRemoteCommands(DEVICE_ID, true);
    return null;
}

describe('comandos del supervisor: red fuera de pos_write_lock (Fases 1–2 del plan)', () => {
    let container;
    let root;

    beforeEach(() => {
        vi.clearAllMocks();
        h.reset();
        resetCloudPublishQueue();
        localStorage.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(async () => {
        // Liberar cualquier publicación diferida ANTES de desmontar: un push
        // colgado retendría el pos_write_lock real y envenenaría los tests
        // siguientes (es justamente el defecto que estas pruebas detectan).
        if (h.state.pushDeferred) h.state.pushDeferred.resolve();
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });
        await act(async () => {
            root?.unmount();
        });
        container.remove();
    });

    async function mountWithRow(row) {
        h.state.pendingRows = [row];
        await act(async () => {
            root = createRoot(container);
            root.render(React.createElement(Harness));
            await new Promise(r => setTimeout(r, 10));
        });
    }

    it('edit de producto: pos_write_lock queda libre mientras se publica (el cajero puede cobrar)', async () => {
        seedCatalog();
        h.state.pushDeferred = h.makeDeferred();
        await mountWithRow(productUpdateRow());

        // El comando llegó a la fase de publicación (y sigue publicando).
        expect(await waitFor(() => h.state.pushCalls.length > 0)).toBe(true);

        // Una sección crítica del cajero (el Cobrar usa el mismo lock) DEBE
        // poder entrar mientras la publicación está en vuelo.
        const race = await Promise.race([
            withLock('pos_write_lock', async () => 'entered'),
            new Promise(r => setTimeout(() => r('timeout'), 300)),
        ]);
        expect(race).toBe('entered'); // pre-fix: 'timeout' (el lock sigue retenido por la red)

        h.state.pushDeferred.resolve();
        expect(await waitFor(() => ackFor('cmd-prod-1') != null)).toBe(true);
        expect(ackFor('cmd-prod-1').p_status).toBe('applied');
    });

    it('edit de producto: la publicación lleva el estado FRESCO (una venta concurrente no se pierde)', async () => {
        seedCatalog();
        const gateDeferred = h.makeDeferred();
        // La lectura del publicador (2ª lectura de productos) espera el gate.
        const gateEntry = { key: 'bodega_products_v1', call: 2, deferred: gateDeferred, hit: false };
        h.state.getGates.push(gateEntry);
        await mountWithRow(productUpdateRow('cmd-prod-2'));

        expect(await waitFor(() => gateEntry.hit)).toBe(true);
        // El publicador DEBE releer el storage al publicar (no empujar el
        // snapshot que el comando calculó bajo el lock).
        expect(gateEntry.hit).toBe(true);

        // La venta del cajero escribe el catálogo ANTES de que el publicador lea.
        const withSale = [{ ...baseProduct, stock: 4, name: 'Producto editado' }];
        h.state.storage.set('bodega_products_v1', withSale);
        gateDeferred.resolve();

        expect(await waitFor(() => h.state.pushCalls.length > 0)).toBe(true);
        const pushed = h.state.pushCalls.find(c => c.key === 'bodega_products_v1');
        expect(pushed.value).toEqual(withSale); // el estado fresco, no el snapshot viejo
    });

    it('edit de producto: un fallo de publicación NO revierte el estado local ni pierde la venta', async () => {
        seedCatalog();
        h.state.pushResult = { ok: false, skipped: false, error: 'nube caída' };
        await mountWithRow(productUpdateRow('cmd-prod-3'));

        expect(await waitFor(() => ackFor('cmd-prod-3') != null)).toBe(true);
        // Semántica Fase 11: aplicado localmente + advertencia, nunca 'failed'.
        expect(ackFor('cmd-prod-3').p_status).toBe('applied_with_warnings');

        const stored = h.state.storage.get('bodega_products_v1');
        expect(stored[0].name).toBe('Producto editado'); // sin rollback
        expect(readProductPublishPending()).toBeTruthy(); // pendiente para el barrido
    });

    it('lote de inventario: ACK temprano, lock libre durante la publicación y journal con ownership', async () => {
        seedCatalog();
        h.state.pushDeferred = h.makeDeferred();
        await mountWithRow(inventoryBatchRow());

        // La publicación sigue en vuelo…
        expect(await waitFor(() => h.state.pushCalls.length > 0)).toBe(true);
        // …y el ACK ya salió (temprano: estado local durable antes de publicar).
        expect(ackFor('cmd-batch-1')?.p_status).toBe('applied');
        // El journal quedó en 'published_pending' (la publicación lo resolverá).
        expect(h.state.storage.get(SUPERVISOR_INVENTORY_JOURNAL_KEY)).toMatchObject({
            state: 'published_pending',
            commandId: 'cmd-batch-1',
        });

        const race = await Promise.race([
            withLock('pos_write_lock', async () => 'entered'),
            new Promise(r => setTimeout(() => r('timeout'), 300)),
        ]);
        expect(race).toBe('entered'); // pre-fix: 'timeout'

        h.state.pushDeferred.resolve();
        expect(await waitFor(() => !h.state.storage.has(SUPERVISOR_INVENTORY_JOURNAL_KEY))).toBe(true);
    });

    it('inventario: la publicación usa el estado fresco del storage (fix del retry obsoleto)', async () => {
        seedCatalog();
        await mountWithRow(inventoryBatchRow('cmd-batch-2'));
        expect(await waitFor(() => h.state.pushCalls.length > 0)).toBe(true);
        expect(await waitFor(() => !h.state.storage.has(SUPERVISOR_INVENTORY_JOURNAL_KEY))).toBe(true);

        // Journal 'published_pending' manual: el retry debe publicar lo que hay
        // en storage AHORA, no el snapshot 'after' viejo del journal.
        const staleAfter = [{ ...baseProduct, stock: 999 }];
        h.state.storage.set(SUPERVISOR_INVENTORY_JOURNAL_KEY, {
            version: 1,
            commandId: 'cmd-stale-1',
            state: 'published_pending',
            pendingKeys: ['bodega_products_v1'],
            docs: [
                { key: 'bodega_products_v1', before: [], after: staleAfter },
                { key: 'bodega_sales_v1', before: [], after: [] },
            ],
        });
        h.state.pushCalls.length = 0;
        const freshProducts = [{ ...baseProduct, stock: 7 }];
        h.state.storage.set('bodega_products_v1', freshProducts);

        await retryInventoryPublish({ storage: h.storageService, pushSync: h.pushCloudSync });

        const pushed = h.state.pushCalls.find(c => c.key === 'bodega_products_v1');
        expect(pushed.value).toEqual(freshProducts);
        expect(pushed.value).not.toEqual(staleAfter);
        expect(h.state.storage.has(SUPERVISOR_INVENTORY_JOURNAL_KEY)).toBe(false);
    });

    it('inventario: clearJournalVerified no borra el journal de OTRO comando en curso', async () => {
        seedCatalog();
        h.state.pushDeferred = h.makeDeferred();
        await mountWithRow(inventoryBatchRow('cmd-batch-3'));
        expect(await waitFor(() => h.state.pushCalls.length > 0)).toBe(true);

        // Mientras la publicación del comando A vuela, el comando B (o el
        // barrido) ya reemplazó el journal por el suyo.
        const journalB = {
            version: 1,
            commandId: 'cmd-batch-B',
            state: 'pending',
            docs: [
                { key: 'bodega_products_v1', before: [], after: [] },
                { key: 'bodega_sales_v1', before: [], after: [] },
            ],
        };
        h.state.storage.set(SUPERVISOR_INVENTORY_JOURNAL_KEY, journalB);
        h.state.pushDeferred.resolve();
        expect(await waitFor(() => ackFor('cmd-batch-3') != null)).toBe(true);
        // Dejar terminar la continuación de la publicación (retirar el journal)
        // antes de asertar: si no, la aserción gana por timing y no por diseño.
        await act(async () => { await new Promise(r => setTimeout(r, 80)); });

        // El journal de B sobrevive a la publicación de A.
        expect(h.state.storage.get(SUPERVISOR_INVENTORY_JOURNAL_KEY)).toEqual(journalB);
    });
});

describe('publishKeyNow: single-flight con relectura (Fase 1)', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        h.reset();
        resetCloudPublishQueue();
        h.state.storage.set('bodega_products_v1', [{ ...baseProduct }]);
    });

    it('dos publicaciones concurrentes comparten un solo vuelo y solo re-publican si el valor cambió', async () => {
        const gate = h.makeDeferred();
        h.state.pushDeferred = gate;

        const p1 = publishKeyNow('bodega_products_v1');
        const p2 = publishKeyNow('bodega_products_v1');
        await new Promise(r => setTimeout(r, 0)); // dejar correr las microtareas
        expect(h.state.pushCalls.length).toBe(1); // single-flight

        gate.resolve();
        await Promise.all([p1, p2]);
        expect(h.state.pushCalls.length).toBe(1); // sin cambios → sin pasada final
    });

    it('un cambio llegado durante el vuelo se publica en una pasada final con el estado fresco', async () => {
        const gate = h.makeDeferred();
        h.state.pushDeferred = gate;

        const p1 = publishKeyNow('bodega_products_v1');
        const p2 = publishKeyNow('bodega_products_v1');
        const withSale = [{ ...baseProduct, stock: 3 }];
        h.state.storage.set('bodega_products_v1', withSale); // la venta del cajero

        gate.resolve();
        await Promise.all([p1, p2]);

        expect(h.state.pushCalls.length).toBe(2);
        expect(h.state.pushCalls[1].value).toEqual(withSale);
    });

    it('un fallo de push se reporta sin lanzar y el siguiente intento vuelve a publicar', async () => {
        h.state.pushResult = { ok: false, skipped: false, error: 'nube caída' };
        const failed = await publishKeyNow('bodega_products_v1');
        expect(failed.ok).toBe(false);

        h.state.pushResult = { ok: true, skipped: false };
        const retry = await publishKeyNow('bodega_products_v1');
        expect(retry.ok).toBe(true);
        expect(h.state.pushCalls.length).toBe(2);
    });

    it('el mismo valor ya publicado se confirma sin re-subirlo', async () => {
        await publishKeyNow('bodega_products_v1');
        const again = await publishKeyNow('bodega_products_v1');
        expect(again.ok).toBe(true);
        expect(again.skipped).toBe(false); // confirmado (la nube ya lo tiene), no pendiente
        expect(h.state.pushCalls.length).toBe(1);
    });
});

// Referencias a símbolos usados solo para documentar el alcance del test.
void clearProductPublishPending;
void PRODUCT_PUBLISH_PENDING_KEY;
