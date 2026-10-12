import { describe, expect, it } from 'vitest';
import { allocatePaymentsToInvoices, paidAmountForInvoice } from '../src/utils/supplierAllocation.js';

const inv = (id, amountUsd, date) => ({ id, amountUsd, date });
const pay = (id, totalUsd, date) => ({ id, totalUsd: -totalUsd, date });

describe('allocatePaymentsToInvoices', () => {
    it('marca una factura sin pagos como PENDIENTE', () => {
        const { byInvoice, unallocatedUsd } = allocatePaymentsToInvoices([inv('a', 5, '2026-10-01')], []);
        expect(byInvoice.get('a')).toEqual({ paidUsd: 0, remainingUsd: 5, status: 'PENDIENTE' });
        expect(unallocatedUsd).toBe(0);
    });

    it('un pago parcial deja la factura PARCIAL con el saldo restante', () => {
        const { byInvoice } = allocatePaymentsToInvoices(
            [inv('a', 5, '2026-10-01')],
            [pay('p1', 3, '2026-10-05')],
        );
        expect(byInvoice.get('a')).toEqual({ paidUsd: 3, remainingUsd: 2, status: 'PARCIAL' });
    });

    it('un pago que cubre la factura completa la deja PAGADA', () => {
        const { byInvoice } = allocatePaymentsToInvoices(
            [inv('a', 5, '2026-10-01')],
            [pay('p1', 5, '2026-10-05')],
        );
        expect(byInvoice.get('a')).toEqual({ paidUsd: 5, remainingUsd: 0, status: 'PAGADA' });
    });

    it('reparte FIFO: el pago cubre la factura más antigua primero', () => {
        const { byInvoice } = allocatePaymentsToInvoices(
            [inv('nueva', 4, '2026-10-10'), inv('vieja', 5, '2026-10-01')],
            [pay('p1', 6, '2026-10-12')],
        );
        expect(byInvoice.get('vieja')).toEqual({ paidUsd: 5, remainingUsd: 0, status: 'PAGADA' });
        expect(byInvoice.get('nueva')).toEqual({ paidUsd: 1, remainingUsd: 3, status: 'PARCIAL' });
    });

    it('un pago puede cubrir varias facturas', () => {
        const { byInvoice } = allocatePaymentsToInvoices(
            [inv('a', 2, '2026-10-01'), inv('b', 2, '2026-10-02'), inv('c', 2, '2026-10-03')],
            [pay('p1', 3, '2026-10-05')],
        );
        expect(byInvoice.get('a').status).toBe('PAGADA');
        expect(byInvoice.get('b')).toEqual({ paidUsd: 1, remainingUsd: 1, status: 'PARCIAL' });
        expect(byInvoice.get('c').status).toBe('PENDIENTE');
    });

    it('aplica los pagos en orden cronológico aunque lleguen desordenados', () => {
        const { byInvoice } = allocatePaymentsToInvoices(
            [inv('a', 4, '2026-10-01')],
            [pay('tarde', 3, '2026-10-09'), pay('temprano', 2, '2026-10-02')],
        );
        expect(byInvoice.get('a')).toEqual({ paidUsd: 4, remainingUsd: 0, status: 'PAGADA' });
    });

    it('reporta el excedente como saldo no asignado cuando el pago supera lo facturado', () => {
        const { byInvoice, unallocatedUsd } = allocatePaymentsToInvoices(
            [inv('a', 2, '2026-10-01')],
            [pay('p1', 5, '2026-10-05')],
        );
        expect(byInvoice.get('a').status).toBe('PAGADA');
        expect(unallocatedUsd).toBe(3);
    });

    it('un pago con invoiceId cubre esa factura aunque no sea la más antigua', () => {
        const { byInvoice } = allocatePaymentsToInvoices(
            [inv('vieja', 5, '2026-10-01'), inv('nueva', 5, '2026-10-10')],
            [{ id: 'p1', totalUsd: -3, invoiceId: 'nueva', date: '2026-10-12' }],
        );
        expect(byInvoice.get('nueva')).toEqual({ paidUsd: 3, remainingUsd: 2, status: 'PARCIAL' });
        expect(byInvoice.get('vieja')).toEqual({ paidUsd: 0, remainingUsd: 5, status: 'PENDIENTE' });
    });

    it('si el pago dirigido excede la factura, el excedente sigue FIFO', () => {
        const { byInvoice, unallocatedUsd } = allocatePaymentsToInvoices(
            [inv('vieja', 5, '2026-10-01'), inv('nueva', 2, '2026-10-10')],
            [{ id: 'p1', totalUsd: -4, invoiceId: 'nueva', date: '2026-10-12' }],
        );
        expect(byInvoice.get('nueva')).toEqual({ paidUsd: 2, remainingUsd: 0, status: 'PAGADA' });
        expect(byInvoice.get('vieja')).toEqual({ paidUsd: 2, remainingUsd: 3, status: 'PARCIAL' });
        expect(unallocatedUsd).toBe(0);
    });

    it('un pago dirigido a una factura inexistente se reparte FIFO', () => {
        const { byInvoice } = allocatePaymentsToInvoices(
            [inv('a', 5, '2026-10-01')],
            [{ id: 'p1', totalUsd: -2, invoiceId: 'borrada', date: '2026-10-05' }],
        );
        expect(byInvoice.get('a')).toEqual({ paidUsd: 2, remainingUsd: 3, status: 'PARCIAL' });
    });

    it('un pago ANULADA no reduce el saldo ni cuenta como pagado', () => {
        const { byInvoice, unallocatedUsd } = allocatePaymentsToInvoices(
            [inv('a', 5, '2026-10-01')],
            [{ id: 'p1', totalUsd: -3, status: 'ANULADA', date: '2026-10-05' }],
        );
        expect(byInvoice.get('a')).toEqual({ paidUsd: 0, remainingUsd: 5, status: 'PENDIENTE' });
        expect(unallocatedUsd).toBe(0);
    });

    it('anular un pago devuelve su monto a la factura, pero el resto de pagos siguen activos', () => {
        const invoices = [inv('a', 5, '2026-10-01')];
        const payments = [
            { id: 'p1', totalUsd: -2, date: '2026-10-03' },
            { id: 'p2', totalUsd: -2, date: '2026-10-04', status: 'ANULADA' },
        ];
        expect(paidAmountForInvoice(invoices, payments, 'a')).toBe(2);
    });

    it('paidAmountForInvoice devuelve lo pagado a una factura concreta', () => {
        const invoices = [inv('a', 5, '2026-10-01'), inv('b', 5, '2026-10-02')];
        const payments = [pay('p1', 7, '2026-10-05')];
        expect(paidAmountForInvoice(invoices, payments, 'a')).toBe(5);
        expect(paidAmountForInvoice(invoices, payments, 'b')).toBe(2);
        expect(paidAmountForInvoice(invoices, payments, 'x')).toBe(0);
    });
});
