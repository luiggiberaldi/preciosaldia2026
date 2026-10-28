// Contratos cliente de los comandos de proveedores/facturas (Fase 2): tipos
// permitidos, TTL de catálogo (5 min) y validación de payloads en paridad con
// la migración 20261026_supervisor_supplier_invoice_commands.sql.
import { describe, expect, it } from 'vitest';
import {
    COMMAND_EXTENDED_TTL_TYPES,
    SUPERVISOR_COMMAND_TYPES,
    getCommandMaxTtlMs,
    validateSupervisorCommand,
} from '../src/services/supervisorContracts';
import { isSupervisorCommandEnabled } from '../src/services/supervisorCommandService';

const NOW = 1_000_000;

const baseCommand = (type, payload, { expiresAt = NOW + 60_000 } = {}) => ({
    commandId: 'cmd-sup-0001',
    type,
    monitorDeviceId: 'monitor-1',
    targetDeviceId: 'caja-1',
    issuedAt: NOW,
    expiresAt,
    payload,
    schemaVersion: 1,
});

const validate = (command) => validateSupervisorCommand(command, {
    targetDeviceId: 'caja-1',
    monitorDeviceId: 'monitor-1',
    now: NOW,
});

const TYPES = [
    'supervisor.supplier.create',
    'supervisor.supplier.update',
    'supervisor.supplier.delete',
    'supervisor.invoice.create',
    'supervisor.invoice.update',
    'supervisor.invoice.delete',
];

describe('comandos de proveedores/facturas · contrato cliente', () => {
    it('los 6 tipos son comandos permitidos con TTL de catálogo (5 min)', () => {
        for (const type of TYPES) {
            expect(SUPERVISOR_COMMAND_TYPES).toContain(type);
            expect(COMMAND_EXTENDED_TTL_TYPES).toContain(type);
            expect(getCommandMaxTtlMs(type)).toBe(5 * 60_000);
        }
    });

    it('supplier.create exige supplier con id y name', () => {
        expect(validate(baseCommand('supervisor.supplier.create', {
            supplier: { id: 's1', name: 'Distribuidora' },
        })).valid).toBe(true);
        expect(validate(baseCommand('supervisor.supplier.create', {
            supplier: { id: 's1', name: '  ' },
        })).valid).toBe(false);
        expect(validate(baseCommand('supervisor.supplier.create', { supplier: { name: 'X' } })).valid).toBe(false);
    });

    it('supplier.update exige supplierId y patch objeto (la deuda no viaja editable)', () => {
        expect(validate(baseCommand('supervisor.supplier.update', {
            supplierId: 's1', supplierName: 'Distribuidora', patch: { name: 'Nuevo' },
        })).valid).toBe(true);
        expect(validate(baseCommand('supervisor.supplier.update', { supplierId: 's1' })).valid).toBe(false);
        expect(validate(baseCommand('supervisor.supplier.update', { patch: { name: 'X' } })).valid).toBe(false);
    });

    it('supplier.delete e invoice.delete exigen su id', () => {
        expect(validate(baseCommand('supervisor.supplier.delete', { supplierId: 's1' })).valid).toBe(true);
        expect(validate(baseCommand('supervisor.supplier.delete', { supplierId: '' })).valid).toBe(false);
        expect(validate(baseCommand('supervisor.invoice.delete', { invoiceId: 'i1' })).valid).toBe(true);
        expect(validate(baseCommand('supervisor.invoice.delete', {})).valid).toBe(false);
    });

    it('invoice.create exige invoice con id, supplierId y amountUsd > 0', () => {
        const invoice = { id: 'i1', supplierId: 's1', amountUsd: 120.5, date: '2026-06-01T12:00:00.000Z' };
        expect(validate(baseCommand('supervisor.invoice.create', { invoice })).valid).toBe(true);
        expect(validate(baseCommand('supervisor.invoice.create', { invoice: { ...invoice, amountUsd: 0 } })).valid).toBe(false);
        expect(validate(baseCommand('supervisor.invoice.create', { invoice: { ...invoice, amountUsd: 'gratis' } })).valid).toBe(false);
        expect(validate(baseCommand('supervisor.invoice.create', { invoice: { ...invoice, supplierId: '' } })).valid).toBe(false);
    });

    it('invoice.update valida amountUsd del patch si viene', () => {
        expect(validate(baseCommand('supervisor.invoice.update', {
            invoiceId: 'i1', patch: { dueDate: '2026-12-31' },
        })).valid).toBe(true);
        expect(validate(baseCommand('supervisor.invoice.update', {
            invoiceId: 'i1', patch: { amountUsd: 90 },
        })).valid).toBe(true);
        expect(validate(baseCommand('supervisor.invoice.update', {
            invoiceId: 'i1', patch: { amountUsd: -5 },
        })).valid).toBe(false);
        expect(validate(baseCommand('supervisor.invoice.update', { invoiceId: 'i1' })).valid).toBe(false);
    });

    it('el TTL extendido del tipo sobrevive cortes (hasta 5 min) sin aceptar más', () => {
        const ok = validate(baseCommand('supervisor.invoice.create', {
            invoice: { id: 'i1', supplierId: 's1', amountUsd: 10 },
        }, { expiresAt: NOW + 5 * 60_000 }));
        expect(ok.valid).toBe(true);

        const tooLong = validate(baseCommand('supervisor.invoice.create', {
            invoice: { id: 'i1', supplierId: 's1', amountUsd: 10 },
        }, { expiresAt: NOW + 5 * 60_000 + 1 }));
        expect(tooLong.valid).toBe(false);
    });

    it('la política habilita proveedores/facturas y sigue bloqueando el PIN', () => {
        expect(isSupervisorCommandEnabled('supervisor.supplier.create')).toBe(true);
        expect(isSupervisorCommandEnabled('supervisor.invoice.delete')).toBe(true);
        expect(isSupervisorCommandEnabled('supervisor.user.pin.change')).toBe(false);
    });
});
