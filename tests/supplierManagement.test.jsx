import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockStorage, mockShowToast } = vi.hoisted(() => ({
    mockStorage: {
        getItem: vi.fn(),
        setItem: vi.fn(),
    },
    mockShowToast: vi.fn(),
}));

vi.mock('../src/utils/storageService', () => ({ storageService: mockStorage }));
vi.mock('../src/components/Toast', () => ({ showToast: mockShowToast }));
vi.mock('../src/utils/invoicePhotos', () => ({
    saveInvoicePhoto: vi.fn(),
    deleteInvoicePhoto: vi.fn(),
}));

import { useSupplierManagement } from '../src/hooks/useSupplierManagement';

function SupplierManagementHarness({ onManagement }) {
    const management = useSupplierManagement({ bcvRate: 1, tasaCop: 1, copEnabled: false });
    onManagement(management);
    return null;
}

describe('validación defensiva de pagos a proveedores', () => {
    let container;
    let root;
    let management;

    beforeEach(async () => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        mockStorage.getItem.mockReset().mockResolvedValue([]);
        mockStorage.setItem.mockReset().mockResolvedValue(undefined);
        mockShowToast.mockReset();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => root.render(createElement(SupplierManagementHarness, {
            onManagement: value => { management = value; },
        })));
    });

    afterEach(async () => {
        if (root) await act(async () => root.unmount());
        container?.remove();
    });

    it('rechaza en el handler un pago dirigido que excede el saldo actual de la factura', async () => {
        const supplier = { id: 'supplier-1', name: 'Proveedor', deuda: 20 };
        const invoice = { id: 'invoice-1', supplierId: supplier.id, amountUsd: 10, date: '2026-10-01' };
        await act(async () => {
            management.hydrateSuppliers([supplier], [invoice]);
            management.setSelectedSupplier(supplier);
        });

        await act(async () => management.handlePayInvoice({
            amountUsd: 10.01,
            amountBs: 10.01,
            exchangeRate: 1,
            paymentMethod: 'efectivo_bs',
            currencyMode: 'BS',
            retiraCaja: true,
            invoiceId: invoice.id,
        }));

        expect(mockShowToast).toHaveBeenCalledWith('El pago supera el máximo permitido de USD 10.00', 'error');
        expect(mockStorage.setItem).not.toHaveBeenCalled();
    });

    it('rechaza en el handler un pago automático que excede la deuda, aunque no venga del modal', async () => {
        const supplier = { id: 'supplier-1', name: 'Proveedor', deuda: 20 };
        await act(async () => {
            management.hydrateSuppliers([supplier], []);
            management.setSelectedSupplier(supplier);
        });

        await act(async () => management.handlePayInvoice({
            amountUsd: 20.01,
            amountBs: 20.01,
            exchangeRate: 1,
            paymentMethod: 'efectivo_bs',
            currencyMode: 'BS',
            retiraCaja: true,
        }));

        expect(mockShowToast).toHaveBeenCalledWith('El pago supera el máximo permitido de USD 20.00', 'error');
        expect(mockStorage.setItem).not.toHaveBeenCalled();
    });
});
