import React from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Plus, Search, X } from 'lucide-react';

export default function SupervisorInventoryToolbar({
    searchTerm = '',
    onSearchChange,
    onOpenBatch,
    onNewProduct,
    filter = 'todos',
    onFilterChange,
    counts = {},
    canMutate = false,
    canCreateProduct = false,
    triggerHaptic,
}) {
    const run = (callback, value) => {
        triggerHaptic?.();
        callback?.(value);
    };

    return (
        <div className="space-y-3 rounded-3xl border border-slate-200/60 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
                <div className="relative min-w-0 flex-1">
                    <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="search"
                        aria-label="Buscar producto por nombre o código"
                        placeholder="Buscar producto por nombre o código..."
                        value={searchTerm}
                        onChange={(event) => onSearchChange?.(event.target.value)}
                        className="min-h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-10 text-xs text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-emerald-500/70 dark:border-slate-800 dark:bg-slate-950 dark:text-white"
                    />
                    {searchTerm && (
                        <button type="button" aria-label="Limpiar búsqueda" onClick={() => onSearchChange?.('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-white">
                            <X size={15} />
                        </button>
                    )}
                </div>
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                    <button
                        type="button"
                        onClick={() => run(onOpenBatch, 'ingreso')}
                        disabled={!canMutate}
                        title={!canMutate ? 'Conecta la caja para registrar una recepción' : 'Registrar recepción de mercancía'}
                        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 px-3 text-xs font-black text-white shadow-md transition hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <ArrowDownToLine size={16} />
                        Recepción rápida
                    </button>
                    <button
                        type="button"
                        onClick={() => run(onOpenBatch, 'egreso')}
                        disabled={!canMutate}
                        title={!canMutate ? 'Conecta la caja para registrar un egreso' : 'Registrar egreso de inventario'}
                        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-2xl border border-rose-200 bg-rose-50 px-3 text-xs font-black text-rose-700 transition hover:bg-rose-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300"
                    >
                        <ArrowUpFromLine size={16} />
                        Egreso rápido
                    </button>
                    <button
                        type="button"
                        onClick={() => run(onNewProduct)}
                        disabled={!canCreateProduct}
                        className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-2xl bg-blue-600 px-3 text-xs font-black text-white shadow-md transition hover:bg-blue-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Plus size={16} />
                        Nuevo producto
                    </button>
                </div>
            </div>
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filtros de inventario">
                {[
                    ['todos', `Todos (${counts.total || 0})`],
                    ['bajo', `Bajo stock (${counts.low || 0})`],
                    ['agotado', `Agotados (${counts.out || 0})`],
                    ['movidos', `Movidos (${counts.moved || 0})`],
                ].map(([value, label]) => (
                    <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={filter === value}
                        onClick={() => run(onFilterChange, value)}
                        className={`min-h-10 rounded-xl px-3 text-[10px] font-black transition ${filter === value ? 'bg-slate-900 text-white dark:bg-white dark:text-slate-900' : 'bg-slate-100 text-slate-500 hover:bg-slate-200 dark:bg-slate-950 dark:text-slate-400 dark:hover:bg-slate-800'}`}
                    >
                        {label}
                    </button>
                ))}
            </div>
        </div>
    );
}
