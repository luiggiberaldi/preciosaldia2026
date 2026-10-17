// @vitest-environment jsdom

// Telemetría de la latencia del ACK en la caja: las MISMAS magnitudes que
// tests/supervisorAckLatency.perf.test.jsx mide en local (ackLatencyMs,
// publishLatencyMs, ackLeadMs) quedan registradas por commandId en producción,
// con log [AckLatency] y un buffer acotado exportable.
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    ACK_TELEMETRY_MAX_ENTRIES,
    clearAckTelemetry,
    computeAckMetrics,
    finishAckTelemetry,
    flushAckTelemetry,
    getAckTelemetryEntries,
    markAckTelemetry,
    readAckTelemetry,
} from '../src/services/supervisorAckTelemetry';

const h = vi.hoisted(() => {
    const state = {
        row: null,
        fetchCalls: 0,
        pushDelayMs: 0,
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
            rpc: vi.fn(async () => ({ data: null, error: null })),
        },
    };
});

vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: h.client }));
vi.mock('../src/hooks/useCloudSync', () => ({
    pushLocalSync: vi.fn(),
    pushCloudSync: vi.fn(async () => {
        if (h.state.pushDelayMs > 0) await new Promise(resolve => setTimeout(resolve, h.state.pushDelayMs));
        return { ok: true };
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

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const BATCH_PAYLOAD = {
    batchVersion: 2,
    direction: 'ingreso',
    reason: 'Ajuste de stock',
    lines: [
        { lineId: 'line-1', productId: 'p-1', inputUnit: 'unidades', quantityInput: 5, expectedStock: 30 },
    ],
};

function Harness({ deviceId = 'device-12345678' }) {
    useRemoteCommands(deviceId, true);
    return null;
}

function buildProductDeleteRow(commandId) {
    const issuedAt = Date.now() - 1_000;
    return {
        command_id: commandId,
        status: 'pending',
        command_type: 'supervisor.product.delete',
        actor_auth_id: 'monitor-1',
        target_device_id: 'device-12345678',
        issued_at: new Date(issuedAt).toISOString(),
        expires_at: new Date(issuedAt + 50_000).toISOString(),
        schema_version: 1,
        payload: { productId: 'p-1' },
    };
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

describe('supervisorAckTelemetry · métricas puras (las del test local)', () => {
    it('calcula ackLatencyMs / publishLatencyMs / ackLeadMs desde los hitos', () => {
        const metrics = computeAckMetrics({
            processing_start: 1000,
            local_applied: 1005,
            ack_sent: 1012,
            ack_confirmed: 1016,
            publish_end: 1412,
        });
        expect(metrics).toEqual({
            ackLatencyMs: 12,
            ackConfirmMs: 16,
            localDurableMs: 5,
            publishLatencyMs: 412,
            ackLeadMs: 400,
        });
    });

    it('ackLeadMs conserva el signo: negativo cuando el ACK sale después de publicar', () => {
        // Comandos de producto: aún confirman DESPUÉS de publicar.
        const metrics = computeAckMetrics({
            processing_start: 1000,
            local_applied: 1040,
            publish_end: 1050,
            ack_sent: 1120,
        });
        expect(metrics.ackLeadMs).toBe(-70);
        expect(metrics.ackLatencyMs).toBe(120); // incluye la publicación
        expect(metrics.publishLatencyMs).toBe(50);
    });

    it('un hito ausente produce null (nunca un número inventado) y los negativos se recortan', () => {
        expect(computeAckMetrics({ processing_start: 1000 })).toEqual({
            ackLatencyMs: null,
            ackConfirmMs: null,
            localDurableMs: null,
            publishLatencyMs: null,
            ackLeadMs: null,
        });
        expect(computeAckMetrics({ processing_start: 1000, ack_sent: 900 }).ackLatencyMs).toBe(0);
        expect(computeAckMetrics().ackLatencyMs).toBe(null);
    });
});

describe('supervisorAckTelemetry · registro por commandId', () => {
    let logSpy;

    beforeEach(async () => {
        logSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        await clearAckTelemetry();
    });

    afterEach(async () => {
        await flushAckTelemetry();
        logSpy.mockRestore();
    });

    it('cierra un span con métricas, estado y log [AckLatency]', async () => {
        markAckTelemetry('c-1', 'processing_start', { type: 'supervisor.inventory.batch.adjust', deviceId: 'device-1' });
        markAckTelemetry('c-1', 'local_applied', { acknowledgedEarly: true });
        markAckTelemetry('c-1', 'ack_sent', { status: 'applied' });
        markAckTelemetry('c-1', 'ack_confirmed', { status: 'applied' });
        markAckTelemetry('c-1', 'publish_end');

        const entry = finishAckTelemetry('c-1');
        expect(entry.commandId).toBe('c-1');
        expect(entry.type).toBe('supervisor.inventory.batch.adjust');
        expect(entry.status).toBe('applied');
        expect(entry.acknowledgedEarly).toBe(true);
        expect(entry.metrics.ackLatencyMs).toBe(entry.marks.ack_sent - entry.marks.processing_start);
        expect(entry.metrics.publishLatencyMs).not.toBeNull();
        expect(entry.metrics.ackLeadMs).not.toBeNull();
        expect(getAckTelemetryEntries()).toHaveLength(1);
        expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining('[AckLatency] c-1'),
            expect.objectContaining({ commandId: 'c-1', ackLatencyMs: entry.metrics.ackLatencyMs }),
        );
        // Ya cerrado: repetir el cierre o marcar después no crea otra entrada.
        expect(finishAckTelemetry('c-1')).toBe(null);
        markAckTelemetry('c-1', 'ack_sent');
        expect(getAckTelemetryEntries()).toHaveLength(1);
    });

    it('descarta lo que no hay que medir: sin ACK o sin span abierto', async () => {
        markAckTelemetry('c-2', 'processing_start');
        expect(finishAckTelemetry('c-2')).toBe(null); // sin ACK: nada que medir

        markAckTelemetry('c-3', 'ack_sent'); // sin span: hito ignorado
        expect(finishAckTelemetry('c-3')).toBe(null);

        expect(finishAckTelemetry('desconocido')).toBe(null);
        expect(getAckTelemetryEntries()).toHaveLength(0);
    });

    it('conserva el primer inicio aunque la orden se reprocese (la latencia es hasta el ACK)', () => {
        const nowSpy = vi.spyOn(Date, 'now').mockReturnValue(1000);
        try {
            markAckTelemetry('c-4', 'processing_start');
            nowSpy.mockReturnValue(2000);
            markAckTelemetry('c-4', 'processing_start'); // reintento: no reinicia el reloj
            nowSpy.mockReturnValue(2010);
            markAckTelemetry('c-4', 'ack_sent');
            const entry = finishAckTelemetry('c-4');
            expect(entry.marks.processing_start).toBe(1000);
            expect(entry.metrics.ackLatencyMs).toBe(1010);
        } finally {
            nowSpy.mockRestore();
        }
    });

    it('el buffer es acotado y persiste para exportar en producción', async () => {
        for (let i = 0; i < ACK_TELEMETRY_MAX_ENTRIES + 5; i += 1) {
            markAckTelemetry(`c-${i}`, 'processing_start');
            markAckTelemetry(`c-${i}`, 'ack_sent', { status: 'applied' });
            finishAckTelemetry(`c-${i}`);
        }
        const entries = getAckTelemetryEntries();
        expect(entries).toHaveLength(ACK_TELEMETRY_MAX_ENTRIES);
        expect(entries[0].commandId).toBe('c-5'); // los más viejos se descartan

        await flushAckTelemetry();
        const persisted = await readAckTelemetry();
        expect(persisted).toHaveLength(ACK_TELEMETRY_MAX_ENTRIES);
        expect(persisted.some(entry => entry.commandId === `c-${ACK_TELEMETRY_MAX_ENTRIES + 4}`)).toBe(true);

        await clearAckTelemetry();
        expect(await readAckTelemetry()).toHaveLength(0);
        await flushAckTelemetry();
    });

    it('nunca lanza: la telemetría jamás interrumpe el flujo del receptor', () => {
        expect(() => markAckTelemetry(null, 'processing_start')).not.toThrow();
        expect(() => markAckTelemetry('c-x', 42)).not.toThrow();
        expect(() => markAckTelemetry(undefined, undefined)).not.toThrow();
        expect(() => finishAckTelemetry(undefined)).not.toThrow();
        expect(finishAckTelemetry('')).toBe(null);
    });
});

describe('supervisorAckTelemetry · wiring del receptor (caja)', () => {
    let container;
    let root;
    let logSpy;

    beforeEach(async () => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        logSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
        await clearAckTelemetry();
        h.state.row = null;
        h.state.fetchCalls = 0;
        h.state.pushDelayMs = 120; // publicación cloud deliberadamente lenta
        h.client.rpc.mockClear();
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
        await flushAckTelemetry();
        logSpy.mockRestore();
    });

    it('registra por commandId la latencia real del ACK con la misma definición que el test local', async () => {
        h.state.row = buildBatchRow('cmd-tel-1');

        await act(async () => root.render(<Harness />));
        await act(async () => { await sleep(400); });
        for (let i = 0; i < 5; i += 1) {
            await act(async () => { await Promise.resolve(); });
        }

        // La orden se procesó y confirmó igual que sin telemetría.
        expect(h.client.rpc).toHaveBeenCalledWith('ack_supervisor_command', expect.objectContaining({
            p_command_id: 'cmd-tel-1',
            p_status: 'applied',
        }));
        const products = await storageService.getItem('bodega_products_v1', []);
        expect(products[0].stock).toBe(35);

        const entry = getAckTelemetryEntries().find(item => item.commandId === 'cmd-tel-1');
        expect(entry).toBeTruthy();
        expect(entry.type).toBe('supervisor.inventory.batch.adjust');
        expect(entry.status).toBe('applied');
        expect(entry.acknowledgedEarly).toBe(true);

        // Misma definición que el test local (tAck − t0, tPublishEnd − t0,
        // tPublishEnd − tAck), con los hitos reales del receptor.
        expect(entry.metrics.ackLatencyMs).toBe(entry.marks.ack_sent - entry.marks.processing_start);
        expect(entry.metrics.publishLatencyMs).toBe(entry.marks.publish_end - entry.marks.processing_start);
        expect(entry.metrics.ackLeadMs).toBe(entry.marks.publish_end - entry.marks.ack_sent);
        // La estructura medida en local se reproduce en producción: el ACK sale
        // antes de que termine la publicación cloud y no la incluye.
        expect(entry.metrics.ackLatencyMs).toBeLessThan(120);
        expect(entry.marks.ack_sent).toBeLessThan(entry.marks.publish_end);
        expect(entry.metrics.ackLeadMs).toBeGreaterThanOrEqual(60);
        expect(entry.metrics.localDurableMs).not.toBeNull();

        // Log grep-able en producción y buffer exportable.
        expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining('[AckLatency] cmd-tel-1'),
            expect.objectContaining({ commandId: 'cmd-tel-1' }),
        );
        const persisted = await readAckTelemetry();
        expect(persisted.some(item => item.commandId === 'cmd-tel-1')).toBe(true);
    });

    it('comandos de producto: mide que el ACK sale al o después de publicar (ackLeadMs no positivo)', async () => {
        h.state.pushDelayMs = 60;
        h.state.row = buildProductDeleteRow('cmd-tel-prod-1');

        await act(async () => root.render(<Harness />));
        await act(async () => { await sleep(300); });
        for (let i = 0; i < 5; i += 1) {
            await act(async () => { await Promise.resolve(); });
        }

        const entry = getAckTelemetryEntries().find(item => item.commandId === 'cmd-tel-prod-1');
        expect(entry).toBeTruthy();
        expect(entry.type).toBe('supervisor.product.delete');
        expect(entry.status).toBe('applied');
        // Confirmación DESPUÉS de publicar: el fin de publicación no puede ser
        // posterior al ACK (con reloj de ms pueden caer en el mismo milisegundo,
        // por eso la cota es «nunca antes de publicar»).
        expect(entry.marks.ack_sent).toBeGreaterThanOrEqual(entry.marks.publish_end);
        expect(entry.metrics.ackLeadMs).toBe(entry.marks.publish_end - entry.marks.ack_sent);
        expect(entry.metrics.ackLeadMs).toBeLessThanOrEqual(0);
        expect(entry.metrics.ackLatencyMs).toBeGreaterThanOrEqual(entry.metrics.publishLatencyMs);
        expect(entry.metrics.localDurableMs).not.toBeNull();
        // El producto quedó eliminado igual que sin telemetría.
        const products = await storageService.getItem('bodega_products_v1', []);
        expect(products).toHaveLength(0);
        // El log refleja el signo: el ACK salió después de publicar.
        expect(logSpy).toHaveBeenCalledWith(
            expect.stringContaining('[AckLatency] cmd-tel-prod-1'),
            expect.objectContaining({ commandId: 'cmd-tel-prod-1' }),
        );
    });
});
