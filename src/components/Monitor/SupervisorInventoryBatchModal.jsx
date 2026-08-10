import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, PackagePlus, X } from 'lucide-react';
import SupervisorSelect from './SupervisorSelect';
import { sendSupervisorCommand } from '../../services/supervisorCommandService';
import { SUPERVISOR_REMOTE_EGRESS_ENABLED } from '../../config/supervisorPolicy';
import { showToast } from '../Toast';

const EGRESS_REASONS = [
    { value: 'merma', label: 'Merma' },
    { value: 'danio', label: 'Daño' },
    { value: 'vencimiento', label: 'Vencimiento' },
    { value: 'autoconsumo', label: 'Autoconsumo' },
    { value: 'devolucion', label: 'Devolución' },
    { value: 'ajuste', label: 'Ajuste administrativo' },
];

export default function SupervisorInventoryBatchModal({
    isOpen,
    onClose,
    product,
    targetDeviceId,
    remoteAvailable = false,
    allowEgress = SUPERVISOR_REMOTE_EGRESS_ENABLED,
}) {
    const [direction, setDirection] = useState('ingreso');
    const [quantityInput, setQuantityInput] = useState('1');
    const [inputUnit, setInputUnit] = useState('unidades');
    const [unitsPerPackage, setUnitsPerPackage] = useState(String(product?.unitsPerPackage || 1));
    const [reason, setReason] = useState('');
    const [reasonCategory, setReasonCategory] = useState('merma');
    const [lotReference, setLotReference] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    const unitsDelta = useMemo(() => (
        Number(quantityInput || 0) * Number(unitsPerPackage || 0)
    ), [quantityInput, unitsPerPackage]);
    const projectedStock = Number(product?.stock || 0) + (direction === 'egreso' ? -unitsDelta : unitsDelta);

    if (!isOpen || !product) return null;

    const resetAndClose = () => {
        if (isSubmitting) return;
        onClose?.();
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        const quantity = Number(quantityInput);
        const packageUnits = Number(unitsPerPackage);
        const expectedStock = Number(product.stock || 0);

        if (!remoteAvailable) {
            showToast('La caja está desconectada; no se puede enviar la orden', 'warning');
            return;
        }
        if (!quantity || quantity <= 0 || !packageUnits || packageUnits <= 0) {
            showToast('Indica una cantidad y unidades por empaque válidas', 'error');
            return;
        }
        if (direction === 'egreso' && !allowEgress) {
            showToast('Los egresos remotos aún están bloqueados por seguridad', 'warning');
            return;
        }
        if (direction === 'egreso' && projectedStock < 0) {
            showToast('El egreso supera el stock disponible', 'error');
            return;
        }
        if (!reason.trim()) {
            showToast('El motivo es obligatorio', 'error');
            return;
        }

        setIsSubmitting(true);
        try {
            const result = await sendSupervisorCommand({
                type: 'supervisor.inventory.batch.adjust',
                targetDeviceId,
                payload: {
                    direction,
                    productId: String(product.id),
                    quantityInput: quantity,
                    inputUnit,
                    unitsPerPackage: packageUnits,
                    expectedStock,
                    reason: reason.trim(),
                    reasonCategory: direction === 'egreso' ? reasonCategory : undefined,
                    lotReference: lotReference.trim() || undefined,
                },
            });
            if (!result.ok) {
                showToast(result.error, result.status === 'disabled' ? 'warning' : 'error');
                return;
            }
            const ack = await result.ackPromise;
            if (!ack?.ok) {
                showToast(ack?.error || 'La caja no confirmó el movimiento', 'error');
                return;
            }
            showToast(direction === 'egreso' ? 'Egreso confirmado en la caja' : 'Ingreso confirmado en la caja', 'success');
            onClose?.();
        } catch (error) {
            showToast(error?.message || 'No se pudo enviar el movimiento', 'error');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm">
            <div role="dialog" aria-modal="true" aria-labelledby="supervisor-inventory-batch-title" className="w-full max-w-lg space-y-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-900 sm:p-6">
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-3">
                        <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-400">
                            <PackagePlus size={21} />
                        </div>
                        <div>
                            <h2 id="supervisor-inventory-batch-title" className="text-base font-black text-slate-800 dark:text-white">Ajuste de stock remoto</h2>
                            <p className="max-w-[16rem] truncate text-xs font-semibold text-slate-400">{product.name}</p>
                        </div>
                    </div>
                    <button type="button" aria-label="Cerrar ajuste de stock" onClick={resetAndClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800">
                        <X size={18} />
                    </button>
                </div>

                <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-semibold text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-300">
                    <AlertTriangle size={16} className="mt-0.5 shrink-0" />
                    <span>La operación solo se considera aplicada cuando la caja responde con ACK.</span>
                </div>

                <form onSubmit={handleSubmit} className="space-y-4">
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <SupervisorSelect
                            label="Tipo de movimiento"
                            ariaLabel="Seleccionar tipo de movimiento"
                            value={direction}
                            onChange={setDirection}
                            options={[
                                { value: 'ingreso', label: 'Ingreso de mercancía' },
                                ...(allowEgress ? [{ value: 'egreso', label: 'Egreso de inventario' }] : []),
                            ]}
                        />
                        <SupervisorSelect
                            label="Unidad de entrada"
                            ariaLabel="Seleccionar unidad del lote"
                            value={inputUnit}
                            onChange={setInputUnit}
                            options={[
                                { value: 'unidades', label: 'Unidades' },
                                { value: 'cajas', label: 'Cajas' },
                                { value: 'bultos', label: 'Bultos' },
                            ]}
                        />
                    </div>

                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                            Cantidad
                            <input type="number" min="0.01" step="0.01" value={quantityInput} onChange={event => setQuantityInput(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-700 outline-none focus:border-emerald-500 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
                        </label>
                        <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                            Unidades por empaque
                            <input type="number" min="1" step="1" value={unitsPerPackage} onChange={event => setUnitsPerPackage(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-700 outline-none focus:border-emerald-500 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
                        </label>
                    </div>

                    {direction === 'egreso' && (
                        <SupervisorSelect
                            label="Categoría del egreso"
                            ariaLabel="Seleccionar categoría del egreso"
                            value={reasonCategory}
                            onChange={setReasonCategory}
                            options={EGRESS_REASONS}
                        />
                    )}

                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                        Motivo obligatorio
                        <textarea required rows="2" value={reason} onChange={event => setReason(event.target.value)} maxLength={240} placeholder="Describe el movimiento..." className="mt-1.5 w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 p-3 text-sm font-semibold text-slate-700 outline-none focus:border-emerald-500 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
                    </label>

                    <label className="block text-[10px] font-black uppercase tracking-wider text-slate-400">
                        Lote o referencia (opcional)
                        <input type="text" value={lotReference} onChange={event => setLotReference(event.target.value)} maxLength={128} className="mt-1.5 min-h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-700 outline-none focus:border-emerald-500 dark:border-slate-800 dark:bg-slate-950 dark:text-white" />
                    </label>

                    <div className="rounded-2xl bg-slate-50 p-3 text-xs font-bold text-slate-500 dark:bg-slate-950 dark:text-slate-400">
                        Stock actual: <strong className="text-slate-800 dark:text-white">{product.stock || 0}</strong> · Proyectado: <strong className={projectedStock < 0 ? 'text-rose-600' : 'text-emerald-600'}>{projectedStock}</strong>
                    </div>

                    <div className="flex gap-3 pt-1">
                        <button type="button" onClick={resetAndClose} disabled={isSubmitting} className="min-h-11 flex-1 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-xs font-black text-slate-600 dark:border-slate-800 dark:bg-slate-950 dark:text-slate-300">Cancelar</button>
                        <button type="submit" disabled={isSubmitting} className="min-h-11 flex-1 rounded-2xl bg-emerald-500 px-4 text-xs font-black text-white shadow-lg shadow-emerald-500/20 disabled:opacity-50">
                            {isSubmitting ? 'Enviando...' : <><Check size={14} className="mr-1 inline" /> Confirmar</>}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
