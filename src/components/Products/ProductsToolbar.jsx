import React, { useState, useEffect } from 'react';
import { Store, Plus, Trash2, Pencil, Search, LayoutGrid, List, Percent, CheckSquare } from 'lucide-react';
import { CATEGORY_COLORS } from '../../config/categories';

const ProductsToolbar = ({
    products,
    categories,
    activeCategory,
    searchTerm,
    viewMode,
    selectedIds,
    lowStockCount,
    isCajero,
    categoryScrollRef,
    // Handlers
    handleSetSearchTerm,
    handleSetActiveCategory,
    toggleViewMode,
    setSelectedIds,
    setIsModalOpen,
    setIsBulkPriceOpen,
    setIsDeleteAllModalOpen,
    setIsCategoryManagerOpen,
    triggerHaptic,
    onSelectAllToast,
}) => {
    const [showLeftFade, setShowLeftFade] = useState(false);

    const handleScroll = (e) => {
        setShowLeftFade(e.target.scrollLeft > 4);
    };

    // Wheel → scroll horizontal en el carril de categorías sin advertencia de evento pasivo
    useEffect(() => {
        const el = categoryScrollRef?.current;
        if (!el) return;
        const handler = (e) => {
            if (e.deltaY !== 0) {
                e.preventDefault();
                el.scrollLeft += e.deltaY;
            }
        };
        el.addEventListener('wheel', handler, { passive: false });
        return () => el.removeEventListener('wheel', handler);
    }, [categoryScrollRef]);

    // Helper to get count of products in a category
    const getCategoryProductCount = (catId) => {
        if (catId === 'todos') return products.length;
        return products.filter(p => p.category === catId).length;
    };

    return (
        <div className="shrink-0 mb-2.5 space-y-1.5">
            {/* Row 1: Title & Stats + Search (desktop inline) + Actions & Toggle */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1.5 sm:gap-2">
                {/* Title & Stats */}
                <div className="flex items-center justify-between sm:justify-start gap-2 min-w-0">
                    <div className="flex items-center gap-1.5 min-w-0">
                        <Store size={20} className="text-brand shrink-0" />
                        <h2 className="text-base sm:text-lg font-black text-slate-800 dark:text-white tracking-tight truncate">
                            Inventario
                        </h2>
                        <span className="text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 px-1.5 py-0.5 rounded-full shrink-0">
                            {products.length} uds
                        </span>
                    </div>

                    {/* Mobile Only: Actions & Toggle inline to save vertical space */}
                    <div className="flex items-center gap-1 sm:hidden">
                        {products.length > 0 && !isCajero && (
                            <>
                                <button onClick={() => { triggerHaptic && triggerHaptic(); setIsBulkPriceOpen(true); }}
                                    className="p-1.5 bg-brand-light dark:bg-surface-800/30 text-brand dark:text-brand rounded-lg transition-all active:scale-95" title="Ajuste Masivo">
                                    <Percent size={14} strokeWidth={2.5} />
                                </button>
                                <button onClick={() => { triggerHaptic && triggerHaptic(); setIsDeleteAllModalOpen(true); }}
                                    className="p-1.5 bg-red-50 dark:bg-red-900/30 text-red-500 dark:text-red-400 rounded-lg transition-all active:scale-95" title="Borrar Todo">
                                    <Trash2 size={14} strokeWidth={2.5} />
                                </button>
                            </>
                        )}
                        {!isCajero && (
                            <button onClick={() => { triggerHaptic && triggerHaptic(); setIsModalOpen(true); }}
                                className="flex items-center gap-1 px-2.5 py-1.5 bg-brand hover:bg-brand-dark text-white rounded-lg transition-all active:scale-95 font-bold text-xs" title="Agregar">
                                <Plus size={14} strokeWidth={2.5} />
                                <span>Nuevo</span>
                            </button>
                        )}
                        <button
                            onClick={toggleViewMode}
                            className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-brand hover:border-brand-light transition-all active:scale-95"
                            title={viewMode === 'grid' ? 'Vista lista' : 'Vista cuadrícula'}
                        >
                            {viewMode === 'grid' ? <List size={14} /> : <LayoutGrid size={14} />}
                        </button>
                    </div>
                </div>

                {/* Search Bar (Centered/flexible on desktop, full width on mobile) */}
                <div className="relative flex-1 max-w-none sm:max-w-md md:max-w-lg">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                        type="text"
                        placeholder="Buscar producto..."
                        value={searchTerm}
                        onChange={(e) => handleSetSearchTerm(e.target.value)}
                        className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg py-1.5 pl-8 pr-3 text-xs text-slate-700 dark:text-white outline-none focus:ring-1.5 focus:ring-brand/50 shadow-sm"
                    />
                </div>

                {/* Desktop Only: Actions & Toggle */}
                <div className="hidden sm:flex items-center gap-1 shrink-0">
                    {products.length > 0 && !isCajero && (
                        <>
                            <button onClick={() => { triggerHaptic && triggerHaptic(); setIsBulkPriceOpen(true); }}
                                className="p-1.5 bg-brand-light dark:bg-surface-800/30 text-brand dark:text-brand rounded-lg transition-all active:scale-95" title="Ajuste Masivo de Precios">
                                <Percent size={14} strokeWidth={2.5} />
                            </button>
                            <button onClick={() => { triggerHaptic && triggerHaptic(); setIsDeleteAllModalOpen(true); }}
                                className="p-1.5 bg-red-50 dark:bg-red-900/30 text-red-500 dark:text-red-400 rounded-lg transition-all active:scale-95" title="Borrar Todo">
                                <Trash2 size={14} strokeWidth={2.5} />
                            </button>
                        </>
                    )}
                    {!isCajero && (
                        <button onClick={() => { triggerHaptic && triggerHaptic(); setIsModalOpen(true); }}
                            className="flex items-center gap-1 px-3 py-1.5 bg-brand hover:bg-brand-dark text-white rounded-lg shadow-sm transition-all active:scale-95 font-bold text-xs" title="Agregar">
                            <Plus size={14} strokeWidth={2.5} />
                            <span>Nuevo</span>
                        </button>
                    )}
                    <button
                        onClick={toggleViewMode}
                        className="p-1.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-500 dark:text-slate-400 hover:text-brand hover:border-brand-light transition-all active:scale-95"
                        title={viewMode === 'grid' ? 'Cambiar a vista lista' : 'Cambiar a vista cuadrícula'}
                    >
                        {viewMode === 'grid' ? <List size={14} /> : <LayoutGrid size={14} />}
                    </button>
                </div>
            </div>

            {/* Row 2: Select All & Low Stock Toggles */}
            <div className="flex items-center gap-1.5 flex-wrap shrink-0">
                <button
                    onClick={() => { triggerHaptic && triggerHaptic(); setSelectedIds(new Set(products.map(p => p.id))); onSelectAllToast && onSelectAllToast(); }}
                    className="text-[9px] font-bold bg-brand/10 text-brand px-2 py-1 rounded-md flex items-center gap-1 cursor-pointer hover:bg-brand/20 transition-colors active:scale-95"
                >
                    <CheckSquare size={10} /> <span>Seleccionar todo</span>
                </button>
                {lowStockCount > 0 && (
                    <button
                        onClick={() => { handleSetActiveCategory('bajo-stock'); triggerHaptic && triggerHaptic(); }}
                        className="text-[9px] font-bold bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400 px-2 py-1 rounded-md flex items-center gap-1 cursor-pointer hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors">
                        ⚠️ {lowStockCount} bajo stock
                    </button>
                )}
            </div>

            {/* Row 3: Category Filter Pills — horizontal scroll with left/right fade */}
            <div className="relative w-full py-0.5 pr-8">
                <div 
                    ref={categoryScrollRef}
                    className="flex gap-1 overflow-x-auto py-1 pl-1 pr-10 scrollbar-hide scroll-smooth"
                    onScroll={handleScroll}
                >
                    {/* Pestaña estática para la categoría 'Todos' */}
                    <button
                        onClick={() => { handleSetActiveCategory('todos'); triggerHaptic && triggerHaptic(); }}
                        className={`shrink-0 px-2 py-1 rounded-md text-[10px] font-bold transition-all border ${
                            activeCategory === 'todos'
                                ? 'bg-brand text-white border-brand shadow-sm border-transparent font-black'
                                : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 active:scale-95'
                        }`}
                    >
                        Todos
                        <span className={`ml-1 text-[9px] ${activeCategory === 'todos' ? 'opacity-90' : 'text-slate-400 dark:text-slate-500'}`}>
                            · {getCategoryProductCount('todos')}
                        </span>
                    </button>

                    {categories.map(cat => {
                        const count = getCategoryProductCount(cat.id);
                        const isActive = activeCategory === cat.id;
                        const catColorClass = CATEGORY_COLORS[cat.color] || 'bg-brand text-white border-brand';
                        
                        return (
                            <button
                                key={cat.id}
                                onClick={() => { handleSetActiveCategory(cat.id); triggerHaptic && triggerHaptic(); }}
                                className={`shrink-0 px-2 py-1 rounded-md text-[10px] font-bold transition-all border ${
                                    isActive
                                        ? `${catColorClass} shadow-sm border-transparent font-black`
                                        : 'bg-white dark:bg-slate-900 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 active:scale-95'
                                }`}
                            >
                                {cat.label}
                                <span className={`ml-1 text-[9px] ${isActive ? 'opacity-90' : 'text-slate-400 dark:text-slate-500'}`}>
                                    · {count}
                                </span>
                            </button>
                        );
                    })}
                    {/* Spacer to prevent clipping by the fade overlay and Pencil button */}
                    <div className="shrink-0 w-10 h-px" />
                </div>

                {/* Edit Categories Icon Button */}
                <button
                    onClick={() => { triggerHaptic && triggerHaptic(); setIsCategoryManagerOpen(true); }}
                    className="absolute right-0 top-1/2 -translate-y-1/2 p-1.5 rounded-md bg-slate-100 dark:bg-slate-850 hover:bg-slate-200 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-all active:scale-95 flex items-center justify-center border border-transparent z-10 shadow-sm"
                    title="Gestionar Categorías"
                >
                    <Pencil size={11} />
                </button>

                {/* Left fade indicator for scroll (appears only when scrolled to the right) */}
                {showLeftFade && (
                    <div className="pointer-events-none absolute left-0 top-0 bottom-0 w-6 bg-gradient-to-r from-slate-50 dark:from-slate-950 to-transparent z-10 animate-in fade-in duration-200" />
                )}

                {/* Right fade indicator for scroll */}
                <div className="pointer-events-none absolute right-7 top-0 bottom-0 w-6 bg-gradient-to-l from-slate-50 dark:from-slate-950 to-transparent z-10" />
            </div>
        </div>
    );
};

export default ProductsToolbar;
