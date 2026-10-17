// @vitest-environment jsdom

// Diagnóstico de comandos del supervisor: log de reconciliaciones por
// commandId, mezcla con la telemetría del ACK (estado + latencias) y
// estadísticas globales (p50/p95 del ACK, misma definición del test de
// rendimiento).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    RECONCILIATIONS_MAX_ENTRIES,
    buildCommandDiagnostics,
    clearCommandDiagnostics,
    commandTypeLabel,
    flushReconciliations,
    formatAckMs,
    getReconciliations,
    loadCommandDiagnostics,
    percentileOf,
    readReconciliations,
    recordReconciliation,
    shortCommandId,
    statusChipLabel,
} from '../src/services/supervisorCommandDiagnostics';
import {
    finishAckTelemetry,
    flushAckTelemetry,
    markAckTelemetry,
} from '../src/services/supervisorAckTelemetry';

function createMapStorage() {
    const data = new Map();
    return {
        getItem: async (key, fallback = null) => (data.has(key) ? structuredClone(data.get(key)) : fallback),
        setItem: async (key, value) => { data.set(key, structuredClone(value)); },
        removeItem: async (key) => { data.delete(key); },
    };
}

describe('supervisorCommandDiagnostics · registro de reconciliaciones', () => {
    beforeEach(async () => {
        await clearCommandDiagnostics();
    });

    afterEach(async () => {
        await flushReconciliations();
    });

    it('registra por commandId con fuente, vía y desenlace', () => {
        const entry = recordReconciliation({
            commandId: 'cmd-1',
            source: 'lote',
            via: 'auto',
            outcome: 'applied',
            status: 'applied',
            detail: 'Lote reconciliado en segundo plano',
        });
        expect(entry).toMatchObject({ commandId: 'cmd-1', source: 'lote', via: 'auto', outcome: 'applied' });
        expect(getReconciliations()).toHaveLength(1);
    });

    it('rechaza entradas inválidas sin romper', () => {
        expect(recordReconciliation()).toBe(null);
        expect(recordReconciliation({ commandId: '', source: 'lote', outcome: 'applied' })).toBe(null);
        expect(recordReconciliation({ commandId: 'x', source: 'otra', outcome: 'applied' })).toBe(null);
        expect(recordReconciliation({ commandId: 'x', source: 'lote', outcome: 'quizas' })).toBe(null);
        expect(getReconciliations()).toHaveLength(0);
    });

    it('el buffer es acotado', () => {
        for (let i = 0; i < RECONCILIATIONS_MAX_ENTRIES + 3; i += 1) {
            recordReconciliation({ commandId: `c-${i}`, source: 'fila', outcome: 'applied' });
        }
        const entries = getReconciliations();
        expect(entries).toHaveLength(RECONCILIATIONS_MAX_ENTRIES);
        expect(entries[0].commandId).toBe('c-3');
    });

    it('persiste y se vuelve a leer', async () => {
        const storage = createMapStorage();
        recordReconciliation({ commandId: 'cmd-p', source: 'fila', via: 'auto', outcome: 'failed' });
        await flushReconciliations();
        const persisted = await readReconciliations();
        expect(persisted.some(entry => entry.commandId === 'cmd-p')).toBe(true);
        // Storage propio sin nada → cae a la memoria.
        expect(await readReconciliations({ storage })).toHaveLength(1);
    });
});

describe('supervisorCommandDiagnostics · métricas y etiquetas', () => {
    it('percentileOf usa el mismo rango del test de rendimiento (ceil(p·N)−1)', () => {
        expect(percentileOf([10, 20, 30, 40], 0.5)).toBe(20);
        expect(percentileOf([10, 20, 30, 40], 0.95)).toBe(40);
        expect(percentileOf([5], 0.95)).toBe(5);
        expect(percentileOf([], 0.95)).toBe(null);
        expect(percentileOf([4, 1, 3, 'x'], 0.5)).toBe(3);
    });

    it('etiquetas de tipo, estado y formato de ms', () => {
        expect(commandTypeLabel('supervisor.inventory.batch.adjust')).toBe('Lote de inventario');
        expect(commandTypeLabel('supervisor.product.delete')).toBe('Producto · baja');
        expect(statusChipLabel('applied_with_warnings')).toBe('Con advertencias');
        expect(statusChipLabel(null)).toBe('Sin ACK');
        expect(formatAckMs(12)).toBe('12 ms');
        expect(formatAckMs(null)).toBe('—');
        expect(shortCommandId('cmd_largo_123456789')).toBe('cmd_larg…6789');
        expect(shortCommandId('corta')).toBe('corta');
    });
});

describe('supervisorCommandDiagnostics · mezcla por commandId', () => {
    beforeEach(async () => {
        await clearCommandDiagnostics();
    });

    afterEach(async () => {
        await flushReconciliations();
    });

    it('une telemetría y reconciliaciones en una fila con latencias y stats', () => {
        const { rows, summary } = buildCommandDiagnostics({
            telemetry: [
                {
                    commandId: 'cmd-a',
                    type: 'supervisor.inventory.batch.adjust',
                    status: 'applied',
                    acknowledgedEarly: true,
                    startedAt: '2026-10-17T10:00:00.000Z',
                    finishedAt: '2026-10-17T10:00:01.000Z',
                    metrics: { ackLatencyMs: 10, publishLatencyMs: 300, ackLeadMs: 290, localDurableMs: 4 },
                },
                {
                    commandId: 'cmd-b',
                    type: 'supervisor.product.delete',
                    status: 'applied',
                    finishedAt: '2026-10-17T10:05:00.000Z',
                    metrics: { ackLatencyMs: 30, publishLatencyMs: 50, ackLeadMs: -20 },
                },
            ],
            reconciliations: [
                { commandId: 'cmd-a', source: 'lote', via: 'auto', outcome: 'applied', status: 'applied', detail: 'resuelto', at: '2026-10-17T10:00:02.000Z' },
            ],
        });

        expect(rows.map(row => row.commandId)).toEqual(['cmd-b', 'cmd-a']); // más reciente primero
        const rowA = rows.find(row => row.commandId === 'cmd-a');
        expect(rowA.reconcileCount).toBe(1);
        expect(rowA.reconciliations[0]).toMatchObject({ source: 'lote', via: 'auto', outcome: 'applied' });
        expect(rowA.metrics.ackLatencyMs).toBe(10);

        expect(summary.total).toBe(2);
        expect(summary.withAck).toBe(2);
        expect(summary.applied).toBe(2);
        expect(summary.reconciled).toBe(1);
        expect(summary.confirmAfterPublish).toBe(1); // cmd-b confirma tras publicar
        expect(summary.ackP50Ms).toBe(10);
        expect(summary.ackP95Ms).toBe(30);
        expect(summary.ackMaxMs).toBe(30);
    });

    it('una reconciliación sin telemetría propia igual aparece en el diagnóstico', () => {
        const { rows, summary } = buildCommandDiagnostics({
            telemetry: [],
            reconciliations: [
                { commandId: 'cmd-x', source: 'fila', via: 'manual', outcome: 'failed', at: '2026-10-17T11:00:00.000Z' },
            ],
        });
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ commandId: 'cmd-x', status: 'failed', reconcileCount: 1 });
        expect(summary.total).toBe(1);
        expect(summary.failed).toBe(1);
        expect(summary.ackP95Ms).toBe(null);
    });

    it('loadCommandDiagnostics mezcla ambas fuentes reales (memoria)', async () => {
        markAckTelemetry('cmd-live', 'processing_start', { type: 'supervisor.inventory.batch.adjust' });
        markAckTelemetry('cmd-live', 'local_applied');
        markAckTelemetry('cmd-live', 'ack_sent', { status: 'applied' });
        markAckTelemetry('cmd-live', 'publish_end');
        finishAckTelemetry('cmd-live');
        recordReconciliation({ commandId: 'cmd-live', source: 'lote', via: 'auto', outcome: 'applied', detail: 'resuelto en segundo plano' });

        const { rows, summary } = await loadCommandDiagnostics({ storage: createMapStorage() });
        const row = rows.find(item => item.commandId === 'cmd-live');
        expect(row).toBeTruthy();
        expect(row.reconciliations).toHaveLength(1);
        expect(row.metrics.ackLatencyMs).toBeGreaterThanOrEqual(0);
        expect(summary.reconciled).toBe(1);
        await flushAckTelemetry();
    });

    it('clearCommandDiagnostics limpia ambas fuentes', async () => {
        markAckTelemetry('cmd-c', 'processing_start');
        markAckTelemetry('cmd-c', 'ack_sent', { status: 'applied' });
        finishAckTelemetry('cmd-c');
        recordReconciliation({ commandId: 'cmd-c', source: 'fila', outcome: 'applied' });

        await clearCommandDiagnostics({ storage: createMapStorage() });
        const { rows } = await loadCommandDiagnostics({ storage: createMapStorage() });
        expect(rows).toHaveLength(0);
    });
});
