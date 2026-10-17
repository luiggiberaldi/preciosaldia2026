import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, ArrowUpFromLine, CheckCircle2, Loader2, Package, Plus, Trash2, X } from 'lucide-react';
import { showToast } from '../Toast';
import SupervisorSelect from './SupervisorSelect';
import { SUPERVISOR_REMOTE_EGRESS_ENABLED, SUPERVISOR_REMOTE_PRODUCTS_ENABLED } from '../../config/supervisorPolicy';
import { formatGranelDisplay, isGranelProduct } from '../../utils/granel';
import {
    addInventoryDraftLine,
    createInventoryDraft,
    getInventoryDraftSummary,
    readConfiguredPresentationFactor,
    removeInventoryDraftLine,
    resolveGranelKind,
    updateInventoryDraftLine,
} from '../../services/supervisorInventoryDraft';
import { sendSupervisorInventoryBatch } from '../../services/supervisorInventoryBatchSender';
import { buildInventoryBatchTargets, nextStockOpAfterInspection } from '../../services/supervisorStockOps';
import { recordReconciliation } from '../../services/supervisorCommandDiagnostics';
import { inspectSupervisorCommandState, sendSupervisorCommand } from '../../services/supervisorCommandService';
import { buildProductRevision } from '../../services/supervisorContracts';

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
    { value: 'bultos', label: 'Bultos' },
];

// Unidad de empaque (el producto la registra como "Uds. por Bulto / Caja":
// una sola idea). 'cajas' se conserva para leer líneas históricas.
const PRESENTATION_UNITS = ['cajas', 'bultos'];

// Preselección del factor: para empaque usa el configurado en el producto o
// vacío ("sin configurar"); nunca un 1 silencioso que cuente un bulto como una
// unidad. Para unidades/peso el factor es 1 y ni siquiera se muestra.
function presetPresentationFactor(product, inputUnit) {
    if (!PRESENTATION_UNITS.includes(inputUnit)) return '1';
    const factor = readConfiguredPresentationFactor(product);
    return factor == null ? '' : String(factor);
}
const SOLID_UNIT_OPTIONS = [{ value: 'kg', label: 'Kilogramos (kg)' }, { value: 'g', label: 'Gramos (g)' }];
const LIQUID_UNIT_OPTIONS = [{ value: 'lt', label: 'Litros (lt)' }, { value: 'ml', label: 'Mililitros (ml)' }];

// Fase 4: unidades compatibles con el producto seleccionado.
export function getInventoryUnitOptions(product) {
    if (!product || !isGranelProduct(product)) return UNIT_OPTIONS;
    const kind = resolveGranelKind(product);
    if (kind === 'solid') return SOLID_UNIT_OPTIONS;
    if (kind === 'liquid') return LIQUID_UNIT_OPTIONS;
    return [{ value: 'unidades', label: 'Unidades' }];
}

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

    // Fase 4: g/ml se muestran junto a su equivalente canónico en kg/L.
    if (line.product && isGranelProduct(line.product) && ['g', 'ml'].includes(line.inputUnit)) {
        return `${formatInventoryNumber(quantity)} ${quantityLabel} = ${formatGranelDisplay(unitsDelta, line.product)}`;
    }

    if (unit?.presentation || unitsPerPackage !== 1) {
        return `${formatInventoryNumber(quantity)} ${quantityLabel} × ${formatInventoryNumber(unitsPerPackage)} = ${formatInventoryNumber(unitsDelta)} unidades`;
    }

    return `${formatInventoryNumber(quantity)} ${quantityLabel}`;
}

export function formatInventorySummaryTotal(lines = [], totalUnits = 0) {
    if (!lines.length) return '0 unidades';

    const granelKinds = new Set(lines.map(line => (line.product && isGranelProduct(line.product) ? resolveGranelKind(line.product) : null)));
    if (granelKinds.size === 1 && !granelKinds.has(null)) {
        return formatGranelDisplay(totalUnits, lines[0].product);
    }

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

// La construcción de stocks objetivo vive en supervisorStockOps (unificada con
// el ajuste de fila +/−); se re-exporta aquí por compatibilidad.
export { buildInventoryBatchTargets };

export default function SupervisorInventoryBatchPanel({
    isOpen,
    onClose,
    direction = 'ingreso',
    products = [],
    targetDeviceId,
    remoteAvailable = false,
    initialProduct = null,
    onCompleted,
    // Optimistic update: la vista recibe los stocks objetivo por producto para
    // mostrarlos como provisionales mientras la caja confirma (y revertirlos si
    // el lote falla).
    onSubmitting,
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
    const [isSavingFactor, setIsSavingFactor] = useState(false);
    const [progress, setProgress] = useState(null);
    const [isReviewing, setIsReviewing] = useState(false);
    // Fase 10: estado incierto del ACK global → no se recomienda reenvío.
    const [isUncertain, setIsUncertain] = useState(false);
    // Reconciliación en segundo plano: lote incierto pendiente ({ commandId,
    // targets, totalLines }) y su resultado una vez la caja lo resuelve sola.
    const [uncertainBatch, setUncertainBatch] = useState(null);
    const [reconciled, setReconciled] = useState(null);

    useEffect(() => {
        if (!isOpen) return;
        const nextDraft = createInventoryDraft(direction);
        setDraft(nextDraft);
        setProductSearch(initialProduct?.name || '');
        setSelectedProductId(initialProduct ? String(initialProduct.id) : '');
        setIsProductDropdownOpen(false);
        setQuantityInput('1');
        setInputUnit('unidades');
        setUnitsPerPackage('1');
        setFormError('');
        setProgress(null);
        setIsReviewing(false);
        setIsUncertain(false);
        setUncertainBatch(null);
        setReconciled(null);
    }, [direction, initialProduct, isOpen]);

    useEffect(() => {
        if (!remoteAvailable) {
            setProgress(null);
            if (isSubmitting) {
                setFormError(`Se perdió la conexión con la caja. ${pendingLinesMessage(draft.lines.length)}`);
            }
        }
    }, [remoteAvailable, isSubmitting, draft.lines.length]);

    // Reconciliación en segundo plano de un lote incierto: se consulta el estado
    // del MISMO comando (lectura sola; jamás crea otro comando). Si la caja lo
    // resolvió sin intervención del usuario, el panel muestra el resultado
    // reconciliado en vez de seguir pidiendo "Revisar estado del lote".
    useEffect(() => {
        if (!isOpen || !isUncertain || reconciled || !remoteAvailable) return undefined;
        const commandId = uncertainBatch?.commandId;
        if (!commandId) return undefined;
        const { targets, totalLines } = uncertainBatch;
        let cancelled = false;
        const check = async () => {
            try {
                const inspection = await inspectSupervisorCommandState(commandId);
                if (cancelled) return;
                const next = nextStockOpAfterInspection({ state: 'pending' }, inspection);
                // 'active' / 'absent': la caja puede seguir aplicándolo; se
                // re-consulta en el próximo tick.
                if (!next) return;
                const ack = inspection?.ack || null;
                const applied = next.state === 'applied';
                const status = applied
                    ? (ack?.status || 'applied')
                    : (inspection?.state === 'expired' ? 'expired' : 'rejected');
                const suffix = totalLines === 1 ? '' : 's';
                const message = applied
                    ? `Lote reconciliado en segundo plano: ${totalLines} movimiento${suffix} confirmado${suffix} en caja`
                    : `Lote reconciliado en segundo plano: ${status === 'expired' ? 'La orden expiró en la caja sin aplicarse' : (ack?.error || 'La caja rechazó el lote')}. ${pendingLinesMessage(totalLines)}`;
                setIsUncertain(false);
                setFormError('');
                setReconciled({ ok: applied, status, message });
                // Diagnóstico: qué resolvió la caja en segundo plano y cuándo.
                recordReconciliation({
                    commandId,
                    source: 'lote',
                    via: 'auto',
                    outcome: applied ? 'applied' : 'failed',
                    status,
                    detail: message,
                });
                showToast?.(message, applied ? 'success' : 'warning');
                // La vista confirma (o revierte) el mismo objetivo provisional.
                onCompleted?.(
                    applied
                        ? { ok: true, status, commandId, uncertain: false, ack }
                        : { ok: false, status, commandId, uncertain: false, error: ack?.error || undefined, ack },
                    targets,
                );
            } catch {
                // Sin conexión en este momento: se reintenta en el próximo tick.
            }
        };
        check();
        const timer = setInterval(check, 5000);
        return () => {
            cancelled = true;
            clearInterval(timer);
        };
    }, [isOpen, isUncertain, reconciled, remoteAvailable, uncertainBatch, onCompleted]);

    const summary = useMemo(() => getInventoryDraftSummary(draft, products), [draft, products]);
    const selectedProduct = selectedProductId
        ? (products.find(product => String(product.id) === String(selectedProductId))
            || (initialProduct && String(initialProduct.id) === String(selectedProductId) ? initialProduct : null))
        : null;
    const availableProducts = useMemo(() => products
        .filter(product => {
            const term = productSearch.trim().toLowerCase();
            if (!term) return true;
            return [product.name, product.barcode].filter(Boolean).some(value => String(value).toLowerCase().includes(term));
        })
        .slice(0, 8), [products, productSearch]);
    const isEgress = direction === 'egreso';
    const isPresentationUnit = PRESENTATION_UNITS.includes(inputUnit);
    const configuredFactor = readConfiguredPresentationFactor(selectedProduct);
    const enteredFactor = Number(unitsPerPackage);
    const hasValidFactor = Number.isInteger(enteredFactor) && enteredFactor >= 1;
    const canSaveFactor = isPresentationUnit && hasValidFactor && enteredFactor !== configuredFactor;
    const quantity = Number(quantityInput);
    // Cuenta clara antes de agregar: "2 bultos × 24 = 48 unidades".
    const factorPreview = isPresentationUnit && hasValidFactor && Number.isFinite(quantity) && quantity > 0
        ? formatInventoryLineQuantity({ quantityInput: quantity, inputUnit, unitsPerPackage: enteredFactor, unitsDelta: quantity * enteredFactor })
        : null;

    const handleSelectProduct = (product) => {
        setSelectedProductId(String(product.id));
        setProductSearch(product.name);
        setIsProductDropdownOpen(false);
        const options = getInventoryUnitOptions(product);
        const nextUnit = options.some(option => option.value === inputUnit) ? inputUnit : options[0].value;
        setInputUnit(nextUnit);
        setUnitsPerPackage(presetPresentationFactor(product, nextUnit));
    };

    const handleUnitChange = (nextUnit) => {
        setInputUnit(nextUnit);
        setUnitsPerPackage(presetPresentationFactor(selectedProduct, nextUnit));
    };

    const handleSearchChange = (event) => {
        setProductSearch(event.target.value);
        setSelectedProductId('');
        setIsProductDropdownOpen(true);
    };

    /**
     * Configura el empaque del producto "desde aquí" vía edición remota de
     * producto (supervisor.product.update). El cambio queda en el producto de la
     * caja para siempre y la sincronización lo refleja en el monitor.
     */
    const handleSaveFactorToProduct = async () => {
        const factor = Number(unitsPerPackage);
        if (!selectedProduct || !Number.isInteger(factor) || factor < 1) return;
        if (!SUPERVISOR_REMOTE_PRODUCTS_ENABLED) {
            setFormError('La edición remota de productos está deshabilitada');
            return;
        }
        setIsSavingFactor(true);
        setFormError('');
        try {
            const baseRevision = buildProductRevision(selectedProduct);
            const result = await sendSupervisorCommand({
                type: 'supervisor.product.update',
                targetDeviceId,
                payload: {
                    productId: selectedProduct.id,
                    baseRevision,
                    baseUpdatedAt: selectedProduct.updatedAt || selectedProduct.updated_at || null,
                    patch: { unitsPerPackage: factor, baseRevision },
                },
            });
            if (!result?.ok) {
                setFormError(result?.error || 'No se pudo guardar el empaque en el producto');
                return;
            }
            const ack = await result.ackPromise;
            if (!ack?.ok) {
                setFormError(ack?.error || 'La caja no confirmó el cambio de empaque');
                return;
            }
            showToast('Empaque guardado en el producto', 'success');
        } catch (error) {
            setFormError(error?.message || 'No se pudo guardar el empaque en el producto');
        } finally {
            setIsSavingFactor(false);
        }
    };

    if (!isOpen) return null;

    const addLine = () => {
        if (!selectedProduct || !selectedProductId || productSearch.trim().toLowerCase() !== selectedProduct.name.trim().toLowerCase()) {
            setFormError('Busca y selecciona un producto');
            return;
        }
        if (PRESENTATION_UNITS.includes(inputUnit)) {
            const factor = Number(unitsPerPackage);
            if (!Number.isInteger(factor) || factor < 1) {
                setFormError(readConfiguredPresentationFactor(selectedProduct) == null
                    ? 'Este producto no tiene el bulto configurado. Indica cuántas unidades trae el bulto.'
                    : 'Las unidades por bulto deben ser un número entero mayor que cero.');
                return;
            }
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
        setInputUnit('unidades');
        setUnitsPerPackage('1');
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
        const targets = buildInventoryBatchTargets(summary.lines);
        setIsSubmitting(true);
        setUncertainBatch(null);
        setReconciled(null);
        // Optimistic update: la vista muestra el stock objetivo como provisional
        // desde este momento hasta que la caja confirme (o el lote falle).
        onSubmitting?.(targets);
        // Fase 10: un solo comando batch y ACK global. Ninguna línea se marca
        // aplicada hasta que ese ACK llega.
        setProgress({ completed: 0, total: summary.totalLines, awaitingAck: true, phase: 'sending' });
        try {
            const result = await sendSupervisorInventoryBatch({
                draft,
                products,
                targetDeviceId,
                onProgress: (event) => setProgress(current => (current ? { ...current, phase: event?.status || 'sending' } : current)),
            });
            const { status } = result;

            // Diagnóstico: "Revisar estado del lote" sobre un lote incierto que
            // ya resolvió la caja cuenta como reconciliación manual del commandId.
            if (isUncertain && result?.commandId && !result.uncertain) {
                const appliedStatus = status === 'applied' || status === 'applied_with_warnings' || result.ok;
                recordReconciliation({
                    commandId: result.commandId,
                    source: 'lote',
                    via: 'manual',
                    outcome: appliedStatus ? 'applied' : 'failed',
                    status,
                    detail: appliedStatus ? 'Revisado manualmente: aplicado en caja' : `Revisado manualmente: ${status}`,
                });
            }

            if (status === 'applied' || status === 'applied_with_warnings') {
                setIsUncertain(false);
                const suffix = summary.totalLines === 1 ? '' : 's';
                showToast?.(
                    status === 'applied_with_warnings'
                        ? `${summary.totalLines} movimiento${suffix} aplicado${suffix} con advertencias en caja`
                        : `${summary.totalLines} movimiento${suffix} confirmado${suffix} en caja`,
                    status === 'applied_with_warnings' ? 'warning' : 'success',
                );
                onCompleted?.(result, targets);
                onClose?.();
                return;
            }

            if (result.uncertain) {
                // Estado desconocido: la caja puede seguir aplicándolo. NO se
                // recomienda reenvío; el botón pasa a "Revisar estado del lote"
                // (reconcilia el mismo commandId sin crear otro comando).
                setIsUncertain(true);
                setReconciled(null);
                // El mismo commandId se reconcilia en segundo plano mientras el
                // usuario decide; si la caja lo resuelve, se muestra el resultado.
                setUncertainBatch(result?.commandId
                    ? { commandId: result.commandId, targets, totalLines: summary.totalLines }
                    : null);
                setProgress(null);
                setFormError('La caja aún no confirma el lote; puede seguir aplicándolo. No lo reenvíes: pulsa "Revisar estado del lote" para consultar sin crear otro comando.');
                showToast?.('Lote sin confirmar todavía', 'warning');
                onCompleted?.(result, targets);
                return;
            }

            if (status === 'rejected' || status === 'cancelled' || status === 'expired') {
                // Conclusión cierta: nada se aplicó → todas las líneas quedan
                // pendientes y el reintento es seguro (se usará un comando nuevo).
                setIsUncertain(false);
                setProgress(null);
                const reason = status === 'expired'
                    ? 'La orden expiró en la caja sin aplicarse.'
                    : status === 'cancelled'
                        ? 'La orden fue cancelada antes de aplicarse.'
                        : 'La caja rechazó el lote.';
                setFormError(`${reason} ${pendingLinesMessage(summary.totalLines)}`);
                showToast?.(`0 aplicados; quedan ${summary.totalLines} pendientes de revisión`, 'warning');
                onCompleted?.(result, targets);
                return;
            }

            if (status === 'invalid') {
                setIsUncertain(false);
                setProgress(null);
                setFormError(result.error || 'Revisa las líneas marcadas antes de enviar');
                // Nada se envió: la vista revierte cualquier display provisional.
                onCompleted?.(result, targets);
                return;
            }

            if (result.ok) {
                setIsUncertain(false);
                showToast?.(`${summary.totalLines} movimiento${summary.totalLines === 1 ? '' : 's'} confirmado${summary.totalLines === 1 ? '' : 's'} en caja`, 'success');
                onCompleted?.(result, targets);
                onClose?.();
                return;
            }

            // Contrato legacy / fallo cierto: mensajes por línea.
            setIsUncertain(false);
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
            onCompleted?.(result, targets);
        } catch (error) {
            // Excepción no clasificada = estado incierto: tampoco se recomienda
            // reenvío (el próximo intento reconcilia el mismo commandId).
            setIsUncertain(true);
            setUncertainBatch(null);
            setReconciled(null);
            setProgress(null);
            setFormError(`No se pudo confirmar el lote: ${error?.message || 'error desconocido'}. No lo reenvíes: pulsa "Revisar estado del lote" para consultar sin crear otro comando.`);
            // Estado desconocido: la vista deja el stock objetivo como provisional
            // y lo reconcilia sola (o lo revierte si el lote terminó fallando).
            onCompleted?.({ ok: false, status: 'timeout', uncertain: true, error: error?.message || 'error desconocido' }, targets);
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
                            <input value={productSearch} onChange={handleSearchChange} onFocus={() => { if (!selectedProductId && productSearch) setIsProductDropdownOpen(true); }} placeholder="Nombre o código" className="mt-1.5 min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white" />
                            {isProductDropdownOpen && productSearch && availableProducts.length > 0 && (
                                <div className="absolute left-0 right-0 top-full z-20 mt-1 max-h-52 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-1.5 shadow-2xl dark:border-slate-700 dark:bg-slate-900">
                                    {availableProducts.map(product => (
                                        <button key={product.id} type="button" onClick={() => handleSelectProduct(product)} className={`flex min-h-10 w-full items-center justify-between rounded-xl px-3 text-left text-xs hover:bg-emerald-50 dark:hover:bg-slate-800 ${String(selectedProductId) === String(product.id) ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'text-slate-700 dark:text-slate-200'}`}>
                                            <span className="truncate font-bold">{product.name}</span><span className="ml-2 shrink-0 text-[10px] text-slate-400">{product.stock ?? 0} u</span>
                                        </button>
                                    ))}
                                </div>
                            )}
                        </div>
                        <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Cantidad<input type="number" min="0.001" step="any" value={quantityInput} onChange={(event) => setQuantityInput(event.target.value)} className="mt-1.5 min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-xs font-black outline-none focus:border-emerald-500 dark:border-slate-800 dark:bg-slate-900 dark:text-white" /></label>
                        <SupervisorSelect label="Unidad" value={inputUnit} onChange={handleUnitChange} options={getInventoryUnitOptions(selectedProduct)} />
                        <button type="button" onClick={addLine} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-2xl bg-slate-900 px-4 text-xs font-black text-white transition hover:bg-slate-700 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-200"><Plus size={16} />Agregar</button>
                    </div>
                    {selectedProduct && (
                        <div className="-mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10px] font-bold text-slate-400">
                            <p>Seleccionado: {selectedProduct.name} · stock actual {selectedProduct.stock ?? 0}</p>
                            {isPresentationUnit && (
                                <span className="flex flex-wrap items-center gap-1">
                                    <label className="flex items-center gap-1">
                                        unidades por bulto:
                                        <input
                                            aria-label="Unidades por presentación"
                                            type="number"
                                            min="1"
                                            step="1"
                                            inputMode="numeric"
                                            value={unitsPerPackage}
                                            onChange={(event) => { setUnitsPerPackage(event.target.value); setFormError(''); }}
                                            className="w-16 rounded-lg border border-slate-200 bg-white px-1.5 py-1 text-center text-[10px] font-black dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                                        />
                                    </label>
                                    {configuredFactor == null && (
                                        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-black text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">sin configurar</span>
                                    )}
                                    {canSaveFactor && (
                                        <button
                                            type="button"
                                            onClick={handleSaveFactorToProduct}
                                            disabled={isSavingFactor || !remoteAvailable}
                                            className="rounded-full border border-emerald-300 px-2 py-0.5 font-black text-emerald-700 transition hover:bg-emerald-50 disabled:opacity-50 dark:border-emerald-800 dark:text-emerald-300 dark:hover:bg-emerald-950/30"
                                        >
                                            {isSavingFactor ? 'Guardando…' : 'Guardar en el producto'}
                                        </button>
                                    )}
                                </span>
                            )}
                            {factorPreview && <span className="font-black text-emerald-600">{factorPreview}</span>}
                        </div>
                    )}

                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Motivo del movimiento<input value={draft.reason} onChange={(event) => setDraft(current => ({ ...current, reason: event.target.value }))} placeholder="Ej. Compra recibida" className="mt-1.5 min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-emerald-500 dark:border-slate-800 dark:bg-slate-950 dark:text-white" /></label>
                        {isEgress ? <SupervisorSelect label="Categoría de egreso" value={draft.reasonCategory} onChange={(value) => setDraft(current => ({ ...current, reasonCategory: value }))} options={EGRESS_REASONS} /> : <label className="text-[10px] font-black uppercase tracking-wider text-slate-400">Referencia de lote <input value={draft.lotReference} onChange={(event) => setDraft(current => ({ ...current, lotReference: event.target.value }))} placeholder="Opcional" className="mt-1.5 min-h-11 w-full rounded-2xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-emerald-500 dark:border-slate-800 dark:bg-slate-950 dark:text-white" /></label>}
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between"><h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-300">Resumen de carga</h3><span className="text-[10px] font-black text-slate-400">{summary.totalLines} líneas · {formatInventorySummaryTotal(summary.lines, summary.totalUnits)}</span></div>
                        {summary.lines.length === 0 ? <div className="rounded-2xl border border-dashed border-slate-300 p-7 text-center text-xs font-bold text-slate-400 dark:border-slate-700"><Package size={24} className="mx-auto mb-2 opacity-50" />Agrega productos para comenzar</div> : <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-200 dark:divide-slate-800 dark:border-slate-800">{summary.lines.map(line => <div key={line.id} className={`flex items-center gap-3 p-3 ${line.valid ? 'bg-white dark:bg-slate-900' : 'bg-rose-50/70 dark:bg-rose-950/20'}`}><div className="min-w-0 flex-1"><p className="truncate text-xs font-black text-slate-800 dark:text-white">{line.product?.name || line.productName}</p><p className="text-[10px] text-slate-400">Stock {line.stock} → <strong className={line.valid ? 'text-emerald-600' : 'text-rose-600'}>{line.projectedStock}</strong> · {formatInventoryLineQuantity(line)}</p>{!line.valid && line.error && <p role="alert" className="text-[10px] font-bold text-rose-600">{line.error}</p>}</div><input aria-label={`Cantidad de ${line.productName}`} type="number" min="0.001" step="any" value={line.quantityInput} onChange={(event) => setDraft(current => updateInventoryDraftLine(current, line.id, { quantityInput: event.target.value }))} className="w-20 rounded-xl border border-slate-200 bg-slate-50 px-2 py-2 text-center text-xs font-black dark:border-slate-700 dark:bg-slate-950 dark:text-white" /><button type="button" aria-label={`Quitar ${line.productName}`} onClick={() => setDraft(current => removeInventoryDraftLine(current, line.id))} className="rounded-xl p-2 text-rose-400 hover:bg-rose-50 hover:text-rose-600"><Trash2 size={15} /></button></div>)}</div>}
                    </div>

                        </>
                    )}

                    {(formError || !remoteAvailable) && <div className="flex items-start gap-2 rounded-2xl border border-amber-200 bg-amber-50 p-3 text-xs font-bold text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200"><AlertTriangle size={16} className="mt-0.5 shrink-0" />{formError || 'La caja está desconectada. Conecta la caja para confirmar; las líneas quedarán pendientes.'}</div>}
                    {reconciled && <div data-testid="batch-reconciled-result" className={`flex items-start gap-2 rounded-2xl border p-3 text-xs font-bold ${reconciled.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/40 dark:bg-emerald-950/20 dark:text-emerald-200' : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/40 dark:bg-amber-950/20 dark:text-amber-200'}`}>{reconciled.ok ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}{reconciled.message}</div>}
                    {progress && remoteAvailable && <div className="flex items-center gap-2 rounded-2xl bg-slate-100 p-3 text-xs font-bold text-slate-600 dark:bg-slate-950 dark:text-slate-300">{progress.awaitingAck ? <><Loader2 size={16} className="animate-spin text-emerald-500" /> Lote enviado: esperando confirmación global de la caja ({progress.total} líneas{progress.phase === 'reconciling' ? ', revisando orden anterior' : ''})</> : <>{progress.partial ? <AlertTriangle size={16} className="text-amber-500" /> : progress.completed === progress.total ? <CheckCircle2 size={16} className="text-emerald-500" /> : <Loader2 size={16} className="animate-spin text-emerald-500" />} Procesados {progress.completed} de {progress.total}{progress.partial ? '. Revisa las líneas pendientes.' : ''}</>}</div>}
                </div>

                <div className="sticky bottom-0 flex gap-3 border-t border-slate-100 bg-white/95 p-5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 sm:justify-end sm:p-6">{isReviewing ? (reconciled?.ok ? <button type="button" onClick={onClose} className="min-h-12 flex-1 rounded-2xl bg-emerald-600 px-5 text-xs font-black text-white shadow-md transition hover:bg-emerald-700 active:scale-95">Cerrar</button> : <><button type="button" onClick={() => { if (!isSubmitting) { setIsReviewing(false); setFormError(''); } }} disabled={isSubmitting} className="min-h-12 flex-1 rounded-2xl bg-slate-100 px-5 text-xs font-black text-slate-600 hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-slate-800 dark:text-slate-300 sm:flex-none">Volver a editar</button><button type="button" onClick={submit} disabled={isSubmitting || !remoteAvailable || !summary.lines.length} className={`min-h-12 flex-[2] rounded-2xl px-5 text-xs font-black text-white shadow-md transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${isEgress ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>{!remoteAvailable ? 'Conecta la caja' : isSubmitting ? <span className="inline-flex items-center gap-2"><Loader2 size={16} className="animate-spin" />Enviando…</span> : isUncertain ? 'Revisar estado del lote' : isEgress ? 'Confirmar egreso' : 'Confirmar recepción'}</button></>) : <><button type="button" onClick={onClose} className="min-h-12 flex-1 rounded-2xl bg-slate-100 px-5 text-xs font-black text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 sm:flex-none">Cancelar</button><button type="button" onClick={openReview} disabled={isSubmitting || !remoteAvailable || !summary.lines.length} className={`min-h-12 flex-[2] rounded-2xl px-5 text-xs font-black text-white shadow-md transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 ${isEgress ? 'bg-rose-600 hover:bg-rose-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>{!remoteAvailable ? 'Conecta la caja' : isEgress ? 'Revisar egreso' : 'Revisar recepción'}</button></>}</div>
            </div>
        </div>
    );
}
