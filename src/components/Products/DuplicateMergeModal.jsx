import React, { useMemo, useState } from 'react';
import { AlertTriangle, Check, GitMerge, EyeOff, Pencil, Package, RotateCcw } from 'lucide-react';
import { Modal } from '../Modal';
import SmartImage from '../SmartImage';
import { round3 } from '../../utils/dinero';
import { buildMergedProduct, findDuplicateGroups } from '../../utils/duplicateMerge';

const roundStock = (n) => round3(Number(n) || 0);

function formatPrice(v) {
    const n = Number(v) || 0;
    return n > 0 ? `$${n.toFixed(2)}` : 'Sin precio';
}

export default function DuplicateMergeModal({
    isOpen,
    onClose,
    products = [],
    onMergeGroup,
    onEditProduct,
    ignoredSignatures = [],
    onIgnoreGroup,
    onRestoreIgnored,
}) {
    const [tab, setTab] = useState('all');
    const [keepByGroup, setKeepByGroup] = useState({});
    const [sumStockByGroup, setSumStockByGroup] = useState({});
    const [busyGroupId, setBusyGroupId] = useState(null);

    const { groups, barcodeGroups, nameGroups, ignoredGroups } = useMemo(
        () => findDuplicateGroups(products, { ignoredSignatures }),
        [products, ignoredSignatures],
    );

    const visibleGroups = useMemo(() => {
        if (tab === 'barcode') return barcodeGroups;
        if (tab === 'name') return nameGroups;
        if (tab === 'ignored') return ignoredGroups;
        return groups;
    }, [tab, groups, barcodeGroups, nameGroups, ignoredGroups]);

    const handleMerge = async (group, keepId, absorbedIds, sumStock) => {
        if (!onMergeGroup || busyGroupId) return;
        setBusyGroupId(group.id);
        try {
            await onMergeGroup(keepId, absorbedIds, { sumStock, group });
        } finally {
            setBusyGroupId(null);
        }
    };

    return (
        <Modal
            isOpen={isOpen}
            onClose={onClose}
            title="Limpiar y fusionar duplicados"
            size="max-w-2xl"
        >
            <div className="space-y-4">
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Elige cuál artículo conservar como <strong>principal</strong>. Sus existencias se pueden sumar,
                    los códigos distintos pasan a códigos alternos y los demás se eliminan del inventario.
                </p>

                {/* Filtros por tipo */}
                <div className="flex flex-wrap items-center gap-1.5">
                    {[
                        { id: 'all', label: `Todos (${groups.length})` },
                        { id: 'barcode', label: `Mismo código (${barcodeGroups.length})` },
                        { id: 'name', label: `Nombre parecido (${nameGroups.length})` },
                        ...(ignoredGroups.length > 0
                            ? [{ id: 'ignored', label: `Descartados (${ignoredGroups.length})` }]
                            : []),
                    ].map((t) => (
                        <button
                            key={t.id}
                            type="button"
                            onClick={() => setTab(t.id)}
                            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-all border ${
                                tab === t.id
                                    ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900 dark:border-white'
                                    : 'bg-slate-50 text-slate-600 border-slate-200 hover:bg-slate-100 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'
                            }`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>

                {/* Lista de grupos */}
                {visibleGroups.length === 0 ? (
                    <div
                        data-testid="dup-merge-empty"
                        className="rounded-2xl border border-emerald-200 dark:border-emerald-800/40 bg-emerald-50/70 dark:bg-emerald-950/20 p-6 text-center space-y-2"
                    >
                        <div className="mx-auto w-10 h-10 rounded-full bg-emerald-100 dark:bg-emerald-900/50 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                            <Check size={20} />
                        </div>
                        <p className="text-sm font-black text-emerald-800 dark:text-emerald-300">
                            {tab === 'ignored'
                                ? 'No hay grupos descartados.'
                                : '¡Todo limpio! No hay artículos duplicados pendientes.'}
                        </p>
                        {tab !== 'ignored' && ignoredGroups.length > 0 && (
                            <button
                                type="button"
                                onClick={() => setTab('ignored')}
                                className="text-xs font-bold text-emerald-700 dark:text-emerald-400 underline"
                            >
                                Ver {ignoredGroups.length} grupo(s) marcado(s) como distintos
                            </button>
                        )}
                    </div>
                ) : (
                    <div className="space-y-4">
                        {tab === 'ignored' && onRestoreIgnored && (
                            <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/60 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700">
                                <span className="text-xs text-slate-600 dark:text-slate-300 font-medium">
                                    Estos grupos se marcaron como artículos distintos.
                                </span>
                                <button
                                    type="button"
                                    onClick={() => { onRestoreIgnored(); setTab('all'); }}
                                    className="flex items-center gap-1 text-xs font-bold text-brand hover:underline shrink-0"
                                >
                                    <RotateCcw size={13} /> Restaurar avisos
                                </button>
                            </div>
                        )}

                        {visibleGroups.map((group) => {
                            const selectedId = group.products.some((p) => String(p.id) === String(keepByGroup[group.id]))
                                ? keepByGroup[group.id]
                                : group.suggestedKeepId;
                            const keep = group.products.find((p) => String(p.id) === String(selectedId)) || group.products[0];
                            const absorbed = group.products.filter((p) => String(p.id) !== String(keep.id));
                            const sumStock = sumStockByGroup[group.id] ?? true;
                            const preview = buildMergedProduct(keep, absorbed, { sumStock });
                            const isBusy = busyGroupId === group.id;
                            const isBarcode = group.kind === 'barcode';

                            const newAlts = (preview?.merged?.altBarcodes || []).filter(
                                (c) => !(Array.isArray(keep.altBarcodes) && keep.altBarcodes.includes(c)),
                            );

                            return (
                                <div
                                    key={group.id}
                                    data-testid={`dup-group-${group.id}`}
                                    className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/40 overflow-hidden shadow-xs"
                                >
                                    {/* Cabecera del grupo */}
                                    <div className={`px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 border-b ${
                                        isBarcode
                                            ? 'bg-rose-50/90 dark:bg-rose-950/30 border-rose-200/70 dark:border-rose-800/40'
                                            : 'bg-amber-50/90 dark:bg-amber-950/30 border-amber-200/70 dark:border-amber-800/40'
                                    }`}>
                                        <div className="flex items-center gap-2 min-w-0">
                                            <AlertTriangle
                                                size={15}
                                                className={isBarcode ? 'text-rose-500 shrink-0' : 'text-amber-500 shrink-0'}
                                            />
                                            <span className={`text-xs font-black truncate ${
                                                isBarcode ? 'text-rose-700 dark:text-rose-300' : 'text-amber-800 dark:text-amber-300'
                                            }`}>
                                                {isBarcode
                                                    ? `Mismo código: ${group.label}`
                                                    : `Nombre repetido: ${group.label}`}
                                            </span>
                                        </div>
                                        <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                                            {group.products.length} artículos
                                        </span>
                                    </div>

                                    {/* Opciones de artículos */}
                                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                        {group.products.map((p) => {
                                            const isKeep = String(p.id) === String(keep.id);
                                            const pStock = roundStock(p.stock);
                                            return (
                                                <div
                                                    key={p.id}
                                                    onClick={() => setKeepByGroup((prev) => ({ ...prev, [group.id]: p.id }))}
                                                    className={`p-3 flex items-center gap-3 cursor-pointer transition-colors ${
                                                        isKeep
                                                            ? 'bg-emerald-50/60 dark:bg-emerald-950/20'
                                                            : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                                                    }`}
                                                >
                                                    <input
                                                        type="radio"
                                                        name={`keep-${group.id}`}
                                                        checked={isKeep}
                                                        onChange={() => setKeepByGroup((prev) => ({ ...prev, [group.id]: p.id }))}
                                                        aria-label={`Conservar ${p.name}`}
                                                        className="accent-emerald-600 w-4 h-4 shrink-0"
                                                    />
                                                    <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 overflow-hidden shrink-0 flex items-center justify-center">
                                                        <SmartImage
                                                            product={p}
                                                            alt={p.name}
                                                            className="w-full h-full object-cover"
                                                            fallbackIcon={<Package size={16} className="text-slate-400" />}
                                                        />
                                                    </div>
                                                    <div className="min-w-0 flex-1">
                                                        <div className="flex flex-wrap items-center gap-1.5">
                                                            <span className="text-xs font-black text-slate-800 dark:text-white truncate">
                                                                {p.name}
                                                            </span>
                                                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                                                                isKeep
                                                                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                                                                    : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-300'
                                                            }`}>
                                                                {isKeep ? 'Principal' : 'Se elimina'}
                                                            </span>
                                                        </div>
                                                        <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                                                            <span>Cód: <strong className="text-slate-700 dark:text-slate-200">{p.barcode || 'Sin código'}</strong></span>
                                                            <span>Precio: <strong className="text-slate-700 dark:text-slate-200">{formatPrice(p.priceUsd)}</strong></span>
                                                            <span>Stock: <strong className={pStock > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-500'}>{pStock}</strong></span>
                                                        </div>
                                                    </div>
                                                    {onEditProduct && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                onEditProduct(p);
                                                            }}
                                                            title="Editar este artículo en vez de fusionar"
                                                            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors shrink-0"
                                                        >
                                                            <Pencil size={14} />
                                                        </button>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>

                                    {/* Resumen y acciones */}
                                    <div className="px-3.5 py-3 bg-slate-50/70 dark:bg-slate-900/40 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
                                        <label className="flex items-center gap-2 text-xs font-bold text-slate-700 dark:text-slate-200 cursor-pointer select-none">
                                            <input
                                                type="checkbox"
                                                checked={sumStock}
                                                onChange={(e) => setSumStockByGroup((prev) => ({ ...prev, [group.id]: e.target.checked }))}
                                                className="accent-emerald-600 w-4 h-4 rounded"
                                            />
                                            <span>Sumar existencias al artículo principal</span>
                                        </label>

                                        <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-0.5">
                                            <p>
                                                Stock final de <strong>«{keep.name}»</strong>:{' '}
                                                <strong className="text-slate-800 dark:text-white">
                                                    {roundStock(keep.stock)} → {roundStock(preview?.merged?.stock)}
                                                </strong>
                                            </p>
                                            {newAlts.length > 0 && (
                                                <p>Códigos alternos que se agregan: <strong>{newAlts.join(', ')}</strong></p>
                                            )}
                                        </div>

                                        <div className="flex flex-wrap items-center justify-end gap-2 pt-1">
                                            {tab !== 'ignored' && group.kind === 'name' && onIgnoreGroup && (
                                                <button
                                                    type="button"
                                                    disabled={isBusy}
                                                    onClick={() => onIgnoreGroup(group.signature)}
                                                    className="px-3 py-2 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 flex items-center gap-1.5 disabled:opacity-50"
                                                >
                                                    <EyeOff size={13} />
                                                    <span>Son artículos distintos</span>
                                                </button>
                                            )}
                                            <button
                                                type="button"
                                                disabled={isBusy}
                                                onClick={() => handleMerge(group, keep.id, absorbed.map((a) => a.id), sumStock)}
                                                data-testid={`merge-btn-${group.id}`}
                                                className="px-4 py-2 rounded-xl text-xs font-black text-white bg-emerald-600 hover:bg-emerald-700 shadow-sm active:scale-95 flex items-center gap-1.5 disabled:opacity-50"
                                            >
                                                <GitMerge size={14} />
                                                <span>{isBusy ? 'Fusionando…' : 'Fusionar en el principal'}</span>
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </Modal>
    );
}
