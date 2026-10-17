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

    const filterOptions = [
        ['todos', `Todos (${counts.total || 0})`],
        ['bajo', `Bajo stock (${counts.low || 0})`],
        ['agotado', `Agotados (${counts.out || 0})`],
        ['movidos', `Movidos (${counts.moved || 0})`],
    ];

    if ((counts.negative || 0) > 0) {
        filterOptions.push(['negativo', `Negativos (${counts.negative})`]);
    }

    const getPillClasses = (val) => {
        const isActive = filter === val;
        const base = 'shrink-0 min-h-9 sm:min-h-10 rounded-xl px-3 py-1.5 text-[10px] sm:text-xs font-black transition-all';
        if (!isActive) {
            return `${base} text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/50 dark:hover:bg-slate-800/50`;
        }
        switch (val) {
            case 'bajo':
                return `${base} bg-amber-500 text-white shadow-sm shadow-amber-500/20`;
            case 'agotado':
                return `${base} bg-rose-500 text-white shadow-sm shadow-rose-500/20`;
            case 'negativo':
                return `${base} bg-rose-600 text-white shadow-sm shadow-rose-600/20`;
            case 'movidos':
                return `${base} bg-emerald-600 text-white shadow-sm shadow-emerald-500/20`;
            case 'todos':
            default:
                return `${base} bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm`;
        }
    };

    return (
        <div className="space-y-3 rounded-3xl border border-slate-200/60 bg-white p-3.5 sm:p-5 shadow-sm dark:border-slate-800 dark:bg-slate-900">
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
                        className="col-span-1 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-2xl bg-emerald-600 px-3 text-xs font-black text-white shadow-md transition hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <ArrowDownToLine size={16} />
                        Recepción rápida
                    </button>
                    <button
                        type="button"
                        onClick={() => run(onOpenBatch, 'egreso')}
                        disabled={!canMutate}
                        title={!canMutate ? 'Conecta la caja para registrar un egreso' : 'Registrar egreso de inventario'}
                        className="col-span-1 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-2xl border border-rose-200 bg-rose-50 px-3 text-xs font-black text-rose-700 transition hover:bg-rose-100 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50 dark:border-rose-900/50 dark:bg-rose-950/20 dark:text-rose-300"
                    >
                        <ArrowUpFromLine size={16} />
                        Egreso rápido
                    </button>
                    <button
                        type="button"
                        onClick={() => run(onNewProduct)}
                        disabled={!canCreateProduct}
                        className="col-span-2 sm:col-span-1 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-2xl bg-blue-600 px-3 text-xs font-black text-white shadow-md transition hover:bg-blue-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                        <Plus size={16} />
                        Nuevo producto
                    </button>
                </div>
            </div>
            <div
                className="bg-slate-100 dark:bg-slate-950 p-1 rounded-2xl border border-slate-200/60 dark:border-slate-850 overflow-x-auto w-full md:w-auto shrink-0 shadow-inner flex items-center gap-1 scrollbar-hide"
                role="tablist"
                aria-label="Filtros de inventario"
            >
                {filterOptions.map(([value, label]) => (
                    <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={filter === value}
                        onClick={() => run(onFilterChange, value)}
                        className={getPillClasses(value)}
                    >
                        {label}
                    </button>
                ))}
            </div>
        </div>
    );
}
