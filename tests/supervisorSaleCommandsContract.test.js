// H2 — contrato cliente de supervisor.sale.create: tipo, TTL de 2 minutos,
// validación del payload y flag propio (REMOTE_MUTATIONS no lo habilita).
import { describe, expect, it } from 'vitest';
import {
    COMMAND_SALE_TTL_MS,
    SUPERVISOR_COMMAND_TYPES,
    getCommandMaxTtlMs,
    validateSupervisorCommand,
} from '../src/services/supervisorContracts';
import { SUPERVISOR_REMOTE_SALES_ENABLED } from '../src/config/supervisorPolicy';
import {
    buildSupervisorCommand,
    getCommandTtlMs,
    isSupervisorCommandEnabled,
} from '../src/services/supervisorCommandService';
import { buildRemoteSalePayload } from '../src/services/supervisorSaleCommand';

const NOW = 1_000_000;
const TYPE = 'supervisor.sale.create';

const payload = (over = {}) => ({
    ...buildRemoteSalePayload({
        saleId: '2f1b6a3c-8d4e-4f5a-9b6c-1d2e3f4a5b6c',
        seller: { name: 'Tienda 2', deviceId: 'monitor-1' },
        cart: [{ id: 'harina', _originalId: 'harina', _mode: 'package', qty: 2, priceUsd: 1.5 }],
        payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 3, amountBs: 0 }],
        changeBreakdown: {},
        totals: { totalUsd: 3, totalBs: 120 },
        rate: 40,
    }),
    ...over,
});

const command = (p, expiresAt = NOW + COMMAND_SALE_TTL_MS) => ({
    commandId: 'cmd-sale-0001',
    type: TYPE,
    monitorDeviceId: 'monitor-1',
    targetDeviceId: 'caja-1',
    issuedAt: NOW,
    expiresAt,
    payload: p,
    schemaVersion: 1,
});

const validate = (cmd) => validateSupervisorCommand(cmd, { targetDeviceId: 'caja-1', monitorDeviceId: 'monitor-1', now: NOW });

describe('supervisor.sale.create · contrato cliente', () => {
    it('es un tipo permitido con ventana de 2 minutos', () => {
        expect(SUPERVISOR_COMMAND_TYPES).toContain(TYPE);
        expect(getCommandMaxTtlMs(TYPE)).toBe(2 * 60_000);
        // La venta usa su ventana con o sin el TTL extendido encendido.
        expect(getCommandTtlMs(TYPE, false)).toBe(2 * 60_000);
        expect(getCommandTtlMs(TYPE, true)).toBe(2 * 60_000);
        const built = buildSupervisorCommand({ type: TYPE, targetDeviceId: 'caja-1', monitorDeviceId: 'monitor-1', payload: payload(), now: NOW, extendedTtl: false });
        expect(built.expiresAt - built.issuedAt).toBe(2 * 60_000);
    });

    it('acepta un payload válido y rechaza una ventana mayor a 2 minutos', () => {
        expect(validate(command(payload())).valid).toBe(true);
        expect(validate(command(payload(), NOW + COMMAND_SALE_TTL_MS + 1)).valid).toBe(false);
    });

    it.each([
        ['sin vendedor', { seller: { name: '' } }],
        ['sin ítems', { items: [] }],
        ['fiado', { payments: [{ methodId: 'fiado', currency: 'USD', amountUsd: 3, amountBs: 0, amountCop: 0 }] }],
        ['saleId inválido', { saleId: 'x' }],
    ])('rechaza payload: %s', (_, over) => {
        expect(validate(command(payload(over))).valid).toBe(false);
    });

    it('G10: solo se habilita con su flag; REMOTE_MUTATIONS no la cubre', () => {
        expect(isSupervisorCommandEnabled(TYPE, payload(), false)).toBe(false);
        expect(isSupervisorCommandEnabled(TYPE, payload(), true)).toBe(true);
        // Sin argumento sigue al flag del build (VITE_SUPERVISOR_REMOTE_SALES_ENABLED).
        expect(isSupervisorCommandEnabled(TYPE, payload())).toBe(SUPERVISOR_REMOTE_SALES_ENABLED);
        // Los demás tipos no cambian.
        expect(isSupervisorCommandEnabled('supervisor.invoice.delete', { invoiceId: 'i1' })).toBe(true);
    });
});
