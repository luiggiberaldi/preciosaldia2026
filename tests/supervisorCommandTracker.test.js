// ── Fase 1: tracker de resultados de comandos del Supervisor ────────────────
// Garantiza la regla fundamental: "el supervisor debe saber si su cambio hizo
// efecto o no, en cualquier tipo de cambio". Todo comando registrado produce:
//  - un aviso de envío (una vez),
//  - exactamente UN aviso final (éxito SIEMPRE visible, error con motivo, o
//    ámbar "sigue esperando" / "venció" si nunca hubo confirmación),
//  - y nunca dos avisos finales para el mismo commandId (dedupe).

import { describe, expect, it, vi, beforeEach } from 'vitest';
import {
    trackSupervisorCommand,
    buildCommandNotice,
    describeSupervisorCommand,
    isCommandOutcomeOwned,
    getTrackedSupervisorCommands,
    resetSupervisorCommandTracker,
} from '../src/services/supervisorCommandTracker';

function makeDeps(overrides = {}) {
    return {
        notify: vi.fn(),
        awaitAck: vi.fn(),
        inspectState: vi.fn(),
        sleep: vi.fn(async () => {}),
        followUpIntervalMs: 1,
        followUpBudgetMs: 5,
        ...overrides,
    };
}

const terminal = (status, extra = {}) => ({
    ok: status === 'applied' || status === 'applied_with_warnings',
    status,
    commandId: 'cmd-1',
    ack: null,
    error: null,
    ...extra,
});

beforeEach(() => {
    resetSupervisorCommandTracker();
});

describe('aviso de envío', () => {
    it('anuncia el envío una vez y espera confirmación en tipos interactivos', async () => {
        const deps = makeDeps({ ackPromise: Promise.resolve(terminal('applied')) });
        const record = trackSupervisorCommand({
            commandId: 'cmd-1',
            type: 'supervisor.product.delete',
            payload: { productId: 'p1' },
            label: 'la baja de "Prueba"',
            ...deps,
        });
        await record.promise;

        expect(deps.notify).toHaveBeenCalledTimes(2);
        expect(deps.notify.mock.calls[0][0]).toContain('enviado a la caja');
        expect(deps.notify.mock.calls[0][0]).toContain('esperando confirmación');
        expect(deps.notify.mock.calls[0][1]).toBe('info');
    });

    it('para tipos no interactivos el envío se anuncia como notificación, sin "esperando confirmación"', async () => {
        const deps = makeDeps({ ackPromise: Promise.resolve(terminal('applied')) });
        const record = trackSupervisorCommand({
            commandId: 'cmd-1',
            type: 'supervisor.rate.set',
            payload: { rateMode: 'bcv' },
            interactiveAck: false,
            ...deps,
        });
        await record.promise;

        expect(deps.notify.mock.calls[0][0]).toContain('Notificación');
        expect(deps.notify.mock.calls[0][0]).not.toContain('esperando confirmación');
    });

    it('no anuncia el envío dos veces aunque el mismo commandId se registre otra vez (reintento)', async () => {
        const deps = makeDeps({ ackPromise: Promise.resolve(terminal('applied')) });
        const first = trackSupervisorCommand({ commandId: 'cmd-1', type: 'supervisor.user.delete', ...deps });
        const second = trackSupervisorCommand({ commandId: 'cmd-1', type: 'supervisor.user.delete', ...deps });
        await first.promise;

        expect(second).toBe(first);
        const sentNotices = deps.notify.mock.calls.filter(([message]) => String(message).includes('enviado a la caja'));
        expect(sentNotices).toHaveLength(1);
    });
});

describe('aviso final por desenlace', () => {
    it('applied → aviso de éxito SIEMPRE, nombrando el cambio', async () => {
        const deps = makeDeps({ ackPromise: Promise.resolve(terminal('applied', { ack: { stockAfter: 30 } })) });
        const record = trackSupervisorCommand({
            commandId: 'cmd-1',
            type: 'supervisor.inventory.batch.adjust',
            label: 'el ajuste de stock de "Mayonesa"',
            ...deps,
        });
        await record.promise;

        const finals = deps.notify.mock.calls.filter(([, type]) => type !== 'info');
        expect(finals).toHaveLength(1);
        expect(finals[0][1]).toBe('success');
        expect(finals[0][0]).toContain('✅');
        expect(finals[0][0]).toContain('aplicó tu cambio');
        expect(finals[0][0]).toContain('Mayonesa');
        expect(record.state).toBe('applied');
    });

    it('applied_with_warnings → aviso ámbar "con reservas"', async () => {
        const deps = makeDeps({
            ackPromise: Promise.resolve(terminal('applied_with_warnings', { ack: { warnings: ['stock bajo'] } })),
        });
        const record = trackSupervisorCommand({ commandId: 'cmd-1', type: 'supervisor.product.update', label: 'la edición de "Arroz"', ...deps });
        await record.promise;

        const finals = deps.notify.mock.calls.filter(([, type]) => type !== 'info');
        expect(finals).toHaveLength(1);
        expect(finals[0][1]).toBe('warning');
        expect(finals[0][0]).toContain('con reservas');
    });

    it('rejected → aviso rojo con el motivo en palabras', async () => {
        const deps = makeDeps({ ackPromise: Promise.resolve(terminal('rejected', { error: 'el producto ya no existe' })) });
        const record = trackSupervisorCommand({ commandId: 'cmd-1', type: 'supervisor.product.delete', label: 'la baja de "Prueba"', ...deps });
        await record.promise;

        const finals = deps.notify.mock.calls.filter(([, type]) => type !== 'info');
        expect(finals).toHaveLength(1);
        expect(finals[0][1]).toBe('error');
        expect(finals[0][0]).toContain('rechazó');
        expect(finals[0][0]).toContain('el producto ya no existe');
    });

    it('failed sin motivo → aviso rojo honesto ("la caja no indicó el motivo")', async () => {
        const deps = makeDeps({ ackPromise: Promise.resolve(terminal('failed')) });
        const record = trackSupervisorCommand({ commandId: 'cmd-1', type: 'supervisor.user.create', label: 'el alta de "Juan"', ...deps });
        await record.promise;

        const finals = deps.notify.mock.calls.filter(([, type]) => type !== 'info');
        expect(finals).toHaveLength(1);
        expect(finals[0][1]).toBe('error');
        expect(finals[0][0]).toContain('no indicó el motivo');
    });

    it('cancelled → aviso ámbar', async () => {
        const deps = makeDeps({ ackPromise: Promise.resolve(terminal('cancelled', { error: 'La orden fue cancelada antes de que la caja la reclamara' })) });
        const record = trackSupervisorCommand({ commandId: 'cmd-1', type: 'supervisor.shift.close', label: 'el cierre de turno', ...deps });
        await record.promise;

        const finals = deps.notify.mock.calls.filter(([, type]) => type !== 'info');
        expect(finals).toHaveLength(1);
        expect(finals[0][1]).toBe('warning');
        expect(finals[0][0]).toContain('cancelado');
    });
});

describe('timeout: no es un cierre definitivo', () => {
    it('avisa "sigue esperando" y si el ACK llega después manda el resultado real', async () => {
        const deps = makeDeps({
            ackPromise: Promise.resolve({ ok: false, status: 'timeout', error: 'La caja no confirmó la orden a tiempo' }),
            inspectState: vi.fn()
                .mockResolvedValueOnce({ state: 'active', ack: null })
                .mockResolvedValueOnce({ state: 'terminal', ack: terminal('applied') }),
        });
        const record = trackSupervisorCommand({ commandId: 'cmd-1', type: 'supervisor.product.create', label: 'el alta de "Arroz"', ...deps });
        await record.promise;

        const messages = deps.notify.mock.calls.map(([message, type]) => ({ message, type }));
        expect(messages).toHaveLength(3);
        expect(messages[1].type).toBe('warning');
        expect(messages[1].message).toContain('Sigue esperando');
        expect(messages[2].type).toBe('success');
        expect(messages[2].message).toContain('✅');
        expect(record.state).toBe('applied');
    });

    it('tras el timeout, si la orden venció, el aviso final dice que no se aplicó', async () => {
        const deps = makeDeps({
            ackPromise: Promise.resolve({ ok: false, status: 'timeout', error: 'La caja no confirmó la orden a tiempo' }),
            inspectState: vi.fn().mockResolvedValue({ state: 'expired', ack: null }),
        });
        const record = trackSupervisorCommand({ commandId: 'cmd-1', type: 'supervisor.inventory.batch.adjust', label: 'el ajuste de inventario', ...deps });
        await record.promise;

        const finals = deps.notify.mock.calls.filter(([, type]) => type !== 'info');
        expect(finals).toHaveLength(2);
        expect(finals[1][0]).toContain('venció sin aplicarse');
        expect(record.state).toBe('expired');
    });

    it('en tipos no interactivos no se muestra "sigue esperando" en el primer timeout', async () => {
        const deps = makeDeps({
            ackPromise: Promise.resolve({ ok: false, status: 'timeout', error: 'La caja no confirmó la orden a tiempo' }),
            inspectState: vi.fn().mockResolvedValue({ state: 'expired', ack: null }),
        });
        const record = trackSupervisorCommand({
            commandId: 'cmd-1',
            type: 'supervisor.rate.set',
            label: 'el cambio de tasa',
            interactiveAck: false,
            ...deps,
        });
        await record.promise;

        const messages = deps.notify.mock.calls.map(([message]) => String(message));
        expect(messages.some(message => message.includes('Sigue esperando'))).toBe(false);
        expect(messages.some(message => message.includes('venció sin aplicarse'))).toBe(true);
    });

    it('sin silencio: si nunca llega confirmación, termina con el aviso ámbar "sigue esperando"', async () => {
        const deps = makeDeps({
            ackPromise: Promise.resolve({ ok: false, status: 'timeout', error: 'La caja no confirmó la orden a tiempo' }),
            inspectState: vi.fn().mockResolvedValue({ state: 'active', ack: null }),
            followUpBudgetMs: 3,
        });
        const record = trackSupervisorCommand({
            commandId: 'cmd-1',
            type: 'supervisor.rate.set',
            label: 'el cambio de tasa',
            interactiveAck: false,
            ...deps,
        });
        await record.promise;

        const messages = deps.notify.mock.calls.map(([message, type]) => ({ message, type }));
        expect(messages.some(entry => String(entry.message).includes('Sigue esperando') && entry.type === 'warning')).toBe(true);
    });
});

describe('dedupe: un comando = un aviso final', () => {
    it('un desenlace terminal no dispara seguimiento posterior ni avisos repetidos', async () => {
        const deps = makeDeps({ ackPromise: Promise.resolve(terminal('applied')) });
        const record = trackSupervisorCommand({ commandId: 'cmd-1', type: 'supervisor.product.delete', label: 'la baja de "Prueba"', ...deps });
        await record.promise;

        expect(deps.inspectState).not.toHaveBeenCalled();
        const finals = deps.notify.mock.calls.filter(([, type]) => type !== 'info');
        expect(finals).toHaveLength(1);
    });

    it('isCommandOutcomeOwned permite al resto de la interfaz no duplicar el aviso', async () => {
        const deps = makeDeps({ ackPromise: Promise.resolve(terminal('applied')) });
        expect(isCommandOutcomeOwned('cmd-1')).toBe(false);
        const record = trackSupervisorCommand({ commandId: 'cmd-1', type: 'supervisor.product.delete', ...deps });
        await record.promise;

        expect(isCommandOutcomeOwned('cmd-1')).toBe(true);
        expect(getTrackedSupervisorCommands()).toHaveLength(1);
    });

    it('acepta ackPromise externo (p. ej. el resultado del sender de lote) y lo trata como el aviso final', async () => {
        const deps = makeDeps({
            ackPromise: Promise.resolve({ ok: true, status: 'applied_with_warnings', commandId: 'cmd-1', ack: null, error: null }),
        });
        const record = trackSupervisorCommand({ commandId: 'cmd-1', type: 'supervisor.inventory.batch.adjust', label: 'el ajuste de inventario (2 movimientos)', ...deps });
        await record.promise;

        expect(record.state).toBe('applied_with_warnings');
        const finals = deps.notify.mock.calls.filter(([, type]) => type !== 'info');
        expect(finals).toHaveLength(1);
        expect(finals[0][0]).toContain('con reservas');
    });
});

describe('buildCommandNotice / describeSupervisorCommand', () => {
    it('describe cada tipo de comando en lenguaje llano', () => {
        expect(describeSupervisorCommand('supervisor.rate.set', { rateMode: 'bcv' })).toContain('tasa');
        expect(describeSupervisorCommand('supervisor.product.create', { product: { name: 'Arroz' } })).toContain('Arroz');
        expect(describeSupervisorCommand('supervisor.user.create', { nombre: 'Juan' })).toContain('Juan');
        expect(describeSupervisorCommand('supervisor.shift.close', {})).toContain('turno');
        expect(describeSupervisorCommand('supervisor.inventory.batch.adjust', { lines: [{}, {}] })).toContain('2 movimientos');
        expect(describeSupervisorCommand('tipo.desconocido', {})).toBeTruthy();
    });

    it('buildCommandNotice cubre todos los desenlaces con tipo de toast y texto', () => {
        const cases = [
            ['applied', 'success'],
            ['applied_with_warnings', 'warning'],
            ['rejected', 'error'],
            ['failed', 'error'],
            ['cancelled', 'warning'],
            ['waiting', 'warning'],
            ['expired', 'warning'],
            ['sent', 'info'],
        ];
        cases.forEach(([kind, toastType]) => {
            const notice = buildCommandNotice(kind, { label: 'la baja de "Prueba"', interactiveAck: true, ack: terminal(kind) });
            expect(notice.type).toBe(toastType);
            expect(notice.message.length).toBeGreaterThan(10);
        });
    });
});
