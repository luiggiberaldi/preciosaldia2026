// @vitest-environment jsdom
//
// Arnés A/B de red intermitente: mide el antes/después de las Fases 1–5 del
// plan de resiliencia (docs/plans/2026-10-17-plan-fix-resiliencia-envio-supervisor.md)
// contra el MISMO transporte defectuoso, con wall-clock real medido en cada
// corrida (mismo estilo que tests/supervisorAckLatency.perf.test.jsx).
//
//   ANTES  = tests/ab-fixtures/supervisorCommandServiceBefore.mjs
//            (copia congelada de git HEAD, previa a las fases)
//   DESPUÉS = src/services/supervisorCommandService.js (código actual)
//
// Escenarios:
//   S1 (Fase 1) blip de transporte en el create: la orden se pierde vs. se
//               recupera con el mismo commandId (sin duplicar).
//   S2 (Fase 2) red lenta: latencia de envío (RTT secuencial vs. paralelo).
//   S3 (Fase 3) canal ACK caído con el ACK aplicado en el servidor:
//               falso 'failed' vs. degradación a polling que lo recupera.
//   S4 (Fase 5) ventana de supervivencia ante un corte (TTL 60 s vs. 5 min).
//   S5 (Fase 4) tiempo hasta el primer barrido tras reconectar
//               (backoff hasta 20 s vs. evento 'online' inmediato).
//
// S1–S3 son mediciones end-to-end del pipeline real; S4–S5 son métricas
// calculadas a partir de las constantes/políticas reales (el comportamiento
// conductual de la Fase 4 está probado en supervisorRemoteCommandsRecovery).

import { describe, expect, it, vi } from 'vitest';

const h = vi.hoisted(() => {
    const net = {
        rttMs: 30,
        createFailuresLeft: 0,
        channelBroken: false,
        ackVisibleAt: 0, // Date.now() >= ackVisibleAt → el ACK ya está publicado
    };
    const stats = { createCalls: [], ackReads: 0 };
    const server = { commands: new Map() };
    const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

    const ackRow = (commandId) => ({
        command_id: commandId,
        status: 'applied',
        ack_payload: { stockAfter: 12 },
        error_message: null,
    });

    const client = {
        async rpc(name, args) {
            await delay(net.rttMs);
            if (name !== 'create_supervisor_command') {
                return { data: null, error: new Error(`RPC no simulada: ${name}`) };
            }
            stats.createCalls.push({ ...args });
            if (net.createFailuresLeft > 0) {
                net.createFailuresLeft -= 1;
                return { data: null, error: new TypeError('Failed to fetch') };
            }
            // Servidor idempotente por command_id (como la RPC real).
            const existing = server.commands.get(args.p_command_id);
            if (existing) return { data: existing, error: null };
            const row = {
                command_id: args.p_command_id,
                status: 'pending',
                created_at: new Date().toISOString(),
            };
            server.commands.set(args.p_command_id, row);
            return { data: row, error: null };
        },
        from() {
            const query = {
                cmdId: null,
                select() { return query; },
                eq(column, value) {
                    if (column === 'command_id') query.cmdId = value;
                    return query;
                },
                async maybeSingle() {
                    await delay(net.rttMs);
                    stats.ackReads += 1;
                    if (Date.now() >= net.ackVisibleAt && query.cmdId) {
                        return { data: ackRow(query.cmdId), error: null };
                    }
                    return { data: null, error: null };
                },
            };
            return query;
        },
        channel() {
            const ch = {
                on() { return ch; },
                subscribe(cb) {
                    if (net.channelBroken) {
                        setTimeout(() => cb('CHANNEL_ERROR'), Math.max(1, net.rttMs / 2));
                    } else {
                        setTimeout(() => cb('SUBSCRIBED'), Math.max(1, net.rttMs / 2));
                    }
                    return ch;
                },
            };
            return ch;
        },
        removeChannel() { return Promise.resolve(); },
    };

    return { net, stats, server, client, delay };
});

vi.mock('../src/config/supabaseCloud', () => ({ supabaseCloud: h.client }));
vi.mock('../src/services/supervisorAuth', () => ({
    ensureSupervisorSession: async () => {
        await h.delay(h.net.rttMs);
        return { session: { user: { id: 'auth-1' } }, error: null };
    },
}));
vi.mock('../src/services/supervisorPairingState', () => ({
    readPairingRow: async () => {
        await h.delay(h.net.rttMs);
        return {
            data: {
                monitor_device_id: 'monitor-1',
                monitor_auth_id: 'auth-1',
                monitor_device_id_2: null,
                monitor_auth_id_2: null,
            },
            error: null,
            supportsSecondary: true,
        };
    },
}));

import * as before from './ab-fixtures/supervisorCommandServiceBefore.mjs';
import * as after from '../src/services/supervisorCommandService';
import { RECOVERY_BASE_DELAY_MS, getRecoveryDelayMs } from '../src/hooks/useRemoteCommands';

const rows = [];

function resetNet(overrides = {}) {
    Object.assign(h.net, {
        rttMs: 30,
        createFailuresLeft: 0,
        channelBroken: false,
        ackVisibleAt: 0,
    }, overrides);
    h.stats.createCalls.length = 0;
    h.stats.ackReads = 0;
    h.server.commands.clear();
}

async function measure(fn) {
    const t0 = performance.now();
    const result = await fn();
    // Plano: { response, outcome, ms } para leer el desenlace sin anidamiento.
    return { ...(result || {}), ms: Math.round((performance.now() - t0) * 10) / 10 };
}

// Envía y espera el ACK global como lo hace el batch sender.
async function sendAndSettle(send, args) {
    const response = await send(args);
    const outcome = response && response.ackPromise ? await response.ackPromise : response;
    return { response, outcome };
}

const median = (values) => {
    const sorted = [...values].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
};

describe('medición A/B de red intermitente (Fases 1–5)', () => {
    it('S1 (Fase 1): un blip en el create pierde la orden antes y la recupera después, sin duplicar', async () => {
        const args = {
            type: 'supervisor.rate.set',
            targetDeviceId: 'primary-1',
            payload: { rateMode: 'bcv' },
            commandId: 'cmd-ab-s1',
        };

        resetNet({ createFailuresLeft: 1 });
        const beforeRun = await measure(() => sendAndSettle(before.sendSupervisorCommand, args));
        const beforeCreates = h.stats.createCalls.length;
        const beforeDelivered = h.server.commands.size;

        resetNet({ createFailuresLeft: 1 });
        const afterRun = await measure(() => sendAndSettle(after.sendSupervisorCommand, args));
        const afterCreates = h.stats.createCalls.length;
        const afterDelivered = h.server.commands.size;

        // ANTES: un solo intento; el fallo de transporte se reporta 'failed' y
        // la orden jamás llega al servidor.
        expect(beforeRun.outcome).toMatchObject({ ok: false, status: 'failed' });
        expect(beforeCreates).toBe(1);
        expect(beforeDelivered).toBe(0);

        // DESPUÉS: reintenta con el MISMO commandId y crea exactamente una fila.
        expect(afterRun.outcome).toMatchObject({ ok: true, status: 'sent' });
        expect(afterCreates).toBe(2);
        expect(new Set(h.stats.createCalls.map((c) => c.p_command_id)).size).toBe(1);
        expect(afterDelivered).toBe(1);

        rows.push({
            escenario: 'S1 blip en create',
            metrica: 'órdenes entregadas (de 1)',
            antes: `${beforeDelivered}/1 · ${beforeRun.ms} ms · 'failed'`,
            despues: `${afterDelivered}/1 · ${afterRun.ms} ms · 'sent'`,
        });
    });

    it('S2 (Fase 2): con red lenta el envío ahorra un round-trip completo', async () => {
        resetNet({ rttMs: 150 });
        const beforeTimes = [];
        for (let i = 0; i < 5; i += 1) {
            const run = await measure(() => sendAndSettle(before.sendSupervisorCommand, {
                type: 'supervisor.rate.set',
                targetDeviceId: 'primary-1',
                payload: { rateMode: 'bcv' },
                commandId: `cmd-ab-s2a-${i}`,
            }));
            expect(run.outcome.ok).toBe(true);
            beforeTimes.push(run.ms);
        }

        resetNet({ rttMs: 150 });
        const afterTimes = [];
        for (let i = 0; i < 5; i += 1) {
            const run = await measure(() => sendAndSettle(after.sendSupervisorCommand, {
                type: 'supervisor.rate.set',
                targetDeviceId: 'primary-1',
                payload: { rateMode: 'bcv' },
                commandId: `cmd-ab-s2b-${i}`,
            }));
            expect(run.outcome.ok).toBe(true);
            afterTimes.push(run.ms);
        }

        const beforeP50 = median(beforeTimes);
        const afterP50 = median(afterTimes);
        // ANTES: sesión → pairing → create secuenciales (3 RTT).
        // DESPUÉS: sesión y pairing en paralelo → create (2 RTT).
        expect(afterP50).toBeLessThan(beforeP50);

        rows.push({
            escenario: 'S2 red lenta (RTT 150 ms)',
            metrica: 'latencia de envío (p50 de 5)',
            antes: `${beforeP50} ms`,
            despues: `${afterP50} ms`,
        });
    });

    it('S3a (Fase 3): canal ACK caído con el ACK ya publicado — falso failed vs. recuperado', async () => {
        const base = {
            type: 'supervisor.shift.close',
            targetDeviceId: 'primary-1',
            payload: { shiftId: 'shift-1', cierreId: 'cierre-1' },
        };

        // El canal muere al inicio; el ACK de la caja ya está publicado.
        resetNet({ rttMs: 30, channelBroken: true, ackVisibleAt: Date.now() + 60 });
        const beforeRun = await measure(() => sendAndSettle(before.sendSupervisorCommand, {
            ...base,
            commandId: 'cmd-ab-s3a-before',
        }));

        resetNet({ rttMs: 30, channelBroken: true, ackVisibleAt: Date.now() + 60 });
        const afterRun = await measure(() => sendAndSettle(after.sendSupervisorCommand, {
            ...base,
            commandId: 'cmd-ab-s3a-after',
        }));

        // ANTES: la caída del canal gana la carrera contra la lectura
        // anti-carrera y se confunde con un fallo de la orden (falso negativo).
        expect(beforeRun.outcome).toMatchObject({ ok: false, status: 'failed' });
        expect(afterRun.outcome).toMatchObject({ ok: true, status: 'applied' });

        rows.push({
            escenario: 'S3a canal ACK caído (ACK ya publicado)',
            metrica: 'resultado del envío',
            antes: `'failed' falso · ${beforeRun.ms} ms`,
            despues: `'applied' · ${afterRun.ms} ms`,
        });
    });

    it('S3b (Fase 3): canal ACK caído y el ACK llega después — se recupera por polling degradado', async () => {
        const base = {
            type: 'supervisor.shift.close',
            targetDeviceId: 'primary-1',
            payload: { shiftId: 'shift-1', cierreId: 'cierre-1' },
        };

        // El ACK aparece en el servidor DESPUÉS de que empezó la espera
        // (250 ms): el canal ya murió, solo una lectura posterior puede verlo.
        resetNet({ rttMs: 30, channelBroken: true, ackVisibleAt: Date.now() + 250 });
        const beforeRun = await measure(() => sendAndSettle(before.sendSupervisorCommand, {
            ...base,
            commandId: 'cmd-ab-s3b-before',
        }));

        resetNet({ rttMs: 30, channelBroken: true, ackVisibleAt: Date.now() + 250 });
        const afterRun = await measure(() => sendAndSettle(after.sendSupervisorCommand, {
            ...base,
            commandId: 'cmd-ab-s3b-after',
        }));

        // ANTES: 'failed' inmediato; el ACK publicado a los 250 ms queda huérfano.
        expect(beforeRun.outcome).toMatchObject({ ok: false, status: 'failed' });
        // DESPUÉS: la degradación lo encuentra en su primera lectura, con el
        // backoff real del receptor (5–7.5 s) dentro del timeout de 10 s.
        expect(afterRun.outcome).toMatchObject({ ok: true, status: 'applied' });

        rows.push({
            escenario: 'S3b canal ACK caído (ACK llega durante la espera)',
            metrica: 'resultado del envío',
            antes: `'failed' falso · ${beforeRun.ms} ms`,
            despues: `'applied' vía polling · ${afterRun.ms} ms`,
        });
    }, 20_000);

    it('S4 (Fase 5): la ventana TTL decide si la orden sobrevive un corte de 90 s', () => {
        const outageMs = 90_000;
        const beforeWindow = before.SUPERVISOR_COMMAND_TTL_MS;
        const afterWindowOff = after.getCommandTtlMs('supervisor.inventory.batch.adjust');
        const afterWindowOn = after.getCommandTtlMs('supervisor.inventory.batch.adjust', true);
        const shiftWindowOn = after.getCommandTtlMs('supervisor.shift.close', true);

        expect(beforeWindow).toBe(60_000);
        expect(afterWindowOff).toBe(60_000); // rollout: sin flag, igual que antes
        expect(afterWindowOn).toBe(300_000);
        expect(shiftWindowOn).toBe(60_000); // los sensibles al tiempo no se estiran

        const survives = (windowMs) => windowMs > outageMs;
        expect(survives(beforeWindow)).toBe(false);
        expect(survives(afterWindowOn)).toBe(true);

        rows.push({
            escenario: 'S4 corte de red de 90 s (TTL)',
            metrica: '¿la orden viva sobrevive?',
            antes: `no (ventana ${beforeWindow / 1000} s)`,
            despues: `sí con flag (ventana ${afterWindowOn / 1000} s)`,
        });
    });

    it('S5 (Fase 4): el primer barrido tras reconectar pasa de esperar backoff a ser inmediato', () => {
        // Sin evento de reconexión, el receptor espera el backoff (5–20 s con
        // jitter) antes de volver a consultar. Con Fase 4, 'online'/'visible'
        // adelanta el barrido a ~0 ms (comportamiento probado en
        // supervisorRemoteCommandsRecovery.test.jsx).
        expect(getRecoveryDelayMs(0, () => 0)).toBe(RECOVERY_BASE_DELAY_MS);
        const worst = getRecoveryDelayMs(3, () => 0.999999);
        expect(worst).toBeLessThanOrEqual(20_000);

        rows.push({
            escenario: 'S5 barrido tras reconectar',
            metrica: 'tiempo hasta el primer barrido',
            antes: `hasta ~${Math.round(worst / 100) / 10} s (backoff)`,
            despues: '~0 ms (evento online)',
        });

        // Tabla final de la corrida.
        console.info('\n══ MEDICIÓN A/B — RED INTERMITENTE (Fases 1–5) ══');
        for (const row of rows) {
            console.info(
                `  ${row.escenario}\n    ${row.metrica}\n      ANTES:   ${row.antes}\n      DESPUÉS: ${row.despues}`,
            );
        }
    });
});
