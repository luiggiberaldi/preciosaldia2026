import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
    cancelSupervisorCommand,
    CONTROL_STATUS,
    getCommandDetails,
    getControlStatus,
    matchesControlFilter,
} from '../src/services/supervisorControlService';

const stateMachineSql = readFileSync('supabase/migrations/20261016110000_supervisor_command_state_machine.sql', 'utf8');

describe('supervisor control status model', () => {
    it('maps expired pending commands without mutating the database state', () => {
        expect(getControlStatus({ status: 'pending', expires_at: '2020-01-01T00:00:00.000Z' })).toBe(CONTROL_STATUS.EXPIRED);
    });

    it('maps ACK warnings as a separate operational state', () => {
        expect(getControlStatus({ status: 'applied', ack_payload: { warning: 'stock reconciliado' } })).toBe(CONTROL_STATUS.APPLIED_WITH_WARNINGS);
    });

    it('keeps failed and rejected commands in the failed filter', () => {
        expect(matchesControlFilter({ status: 'rejected' }, 'failed')).toBe(true);
        expect(matchesControlFilter({ status: 'failed' }, 'failed')).toBe(true);
        expect(matchesControlFilter({ status: 'applied' }, 'failed')).toBe(false);
    });

    it('treats received as active and never derives expiry for a claimed command', () => {
        expect(getControlStatus({ status: 'received', expires_at: '2020-01-01T00:00:00.000Z' })).toBe(CONTROL_STATUS.RECEIVED);
        expect(matchesControlFilter({ status: 'received' }, 'pending')).toBe(true);
    });

    it('reports a lost race as not cancelled when the command is already received', async () => {
        const client = { rpc: async () => ({ data: { command_id: 'command-1234', status: 'received' }, error: null }) };
        await expect(cancelSupervisorCommand({ commandId: 'command-1234', client })).resolves.toMatchObject({
            ok: false,
            status: 'received',
            error: 'La orden ya no está pendiente (estado: received) y no se anuló',
        });
    });

    it('reports cancellation only when the RPC confirms the cancelled terminal state', async () => {
        const client = { rpc: async () => ({ data: { command_id: 'command-1234', status: 'cancelled' }, error: null }) };
        await expect(cancelSupervisorCommand({ commandId: 'command-1234', client })).resolves.toMatchObject({
            ok: true,
            status: 'cancelled',
        });
    });

    it('keeps the backend claim and cancellation conditional on the same locked pending row', () => {
        const claimFunction = stateMachineSql
            .split('CREATE OR REPLACE FUNCTION public.claim_supervisor_command')[1]
            .split('CREATE OR REPLACE FUNCTION public.ack_supervisor_command')[0];
        const cancelFunction = stateMachineSql
            .split('CREATE OR REPLACE FUNCTION public.cancel_supervisor_command')[1]
            .split('CREATE OR REPLACE FUNCTION public.get_supervisor_command_control_counts')[0];

        expect(claimFunction).toContain('FOR UPDATE OF sc');
        expect(claimFunction).toContain("AND status = 'pending'");
        expect(claimFunction).toContain('AND expires_at > now()');
        expect(cancelFunction).toContain('FOR UPDATE OF sc');
        expect(cancelFunction).toContain("WHERE command_id = v_command.command_id\n      AND status = 'pending'");
        expect(cancelFunction).toContain("dp.monitor_auth_id = v_actor");
        expect(cancelFunction).toContain("dp.monitor_auth_id_2 = v_actor");
        expect(cancelFunction).toContain("dp.monitor_device_id_2 <> sc.target_device_id");
    });

    it('requires received before ACK and returns early for terminal commands', () => {
        const ackFunction = stateMachineSql
            .split('CREATE OR REPLACE FUNCTION public.ack_supervisor_command')[1]
            .split('CREATE OR REPLACE FUNCTION public.cancel_supervisor_command')[0];
        expect(ackFunction).toContain("p_status NOT IN ('applied', 'applied_with_warnings', 'rejected', 'failed')");
        expect(ackFunction).toContain("IF v_command.status IN ('applied', 'applied_with_warnings', 'rejected', 'failed', 'cancelled') THEN");
        expect(ackFunction).toContain("IF v_command.status <> 'received' THEN");
        expect(ackFunction).not.toContain('v_command.expires_at <= now()');
    });

    it('summarizes inventory payload details without requiring a second catalog download', () => {
        expect(getCommandDetails({
            command_type: 'supervisor.inventory.batch.adjust',
            payload: { productName: 'Arroz', quantityInput: 2, inputUnit: 'cajas', unitsPerPackage: 12 },
        })).toEqual(['Arroz', '2 cajas', '12 u/caja']);
    });
});
