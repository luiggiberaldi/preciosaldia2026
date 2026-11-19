import { beforeEach, describe, expect, it } from 'vitest';
import {
    REPORT_THROTTLE_MS,
    reportSupervisorCommandFailure,
    resetSupervisorFailureReportThrottle,
    shouldReportFailure,
} from '../src/services/supervisorCommandFailureReport';
import { readFileSync } from 'node:fs';

const migration = readFileSync('supabase/migrations/20261119_supervisor_command_failures.sql', 'utf8');

function fakeClient(response = { data: { ok: true }, error: null }) {
    const calls = [];
    return {
        calls,
        rpc(name, args) {
            calls.push([name, args]);
            return typeof response === 'function' ? response() : Promise.resolve(response);
        },
    };
}

const base = {
    targetDeviceId: 'PC1',
    monitorDeviceId: 'MON1',
    type: 'supervisor.inventory.batch.adjust',
    status: 'rejected',
    error: 'Payload de ajuste por lote inválido',
    commandId: 'cmd-1',
    payload: { batchVersion: 2, lines: [{ productId: 'p1', productName: 'MALTA' }] },
    appVersion: '2.0.7',
};

beforeEach(() => resetSupervisorFailureReportThrottle());

describe('caja negra: qué se anota', () => {
    it('solo rechazos ciertos, inválidas y monitor no autorizado; nunca la red', () => {
        expect(shouldReportFailure({ status: 'rejected', error: 'Payload inválido' })).toBe(true);
        expect(shouldReportFailure({ status: 'invalid', error: 'x' })).toBe(true);
        expect(shouldReportFailure({ status: 'unauthorized', error: 'x' })).toBe(true);
        expect(shouldReportFailure({ status: 'failed', error: 'Failed to fetch' })).toBe(false);
        expect(shouldReportFailure({ status: 'rejected', error: 'TypeError: Failed to fetch' })).toBe(false);
        expect(shouldReportFailure({ status: 'unauthenticated', error: 'x' })).toBe(false);
        expect(shouldReportFailure({ status: 'disabled', error: 'x' })).toBe(false);
    });

    it('caso Bodega mani: manda tipo, etapa, error, orden y payload a la RPC', async () => {
        const client = fakeClient();
        await expect(reportSupervisorCommandFailure({ client, ...base })).resolves.toBe(true);
        expect(client.calls).toEqual([['report_supervisor_command_failure', {
            p_target_device_id: 'PC1',
            p_monitor_device_id: 'MON1',
            p_command_type: 'supervisor.inventory.batch.adjust',
            p_stage: 'rechazada_por_nube',
            p_error_message: 'Payload de ajuste por lote inválido',
            p_command_id: 'cmd-1',
            p_payload: base.payload,
            p_app_version: '2.0.7',
        }]]);
    });

    it('el barrido de 30 s no inunda: un mismo error, un reporte cada 5 min', async () => {
        const client = fakeClient();
        const t0 = 1_000_000;
        await reportSupervisorCommandFailure({ client, ...base, now: t0 });
        await reportSupervisorCommandFailure({ client, ...base, now: t0 + 30_000 });
        await reportSupervisorCommandFailure({ client, ...base, error: 'otro error', now: t0 + 30_000 });
        await reportSupervisorCommandFailure({ client, ...base, now: t0 + REPORT_THROTTLE_MS });
        expect(client.calls).toHaveLength(3);
    });

    it('nunca lanza: RPC con error, que rechaza o que explota', async () => {
        await expect(reportSupervisorCommandFailure({ client: fakeClient({ data: null, error: { message: '404' } }), ...base })).resolves.toBe(false);
        resetSupervisorFailureReportThrottle();
        await expect(reportSupervisorCommandFailure({ client: fakeClient(() => Promise.reject(new Error('x'))), ...base })).resolves.toBe(false);
        resetSupervisorFailureReportThrottle();
        await expect(reportSupervisorCommandFailure({ client: { rpc() { throw new Error('boom'); } }, ...base })).resolves.toBe(false);
        await expect(reportSupervisorCommandFailure({ client: null, ...base })).resolves.toBe(false);
    });
});

describe('caja negra: migración 20261119', () => {
    it('la tabla y la vista no se exponen a anon ni a authenticated; solo la RPC escribe', () => {
        expect(migration).toMatch(/REVOKE ALL ON TABLE public\.supervisor_command_failures FROM PUBLIC, anon, authenticated/);
        expect(migration).toMatch(/REVOKE ALL ON TABLE public\.supervisor_command_problems FROM PUBLIC, anon, authenticated/);
        expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.report_supervisor_command_failure\([^)]*\) TO authenticated/);
        expect(migration).not.toMatch(/GRANT\s+[^;]*\bTO\s+anon\b/i);
        expect(migration).not.toMatch(/USING\s*\(\s*true\s*\)/i);
        expect((migration.match(/SET search_path = public, extensions/g) || []).length).toBe(2);
    });

    it('no toca la creación ni la validación de órdenes existentes', () => {
        expect(migration).not.toMatch(/FUNCTION public\.create_supervisor_command/);
        expect(migration).not.toMatch(/FUNCTION public\.is_valid_supervisor_inventory_batch_payload/);
        expect(migration).toMatch(/ENABLE ROW LEVEL SECURITY/);
    });
});

describe('informe de la caja negra (scripts/supervisorFailuresCore.mjs)', async () => {
    const core = await import('../scripts/supervisorFailuresCore.mjs');
    const rows = [
        { kind: 'rechazada_por_nube', target_device_id: 'PDA-V2-F5D31FEFD7FC', business_name: 'Bodega mani', command_type: 'supervisor.inventory.batch.adjust', error_message: 'Payload de ajuste por lote inválido', error_detail: 'línea 1: campo no permitido: productName', occurrences: 24, first_seen_at: '2026-11-19T11:45:00Z', last_seen_at: '2026-11-19T14:00:00Z', command_id: 'cmd-9', app_version: '2.0.6' },
        ...Array.from({ length: 5 }, (_, i) => ({ kind: 'vencida_sin_tomar', target_device_id: 'PDA-V2-F5D31FEFD7FC', business_name: 'Bodega mani', command_type: 'supervisor.inventory.batch.adjust', error_message: 'La caja no tomó la orden antes de que venciera', error_detail: null, occurrences: 1, first_seen_at: `2026-11-09T1${i}:00:00Z`, last_seen_at: `2026-11-09T1${i}:01:00Z`, command_id: `old-${i}` })),
    ];

    it('agrupa, alerta y muestra el motivo exacto', () => {
        const groups = core.summarizeProblems(rows);
        expect(groups).toHaveLength(2);
        expect(groups.find(g => g.kind === 'vencida_sin_tomar').orders).toBe(5);
        const alerts = core.evaluateProblems(groups);
        expect(alerts).toHaveLength(2);
        expect(alerts[0]).toContain('campo no permitido: productName');
        const report = core.renderProblemsReport(groups, { alerts });
        expect(report).toContain('Bodega mani');
        expect(report).toContain('**Motivo exacto:** línea 1: campo no permitido: productName');
    });

    it('una confirmación vacía de la caja ({}) no se muestra como motivo', () => {
        const report = core.renderProblemsReport(core.summarizeProblems([{ kind: 'fallida_en_caja', target_device_id: 'X', command_type: 't', error_message: 'El producto cambió', error_detail: '{}', occurrences: 1, first_seen_at: 'a', last_seen_at: 'b' }]));
        expect(report).not.toContain('Motivo exacto');
    });

    it('--redact no deja ids de equipos ni nombres de negocio', () => {
        const groups = core.summarizeProblems(rows);
        const report = core.renderProblemsReport(groups, { redact: true, alerts: core.evaluateProblems(groups, undefined, { redact: true }) });
        expect(report).not.toMatch(/PDA-V2-[0-9A-F]{4}/i);
        expect(report).not.toContain('Bodega mani');
        expect(report).not.toContain('cmd-9');
    });

    it('la consulta acota horas y escapa el filtro de equipo', () => {
        expect(core.buildProblemsSql({ hours: 99999 })).toContain("interval '720 hours'");
        expect(core.buildProblemsSql({ device: "x' OR '1'='1" })).toContain("'x'' OR ''1''=''1'");
    });
});
