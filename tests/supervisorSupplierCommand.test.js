// Aplicadores de órdenes de proveedores/facturas en la caja (Fase 2). Sella la
// contabilidad incremental (deuda) y los rechazos CIERTOS de regla de negocio:
// una factura con pagos no se elimina y un monto no baja por debajo de lo
// pagado — igual que en la UI local de la caja (useSupplierManagement).
import { describe, expect, it } from 'vitest';
import {
    applySupervisorInvoiceCommand,
    applySupervisorSupplierCommand,
} from '../src/services/supervisorSupplierCommand';

const supplier = (id, deuda = 0) => ({ id, name: `Proveedor ${id}`, phone: '', deuda });
const invoice = (id, supplierId, amountUsd, extra = {}) => ({
    id, supplierId, amountUsd, invoiceNumber: id.toUpperCase(), date: '2026-06-01T12:00:00.000Z', dueDate: null, ...extra,
});
const payment = (supplierId, amountUsd, extra = {}) => ({
    id: `pay-${Math.random()}`, tipo: 'PAGO_PROVEEDOR', supplierId, totalUsd: -Math.abs(amountUsd), date: '2026-07-01T12:00:00.000Z', ...extra,
});

describe('applySupervisorSupplierCommand', () => {
    it('create es idempotente: repetir el alta no duplica ni toca la deuda', () => {
        const payload = { action: 'create', supplier: { id: 's1', name: 'Distribuidora', phone: '123' } };
        const first = applySupervisorSupplierCommand([], payload);
        expect(first.status).toBe('applied');
        expect(first.suppliers).toHaveLength(1);
        expect(first.suppliers[0].deuda).toBe(0);

        const withDebt = [{ ...first.suppliers[0], deuda: 500 }];
        const second = applySupervisorSupplierCommand(withDebt, payload);
        expect(second.status).toBe('applied');
        expect(second.suppliers).toHaveLength(1);
        expect(second.suppliers[0].deuda).toBe(500); // jamás regenera deuda
    });

    it('edit aplica el patch sin tocar la deuda; sobre un proveedor borrado es rejected', () => {
        const list = [supplier('s1', 300)];
        const result = applySupervisorSupplierCommand(list, {
            action: 'edit', supplierId: 's1', patch: { name: 'Nuevo Nombre', phone: '999', deuda: 1 },
        });
        expect(result.status).toBe('applied');
        expect(result.suppliers[0]).toMatchObject({ name: 'Nuevo Nombre', phone: '999', deuda: 300 });

        const rejected = applySupervisorSupplierCommand(list, { action: 'edit', supplierId: 's9', patch: { name: 'X' } });
        expect(rejected.status).toBe('rejected');
        expect(rejected.error).toMatch(/ya no existe/i);
        expect(rejected.suppliers).toEqual(list); // nada se escribe
    });

    it('delete es idempotente: borrar dos veces deja uno solo', () => {
        const list = [supplier('s1'), supplier('s2')];
        const first = applySupervisorSupplierCommand(list, { action: 'delete', supplierId: 's1' });
        expect(first.suppliers.map((s) => s.id)).toEqual(['s2']);
        const second = applySupervisorSupplierCommand(first.suppliers, { action: 'delete', supplierId: 's1' });
        expect(second.status).toBe('applied');
        expect(second.suppliers.map((s) => s.id)).toEqual(['s2']);
    });
});

describe('applySupervisorInvoiceCommand', () => {
    it('create suma la deuda del proveedor y es idempotente', () => {
        const state = { invoices: [], suppliers: [supplier('s1', 0)], sales: [] };
        const payload = { action: 'create', invoice: invoice('i1', 's1', 250) };

        const first = applySupervisorInvoiceCommand(state, payload);
        expect(first.status).toBe('applied');
        expect(first.invoices).toHaveLength(1);
        expect(first.suppliers[0].deuda).toBe(250);

        const second = applySupervisorInvoiceCommand({ ...state, invoices: first.invoices, suppliers: first.suppliers }, payload);
        expect(second.status).toBe('applied');
        expect(second.invoices).toHaveLength(1);
        expect(second.suppliers[0].deuda).toBe(250); // jamás duplica la deuda
    });

    it('create sobre un proveedor borrado es rejected y no escribe nada', () => {
        const state = { invoices: [], suppliers: [], sales: [] };
        const result = applySupervisorInvoiceCommand(state, { action: 'create', invoice: invoice('i1', 's9', 100) });
        expect(result.status).toBe('rejected');
        expect(result.error).toMatch(/proveedor/i);
        expect(result.invoices).toEqual([]);
    });

    it('edit ajusta la deuda por la diferencia y no baja por debajo de lo pagado', () => {
        const state = {
            invoices: [invoice('i1', 's1', 100)],
            suppliers: [supplier('s1', 100)],
            sales: [payment('s1', 60)],
        };
        // 100 → 80 con 60 pagados: válido, deuda 100 → 80.
        const ok = applySupervisorInvoiceCommand(state, { action: 'edit', invoiceId: 'i1', patch: { amountUsd: 80 } });
        expect(ok.status).toBe('applied');
        expect(ok.suppliers[0].deuda).toBe(80);
        expect(ok.invoices[0].amountUsd).toBe(80);

        // 100 → 50 con 60 pagados: rechazo CIERTO (regla de handleEditInvoice).
        const rejected = applySupervisorInvoiceCommand(state, { action: 'edit', invoiceId: 'i1', patch: { amountUsd: 50 } });
        expect(rejected.status).toBe('rejected');
        expect(rejected.error).toMatch(/por debajo de lo ya pagado/i);
        expect(rejected.suppliers[0].deuda).toBe(100);
    });

    it('delete se rechaza con pagos aplicados y resta la deuda sin ellos', () => {
        const paidState = {
            invoices: [invoice('i1', 's1', 100)],
            suppliers: [supplier('s1', 100)],
            sales: [payment('s1', 40, { invoiceId: 'i1' })],
        };
        const rejected = applySupervisorInvoiceCommand(paidState, { action: 'delete', invoiceId: 'i1' });
        expect(rejected.status).toBe('rejected');
        expect(rejected.error).toMatch(/pagos aplicados/i);
        expect(rejected.invoices).toHaveLength(1);

        const unpaidState = {
            invoices: [invoice('i1', 's1', 100)],
            suppliers: [supplier('s1', 100)],
            sales: [],
        };
        const deleted = applySupervisorInvoiceCommand(unpaidState, { action: 'delete', invoiceId: 'i1' });
        expect(deleted.status).toBe('applied');
        expect(deleted.invoices).toEqual([]);
        expect(deleted.suppliers[0].deuda).toBe(0);

        // Idempotente: repetir el borrado no toca la deuda otra vez.
        const again = applySupervisorInvoiceCommand(
            { ...unpaidState, invoices: deleted.invoices, suppliers: deleted.suppliers },
            { action: 'delete', invoiceId: 'i1' },
        );
        expect(again.status).toBe('applied');
        expect(again.suppliers[0].deuda).toBe(0);
    });

    it('los pagos anulados no blindan la factura (no cuentan como pagado)', () => {
        const state = {
            invoices: [invoice('i1', 's1', 100)],
            suppliers: [supplier('s1', 100)],
            sales: [payment('s1', 40, { status: 'ANULADA' })],
        };
        const deleted = applySupervisorInvoiceCommand(state, { action: 'delete', invoiceId: 'i1' });
        expect(deleted.status).toBe('applied');
    });
});
