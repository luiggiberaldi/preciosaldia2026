import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const productionSql = readFileSync('supabase_supervisor_canary_allowlist.sql', 'utf8');
const stagingSql = readFileSync('supabase_supervisor_canary_allowlist_staging.sql', 'utf8');

describe('Supervisor canary allowlist guardrails', () => {
    it('deja producción cerrada hasta autorizar explícitamente un par de dispositivos', () => {
        expect(productionSql).toContain('CREATE TABLE IF NOT EXISTS public.supervisor_canary_allowlist');
        expect(productionSql).toContain('enabled BOOLEAN NOT NULL DEFAULT false');
        expect(productionSql).toContain('expires_at TIMESTAMPTZ NOT NULL');
        expect(productionSql).toContain('CREATE TRIGGER supervisor_canary_income_guard');
        expect(productionSql).toContain("RAISE EXCEPTION 'Dispositivo fuera de la allowlist del canary'");
        expect(productionSql).toContain("RAISE EXCEPTION 'Comando productivo no permitido durante el canary'");
        expect(productionSql).toContain('Este script NO autoriza ningún dispositivo');
        expect(productionSql.split('\n').some(line => line.trim().startsWith('INSERT INTO public.supervisor_canary_allowlist'))).toBe(false);
    });

    it('no concede lectura o escritura directa a anon/authenticated', () => {
        for (const sql of [productionSql, stagingSql]) {
            expect(sql).toMatch(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.supervisor_canary_allowlist\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i);
            expect(sql).toContain('ALTER TABLE public.supervisor_canary_allowlist FORCE ROW LEVEL SECURITY');
            expect(sql).toContain('SECURITY DEFINER');
            expect(sql).toContain('SET search_path = public, extensions');
            expect(sql).toContain('REVOKE ALL ON FUNCTION public.enforce_supervisor_canary_command()');
        }
    });

    it('staging autoriza únicamente el fixture sintético conocido', () => {
        expect(stagingSql).toContain("'e2e-primary-device'");
        expect(stagingSql).toContain("'e2e-monitor-device'");
        expect(stagingSql).toContain("'M2 staging synthetic canary'");
        expect(stagingSql).toContain("NEW.payload->>'direction'");
        expect(stagingSql).toContain('ca.enabled = true');
        expect(stagingSql).toContain('ca.expires_at > now()');
    });
});
