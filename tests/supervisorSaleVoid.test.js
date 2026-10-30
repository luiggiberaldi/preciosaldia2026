// Anulación remota (supervisor.sale.void): núcleo, contrato y receptor de la caja.
import { describe, expect, it, vi } from 'vitest';
import {
    REMOTE_VOID_TYPE,
    buildRemoteVoidPayload,
    isRemotelyVoidable,
    planRemoteVoid,
    validateRemoteVoidPayload,
} from '../src/services/supervisorSaleVoidCommand.js';
import { COMMAND_SALE_TTL_MS, SUPERVISOR_COMMAND_TYPES, getCommandMaxTtlMs, validateSupervisorCommand } from '../src/services/supervisorContracts';
import { buildSupervisorCommand, isSupervisorCommandEnabled } from '../src/services/supervisorCommandService';
import { applyRemoteVoidOnCaja } from '../src/services/supervisorSaleReceiver.js';

const SALE = { id: 'v1', saleNumber: 12, tipo: 'VENTA', status: 'COMPLETADA', totalUsd: 5, cajaCerrada: false };
const payload = (over = {}) => ({
    ...buildRemoteVoidPayload({ sale: SALE, reason: 'Cliente devolvió', requestedBy: { name: 'Dueño', deviceId: 'm1' } }),
    ...over,
});

describe('núcleo de anulación remota', () => {
    it('payload bien formado; motivo y quién lo pide son obligatorios', () => {
        expect(validateRemoteVoidPayload(payload())).toEqual({ ok: true });
        expect(validateRemoteVoidPayload(payload({ reason: 'no' })).ok).toBe(false);
        expect(validateRemoteVoidPayload(payload({ reason: 'x'.repeat(201) })).ok).toBe(false);
        expect(validateRemoteVoidPayload(payload({ saleId: '' })).ok).toBe(false);
        expect(validateRemoteVoidPayload(payload({ requestedBy: { name: ' ' } })).ok).toBe(false);
    });

    it('solo ventas activas de un turno abierto se ofrecen para anular', () => {
        expect(isRemotelyVoidable(SALE)).toBe(true);
        expect(isRemotelyVoidable({ ...SALE, status: 'ANULADA' })).toBe(false);
        expect(isRemotelyVoidable({ ...SALE, cajaCerrada: true })).toBe(false);
        expect(isRemotelyVoidable({ ...SALE, tipo: 'APERTURA_CAJA' })).toBe(false);
        expect(isRemotelyVoidable({ ...SALE, tipo: 'VENTA_FIADA' })).toBe(true);
    });

    it('planRemoteVoid: aplica, idempotente si ya está anulada, rechaza turno cerrado / no venta / inexistente', () => {
        expect(planRemoteVoid(payload(), { sales: [SALE] })).toMatchObject({ status: 'apply', sale: SALE });
        expect(planRemoteVoid(payload(), { sales: [{ ...SALE, status: 'ANULADA' }] }).status).toBe('already_applied');
        expect(planRemoteVoid(payload(), { sales: [{ ...SALE, cajaCerrada: true }] })).toMatchObject({ status: 'rejected', code: 'SHIFT_CLOSED' });
        expect(planRemoteVoid(payload(), { sales: [{ ...SALE, tipo: 'COBRO_DEUDA' }] })).toMatchObject({ status: 'rejected', code: 'NOT_A_SALE' });
        expect(planRemoteVoid(payload(), { sales: [] })).toMatchObject({ status: 'rejected', code: 'SALE_MISSING' });
    });
});

describe('contrato cliente de supervisor.sale.void', () => {
    it('tipo permitido, TTL de 2 minutos y payload validado', () => {
        expect(SUPERVISOR_COMMAND_TYPES).toContain(REMOTE_VOID_TYPE);
        expect(getCommandMaxTtlMs(REMOTE_VOID_TYPE)).toBe(COMMAND_SALE_TTL_MS);
        const command = buildSupervisorCommand({ type: REMOTE_VOID_TYPE, targetDeviceId: 'caja', monitorDeviceId: 'm1', payload: payload(), now: 1_000 });
        expect(command.expiresAt - command.issuedAt).toBe(COMMAND_SALE_TTL_MS);
        const ctx = { targetDeviceId: 'caja', monitorDeviceId: 'm1', now: 1_000 };
        expect(validateSupervisorCommand(command, ctx).valid).toBe(true);
        expect(validateSupervisorCommand({ ...command, payload: payload({ reason: '' }) }, ctx).valid).toBe(false);
    });

    it('usa el flag de ventas remotas (REMOTE_MUTATIONS no lo habilita)', () => {
        expect(isSupervisorCommandEnabled(REMOTE_VOID_TYPE, payload(), false)).toBe(false);
        expect(isSupervisorCommandEnabled(REMOTE_VOID_TYPE, payload(), true)).toBe(true);
    });
});

describe('applyRemoteVoidOnCaja', () => {
    const storage = (sales) => ({ getItem: vi.fn(async (key) => (key === 'bodega_sales_v1' ? sales : [])) });

    it('flag apagado → rechazo sin tocar nada', async () => {
        const processVoid = vi.fn();
        const ack = await applyRemoteVoidOnCaja({ payload: payload(), commandId: 'c1', enabled: false, storage: storage([SALE]), processVoid });
        expect(ack).toMatchObject({ status: 'rejected', code: 'DISABLED' });
        expect(processVoid).not.toHaveBeenCalled();
    });

    it('anula con el flujo de la caja y deja quién, por qué y la orden', async () => {
        const processVoid = vi.fn(async () => ({ success: true }));
        const ack = await applyRemoteVoidOnCaja({
            payload: payload(), commandId: 'c1', enabled: true, storage: storage([SALE]), processVoid, now: () => 'T',
        });
        expect(ack).toMatchObject({ status: 'applied', saleId: 'v1', saleNumber: 12, duplicate: false });
        expect(processVoid).toHaveBeenCalledWith(SALE, [SALE], [], {
            voidInfo: { remote: true, by: 'Dueño', reason: 'Cliente devolvió', commandId: 'c1', at: 'T' },
        });
    });

    it('reentrega de una venta ya anulada → aplicada como duplicado, sin volver a anular', async () => {
        const processVoid = vi.fn();
        const ack = await applyRemoteVoidOnCaja({ payload: payload(), commandId: 'c1', enabled: true, storage: storage([{ ...SALE, status: 'ANULADA' }]), processVoid });
        expect(ack).toMatchObject({ status: 'applied', duplicate: true });
        expect(processVoid).not.toHaveBeenCalled();
    });

    it('si otra vía la anuló justo antes (re-chequeo bajo lock) es idempotente', async () => {
        const processVoid = vi.fn(async () => { throw new Error('Esta venta ya fue anulada.'); });
        const ack = await applyRemoteVoidOnCaja({ payload: payload(), commandId: 'c1', enabled: true, storage: storage([SALE]), processVoid });
        expect(ack).toMatchObject({ status: 'applied', duplicate: true });
    });

    it('turno cerrado → rechazo con motivo', async () => {
        const ack = await applyRemoteVoidOnCaja({ payload: payload(), commandId: 'c1', enabled: true, storage: storage([{ ...SALE, cajaCerrada: true }]), processVoid: vi.fn() });
        expect(ack).toMatchObject({ status: 'rejected', code: 'SHIFT_CLOSED' });
    });
});
