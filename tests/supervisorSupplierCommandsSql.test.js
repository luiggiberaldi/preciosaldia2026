// Guardrails de paridad de la migración 20261026_supervisor_supplier_invoice_commands.sql
// con el contrato cliente (supervisorContracts). El postmortem 2026-10-20
// documentó el costo de un contrato duplicado: si una puerta del servidor se
// queda atrás, la orden muere «como si no se enviara». Estos asserts sellan que
// las TRES puertas (CHECK, RPC, trigger) conocen los 6 tipos y validan el
// mismo payload que el cliente.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SUPERVISOR_COMMAND_TYPES } from '../src/services/supervisorContracts';

const migration = readFileSync('supabase/migrations/20261026_supervisor_supplier_invoice_commands.sql', 'utf8');

const TYPES = [
    'supervisor.supplier.create',
    'supervisor.supplier.update',
    'supervisor.supplier.delete',
    'supervisor.invoice.create',
    'supervisor.invoice.update',
    'supervisor.invoice.delete',
];

const count = (haystack, needle) => haystack.split(needle).length - 1;

describe('migración proveedores/facturas · paridad con el cliente', () => {
    it('los 6 tipos están en el CHECK constraint y en las 3 puertas del servidor', () => {
        for (const type of TYPES) {
            expect(SUPERVISOR_COMMAND_TYPES).toContain(type);
            // CHECK constraint + allowlist de la RPC + rama del trigger: los tres.
            expect(count(migration, `'${type}'`)).toBeGreaterThanOrEqual(3);
        }
    });

    it('la validación de payload vive en la RPC y en el trigger (mismos mensajes)', () => {
        for (const message of [
            'Payload de proveedor inválido',
            'Patch de proveedor inválido',
            'Proveedor inválido',
            'Payload de factura inválido',
            'Patch de factura inválido',
            'Factura inválida',
        ]) {
            expect(count(migration, message), message).toBeGreaterThanOrEqual(2);
        }
    });

    it('el monto de la factura se valida como numérico positivo en create y en el patch de update', () => {
        expect(migration).toContain("coalesce(p_payload->'invoice'->>'amountUsd', '') !~ '^[0-9]+([.][0-9]+)?$'");
        expect(migration).toContain("coalesce(NEW.payload->'invoice'->>'amountUsd', '') !~ '^[0-9]+([.][0-9]+)?$'");
        expect(count(migration, "p_payload->'patch' ? 'amountUsd'")).toBeGreaterThanOrEqual(1);
        expect(count(migration, "NEW.payload->'patch' ? 'amountUsd'")).toBeGreaterThanOrEqual(1);
    });

    it('proveedores y facturas comparten la lista TTL de 5 minutos (catálogo)', () => {
        const ttlBlock = migration.slice(
            migration.indexOf('-- Duración máxima por tipo'),
            migration.indexOf('v_duration := p_expires_at - p_issued_at'),
        );
        expect(ttlBlock).toContain("v_max_ttl := interval '5 minutes'");
        for (const type of TYPES) {
            expect(ttlBlock, type).toContain(`'${type}'`);
        }
    });

    it('la gestión remota de usuarios sigue deliberadamente bloqueada', () => {
        expect(migration).toContain("p_command_type LIKE 'supervisor.user.%'");
        expect(migration).toContain("NEW.command_type LIKE 'supervisor.user.%'");
        expect(count(migration, 'Gestión remota de usuarios requiere un flujo de credencial segura')).toBeGreaterThanOrEqual(2);
    });

    it('el pairing de dos supervisores se valida igual en RPC y trigger', () => {
        expect(count(migration, 'monitor_auth_id_2')).toBeGreaterThanOrEqual(2);
        expect(migration).toContain('Monitor no autorizado para esa caja');
        expect(migration).toContain('Monitor no vinculado o no autorizado para esa caja');
    });
});
