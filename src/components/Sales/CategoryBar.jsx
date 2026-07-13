import { useState, useEffect, useRef } from 'react';
import { Package, Calculator, ChevronDown, Clock, HelpCircle, Trash2, X } from 'lucide-react';
import { BODEGA_CATEGORIES, CATEGORY_ICONS, CATEGORY_COLORS } from '../../config/categories';
import { formatCop, formatBs, getCop, getUsd } from '../../utils/calculatorUtils';

const PAGE_SIZE = 30;

export default function CategoryBar({
    selectedCategory,
    setSelectedCategory,
    filteredByCategory,
    addToCart,
    triggerHaptic,
    searchTerm = '',
    onOpenCustomAmount,
    products = [],
    copEnabled,
    copPrimary,
    tasaCop,
    effectiveRate,
    categories = [],
    // Nuevos props:
    onClearCart,
    onHoldCart,
    pendingCartsCount,
    onRestoreHold,
    pendingCarts = [],
    onOpenHelp,
    onOpenHolds,
    cart = [],
}) {
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const categoryScrollRef = useRef(null);
    const [showNoteInput, setShowNoteInput] = useState(false);
    const [holdNote, setHoldNote] = useState('');

    const handleConfirmHold = () => {
        if (onHoldCart) {
            onHoldCart(holdNote);
        }
        setHoldNote('');
        setShowNoteInput(false);
    };

    // Reset pagination when category changes
    useEffect(() => {
        setVisibleCount(PAGE_SIZE);
    }, [selectedCategory]);

    // Wheel → scroll horizontal sin advertencia de evento pasivo
    useEffect(() => {
        const el = categoryScrollRef.current;
        if (!el) return;
        const handler = (e) => {
            if (e.deltaY !== 0) {
                e.preventDefault();
                el.scrollLeft += e.deltaY;
            }
        };
        el.addEventListener('wheel', handler, { passive: false });
        return () => el.removeEventListener('wheel', handler);
    }, []);

    const visibleProducts = filteredByCategory.slice(0, visibleCount);
    const hasMore = filteredByCategory.length > visibleCount;
    const allowNegativeStock = localStorage.getItem('allow_negative_stock') === 'true';

    // Fallback to static config if no categories passed from context
    const categoryList = categories && categories.length > 0 ? categories : BODEGA_CATEGORIES;

    // Filter categories that have at least one product
    const activeCategories = categoryList.filter(cat => cat.id === 'todos' || products.some(p => p.category === cat.id));

    return (
        <div className={`relative ${searchTerm.length === 0 ? 'lg:flex-1 lg:overflow-hidden lg:flex lg:flex-col lg:min-h-0' : ''}`}>
            
            {/* Category Chips Container with Mask */}
            <div className="relative horizontal-scroll-mask mb-1.5 shrink-0">
                <div
                    ref={categoryScrollRef}
                    className="shrink-0 flex gap-1 overflow-x-auto pb-1.5 pt-1 pl-0.5 pr-12 scrollbar-hide"
                >
                    {/* Monto Libre Button */}
                    <button
                        onClick={() => { triggerHaptic && triggerHaptic(); onOpenCustomAmount && onOpenCustomAmount(); }}
                        className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-black transition-all active:scale-95 bg-brand-light dark:bg-surface-800/30 text-brand-dark dark:text-brand border border-surface-300 dark:border-surface-700 hover:bg-brand-light shadow-sm"
                    >
                        <Calculator size={11} />
                        Monto Libre
                    </button>

                    {/* Divider */}
                    <div className="w-px h-5 bg-slate-200 dark:bg-slate-700 my-auto mx-0.5 rounded-full shrink-0" />

                    {/* Show categories with products */}
                    {activeCategories.map(cat => {
                        const isActive = selectedCategory === cat.id;
                        const count = products.filter(p => cat.id === 'todos' ? true : p.category === cat.id).length;
                        const catColorClass = CATEGORY_COLORS[cat.color] || 'bg-emerald-500 text-white';

                        return (
                            <button
                                key={cat.id}
                                onClick={() => { triggerHaptic && triggerHaptic(); setSelectedCategory(isActive && cat.id !== 'todos' ? 'todos' : cat.id); }}
                                className={`shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-md text-[10px] font-bold transition-all active:scale-95 border ${
                                    isActive
                                        ? `${catColorClass} shadow-sm border-transparent`
                                        : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-brand'
                                }`}
                            >
                                {cat.label}
                                <span className={`text-[8.5px] ${isActive ? 'opacity-90' : 'text-slate-400 dark:text-slate-500'}`}>
                                    · {count}
                                </span>
                            </button>
                        );
                    })}
                    {/* Spacer to prevent clipping on scroll */}
                    <div className="shrink-0 w-10 h-px" />
                </div>
            </div>

            {/* ── BARRA DE ACCIONES RÁPIDAS (Listo POS 2026 Style) ── */}
            <div className="shrink-0 flex items-center justify-between gap-2 mb-2 relative flex-wrap sm:flex-nowrap">
                {/* Izquierda: acciones de venta */}
                <div className="flex items-center gap-2 flex-wrap">
                    <button
                        onClick={() => { triggerHaptic && triggerHaptic(); onOpenHelp && onOpenHelp(); }}
                        className="hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800/50 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-[10px] font-black uppercase tracking-wide hover:bg-blue-100 transition-all active:scale-95"
                    >
                        <HelpCircle size={11} /> AYUDA (?)
                    </button>

                    {/* Botón para abrir la lista de tickets en espera */}
                    {pendingCartsCount > 0 && (
                        <button
                            onClick={() => { triggerHaptic && triggerHaptic(); onOpenHolds && onOpenHolds(); }}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-brand/20 bg-brand-light dark:bg-brand/10 text-brand-dark dark:text-brand text-[10px] font-black uppercase tracking-wide hover:bg-brand/20 transition-all active:scale-95 animate-pulse"
                        >
                            <Clock size={11} className="text-brand" /> EN ESPERA ({pendingCartsCount})
                        </button>
                    )}

                    {/* Botón para estacionar la venta actual (con input en línea) */}
                    {cart.length > 0 && (
                        <div className="relative flex items-center">
                            {showNoteInput ? (
                                <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/40 rounded-full shadow-sm animate-in slide-in-from-left duration-150">
                                    <input
                                        type="text"
                                        placeholder="Nombre o Nota (ej: Mesa 3)"
                                        value={holdNote}
                                        onChange={(e) => setHoldNote(e.target.value)}
                                        className="bg-transparent text-xs font-bold text-amber-900 dark:text-amber-300 outline-none placeholder:text-amber-700/50 dark:placeholder:text-amber-500/40 w-60 sm:w-80 px-1 py-0.5"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleConfirmHold();
                                            if (e.key === 'Escape') { setShowNoteInput(false); setHoldNote(''); }
                                        }}
                                        autoFocus
                                    />
                                    <button
                                        onClick={handleConfirmHold}
                                        className="px-3.5 py-1 bg-amber-500 hover:bg-amber-600 text-[10px] font-black text-white rounded-full transition-all active:scale-95 shadow-sm shadow-amber-500/10 shrink-0"
                                    >
                                        Listo
                                    </button>
                                    <button
                                        onClick={() => { setShowNoteInput(false); setHoldNote(''); }}
                                        className="p-1 text-slate-400 hover:text-slate-600 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-all shrink-0"
                                    >
                                        <X size={12} />
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => { triggerHaptic && triggerHaptic(); setShowNoteInput(true); }}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-amber-200 dark:border-amber-900/50 bg-amber-50 dark:bg-amber-950/20 text-amber-700 dark:text-amber-400 text-[10px] font-black uppercase tracking-wide hover:bg-amber-100 transition-all active:scale-95"
                                    title="Estacionar venta en espera (Atajo: F7)"
                                >
                                    <Clock size={11} /> Estacionar <span className="bg-amber-100 dark:bg-amber-950 text-amber-700 px-1 rounded text-[8px] font-black ml-0.5">F7</span>
                                </button>
                            )}
                        </div>
                    )}
                </div>

                {/* Derecha: Vaciar cesta */}
                <button
                    onClick={onClearCart}
                    className="flex items-center gap-1 text-[10px] font-bold text-slate-400 hover:text-red-500 transition-colors"
                >
                    <Trash2 size={12} /> VACIAR CESTA <span className="bg-slate-100 dark:bg-slate-800 text-slate-400 px-1 rounded text-[8px] font-black">F4</span>
                </button>
            </div>

            {/* Product Grid */}
            {searchTerm.length === 0 && (
                <div className="flex-1 overflow-y-auto min-h-0 pb-2">
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2">
                        {visibleProducts.map(p => {
                            const isOut = (p.stock ?? 0) <= 0;
                            const isDisabled = isOut && !allowNegativeStock;
                            const CatIcon = CATEGORY_ICONS[p.category] || Package;
                            return (
                                <button
                                    key={p.id}
                                    onClick={() => addToCart(p)}
                                    disabled={isDisabled}
                                    className={`relative bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 rounded-2xl p-2.5 flex flex-col text-left transition-all active:scale-95 hover:border-brand/40 hover:shadow-md ${isDisabled ? 'opacity-40 cursor-not-allowed' : ''}`}
                                >
                                    {/* Badge de stock — esquina superior derecha */}
                                    <span className={`absolute top-1.5 right-1.5 border rounded px-1 py-0.5 text-[8px] font-black leading-none
                                        ${isOut
                                            ? 'bg-red-50 text-red-700 border-red-100 dark:bg-red-950/20 dark:text-red-400 dark:border-red-900/50'
                                            : 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-400 dark:border-emerald-800'
                                        }`}
                                    >
                                        {isOut ? 'AGOT.' : `${p.stock ?? 0} UNDS`}
                                    </span>

                                    {/* Imagen centrada */}
                                    <div className="w-full aspect-square rounded-lg bg-slate-50 dark:bg-slate-950 flex items-center justify-center mb-2 overflow-hidden">
                                        {p.image
                                            ? <img src={p.image} className="w-full h-full object-contain" alt={p.name} />
                                            : <CatIcon size={22} className="text-slate-300" />
                                        }
                                    </div>

                                    {/* Nombre: izquierda, 2 líneas */}
                                    <p className="text-[11px] font-bold text-slate-700 dark:text-slate-200 leading-tight line-clamp-2 mb-1.5 min-h-[2.4em]">{p.name}</p>

                                    {/* Precio USD: grande */}
                                    <p className="text-sm font-extrabold text-slate-900 dark:text-white leading-none">
                                        ${getUsd(p, tasaCop).toFixed(2)}
                                    </p>

                                    {/* Precio Bs: pequeño, color brand */}
                                    <p className="text-[10px] font-bold text-brand dark:text-brand mt-0.5 leading-none">
                                        Bs {formatBs(getUsd(p, tasaCop) * (effectiveRate || 0))}
                                    </p>
                                </button>
                            );
                        })}
                    </div>

                    {/* Load More button */}
                    {hasMore && (
                        <div className="flex justify-center mt-3">
                            <button
                                onClick={() => { triggerHaptic && triggerHaptic(); setVisibleCount(prev => prev + PAGE_SIZE); }}
                                className="flex items-center gap-1.5 px-5 py-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-bold text-slate-500 dark:text-slate-400 hover:border-brand hover:text-brand-dark transition-all active:scale-95 shadow-sm"
                            >
                                <ChevronDown size={14} />
                                Cargar Mas ({filteredByCategory.length - visibleCount} restantes)
                            </button>
                        </div>
                    )}

                    {filteredByCategory.length === 0 && (
                        <div className="text-center py-10">
                            <Package size={32} className="mx-auto text-slate-300 dark:text-slate-700 mb-2" />
                            <p className="text-xs text-slate-400 font-medium">Sin productos en esta categoria</p>
                        </div>
                    )}

                    {/* ── FOOTER DE ATAJOS DE TECLADO ── */}
                    <div className="shrink-0 mt-4 flex items-center justify-center gap-3 flex-wrap py-2 border-t border-slate-100 dark:border-slate-800/60">
                        {[
                            { key: 'F2', label: 'BUSCAR' },
                            { key: '*', label: 'CICLAR UNIDAD' },
                            { key: 'ENTER', label: 'AGREGAR' },
                            { key: 'F9', label: 'COBRAR' },
                        ].map(({ key, label }) => (
                            <span key={key} className="flex items-center gap-1 text-[9px] font-bold text-slate-400">
                                <kbd className="bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded px-1.5 py-0.5 font-mono text-slate-500 dark:text-slate-300 shadow-sm">{key}</kbd>
                                {label}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}
