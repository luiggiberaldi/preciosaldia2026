// @vitest-environment jsdom

// Panel de diagnóstico de comandos del supervisor: estado, latencia de ACK y
// reconciliaciones por commandId, alimentado por la telemetría real y el log de
// reconciliaciones.
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import SupervisorCommandDiagnosticsPanel from '../src/components/Monitor/SupervisorCommandDiagnosticsPanel';
import {
    clearCommandDiagnostics,
    flushLastCommandOutcome,
    flushReconciliations,
    recordReconciliation,
    reportSupervisorCommandOutcome,
} from '../src/services/supervisorCommandDiagnostics';
import {
    finishAckTelemetry,
    flushAckTelemetry,
    markAckTelemetry,
} from '../src/services/supervisorAckTelemetry';

async function flush() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}

describe('SupervisorCommandDiagnosticsPanel', () => {
    let container;
    let root;

    beforeEach(async () => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        await clearCommandDiagnostics();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        await Promise.all([flushAckTelemetry(), flushReconciliations()]);
    });

    it('estado vacío sin órdenes registradas', async () => {
        await act(async () => root.render(<SupervisorCommandDiagnosticsPanel isOpen onClose={() => {}} />));
        await flush();
        expect(container.querySelector('[data-testid="diagnostics-empty"]')).toBeTruthy();
        expect(container.textContent).toContain('Sin órdenes registradas todavía');
    });

    it('muestra por commandId estado, latencias del ACK y reconciliaciones, con stats p50/p95', async () => {
        // Telemetría real: dos comandos (uno con ACK tras publicar, como productos).
        markAckTelemetry('cmd-diag-1', 'processing_start', { type: 'supervisor.inventory.batch.adjust' });
        markAckTelemetry('cmd-diag-1', 'local_applied');
        markAckTelemetry('cmd-diag-1', 'ack_sent', { status: 'applied' });
        markAckTelemetry('cmd-diag-1', 'publish_end');
        finishAckTelemetry('cmd-diag-1');
        markAckTelemetry('cmd-diag-2', 'processing_start', { type: 'supervisor.product.delete' });
        markAckTelemetry('cmd-diag-2', 'local_applied');
        markAckTelemetry('cmd-diag-2', 'publish_end');
        markAckTelemetry('cmd-diag-2', 'ack_sent', { status: 'applied' });
        finishAckTelemetry('cmd-diag-2');
        recordReconciliation({
            commandId: 'cmd-diag-1',
            source: 'lote',
            via: 'auto',
            outcome: 'applied',
            status: 'applied',
            detail: 'Lote reconciliado en segundo plano',
        });
        await flushAckTelemetry();
        await flushReconciliations();

        await act(async () => root.render(<SupervisorCommandDiagnosticsPanel isOpen onClose={() => {}} />));
        await flush();

        // Stats globales.
        expect(container.textContent).toContain('ACK p50');
        expect(container.textContent).toContain('ACK p95');
        expect(container.textContent).toContain('Reconciliadas');

        // Fila del comando con su estado, tipo y latencias.
        const row1 = container.querySelector('[data-testid="diagnostics-row-cmd-diag-1"]');
        expect(row1).toBeTruthy();
        expect(row1.textContent).toContain('Lote de inventario');
        expect(row1.textContent).toContain('Aplicado');
        expect(row1.textContent).toContain('Latencia ACK');
        expect(row1.textContent).toContain('ACK vs nube');

        // La reconciliación quedó registrada por commandId, con su detalle.
        expect(row1.textContent).toContain('1 reconciliación');
        expect(row1.textContent).toContain('Lote · segundo plano · resuelto aplicado');
        expect(row1.textContent).toContain('Lote reconciliado en segundo plano');

        // El comando de producto también aparece (ACK tras publicar).
        const row2 = container.querySelector('[data-testid="diagnostics-row-cmd-diag-2"]');
        expect(row2).toBeTruthy();
        expect(row2.textContent).toContain('Producto · baja');
    });

    it('el botón de limpiar vacía el diagnóstico y lo recarga', async () => {
        recordReconciliation({ commandId: 'cmd-limp-1', source: 'fila', via: 'auto', outcome: 'applied' });
        await flushReconciliations();

        await act(async () => root.render(<SupervisorCommandDiagnosticsPanel isOpen onClose={() => {}} />));
        await flush();
        expect(container.querySelector('[data-testid="diagnostics-row-cmd-limp-1"]')).toBeTruthy();

        const clearButton = container.querySelector('button[aria-label="Limpiar diagnóstico"]');
        await act(async () => clearButton.click());
        await flush();
        expect(container.querySelector('[data-testid="diagnostics-empty"]')).toBeTruthy();
        expect(container.querySelector('[data-testid="diagnostics-row-cmd-limp-1"]')).toBe(null);
    });

    // ── Fase 2 del plan 2026-10-20: ningún error del servidor en silencio ────
    it('(c) el "último comando enviado" muestra tipo → estado (error) y sobrevive a cerrar y abrir el panel', async () => {
        reportSupervisorCommandOutcome({
            commandId: 'cmd-last',
            type: 'supervisor.inventory.batch.adjust',
            status: 'failed',
            error: 'Ventana temporal inválida',
        });
        await flushLastCommandOutcome();

        await act(async () => root.render(<SupervisorCommandDiagnosticsPanel isOpen onClose={() => {}} />));
        await flush();

        const banner = container.querySelector('[data-testid="diagnostics-last-command"]');
        expect(banner).toBeTruthy();
        expect(banner.textContent).toContain('Último comando enviado');
        expect(banner.textContent).toContain('Lote de inventario');
        expect(banner.textContent).toContain('Fallido');
        expect(banner.textContent).toContain('Ventana temporal inválida');

        // Cerrar y volver a abrir el panel: el estado persistido se mantiene.
        await act(async () => root.unmount());
        container.remove();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => root.render(<SupervisorCommandDiagnosticsPanel isOpen onClose={() => {}} />));
        await flush();

        const reopened = container.querySelector('[data-testid="diagnostics-last-command"]');
        expect(reopened).toBeTruthy();
        expect(reopened.textContent).toContain('Lote de inventario');
        expect(reopened.textContent).toContain('Ventana temporal inválida');
    });
});
