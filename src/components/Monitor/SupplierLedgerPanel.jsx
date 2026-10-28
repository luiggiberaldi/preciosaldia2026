// Estado de cuenta de proveedores en el supervisor — Fase 2: lectura + gestión
// remota con comandos ACK-verificados. Los datos viajan desde la caja por
// sync_documents (snapshot `bodega_suppliers_v1` + familia
// `bodega_supplier_invoices_v1:<año>`) y se derivan igual que en la caja:
// deuda publicada + reparto FIFO de pagos (`PAGO_PROVEEDOR` en ventas).
//
// Las acciones (alta/edición/baja) NO escriben aquí: envían una orden por el
// canal de comandos y el panel se actualiza cuando la caja confirma y publica
// (eco). Un rechazo de regla de negocio de la caja (factura con pagos, monto
// por debajo de lo pagado) llega como aviso con el motivo real.
import React, { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, ChevronRight, Pencil, Plus, Trash2, Truck } from 'lucide-react';
import { storageService } from '../../utils/storageService';
import { buildSupplierLedger } from '../../utils/supplierLedger';
import { isSupervisorCommandEnabled, sendSupervisorCommand } from '../../services/supervisorCommandService';
import { trackSupervisorCommand } from '../../services/supervisorCommandTracker';
import { reportSupervisorCommandOutcome } from '../../services/supervisorCommandDiagnostics';
import { showToast } from '../Toast';
import { RemoteInvoiceFormModal, RemoteSupplierFormModal } from './RemoteSupplierModals';

const SUPPLIERS_KEY = 'bodega_suppliers_v1';
const INVOICES_KEY = 'bodega_supplier_invoices_v1';
const SALES_KEY = 'bodega_sales_v1';

const STATUS_STYLES = Object.freeze({
    PAGADA: 'bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-400 border-emerald-200/60 dark:border-emerald-800/40',
    PARCIAL: 'bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border-amber-200/60 dark:border-amber-800/40',
    PENDIENTE: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200/60 dark:border-slate-700/40',
    VENCIDA: 'bg-rose-50 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 border-rose-200/60 dark:border-rose-800/40',
});

const usd = (value) => `USD ${Number(value || 0).toFixed(2)}`;

const formatDate = (value) => {
    if (!value) return '—';
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime())
        ? '—'
        : parsed.toLocaleDateString('es-VE', { day: '2-digit', month: 'short', year: '2-digit' });
};

/**
 * Carga los tres documentos desde el store local y se refresca con los eventos
 * `app_storage_update` que emiten los lectores de sync. Los props son overrides
 * de prueba (presentacional): sin ellos el panel se auto-carga.
 */
function useLedgerSnapshot({ suppliers: suppliersProp, invoices: invoicesProp, sales: salesProp } = {}) {
    const controlled = suppliersProp !== undefined || invoicesProp !== undefined || salesProp !== undefined;
    const [snapshot, setSnapshot] = useState({
        suppliers: suppliersProp ?? [],
        invoices: invoicesProp ?? [],
        sales: salesProp ?? [],
    });

    const reload = useCallback(async () => {
        const [suppliers, invoices, sales] = await Promise.all([
            storageService.getItem(SUPPLIERS_KEY, []),
            storageService.getItem(INVOICES_KEY, []),
            storageService.getItem(SALES_KEY, []),
        ]);
        setSnapshot({
            suppliers: Array.isArray(suppliers) ? suppliers : [],
            invoices: Array.isArray(invoices) ? invoices : [],
            sales: Array.isArray(sales) ? sales : [],
        });
    }, []);

    useEffect(() => {
        if (controlled) return undefined;
        reload();
        const handleUpdate = (event) => {
            const key = event?.detail?.key;
            if (!key || [SUPPLIERS_KEY, INVOICES_KEY, SALES_KEY].includes(key)) reload();
        };
        window.addEventListener('app_storage_update', handleUpdate);
        return () => window.removeEventListener('app_storage_update', handleUpdate);
    }, [controlled, reload]);

    useEffect(() => {
        if (!controlled) return;
        setSnapshot({
            suppliers: suppliersProp ?? [],
            invoices: invoicesProp ?? [],
            sales: salesProp ?? [],
        });
    }, [controlled, suppliersProp, invoicesProp, salesProp]);

    return snapshot;
}

export default function SupplierLedgerPanel({ suppliers, invoices, sales, today, targetDeviceId = null }) {
    const snapshot = useLedgerSnapshot({ suppliers, invoices, sales });
    const [expandedId, setExpandedId] = useState(null);
    const [supplierModal, setSupplierModal] = useState(null); // proveedor a editar | 'new'
    const [invoiceModal, setInvoiceModal] = useState(null);   // { invoice?, defaultSupplierId? }

    const canManage = Boolean(targetDeviceId) && isSupervisorCommandEnabled('supervisor.supplier.create');

    const ledger = buildSupplierLedger(snapshot.suppliers, snapshot.invoices, snapshot.sales, { today });
    const totalDeudaUsd = ledger.reduce((sum, row) => sum + row.deudaUsd, 0);
    const totalOverdue = ledger.reduce((sum, row) => sum + row.overdueCount, 0);
    const withDebt = ledger.filter((row) => row.deudaUsd > 0.005).length;

    const sendDelete = async ({ type, payload, label }) => {
        try {
            const result = await sendSupervisorCommand({ type, targetDeviceId, payload });
            if (!result.ok) {
                reportSupervisorCommandOutcome({ commandId: result.commandId || null, type, status: result.status || 'failed', error: result.error || null });
                showToast(result.error, result.status === 'disabled' ? 'warning' : 'error');
                return;
            }
            trackSupervisorCommand({ commandId: result.commandId, type, payload, label, ackPromise: result.ackPromise });
            showToast('Orden enviada a la caja', 'success');
        } catch (error) {
            const errorText = error?.message || 'error desconocido';
            reportSupervisorCommandOutcome({ type, status: 'failed', error: errorText });
            showToast(`Error al enviar la orden: ${errorText}`, 'error');
        }
    };

    const confirmDeleteSupplier = (row) => {
        const name = row.supplier?.name || 'proveedor';
        if (!globalThis.confirm?.(`¿Eliminar al proveedor "${name}" en la caja?`)) return;
        sendDelete({
            type: 'supervisor.supplier.delete',
            payload: { supplierId: row.supplier.id, supplierName: name },
            label: `la baja de "${name}"`,
        });
    };

    const confirmDeleteInvoice = (row, inv) => {
        const label = inv.invoiceNumber ? `#${inv.invoiceNumber}` : 'sin número';
        if (!globalThis.confirm?.(`¿Eliminar la factura ${label} en la caja?`)) return;
        sendDelete({
            type: 'supervisor.invoice.delete',
            payload: { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber || '' },
            label: `la baja de la factura${inv.invoiceNumber ? ` #${inv.invoiceNumber}` : ''}`,
        });
    };

    return (
        <section data-testid="supplier-ledger-panel" className="space-y-4">
            <div className="bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm">
                <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950/30 flex items-center justify-center text-indigo-600 dark:text-indigo-400 shrink-0">
                        <Truck size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                        <h2 className="text-sm font-black text-slate-800 dark:text-white">Estado de cuenta — Proveedores</h2>
                        <p className="text-[10px] text-slate-400 font-medium">
                            {canManage
                                ? 'Los cambios se envían a la caja como órdenes confirmadas'
                                : 'Solo lectura · datos publicados por la caja'}
                        </p>
                    </div>
                    {canManage && (
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                type="button"
                                onClick={() => setSupplierModal('new')}
                                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary-600 hover:bg-primary-700 text-white text-[10px] font-black uppercase tracking-wider active:scale-95 transition-all"
                            >
                                <Plus size={13} />
                                Proveedor
                            </button>
                            <button
                                type="button"
                                onClick={() => setInvoiceModal({ defaultSupplierId: expandedId })}
                                disabled={snapshot.suppliers.length === 0}
                                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:bg-slate-400 dark:disabled:bg-slate-700 text-white text-[10px] font-black uppercase tracking-wider active:scale-95 transition-all"
                            >
                                <Plus size={13} />
                                Factura
                            </button>
                        </div>
                    )}
                </div>

                <div className="grid grid-cols-3 gap-2 mt-4">
                    <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-3">
                        <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Deuda total</p>
                        <p className="text-sm font-black text-slate-800 dark:text-white mt-0.5">{usd(totalDeudaUsd)}</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-3">
                        <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Con deuda</p>
                        <p className="text-sm font-black text-slate-800 dark:text-white mt-0.5">{withDebt}</p>
                    </div>
                    <div className="bg-slate-50 dark:bg-slate-800/60 rounded-2xl p-3">
                        <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">Vencidas</p>
                        <p className={`text-sm font-black mt-0.5 ${totalOverdue > 0 ? 'text-rose-500' : 'text-slate-800 dark:text-white'}`}>
                            {totalOverdue}
                        </p>
                    </div>
                </div>
            </div>

            {ledger.length === 0 ? (
                <div className="bg-white dark:bg-slate-900 p-6 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm text-center">
                    <Truck size={22} className="mx-auto text-slate-300 dark:text-slate-600" />
                    <p className="text-xs font-bold text-slate-500 dark:text-slate-400 mt-2">
                        La caja aún no tiene proveedores registrados.
                    </p>
                    <p className="text-[10px] text-slate-400 mt-1">
                        {canManage
                            ? 'Crea el primero con el botón "Proveedor": llegará a la caja como orden confirmada.'
                            : 'Aparecerán aquí automáticamente cuando la caja publique su estado de cuenta.'}
                    </p>
                </div>
            ) : (
                <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/60 dark:border-slate-800 shadow-sm overflow-hidden">
                    <ul data-testid="supplier-ledger-list" className="divide-y divide-slate-100 dark:divide-slate-800">
                        {ledger.map((row) => {
                            const open = expandedId === row.supplier.id;
                            return (
                                <li key={row.supplier.id} data-testid={`supplier-ledger-row-${row.supplier.id}`}>
                                    <button
                                        type="button"
                                        onClick={() => setExpandedId(open ? null : row.supplier.id)}
                                        className="w-full px-4 py-3 flex items-center gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 transition-colors"
                                    >
                                        {open
                                            ? <ChevronDown size={16} className="text-slate-400 shrink-0" />
                                            : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
                                        <div className="min-w-0 flex-1">
                                            <p className="text-xs font-black text-slate-800 dark:text-white truncate">
                                                {row.supplier.name || 'Proveedor sin nombre'}
                                            </p>
                                            <p className="text-[10px] text-slate-400 font-medium">
                                                {row.invoiceCount === 0
                                                    ? 'Sin facturas registradas'
                                                    : `${row.invoiceCount} factura${row.invoiceCount === 1 ? '' : 's'} · pendiente ${usd(row.pendingUsd)}`}
                                            </p>
                                        </div>
                                        {row.overdueCount > 0 && (
                                            <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-rose-50 dark:bg-rose-950/30 border border-rose-200/60 dark:border-rose-800/40 text-rose-600 dark:text-rose-400 text-[9px] font-black uppercase shrink-0">
                                                <AlertTriangle size={10} />
                                                {row.overdueCount} vencida{row.overdueCount === 1 ? '' : 's'}
                                            </span>
                                        )}
                                        {row.divergent && (
                                            <span
                                                data-testid={`supplier-divergence-${row.supplier.id}`}
                                                title="La deuda publicada no coincide con el saldo derivado de las facturas"
                                                className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40 text-amber-600 dark:text-amber-400 text-[9px] font-black uppercase shrink-0"
                                            >
                                                <AlertTriangle size={10} />
                                                Δ {usd(Math.abs(row.divergenceUsd))}
                                            </span>
                                        )}
                                        <span className="text-xs font-black text-slate-800 dark:text-white shrink-0">
                                            {usd(row.deudaUsd)}
                                        </span>
                                    </button>

                                    {open && (
                                        <div className="px-4 pb-3 space-y-2">
                                            {row.divergent && (
                                                <div className="flex items-start gap-2 px-2.5 py-2 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200/60 dark:border-amber-800/40">
                                                    <AlertTriangle size={12} className="text-amber-500 shrink-0 mt-0.5" />
                                                    <p className="text-[10px] font-medium text-amber-700 dark:text-amber-300">
                                                        Divergencia: la deuda publicada por la caja ({usd(row.deudaUsd)}) no coincide
                                                        con el saldo derivado de las facturas ({usd(row.pendingUsd)}).
                                                        Diferencia: {usd(Math.abs(row.divergenceUsd))}.
                                                    </p>
                                                </div>
                                            )}
                                            {canManage && (
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        type="button"
                                                        onClick={() => setSupplierModal(row.supplier)}
                                                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-[9px] font-black uppercase tracking-wider hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-95 transition-all"
                                                    >
                                                        <Pencil size={11} />
                                                        Editar proveedor
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => confirmDeleteSupplier(row)}
                                                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-rose-200/70 dark:border-rose-800/40 text-rose-600 dark:text-rose-400 text-[9px] font-black uppercase tracking-wider hover:bg-rose-50 dark:hover:bg-rose-950/30 active:scale-95 transition-all"
                                                    >
                                                        <Trash2 size={11} />
                                                        Eliminar proveedor
                                                    </button>
                                                    <button
                                                        type="button"
                                                        onClick={() => setInvoiceModal({ defaultSupplierId: row.supplier.id })}
                                                        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 text-[9px] font-black uppercase tracking-wider hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-95 transition-all"
                                                    >
                                                        <Plus size={11} />
                                                        Factura
                                                    </button>
                                                </div>
                                            )}
                                            {row.invoiceRows.length === 0 ? (
                                                <p className="text-[10px] text-slate-400 font-medium px-1 pb-1">
                                                    Este proveedor no tiene facturas publicadas.
                                                </p>
                                            ) : (
                                                <ul className="rounded-2xl border border-slate-100 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden">
                                                    {row.invoiceRows.map((inv) => (
                                                        <li key={inv.id} className="px-3 py-2.5 flex items-center gap-3">
                                                            <div className="min-w-0 flex-1">
                                                                <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200 truncate">
                                                                    {inv.invoiceNumber ? `Factura #${inv.invoiceNumber}` : 'Factura sin número'}
                                                                </p>
                                                                <p className="text-[9px] text-slate-400 font-medium">
                                                                    {formatDate(inv.date)}
                                                                    {inv.dueDate ? ` · vence ${formatDate(inv.dueDate)}` : ''}
                                                                    {' · '}pagado {usd(inv.paidUsd)}
                                                                </p>
                                                            </div>
                                                            <div className="text-right shrink-0">
                                                                <p className="text-[11px] font-black text-slate-800 dark:text-white">
                                                                    {usd(inv.remainingUsd)}
                                                                </p>
                                                                <p className="text-[9px] text-slate-400 font-medium">de {usd(inv.amountUsd)}</p>
                                                            </div>
                                                            <span className={`px-2 py-1 rounded-full border text-[9px] font-black uppercase shrink-0 ${STATUS_STYLES[inv.status] || STATUS_STYLES.PENDIENTE}`}>
                                                                {inv.status}
                                                            </span>
                                                            {canManage && (
                                                                <div className="flex items-center gap-1 shrink-0">
                                                                    <button
                                                                        type="button"
                                                                        aria-label={`Editar factura ${inv.invoiceNumber || inv.id}`}
                                                                        onClick={() => setInvoiceModal({ invoice: { ...inv, supplierId: row.supplier.id }, defaultSupplierId: row.supplier.id })}
                                                                        className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                                                                    >
                                                                        <Pencil size={12} />
                                                                    </button>
                                                                    <button
                                                                        type="button"
                                                                        aria-label={`Eliminar factura ${inv.invoiceNumber || inv.id}`}
                                                                        onClick={() => confirmDeleteInvoice(row, inv)}
                                                                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                                                                    >
                                                                        <Trash2 size={12} />
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </li>
                                                    ))}
                                                </ul>
                                            )}
                                        </div>
                                    )}
                                </li>
                            );
                        })}
                    </ul>
                </div>
            )}

            <RemoteSupplierFormModal
                isOpen={supplierModal != null}
                onClose={() => setSupplierModal(null)}
                targetDeviceId={targetDeviceId}
                supplierToEdit={supplierModal && supplierModal !== 'new' ? supplierModal : null}
            />
            <RemoteInvoiceFormModal
                isOpen={invoiceModal != null}
                onClose={() => setInvoiceModal(null)}
                targetDeviceId={targetDeviceId}
                suppliers={snapshot.suppliers}
                invoiceToEdit={invoiceModal?.invoice || null}
                defaultSupplierId={invoiceModal?.defaultSupplierId || null}
            />
        </section>
    );
}
