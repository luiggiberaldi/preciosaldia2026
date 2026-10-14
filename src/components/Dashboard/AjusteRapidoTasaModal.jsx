import React, { useState } from 'react';
import {
    X,
    TrendingUp,
    RefreshCw,
    SlidersHorizontal,
    Check,
    Coins,
} from 'lucide-react';
import { formatBs, formatCop } from '../../utils/calculatorUtils';
import { useRateContext } from '../../context/RateContext';
import { showToast } from '../Toast';

/**
 * AjusteRapidoTasaModal — Modal rápido para sincronizar tasas oficiales y configurar tasa manual.
 */
export default function AjusteRapidoTasaModal({
    isOpen,
    onClose,
    triggerHaptic,
}) {
    const {
        rates,
        rateMode,
        setRateMode,
        customRate,
        setCustomRate,
        copEnabled,
        autoCopEnabled,
        setAutoCopEnabled,
        tasaCopManual,
        setTasaCopManual,
        updateData,
    } = useRateContext();

    const [selectedMode, setSelectedMode] = useState(rateMode || 'bcv');
    const [localCustomRate, setLocalCustomRate] = useState(customRate || '');
    const [localCopManual, setLocalCopManual] = useState(tasaCopManual || '');
    const [localAutoCop, setLocalAutoCop] = useState(autoCopEnabled);
    const [isRefreshing, setIsRefreshing] = useState(false);

    if (!isOpen) return null;

    const handleSyncBcv = async () => {
        triggerHaptic?.();
        setIsRefreshing(true);
        try {
            if (updateData) {
                await updateData(false);
                showToast('Tasas sincronizadas con éxito', 'success');
            } else {
                showToast('Servicio de sincronización no disponible', 'warning');
            }
        } catch (e) {
            console.error('Error sincronizando tasas:', e);
            showToast('No se pudo conectar con el servicio de tasas', 'error');
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleSave = () => {
        triggerHaptic?.();

        if (selectedMode === 'manual') {
            const parsed = parseFloat(localCustomRate);
            if (!parsed || parsed <= 0) {
                showToast('Ingresa un valor válido para la tasa manual', 'warning');
                return;
            }
            setCustomRate(localCustomRate);
        }

        setRateMode(selectedMode);

        if (copEnabled) {
            setAutoCopEnabled(localAutoCop);
            if (!localAutoCop && localCopManual) {
                setTasaCopManual(localCopManual);
            }
        }

        showToast('Tasa de cambio aplicada', 'success');
        onClose();
    };

    const formatSyncDate = (iso) => {
        if (!iso) return 'Desconocida';
        try {
            const d = new Date(iso);
            if (isNaN(d.getTime())) return 'Desconocida';
            return `${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true })}`;
        } catch {
            return 'Desconocida';
        }
    };

    return (
        <div
            className="fixed inset-0 z-[200] bg-slate-900/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-4 overflow-y-auto animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-slate-900 rounded-[1.75rem] max-w-md w-full shadow-2xl border border-slate-100 dark:border-slate-800 p-5 sm:p-6 my-auto max-h-[92vh] flex flex-col justify-between overflow-y-auto animate-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-start justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
                    <div className="flex items-center gap-3">
                        <div className="w-11 h-11 bg-brand-light dark:bg-surface-800/30 rounded-2xl flex items-center justify-center shrink-0">
                            <SlidersHorizontal size={20} className="text-brand" />
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-slate-800 dark:text-white leading-tight">
                                Actualizar y Ajustar Tasa
                            </h3>
                            <p className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">
                                Sincroniza con el BCV o fija una tasa manual
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={onClose}
                        className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
                        aria-label="Cerrar modal"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Body Content */}
                <div className="py-4 space-y-4">
                    {/* Tarjeta de Sincronización Rápida con BCV */}
                    <div className="bg-slate-50 dark:bg-slate-800/50 rounded-2xl p-4 border border-slate-100 dark:border-slate-700/60 flex items-center justify-between gap-3">
                        <div>
                            <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">
                                Sincronización Oficial BCV
                            </span>
                            <span className="text-xl font-black text-slate-800 dark:text-white font-outfit">
                                {formatBs(rates?.bcv?.price || 0)} <span className="text-xs font-bold text-slate-400">Bs/$</span>
                            </span>
                            <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-0.5">
                                Última sync: {formatSyncDate(rates?.lastUpdate)}
                            </p>
                        </div>
                        <button
                            type="button"
                            onClick={handleSyncBcv}
                            disabled={isRefreshing}
                            className="py-2.5 px-3.5 bg-brand hover:bg-brand-dark text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-md shadow-brand/20 active:scale-95 transition-all disabled:opacity-50 shrink-0"
                        >
                            <RefreshCw size={14} className={isRefreshing ? 'animate-spin' : ''} />
                            <span>{isRefreshing ? 'Consultando...' : 'Actualizar'}</span>
                        </button>
                    </div>

                    {/* Selector de Modo de Tasa */}
                    <div>
                        <label className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2 block pl-1">
                            Tasa activa para ventas y cobros
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            {[
                                {
                                    id: 'bcv',
                                    label: 'BCV Oficial',
                                    val: rates?.bcv?.price ? `${formatBs(rates.bcv.price)} Bs` : '...',
                                },
                                {
                                    id: 'euro',
                                    label: 'Euro BCV',
                                    val: rates?.euro?.price ? `${formatBs(rates.euro.price)} Bs` : 'No disp.',
                                },
                                {
                                    id: 'usdt',
                                    label: 'USDT / Mercado',
                                    val: rates?.usdt?.price ? `${formatBs(rates.usdt.price)} Bs` : 'No disp.',
                                },
                                {
                                    id: 'manual',
                                    label: 'Manual',
                                    val: localCustomRate && parseFloat(localCustomRate) > 0 ? `${formatBs(parseFloat(localCustomRate))} Bs` : 'Fijar valor',
                                },
                            ].map((opt) => {
                                const isSelected = selectedMode === opt.id;
                                return (
                                    <button
                                        key={opt.id}
                                        type="button"
                                        onClick={() => {
                                            triggerHaptic?.();
                                            setSelectedMode(opt.id);
                                        }}
                                        className={`p-3 rounded-xl border text-left transition-all active:scale-[0.98] relative ${
                                            isSelected
                                                ? 'bg-brand/5 dark:bg-brand/10 border-brand text-brand'
                                                : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200/60 dark:border-slate-700/60 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                                        }`}
                                    >
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-[11px] font-bold uppercase tracking-wider">
                                                {opt.label}
                                            </span>
                                            {isSelected && <Check size={14} className="text-brand" />}
                                        </div>
                                        <span className="text-sm font-black font-outfit block">
                                            {opt.val}
                                        </span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>

                    {/* Campo de Tasa Manual (si 'manual' está seleccionado) */}
                    {selectedMode === 'manual' && (
                        <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-800/50 rounded-2xl p-3.5 space-y-2 animate-in fade-in duration-200">
                            <label className="text-[11px] font-bold text-amber-800 dark:text-amber-300 uppercase tracking-wider block">
                                Valor de tasa personalizada (Bs por $1 USD)
                            </label>
                            <div className="relative flex items-center">
                                <span className="absolute left-3 text-xs font-bold text-amber-600 dark:text-amber-400">
                                    Bs
                                </span>
                                <input
                                    type="number"
                                    step="any"
                                    inputMode="decimal"
                                    value={localCustomRate}
                                    onChange={(e) => setLocalCustomRate(e.target.value)}
                                    placeholder={rates?.bcv?.price ? String(rates.bcv.price) : '0.00'}
                                    autoFocus
                                    className="w-full bg-white dark:bg-slate-900 border border-amber-300 dark:border-amber-700 rounded-xl py-2 pl-9 pr-3 text-sm font-bold text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-amber-500/20 font-mono"
                                />
                            </div>
                            <p className="text-[10px] text-amber-700 dark:text-amber-400">
                                Todos los precios en bolívares se calcularán con este valor fijo.
                            </p>
                        </div>
                    )}

                    {/* Configuración de Pesos COP (si está habilitado) */}
                    {copEnabled && (
                        <div className="bg-slate-50 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/60 rounded-2xl p-3.5 space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                                    <Coins size={14} className="text-amber-500" /> Tasa COP / USD
                                </span>
                                <div className="flex items-center gap-2">
                                    <span className="text-[11px] font-bold text-slate-400">
                                        {localAutoCop ? 'TRM Auto' : 'Manual'}
                                    </span>
                                    <button
                                        type="button"
                                        onClick={() => setLocalAutoCop(!localAutoCop)}
                                        className={`w-10 h-5 rounded-full transition-colors relative p-0.5 ${
                                            localAutoCop ? 'bg-amber-500' : 'bg-slate-300 dark:bg-slate-600'
                                        }`}
                                    >
                                        <div
                                            className={`w-4 h-4 bg-white rounded-full transition-transform ${
                                                localAutoCop ? 'translate-x-5' : 'translate-x-0'
                                            }`}
                                        />
                                    </button>
                                </div>
                            </div>
                            {!localAutoCop && (
                                <input
                                    type="number"
                                    step="any"
                                    value={localCopManual}
                                    onChange={(e) => setLocalCopManual(e.target.value)}
                                    placeholder="4150"
                                    className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl py-2 px-3 text-sm font-bold text-slate-800 dark:text-white outline-none focus:border-amber-500 focus:ring-2 focus:ring-amber-500/20 font-mono"
                                />
                            )}
                        </div>
                    )}
                </div>

                {/* Footer Actions */}
                <div className="pt-3 border-t border-slate-100 dark:border-slate-800 flex gap-2">
                    <button
                        type="button"
                        onClick={onClose}
                        className="flex-1 py-2.5 px-4 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-xl text-xs transition-colors"
                    >
                        Cancelar
                    </button>
                    <button
                        type="button"
                        onClick={handleSave}
                        className="flex-1 py-2.5 px-4 bg-brand hover:bg-brand-dark text-white font-bold rounded-xl text-xs shadow-md shadow-brand/20 active:scale-95 transition-all flex items-center justify-center gap-1.5"
                    >
                        <Check size={14} />
                        <span>Guardar y Aplicar</span>
                    </button>
                </div>
            </div>
        </div>
    );
}
