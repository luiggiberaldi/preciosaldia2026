import { useState, useEffect, useRef } from 'react';
import { Package, Calculator, ChevronDown, Clock, HelpCircle, Trash2 } from 'lucide-react';
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
}) {
    const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
    const categoryScrollRef = useRef(null);
    const [showHoldsDropdown, setShowHoldsDropdown] = useState(false);

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
            <div className="shrink-0 flex items-center justify-between gap-2 mb-2 relative">
                {/* Izquierda: acciones de venta */}
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <button
                            onClick={() => {
                                triggerHaptic && triggerHaptic();
                                if (pendingCartsCount > 0) {
                                    setShowHoldsDropdown(v => !v);
                                } else {
                                    onHoldCart?.();
                                }
                            }}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-orange-200 dark:border-orange-800/50 bg-orange-50 dark:bg-orange-900/20 text-orange-600 dark:text-orange-400 text-[10px] font-black uppercase tracking-wide hover:bg-orange-100 transition-all active:scale-95"
                        >
                            <Clock size={11} /> ESPERA
                            {pendingCartsCount > 0 && (
                                <span className="bg-orange-500 text-white rounded-full w-4 h-4 flex items-center justify-center text-[8px] font-black">
                                    {pendingCartsCount}
                                </span>
                            )}
                        </button>

                        {/* Holds Dropdown */}
                        {showHoldsDropdown && pendingCartsCount > 0 && (
                            <div className="absolute left-0 top-full mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xl z-30 min-w-[200px] overflow-hidden py-1">
                                <div className="px-2.5 py-1.5 border-b border-slate-100 dark:border-slate-800 text-[9px] font-bold text-slate-400 uppercase tracking-widest flex justify-between items-center">
                                    <span>Ventas en espera</span>
                                    <button onClick={() => { onHoldCart?.(); setShowHoldsDropdown(false); }} className="text-orange-500 hover:text-orange-600 font-black">+ GUARDAR</button>
                                </div>
                                {pendingCarts.map((h, i) => (
                                    <button
                                        key={h.id}
                                        onClick={() => {
                                            onRestoreHold(h.id);
                                            setShowHoldsDropdown(false);
                                        }}
                                        className="w-full text-left px-3 py-2 text-xs hover:bg-orange-50 dark:hover:bg-orange-950/20 text-slate-700 dark:text-slate-200 font-bold border-b border-slate-50 dark:border-slate-800/30 last:border-0 flex items-center justify-between"
                                    >
                                        <span>Cola #{i + 1} ({h.items.length} prod.)</span>
                                        <span className="text-[10px] text-slate-400 font-normal">
                                            {new Date(h.id).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </div>
                    <button className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border border-blue-200 dark:border-blue-800/50 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 text-[10px] font-black uppercase tracking-wide hover:bg-blue-100 transition-all active:scale-95">
                        <HelpCircle size={11} /> AYUDA (?)
                    </button>
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
