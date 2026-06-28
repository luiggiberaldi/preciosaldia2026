import React, { useState, useEffect } from 'react';
import { RefreshCw, ShoppingCart, Keyboard } from 'lucide-react';
import Tooltip from '../Tooltip';
import { pushLocalSync } from '../../hooks/useCloudSync';

const formatBs = (n) => new Intl.NumberFormat('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);

export default function SalesHeader({
    effectiveRate,
    rateMode,
    setRateMode,
    rates,
    useAutoRate,
    setUseAutoRate,
    customRate,
    setCustomRate,
    showRateConfig,
    setShowRateConfig,
    setShowKeyboardHelp,
    triggerHaptic,
    copEnabled,
    copPrimary,
    tasaCop,
    autoCopEnabled,
    setAutoCopEnabled,
    tasaCopManual,
    setTasaCopManual,
}) {
    const isCopMode = copEnabled && copPrimary && tasaCop > 0;

    // Local states to prevent realtime cloud loopbacks from clearing/deleting input values on keystroke
    const [localCustomRate, setLocalCustomRate] = useState(customRate || '');
    const [localTasaCop, setLocalTasaCop] = useState(tasaCopManual || '');

    // Reset local states to context values when modal is toggled
    useEffect(() => {
        if (showRateConfig) {
            setLocalCustomRate(customRate || '');
            setLocalTasaCop(tasaCopManual || '');
        }
    }, [showRateConfig, customRate, tasaCopManual]);

    const handleRateToggle = () => {
        setShowRateConfig(!showRateConfig);
    };

    // When copPrimary: toggle controls autoCopEnabled; otherwise useAutoRate
    const isAuto = isCopMode ? autoCopEnabled : useAutoRate;
    const handleAutoToggle = () => {
        triggerHaptic && triggerHaptic();
        if (isCopMode) {
            const newVal = !autoCopEnabled;
            setAutoCopEnabled(newVal);
            localStorage.setItem('auto_cop_enabled', newVal.toString());
        } else {
            setUseAutoRate(!useAutoRate);
        }
    };

    const handleConfirmRate = () => {
        triggerHaptic && triggerHaptic();
        if (isCopMode) {
            if (!isAuto && localTasaCop) {
                setTasaCopManual(localTasaCop);
                localStorage.setItem('tasa_cop', localTasaCop);
                pushLocalSync('tasa_cop', parseFloat(localTasaCop));
            }
        } else {
            if (rateMode === 'manual' && localCustomRate) {
                setCustomRate(localCustomRate);
            }
        }
        setShowRateConfig(false);
    };

    return (
        <div className="shrink-0 mb-3 bg-white dark:bg-slate-900 rounded-2xl sm:rounded-3xl p-3 sm:p-4 shadow-sm border border-slate-100 dark:border-slate-800">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-2 mb-3">
                <div className="flex justify-between items-center">
                    <h2 className="text-xl sm:text-2xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-2">
                        <div className="bg-emerald-500 text-white p-1.5 sm:p-2 rounded-xl shadow-lg shadow-emerald-500/30">
                            <ShoppingCart size={20} className="sm:w-[22px] sm:h-[22px]" />
                        </div>
                        Punto de Venta
                    </h2>
                    {/* Tasa Móvil (visible solo en sm) */}
                    <div className="sm:hidden">
                        <button
                            onClick={handleRateToggle}
                            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border transition-all bg-slate-50 border-slate-200 hover:border-emerald-500 hover:bg-emerald-50 active:scale-95 dark:bg-slate-800 dark:border-slate-700"
                        >
                            <RefreshCw size={12} className={showRateConfig ? (isCopMode ? "text-amber-500" : "text-emerald-500") : "text-slate-400"} />
                            {isCopMode
                                ? <strong className="text-xs text-amber-600 dark:text-amber-400">{Math.round(tasaCop).toLocaleString('es-CO')}</strong>
                                : <strong className="text-xs text-emerald-600 dark:text-emerald-400">{formatBs(effectiveRate)}</strong>
                            }
                            {!isAuto && <span className="text-[8px] bg-brand-light dark:bg-surface-800/30 text-brand-dark dark:text-brand px-1 rounded font-bold">MAN</span>}
                        </button>
                    </div>
                </div>

                {/* Tasa Desktop y Botones (oculto en sm) */}
                <div className="hidden sm:flex items-center gap-2">
                    <button
                        onClick={() => setShowKeyboardHelp(true)}
                        className="hidden md:flex items-center gap-1.5 bg-brand-light dark:bg-surface-800/20 text-brand-dark dark:text-brand px-3 py-1.5 rounded-xl transition-colors hover:bg-brand-light dark:hover:bg-surface-800/40"
                    >
                        <Keyboard size={14} />
                        <span className="text-xs font-bold">Atajos (PC)</span>
                    </button>

                    <Tooltip text={isCopMode ? `Tasa COP/USD: ${Math.round(tasaCop).toLocaleString('es-CO')}` : (rateMode === 'bcv' ? "Tasa oficial (BCV)" : rateMode === 'euro' ? "Tasa oficial (Euro BCV)" : rateMode === 'usdt' ? "Tasa oficial (Dólar USDT)" : "Usando tasa manual fijada por ti")} position="bottom">
                        <button
                            onClick={handleRateToggle}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-all group bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-emerald-500 hover:shadow-sm"
                        >
                            {isCopMode ? (
                                <>
                                    <span className="text-xs text-slate-500 dark:text-slate-400 font-bold flex items-center gap-1.5">
                                        <RefreshCw size={12} className={showRateConfig ? "text-amber-500" : "group-hover:text-amber-500"} />
                                        COP:
                                    </span>
                                    <strong className="text-sm text-amber-600 dark:text-amber-400">{Math.round(tasaCop).toLocaleString('es-CO')} $/USD</strong>
                                </>
                            ) : (
                                <>
                                    <span className="text-xs text-slate-500 dark:text-slate-400 font-bold flex items-center gap-1.5">
                                        <RefreshCw size={12} className={showRateConfig ? "text-emerald-500" : "group-hover:text-emerald-500"} />
                                        {(() => {
                                            const labels = { bcv: 'BCV:', euro: 'EUR:', usdt: 'USDT:', manual: 'TASA:' };
                                            return labels[rateMode] || 'BCV:';
                                        })()}
                                    </span>
                                    <strong className="text-sm text-emerald-600 dark:text-emerald-400">{formatBs(effectiveRate)} Bs</strong>
                                </>
                            )}
                            {!isAuto && <span className="text-[10px] bg-brand-light dark:bg-surface-800/30 text-brand-dark dark:text-brand px-1 rounded-md font-bold">MAN</span>}
                        </button>
                    </Tooltip>
                </div>
            </div>

            {/* Rate Config Panel */}
            {showRateConfig && (
                <div className="bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200/80 dark:border-slate-800 p-4 mb-3 animate-in fade-in slide-in-from-top-2">
                    <div className="max-w-md mx-auto w-full space-y-4">
                        {isCopMode ? (
                            /* COP Mode rate selector */
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-xs font-bold text-slate-500">Tasa COP/USD</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[11px] font-bold text-slate-400">
                                            {isAuto ? <span className="text-amber-500">Auto TRM</span> : <span>Manual</span>}
                                        </span>
                                        <button onClick={handleAutoToggle}
                                            className={`relative w-10 h-6 rounded-full transition-colors ${isAuto ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600'}`}>
                                            <span className={`absolute top-1 left-1 bg-white w-4 h-4 rounded-full transition-transform ${isAuto ? 'translate-x-4' : 'translate-x-0'}`} />
                                        </button>
                                    </div>
                                </div>
                                {!isAuto && (
                                    <input 
                                        type="number" 
                                        value={localTasaCop} 
                                        onChange={(e) => setLocalTasaCop(e.target.value)}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') handleConfirmRate();
                                        }}
                                        className="w-full p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-sm font-bold outline-none focus:ring-2 text-amber-600 dark:text-amber-400 focus:border-amber-500 focus:ring-amber-500/20"
                                        placeholder="Tasa COP por 1 USD (ej: 4150)" 
                                        autoFocus 
                                    />
                                )}
                            </div>
                        ) : (
                            /* Premium compact visual rate selector for BS mode */
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] font-black uppercase tracking-wider text-slate-400 block">Tasa de Referencia</span>
                                </div>
                                
                                <div className="bg-slate-100 dark:bg-slate-900 p-1 rounded-xl flex gap-1 w-full border border-slate-200/50 dark:border-slate-800/50">
                                    {[
                                        { id: 'bcv', label: 'BCV', val: rates?.bcv?.price ? `${formatBs(rates.bcv.price)}` : '...' },
                                        { id: 'euro', label: 'Euro', val: rates?.euro?.price ? `${formatBs(rates.euro.price)}` : 'No disp.' },
                                        { id: 'usdt', label: 'USDT', val: rates?.usdt?.price ? `${formatBs(rates.usdt.price)}` : 'No disp.' },
                                        { id: 'manual', label: 'Manual', val: customRate && parseFloat(customRate) > 0 ? `${formatBs(parseFloat(customRate))}` : 'Manual' },
                                    ].map((opt) => {
                                        const isActive = rateMode === opt.id;
                                        return (
                                            <button
                                                key={opt.id}
                                                type="button"
                                                onClick={() => {
                                                    triggerHaptic && triggerHaptic();
                                                    setRateMode(opt.id);
                                                }}
                                                className={`flex-1 py-1.5 px-0.5 rounded-lg text-center transition-all duration-200 active:scale-[0.97] ${
                                                    isActive
                                                        ? 'bg-white dark:bg-slate-800 text-emerald-600 dark:text-emerald-400 shadow-sm font-bold border border-slate-200/50 dark:border-slate-700/50'
                                                        : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 font-semibold'
                                                }`}
                                            >
                                                <span className={`block text-[8px] font-black uppercase tracking-wider ${isActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-slate-400'}`}>
                                                    {opt.label}
                                                </span>
                                                <span className="block text-[10px] sm:text-[11px] font-black mt-0.5 tabular-nums leading-tight">
                                                    {opt.val} {opt.val !== '...' && opt.val !== 'No disp.' && opt.val !== 'Manual' && 'Bs'}
                                                </span>
                                            </button>
                                        );
                                    })}
                                </div>

                                {rateMode === 'manual' && (
                                    <div className="space-y-1.5 animate-in fade-in duration-200 pt-1">
                                        <span className="text-[9px] font-black uppercase tracking-wider text-slate-400 block">Fijar Tasa Personalizada (Bs)</span>
                                        <input
                                            type="number"
                                            value={localCustomRate}
                                            onChange={(e) => setLocalCustomRate(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') handleConfirmRate();
                                            }}
                                            className="w-full p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs font-bold outline-none focus:ring-2 focus:border-emerald-500 focus:ring-emerald-500/20 text-slate-800 dark:text-white"
                                            placeholder="Ingresa la tasa manual (ej: 42.50)"
                                            autoFocus
                                        />
                                    </div>
                                )}
                            </div>
                        )}
                        <button
                            onClick={handleConfirmRate}
                            className={`w-full py-2.5 text-white font-black text-xs rounded-xl shadow-sm active:scale-95 transition-all ${isCopMode ? 'bg-amber-500 hover:bg-amber-600 shadow-amber-500/20' : 'bg-emerald-500 hover:bg-emerald-600 shadow-emerald-500/20'}`}
                        >
                            Aceptar
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
