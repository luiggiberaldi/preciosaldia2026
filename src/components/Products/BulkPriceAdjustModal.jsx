import React, { useState, useMemo, useRef, useEffect } from 'react';
import { X, TrendingUp, TrendingDown, Percent, Check, AlertTriangle } from 'lucide-react';
import { logEvent } from '../../services/auditService';
import { useAuthStore } from '../../hooks/store/useAuthStore';
import CustomSelect from '../CustomSelect';

export default function BulkPriceAdjustModal({
    isOpen,
    onClose,
    products,
    setProducts,
    categories,
    activeCategory,
    effectiveRate,
    triggerHaptic,
    showToast,
    copEnabled,
    copPrimary,
    tasaCop,
}) {
    const [direction, setDirection] = useState('up'); // 'up' | 'down'
    const [percent, setPercent] = useState(10);
    const [selectedCategory, setSelectedCategory] = useState('todos');
    const [isApplying, setIsApplying] = useState(false);
    const [showSuccess, setShowSuccess] = useState(false);
    const timeoutRefs = useRef([]);

    useEffect(() => {
        return () => timeoutRefs.current.forEach(id => clearTimeout(id));
    }, []);

    const categoryOptions = useMemo(() => {
        return [
            { value: 'todos', label: `Todos los productos (${products.length})` },
            ...categories
                .filter(c => c.id !== 'todos')
                .map(cat => {
                    const count = products.filter(p => p.category === cat.id).length;
                    return count > 0 ? { value: cat.id, label: `${cat.label} (${count})` } : null;
                })
                .filter(Boolean)
        ];
    }, [products, categories]);

    const effectivePercent = direction === 'up' ? percent : -percent;
    const multiplier = 1 + effectivePercent / 100;

    // Products that will be affected
    const affectedProducts = (products || []).filter(p => {
        if (selectedCategory === 'todos') return true;
        return p.category === selectedCategory;
    });

    // Preview samples (up to 3 random products)
    const previewSamples = useMemo(() => {
        const shuffled = [...affectedProducts].sort(() => 0.5 - Math.random());
        return shuffled.slice(0, 3).map(p => ({
            name: p.name,
            oldPrice: p.priceUsdt || 0,
            newPrice: Math.max(0.01, (p.priceUsdt || 0) * multiplier),
        }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [affectedProducts.length, multiplier, selectedCategory]);

    if (!isOpen) return null;

    const handleApply = () => {
        if (affectedProducts.length === 0) return;
        triggerHaptic && triggerHaptic();
        setIsApplying(true);

        // Small delay for UX feel
        timeoutRefs.current.push(setTimeout(() => {
            setProducts(prev =>
                prev.map(p => {
                    const isTarget = selectedCategory === 'todos' || p.category === selectedCategory;
                    if (!isTarget) return p;

                    const newPrice = Math.max(0.01, (p.priceUsdt || 0) * multiplier);
                    const updated = { ...p, priceUsdt: parseFloat(newPrice.toFixed(4)) };

                    // Also adjust unitPriceUsd if it exists
                    if (p.unitPriceUsd && p.unitPriceUsd > 0) {
                        updated.unitPriceUsd = parseFloat((p.unitPriceUsd * multiplier).toFixed(4));
                    }

                    return updated;
                })
            );

            setIsApplying(false);
            setShowSuccess(true);

            const label = direction === 'up' ? `+${percent}%` : `-${percent}%`;
            showToast && showToast(`Precios ajustados ${label} en ${affectedProducts.length} productos`, 'success');
            const user = useAuthStore.getState().usuarioActivo;
            logEvent('INVENTARIO', 'AJUSTE_MASIVO_PRECIOS', `Ajuste masivo ${label} en ${affectedProducts.length} productos (cat: ${selectedCategory})`, user);

            timeoutRefs.current.push(setTimeout(() => {
                setShowSuccess(false);
                handleClose();
            }, 1200));
        }, 400));
    };

    const handleClose = () => {
        setDirection('up');
        setPercent(10);
        setSelectedCategory('todos');
        setIsApplying(false);
        setShowSuccess(false);
        onClose();
    };

    const isUp = direction === 'up';
    const accentColor = isUp ? 'emerald' : 'red';

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 animate-in fade-in duration-200">
            {/* Backdrop */}
            <div className="absolute inset-0 bg-slate-900/70 backdrop-blur-sm" onClick={handleClose} />

            {/* Modal */}
            <div
                className="relative bg-white dark:bg-slate-900 w-full max-w-md rounded-[2rem] shadow-2xl border border-slate-100 dark:border-slate-800 animate-in zoom-in-95 duration-200"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="px-6 py-4 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50/50 dark:bg-slate-800/50">
                    <div className="flex items-center gap-2.5">
                        <div className={`w-8 h-8 rounded-xl flex items-center justify-center ${isUp ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-red-100 dark:bg-red-900/30'} transition-colors duration-300`}>
                            <Percent size={16} className={`${isUp ? 'text-emerald-600' : 'text-red-500'} transition-colors duration-300`} />
                        </div>
                        <h3 className="font-black text-slate-800 dark:text-white text-lg tracking-tight">Ajuste Masivo</h3>
                    </div>
                    <button onClick={handleClose} className="p-1.5 bg-slate-200 dark:bg-slate-700 rounded-full text-slate-500 hover:text-red-500 transition-colors">
                        <X size={16} strokeWidth={3} />
                    </button>
                </div>

                {/* Body */}
                <div className="p-6 space-y-5 max-h-[75vh] overflow-y-auto">

                    {/* Success overlay */}
                    {showSuccess && (
                        <div className="absolute inset-0 bg-white/90 dark:bg-slate-900/90 z-10 flex flex-col items-center justify-center animate-in fade-in duration-300">
                            <div className="w-20 h-20 rounded-full bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center mb-4 animate-in zoom-in duration-300">
                                <Check size={40} className="text-emerald-500" strokeWidth={3} />
                            </div>
                            <p className="text-lg font-black text-slate-800 dark:text-white">Precios Actualizados</p>
                        </div>
                    )}

                    {/* Direction Toggle */}
                    <div>
                        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">Tipo de Ajuste</label>
                        <div className="grid grid-cols-2 gap-2 bg-slate-50 dark:bg-slate-800/50 p-1.5 rounded-2xl">
                            <button
                                onClick={() => { setDirection('up'); triggerHaptic && triggerHaptic(); }}
                                className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all duration-300 ${
                                    isUp
                                        ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/25'
                                        : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                                }`}
                            >
                                <TrendingUp size={16} /> Subir
                            </button>
                            <button
                                onClick={() => { setDirection('down'); triggerHaptic && triggerHaptic(); }}
                                className={`flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-bold transition-all duration-300 ${
                                    !isUp
                                        ? 'bg-red-500 text-white shadow-lg shadow-red-500/25'
                                        : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                                }`}
                            >
                                <TrendingDown size={16} /> Bajar
                            </button>
                        </div>
                    </div>

                    {/* Percentage */}
                    <div>
                        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">Porcentaje</label>
                        <div className="flex items-center gap-4">
                            <div className="flex-1 relative">
                                <input
                                    type="range"
                                    min={1}
                                    max={direction === 'down' ? 50 : 100}
                                    value={percent}
                                    onChange={e => setPercent(parseInt(e.target.value))}
                                    className="w-full h-2 rounded-full appearance-none cursor-pointer"
                                    style={{
                                        background: `linear-gradient(to right, ${isUp ? '#10b981' : '#ef4444'} 0%, ${isUp ? '#10b981' : '#ef4444'} ${(percent / (direction === 'down' ? 50 : 100)) * 100}%, #e2e8f0 ${(percent / (direction === 'down' ? 50 : 100)) * 100}%, #e2e8f0 100%)`,
                                    }}
                                />
                            </div>
                            <div className="relative">
                                <input
                                    type="number"
                                    min={1}
                                    max={direction === 'down' ? 50 : 100}
                                    value={percent}
                                    onChange={e => {
                                        const val = parseInt(e.target.value) || 0;
                                        const max = direction === 'down' ? 50 : 100;
                                        setPercent(Math.min(Math.max(1, val), max));
                                    }}
                                    className={`w-20 text-center bg-white dark:bg-slate-800 border-2 rounded-xl py-2.5 text-lg font-black outline-none transition-colors duration-300 ${
                                        isUp
                                            ? 'border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400 focus:border-emerald-500'
                                            : 'border-red-200 dark:border-red-800 text-red-500 dark:text-red-400 focus:border-red-500'
                                    }`}
                                />
                                <span className={`absolute right-2.5 top-1/2 -translate-y-1/2 text-xs font-bold ${isUp ? 'text-emerald-400' : 'text-red-400'}`}>%</span>
                            </div>
                        </div>
                        {/* Quick presets */}
                        <div className="flex gap-1.5 mt-2.5">
                            {(direction === 'up' ? [5, 10, 15, 20, 30, 50] : [5, 10, 15, 20, 30, 50]).map(p => (
                                <button
                                    key={p}
                                    onClick={() => { setPercent(p); triggerHaptic && triggerHaptic(); }}
                                    className={`flex-1 py-1.5 rounded-lg text-[11px] font-bold transition-all active:scale-95 ${
                                        percent === p
                                            ? (isUp ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400' : 'bg-red-100 dark:bg-red-900/30 text-red-500 dark:text-red-400')
                                            : 'bg-slate-50 dark:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300'
                                    }`}
                                >
                                    {p}%
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Category filter */}
                    <div>
                        <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 block">Aplicar a</label>
                        <CustomSelect
                            value={selectedCategory}
                            onChange={setSelectedCategory}
                            options={categoryOptions}
                        />
                    </div>

                    {/* Preview */}
                    {affectedProducts.length > 0 && (
                        <div className={`rounded-2xl p-4 border transition-colors duration-300 ${
                            isUp
                                ? 'bg-emerald-50/50 dark:bg-emerald-900/10 border-emerald-100 dark:border-emerald-900/30'
                                : 'bg-red-50/50 dark:bg-red-900/10 border-red-100 dark:border-red-900/30'
                        }`}>
                            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-3">
                                Vista Previa ({affectedProducts.length} productos)
                            </p>
                            <div className="space-y-2">
                                {previewSamples.map((s, i) => (
                                    <div key={i} className="flex items-center justify-between bg-white/80 dark:bg-slate-800/80 rounded-xl px-3 py-2">
                                        <span className="text-xs font-bold text-slate-600 dark:text-slate-300 truncate mr-3 max-w-[45%]">{s.name}</span>
                                        <div className="flex items-center gap-2 shrink-0">
                                            <span className="text-xs text-slate-400 line-through">{copEnabled && copPrimary && tasaCop > 0 ? `${Math.round(s.oldPrice * tasaCop).toLocaleString('es-CO')} COP` : `$${s.oldPrice.toFixed(2)}`}</span>
                                            <span className="text-xs font-bold">&rarr;</span>
                                            <span className={`text-sm font-black ${isUp ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'}`}>
                                                {copEnabled && copPrimary && tasaCop > 0 ? `${Math.round(s.newPrice * tasaCop).toLocaleString('es-CO')} COP` : `$${s.newPrice.toFixed(2)}`}
                                            </span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {affectedProducts.length > 3 && (
                                <p className="text-[10px] text-slate-400 text-center mt-2">
                                    ...y {affectedProducts.length - 3} productos mas
                                </p>
                            )}
                        </div>
                    )}

                    {/* Warning for large adjustments */}
                    {percent >= 30 && (
                        <div className="flex items-start gap-2.5 bg-amber-50 dark:bg-amber-900/10 border border-amber-200 dark:border-amber-800/30 rounded-xl px-3 py-2.5">
                            <AlertTriangle size={16} className="text-amber-500 shrink-0 mt-0.5" />
                            <p className="text-[11px] text-amber-600 dark:text-amber-400 font-medium">
                                Ajuste mayor al 30%. Verifica que los precios resultantes sean correctos.
                            </p>
                        </div>
                    )}

                    {affectedProducts.length === 0 && (
                        <div className="text-center py-6">
                            <p className="text-sm text-slate-400 font-medium">No hay productos en esta categoria</p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 flex gap-3 rounded-b-[2rem]">
                    <button
                        onClick={handleClose}
                        className="flex-1 py-3.5 bg-white dark:bg-slate-800 border-2 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-white font-bold rounded-xl active:scale-[0.98] transition-all"
                    >
                        Cancelar
                    </button>
                    <button
                        onClick={handleApply}
                        disabled={affectedProducts.length === 0 || isApplying}
                        className={`flex-1 py-3.5 text-white font-bold rounded-xl active:scale-[0.98] transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed shadow-lg ${
                            isUp
                                ? 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/25'
                                : 'bg-red-500 hover:bg-red-600 shadow-red-500/25'
                        }`}
                    >
                        {isApplying ? (
                            <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        ) : (
                            <>
                                {isUp ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
                                Aplicar {isUp ? '+' : '-'}{percent}% ({affectedProducts.length})
                            </>
                        )}
                    </button>
                </div>
            </div>

            {/* Custom slider thumb styles */}
            <style>{`
                input[type="range"]::-webkit-slider-thumb {
                    -webkit-appearance: none;
                    appearance: none;
                    width: 22px;
                    height: 22px;
                    border-radius: 50%;
                    background: white;
                    border: 3px solid ${isUp ? '#10b981' : '#ef4444'};
                    cursor: pointer;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
                    transition: border-color 0.3s;
                }
                input[type="range"]::-moz-range-thumb {
                    width: 22px;
                    height: 22px;
                    border-radius: 50%;
                    background: white;
                    border: 3px solid ${isUp ? '#10b981' : '#ef4444'};
                    cursor: pointer;
                    box-shadow: 0 2px 6px rgba(0,0,0,0.15);
                    transition: border-color 0.3s;
                }
            `}</style>
        </div>
    );
}
