import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    getRecoveryDelayMs,
    RECOVERY_BASE_DELAY_MS,
    RECOVERY_MAX_DELAY_MS,
} from '../src/hooks/useRemoteCommands';
import { fetchSupervisorCommandsForRecovery } from '../src/services/supervisorCommandService';

describe('politica de recuperacion de ordenes (Realtime degradado)', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('la primera consulta va a ~5 s y no supera el TTL de 60 s', () => {
        const first = getRecoveryDelayMs(0, () => 0);
        expect(first).toBe(RECOVERY_BASE_DELAY_MS);
        expect(first).toBeLessThan(60_000);
    });

    it('el backoff crece con cada intento sin pasar del maximo', () => {
        const noJitter = [0, 1, 2, 3, 4, 5].map(attempt => getRecoveryDelayMs(attempt, () => 0));
        expect(noJitter).toEqual([5_000, 10_000, 20_000, 20_000, 20_000, 20_000]);
        expect(Math.max(...noJitter)).toBe(RECOVERY_MAX_DELAY_MS);
    });

    it('el jitter queda acotado: nunca supera el maximo ni baja del base', () => {
        for (const attempt of [0, 1, 2, 5]) {
            const low = getRecoveryDelayMs(attempt, () => 0);
            const high = getRecoveryDelayMs(attempt, () => 0.999999);
            expect(low).toBeGreaterThanOrEqual(RECOVERY_BASE_DELAY_MS);
            expect(high).toBeLessThanOrEqual(RECOVERY_MAX_DELAY_MS);
            expect(high).toBeGreaterThanOrEqual(low);
        }
    });

    it('un intento negativo o invalido se trata como el primer intento', () => {
        expect(getRecoveryDelayMs(-3, () => 0)).toBe(RECOVERY_BASE_DELAY_MS);
        expect(getRecoveryDelayMs('x', () => 0)).toBe(RECOVERY_BASE_DELAY_MS);
    });

    it('con timers falsos el reintento se dispara solo cuando vence el delay', () => {
        const run = vi.fn();
        setTimeout(run, getRecoveryDelayMs(0, () => 0));
        vi.advanceTimersByTime(4_999);
        expect(run).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(run).toHaveBeenCalledTimes(1);
    });

    it('la consulta de recuperacion pide como maximo 25 ordenes en orden de emision', () => {
        const calls = [];
        const chain = {
            select() { calls.push(['select']); return chain; },
            eq(...args) { calls.push(['eq', ...args]); return chain; },
            or(...args) { calls.push(['or', ...args]); return chain; },
            order(...args) { calls.push(['order', ...args]); return chain; },
            limit(value) { calls.push(['limit', value]); return Promise.resolve({ data: [], error: null }); },
        };
        const client = { from: () => chain };
        fetchSupervisorCommandsForRecovery(client, 'device-1', Date.UTC(2026, 9, 16, 12, 0, 0));
        expect(calls).toContainEqual(['limit', 25]);
        expect(calls).toContainEqual(['order', 'issued_at', { ascending: true }]);
    });
});
