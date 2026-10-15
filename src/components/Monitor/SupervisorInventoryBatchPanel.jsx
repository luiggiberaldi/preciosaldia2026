import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, CheckCircle2, Loader2, Package, Plus, Trash2, X } from 'lucide-react';
import { showToast } from '../Toast';
import SupervisorSelect from './SupervisorSelect';
import { SUPERVISOR_REMOTE_EGRESS_ENABLED } from '../../config/supervisorPolicy';
import { formatGranelDisplay, isGranelProduct } from '../../utils/granel';
import {
    addInventoryDraftLine,
    createInventoryDraft,
    getInventoryDraftSummary,
    removeInventoryDraftLine,
    updateInventoryDraftLine,
} from '../../services/supervisorInventoryDraft';
import { sendSupervisorInventoryBatch } from '../../services/supervisorInventoryBatchSender';

const EGRESS_REASONS = [
    { value: 'merma', label: 'Merma' },
    { value: 'danio', label: 'Daño' },
    { value: 'vencimiento', label: 'Vencimiento' },
    { value: 'autoconsumo', label: 'Autoconsumo' },
    { value: 'devolucion', label: 'Devolución' },
    { value: 'ajuste', label: 'Ajuste' },
];
const UNIT_OPTIONS = [
    { value: 'unidades', label: 'Unidades' },
    { value: 'cajas', label: 'Cajas' },
    { value: 'bultos', label: 'Bultos' },
];

const UNIT_LABELS = {
    unidades: { singular: 'unidad', plural: 'unidades' },
    cajas: { singular: 'caja', plural: 'cajas', presentation: true },
    bultos: { singular: 'bulto', plural: 'bultos', presentation: true },
    kg: { singular: 'kg', plural: 'kg', measurable: true },
    lt: { singular: 'lt', plural: 'lt', measurable: true },
    litro: { singular: 'lt', plural: 'lt', measurable: true },
    litros: { singular: 'lt', plural: 'lt', measurable: true },
    'gr/ml': { singular: 'gr/ml', plural: 'gr/ml', measurable: true },
    gr: { singular: 'gr', plural: 'gr', measurable: true },
    g: { singular: 'gr', plural: 'gr', measurable: true },
    ml: { singular: 'ml', plural: 'ml', measurable: true },
};

function isConnectionFailure(message = '') {
    return /conexi[oó]n|conect|desconect|offline|network|fetch|timeout|tiempo de espera/i.test(String(message));
}

function pendingLinesMessage(count) {
    const label = count === 1 ? '1 línea queda pendiente' : `${count} líneas quedan pendientes`;
    return `${label} para reintentar.`;
}

function getInventoryPresentationLabel(line) {
    if (line.product && isGranelProduct(line.product)) return 'Granel';
    return getUnitLabel(line.inputUnit, 2);
}

function formatInventoryNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '0';
    return number.toLocaleString('es-VE', { maximumFractionDigits: 3, useGrouping: false });
}

function getUnitLabel(inputUnit, quantityInput) {
    const unit = UNIT_LABELS[String(inputUnit).toLowerCase()] || {
        singular: String(inputUnit || 'unidad'),
        plural: String(inputUnit || 'unidades'),
    };
    return Number(quantityInput) === 1 ? unit.singular : unit.plural;
}

export function formatInventoryLineQuantity(line = {}) {
    const quantity = Number(line.quantityInput) || 0;
    const unitsPerPackage = Number(line.unitsPerPackage) || 1;
    const unitsDelta = Number(line.unitsDelta ?? quantity * unitsPerPackage) || 0;
    const unit = UNIT_LABELS[String(line.inputUnit).toLowerCase()];
    const quantityLabel = getUnitLabel(line.inputUnit, quantity);

    if (line.product && isGranelProduct(line.product) && line.inputUnit === 'unidades' && unitsPerPackage === 1) {
        return formatGranelDisplay(unitsDelta, line.product);
    }

    if (unit?.presentation || unitsPerPackage !== 1) {
        return `${formatInventoryNumber(quantity)} ${quantityLabel} × ${formatInventoryNumber(unitsPerPackage)} = ${formatInventoryNumber(unitsDelta)} unidades`;
    }

    return `${formatInventoryNumber(quantity)} ${quantityLabel}`;
}

export function formatInventorySummaryTotal(lines = [], totalUnits = 0) {
    if (!lines.length) return '0 unidades';

    const presentationSignatures = new Set(lines.map(line => `${String(line.inputUnit).toLowerCase()}:${Number(line.unitsPerPackage) || 1}`));
    if (presentationSignatures.size > 1) return `${formatInventoryNumber(totalUnits)} unidades equivalentes`;

    const firstLine = lines[0];
    if (firstLine.product && isGranelProduct(firstLine.product) && firstLine.inputUnit === 'unidades' && (Number(firstLine.unitsPerPackage) || 1) === 1) {
        return formatGranelDisplay(totalUnits, firstLine.product);
    }
    const unit = UNIT_LABELS[String(firstLine.inputUnit).toLowerCase()];
    if (unit?.measurable && (Number(firstLine.unitsPerPackage) || 1) === 1) {
        return `${formatInventoryNumber(totalUnits)} ${unit.plural}`;
    }

    return `${formatInventoryNumber(totalUnits)} unidades`;
}

export default function SupervisorInventoryBatchPanel({
    isOpen,
    onClose,
    direction = 'ingreso',
    products = [],
    targetDeviceId,
    remoteAvailable = false,
    initialProduct = null,
    onCompleted,
}) {
    const [draft, setDraft] = useState(() => createInventoryDraft(direction));
    const [productSearch, setProductSearch] = useState('');
    const [selectedProductId, setSelectedProductId] = useState('');
    const [isProductDropdownOpen, setIsProductDropdownOpen] = useState(false);
    const [quantityInput, setQuantityInput] = useState('1');
    const [inputUnit, setInputUnit] = useState('unidades');
    const [unitsPerPackage, setUnitsPerPackage] = useState('1');
    const [formError, setFormError] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [progress, setProgress] = useState(null);
    const [isReviewing, setIsReviewing] = useState(false);

    useEffect(() => {
        if (!isOpen) return;
        const nextDraft = createInventoryDraft(direction);
        setDraft(nextDraft);
        setProductSearch(initialProduct?.name || '');
        setSelectedProductId(initialProduct ? String(initialProduct.id) : '');
        setIsProductDropdownOpen(false);
        setQuantityInput('1');
        setInputUnit('unidades');
        setUnitsPerPackage(String(initialProduct?.unitsPerPackage || 1));
        setFormError('');
        setProgress(null);
        setIsReviewing(false);
    }, [direction, initialProduct, isOpen]);

    useEffect(() => {
        if (!remoteAvailable) {
            setProgress(null);
            if (isSubmitting) {
                setFormError(`Se perdió la conexión con la caja. ${pendingLinesMessage(draft.lines.length)}`);
            }
        }
    }, [remoteAvailable, isSubmitting, draft.lines.length]);

    const summary = useMemo(() => getInventoryDraftSummary(draft, products), [draft, products]);
    const selectedProduct = products.find(product => String(product.id) === String(selectedProductId));
    const availableProducts = useMemo(() => products
        .filter(product => {
            const term = productSearch.trim().toLowerCase();
            if (!term) return true;
            return [product.name, product.barcode].filter(Boolean).some(value => String(value).toLowerCase().includes(term));
        })
        .slice(0, 8), [products, productSearch]);
    const isEgress = direction === 'egreso';

    if (!isOpen) return null;

    const addLine = () => {
        if (!selectedProduct) {
            setFormError('Busca y selecciona un producto');
            return;
        }
        const result = addInventoryDraftLine(draft, {
            productId: selectedProduct.id,
            productName: selectedProduct.name,
            inputUnit,
            quantityInput,
            unitsPerPackage,
        });
        if (result.error) {
            setFormError(result.error);
            return;
        }
        setDraft(result.draft);
        setSelectedProductId('');
        setProductSearch('');
        setIsProductDropdownOpen(false);
        setQuantityInput('1');
        setFormError('');
    };

    const validateBeforeSend = () => {
        if (!remoteAvailable) {
            setProgress(null);
            setFormError('Conecta la caja antes de enviar la recepción');
            return false;
        }
        if (isEgress && !SUPERVISOR_REMOTE_EGRESS_ENABLED) {
            setFormError('Los egresos remotos están deshabilitados');
            return false;
        }
        if (!draft.reason.trim()) {
            setFormError('Indica el motivo del movimiento');
            return false;
        }
        if (!summary.canSubmit) {
            setFormError(summary.invalidLines.length ? 'Revisa las líneas marcadas antes de enviar' : 'Agrega al menos un producto');
            return false;
        }
        return true;
    };

    const openReview = () => {
        if (!validateBeforeSend()) return;
        setFormError('');
        setProgress(null);
        setIsReviewing(true);
    };

    const submit = async () => {
        if (!validateBeforeSend()) return;
        setIsSubmitting(true);
        setProgress({ completed: 0, total: summary.totalLines });
        try {
            const result = await sendSupervisorInventoryBatch({
                draft,
                products,
                targetDeviceId,
                onProgress: (item) => setProgress(current => current ? { ...current, completed: current.completed + (item.status === 'applied' ? 1 : 0) } : current),
            });
            if (result.ok) {
                showToast?.(`${summary.totalLines} movimiento${summary.totalLines === 1 ? '' : 's'} confirmado${summary.totalLines === 1 ? '' : 's'} en caja`, 'success');
                onCompleted?.(result);
                onClose?.();
            } else {
                const appliedCount = result.applied?.length || 0;
                const unresolvedResults = (result.results || []).filter(item => item.status !== 'applied');
                const failedLines = new Set(unresolvedResults.map(item => item.line?.id).filter(Boolean));
                const pendingCount = failedLines.size || Math.max(summary.totalLines - appliedCount, 0);
                const connectionLost = !remoteAvailable
                    || unresolvedResults.some(item => isConnectionFailure(item.error));
                setDraft(current => ({
                    ...current,
                    lines: current.lines.filter(line => failedLines.size === 0 || failedLines.has(line.id)),
                }));
                if (connectionLost || appliedCount === 0) {
                    setProgress(null);
                    setFormError(`${connectionLost ? 'La conexión con la caja se perdió.' : 'La caja no confirmó ningún movimiento.'} ${pendingLinesMessage(pendingCount)}`);
                } else {
                    setProgress({ completed: appliedCount, total: summary.totalLines, partial: true });
                    setFormError('');
                }
                showToast?.(`${appliedCount} aplicados; quedan ${pendingCount} pendientes de revisión`, 'warning');
                onCompleted?.(result);
            }
        } catch (error) {
            setProgress(null);
            setFormError(!remoteAvailable || isConnectionFailure(error?.message)
                ? `La conexión con la caja se perdió. ${pendingLinesMessage(draft.lines.length)}`
                : error?.message || 'No se pudo enviar el lote');
        } finally {
            setIsSubmitting(false);
        }
    };

    const reviewView = (
        <div className="space-y-4">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950">
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Revisión antes de enviar</p>
                <h3 className="mt-1 text-base font-black text-slate-900 dark:text-white">{isEgress ? 'Confirma el egreso' : 'Confirma la recepción'}</h3>
                <p className="mt-1 text-xs text-slate-500">Verifica el detalle. Nada se aplicará hasta confirmar este paso.</p>
            </div>

            <div className="grid gap-3 rounded-2xl border border-slate-200 p-4 dark:border-slate-800 sm:grid-cols-2">
                <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Tipo de movimiento</p><p className="mt-1 text-sm font-black text-slate-800 dark:text-white">{isEgress ? 'Egreso' : 'Ingreso'}</p></div>
                <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Motivo</p><p className="mt-1 text-sm font-bold text-slate-700 dark:text-slate-200">{draft.reason}</p></div>
                {draft.lotReference.trim() && <div className="sm:col-span-2"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Referencia de lote</p><p className="mt-1 text-sm font-bold text-slate-700 dark:text-slate-200">{draft.lotReference}</p></div>}
                {isEgress && <div><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Categoría</p><p className="mt-1 text-sm font-bold capitalize text-slate-700 dark:text-slate-200">{draft.reasonCategory}</p></div>}
            </div>

            <div className="space-y-2">
                <div className="flex items-center justify-between"><h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-300">Detalle del lote</h3><span className="text-[10px] font-black text-slate-400">{summary.totalLines} líneas</span></div>
                <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">
                    {summary.lines.map(line => (
                        <div key={line.id} className="space-y-2 bg-white p-3 dark:bg-slate-900">
                            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-xs font-black text-slate-800 dark:text-white">{line.product?.name || line.productName}</p><p className="mt-0.5 text-[10px] font-bold text-slate-400">Presentación: {getInventoryPresentationLabel(line)}</p></div><span className="shrink-0 text-right text-xs font-black text-slate-700 dark:text-slate-200">{formatInventoryLineQuantity(line)}</span></div>
                            <div className="grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-2 text-[10px] dark:bg-slate-950"><span className="text-slate-500">Stock antes<strong className="ml-1 text-slate-800 dark:text-slate-200">{formatInventoryNumber(line.stock)} unidades</strong></span><span className="text-right text-slate-500">Stock después<strong className={`ml-1 ${line.valid ? 'text-emerald-600' : 'text-rose-600'}`}>{formatInventoryNumber(line.projectedStock)} unidades</strong></span></div>
                            <p className="text-[10px] font-bold text-slate-400">Conversión: {formatInventoryNumber(line.unitsDelta)} unidades equivalentes</p>
                        </div>
                    ))}
                </div>
            </div>

            <div className="grid gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900/40 dark:bg-emerald-950/20 sm:grid-cols-2"><div><p className="text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Total de líneas</p><p className="mt-1 text-lg font-black text-emerald-800 dark:text-emerald-200">{summary.totalLines}</p></div><div className="sm:text-right"><p className="text-[10px] font-black uppercase tracking-wider text-emerald-700 dark:text-emerald-300">Total del movimiento</p><p className="mt-1 text-lg font-black text-emerald-800 dark:text-emerald-200">{formatInventorySummaryTotal(summary.lines, summary.totalUnits)}</p></div></div>
        </div>
    );

    return (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="supervisor-inventory-batch-title">
            <div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-t-[2rem] bg-white shadow-2xl dark:bg-slate-900 sm:rounded-[2rem]">
                <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white/95 p-5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 sm:p-6">
                    <div className="flex items-start gap-3">
                        <div className={`rounded-2xl p-3 ${isEgress ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/30 dark:text-rose-300' : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/30 dark:text-emerald-300'}`}>
                            {isEgress ? <ArrowUpFromLine size={21} /> : <ArrowDownToLine size={21} />}
                        </div>
                        <div>
                            <h2 id="supervisor-inventory-batch-title" className="text-lg font-black text-slate-900 dark:text-white">{isEgress ? 'Egreso rápido' : 'Recepción rápida'}</h2>
                            <p className="mt-1 text-xs font-medium text-slate-500">Carga varios productos y envía el movimiento en una sola operación.</p>
                        </div>
                    </div>
                    <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white"><X size={20} /></button>
                </div>

                <div className="space-y-5 p-5 sm:p-6">
                    {isReviewing ? reviewView : (
                        <>
                    <div className="grid gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4 dark:border-slate-800 dark:bg-slate-950 sm:grid-cols-[1fr_150px_150px_auto] sm:items-end">
                        <div className="relative">
                            <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Producto</label>
                            <input value={productSearch} onChange={(event) => { setProductSearch(event.target.value); setSelectedProductId(''); setIsProductDropdownOpen(true); }} onFocus={() => { if (!selectedProductId && productSearch) setIsProductDropdownOpen(true); }} placeholder="Nombre o código" className="mt-1.5 min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white" />
                            {isProductDropdownOpen && productSearch && availableProducts.length > 0 && (
                                <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-52 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                                    {availableProducts.map(product => (
                                        <button key={product.id} type="button" onClick={() => { setSelectedProductId(String(product.id)); setProductSearch(product.name); setIsProductDropdownOpen(false); }} className={`flex min-h-10 w-full items-center justify-between rounded-xl px-3 text-left text-xs hover:bg-emerald-50 dark:hover:bg-slate-800 ${String(selectedProductId) === String(product.id) ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-200'}`}>
                                            <span className="truncate font-bold">{product.name}</span><span className="ml-2 shrink-0 text-[10px] text-slate-400">{product.stock ?? 0} u</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Cantidad<input type="number" min="0.001" step="any" value={quantityInput} onChange={(event) => setQuantityInput(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-xs font-black outline-none focus:border-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white" /></label>
                        <SupervisorSelect label="Unidad" value={inputUnit} onChange={setInputUnit} options={UNIT_OPTIONS} />
                        <button type="button" onClick={addLine} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-2xl bg-slate-900 px-4 text-xs font-black text-white transition hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"><Plus size={16} />Agregar</button>
                    </div>
                    {selectedProduct && <p className="-mt-3 text-[10px] font-bold text-slate-400">Seleccionado: {selectedProduct.name} · stock actual {selectedProduct.stock ?? 0} · unidades por {inputUnit.slice(0, -1)}: <input aria-label="Unidades por presentación" type="number" min="1" step="any" value={unitsPerPackage} onChange={(event) => setUnitsPerPackage(event.target.value)} className="w-16 rounded-lg border border-slate-200 bg-white px-1.5 py-1 text-center text-[10px] font-black dark:border-slate-700 dark:bg-slate-900 dark:text-white" /></p>}

                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Motivo del movimiento<input value={draft.reason} onChange={(event) => setDraft(current => ({ ...current, reason: event.target.value }))} placeholder="Ej. Compra recibida" className="mt-1.5 min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-emerald-500 dark:border-slate-800 dark:bg-slate-950 dark:text-white" /></label>
                        {isEgress ? <SupervisorSelect label="Categoría de egreso" value={draft.reasonCategory} onChange={(value) => setDraft(current => ({ ...current, reasonCategory: value }))} options={EGRESS_REASONS} /> : <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Referencia de lote <input value={draft.lotReference} onChange={(event) => setDraft(current => ({ ...current, lotReference: event.target.value }))} placeholder="Opcional" className="mt-1.5 min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-emerald-500 dark:border-slate-800 dark:bg-slate-950 dark:text-white" /></label>}
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between"><h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-300">Resumen de carga</h3><span className="text-[10px] font-black text-slate-400">{summary.totalLines} líneas · {formatInventorySummaryTotal(summary.lines, summary.totalUnits)}</span></div>
                        {summary.lines.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-7 text-center text-xs font-bold text-slate-400 dark:border-slate-700"><Package size={24} className="mx-auto mb-2 opacity-50" />Agrega productos para comenzar</div> : <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">{summary.lines.map(line => <div key={line.id} className={`flex items-center gap-3 p-3 ${line.valid ? 'bg-white dark:bg-slate-900' : 'bg-rose-50/70 dark:bg-rose-950/20'}`}><div className="min-w-0 flex-1"><p className="truncate text-xs font-black text-slate-800 dark:text-white">{line.product?.name || line.productName}</p><p className="text-[10px] text-slate-400">Stock {line.stock} → <strong className={line.valid ? 'text-emerald-600' : 'text-rose-600'}>{line.projectedStock}</strong> · {formatInventoryLineQuantity(line)}</p></div><input aria-label={`Cantidad de ${line.productName}`} type="number" min="0.001" step="any" value={line.quantityInput} onChange={(event) => setDraft(current => updateInventoryDraftLine(current, line.id, { quantityInput: event.target.value }))} className="w-20 rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-center text-xs font-black dark:border-slate-700 dark:bg-slate-950 dark:text-white" /><button type="button" aria-label={`Quitar ${line.productName}`} onClick={() => setDraft(current => removeInventoryDraftLine(current, line.id))} className="rounded-xl p-2 text-rose-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={15} /></button></div>)}</div>}
                    </div>

                        </>
                    )}

                    {(formError || !remoteAvailable) && <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{formError || 'La caja está desconectada. Conecta la caja para confirmar; las líneas quedarán pendientes.'}</div>}
                    {progress && remoteAvailable && <div className="flex items-center gap-2 rounded-2xl bg-slate-100 p-3 text-xs font-bold text-slate-600 dark:bg-slate-950 dark:text-slate-300">{progress.partial ? <AlertTriangle size={16} className="text-amber-500" /> : progress.completed === progress.total ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Loader2 size={16} className="animate-spin text-emerald-500" />} Procesados {progress.completed} de {progress.total}{progress.partial ? '. Revisa las líneas pendientes.' : ''}</div>}
                </div>

                <div className="sticky bottom-0 flex gap-3 border-t border-slate-100 bg-white/95 p-5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 sm:justify-end sm:p-6">{isReviewing ? <><button type="button" onClick={() => { if (!isSubmitting) { setIsReviewing(false); setFormError(''); } }} disabled={isSubmitting} className="min-h-12 flex-1 rounded-2xl bg-slate-100 px-5 text-xs font-black text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 sm:flex-none">Volver a editar</button><button type="button" onClick={submit} disabled={isSubmitting || !remoteAvailable || !summary.lines.length} className={`min-h-12 flex-[2] rounded-2xl px-5 text-xs font-black text-white shadow-md transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${isEgress ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>{!remoteAvailable ? 'Conecta la caja' : isSubmitting ? <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />Enviando…</span> : isEgress ? 'Confirmar egreso' : 'Confirmar recepción'}</button></> : <><button type="button" onClick={onClose} className="min-h-12 flex-1 rounded-2xl bg-slate-100 px-5 text-xs font-black text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 sm:flex-none">Cancelar</button><button type="button" onClick={openReview} disabled={isSubmitting || !remoteAvailable || !summary.lines.length} className={`min-h-12 flex-[2] rounded-2xl px-5 text-xs font-black text-white shadow-md transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${isEgress ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>{!remoteAvailable ? 'Conecta la caja' : isEgress ? 'Revisar egreso' : 'Revisar recepción'}</button></>}</div>
            </div>
        </div>
    );
}
