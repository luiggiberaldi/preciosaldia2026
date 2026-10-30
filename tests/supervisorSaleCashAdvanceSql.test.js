// Paridad de 20261030 (avances en ventas remotas) con validateRemoteSalePayload.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REMOTE_SALE_LIMITS } from '../src/services/supervisorSaleCommand';
import { CASH_ADVANCE_CURRENCIES, CASH_ADVANCE_MAX_PCT } from '../src/utils/cashAdvance';

const migration = readFileSync('supabase/migrations/20261030_supervisor_remote_sale_cash_advance.sql', 'utf8');

describe('migración avances en ventas remotas · paridad con el cliente', () => {
    it('solo reemplaza el validador del payload (RPC y trigger de 20261029 lo reutilizan)', () => {
        expect(migration).toContain('CREATE OR REPLACE FUNCTION public.is_valid_supervisor_sale_payload(p_payload JSONB)');
        expect(migration).not.toMatch(/CREATE OR REPLACE FUNCTION public\.create_supervisor_command/);
        expect(migration).not.toMatch(/CREATE TRIGGER/);
        expect(migration).toContain('REVOKE ALL ON FUNCTION public.is_valid_supervisor_sale_payload(jsonb) FROM PUBLIC, anon, authenticated;');
    });

    it('mismos límites que el cliente: avances, monedas y comisión', () => {
        expect(migration).toContain(`v_advances > ${REMOTE_SALE_LIMITS.MAX_CASH_ADVANCES}`);
        expect(migration).toContain(`NOT IN (${CASH_ADVANCE_CURRENCIES.map((c) => `'${c}'`).join(', ')})`);
        expect(migration).toContain(`v_num > ${CASH_ADVANCE_MAX_PCT}`);
        expect(migration).toContain(`> ${REMOTE_SALE_LIMITS.MAX_ITEMS} THEN RETURN FALSE`);
        expect(migration).toContain('= 0 AND v_advances = 0 THEN RETURN FALSE');
    });
});
