import React, { useState } from 'react';
import {
    ArrowUpRight,
    RefreshCw,
    SlidersHorizontal,
    ChevronRight,
} from 'lucide-react';
import { formatBs } from '../../utils/calculatorUtils';
import { useRateContext } from '../../context/RateContext';
import { showToast } from '../Toast';
import AjusteRapidoTasaModal from './AjusteRapidoTasaModal';

/**
 * TasaOficialCard — Tarjeta de Tasa de Cambio en el Dashboard.
 *
 * Muestra la tasa oficial activa del negocio (BCV, Manual, Euro o USDT) y ofrece
 * un botón de actualización y ajuste para sincronizar con el BCV o fijar una tasa
 * manual sin salir del dashboard.
 */
export default function TasaOficialCard({
    bcvRate: propBcvRate = 1,
    copEnabled: propCopEnabled = false,
    tasaCop: propTasaCop = 0,
    triggerHaptic,
}) {
    const {
        effectiveRate,
        rateMode,
        rates,
        updateData,
        copEnabled: ctxCopEnabled,
        tasaCop: ctxTasaCop,
    } = useRateContext();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const activeRate = effectiveRate || propBcvRate || 1;
    const copEnabled = ctxCopEnabled ?? propCopEnabled;
    const tasaCop = ctxTasaCop || propTasaCop;

    const handleQuickSync = async (e) => {
        e?.stopPropagation?.();
        triggerHaptic?.();
        setIsRefreshing(true);
        try {
            if (updateData) {
                await updateData(false);
                showToast('Tasa BCV actualizada', 'success');
            } else {
                showToast('Servicio de actualización no disponible', 'warning');
            }
        } catch (err) {
            console.error('Error al actualizar tasa:', err);
            showToast('Error al conectar con el servicio de tasas', 'error');
        } finally {
            setIsRefreshing(false);
        }
    };

    const formatLastUpdate = (isoString) => {
        if (!isoString) return '';
        try {
            const date = new Date(isoString);
            if (isNaN(date.getTime())) return '';
            return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
        } catch {
            return '';
        }
    };

    const syncTime = formatLastUpdate(rates?.lastUpdate);

    return (
        <>
            <div className="min-h-full bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-100 dark:border-slate-800 shadow-sm flex flex-col justify-between">
                <div>
                    {/* Header */}
                    <div className="flex items-center justify-between mb-2">
                        <h3 className="text-xs font-bold text-slate-400 uppercase flex items-center gap-1.5">
                            <ArrowUpRight size={13} className="text-brand" /> Tasa de Cambio
                        </h3>
                        <div className="flex items-center gap-1.5">
                            <span
                                className={`inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    rateMode === 'manual'
                                        ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-200/50 dark:border-amber-800/30'
                                        : rateMode === 'euro'
                                        ? 'bg-purple-50 dark:bg-purple-950/40 text-purple-600 dark:text-purple-400 border border-purple-200/50 dark:border-purple-800/30'
                                        : rateMode === 'usdt'
                                        ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 border border-emerald-200/50 dark:border-emerald-800/30'
                                        : 'bg-brand/10 text-brand border border-brand/20'
                                }`}
                            >
                                {rateMode === 'manual'
                                    ? 'Manual'
                                    : rateMode === 'euro'
                                    ? 'Euro BCV'
                                    : rateMode === 'usdt'
                                    ? 'USDT'
                                    : 'BCV Oficial'}
                            </span>
                            <button
                                type="button"
                                onClick={handleQuickSync}
                                disabled={isRefreshing}
                                className="p-1 text-slate-400 hover:text-brand dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors disabled:opacity-50"
                                title="Sincronizar tasa BCV al instante"
                                aria-label="Sincronizar tasa BCV al instante"
                            >
                                <RefreshCw size={13} className={isRefreshing ? 'animate-spin text-brand' : ''} />
                            </button>
                        </div>
                    </div>

                    {/* Main Rate Value */}
                    <div className="mt-1">
                        <div className="text-2xl font-outfit font-black text-slate-800 dark:text-white leading-none">
                            {formatBs(activeRate)} <span className="text-xs font-bold text-slate-400">Bs/$</span>
                        </div>
                        <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1 flex items-center gap-1">
                            <span>
                                {rateMode === 'manual'
                                    ? 'Tasa fijada manualmente'
                                    : rateMode === 'euro'
                                    ? 'Tasa Euro BCV'
                                    : rateMode === 'usdt'
                                    ? 'Tasa USDT mercado'
                                    : 'Tasa oficial BCV'}
                            </span>
                            {syncTime && (
                                <>
                                    <span>·</span>
                                    <span>{syncTime}</span>
                                </>
                            )}
                        </p>
                        {copEnabled && tasaCop > 0 && (
                            <span className="inline-block text-xs font-bold text-amber-600 dark:text-amber-400 mt-1.5">
                                {tasaCop.toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP/$
                            </span>
                        )}
                    </div>
                </div>

                {/* Bottom Action Button */}
                <button
                    type="button"
                    onClick={() => {
                        triggerHaptic?.();
                        setIsModalOpen(true);
                    }}
                    className="w-full mt-3 py-2 px-3 bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200/60 dark:border-slate-700/60 rounded-xl text-xs font-bold flex items-center justify-between group active:scale-[0.98] transition-all"
                    aria-label="Actualizar o ajustar tasa"
                >
                    <span className="flex items-center gap-2">
                        <SlidersHorizontal size={14} className="text-brand group-hover:scale-110 transition-transform" />
                        <span>Actualizar / Ajustar Tasa</span>
                    </span>
                    <ChevronRight size={14} className="text-slate-400 group-hover:translate-x-0.5 transition-transform" />
                </button>
            </div>

            <AjusteRapidoTasaModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                triggerHaptic={triggerHaptic}
            />
        </>
    );
}
