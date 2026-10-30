// Paridad de 20261031 (anulación remota) con el contrato cliente. La migración
// reemplaza CHECK, RPC y trigger completos: sella que no se perdió ningún tipo
// y que NO revierte el validador de ventas con avances (20261030).
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SUPERVISOR_COMMAND_TYPES } from '../src/services/supervisorContracts';
import { REMOTE_VOID_LIMITS } from '../src/services/supervisorSaleVoidCommand';

const migration = readFileSync('supabase/migrations/20261031_supervisor_remote_sale_void.sql', 'utf8');
const count = (haystack, needle) => haystack.split(needle).length - 1;
const section = (from, to) => migration.slice(migration.indexOf(from), migration.indexOf(to, migration.indexOf(from)));

describe('migración anulación remota · paridad con el cliente', () => {
    it('todo tipo del contrato está en el CHECK y en la allowlist del RPC', () => {
        const check = section('ADD CONSTRAINT supervisor_commands_command_type_check', '));');
        const allowlist = section('p_command_type NOT IN (', ') THEN');
        // Los tipos posteriores (supervisor.purchase.*, 20261101) tienen su propio test.
        for (const type of SUPERVISOR_COMMAND_TYPES.filter((t) => !t.startsWith('supervisor.purchase.'))) {
            expect(check, type).toContain(`'${type}'`);
            expect(allowlist, type).toContain(`'${type}'`);
        }
    });

    it('RPC y trigger validan con el mismo validador y el mismo mensaje; TTL de 2 minutos', () => {
        expect(migration).toContain('public.is_valid_supervisor_sale_void_payload(p_payload)');
        expect(migration).toContain('public.is_valid_supervisor_sale_void_payload(NEW.payload)');
        expect(count(migration, 'Payload de anulación remota inválido')).toBe(2);
        expect(migration).toContain("p_command_type IN ('supervisor.sale.create', 'supervisor.sale.void')");
        expect(migration).toContain("v_max_ttl := interval '2 minutes'");
    });

    it('no redefine el validador de ventas (lo dejó 20261030 con avances)', () => {
        expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION public\.is_valid_supervisor_sale_payload/);
        expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION public\.supervisor_json_number/);
    });

    it('mismos límites que el cliente', () => {
        const validator = section('CREATE OR REPLACE FUNCTION public.is_valid_supervisor_sale_void_payload', '$$;');
        expect(validator).toContain(`length(p_payload->>'saleId') > ${REMOTE_VOID_LIMITS.MAX_SALE_ID}`);
        expect(validator).toContain(`< ${REMOTE_VOID_LIMITS.MIN_REASON} OR length(p_payload->>'reason') > ${REMOTE_VOID_LIMITS.MAX_REASON}`);
        expect(validator).toContain(`> ${REMOTE_VOID_LIMITS.MAX_NAME}`);
        expect(migration).toContain('REVOKE ALL ON FUNCTION public.is_valid_supervisor_sale_void_payload(jsonb) FROM PUBLIC, anon, authenticated;');
    });
});
