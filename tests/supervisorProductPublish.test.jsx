// @vitest-environment jsdom

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
    recoverSupervisorInventoryJournal: vi.fn(async () => ({ recovered: false, commandId: null, direction: null })),
}));
vi.mock('../src/services/supervisorUserCommand', () => ({ applySupervisorUserCommand: vi.fn() }));

import { useRemoteCommands } from '../src/hooks/useRemoteCommands';
import {
    PRODUCT_PUBLISH_PENDING_KEY,
    buildProductRevision,
    classifyProductPublishResult,
    readProductPublishPending,
} from '../src/services/supervisorProductCommand';

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

function buildProductRow() {
    const product = {
        id: 'p1',
        name: 'Mayonesa',
        priceUsd: 2,
        priceUsdt: 2,
        stock: 22,
    };
    h.state.storage.set('bodega_products_v1', [product]);
    return {
        command_id: 'cmd-product-1',
        command_type: 'supervisor.product.update',
        target_device_id: 'device-12345678',
        actor_auth_id: 'auth-1',
        status: 'pending',
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60000).toISOString(),
        payload: {
            productId: 'p1',
            // El modal manda baseRevision arriba y dentro del patch (contrato real).
            baseRevision: buildProductRevision(product),
            baseUpdatedAt: new Date().toISOString(),
            patch: {
                priceUsd: 2.5,
                priceUsdt: 2.5,
                baseRevision: buildProductRevision(product),
            },
        },
    };
}

describe('comandos de producto: "aplicado sin sincronizar" queda cubierto', () => {
    let container;
    let root;

    beforeEach(() => {
        vi.useFakeTimers();
        h.state.commandHandlers = [];
        h.state.storage = new Map();
        h.pushCloudSync.mockReset();
        localStorage.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    afterEach(async () => {
        await act(async () => { root?.unmount(); });
        container?.remove();
        vi.useRealTimers();
    });

    it('clasifica skipped como NO publicado (aplicado con advertencia + pendiente)', () => {
        expect(classifyProductPublishResult({ ok: true, skipped: true, reason: 'Sin cambios' }))
            .toMatchObject({ status: 'applied', published: true, pending: false });
        expect(classifyProductPublishResult({ ok: false, skipped: true, error: 'Cambio remoto en aplicación' }))
            .toMatchObject({ status: 'applied_with_warnings', published: false, pending: true, rollback: false });
        expect(classifyProductPublishResult({ ok: false, skipped: false, error: 'Error de sincronización' }))
            .toMatchObject({ status: 'failed', rollback: true });
    });

    it('un push salteado confirma con advertencia y marca la publicación pendiente', async () => {
        h.pushCloudSync.mockResolvedValue({ ok: false, skipped: true, error: 'Cambio remoto en aplicación' });

        await act(async () => { root = createRoot(container); });
        await act(async () => { root.render(<Harness />); });
        await flush();

        const insert = h.state.commandHandlers.find(handler => handler);
        await act(async () => { insert({ new: buildProductRow() }); });
        await flush();

        // El estado local SÍ se aplicó (el producto quedó editado en la caja)…
        const products = h.state.storage.get('bodega_products_v1');
        expect(products[0].priceUsd).toBe(2.5);
        // …pero el ACK no puede decir "applied" liso: fue applied_with_warnings.
        expect(rememberedCommand('cmd-product-1')).toMatchObject({ status: 'applied_with_warnings' });
        // H4: la reserva viaja explicada en el payload del ACK.
        expect(rememberedCommand('cmd-product-1').ackPayload.warnings?.join(' ')).toMatch(/Publicación a la nube/);
        // Y queda la marca que activa la re-publicación del barrido.
        expect(readProductPublishPending()).toMatchObject({ commandId: 'cmd-product-1' });
    });

    it('el barrido re-publica el catálogo y limpia la marca cuando la nube confirma', async () => {
        localStorage.setItem(PRODUCT_PUBLISH_PENDING_KEY, JSON.stringify({ commandId: 'cmd-anterior' }));
        h.pushCloudSync.mockResolvedValue({ ok: true, skipped: false });

        await act(async () => { root = createRoot(container); });
        await act(async () => { root.render(<Harness />); });
        await flush();

        // El barrido de arranque ya re-publicó el snapshot acumulado.
        expect(h.pushCloudSync).toHaveBeenCalledWith('bodega_products_v1', expect.any(Array), true);
        expect(readProductPublishPending()).toBeNull();
    });

    it('un push confirmado limpia la marca y confirma applied liso', async () => {
        localStorage.setItem(PRODUCT_PUBLISH_PENDING_KEY, JSON.stringify({ commandId: 'cmd-anterior' }));
        h.pushCloudSync.mockResolvedValue({ ok: true, skipped: false });

        await act(async () => { root = createRoot(container); });
        await act(async () => { root.render(<Harness />); });
        await flush();

        const insert = h.state.commandHandlers.find(handler => handler);
        await act(async () => { insert({ new: buildProductRow() }); });
        await flush();

        expect(rememberedCommand('cmd-product-1')).toMatchObject({ status: 'applied' });
        expect(readProductPublishPending()).toBeNull();
        // H4: sin reserva confirmada no hay warnings inventadas.
        expect(rememberedCommand('cmd-product-1').ackPayload.warnings).toBeUndefined();
    });

    it('un fallo real de publicación NO revierte el cambio local y deja la marca del barrido', async () => {
        h.pushCloudSync.mockResolvedValue({ ok: false, skipped: false, error: 'RLS' });

        await act(async () => { root = createRoot(container); });
        await act(async () => { root.render(<Harness />); });
        await flush();

        const insert = h.state.commandHandlers.find(handler => handler);
        await act(async () => { insert({ new: buildProductRow() }); });
        await flush();

        // Semántica Fase 1 del plan de cuelgue de caja (deliberada, sin
        // rollback): revertir el catálogo pisaría la venta que el cajero
        // escribió mientras se publicaba. El cambio local queda aplicado, el
        // comando confirma con advertencia (reintentable por el barrido) y la
        // marca de pendiente activa la re-publicación periódica.
        const products = h.state.storage.get('bodega_products_v1');
        expect(products[0].priceUsd).toBe(2.5);
        expect(rememberedCommand('cmd-product-1')).toMatchObject({ status: 'applied_with_warnings' });
        // H4: la reserva explicada viaja en el ACK.
        expect(rememberedCommand('cmd-product-1').ackPayload.warnings?.join(' ')).toMatch(/Publicación a la nube/);
        expect(readProductPublishPending()).toMatchObject({ commandId: 'cmd-product-1' });
    });
});
