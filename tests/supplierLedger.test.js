// Derivación del estado de cuenta que ve el supervisor (lectura): deuda
// publicada por la caja + reparto FIFO de los pagos PAGO_PROVEEDOR, con la
// misma semántica que usa la caja (supplierAllocation) y detección de vencidas.
import { describe, expect, it } from 'vitest';
import { buildSupplierLedger } from '../src/utils/supplierLedger';

const TODAY = new Date('2026-10-26T12:00:00.000Z');
const inv = (id, supplierId, amountUsd, date, dueDate = null) => ({ id, supplierId, amountUsd, date, invoiceNumber: id.toUpperCase(), dueDate });
const pay = (id, supplierId, totalUsd, date, extra = {}) => ({ id, tipo: 'PAGO_PROVEEDOR', supplierId, totalUsd: -Math.abs(totalUsd), date, ...extra });

describe('buildSupplierLedger', () => {
    it('lista vacía o datos ausentes → sin filas', () => {
        expect(buildSupplierLedger([], [], [], { today: TODAY })).toEqual([]);
        expect(buildSupplierLedger(undefined, undefined, undefined, { today: TODAY })).toEqual([]);
    });

    it('la deuda publicada manda en la cabecera y el saldo por factura se deriva FIFO', () => {
        const ledger = buildSupplierLedger(
            [{ id: 's1', name: 'Distribuidora', deuda: 150 }],
            [
                inv('i1', 's1', 100, '2026-01-01T12:00:00.000Z'),
                inv('i2', 's1', 100, '2026-02-01T12:00:00.000Z'),
            ],
            [pay('p1', 's1', 50, '2026-03-01T12:00:00.000Z')],
            { today: TODAY },
        );

        expect(ledger).toHaveLength(1);
        const row = ledger[0];
        expect(row.deudaUsd).toBe(150);
        // FIFO: el pago de 50 cubre la factura más antigua (i1).
        expect(row.invoiceRows.find((r) => r.id === 'i1')).toMatchObject({ paidUsd: 50, remainingUsd: 50, status: 'PARCIAL' });
        expect(row.invoiceRows.find((r) => r.id === 'i2')).toMatchObject({ paidUsd: 0, remainingUsd: 100, status: 'PENDIENTE' });
        expect(row.pendingUsd).toBe(150);
    });

    it('un pago con invoiceId aplica a esa factura y los anulados no cuentan', () => {
        const ledger = buildSupplierLedger(
            [{ id: 's1', name: 'Distribuidora', deuda: 100 }],
            [
                inv('i1', 's1', 100, '2026-01-01T12:00:00.000Z'),
                inv('i2', 's1', 100, '2026-02-01T12:00:00.000Z'),
            ],
            [
                pay('p1', 's1', 100, '2026-03-01T12:00:00.000Z', { invoiceId: 'i2' }),
                pay('p2', 's1', 50, '2026-04-01T12:00:00.000Z', { status: 'ANULADA' }),
            ],
            { today: TODAY },
        );

        const row = ledger[0];
        expect(row.invoiceRows.find((r) => r.id === 'i2')).toMatchObject({ paidUsd: 100, remainingUsd: 0, status: 'PAGADA' });
        expect(row.invoiceRows.find((r) => r.id === 'i1')).toMatchObject({ paidUsd: 0, remainingUsd: 100, status: 'PENDIENTE' });
    });

    it('marca VENCIDA solo facturas con saldo y vencimiento pasado; una pagada no vence', () => {
        const ledger = buildSupplierLedger(
            [{ id: 's1', name: 'Distribuidora', deuda: 100 }],
            [
                inv('i1', 's1', 100, '2026-01-01T12:00:00.000Z', '2026-02-01'),
                inv('i2', 's1', 100, '2026-01-01T12:00:00.000Z', '2026-02-01'),
                inv('i3', 's1', 50, '2026-05-01T12:00:00.000Z', '2026-12-31'),
            ],
            [pay('p1', 's1', 100, '2026-01-15T12:00:00.000Z', { invoiceId: 'i2' })],
            { today: TODAY },
        );

        const row = ledger[0];
        expect(row.invoiceRows.find((r) => r.id === 'i1')).toMatchObject({ status: 'VENCIDA', overdue: true });
        expect(row.invoiceRows.find((r) => r.id === 'i2')).toMatchObject({ status: 'PAGADA', overdue: false });
        expect(row.invoiceRows.find((r) => r.id === 'i3')).toMatchObject({ status: 'PENDIENTE', overdue: false });
        expect(row.overdueCount).toBe(1);
    });

    it('ordena por deuda publicada descendente y agrupa pagos por proveedor', () => {
        const ledger = buildSupplierLedger(
            [
                { id: 's1', name: 'Alfa', deuda: 5 },
                { id: 's2', name: 'Beta', deuda: 50 },
                { id: 's3', name: 'Zeta', deuda: 0 },
            ],
            [inv('i1', 's1', 10, '2026-01-01T12:00:00.000Z'), inv('i2', 's2', 20, '2026-01-01T12:00:00.000Z')],
            [pay('p1', 's2', 20, '2026-02-01T12:00:00.000Z')],
            { today: TODAY },
        );

        expect(ledger.map((r) => r.supplier.name)).toEqual(['Beta', 'Alfa', 'Zeta']);
        expect(ledger[0].invoiceRows[0]).toMatchObject({ remainingUsd: 0, status: 'PAGADA' });
        expect(ledger[2].invoiceCount).toBe(0);
        // Un pago del proveedor s2 jamás toca las facturas de s1.
        expect(ledger[1].invoiceRows[0].remainingUsd).toBe(10);
    });

    it('marca divergencia cuando la deuda publicada no coincide con el saldo derivado de facturas', () => {
        const [row] = buildSupplierLedger(
            [{ id: 's1', name: 'Distribuidora', deuda: 500 }],
            [inv('i1', 's1', 100, '2026-01-01T12:00:00.000Z')],
            [],
            { today: TODAY },
        );

        expect(row.deudaUsd).toBe(500);
        expect(row.pendingUsd).toBe(100);
        expect(row.divergenceUsd).toBe(400);
        expect(row.divergent).toBe(true);
    });

    it('sin divergencia cuando la deuda publicada coincide con el saldo derivado', () => {
        const [row] = buildSupplierLedger(
            [{ id: 's1', name: 'Distribuidora', deuda: 150 }],
            [
                inv('i1', 's1', 100, '2026-01-01T12:00:00.000Z'),
                inv('i2', 's1', 100, '2026-02-01T12:00:00.000Z'),
            ],
            [pay('p1', 's1', 50, '2026-03-01T12:00:00.000Z')],
            { today: TODAY },
        );

        expect(row.divergenceUsd).toBe(0);
        expect(row.divergent).toBe(false);
    });

    it('una diferencia de un centavo ya cuenta como divergencia', () => {
        const [row] = buildSupplierLedger(
            [{ id: 's1', name: 'Distribuidora', deuda: 100.01 }],
            [inv('i1', 's1', 100, '2026-01-01T12:00:00.000Z')],
            [],
            { today: TODAY },
        );

        expect(row.divergenceUsd).toBe(0.01);
        expect(row.divergent).toBe(true);
    });

    it('el ruido de coma flotante de la deuda acumulada no dispara falsos positivos', () => {
        // 0.1 + 0.2 = 0.30000000000000004 en coma flotante: la deuda publicada
        // redondeada al centavo coincide con la factura de 0.30.
        const [row] = buildSupplierLedger(
            [{ id: 's1', name: 'Distribuidora', deuda: 0.1 + 0.2 }],
            [inv('i1', 's1', 0.3, '2026-01-01T12:00:00.000Z')],
            [],
            { today: TODAY },
        );

        expect(row.divergenceUsd).toBe(0);
        expect(row.divergent).toBe(false);
    });
});
