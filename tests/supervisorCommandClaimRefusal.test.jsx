// @vitest-environment jsdom
//
// Regresión de: «un rechazo de la caja resuelve el badge del producto en
// SEGUNDOS en vez de esperar el TTL».
//
//  - Si la caja NO puede reclamar la orden (rechazo definitivo del servidor:
//    permisos, comando desconocido), la terminaliza como cancelada — el RPC de
//    cancel lo permite al dueño sobre filas aún no reclamadas — y el monitor
//    recibe un ACK terminal en segundos. Antes la orden quedaba 'pending' y el
//    badge «ESPERANDO A LA CAJA» esperaba el TTL entero (o quedaba pegado).
//  - Un corte de red al reclamar se reintenta con backoff: JAMÁS se cancela
//    por un corte de red.
//  - Un desenlace ya recordado cuyo ACK se perdió (p. ej. un rechazo con la
//    red caída) se re-CONFIRMA cada vez que la orden vuelve a llegar abierta.

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
        ackCalls: [],
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
        claim: vi.fn(),
        cancelCommand: vi.fn(async ({ commandId }) => ({ command_id: commandId, status: 'cancelled' })),
        client: {
            channel: () => channel,
            removeChannel: vi.fn(() => Promise.resolve()),
            rpc: vi.fn(async (name, args) => {
                if (name === 'ack_supervisor_command') {
                    state.ackCalls.push(args);
                    return { data: { command_id: args.p_command_id, status: args.p_status }, error: null };
                }
                return { data: null, error: null };
            }),
            from: vi.fn(() => ({
                upsert: vi.fn(async () => ({ error: null })),
                select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: async () => ({ data: null, error: null }) })) })),
            })),
        },
        storageService: {
            getItem: vi.fn(async (key, fallback) => (state.storage.has(key) ? state.storage.get(key) : fallback)),
            setItem: vi.fn(async (key, value) => { state.storage.set(key, value); }),
        },
    };
});

vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: h.client }));
vi.mock('../src/hooks/useCloudSync', () => ({
    pushLocalSync: vi.fn(),
    pushCloudSync: vi.fn(async () => ({ ok: true, skipped: false })),
}));
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
    claimSupervisorCommand: (...args) => h.claim(...args),
    fetchSupervisorCommandsForRecovery: vi.fn(async () => ({ data: [], error: null })),
    readSupervisorCommandAck: vi.fn(),
    SUPERVISOR_TERMINAL_COMMAND_STATUSES: [],
    withSupervisorCommandLock: vi.fn(async (_id, fn) => fn()),
}));
vi.mock('../src/services/supervisorControlService', () => ({
    cancelSupervisorCommand: (...args) => h.cancelCommand(...args),
}));
vi.mock('../src/services/supervisorInventoryCommand', () => ({
    applySupervisorInventoryBatchTransaction: vi.fn(),
    retryInventoryPublish: vi.fn(async () => ({ retried: false, ok: true })),
    recoverSupervisorInventoryJournal: vi.fn(async () => ({ recovered: false, commandId: null, direction: null })),
}));
vi.mock('../src/services/supervisorUserCommand', () => ({ applySupervisorUserCommand: vi.fn() }));

import { useRemoteCommands } from '../src/hooks/useRemoteCommands';
import { validateSupervisorCommand } from '../src/services/supervisorContracts';

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

function buildRow(overrides = {}) {
    return {
        command_id: 'cmd-refuse-1',
        command_type: 'supervisor.product.update',
        target_device_id: 'device-12345678',
        actor_auth_id: 'auth-1',
        status: 'received',
        issued_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 60_000).toISOString(),
        payload: {
            productId: 'p1',
            baseRevision: 'rev-1',
            baseUpdatedAt: new Date().toISOString(),
            patch: { priceUsd: 2.5, baseRevision: 'rev-1' },
        },
        ...overrides,
    };
}

let container;
let root;

async function mountHarness() {
    await act(async () => { root = createRoot(container); });
    await act(async () => { root.render(<Harness />); });
    await flush();
}

function deliver(row) {
    const insert = h.state.commandHandlers.find(handler => handler);
    return act(async () => { insert({ new: row }); });
}

describe('Receptor: un rechazo de la caja terminaliza en segundos, nunca espera el TTL', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        h.state.commandHandlers = [];
        h.state.storage = new Map();
        h.state.ackCalls = [];
        h.claim.mockReset();
        h.claim.mockResolvedValue({ ok: true, claimed: true, status: 'received' });
        h.cancelCommand.mockClear();
        h.client.rpc.mockClear();
        vi.mocked(validateSupervisorCommand).mockReturnValue({ valid: true });
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

    it('rechazo definitivo del claim → la orden se cancela (terminal) y el badge resuelve en segundos', async () => {
        h.claim.mockResolvedValue({
            ok: false,
            status: 'failed',
            error: 'Comando no encontrado o caja no autorizada',
            retryable: false,
        });
        await mountHarness();

        await deliver(buildRow());
        await flush();

        // Un solo intento: un rechazo definitivo jamás se repite…
        expect(h.claim).toHaveBeenCalledTimes(1);
        // …pero la orden se terminaliza como cancelada: el monitor recibe un ACK
        // terminal en segundos en vez de esperar el TTL con «ESPERANDO A LA CAJA».
        expect(h.cancelCommand).toHaveBeenCalledTimes(1);
        expect(h.cancelCommand.mock.calls[0][0]).toMatchObject({
            commandId: 'cmd-refuse-1',
            reason: 'La caja no pudo reclamar la orden',
        });
    });

    it('un corte de red al reclamar se reintenta con backoff y NUNCA se cancela', async () => {
        h.claim.mockResolvedValue({
            ok: false,
            status: 'failed',
            error: 'Failed to fetch',
            retryable: true,
        });
        await mountHarness();

        await deliver(buildRow());
        await flush();
        // El primer intento falló por transporte: se re-intenta con backoff
        // (500 ms y 1.5 s escalonados: cada reintento vive en su propio tick).
        await act(async () => { vi.advanceTimersByTime(600); });
        await flush();
        await act(async () => { vi.advanceTimersByTime(1_600); });
        await flush();

        expect(h.claim.mock.calls.length).toBe(3);
        expect(h.cancelCommand).not.toHaveBeenCalled();
    });

    it('un rechazo cuyo ACK se perdió se re-CONFIRMA al volver a llegar la orden abierta', async () => {
        await mountHarness();

        // La caja rechaza la orden por validación, pero el ACK se pierde (403).
        vi.mocked(validateSupervisorCommand).mockReturnValueOnce({ valid: false, error: 'Payload inválido' });
        h.client.rpc.mockImplementationOnce(async () => ({
            data: null,
            error: { message: 'RLS denegado', status: 403 },
        }));
        await deliver(buildRow());
        await flush();

        // El desenlace (rechazo) quedó recordado localmente aunque el ACK no salió…
        expect(h.state.storage.get('supervisor_applied_commands_v1')['cmd-refuse-1'])
            .toMatchObject({ status: 'rejected', errorMessage: 'Payload inválido' });
        expect(h.state.ackCalls).toHaveLength(0);

        // …y al volver a llegar la orden abierta (barrido/realtime), la caja
        // re-emite el ACK del rechazo: el badge del monitor se resuelve en segundos.
        await deliver(buildRow());
        await flush();

        expect(h.state.ackCalls).toContainEqual(expect.objectContaining({
            p_command_id: 'cmd-refuse-1',
            p_status: 'rejected',
        }));
    });
});
