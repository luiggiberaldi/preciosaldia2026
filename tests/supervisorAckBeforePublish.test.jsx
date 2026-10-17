// @vitest-environment jsdom

// Fase 11: el ACK de un lote de inventario se envía cuando el estado local es
// durable y ANTES de cualquier publicación cloud. Este test recorre el camino
// real (useRemoteCommands → applySupervisorInventoryBatchTransaction) con la
// transacción real y solo mocks de red/storage: si algún día el ACK vuelve a
// quedarse detrás de la publicación, estos tests fallan.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
    const events = [];
    const state = {
        events,
        row: null,
        fetchCalls: 0,
        pushResult: { ok: true },
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
vi.mock('../src/services/supervisorCommandService', () => ({
    claimSupervisorCommand: vi.fn(async () => ({ ok: true, claimed: true, status: 'received' })),
    fetchSupervisorCommandsForRecovery: vi.fn(async () => {
        h.state.fetchCalls += 1;
        return { data: h.state.fetchCalls === 1 && h.state.row ? [h.state.row] : [], error: null };
    }),
    readSupervisorCommandAck: vi.fn(async () => null),
    SUPERVISOR_TERMINAL_COMMAND_STATUSES: [
        'applied', 'applied_with_warnings', 'rejected', 'failed', 'cancelled',
    ],
    withSupervisorCommandLock: vi.fn(async (_id, fn) => fn()),
}));

import { useRemoteCommands } from '../src/hooks/useRemoteCommands';
import { storageService } from '../src/utils/storageService';

const JOURNAL_KEY = 'bodega_supervisor_inventory_journal_v1';

function Harness({ deviceId = 'device-12345678' }) {
    useRemoteCommands(deviceId, true);
    return null;
}

async function flush(times = 8) {
    for (let i = 0; i < times; i += 1) {
        await act(async () => {
            await new Promise(resolve => setTimeout(resolve, 0));
        });
    }
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
        payload: {
            batchVersion: 2,
            direction: 'ingreso',
            reason: 'Ajuste de stock',
            lines: [
                { lineId: 'line-1', productId: 'p-1', inputUnit: 'unidades', quantityInput: 5, expectedStock: 30 },
            ],
        },
    };
}

describe('Fase 11: el ACK del lote de inventario va antes de la publicación cloud', () => {
    let container;
    let root;

    beforeEach(async () => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        h.state.events.length = 0;
        h.state.row = null;
        h.state.fetchCalls = 0;
        h.state.pushResult = { ok: true };
        h.client.rpc.mockClear();
        localStorage.clear();
        await storageService.setItem('bodega_products_v1', [{ id: 'p-1', name: 'Velas', stock: 30 }]);
        await storageService.setItem('bodega_sales_v1', [{ id: 'sale-1', tipo: 'VENTA' }]);
        await storageService.removeItem(JOURNAL_KEY);
        await storageService.removeItem('supervisor_applied_commands_v1');
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root?.unmount());
        container?.remove();
    });

    it('confirma el lote (ACK) antes de la publicación cloud', async () => {
        h.state.row = buildBatchRow('cmd-ack-order-1');
        await act(async () => root.render(<Harness />));
        await flush();

        const events = h.state.events;
        const ackIndex = events.indexOf('ack:applied');
        const publishIndex = events.findIndex(event => event.startsWith('publish:'));
        expect(ackIndex).toBeGreaterThanOrEqual(0);
        expect(publishIndex).toBeGreaterThanOrEqual(0);
        expect(ackIndex).toBeLessThan(publishIndex);
        expect(h.client.rpc).toHaveBeenCalledWith('ack_supervisor_command', expect.objectContaining({
            p_command_id: 'cmd-ack-order-1',
            p_status: 'applied',
        }));

        const products = await storageService.getItem('bodega_products_v1', []);
        expect(products[0].stock).toBe(35);
    });

    it('confirma igual cuando la publicación cloud falla (el movimiento ya es durable)', async () => {
        h.state.pushResult = { ok: false, error: 'sync caído' };
        h.state.row = buildBatchRow('cmd-ack-order-2');
        await act(async () => root.render(<Harness />));
        await flush();

        const events = h.state.events;
        const ackIndex = events.indexOf('ack:applied');
        const publishIndex = events.findIndex(event => event.startsWith('publish:'));
        expect(ackIndex).toBeGreaterThanOrEqual(0);
        expect(publishIndex).toBeGreaterThanOrEqual(0);
        expect(ackIndex).toBeLessThan(publishIndex);

        const products = await storageService.getItem('bodega_products_v1', []);
        expect(products[0].stock).toBe(35);
        const journal = await storageService.getItem(JOURNAL_KEY, null);
        expect(journal).toMatchObject({ state: 'published_pending', commandId: 'cmd-ack-order-2' });
    });
});
