import React, { useState } from 'react';
import { Wallet, X, Check } from 'lucide-react';

/**
 * Aporte de efectivo a la caja durante el turno. El permiso (solo admin con login)
 * y la validación de montos y motivo viven en `useCheckoutFlow.handleSaveAporte`.
 */
export default function AporteCajaModal({ isOpen, onClose, onConfirm, copEnabled, copPrimary }) {
    const [usd, setUsd] = useState('');
    const [bs, setBs] = useState('');
    const [cop, setCop] = useState('');
    const [motivo, setMotivo] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);

    if (!isOpen) return null;

    const reset = () => {
        setUsd('');
        setBs('');
        setCop('');
        setMotivo('');
    };

    const handleConfirm = async () => {
        setIsSubmitting(true);
        try {
            const ok = await onConfirm({
                aporteUsd: usd,
                aporteBs: bs,
                aporteCop: copEnabled ? cop : 0,
                motivo,
            });
            if (ok) reset();
        } finally {
            setIsSubmitting(false);
        }
    };

    const inputClass = 'w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/30 transition-all';

    const copField = (
        <div>
            <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Efectivo en Pesos (COP)</label>
            <input type="number" inputMode="decimal" placeholder="0.00" value={cop} onChange={e => setCop(e.target.value)} className={inputClass} />
        </div>
    );

    return (
        <div
            className="fixed inset-0 z-[200] bg-black/60 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4 animate-in fade-in duration-200"
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-slate-900 w-full sm:max-w-sm rounded-t-[2rem] sm:rounded-[2rem] p-6 shadow-2xl animate-in slide-in-from-bottom-6 duration-250"
                onClick={e => e.stopPropagation()}
            >
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
                            <Wallet size={18} className="text-emerald-600 dark:text-emerald-400" />
                        </div>
                        <div>
                            <h2 className="text-lg font-black text-slate-800 dark:text-white">Aporte de Efectivo</h2>
                            <p className="text-xs text-slate-400">Dinero que entra a la caja durante el turno</p>
                        </div>
                    </div>
                    <button onClick={onClose} aria-label="Cerrar" className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all">
                        <X size={18} />
                    </button>
                </div>

                <div className="space-y-4">
                    {copEnabled && copPrimary && copField}

                    <div>
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Efectivo en Dólares ($)</label>
                        <input type="number" inputMode="decimal" placeholder="0.00" value={usd} onChange={e => setUsd(e.target.value)} className={inputClass} />
                    </div>

                    <div>
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Efectivo en Bolívares (Bs)</label>
                        <input type="number" inputMode="decimal" placeholder="0.00" value={bs} onChange={e => setBs(e.target.value)} className={inputClass} />
                    </div>

                    {copEnabled && !copPrimary && copField}

                    <div>
                        <label className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Motivo (obligatorio)</label>
                        <input type="text" maxLength={200} placeholder="Ej. cambio de monedas" value={motivo} onChange={e => setMotivo(e.target.value)} className={inputClass} />
                    </div>

                    <div className="flex gap-3 pt-1">
                        <button onClick={onClose} className="flex-1 py-3 text-sm font-bold text-slate-500 bg-slate-100 dark:bg-slate-800 rounded-xl hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-95 transition-all">
                            Cancelar
                        </button>
                        <button
                            onClick={handleConfirm}
                            disabled={isSubmitting}
                            className="flex-[2] py-3 flex items-center justify-center gap-2 bg-emerald-500 hover:bg-emerald-600 text-white font-black text-sm rounded-xl active:scale-95 transition-all shadow-md shadow-emerald-500/20 disabled:opacity-60"
                        >
                            <Check size={16} />
                            Registrar Aporte
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
