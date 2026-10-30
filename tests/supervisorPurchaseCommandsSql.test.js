// Paridad de 20261101 (compras de mercancía) con el contrato cliente. La
// migración reemplaza CHECK, RPC y trigger completos: sella que no se perdió
// ningún tipo y que no redefine validadores de migraciones anteriores.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SUPERVISOR_COMMAND_TYPES, getCommandMaxTtlMs, COMMAND_EXTENDED_TTL_MS } from '../src/services/supervisorContracts';
import { PURCHASE_DELETE_TYPE, PURCHASE_LIMITS, PURCHASE_UPSERT_TYPE } from '../src/utils/merchandisePurchases';

const migration = readFileSync('supabase/migrations/20261101_supervisor_merchandise_purchases.sql', 'utf8');
const count = (haystack, needle) => haystack.split(needle).length - 1;
const section = (from, to) => migration.slice(migration.indexOf(from), migration.indexOf(to, migration.indexOf(from)));

describe('migración compras de mercancía · paridad con el cliente', () => {
    it('todo tipo del contrato está en el CHECK y en la allowlist del RPC', () => {
        const check = section('ADD CONSTRAINT supervisor_commands_command_type_check', '));');
        const allowlist = section('p_command_type NOT IN (', ') THEN');
        for (const type of SUPERVISOR_COMMAND_TYPES) {
            expect(check, type).toContain(`'${type}'`);
            expect(allowlist, type).toContain(`'${type}'`);
        }
        // Conserva los históricos que el cliente ya no emite.
        expect(check).toContain("'supervisor.user.pin.change'");
    });

    it('RPC y trigger validan con el mismo validador y mensaje; TTL de 5 minutos', () => {
        expect(migration).toContain('public.is_valid_supervisor_purchase_payload(p_command_type, p_payload)');
        expect(migration).toContain('public.is_valid_supervisor_purchase_payload(NEW.command_type, NEW.payload)');
        expect(count(migration, 'Payload de compra inválido')).toBe(2);
        const ttl = section('-- Duración máxima por tipo', "v_max_ttl := interval '5 minutes'");
        expect(ttl).toContain(`'${PURCHASE_UPSERT_TYPE}'`);
        expect(ttl).toContain(`'${PURCHASE_DELETE_TYPE}'`);
        expect(getCommandMaxTtlMs(PURCHASE_UPSERT_TYPE)).toBe(COMMAND_EXTENDED_TTL_MS);
    });

    it('no redefine validadores de migraciones anteriores', () => {
        expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION public\.is_valid_supervisor_sale_payload/);
        expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION public\.is_valid_supervisor_sale_void_payload/);
        expect(migration).toContain('public.is_valid_supervisor_sale_void_payload(p_payload)');
    });

    it('mismos límites que el cliente', () => {
        const validator = section('CREATE OR REPLACE FUNCTION public.is_valid_supervisor_purchase_payload', '$$;');
        expect(validator).toContain(`length(v_purchase->>'supplier') > ${PURCHASE_LIMITS.MAX_SUPPLIER}`);
        expect(validator).toContain(`length(v_purchase->>'note') > ${PURCHASE_LIMITS.MAX_NOTE}`);
        expect(validator).toContain(`> ${PURCHASE_LIMITS.MAX_AMOUNT_USD}`);
        expect(migration).toContain('REVOKE ALL ON FUNCTION public.is_valid_supervisor_purchase_payload(text, jsonb) FROM PUBLIC, anon, authenticated;');
    });
});
