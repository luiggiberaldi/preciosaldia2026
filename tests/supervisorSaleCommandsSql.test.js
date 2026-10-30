// H3 — paridad de la migración 20261029_supervisor_remote_sales.sql con el
// contrato cliente. Esta migración REEMPLAZA las tres puertas completas, así
// que además de la venta remota sella que ningún tipo anterior se perdió.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SUPERVISOR_COMMAND_TYPES } from '../src/services/supervisorContracts';
import { REMOTE_SALE_FORBIDDEN_METHODS, REMOTE_SALE_LIMITS } from '../src/services/supervisorSaleCommand';

const migration = readFileSync('supabase/migrations/20261029_supervisor_remote_sales.sql', 'utf8');
const previous = readFileSync('supabase/migrations/20261026_supervisor_supplier_invoice_commands.sql', 'utf8');

const count = (haystack, needle) => haystack.split(needle).length - 1;
const section = (from, to) => migration.slice(migration.indexOf(from), migration.indexOf(to, migration.indexOf(from)));

describe('migración ventas remotas · paridad con el cliente', () => {
    it('supervisor.sale.create está en el contrato y en CHECK, allowlist, payload y trigger', () => {
        expect(SUPERVISOR_COMMAND_TYPES).toContain('supervisor.sale.create');
        // CHECK + allowlist RPC + rama RPC + TTL + rama trigger.
        expect(count(migration, "'supervisor.sale.create'")).toBeGreaterThanOrEqual(5);
    });

    it('no se pierde ningún tipo anterior: CHECK y allowlist conservan los 17 de 20261026', () => {
        const check = section('ADD CONSTRAINT supervisor_commands_command_type_check', '));');
        const allowlist = section('p_command_type NOT IN (', ') THEN');
        const previousTypes = [...previous.matchAll(/'(supervisor\.[a-z.]+)'/g)].map((m) => m[1]);
        for (const type of new Set(previousTypes)) {
            if (type.endsWith('.%')) continue;
            expect(check, type).toContain(`'${type}'`);
            expect(allowlist, type).toContain(`'${type}'`);
        }
        // Todo tipo del contrato cliente hasta esta migración está en el CHECK
        // (si no, el INSERT muere). Los tipos posteriores los sella su migración
        // (supervisor.sale.void → tests/supervisorSaleVoidSql.test.js;
        //  supervisor.purchase.* → tests/supervisorPurchaseCommandsSql.test.js).
        for (const type of SUPERVISOR_COMMAND_TYPES.filter((t) => t !== 'supervisor.sale.void' && !t.startsWith('supervisor.purchase.'))) {
            expect(check, type).toContain(`'${type}'`);
        }
    });

    it('RPC y trigger validan con el mismo validador y el mismo mensaje', () => {
        expect(migration).toContain('public.is_valid_supervisor_sale_payload(p_payload)');
        expect(migration).toContain('public.is_valid_supervisor_sale_payload(NEW.payload)');
        expect(count(migration, 'Payload de venta remota inválido')).toBe(2);
    });

    it('los límites del validador SQL coinciden con REMOTE_SALE_LIMITS', () => {
        const validator = section('FUNCTION public.is_valid_supervisor_sale_payload', '$$;');
        expect(validator).toContain(`NOT BETWEEN 1 AND ${REMOTE_SALE_LIMITS.MAX_ITEMS}`);
        expect(validator).toContain(`NOT BETWEEN 1 AND ${REMOTE_SALE_LIMITS.MAX_PAYMENTS}`);
        expect(validator).toContain(`v_num > ${REMOTE_SALE_LIMITS.MAX_QTY}`);
        expect(validator).toContain(`v_num > ${REMOTE_SALE_LIMITS.MAX_AMOUNT_USD}`);
        expect(validator).toContain(`> ${REMOTE_SALE_LIMITS.MAX_SELLER_NAME}`);
        expect(validator).toContain("left(v_item->>'productId', 7) = 'custom_'");
        expect(validator).toContain(REMOTE_SALE_FORBIDDEN_METHODS.map((m) => `'${m}'`).join(', '));
        expect(validator).toContain("NOT IN ('USD', 'BS', 'COP')");
        // Los números se leen con el extractor seguro (sin depender del orden de OR).
        expect(validator).not.toMatch(/->>'(qty|amountUsd|amountBs|amountCop|priceUsdSeen)'\)::numeric/);
    });

    it('TTL de 2 minutos solo para la venta remota; catálogo conserva 5', () => {
        const ttl = section('-- Duración máxima por tipo', 'v_duration := p_expires_at - p_issued_at');
        expect(ttl).toContain("v_max_ttl := interval '5 minutes'");
        expect(ttl).toMatch(/'supervisor\.sale\.create' THEN[\s\S]*v_max_ttl := interval '2 minutes'/);
    });

    it('usuarios siguen bloqueados y el pairing de dos supervisores intacto', () => {
        expect(count(migration, 'Gestión remota de usuarios requiere un flujo de credencial segura')).toBeGreaterThanOrEqual(2);
        expect(count(migration, 'monitor_auth_id_2')).toBeGreaterThanOrEqual(2);
        expect(migration).toContain('Monitor no autorizado para esa caja');
        expect(migration).toContain('Monitor no vinculado o no autorizado para esa caja');
    });

    it('permisos: el validador y el extractor no se exponen; la RPC solo a authenticated', () => {
        expect(migration).toContain('REVOKE ALL ON FUNCTION public.is_valid_supervisor_sale_payload(jsonb) FROM PUBLIC, anon, authenticated;');
        expect(migration).toContain('REVOKE ALL ON FUNCTION public.supervisor_json_number(jsonb) FROM PUBLIC, anon, authenticated;');
        expect(migration).toContain('GRANT EXECUTE ON FUNCTION public.create_supervisor_command(text, text, text, jsonb, timestamptz, timestamptz) TO authenticated;');
        expect(migration.trim().startsWith('--')).toBe(true);
        expect(count(migration, 'BEGIN;')).toBe(1);
        expect(count(migration, 'COMMIT;')).toBe(1);
    });
});
