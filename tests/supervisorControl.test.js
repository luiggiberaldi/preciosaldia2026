import { describe, expect, it } from 'vitest';
import {
    CONTROL_STATUS,
    getCommandDetails,
    getControlStatus,
    matchesControlFilter,
} from '../src/services/supervisorControlService';

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

    it('summarizes inventory payload details without requiring a second catalog download', () => {
        expect(getCommandDetails({
            command_type: 'supervisor.inventory.batch.adjust',
            payload: { productName: 'Arroz', quantityInput: 2, inputUnit: 'cajas', unitsPerPackage: 12 },
        })).toEqual(['Arroz', '2 cajas', '12 u/caja']);
    });
});
