import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const productionSql = readFileSync('supabase_supervisor_canary_allowlist.sql', 'utf8');

describe('Supervisor canary allowlist guardrails', () => {
    it('autoriza por pairing activo y mantiene el ingreso como única mutación', () => {
        expect(productionSql).toContain('CREATE TABLE IF NOT EXISTS public.supervisor_canary_allowlist');
        expect(productionSql).toContain('CREATE TRIGGER supervisor_income_pairing_guard');
        expect(productionSql).toContain('CREATE OR REPLACE FUNCTION public.enforce_supervisor_income_command()');
        expect(productionSql).toContain("RAISE EXCEPTION 'Monitor no vinculado o no autorizado para esa caja'");
        expect(productionSql).toContain("RAISE EXCEPTION 'Payload de tasa inválido'");
        expect(productionSql).toContain("NEW.command_type = 'supervisor.rate.set'");
        expect(productionSql).toContain('dp.monitor_auth_id = NEW.actor_auth_id');
        expect(productionSql).not.toContain('ca.enabled = true');
        expect(productionSql).not.toContain('ca.expires_at > now()');
    });

    it('no concede lectura o escritura directa a anon/authenticated', () => {
        expect(productionSql).toMatch(/REVOKE\s+ALL\s+ON\s+TABLE\s+public\.supervisor_canary_allowlist\s+FROM\s+PUBLIC,\s*anon,\s*authenticated/i);
        expect(productionSql).toContain('ALTER TABLE public.supervisor_canary_allowlist FORCE ROW LEVEL SECURITY');
        expect(productionSql).toContain('SECURITY DEFINER');
        expect(productionSql).toContain('SET search_path = public, extensions');
        expect(productionSql).toContain('REVOKE ALL ON FUNCTION public.enforce_supervisor_income_command()');
    });
});
