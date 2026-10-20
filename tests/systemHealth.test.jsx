// @vitest-environment jsdom

// ── Fase 3 del plan 2026-10-20: pantalla de Salud del sistema ───────────────
// El desfase de reloj local vs servidor debe ser visible en Ajustes sin abrir
// consola. OJO (decisión del dueño, verificada con evidencia): el header `Date`
// NO es legible desde fetch en la WebView (CORS: no está en la safelist y el
// gateway no lo expone), así que la hora del servidor se deriva del `iat` del
// access_token que devuelve el refresh de la sesión existente — una petición
// HTTP que el SDK de Auth ya hace, sin RPC ni migración.
//   (a) desfase simulado de 5 min → estado rojo con el texto de acción;
//   (b) sin red → "Sin datos" sin romperse;
//   (c) el cálculo usa UTC y tolera la latencia (mediana de 2-3 lecturas).
import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/supabaseCloud', () => ({
    supabaseCloudUrl: 'https://ejemplo.supabase.co',
    supabaseCloud: {
        auth: { refreshSession: vi.fn() },
    },
}));

import SystemHealthPanel from '../src/components/Settings/SystemHealthPanel';
import {
    classifyClockSkew,
    describeClockSkew,
    measureClockSkew,
    readLastSyncInfo,
} from '../src/services/systemHealthService';
import { supabaseCloud } from '../src/config/supabaseCloud';
import { clearCommandDiagnostics, flushLastCommandOutcome, reportSupervisorCommandOutcome } from '../src/services/supervisorCommandDiagnostics';

function fakeJwt(iatSec) {
    const payload = btoa(JSON.stringify({ iat: iatSec, exp: iatSec + 3600, role: 'authenticated' }));
    return `eyJhbGciOiJIUzI1NiJ9.${payload}.c2ln`;
}

async function flush() {
    await act(async () => {
        await Promise.resolve();
        await Promise.resolve();
        await Promise.resolve();
    });
}

describe('systemHealthService · desfase de reloj local vs servidor', () => {
    it('(c) el cálculo usa UTC y tolera la latencia de la petición (mediana de 3 lecturas)', async () => {
        const TRUE_SKEW = 5 * 60_000; // el servidor va 5 min por delante
        let t = 1_760_000_000_000;
        const now = () => t;
        const latencias = [20, 500, 20]; // una lectura lenta no debe arrastrar la mediana
        let call = 0;
        const readServerNow = vi.fn(async () => {
            t += latencias[call]; // el retorno viaja por la red
            call += 1;
            return t + TRUE_SKEW; // hora del servidor en el instante de la respuesta
        });

        const result = await measureClockSkew({ readServerNow, now, samples: 3 });

        expect(result.ok).toBe(true);
        expect(result.sampleCount).toBe(3);
        expect(Math.abs(result.skewMs - TRUE_SKEW)).toBeLessThan(100);
    });

    it('clasifica el semáforo: verde <30 s, ámbar 30 s–2 min, rojo >2 min', () => {
        expect(classifyClockSkew(10_000)).toBe('green');
        expect(classifyClockSkew(29_999)).toBe('green');
        expect(classifyClockSkew(45_000)).toBe('yellow');
        expect(classifyClockSkew(119_999)).toBe('yellow');
        expect(classifyClockSkew(5 * 60_000)).toBe('red');
        expect(classifyClockSkew(-5 * 60_000)).toBe('red'); // el signo da igual: |desfase|
    });

    it('(a) un desfase de 5 min describe el estado rojo con el texto de acción', () => {
        const { level, text } = describeClockSkew(5 * 60_000);
        expect(level).toBe('red');
        expect(text).toContain('sincroniza la hora de este equipo');
    });

    it('(b) sin red devuelve ok:false sin lanzar', async () => {
        const readServerNow = vi.fn(async () => { throw new Error('fetch failed'); });
        const result = await measureClockSkew({ readServerNow, samples: 2 });
        expect(result.ok).toBe(false);
        expect(result.error).toBeTruthy();
    });

    it('la lectura por defecto deriva la hora del servidor del iat del access_token (UTC, sin header Date)', async () => {
        const serverNowSec = Math.floor(Date.now() / 1000) + 5 * 60; // 5 min de desfase simulado
        supabaseCloud.auth.refreshSession.mockResolvedValue({
            data: { session: { access_token: fakeJwt(serverNowSec) } },
            error: null,
        });

        const result = await measureClockSkew({ samples: 1 });

        expect(supabaseCloud.auth.refreshSession).toHaveBeenCalled();
        expect(result.ok).toBe(true);
        // Precisión ±2 s: resolución de 1 s del JWT + compensación de latencia.
        expect(Math.abs(result.skewMs - 5 * 60_000)).toBeLessThan(2_000);
    });
});

describe('SystemHealthPanel · pantalla de Salud del sistema', () => {
    let container;
    let root;

    beforeEach(async () => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        await clearCommandDiagnostics();
        localStorage.clear();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        await flushLastCommandOutcome();
    });

    it('(a) desfase simulado de 5 min: estado rojo con el texto de acción en la pantalla', async () => {
        const measureImpl = vi.fn(async () => ({ ok: true, skewMs: 5 * 60_000, sampleCount: 3, measuredAt: new Date().toISOString() }));
        await act(async () => root.render(<SystemHealthPanel measureImpl={measureImpl} />));
        await flush();

        const state = container.querySelector('[data-testid="clock-skew-state"]');
        expect(state).toBeTruthy();
        expect(state.getAttribute('data-level')).toBe('red');
        expect(container.textContent).toContain('sincroniza la hora de este equipo');
    });

    it('(b) sin red: la pantalla degrada a "Sin datos" sin romperse y "Revisar ahora" recupera al volver', async () => {
        let failing = true;
        const measureImpl = vi.fn(async () => {
            if (failing) throw new Error('fetch failed');
            return { ok: true, skewMs: 2_000, sampleCount: 3, measuredAt: new Date().toISOString() };
        });

        await act(async () => root.render(<SystemHealthPanel measureImpl={measureImpl} />));
        await flush();

        const state = container.querySelector('[data-testid="clock-skew-state"]');
        expect(state.getAttribute('data-level')).toBe('unknown');
        expect(container.textContent).toContain('Sin datos');

        // Vuelve la conexión y el usuario pulsa "Revisar ahora".
        failing = false;
        const retry = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Revisar ahora'));
        expect(retry).toBeTruthy();
        await act(async () => retry.click());
        await flush();

        expect(container.querySelector('[data-testid="clock-skew-state"]').getAttribute('data-level')).toBe('green');
    });

    it('muestra el último comando enviado con su error real (Fase 2) y su estado', async () => {
        reportSupervisorCommandOutcome({
            commandId: 'cmd-last',
            type: 'supervisor.inventory.batch.adjust',
            status: 'failed',
            error: 'Ventana temporal inválida',
        });
        await flushLastCommandOutcome();

        await act(async () => root.render(<SystemHealthPanel measureImpl={vi.fn(async () => ({ ok: true, skewMs: 1_000, sampleCount: 3, measuredAt: new Date().toISOString() }))} />));
        await flush();

        expect(container.textContent).toContain('Último comando enviado');
        expect(container.textContent).toContain('Lote de inventario');
        expect(container.textContent).toContain('Fallido');
        expect(container.textContent).toContain('Ventana temporal inválida');
    });

    it('muestra la última sincronización registrada, o "Sin datos" cuando no hay fecha', async () => {
        const measureImpl = vi.fn(async () => ({ ok: true, skewMs: 1_000, sampleCount: 3, measuredAt: new Date().toISOString() }));

        await act(async () => root.render(<SystemHealthPanel measureImpl={measureImpl} />));
        await flush();
        expect(container.textContent).toContain('Sin datos');

        localStorage.setItem('cloud_sync_ts', '2026-10-20T12:00:00.000Z');
        await act(async () => root.render(<SystemHealthPanel measureImpl={measureImpl} />));
        await flush();
        expect(container.textContent).toContain('Última sincronización');
        expect(container.textContent).toContain('2026');
        expect(readLastSyncInfo().lastSyncAt).toBe('2026-10-20T12:00:00.000Z');
    });
});
