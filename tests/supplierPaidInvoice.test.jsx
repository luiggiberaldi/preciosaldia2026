import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockStorage, mockShowToast } = vi.hoisted(() => ({
    mockStorage: { getItem: vi.fn(), setItem: vi.fn() },
    mockShowToast: vi.fn(),
}));

vi.mock('../src/utils/storageService', () => ({ storageService: mockStorage }));
vi.mock('../src/components/Toast', () => ({ showToast: mockShowToast }));
vi.mock('../src/utils/invoicePhotos', () => ({
    saveInvoicePhoto: vi.fn(),
    deleteInvoicePhoto: vi.fn(),
}));

import { useSupplierManagement } from '../src/hooks/useSupplierManagement';
import { buildSupplierPaymentRecord } from '../src/utils/supplierPayment';
import { allocatePaymentsToInvoices } from '../src/utils/supplierAllocation';

function Harness({ onManagement, auditLog }) {
    onManagement(useSupplierManagement({ bcvRate: 40, tasaCop: 4000, copEnabled: false, auditLog }));
    return null;
}

const savedTo = (key) => mockStorage.setItem.mock.calls.filter(([k]) => k === key).map(([, v]) => v);

const newInvoice = (overrides = {}) => ({
    id: 'inv-1',
    supplierId: 'sup-1',
    invoiceNumber: 'F-100',
    date: new Date('2026-09-15T12:00:00').toISOString(),
    dueDate: null,
    amountUsd: 50,
    amountBs: 2000,
    rateType: 'bcv',
    exchangeRate: 40,
    status: 'PENDIENTE',
    amountPaidUsd: 0,
    type: 'INVOICE',
    hasPhoto: false,
    ...overrides,
});

describe('factura cargada como «ya pagada»', () => {
    let container;
    let root;
    let management;
    let storedSales;
    const auditLog = vi.fn();

    beforeEach(async () => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        storedSales = [];
        mockStorage.getItem.mockReset().mockImplementation(async (key, fallback) => (
            key === 'bodega_sales_v1' ? storedSales : fallback
        ));
        mockStorage.setItem.mockReset().mockResolvedValue(undefined);
        mockShowToast.mockReset();
        auditLog.mockReset();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => root.render(createElement(Harness, {
            onManagement: value => { management = value; },
            auditLog,
        })));
        await act(async () => management.hydrateSuppliers([{ id: 'sup-1', name: 'Proveedor Uno', deuda: 10 }], []));
    });

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        container?.remove();
    });

    it('sin «paid» sigue sumando la deuda y no crea ningún pago', async () => {
        await act(async () => management.handleAddInvoice(newInvoice()));

        expect(savedTo('bodega_supplier_invoices_v1')[0][0]).toMatchObject({ id: 'inv-1', status: 'PENDIENTE' });
        expect(savedTo('bodega_suppliers_v1')[0][0].deuda).toBe(60);
        expect(savedTo('bodega_sales_v1')).toHaveLength(0);
    });

    it('con «paid» guarda la factura saldada, un pago con su invoiceId y no toca la deuda', async () => {
        await act(async () => management.handleAddInvoice(
            newInvoice(),
            { paymentMethod: 'efectivo_usd', currencyMode: 'USD', retiraCaja: false },
        ));

        const [invoice] = savedTo('bodega_supplier_invoices_v1')[0];
        expect(invoice).toMatchObject({ id: 'inv-1', status: 'PAGADA', amountPaidUsd: 50 });
        expect(savedTo('bodega_suppliers_v1')).toHaveLength(0);

        const [payment] = savedTo('bodega_sales_v1')[0];
        expect(payment).toMatchObject({
            tipo: 'PAGO_PROVEEDOR',
            supplierId: 'sup-1',
            invoiceId: 'inv-1',
            description: 'Pago de factura #F-100 (al registrarla)',
            totalUsd: -50,
            totalBs: -2000,
            afectaCaja: false,
            paymentMethod: 'pago_externo',
            // El gasto cae en el mes de la factura, no en el día en que se carga.
            timestamp: invoice.date,
        });
        expect(auditLog).toHaveBeenCalledWith('PROVEEDOR', 'FACTURA_PAGADA_REGISTRADA', expect.stringContaining('Externo'));

        // El estado de cuenta ve la factura con saldo cero.
        const { byInvoice } = allocatePaymentsToInvoices([invoice], [payment]);
        expect(byInvoice.get('inv-1')).toMatchObject({ remainingUsd: 0, status: 'PAGADA' });
    });

    it('si salió de la caja registra el medio de pago y descuenta del arqueo', async () => {
        await act(async () => management.handleAddInvoice(
            newInvoice(),
            { paymentMethod: 'efectivo_bs', currencyMode: 'BS', retiraCaja: true },
        ));

        const [payment] = savedTo('bodega_sales_v1')[0];
        expect(payment).toMatchObject({ afectaCaja: true, paymentMethod: 'efectivo_bs' });
        expect(payment.payments[0]).toMatchObject({ currency: 'BS', amountBs: -2000, amountUsd: 0 });
    });
});

describe('buildSupplierPaymentRecord', () => {
    it('arma el mismo registro que usa el pago normal a proveedor', () => {
        const record = buildSupplierPaymentRecord({
            supplier: { id: 's', name: 'Prov' },
            amountUsd: 10,
            amountBs: 400,
            amountCop: 40000,
            exchangeRate: 40,
            rateType: undefined,
            paymentMethod: 'efectivo_usd',
            currencyMode: 'USD',
            retiraCaja: true,
            tasaCop: 4000,
            copEnabled: true,
            timestamp: '2026-10-01T12:00:00.000Z',
            id: 'pay-1',
        });
        expect(record).toMatchObject({
            id: 'pay-1',
            tipo: 'PAGO_PROVEEDOR',
            rateType: 'bcv',
            totalUsd: -10,
            totalBs: -400,
            totalCop: -40000,
            afectaCaja: true,
        });
        expect(record).not.toHaveProperty('invoiceId');
        expect(record.payments[0]).toMatchObject({ currency: 'USD', amountUsd: -10, amountBs: 0, amountCop: 0, methodLabel: 'Pago a Proveedor' });
        expect(record.items[0].name).toBe('Pago a proveedor: Prov');
    });
});
