// @vitest-environment jsdom

// ── Propuesta 6: poder arrepentirse ────────────────────────────────────────
// ANULAR TODOS recorre los pendientes propios y llama al RPC de anulación por
// cada uno. Regla honesta: nunca se promete "anulado" sin confirmación del
// servidor; lo que la caja ya tomó se reporta como no anulado con el aviso
// literal "el cambio puede haber llegado ya a la caja; verifica su estado".

import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    fetchCommands: vi.fn(),
    fetchCounts: vi.fn(),
    fetchDetail: vi.fn(),
    cancelCommand: vi.fn(),
}));

vi.mock('../src/config/supabaseCloud', () => ({
    supabaseCloud: {
        channel: () => ({ on: () => ({ subscribe: () => ({}) }) }),
        removeChannel: vi.fn(async () => {}),
    },
}));

vi.mock('../src/services/supervisorControlService', () => ({
    CONTROL_PAGE_SIZE: 25,
    CONTROL_POLL_INTERVAL_MS: 45_000,
    CONTROL_STATUS: {
        LOCAL_PENDING: 'local_pending',
        PENDING: 'pending',
        RECEIVED: 'received',
        APPLIED: 'applied',
        APPLIED_WITH_WARNINGS: 'applied_with_warnings',
        FAILED: 'failed',
        REJECTED: 'rejected',
        CANCELLED: 'cancelled',
        EXPIRED: 'expired',
        CONFLICT: 'conflict',
    },
    getControlStatus: (command) => command?.status,
    cancelSupervisorCommand: mocks.cancelCommand,
    fetchSupervisorControlCommands: mocks.fetchCommands,
    fetchSupervisorControlCounts: mocks.fetchCounts,
    fetchSupervisorControlDetail: mocks.fetchDetail,
}));

import { useSupervisorControl } from '../src/hooks/useSupervisorControl';
import { describeCancelFailure } from '../src/components/Monitor/SupervisorControlPanel';

const command = (id, status) => ({
    command_id: id,
    command_type: 'supervisor.inventory.batch.adjust',
    status,
    payload: { direction: 'ingreso', productId: `p-${id}` },
    issued_at: '2026-10-18T07:00:00.000Z',
    created_at: '2026-10-18T07:00:00.000Z',
    updated_at: '2026-10-18T07:00:00.000Z',
});

beforeEach(() => {
    vi.clearAllMocks();
    mocks.fetchCommands.mockResolvedValue({
        data: [command('c-1', 'pending'), command('c-2', 'pending'), command('c-3', 'pending'), command('c-4', 'applied')],
        count: 4,
        error: null,
    });
    mocks.fetchCounts.mockResolvedValue({ counts: { total: 4, pending: 3, applied: 1 }, error: null });
});

describe('ANULAR TODOS: resultado real, sin promesas falsas', () => {
    it('anula los pendientes y reporta cada uno que no se pudo', async () => {
        mocks.cancelCommand.mockImplementation(async ({ commandId }) => {
            if (commandId === 'c-3') {
                return { ok: false, status: 'received', error: 'La orden ya no está pendiente (estado: received) y no se anuló' };
            }
            return { ok: true, status: 'cancelled' };
        });

        const { result } = renderHook(() => useSupervisorControl({ targetDeviceId: 'caja-1', enabled: true }));
        await act(async () => {});

        let summary;
        await act(async () => { summary = await result.current.cancelAll(); });

        expect(mocks.cancelCommand).toHaveBeenCalledTimes(3); // solo los 3 pendientes
        expect(summary).toMatchObject({ total: 3, cancelled: 2 });
        expect(summary.notCancelled).toHaveLength(1);
        expect(summary.notCancelled[0]).toMatchObject({ commandId: 'c-3', status: 'received' });
    });

    it('sin pendientes no anula nada ni llama al servidor', async () => {
        mocks.fetchCommands.mockResolvedValue({
            data: [command('c-1', 'applied')],
            count: 1,
            error: null,
        });
        const { result } = renderHook(() => useSupervisorControl({ targetDeviceId: 'caja-1', enabled: true }));
        await act(async () => {});

        let summary;
        await act(async () => { summary = await result.current.cancelAll(); });
        expect(summary).toMatchObject({ total: 0, cancelled: 0 });
        expect(mocks.cancelCommand).not.toHaveBeenCalled();
    });
});

describe('describeCancelFailure: el aviso honesto del arrepentimiento tardío', () => {
    it('si la caja ya pudo tomar el cambio, lo dice literalmente', () => {
        const message = describeCancelFailure({
            ok: false,
            status: 'received',
            error: 'La orden ya no está pendiente (estado: received) y no se anuló',
        });
        expect(message).toContain('no se anuló');
        expect(message).toContain('El cambio puede haber llegado ya a la caja; verifica su estado.');
    });

    it('un fallo de red no inventa que la caja tomó el cambio', () => {
        const message = describeCancelFailure({ ok: false, error: 'No se pudo anular el comando' });
        expect(message).toBe('No se pudo anular el comando');
        expect(message).not.toContain('puede haber llegado ya');
    });
});
