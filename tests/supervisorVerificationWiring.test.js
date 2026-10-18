// ── Fase 2: cableado del eco → sellos en vivo ───────────────────────────────
// Cuando el monitor aplica un eco (sync_documents) posterior a un comando, el
// evaluador decide el sello y se registra (recordVerification, análogo a
// recordReconciliation). El tracker lo refleja en su estado:
//   - el sello es ESTADO, no un aviso nuevo (regla "un cambio = un aviso");
//   - solo un 'mismatch' merece un aviso rojo aparte (es una alerta).
// Y la frescura es POR DOMINIO: un eco de productos más reciente jamás valida
// una tasa vieja (eso produciría falsos "No coincide").

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
    evaluateCommandVerification,
    verifyCommandsAgainstEcho,
} from '../src/services/supervisorCommandVerification';
import {
    clearCommandDiagnostics,
    getVerifications,
    readVerifications,
    recordVerification,
} from '../src/services/supervisorCommandDiagnostics';
import {
    getTrackedSupervisorCommands,
    resetSupervisorCommandTracker,
    setCommandVerification,
    trackSupervisorCommand,
} from '../src/services/supervisorCommandTracker';

const APPLIED_AT = '2026-10-18T07:04:00.000Z';
const ECHO_AT = '2026-10-18T07:04:30.000Z';
const NOW = Date.parse('2026-10-18T07:05:00.000Z');

const appliedCommand = (commandId, type, payload, extra = {}) => ({
    command_id: commandId,
    command_type: type,
    status: 'applied',
    payload,
    updated_at: APPLIED_AT,
    ...extra,
});

const echo = (extra = {}) => ({
    updatedAt: ECHO_AT,
    productsUpdatedAt: ECHO_AT,
    usersUpdatedAt: ECHO_AT,
    rateModeUpdatedAt: ECHO_AT,
    ...extra,
});

beforeEach(() => {
    resetSupervisorCommandTracker();
    vi.clearAllMocks();
});

describe('frescura por dominio del eco', () => {
    it('la tasa solo se verifica con el eco de la tasa: un eco de productos más reciente NO produce un falso mismatch', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('cmd-rate', 'supervisor.rate.set', { rateMode: 'bcv' }),
            snapshot: echo({
                updatedAt: '2026-10-18T07:05:00.000Z',
                productsUpdatedAt: '2026-10-18T07:05:00.000Z',
                rateModeUpdatedAt: '2026-10-18T07:03:00.000Z', // ANTERIOR al comando
                rateMode: 'euro', // valor viejo, sin eco nuevo
            }),
            now: NOW,
        });
        expect(result.level).toBe('received');
    });

    it('con el eco de la tasa posterior, la misma situación sí se verifica', () => {
        const result = evaluateCommandVerification({
            command: appliedCommand('cmd-rate', 'supervisor.rate.set', { rateMode: 'bcv' }),
            snapshot: echo({ rateModeUpdatedAt: ECHO_AT, rateMode: 'bcv' }),
            now: NOW,
        });
        expect(result.level).toBe('verified');
    });

    it('el inventario usa la frescura del eco de productos', () => {
        const command = appliedCommand('cmd-inv', 'supervisor.inventory.batch.adjust', {
            direction: 'ingreso', productId: 'p1', quantityInput: 8, inputUnit: 'unidades',
            unitsPerPackage: 1, expectedStock: 22, reason: 'Ajuste',
        }, { ack_payload: { stockAfter: 30 } });

        // Eco de productos ANTERIOR al comando: received (nada se puede afirmar).
        expect(evaluateCommandVerification({
            command,
            snapshot: echo({ productsUpdatedAt: '2026-10-18T07:03:00.000Z', products: [{ id: 'p1', stock: 30 }] }),
            now: NOW,
        }).level).toBe('received');

        // Eco de productos POSTERIOR con el stock confirmado: verified.
        expect(evaluateCommandVerification({
            command,
            snapshot: echo({ products: [{ id: 'p1', name: 'Champu', stock: 30 }] }),
            now: NOW,
        }).level).toBe('verified');
    });
});

describe('verifyCommandsAgainstEcho: el eco marca los sellos', () => {
    it('comando aplicado + eco confirmatorio → registra "verified"', () => {
        const onResult = vi.fn();
        const outcomes = verifyCommandsAgainstEcho({
            commands: [appliedCommand('cmd-1', 'supervisor.inventory.batch.adjust', {
                direction: 'ingreso', productId: 'p1', quantityInput: 8, inputUnit: 'unidades',
                unitsPerPackage: 1, expectedStock: 22, reason: 'Ajuste',
            }, { ack_payload: { stockAfter: 30 } })],
            snapshot: echo({ products: [{ id: 'p1', name: 'Champu', stock: 30 }] }),
            now: NOW,
            onResult,
        });

        expect(outcomes).toHaveLength(1);
        expect(outcomes[0]).toMatchObject({ commandId: 'cmd-1', outcome: expect.objectContaining({ level: 'verified' }) });
        expect(onResult).toHaveBeenCalledTimes(1);
    });

    it('eco desalineado → registra "mismatch" (la alerta la lanza el tracker)', () => {
        const onResult = vi.fn();
        const outcomes = verifyCommandsAgainstEcho({
            commands: [appliedCommand('cmd-1', 'supervisor.product.delete', { productId: 'p1' })],
            snapshot: echo({ products: [{ id: 'p1', name: 'Prueba', stock: 4 }] }),
            now: NOW,
            onResult,
        });

        expect(outcomes).toHaveLength(1);
        expect(outcomes[0].outcome.level).toBe('mismatch');
    });

    it('sin comandos recientes o sin veredicto → ningún registro espurio', () => {
        const onResult = vi.fn();
        // Sin comandos.
        expect(verifyCommandsAgainstEcho({ commands: [], snapshot: echo(), now: NOW, onResult })).toHaveLength(0);
        // Comando sin aplicar → 'received' → no se registra.
        expect(verifyCommandsAgainstEcho({
            commands: [appliedCommand('cmd-1', 'supervisor.product.delete', { productId: 'p1' }, { status: 'pending' })],
            snapshot: echo({ products: [] }),
            now: NOW,
            onResult,
        })).toHaveLength(0);
        // Comando viejo (fuera de la ventana de recientes).
        expect(verifyCommandsAgainstEcho({
            commands: [appliedCommand('cmd-1', 'supervisor.product.delete', { productId: 'p1' }, { updated_at: '2026-10-18T04:00:00.000Z' })],
            snapshot: echo({ products: [] }),
            now: NOW,
            recentWindowMs: 30 * 60_000,
            onResult,
        })).toHaveLength(0);
        expect(onResult).not.toHaveBeenCalled();
    });

    it('dedupe: un sello "verified" no se registra dos veces ni retrocede a "mismatch"', () => {
        const onResult = vi.fn();
        const command = appliedCommand('cmd-1', 'supervisor.product.delete', { productId: 'p1' });

        // Ya verificado: eco posterior coherente → sin re-registro.
        expect(verifyCommandsAgainstEcho({
            commands: [command],
            snapshot: echo({ products: [] }),
            recorded: [{ commandId: 'cmd-1', level: 'verified' }],
            now: NOW,
            onResult,
        })).toHaveLength(0);

        // Ya verificado: un eco raro posterior NO lo derriba (el sello confirmado manda).
        expect(verifyCommandsAgainstEcho({
            commands: [command],
            snapshot: echo({ products: [{ id: 'p1', name: 'Prueba', stock: 4 }] }),
            recorded: [{ commandId: 'cmd-1', level: 'verified' }],
            now: NOW,
            onResult,
        })).toHaveLength(0);

        // Mismo nivel ya registrado → dedupe.
        expect(verifyCommandsAgainstEcho({
            commands: [command],
            snapshot: echo({ products: [{ id: 'p1', name: 'Prueba', stock: 4 }] }),
            recorded: [{ commandId: 'cmd-1', level: 'mismatch' }],
            now: NOW,
            onResult,
        })).toHaveLength(0);

        // "mismatch" → "verified" es una MEJORA legítima y sí se registra.
        expect(verifyCommandsAgainstEcho({
            commands: [command],
            snapshot: echo({ products: [] }),
            recorded: [{ commandId: 'cmd-1', level: 'mismatch' }],
            now: NOW,
            onResult,
        })).toHaveLength(1);

        expect(onResult).toHaveBeenCalledTimes(1);
    });
});

describe('recordVerification: el sello se registra como las reconciliaciones', () => {
    it('una entrada por commandId (la última gana) y persiste', async () => {
        await clearCommandDiagnostics();
        recordVerification({ commandId: 'cmd-1', level: 'received', detail: 'esperando' });
        recordVerification({ commandId: 'cmd-1', level: 'verified', detail: 'confirmado' });

        const entries = getVerifications();
        expect(entries).toHaveLength(1);
        expect(entries[0]).toMatchObject({ commandId: 'cmd-1', level: 'verified' });

        const stored = await readVerifications({ storage: { getItem: async () => entries, setItem: async () => {} } });
        expect(stored).toHaveLength(1);
    });

    it('ignora niveles inválidos y commandId vacíos', () => {
        expect(recordVerification({ commandId: 'cmd-2', level: 'inventado' })).toBeNull();
        expect(recordVerification({ commandId: '', level: 'verified' })).toBeNull();
        expect(getVerifications().some(entry => entry.commandId === 'cmd-2')).toBe(false);
    });

    it('clearCommandDiagnostics limpia también las verificaciones', async () => {
        await clearCommandDiagnostics();
        recordVerification({ commandId: 'cmd-3', level: 'mismatch', detail: 'x' });
        expect(getVerifications()).toHaveLength(1);
        await clearCommandDiagnostics();
        expect(getVerifications()).toHaveLength(0);
    });
});

describe('tracker: el sello es estado, no un aviso (salvo el mismatch)', () => {
    const settle = async (notify) => {
        const record = trackSupervisorCommand({
            commandId: 'cmd-1',
            type: 'supervisor.product.delete',
            label: 'la baja de "Prueba"',
            ackPromise: Promise.resolve({ ok: true, status: 'applied', commandId: 'cmd-1', ack: null, error: null }),
            notify,
            followUpIntervalMs: 1,
            followUpBudgetMs: 5,
            sleep: async () => {},
        });
        await record.promise;
        return record;
    };

    it('setCommandVerification marca el sello sin lanzar un segundo toast', async () => {
        const notify = vi.fn();
        await settle(notify);
        const callsAfterOutcome = notify.mock.calls.length;

        const updated = setCommandVerification('cmd-1', { level: 'verified', detail: 'confirmado' }, { notify });
        expect(updated).toBe(true);
        expect(notify.mock.calls.length).toBe(callsAfterOutcome); // ni un toast más
        expect(getTrackedSupervisorCommands()[0].verification).toMatchObject({ level: 'verified' });
    });

    it('un mismatch SÍ avisa, una sola vez (alerta, no resultado)', async () => {
        const notify = vi.fn();
        await settle(notify);

        setCommandVerification('cmd-1', { level: 'mismatch', detail: 'no se refleja' }, { notify });
        setCommandVerification('cmd-1', { level: 'mismatch', detail: 'sigue sin reflejarse' }, { notify });

        const alerts = notify.mock.calls.filter(([, type]) => type === 'error');
        expect(alerts).toHaveLength(1);
        expect(alerts[0][0]).toContain('No coincide');
    });

    it('un comando ya no trackeado (tras recarga) no rompe nada ni avisa', () => {
        const notify = vi.fn();
        expect(setCommandVerification('cmd-desconocido', { level: 'mismatch' }, { notify })).toBe(false);
        expect(notify).not.toHaveBeenCalled();
    });
});
