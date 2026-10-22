// @vitest-environment jsdom
// Regresión de los hallazgos H1, H2 y H3 de la auditoría
// docs/reports/2026-10-22-auditoria-comandos-supervisor-falsos-positivos.md:
//  - H1: una escritura local tragada NUNCA se confirma como aplicada.
//  - H2: la reaplicación tras un corte responde «applied» (no-op), jamás el
//        falso conflicto «failed» — y el registro de «aplicado» se escribe
//        ANTES de la publicación.
//  - H3: el journal de inventario se recupera AL ARRANQUE del receptor.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const h = vi.hoisted(() => {
    const state = {
        statusCallback: null,
        commandHandlers: [],
        storage: new Map(),
    };
    const channel = {
        on(event, _filter, cb) {
            if (event === 'postgres_changes') state.commandHandlers.push(cb);
            return channel;
        },
        subscribe(cb) { state.statusCallback = cb; return channel; },
    };
    return {
        state,
        channel,
        recoverJournal: vi.fn(async () => ({ recovered: false, commandId: null, direction: null })),
        pushCloudSync: vi.fn(async () => ({ ok: true, skipped: false })),
        client: {
            channel: () => channel,
            removeChannel: vi.fn(() => Promise.resolve()),
            from: vi.fn(() => ({
                upsert: vi.fn(async () => ({ error: null })),
                select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: async () => ({ data: null, error: null }) })) })),
            })),
        },
        storageService: {
            getItem: vi.fn(async (key, fallback) => (h.state.storage.has(key) ? h.state.storage.get(key) : fallback)),
            setItem: vi.fn(async (key, value) => { h.state.storage.set(key, value); }),
        },
    };
});

vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: h.client }));
vi.mock('../src/hooks/useCloudSync', () => ({ pushLocalSync: vi.fn(), pushCloudSync: h.pushCloudSync }));
vi.mock('../src/utils/storageService', () => ({ storageService: h.storageService }));
vi.mock('../src/hooks/store/useAuthStore', () => ({ useAuthStore: () => ({}) }));
vi.mock('../src/utils/withLock', () => ({ withLock: vi.fn(async (_n, fn) => fn()) }));
vi.mock('../src/components/Toast', () => ({ showToast: vi.fn() }));
vi.mock('../src/services/supervisorAuth', () => ({
    ensureSupervisorSession: vi.fn(async () => ({ session: { user: { id: 'auth-1' } }, error: null })),
}));
vi.mock('../src/services/supervisorContracts', async (importOriginal) => ({
    ...(await importOriginal()),
    validateSupervisorCommand: vi.fn(() => ({ valid: true })),
}));
vi.mock('../src/services/supervisorCommandService', async (importOriginal) => ({
    ...(await importOriginal()),
    claimSupervisorCommand: vi.fn(async () => ({ ok: true, claimed: true, status: 'received' })),
    fetchSupervisorCommandsForRecovery: vi.fn(async () => ({ data: [], error: null })),
    readSupervisorCommandAck: vi.fn(),
    SUPERVISOR_TERMINAL_COMMAND_STATUSES: [],
    withSupervisorCommandLock: vi.fn(async (_id, fn) => fn()),
}));
vi.mock('../src/services/supervisorInventoryCommand', () => ({
    applySupervisorInventoryBatchTransaction: vi.fn(),
    retryInventoryPublish: vi.fn(async () => ({ retried: false, ok: true })),
    recoverSupervisorInventoryJournal: h.recoverJournal,
}));
vi.mock('../src/services/supervisorUserCommand', () => ({ applySupervisorUserCommand: vi.fn() }));

import { useRemoteCommands } from '../src/hooks/useRemoteCommands';
import { buildProductRevision } from '../src/services/supervisorProductCommand';
import { applySupervisorInventoryBatchTransaction } from '../src/services/supervisorInventoryCommand';

function Harness({ deviceId = 'device-12345678' }) {
    useRemoteCommands(deviceId, true);
    return null;
}

async function flush() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}

function rememberedCommand(commandId) {
    const stored = h.state.storage.get('supervisor_applied_commands_v1') || {};
    return stored[commandId] || null;
}

function buildUpdateRow({ baseRevision, patch, status = 'received' }) {
    return {
        command_id: 'cmd-product-1',
        command_type: 'supervisor.product.update',
        target_device_id: 'device-12345678',
        actor_auth_id: 'auth-1',
        status,
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60000).toISOString(),
        payload: {
            productId: 'p1',
            baseRevision,
            baseUpdatedAt: new Date().toISOString(),
            patch: { ...patch, baseRevision },
        },
    };
}

async function mountHarness() {
    await act(async () => { root = createRoot(container); });
    await act(async () => { root.render(<Harness />); });
    await flush();
}

let container;
let root;

describe('Regresión auditoría: el ACK nunca miente (H1/H2/H3)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        h.state.commandHandlers = [];
        h.state.storage = new Map();
        h.pushCloudSync.mockReset();
        h.pushCloudSync.mockResolvedValue({ ok: true, skipped: false });
        h.recoverJournal.mockClear();
        h.storageService.setItem.mockImplementation(async (key, value) => { h.state.storage.set(key, value); });
        localStorage.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(async () => {
        await act(async () => { root?.unmount(); });
        root = null;
        container?.remove();
        vi.useRealTimers();
    });

    it('H1: una escritura tragada del catálogo responde «failed», nunca «applied»', async () => {
        const before = { id: 'p1', name: 'Mayonesa', priceUsd: 2, priceUsdt: 2, stock: 22 };
        h.state.storage.set('bodega_products_v1', [before]);

        // El storage TRAGA la escritura del catálogo (ni IndexedDB ni
        // localStorage aceptan el valor: storageService.setItem retorna igual).
        h.storageService.setItem.mockImplementation(async (key, value) => {
            if (key === 'bodega_products_v1') return;
            h.state.storage.set(key, value);
        });

        await mountHarness();
        const insert = h.state.commandHandlers.find(handler => handler);
        await act(async () => {
            insert({
                new: buildUpdateRow({
                    baseRevision: buildProductRevision(before),
                    patch: { priceUsd: 2.5, priceUsdt: 2.5 },
                }),
            });
        });
        await flush();

        // El cambio NO existe en el catálogo… y el comando lo admite con «failed».
        expect(h.state.storage.get('bodega_products_v1')[0].priceUsd).toBe(2);
        const remembered = rememberedCommand('cmd-product-1');
        expect(remembered).toMatchObject({ status: 'failed' });
        expect(String(remembered.errorMessage)).toMatch(/no se confirmó/i);
    });

    it('H2: reaplicar un update tras un corte responde «applied» (no-op), no el falso conflicto', async () => {
        h.pushCloudSync.mockResolvedValue({ ok: true, skipped: false });

        // El PRIMER intento ya aplicó el cambio (precio 2 → 2.5) y el corte
        // mató el proceso ANTES de escribir supervisor_applied_commands_v1.
        const before = { id: 'p1', name: 'Mayonesa', priceUsd: 2, priceUsdt: 2, stock: 22 };
        h.state.storage.set('bodega_products_v1', [{ ...before, priceUsd: 2.5, priceUsdt: 2.5 }]);

        await mountHarness();
        const insert = h.state.commandHandlers.find(handler => handler);
        await act(async () => {
            insert({
                new: buildUpdateRow({
                    baseRevision: buildProductRevision(before),
                    patch: { priceUsd: 2.5, priceUsdt: 2.5 },
                }),
            });
        });
        await flush();

        // El comando queda «applied» (el cambio está en efecto) y el catálogo
        // no se toca de nuevo.
        expect(rememberedCommand('cmd-product-1')).toMatchObject({ status: 'applied' });
        expect(h.state.storage.get('bodega_products_v1')[0].priceUsd).toBe(2.5);
    });

    it('H2: reaplicar un create tras un corte responde «applied» aunque el stock haya derivado', async () => {
        h.pushCloudSync.mockResolvedValue({ ok: true, skipped: false });

        // La creación ya quedó aplicada y una venta posterior movió el stock:
        // la reaplicación sigue siendo un no-op aplicado (el stock no forma
        // parte de la revisión del producto).
        const created = { id: 'p-nuevo', name: 'Arroz E2E', priceUsd: 1.25, priceUsdt: 1.25, stock: 1 };
        h.state.storage.set('bodega_products_v1', [created]);

        await mountHarness();
        const insert = h.state.commandHandlers.find(handler => handler);
        await act(async () => {
            insert({
                new: {
                    command_id: 'cmd-product-1',
                    command_type: 'supervisor.product.create',
                    target_device_id: 'device-12345678',
                    actor_auth_id: 'auth-1',
                    status: 'received',
                    issued_at: new Date().toISOString(),
                    expires_at: new Date(Date.now() + 60000).toISOString(),
                    payload: { product: { ...created, stock: 3 } },
                },
            });
        });
        await flush();

        expect(rememberedCommand('cmd-product-1')).toMatchObject({ status: 'applied' });
        // El stock de la venta posterior se conserva; nada se re-crea.
        expect(h.state.storage.get('bodega_products_v1')).toHaveLength(1);
        expect(h.state.storage.get('bodega_products_v1')[0].stock).toBe(1);
    });

    it('H2: el registro de «aplicado» se escribe ANTES de la publicación (corte a mitad del viaje)', async () => {
        // La publicación queda colgada (viaje de ~1.3 MB interrumpido).
        h.pushCloudSync.mockImplementation(() => new Promise(() => {}));
        const before = { id: 'p1', name: 'Mayonesa', priceUsd: 2, priceUsdt: 2, stock: 22 };
        h.state.storage.set('bodega_products_v1', [before]);

        await mountHarness();
        const insert = h.state.commandHandlers.find(handler => handler);
        await act(async () => {
            insert({
                new: buildUpdateRow({
                    baseRevision: buildProductRevision(before),
                    patch: { priceUsd: 2.5, priceUsdt: 2.5 },
                }),
            });
        });
        await flush();

        // La publicación sigue en vuelo, pero el estado local YA es durable y
        // el registro de «aplicado» existe: un corte aquí ya no puede responder
        // «failed» con el cambio aplicado.
        expect(h.pushCloudSync).toHaveBeenCalled();
        expect(rememberedCommand('cmd-product-1')).toMatchObject({ status: 'applied' });
        expect(h.state.storage.get('bodega_products_v1')[0].priceUsd).toBe(2.5);
    });

    it('H3: el journal de inventario se recupera al arranque del receptor', async () => {
        await mountHarness();
        expect(h.recoverJournal).toHaveBeenCalled();
    });

    it('H4: la confirmación temprana del lote explica la reserva en el ACK', async () => {
        // La transacción local aplica y dispara onLocalApplied (estado durable):
        // el ACK sale ANTES de la publicación, pero no como «applied» liso —
        // viaja con la reserva explicada (H4 de la auditoría).
        applySupervisorInventoryBatchTransaction.mockImplementation(async ({ onLocalApplied }) => {
            const applied = { unitsDelta: 5, stockBefore: 10, stockAfter: 15, status: 'applied' };
            if (onLocalApplied) await onLocalApplied(applied);
            return applied;
        });

        await mountHarness();
        const insert = h.state.commandHandlers.find(handler => handler);
        await act(async () => {
            insert({
                new: {
                    command_id: 'cmd-batch-1',
                    command_type: 'supervisor.inventory.batch.adjust',
                    target_device_id: 'device-12345678',
                    actor_auth_id: 'auth-1',
                    status: 'received',
                    issued_at: new Date().toISOString(),
                    expires_at: new Date(Date.now() + 60000).toISOString(),
                    payload: { direction: 'ingreso', lines: [] },
                },
            });
        });
        await flush();

        const remembered = rememberedCommand('cmd-batch-1');
        expect(remembered).toMatchObject({ status: 'applied' });
        // La reserva explicada viaja en el payload del ACK.
        expect(remembered.ackPayload.warnings?.join(' ')).toMatch(/Confirmación temprana/);
    });
});
