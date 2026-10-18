// @vitest-environment jsdom

// ── Fase 3: el resultado SIEMPRE se avisa (propuesta 2) ─────────────────────
// Regla: "el supervisor debe saber si su cambio hizo efecto o no, en cualquier
// tipo de cambio". Estas pruebas aseguran:
//   1. Sin silencio: para TODO tipo de comando y TODO desenlace terminal hay
//      exactamente un aviso final (éxito SIEMPRE verde, error con motivo).
//   2. Sin duplicados: un comando = un aviso final (dedupe ante Realtime +
//      polling o dobles registros).
//   3. Integración: el modal se cierra al registrarse la orden y el resultado
//      llega como aviso; un envío fallido NO cierra el modal.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/supervisorPolicy', () => ({
    SUPERVISOR_REMOTE_MUTATIONS_ENABLED: true,
    SUPERVISOR_REMOTE_PRODUCTS_ENABLED: true,
    SUPERVISOR_REMOTE_INCOME_ENABLED: true,
    SUPERVISOR_REMOTE_RATE_ENABLED: true,
    SUPERVISOR_REMOTE_EGRESS_ENABLED: true,
    SUPERVISOR_EXTENDED_TTL_ENABLED: false,
}));

vi.mock('../src/services/supervisorCommandService', () => ({
    sendSupervisorCommand: vi.fn(),
    awaitSupervisorCommandAck: vi.fn(),
    inspectSupervisorCommandState: vi.fn(),
    shouldAwaitSupervisorAck: vi.fn(() => true),
}));

vi.mock('../src/components/Toast', () => ({
    showToast: vi.fn(),
}));

import SupervisorRateModal from '../src/components/Monitor/SupervisorRateModal';
import { sendSupervisorCommand, awaitSupervisorCommandAck, inspectSupervisorCommandState, shouldAwaitSupervisorAck } from '../src/services/supervisorCommandService';
import { showToast } from '../src/components/Toast';
import {
    resetSupervisorCommandTracker,
    trackSupervisorCommand,
    isCommandOutcomeOwned,
} from '../src/services/supervisorCommandTracker';

const ALL_COMMAND_TYPES = [
    'supervisor.rate.set',
    'supervisor.product.create',
    'supervisor.product.update',
    'supervisor.product.delete',
    'supervisor.user.create',
    'supervisor.user.pin.change',
    'supervisor.user.update',
    'supervisor.user.delete',
    'supervisor.shift.close',
    'supervisor.shift.reopen',
    'supervisor.inventory.batch.adjust',
];

const OUTCOME_TOAST_TYPE = {
    applied: 'success',
    applied_with_warnings: 'warning',
    rejected: 'error',
    failed: 'error',
    cancelled: 'warning',
};

const ackOf = (status, extra = {}) => ({
    ok: status === 'applied' || status === 'applied_with_warnings',
    status,
    commandId: 'cmd-x',
    ack: null,
    error: null,
    ...extra,
});

const finalsOf = (spy) => spy.mock.calls.filter(([, type]) => type !== 'info');

beforeEach(() => {
    resetSupervisorCommandTracker();
    vi.clearAllMocks();
});

describe('sin silencio: todo tipo de cambio termina en un aviso final', () => {
    it.each(ALL_COMMAND_TYPES)('%s → éxito SIEMPRE anunciado con un único aviso verde', async (type) => {
        const notify = vi.fn();
        const record = trackSupervisorCommand({
            commandId: `cmd-${type}`,
            type,
            payload: {},
            ackPromise: Promise.resolve(ackOf('applied', { commandId: `cmd-${type}` })),
            notify,
            followUpIntervalMs: 1,
            followUpBudgetMs: 5,
            sleep: async () => {},
        });
        await record.promise;

        const finals = finalsOf(notify);
        expect(finals).toHaveLength(1);
        expect(finals[0][1]).toBe('success');
        expect(finals[0][0]).toContain('✅');
    });

    it.each(ALL_COMMAND_TYPES)('%s → todo desenlace terminal produce exactamente un aviso final', async (type) => {
        for (const [status, toastType] of Object.entries(OUTCOME_TOAST_TYPE)) {
            resetSupervisorCommandTracker();
            const notify = vi.fn();
            const record = trackSupervisorCommand({
                commandId: `cmd-${type}-${status}`,
                type,
                payload: {},
                ackPromise: Promise.resolve(ackOf(status, { commandId: `cmd-${type}-${status}` })),
                notify,
                followUpIntervalMs: 1,
                followUpBudgetMs: 5,
                sleep: async () => {},
            });
            await record.promise;

            const finals = finalsOf(notify);
            expect(finals).toHaveLength(1);
            expect(finals[0][1]).toBe(toastType);
            if (status === 'rejected' || status === 'failed') {
                // El error siempre trae un motivo en palabras, nunca vacío.
                expect(finals[0][0].length).toBeGreaterThan(20);
            }
        }
    });

    it('sin confirmación: el camino termina con el aviso ámbar "sigue esperando" (nunca silencio)', async () => {
        const notify = vi.fn();
        const record = trackSupervisorCommand({
            commandId: 'cmd-quiet',
            type: 'supervisor.inventory.batch.adjust',
            ackPromise: Promise.resolve({ ok: false, status: 'timeout', error: 'La caja no confirmó la orden a tiempo' }),
            notify,
            inspectState: async () => ({ state: 'active', ack: null }),
            followUpIntervalMs: 1,
            followUpBudgetMs: 3,
            sleep: async () => {},
        });
        await record.promise;

        const waiting = finalsOf(notify).filter(([message, type]) => type === 'warning' && String(message).includes('Sigue esperando'));
        expect(waiting.length).toBeGreaterThanOrEqual(1);
    });
});

describe('sin duplicados: un comando = un aviso final', () => {
    it('un ACK terminal (Realtime) y una inspección posterior (polling) producen UN solo aviso final', async () => {
        const notify = vi.fn();
        const record = trackSupervisorCommand({
            commandId: 'cmd-dup',
            type: 'supervisor.product.update',
            ackPromise: Promise.resolve(ackOf('applied', { commandId: 'cmd-dup' })),
            inspectState: async () => ({ state: 'terminal', ack: ackOf('applied', { commandId: 'cmd-dup' }) }),
            notify,
            followUpIntervalMs: 1,
            followUpBudgetMs: 50,
            sleep: async () => {},
        });
        await record.promise;

        expect(finalsOf(notify)).toHaveLength(1);
        // El desenlace ya resuelto no dispara seguimiento posterior.
        expect(inspectSupervisorCommandState).not.toHaveBeenCalled();
    });

    it('registrar dos veces el mismo commandId (reintento) no duplica el aviso final', async () => {
        const notify = vi.fn();
        const ack = Promise.resolve(ackOf('applied', { commandId: 'cmd-retry' }));
        const first = trackSupervisorCommand({ commandId: 'cmd-retry', type: 'supervisor.user.delete', ackPromise: ack, notify });
        const second = trackSupervisorCommand({ commandId: 'cmd-retry', type: 'supervisor.user.delete', ackPromise: ack, notify });
        await first.promise;

        expect(second).toBe(first);
        expect(finalsOf(notify)).toHaveLength(1);
    });

    it('isCommandOutcomeOwned permite al resto de la interfaz no duplicar el aviso del mismo comando', async () => {
        const notify = vi.fn();
        const record = trackSupervisorCommand({
            commandId: 'cmd-owned',
            type: 'supervisor.product.delete',
            ackPromise: Promise.resolve(ackOf('rejected', { commandId: 'cmd-owned', error: 'el producto ya no existe' })),
            notify,
        });
        await record.promise;

        expect(isCommandOutcomeOwned('cmd-owned')).toBe(true);
        const finals = finalsOf(notify);
        expect(finals).toHaveLength(1);
        expect(finals[0][1]).toBe('error');
        expect(finals[0][0]).toContain('el producto ya no existe');
    });
});

describe('integración: confirmar y seguir con el resultado siempre visible', () => {
    let container;
    let root;

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
    });

    it('el modal de tasa se cierra al registrarse la orden y el ÉXITO se avisa igual (nunca silencio)', async () => {
        shouldAwaitSupervisorAck.mockImplementation(() => false); // la tasa es notificación automática
        sendSupervisorCommand.mockResolvedValue({ ok: true, status: 'sent', commandId: 'cmd-rate-1', ackPromise: null });
        awaitSupervisorCommandAck.mockResolvedValue(ackOf('applied', { commandId: 'cmd-rate-1' }));

        const onClose = vi.fn();
        await act(async () => root.render(
            <SupervisorRateModal isOpen onClose={onClose} targetDeviceId="device-1" currentRateMode="bcv" rates={{}} remoteAvailable />,
        ));
        await act(async () => {
            Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Aplicar Tasa Remota')).click();
        });
        await act(async () => {});

        // "Confirma y sigue": se cierra al quedar la orden registrada.
        expect(onClose).toHaveBeenCalledTimes(1);
        // El envío se anuncia como notificación (sin "esperando confirmación"...)
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('Notificación'), 'info');
        // ...pero el ÉXITO final SIEMPRE se muestra, también en la tasa.
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('✅'), 'success');
    });

    it('un envío fallido NO cierra el modal y deja el error a la vista', async () => {
        sendSupervisorCommand.mockResolvedValue({ ok: false, status: 'unauthenticated', error: 'No hay sesión segura' });

        const onClose = vi.fn();
        await act(async () => root.render(
            <SupervisorRateModal isOpen onClose={onClose} targetDeviceId="device-1" currentRateMode="bcv" rates={{}} remoteAvailable />,
        ));
        await act(async () => {
            Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Aplicar Tasa Remota')).click();
        });
        await act(async () => {});

        expect(onClose).not.toHaveBeenCalled();
        expect(showToast).toHaveBeenCalledWith('No hay sesión segura', 'error');
    });
});
