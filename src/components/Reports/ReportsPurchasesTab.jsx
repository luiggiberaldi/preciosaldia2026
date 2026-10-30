// «Compras de mercancía»: registro rápido de facturas ya pagadas y resumen del
// período (total, por proveedor, por día y detalle). Solo control: no toca la
// caja, el cierre, el stock ni las deudas con proveedores.
import { useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronRight, FileText, Pencil, Plus, ShoppingBag, Store, Trash2, TrendingUp, X } from 'lucide-react';
import ConfirmModal from '../ConfirmModal';
import { formatBs, formatUsd } from '../../utils/calculatorUtils';
import { getLocalISODate } from '../../utils/dateHelpers';
import { rangeLabel } from '../../utils/supplierReportRange';
import {
    PURCHASE_LIMITS,
    buildPurchase,
    purchaseSupplierSuggestions,
    summarizePurchases,
} from '../../utils/merchandisePurchases';

const fmtDay = (iso) => {
    const date = new Date(`${iso}T12:00:00`);
    if (Number.isNaN(date.getTime())) return iso;
    return date.toLocaleDateString('es-VE', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' });
};

const EMPTY_FORM = { supplier: '', amount: '', currency: 'USD', note: '' };

export default function ReportsPurchasesTab({
    purchases = [],
    from,
    to,
    rate = 0,
    salesUsd = null,
    businessName = '',
    readOnly = false,
    formHint = 'Ya pagadas: no descuenta de la caja ni sube el stock.',
    formDisabledReason = null,
    onSave,
    onDelete,
    triggerHaptic,
}) {
    const [date, setDate] = useState(() => getLocalISODate(new Date()));
    const [form, setForm] = useState(EMPTY_FORM);
    const [editing, setEditing] = useState(null);
    const [error, setError] = useState(null);
    const [saving, setSaving] = useState(false);
    const [deleteTarget, setDeleteTarget] = useState(null);
    // Días abiertos por defecto: los botones de editar/borrar quedan a la vista.
    const [closedDays, setClosedDays] = useState(() => new Set());
    const supplierRef = useRef(null);

    const summary = useMemo(() => summarizePurchases(purchases, from, to), [purchases, from, to]);
    const suggestions = useMemo(() => purchaseSupplierSuggestions(purchases), [purchases]);
    const maxSupplier = summary.suppliers[0]?.totalUsd || 1;

    const setField = (field) => (event) => setForm((prev) => ({ ...prev, [field]: event.target.value }));

    const resetForm = () => {
        setForm(EMPTY_FORM);
        setEditing(null);
        setError(null);
    };

    const submit = async (event) => {
        event?.preventDefault();
        if (saving) return;
        // Al corregir se conserva la tasa original de la compra.
        const useRate = editing && form.currency === editing.currency && editing.rate > 0 ? editing.rate : rate;
        const result = buildPurchase({ date, ...form, rate: useRate, previous: editing || undefined });
        if (!result.ok) { setError(result.error); return; }
        triggerHaptic?.();
        setSaving(true);
        try {
            // `false` = no se pudo (p. ej. el supervisor sin conexión): se
            // conserva lo escrito para reintentar.
            const saved = await onSave?.(result.purchase, { isEdit: Boolean(editing) });
            if (saved === false) return;
            resetForm();
            supplierRef.current?.focus();
        } catch (saveError) {
            setError(saveError?.message || 'No se pudo guardar la compra');
        } finally {
            setSaving(false);
        }
    };

    const startEdit = (purchase) => {
        triggerHaptic?.();
        setEditing(purchase);
        setDate(purchase.date);
        setForm({
            supplier: purchase.supplier,
            amount: String(purchase.currency === 'BS' ? purchase.amountBs : purchase.amountUsd),
            currency: purchase.currency,
            note: purchase.note || '',
        });
        setError(null);
        supplierRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
        supplierRef.current?.focus();
    };

    const toggleDay = (day) => setClosedDays((prev) => {
        const next = new Set(prev);
        if (next.has(day)) next.delete(day); else next.add(day);
        return next;
    });

    const exportPdf = async () => {
        triggerHaptic?.();
        const { generatePurchasesReportPDF } = await import('../../utils/purchasesReportGenerator');
        generatePurchasesReportPDF({ purchases, from, to, businessName, salesUsd });
    };

    const amountPreview = (() => {
        const value = Number(String(form.amount).replace(',', '.'));
        if (!(value > 0) || !(rate > 0)) return null;
        return form.currency === 'BS' ? `≈ $${formatUsd(value / rate)}` : `≈ ${formatBs(value * rate)} Bs`;
    })();

    return (
        <div data-testid="purchases-tab" className="space-y-5 animate-in fade-in slide-in-from-bottom-2 duration-300">
            {!readOnly && (
                <form
                    onSubmit={submit}
                    data-testid="purchase-form"
                    className={`bg-white dark:bg-slate-900 rounded-2xl p-4 border shadow-sm space-y-3 ${editing ? 'border-amber-300 dark:border-amber-700' : 'border-slate-200 dark:border-slate-800'}`}
                >
                    <div className="flex items-center justify-between gap-2">
                        <h3 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2">
                            <ShoppingBag size={16} className="text-brand" />
                            {editing ? 'Corregir compra' : 'Agregar compra de mercancía'}
                        </h3>
                        {editing && (
                            <button type="button" onClick={resetForm} className="text-xs font-bold text-slate-500 flex items-center gap-1">
                                <X size={14} /> Cancelar
                            </button>
                        )}
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-12 gap-2">
                        <label className="col-span-2 sm:col-span-3">
                            <span className="text-[10px] font-bold uppercase text-slate-500">Fecha</span>
                            <input
                                type="date"
                                value={date}
                                max={getLocalISODate(new Date())}
                                onChange={(e) => setDate(e.target.value)}
                                aria-label="Fecha de la compra"
                                className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-bold text-slate-700 dark:text-white"
                            />
                        </label>
                        <label className="col-span-2 sm:col-span-5">
                            <span className="text-[10px] font-bold uppercase text-slate-500">Proveedor o producto</span>
                            <input
                                ref={supplierRef}
                                value={form.supplier}
                                onChange={setField('supplier')}
                                list="purchase-supplier-suggestions"
                                maxLength={PURCHASE_LIMITS.MAX_SUPPLIER}
                                placeholder="Ej: Distribuidora Polar"
                                aria-label="Proveedor"
                                autoComplete="off"
                                className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-bold text-slate-700 dark:text-white"
                            />
                            <datalist id="purchase-supplier-suggestions">
                                {suggestions.map((name) => <option key={name} value={name} />)}
                            </datalist>
                        </label>
                        <label className="col-span-1 sm:col-span-3">
                            <span className="text-[10px] font-bold uppercase text-slate-500">Monto</span>
                            <input
                                value={form.amount}
                                onChange={setField('amount')}
                                inputMode="decimal"
                                placeholder="0,00"
                                aria-label="Monto"
                                className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm font-black text-slate-800 dark:text-white"
                            />
                        </label>
                        <div className="col-span-1 sm:col-span-1">
                            <span className="text-[10px] font-bold uppercase text-slate-500">Moneda</span>
                            <div className="mt-1 flex rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden" role="group" aria-label="Moneda">
                                {['USD', 'BS'].map((cur) => (
                                    <button
                                        key={cur}
                                        type="button"
                                        aria-pressed={form.currency === cur}
                                        onClick={() => setForm((prev) => ({ ...prev, currency: cur }))}
                                        className={`flex-1 py-2.5 text-xs font-black ${form.currency === cur ? 'bg-brand text-white' : 'bg-slate-50 dark:bg-slate-800 text-slate-500'}`}
                                    >
                                        {cur === 'USD' ? '$' : 'Bs'}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <label className="col-span-2 sm:col-span-9">
                            <span className="text-[10px] font-bold uppercase text-slate-500">Nota (opcional)</span>
                            <input
                                value={form.note}
                                onChange={setField('note')}
                                maxLength={PURCHASE_LIMITS.MAX_NOTE}
                                placeholder="Ej: N° de factura"
                                aria-label="Nota"
                                className="mt-1 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 py-2.5 text-sm text-slate-700 dark:text-white"
                            />
                        </label>
                        <div className="col-span-2 sm:col-span-3 flex items-end">
                            <button
                                type="submit"
                                disabled={saving || Boolean(formDisabledReason)}
                                className="w-full py-2.5 min-h-[44px] rounded-xl bg-brand hover:bg-brand-dark disabled:opacity-50 text-white text-sm font-black flex items-center justify-center gap-1.5"
                            >
                                {editing ? <Pencil size={15} /> : <Plus size={16} />}
                                {editing ? 'Guardar cambios' : 'Agregar'}
                            </button>
                        </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[11px]">
                        <span className="text-slate-500">
                            {amountPreview ? `${amountPreview} a la tasa de hoy · ` : ''}{formHint}
                        </span>
                        {error && <span role="alert" className="font-bold text-red-600">{error}</span>}
                        {!error && formDisabledReason && <span role="alert" className="font-bold text-amber-700">{formDisabledReason}</span>}
                    </div>
                </form>
            )}

            {/* Resumen */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="col-span-2 bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm">
                    <p className="text-[10px] font-bold text-slate-500 uppercase">Total gastado en mercancía</p>
                    <p data-testid="purchases-total" className="text-3xl font-outfit font-black text-rose-600 dark:text-rose-400 mt-0.5">${formatUsd(summary.totalUsd)}</p>
                    <p className="text-xs font-bold text-slate-500 mt-0.5">≈ {formatBs(summary.totalBs)} Bs · {rangeLabel(from, to)}</p>
                </div>
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm">
                    <p className="text-[10px] font-bold text-slate-500 uppercase">Facturas</p>
                    <p className="text-2xl font-outfit font-black text-slate-900 dark:text-white mt-0.5">{summary.count}</p>
                    <p className="text-xs font-bold text-slate-500 mt-0.5">Promedio ${formatUsd(summary.avgPerDay)} por día</p>
                </div>
                {salesUsd !== null && (
                    <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm">
                        <p className="text-[10px] font-bold text-slate-500 uppercase flex items-center gap-1"><TrendingUp size={12} /> Ventas del período</p>
                        <p className="text-2xl font-outfit font-black text-emerald-600 dark:text-emerald-400 mt-0.5">${formatUsd(salesUsd)}</p>
                        <p className="text-xs font-bold text-slate-500 mt-0.5">Para comparar con lo comprado</p>
                    </div>
                )}
            </div>

            <div className="flex justify-end">
                <button
                    type="button"
                    onClick={exportPdf}
                    className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                >
                    <FileText size={14} /> PDF del reporte de compras
                </button>
            </div>

            {summary.count === 0 ? (
                <div className="bg-white dark:bg-slate-900 rounded-2xl p-8 border border-dashed border-slate-300 dark:border-slate-700 text-center">
                    <ShoppingBag size={28} className="mx-auto text-slate-300" />
                    <p className="text-sm font-bold text-slate-500 mt-2">No hay compras registradas en este período.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    {/* Por proveedor */}
                    <section className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h3 className="text-sm font-black text-slate-800 dark:text-white flex items-center gap-2 mb-3"><Store size={15} /> Por proveedor</h3>
                        <ul className="space-y-2.5" data-testid="purchases-by-supplier">
                            {summary.suppliers.map((s) => (
                                <li key={s.name}>
                                    <div className="flex items-baseline justify-between gap-2 text-xs">
                                        <span className="font-bold text-slate-700 dark:text-slate-200 truncate">{s.name}</span>
                                        <span className="shrink-0 font-black text-slate-800 dark:text-white">${formatUsd(s.totalUsd)}</span>
                                    </div>
                                    <div className="flex items-center gap-2 mt-1">
                                        <div className="flex-1 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                                            <div className="h-full rounded-full bg-rose-400" style={{ width: `${Math.max(3, (s.totalUsd / maxSupplier) * 100)}%` }} />
                                        </div>
                                        <span className="text-[10px] font-bold text-slate-500 w-24 text-right">{formatUsd(s.pct)}% · {s.count} fact.</span>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </section>

                    {/* Por día con detalle */}
                    <section className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm">
                        <h3 className="text-sm font-black text-slate-800 dark:text-white mb-3">Por día</h3>
                        <ul className="divide-y divide-slate-100 dark:divide-slate-800" data-testid="purchases-by-day">
                            {summary.days.map((day) => {
                                const open = !closedDays.has(day.date);
                                return (
                                    <li key={day.date} className="py-1">
                                        <button
                                            type="button"
                                            onClick={() => toggleDay(day.date)}
                                            aria-expanded={open}
                                            className="w-full flex items-center justify-between gap-2 py-2 text-left"
                                        >
                                            <span className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200 capitalize">
                                                {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                {fmtDay(day.date)}
                                                <span className="text-slate-400 font-medium normal-case">· {day.count} fact.</span>
                                            </span>
                                            <span className="text-sm font-black text-slate-800 dark:text-white">${formatUsd(day.totalUsd)}</span>
                                        </button>
                                        {open && (
                                            <ul className="pl-5 pb-2 space-y-1">
                                                {day.items.map((p) => (
                                                    <li key={p.id} data-testid="purchase-row" className="flex items-center gap-2 text-xs py-1">
                                                        <span className="flex-1 min-w-0">
                                                            <span className="font-bold text-slate-700 dark:text-slate-200">{p.supplier}</span>
                                                            {p.note && <span className="text-slate-400"> · {p.note}</span>}
                                                        </span>
                                                        <span className="shrink-0 text-right">
                                                            <span className="font-black text-slate-800 dark:text-white">${formatUsd(p.amountUsd)}</span>
                                                            {p.currency === 'BS' && <span className="block text-[10px] text-slate-400">{formatBs(p.amountBs)} Bs</span>}
                                                        </span>
                                                        {!readOnly && (
                                                            <span className="shrink-0 flex gap-1">
                                                                <button type="button" onClick={() => startEdit(p)} aria-label={`Corregir compra de ${p.supplier}`} title="Editar" className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 text-[11px] font-bold">
                                                                    <Pencil size={13} /><span className="hidden sm:inline">Editar</span>
                                                                </button>
                                                                <button type="button" onClick={() => setDeleteTarget(p)} aria-label={`Borrar compra de ${p.supplier}`} title="Borrar" className="flex items-center gap-1 px-2 py-1.5 rounded-lg border border-red-200 dark:border-red-900 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 text-[11px] font-bold">
                                                                    <Trash2 size={13} /><span className="hidden sm:inline">Borrar</span>
                                                                </button>
                                                            </span>
                                                        )}
                                                    </li>
                                                ))}
                                            </ul>
                                        )}
                                    </li>
                                );
                            })}
                        </ul>
                        <div className="flex items-center justify-between border-t border-slate-200 dark:border-slate-700 pt-3 mt-1">
                            <span className="text-xs font-black uppercase text-slate-500">Total del período</span>
                            <span className="text-base font-black text-rose-600 dark:text-rose-400">${formatUsd(summary.totalUsd)}</span>
                        </div>
                    </section>
                </div>
            )}

            {!readOnly && (
                <ConfirmModal
                    isOpen={Boolean(deleteTarget)}
                    onClose={() => setDeleteTarget(null)}
                    onConfirm={async () => {
                        const target = deleteTarget;
                        setDeleteTarget(null);
                        if (target) {
                            const deleted = await onDelete?.(target);
                            if (deleted === false) return;
                            if (editing?.id === target.id) resetForm();
                        }
                    }}
                    title="Borrar compra"
                    message={deleteTarget ? `${deleteTarget.supplier} · $${formatUsd(deleteTarget.amountUsd)} (${deleteTarget.date})\n\nSe quitará del registro de compras.` : ''}
                    confirmText="Sí, borrar"
                />
            )}
        </div>
    );
}
