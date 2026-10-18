// @vitest-environment jsdom

// Panel de diagnóstico de sincronización del supervisor: pinta el último eco
// recibido con su watermark y el conteo de eventos 413 / pulls de respaldo que
// entrega useMonitorSync. Presentacional puro: se prueba con datos de entrada.
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import SupervisorSyncDiagnosticsPanel from '../src/components/Monitor/SupervisorSyncDiagnosticsPanel';
import { createSyncDiagnosticsState } from '../src/services/supervisorSyncService';

describe('SupervisorSyncDiagnosticsPanel', () => {
    let container;
    let root;

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root?.unmount());
        container?.remove();
    });

    const renderPanel = async (props) => {
        await act(async () => {
            root.render(<SupervisorSyncDiagnosticsPanel isOpen onClose={() => {}} {...props} />);
        });
    };

    it('cerrado no renderiza nada', async () => {
        await act(async () => {
            root.render(<SupervisorSyncDiagnosticsPanel isOpen={false} onClose={() => {}} diagnostics={createSyncDiagnosticsState()} />);
        });
        expect(container.innerHTML).toBe('');
    });

    it('muestra el último eco con su watermark, el origen del pull 413 y los contadores', async () => {
        await renderPanel({
            statusLabel: 'En Vivo',
            lastSync: new Date('2026-10-18T10:05:01.000Z'),
            diagnostics: {
                lastEcho: {
                    docId: 'bodega_products_v1',
                    updatedAt: '2026-10-18T10:05:00.000Z',
                    receivedAt: '2026-10-18T10:05:01.000Z',
                    source: 'pull-413',
                    applied: true,
                    error: null,
                },
                oversizeEvents: 3,
                oversizePulls: 2,
                lastOversizeAt: '2026-10-18T10:04:58.000Z',
                lastOversizePullAt: '2026-10-18T10:05:00.000Z',
            },
        });

        const text = container.textContent;
        expect(text).toContain('Diagnóstico de sincronización');
        expect(text).toContain('En Vivo');
        expect(text).toContain('bodega_products_v1');
        expect(text).toContain('Pull de respaldo (413)');
        expect(text).toContain('Aplicado');
        // El watermark viaja íntegro en el detalle (sin formatear).
        expect(text).toContain('2026-10-18T10:05:00.000Z');
        expect(container.querySelector('[data-testid="sync-diag-oversize-events"] p:last-child').textContent).toBe('3');
        expect(container.querySelector('[data-testid="sync-diag-oversize-pulls"] p:last-child').textContent).toBe('2');
    });

    it('marca como descartado un eco que no se aplicó y muestra su error', async () => {
        await renderPanel({
            statusLabel: 'En Vivo',
            diagnostics: {
                ...createSyncDiagnosticsState(),
                lastEcho: {
                    docId: 'bodega_products_v1',
                    updatedAt: '2026-10-18T09:00:00.000Z',
                    receivedAt: '2026-10-18T10:00:00.000Z',
                    source: 'realtime',
                    applied: false,
                    error: 'Documento antiguo o repetido',
                },
            },
        });

        const text = container.textContent;
        expect(text).toContain('Descartado');
        expect(text).toContain('Documento antiguo o repetido');
    });

    it('sin ecos muestra el estado vacío', async () => {
        await renderPanel({ statusLabel: 'Desconectado', diagnostics: createSyncDiagnosticsState() });
        expect(container.querySelector('[data-testid="sync-diag-empty"]')).not.toBeNull();
    });
});
