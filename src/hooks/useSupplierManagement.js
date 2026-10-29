import { useState } from 'react';
import { storageService } from '../utils/storageService';
import { showToast } from '../components/Toast';
import { saveInvoicePhoto, deleteInvoicePhoto } from '../utils/invoicePhotos';
import { allocatePaymentsToInvoices, paidAmountForInvoice } from '../utils/supplierAllocation';
import { round2 } from '../utils/dinero';
import { buildSupplierPaymentRecord } from '../utils/supplierPayment';

export function useSupplierManagement({ bcvRate, tasaCop, copEnabled, triggerHaptic, auditLog }) {
    const [suppliers, setSuppliers] = useState([]);
    const [invoices, setInvoices] = useState([]);
    const [selectedSupplier, setSelectedSupplier] = useState(null);

    // Modales de Proveedores
    const [isAddSupplierModalOpen, setIsAddSupplierModalOpen] = useState(false);
    const [editingSupplier, setEditingSupplier] = useState(null);
    const [isAddInvoiceModalOpen, setIsAddInvoiceModalOpen] = useState(false);
    const [isPayInvoiceModalOpen, setIsPayInvoiceModalOpen] = useState(false);
    const [deleteSupplierTarget, setDeleteSupplierTarget] = useState(null);
    const [supplierHistoryData, setSupplierHistoryData] = useState([]);
    const [editingInvoice, setEditingInvoice] = useState(null);
    const [deleteInvoiceTarget, setDeleteInvoiceTarget] = useState(null);

    const saveSuppliers = async (updatedSuppliers) => {
        setSuppliers(updatedSuppliers);
        await storageService.setItem('bodega_suppliers_v1', updatedSuppliers);
    };

    const saveInvoices = async (updatedInvoices) => {
        setInvoices(updatedInvoices);
        await storageService.setItem('bodega_supplier_invoices_v1', updatedInvoices);
    };

    const handleSaveSupplier = async (supplierData) => {
        triggerHaptic && triggerHaptic();
        let updated;
        if (editingSupplier) {
            updated = suppliers.map(s => s.id === supplierData.id ? supplierData : s);
            showToast('Proveedor actualizado', 'success');
            auditLog('PROVEEDOR', 'PROVEEDOR_EDITADO', `Proveedor "${supplierData.name}" actualizado`);
        } else {
            updated = [...suppliers, supplierData];
            showToast('Proveedor agregado', 'success');
            auditLog('PROVEEDOR', 'PROVEEDOR_CREADO', `Proveedor "${supplierData.name}" creado`);
        }
        await saveSuppliers(updated);
        setIsAddSupplierModalOpen(false);
        setEditingSupplier(null);
        if (selectedSupplier && selectedSupplier.id === supplierData.id) setSelectedSupplier(supplierData);
    };

    // `invoicesList` debe ser la lista YA actualizada: el estado `invoices` del cierre
    // todavía tiene la versión anterior justo después de guardar.
    const refreshSupplierHistory = async (supplierId, invoicesList = invoices) => {
        const allSales = await storageService.getItem('bodega_sales_v1', []);
        const supplierInvoices = invoicesList.filter(i => i.supplierId === supplierId);
        const supplierPayments = allSales.filter(s => s.tipo === 'PAGO_PROVEEDOR' && s.supplierId === supplierId);

        const combined = [...supplierInvoices, ...supplierPayments]
            .sort((a, b) => new Date(b.date || b.timestamp) - new Date(a.date || a.timestamp));

        setSupplierHistoryData(combined);
    };

    const handleSelectSupplier = (supplier) => {
        triggerHaptic && triggerHaptic();
        setSelectedSupplier(supplier);
        refreshSupplierHistory(supplier.id);
    };

    /**
     * Registra una factura. Con `paid` ({ paymentMethod, currencyMode, retiraCaja })
     * la factura nace ya pagada: se guarda con su pago completo y la deuda del
     * proveedor no cambia (sumar y restar el mismo monto es neto cero). El pago
     * lleva la fecha de la factura para que el gasto caiga en el mes correcto.
     */
    const handleAddInvoice = async (rawInvoiceData, paid = null) => {
        triggerHaptic && triggerHaptic();
        // La foto va a IndexedDB (solo local) y nunca al registro de la factura.
        const { _photoBlob, ...invoiceData } = rawInvoiceData;
        if (_photoBlob) {
            try {
                await saveInvoicePhoto(invoiceData.id, _photoBlob);
            } catch {
                // Si IndexedDB falla, la factura se guarda igual sin foto.
                showToast('No se pudo guardar la foto; la factura sí se registró', 'warning');
                invoiceData.hasPhoto = false;
            }
        }
        const supplier = suppliers.find(s => s.id === invoiceData.supplierId);
        const savedInvoice = paid
            ? { ...invoiceData, status: 'PAGADA', amountPaidUsd: invoiceData.amountUsd }
            : invoiceData;
        const updatedInvoices = [...invoices, savedInvoice];
        await saveInvoices(updatedInvoices);

        if (paid && supplier) {
            const allSales = await storageService.getItem('bodega_sales_v1', []);
            allSales.push(buildSupplierPaymentRecord({
                supplier,
                amountUsd: invoiceData.amountUsd,
                amountBs: invoiceData.amountBs,
                amountCop: round2(invoiceData.amountUsd * tasaCop),
                exchangeRate: invoiceData.exchangeRate,
                rateType: invoiceData.rateType,
                paymentMethod: paid.retiraCaja ? paid.paymentMethod : 'pago_externo',
                currencyMode: paid.currencyMode,
                retiraCaja: !!paid.retiraCaja,
                invoiceId: invoiceData.id,
                description: `Pago de factura #${invoiceData.invoiceNumber} (al registrarla)`,
                tasaCop,
                copEnabled,
                timestamp: invoiceData.date,
            }));
            await storageService.setItem('bodega_sales_v1', allSales);
        } else if (supplier) {
            // Actualizar deuda del proveedor
            const updatedSupplier = { ...supplier, deuda: (supplier.deuda || 0) + invoiceData.amountUsd };
            const updatedSuppliers = suppliers.map(s => s.id === supplier.id ? updatedSupplier : s);
            await saveSuppliers(updatedSuppliers);
            setSelectedSupplier(updatedSupplier);
        }
        setIsAddInvoiceModalOpen(false);
        showToast(paid ? 'Factura pagada registrada' : 'Factura registrada', 'success');
        auditLog('PROVEEDOR', paid ? 'FACTURA_PAGADA_REGISTRADA' : 'FACTURA_REGISTRADA', `Factura $${invoiceData.amountUsd?.toFixed(2)} - ${supplier?.name || '?'}${paid ? (paid.retiraCaja ? ' (pagada, Caja)' : ' (pagada, Externo)') : ''}`);
        refreshSupplierHistory(invoiceData.supplierId, updatedInvoices);
    };

    const handlePayInvoice = async ({ amountUsd, amountBs, amountCop, exchangeRate, rateType, paymentMethod, currencyMode, retiraCaja, invoiceId = null }) => {
        const supplier = selectedSupplier;
        if (!supplier) return;

        const safeAmountUsd = round2(Number(amountUsd));
        if (!Number.isFinite(safeAmountUsd) || safeAmountUsd <= 0) {
            showToast('El monto del pago debe ser mayor que cero', 'error');
            return;
        }
        const allSales = await storageService.getItem('bodega_sales_v1', []);
        const supplierInvoices = invoices.filter(invoice => invoice.supplierId === supplier.id);
        const supplierPayments = allSales.filter(sale => sale.tipo === 'PAGO_PROVEEDOR' && sale.supplierId === supplier.id);
        const { byInvoice } = allocatePaymentsToInvoices(supplierInvoices, supplierPayments);
        const selectedInvoice = invoiceId ? supplierInvoices.find(invoice => invoice.id === invoiceId) : null;
        const selectedBalance = invoiceId ? byInvoice.get(invoiceId)?.remainingUsd : null;
        if (invoiceId && (!selectedInvoice || selectedBalance === undefined || selectedBalance <= 0)) {
            showToast('La factura seleccionada ya no está disponible', 'error');
            return;
        }
        const maximumUsd = Math.max(0, Math.min(
            Number(supplier.deuda) || 0,
            invoiceId ? selectedBalance : (Number(supplier.deuda) || 0),
        ));
        if (safeAmountUsd > maximumUsd + 0.005) {
            showToast(`El pago supera el máximo permitido de USD ${maximumUsd.toFixed(2)}`, 'error');
            return;
        }
        triggerHaptic && triggerHaptic();

        // 1. Descontar deuda sin permitir saldo negativo.
        const updatedSupplier = { ...supplier, deuda: round2(Math.max(0, (supplier.deuda || 0) - safeAmountUsd)) };
        const updatedSuppliers = suppliers.map(s => s.id === supplier.id ? updatedSupplier : s);
        await saveSuppliers(updatedSuppliers);
        setSelectedSupplier(updatedSupplier);

        // 2. Registrar en Caja/Sistema
        const sales = allSales;
        const pagoRecord = buildSupplierPaymentRecord({
            supplier,
            amountUsd: safeAmountUsd,
            amountBs,
            amountCop,
            exchangeRate: exchangeRate || bcvRate,
            rateType,
            paymentMethod,
            currencyMode,
            retiraCaja,
            invoiceId,
            tasaCop,
            copEnabled,
        });
        sales.push(pagoRecord);
        await storageService.setItem('bodega_sales_v1', sales);

        setIsPayInvoiceModalOpen(false);
        showToast(retiraCaja ? 'Pago registrado y descontado de caja' : 'Pago registrado (externo)', 'success');
        auditLog('PROVEEDOR', 'PAGO_PROVEEDOR', `Pago $${safeAmountUsd.toFixed(2)} a ${supplier.name} (${retiraCaja ? 'Caja' : 'Externo'})`);
        refreshSupplierHistory(supplier.id);
    };

    /**
     * Edita una factura. La deuda del proveedor se ajusta por la diferencia de monto.
     * `patch` admite: invoiceNumber, amountUsd, date, dueDate, newPhotoBlob (Blob|null para quitar).
     */
    const handleEditInvoice = async (invoiceId, patch) => {
        triggerHaptic && triggerHaptic();
        const original = invoices.find(i => i.id === invoiceId);
        if (!original) return;
        const { newPhotoBlob, ...fields } = patch;
        const nextAmount = fields.amountUsd !== undefined ? Number(fields.amountUsd) : original.amountUsd;
        const updatedInvoice = { ...original, ...fields, amountUsd: nextAmount };

        const diff = nextAmount - (original.amountUsd || 0);
        if (diff < 0) {
            // Validar contra lo ya pagado a ESTA factura (asignación FIFO de pagos).
            const allSales = await storageService.getItem('bodega_sales_v1', []);
            const supplierInvoices = invoices.filter(i => i.supplierId === original.supplierId);
            const supplierPayments = allSales.filter(s => s.tipo === 'PAGO_PROVEEDOR' && s.supplierId === original.supplierId);
            const paidUsd = paidAmountForInvoice(supplierInvoices, supplierPayments, invoiceId);
            if (nextAmount < paidUsd) {
                showToast(`No puedes bajar el monto por debajo de lo ya pagado a esta factura (USD ${paidUsd.toFixed(2)})`, 'error');
                return;
            }
        }

        if (newPhotoBlob !== undefined) {
            try {
                if (newPhotoBlob) {
                    await saveInvoicePhoto(invoiceId, newPhotoBlob);
                } else {
                    await deleteInvoicePhoto(invoiceId);
                }
                updatedInvoice.hasPhoto = !!newPhotoBlob;
            } catch {
                showToast('No se pudo actualizar la foto; los demás cambios sí se guardaron', 'warning');
            }
        }

        await saveInvoices(invoices.map(i => i.id === invoiceId ? updatedInvoice : i));

        const supplier = suppliers.find(s => s.id === original.supplierId);
        if (supplier && diff !== 0) {
            const updatedSupplier = { ...supplier, deuda: Math.max(0, (supplier.deuda || 0) + diff) };
            await saveSuppliers(suppliers.map(s => s.id === supplier.id ? updatedSupplier : s));
            setSelectedSupplier(updatedSupplier);
        }
        setEditingInvoice(null);
        showToast('Factura actualizada', 'success');
        auditLog('PROVEEDOR', 'FACTURA_EDITADA', `Factura #${updatedInvoice.invoiceNumber} editada (${supplier?.name || '?'})`);
        refreshSupplierHistory(original.supplierId, invoices.map(i => i.id === invoiceId ? updatedInvoice : i));
    };

    /** Borra una factura: resta su monto de la deuda y elimina su foto local. */
    const handleDeleteInvoice = async (invoice) => {
        triggerHaptic && triggerHaptic();
        if (!invoice) return;
        const allSalesForDelete = await storageService.getItem('bodega_sales_v1', []);
        const invoicesOfSupplier = invoices.filter(i => i.supplierId === invoice.supplierId);
        const paymentsOfSupplier = allSalesForDelete.filter(s => s.tipo === 'PAGO_PROVEEDOR' && s.supplierId === invoice.supplierId);
        if (paidAmountForInvoice(invoicesOfSupplier, paymentsOfSupplier, invoice.id) > 0) {
            showToast('Esta factura ya tiene pagos aplicados; no se puede eliminar', 'error');
            setDeleteInvoiceTarget(null);
            return;
        }
        if (invoice.hasPhoto) {
            try { await deleteInvoicePhoto(invoice.id); } catch { /* la foto queda huérfana; no bloquea el borrado */ }
        }
        await saveInvoices(invoices.filter(i => i.id !== invoice.id));

        const supplier = suppliers.find(s => s.id === invoice.supplierId);
        if (supplier) {
            const updatedSupplier = { ...supplier, deuda: Math.max(0, (supplier.deuda || 0) - (invoice.amountUsd || 0)) };
            await saveSuppliers(suppliers.map(s => s.id === supplier.id ? updatedSupplier : s));
            setSelectedSupplier(updatedSupplier);
        }
        setDeleteInvoiceTarget(null);
        showToast('Factura eliminada', 'success');
        auditLog('PROVEEDOR', 'FACTURA_ELIMINADA', `Factura #${invoice.invoiceNumber} eliminada (${supplier?.name || '?'})`);
        refreshSupplierHistory(invoice.supplierId, invoices.filter(i => i.id !== invoice.id));
    };

    /**
     * Anula un pago/abono a proveedor: marca el pago como ANULADA (los reportes de caja
     * ya lo excluyen) y devuelve al proveedor la deuda que ese pago había descontado.
     */
    const handleVoidSupplierPayment = async (paymentId) => {
        triggerHaptic && triggerHaptic();
        const allSales = await storageService.getItem('bodega_sales_v1', []);
        const target = allSales.find(s => s.id === paymentId && s.tipo === 'PAGO_PROVEEDOR');
        if (!target) return;
        if (target.status === 'ANULADA') {
            showToast('Este pago ya fue anulado', 'warning');
            return;
        }

        const restored = Math.abs(Number(target.totalUsd) || 0);
        const supplier = suppliers.find(s => s.id === target.supplierId);
        const updatedSales = allSales.map(s => (
            s.id === paymentId ? { ...s, status: 'ANULADA', voidedAt: new Date().toISOString() } : s
        ));
        await storageService.setItem('bodega_sales_v1', updatedSales);

        if (supplier) {
            const updatedSupplier = { ...supplier, deuda: (supplier.deuda || 0) + restored };
            await saveSuppliers(suppliers.map(s => (s.id === supplier.id ? updatedSupplier : s)));
            setSelectedSupplier(updatedSupplier);
        }

        showToast('Pago anulado', 'success');
        auditLog('PROVEEDOR', 'PAGO_ANULADO', `Pago $${restored.toFixed(2)} anulado (${supplier?.name || target.supplierName || '?'})`);
        refreshSupplierHistory(target.supplierId);
    };

    const handleDeleteSupplier = async () => {
        const updated = suppliers.filter(s => s.id !== deleteSupplierTarget.id);
        await saveSuppliers(updated);
        showToast(`Proveedor ${deleteSupplierTarget.name} eliminado`, 'success');
        setSelectedSupplier(null);
        setDeleteSupplierTarget(null);
    };

    // Called from parent's loadData to hydrate supplier state
    const hydrateSuppliers = (savedSuppliers, savedInvoices) => {
        setSuppliers(savedSuppliers);
        setInvoices(savedInvoices);
    };

    return {
        // State
        suppliers,
        invoices,
        selectedSupplier,
        isAddSupplierModalOpen,
        editingSupplier,
        isAddInvoiceModalOpen,
        isPayInvoiceModalOpen,
        deleteSupplierTarget,
        supplierHistoryData,

        // State setters (needed by JSX callbacks)
        setSelectedSupplier,
        setIsAddSupplierModalOpen,
        setEditingSupplier,
        setIsAddInvoiceModalOpen,
        setIsPayInvoiceModalOpen,
        setDeleteSupplierTarget,

        // Functions
        saveSuppliers,
        saveInvoices,
        handleSaveSupplier,
        refreshSupplierHistory,
        handleSelectSupplier,
        handleAddInvoice,
        handlePayInvoice,
        handleDeleteSupplier,
        handleEditInvoice,
        handleDeleteInvoice,
        handleVoidSupplierPayment,
        editingInvoice,
        setEditingInvoice,
        deleteInvoiceTarget,
        setDeleteInvoiceTarget,
        hydrateSuppliers,
    };
}
