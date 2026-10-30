// Formularios remotos de proveedores y facturas (Fase 2). Mismo flujo que
// RemoteProductFormModal: la orden se envía por el canal de comandos
// ACK-verificados, el modal se cierra al quedar registrada ("confirma y sigue")
// y el resultado llega como aviso del tracker (éxito siempre, o error con el
// motivo real de la caja).
import React, { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import { showToast } from '../Toast';
import { Save } from 'lucide-react';
import { sendSupervisorCommand } from '../../services/supervisorCommandService';
import { trackSupervisorCommand } from '../../services/supervisorCommandTracker';
import { reportSupervisorCommandOutcome } from '../../services/supervisorCommandDiagnostics';
import { getLocalISODate } from '../../utils/dateHelpers';

const inputClass = 'w-full form-input border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 text-sm font-bold dark:bg-slate-950 text-slate-800 dark:text-white focus:ring-2 focus:ring-primary-500/50 transition-all';
const labelClass = 'block text-[10px] font-black uppercase tracking-wider text-slate-400 mb-1';

export async function sendTracked({ type, targetDeviceId, payload, label, onSuccess }) {
    try {
        const result = await sendSupervisorCommand({ type, targetDeviceId, payload });
        if (!result.ok) {
            reportSupervisorCommandOutcome({
                commandId: result.commandId || null,
                type,
                status: result.status || 'failed',
                error: result.error || null,
            });
            showToast(result.error, result.status === 'disabled' ? 'warning' : 'error');
            return false;
        }
        // "Confirma y sigue": la orden ya quedó registrada; el resultado llega
        // como aviso del tracker (con el motivo real si la caja la rechaza).
        trackSupervisorCommand({
            commandId: result.commandId,
            type,
            payload,
            label,
            ackPromise: result.ackPromise,
        });
        onSuccess?.();
        return true;
    } catch (error) {
        const errorText = error?.message || 'error desconocido';
        reportSupervisorCommandOutcome({ type, status: 'failed', error: errorText });
        showToast(`Error al enviar la orden: ${errorText}`, 'error');
        return false;
    }
}

export function RemoteSupplierFormModal({ isOpen, onClose, targetDeviceId, supplierToEdit = null }) {
    const isEdit = Boolean(supplierToEdit);
    const [name, setName] = useState('');
    const [phone, setPhone] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setName(supplierToEdit?.name || '');
        setPhone(supplierToEdit?.phone || '');
    }, [isOpen, supplierToEdit]);

    const handleSubmit = async (event) => {
        event.preventDefault();
        const trimmedName = name.trim();
        if (!trimmedName) {
            showToast('El nombre del proveedor es obligatorio', 'error');
            return;
        }
        setIsSubmitting(true);
        const type = isEdit ? 'supervisor.supplier.update' : 'supervisor.supplier.create';
        const payload = isEdit
            ? {
                supplierId: supplierToEdit.id,
                supplierName: trimmedName,
                patch: { name: trimmedName, phone: phone.trim() },
            }
            : {
                supplier: {
                    id: `sup_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    name: trimmedName,
                    phone: phone.trim(),
                },
            };
        try {
            await sendTracked({
                type,
                targetDeviceId,
                payload,
                label: isEdit ? `la edición de "${trimmedName}"` : `el alta de "${trimmedName}"`,
                onSuccess: onClose,
            });
        } finally {
            // El modal queda montado entre aperturas: sin este reset, la próxima
            // alta/edición abre con el botón atascado en "Enviando…" (mismo
            // patrón que RemoteProductFormModal).
            setIsSubmitting(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? 'Editar Proveedor Remoto' : 'Nuevo Proveedor Remoto'} size="max-w-md">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className={labelClass} htmlFor="remote-supplier-name">Nombre</label>
                    <input
                        id="remote-supplier-name"
                        type="text"
                        required
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        className={inputClass}
                        placeholder="Ej: Distribuidora Polar"
                        autoFocus
                    />
                </div>
                <div>
                    <label className={labelClass} htmlFor="remote-supplier-phone">Teléfono (opcional)</label>
                    <input
                        id="remote-supplier-phone"
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        className={inputClass}
                        placeholder="Ej: 0414-1234567"
                    />
                </div>
                <button
                    type="submit"
                    disabled={isSubmitting || !name.trim()}
                    className="w-full py-3 bg-brand-dark hover:opacity-90 disabled:opacity-50 text-white font-bold rounded-xl active:scale-95 transition-all text-sm flex justify-center items-center gap-2"
                >
                    <Save size={16} />
                    {isSubmitting ? 'Enviando…' : 'Enviar a la caja'}
                </button>
            </form>
        </Modal>
    );
}

export function RemoteInvoiceFormModal({
    isOpen,
    onClose,
    targetDeviceId,
    suppliers = [],
    invoiceToEdit = null,
    defaultSupplierId = null,
}) {
    const isEdit = Boolean(invoiceToEdit);
    const [supplierId, setSupplierId] = useState('');
    const [invoiceNumber, setInvoiceNumber] = useState('');
    const [amountUsd, setAmountUsd] = useState('');
    const [invoiceDate, setInvoiceDate] = useState(() => getLocalISODate());
    const [dueDate, setDueDate] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        setSupplierId(invoiceToEdit?.supplierId || defaultSupplierId || suppliers[0]?.id || '');
        setInvoiceNumber(invoiceToEdit?.invoiceNumber || '');
        setAmountUsd(invoiceToEdit?.amountUsd != null ? String(invoiceToEdit.amountUsd) : '');
        setInvoiceDate(invoiceToEdit?.date ? getLocalISODate(new Date(invoiceToEdit.date)) : getLocalISODate());
        setDueDate(invoiceToEdit?.dueDate || '');
    }, [isOpen, invoiceToEdit, defaultSupplierId, suppliers]);

    const amount = Number(amountUsd);
    const valid = Boolean(isEdit ? invoiceToEdit?.id : supplierId) && Number.isFinite(amount) && amount > 0;

    const handleSubmit = async (event) => {
        event.preventDefault();
        if (!valid) {
            showToast('Revisa el proveedor y el monto de la factura', 'error');
            return;
        }
        setIsSubmitting(true);
        // Misma fecha que la caja: mediodía local de la fecha capturada.
        const dateIso = new Date(`${invoiceDate}T12:00:00`).toISOString();
        const type = isEdit ? 'supervisor.invoice.update' : 'supervisor.invoice.create';
        const payload = isEdit
            ? {
                invoiceId: invoiceToEdit.id,
                invoiceNumber: invoiceNumber.trim(),
                patch: {
                    invoiceNumber: invoiceNumber.trim(),
                    amountUsd: amount,
                    date: dateIso,
                    dueDate: dueDate || null,
                },
            }
            : {
                invoice: {
                    id: `inv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
                    supplierId,
                    invoiceNumber: invoiceNumber.trim(),
                    amountUsd: amount,
                    date: dateIso,
                    dueDate: dueDate || null,
                },
            };
        try {
            await sendTracked({
                type,
                targetDeviceId,
                payload,
                label: isEdit
                    ? `la edición de la factura${invoiceNumber.trim() ? ` #${invoiceNumber.trim()}` : ''}`
                    : `el registro de factura${invoiceNumber.trim() ? ` #${invoiceNumber.trim()}` : ''}`,
                onSuccess: onClose,
            });
        } finally {
            // Igual que en el modal de proveedores: el componente vive montado y
            // sin esto el botón queda en "Enviando…" al reabrir.
            setIsSubmitting(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={isEdit ? 'Editar Factura Remota' : 'Registrar Factura Remota'} size="max-w-md">
            <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                    <label className={labelClass} htmlFor="remote-invoice-supplier">Proveedor</label>
                    <select
                        id="remote-invoice-supplier"
                        value={supplierId}
                        onChange={(e) => setSupplierId(e.target.value)}
                        disabled={isEdit}
                        className={inputClass}
                        required
                    >
                        <option value="">Selecciona un proveedor</option>
                        {suppliers.map((supplier) => (
                            <option key={supplier.id} value={supplier.id}>{supplier.name}</option>
                        ))}
                    </select>
                </div>
                <div>
                    <label className={labelClass} htmlFor="remote-invoice-number">Nº de factura (opcional)</label>
                    <input
                        id="remote-invoice-number"
                        type="text"
                        value={invoiceNumber}
                        onChange={(e) => setInvoiceNumber(e.target.value)}
                        className={inputClass}
                        autoFocus
                    />
                </div>
                <div>
                    <label className={labelClass} htmlFor="remote-invoice-amount">Monto USD</label>
                    <input
                        id="remote-invoice-amount"
                        type="number"
                        required
                        min="0.01"
                        step="0.01"
                        value={amountUsd}
                        onChange={(e) => setAmountUsd(e.target.value)}
                        className={inputClass}
                    />
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <div>
                        <label className={labelClass} htmlFor="remote-invoice-date">Fecha</label>
                        <input
                            id="remote-invoice-date"
                            type="date"
                            required
                            value={invoiceDate}
                            onChange={(e) => setInvoiceDate(e.target.value)}
                            className={inputClass}
                        />
                    </div>
                    <div>
                        <label className={labelClass} htmlFor="remote-invoice-due">Vence (opcional)</label>
                        <input
                            id="remote-invoice-due"
                            type="date"
                            value={dueDate}
                            onChange={(e) => setDueDate(e.target.value)}
                            className={inputClass}
                        />
                    </div>
                </div>
                <button
                    type="submit"
                    disabled={isSubmitting || !valid}
                    className="w-full py-3 bg-brand-dark hover:opacity-90 disabled:opacity-50 text-white font-bold rounded-xl active:scale-95 transition-all text-sm flex justify-center items-center gap-2"
                >
                    <Save size={16} />
                    {isSubmitting ? 'Enviando…' : 'Enviar a la caja'}
                </button>
            </form>
        </Modal>
    );
}
