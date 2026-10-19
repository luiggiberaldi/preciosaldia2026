// @vitest-environment jsdom

// Test de rendimiento: mide la latencia real del ACK en el flujo del lote de
// inventario, comparando el orden ANTERIOR (el ACK se enviaba después de la
// publicación cloud) contra el orden ACTUAL (el ACK se envía en cuanto el estado
// local es durable, antes de publicar).
//
// La publicación cloud se retiene con un retraso inyectado (reloj real) para que
// la comparación sea estable en estructura y honesta en medición: los números
// que imprime el test son wall-clock medidos en cada corrida.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applySupervisorInventoryBatchTransaction } from '../src/services/supervisorInventoryCommand';

const PUBLISH_DELAY_MS = 400;

const now = () => performance.now();
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const h = vi.hoisted(() => {
    const events = [];
    const state = {
        events,
        row: null,
        rows: [],
        fetchCalls: 0,
        pushDelayMs: 0,
        pushResult: { ok: true },
        t0: null,
        tAck: null,
        tPublishEnd: null,
        claimTimes: {},
        ackEvents: [],
    };
    const channel = {
        on() { return channel; },
        subscribe() { return channel; },
    };
    return {
        state,
        channel,
        client: {
            channel: () => channel,
            removeChannel: vi.fn(() => Promise.resolve()),
            rpc: vi.fn(async (name, args) => {
                if (name === 'ack_supervisor_command') {
                    h.state.tAck = now();
                    h.state.ackEvents.push({ commandId: args?.p_command_id, status: args?.p_status, t: now() });
                    events.push(`ack:${args?.p_status}`);
                }
                return { data: null, error: null };
            }),
        },
    };
});

vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: h.client }));
vi.mock('../src/hooks/useCloudSync', () => ({
    pushLocalSync: vi.fn(),
    pushCloudSync: vi.fn(async (key) => {
        h.state.events.push(`publish:${key}`);
        if (h.state.pushDelayMs > 0) await sleep(h.state.pushDelayMs);
        h.state.tPublishEnd = now();
        return h.state.pushResult;
    }),
}));
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
    ensureSupervisorSession: vi.fn(async () => ({ session: { user: { id: 'auth-1' } }, error: null })),
}));
vi.mock('../src/services/supervisorCommandService', async (importOriginal) => ({
    // Mismo motivo que en los demás suites: conservar las constantes reales.
    ...(await importOriginal()),
    claimSupervisorCommand: vi.fn(async ({ commandId }) => {
        // t0 por corrida: el inicio del procesamiento de ESE comando.
        h.state.claimTimes[commandId] = now();
        return { ok: true, claimed: true, status: 'received' };
    }),
    fetchSupervisorCommandsForRecovery: vi.fn(async () => {
        h.state.fetchCalls += 1;
        if (h.state.t0 === null) h.state.t0 = now();
        const rows = h.state.rows.length
            ? h.state.rows
            : (h.state.row ? [h.state.row] : []);
        return { data: h.state.fetchCalls === 1 ? rows : [], error: null };
    }),
    readSupervisorCommandAck: vi.fn(async () => null),
    SUPERVISOR_TERMINAL_COMMAND_STATUSES: [
        'applied', 'applied_with_warnings', 'rejected', 'failed', 'cancelled',
    ],
    withSupervisorCommandLock: vi.fn(async (_id, fn) => fn()),
}));

import { useRemoteCommands } from '../src/hooks/useRemoteCommands';
import { storageService } from '../src/utils/storageService';

const BATCH_PAYLOAD = {
    batchVersion: 2,
    direction: 'ingreso',
    reason: 'Ajuste de stock',
    lines: [
        { lineId: 'line-1', productId: 'p-1', inputUnit: 'unidades', quantityInput: 5, expectedStock: 30 },
    ],
};

function createMapStorage() {
    const data = new Map([
        ['bodega_products_v1', [{ id: 'p-1', name: 'Velas', stock: 30 }]],
        ['bodega_sales_v1', [{ id: 'sale-1', tipo: 'VENTA' }]],
    ]);
    return {
        getItem: async (key, fallback = null) => (data.has(key) ? structuredClone(data.get(key)) : fallback),
        setItem: async (key, value) => { data.set(key, structuredClone(value)); },
        removeItem: async (key) => { data.delete(key); },
    };
}

// Publicación cloud retenida PUBLISH_DELAY_MS (las dos claves en paralelo).
const delayedPush = async () => {
    await sleep(PUBLISH_DELAY_MS);
    return { ok: true };
};

function Harness({ deviceId = 'device-12345678' }) {
    useRemoteCommands(deviceId, true);
    return null;
}

function buildBatchRow(commandId) {
    const issuedAt = Date.now() - 1_000;
    return {
        command_id: commandId,
        status: 'pending',
        command_type: 'supervisor.inventory.batch.adjust',
        actor_auth_id: 'monitor-1',
        target_device_id: 'device-12345678',
        issued_at: new Date(issuedAt).toISOString(),
        expires_at: new Date(issuedAt + 50_000).toISOString(),
        schema_version: 1,
        payload: BATCH_PAYLOAD,
    };
}

describe('Rendimiento: latencia real del ACK en el flujo del lote (antes vs después)', () => {
    let container;
    let root;

    beforeEach(async () => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        h.state.events.length = 0;
        h.state.row = null;
        h.state.rows = [];
        h.state.claimTimes = {};
        h.state.ackEvents.length = 0;
        h.state.fetchCalls = 0;
        h.state.pushDelayMs = 0;
        h.state.pushResult = { ok: true };
        h.state.t0 = null;
        h.state.tAck = null;
        h.state.tPublishEnd = null;
        h.client.rpc.mockClear();
        localStorage.clear();
        await storageService.setItem('bodega_products_v1', [{ id: 'p-1', name: 'Velas', stock: 30 }]);
        await storageService.setItem('bodega_sales_v1', [{ id: 'sale-1', tipo: 'VENTA' }]);
        await storageService.removeItem('bodega_supervisor_inventory_journal_v1');
        await storageService.removeItem('supervisor_applied_commands_v1');
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root?.unmount());
        container?.remove();
    });

    it('antes vs después: el ACK deja de incluir la publicación cloud en su latencia', async () => {
        // ── ANTES: el orden anterior enviaba el ACK justo después de que la
        // transacción resolvía (remember + ackCommand), es decir, tras publicar.
        let legacyStart = 0;
        const legacy = await (async () => {
            const storage = createMapStorage();
            legacyStart = now();
            const result = await applySupervisorInventoryBatchTransaction({
                storage,
                pushSync: delayedPush,
                payload: BATCH_PAYLOAD,
                commandId: 'cmd-lat-legacy-1',
            });
            return { latency: now() - legacyStart, result };
        })();

        // ── DESPUÉS: el ACK se envía en el hook onLocalApplied, en cuanto el
        // estado local es durable y antes de la publicación cloud.
        let ackAt = null;
        const storage = createMapStorage();
        const start = now();
        const result = await applySupervisorInventoryBatchTransaction({
            storage,
            pushSync: delayedPush,
            payload: BATCH_PAYLOAD,
            commandId: 'cmd-lat-new-1',
            onLocalApplied: async () => {
                ackAt = now();
                await sleep(0); // el ackCommand real también es una llamada async
            },
        });
        const newLatency = ackAt - start;

        console.info(`[AckLatency lote] ANTES (ACK tras publicar): ${legacy.latency.toFixed(1)} ms · DESPUÉS (ACK al quedar durable): ${newLatency.toFixed(1)} ms · ahorro: ${(legacy.latency - newLatency).toFixed(1)} ms (publicación retenida ${PUBLISH_DELAY_MS} ms)`);

        // El movimiento se aplicó igual en ambos órdenes.
        expect(legacy.result.status).toBe('applied');
        expect(result.status).toBe('applied');
        expect(ackAt).not.toBeNull();

        // ANTES: el ACK no podía llegar antes que la publicación cloud.
        expect(legacy.latency).toBeGreaterThanOrEqual(PUBLISH_DELAY_MS);
        // DESPUÉS: el ACK no espera la publicación cloud.
        expect(newLatency).toBeLessThan(PUBLISH_DELAY_MS);
        // Ahorro medido: al menos la mitad del retraso inyectado en publicación.
        expect(legacy.latency - newLatency).toBeGreaterThanOrEqual(PUBLISH_DELAY_MS * 0.5);
    });

    it('latencia real del ACK end-to-end (receiver → ack_supervisor_command) sin la publicación cloud', async () => {
        h.state.pushDelayMs = PUBLISH_DELAY_MS;
        h.state.row = buildBatchRow('cmd-lat-e2e-1');

        await act(async () => root.render(<Harness />));
        await act(async () => { await sleep(PUBLISH_DELAY_MS + 300); });
        for (let i = 0; i < 5; i += 1) {
            await act(async () => { await Promise.resolve(); });
        }

        expect(h.client.rpc).toHaveBeenCalledWith('ack_supervisor_command', expect.objectContaining({
            p_command_id: 'cmd-lat-e2e-1',
            p_status: 'applied',
        }));
        expect(h.state.t0).not.toBeNull();
        expect(h.state.tAck).not.toBeNull();
        expect(h.state.tPublishEnd).not.toBeNull();

        const ackLatency = h.state.tAck - h.state.t0;
        const publishLatency = h.state.tPublishEnd - h.state.t0;
        console.info(`[AckLatency e2e] ACK tras ${ackLatency.toFixed(1)} ms del inicio del procesamiento; la publicación cloud terminó en ${publishLatency.toFixed(1)} ms (el orden anterior confirmaba en ≈${publishLatency.toFixed(1)} ms)`);

        // El ACK real va primero y su latencia no incluye la publicación cloud.
        expect(h.state.tAck).toBeLessThan(h.state.tPublishEnd);
        expect(ackLatency).toBeLessThan(PUBLISH_DELAY_MS);
        expect(h.state.tPublishEnd - h.state.tAck).toBeGreaterThanOrEqual(PUBLISH_DELAY_MS * 0.5);

        // El movimiento quedó aplicado localmente igual.
        const products = await storageService.getItem('bodega_products_v1', []);
        expect(products[0].stock).toBe(35);
    });

    it('presupuesto de latencia del ACK (p95 sobre varias corridas): guardia de regresión', async () => {
        const RUNS = 20;
        const RUN_PUBLISH_DELAY_MS = 150;
        const P95_BUDGET_MS = 60;
        h.state.pushDelayMs = RUN_PUBLISH_DELAY_MS;
        // Cada corrida parte del stock real de la anterior (+5): si varias
        // fallaran la validación de concurrencia medirían ACKs de fallo rápido y
        // el p95 quedaría contaminado.
        h.state.rows = Array.from({ length: RUNS }, (_, index) => {
            const row = buildBatchRow(`cmd-p95-${index}`);
            row.payload = {
                ...BATCH_PAYLOAD,
                lines: [{ ...BATCH_PAYLOAD.lines[0], expectedStock: 30 + 5 * index }],
            };
            return row;
        });

        await act(async () => root.render(<Harness />));
        // Las corridas son secuenciales (cada publicación va retenida): se espera
        // a que salgan los RUNS ACKs sin depender de un sleep fijo.
        const deadline = now() + 60_000;
        while (h.state.ackEvents.length < RUNS && now() < deadline) {
            await act(async () => { await sleep(50); });
        }
        for (let i = 0; i < 5; i += 1) {
            await act(async () => { await Promise.resolve(); });
        }

        // Muestra por corrida: latencia del ACK desde el inicio de SU
        // procesamiento (t_claim), la misma magnitud que el resto del test mide
        // con su t0 (aquí no vale un t0 común: las corridas se acumulan).
        // Todas las corridas aplicaron de verdad: la muestra son ACKs del
        // camino completo (durable + ACK + publicación), no de rechazos.
        expect(h.state.ackEvents.map(event => event.status)).toEqual(Array(RUNS).fill('applied'));
        const samples = h.state.ackEvents
            .map(event => event.t - h.state.claimTimes[event.commandId])
            .filter(value => Number.isFinite(value));
        expect(samples).toHaveLength(RUNS);

        const sorted = [...samples].sort((a, b) => a - b);
        const p95 = sorted[Math.ceil(0.95 * sorted.length) - 1];
        const worst = sorted[sorted.length - 1];
        console.info(`[AckLatency p95] ${RUNS} corridas (publicación retenida ${RUN_PUBLISH_DELAY_MS} ms cada una): p95 = ${p95.toFixed(1)} ms · peor = ${worst.toFixed(1)} ms · presupuesto ${P95_BUDGET_MS} ms`);

        // Guardia de regresión: la cola del ACK debe vivir bajo el presupuesto y
        // MUY por debajo del retraso de publicación. Si el ACK vuelve a esperar
        // la nube, cada corrida cae en ≥ 150 ms y estos asserts fallan.
        expect(p95).toBeLessThan(P95_BUDGET_MS);
        expect(p95).toBeLessThan(RUN_PUBLISH_DELAY_MS * 0.5);
        expect(worst).toBeLessThan(RUN_PUBLISH_DELAY_MS * 0.5);
    }, 90_000);
});
