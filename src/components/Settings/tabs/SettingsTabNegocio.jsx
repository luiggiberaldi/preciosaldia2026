import React from 'react';
import { Store, Printer, Coins, Check } from 'lucide-react';
import { SectionCard, Toggle } from '../../SettingsShared';

export default function SettingsTabNegocio({
    businessName, setBusinessName,
    businessRif, setBusinessRif,
    paperWidth, setPaperWidth,
    copEnabled, setCopEnabled,
    autoCopEnabled, setAutoCopEnabled,
    tasaCopManual, setTasaCopManual,
    copPrimary, setCopPrimary,
    calculatedTasaCop,
    handleSaveBusinessData,
    forceHeartbeat,
    showToast,
    triggerHaptic,
}) {
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
            {/* Mi Negocio */}
            <div className="md:col-span-2 xl:col-span-3">
                <SectionCard icon={Store} title="Mi Negocio" subtitle="Datos que aparecen en tickets" iconColor="text-brand">
                    <div className="space-y-4">
                        <div>
                            <label className="text-[11px] uppercase tracking-wider font-extrabold text-slate-500 dark:text-slate-400 block mb-1.5">Nombre del Negocio</label>
                            <input
                                type="text"
                                placeholder="Ej: Mi Bodega C.A."
                                value={businessName}
                                onChange={e => setBusinessName(e.target.value)}
                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30 transition-all"
                            />
                        </div>
                        <div>
                            <label className="text-[11px] uppercase tracking-wider font-extrabold text-slate-500 dark:text-slate-400 block mb-1.5">RIF o Documento</label>
                            <input
                                type="text"
                                placeholder="Ej: J-12345678"
                                value={businessRif}
                                onChange={e => setBusinessRif(e.target.value)}
                                className="w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-brand/30 transition-all"
                            />
                        </div>
                        <button
                            onClick={handleSaveBusinessData}
                            className="w-full flex items-center justify-center gap-2 py-3 bg-brand-light dark:bg-surface-800/20 text-brand-dark dark:text-brand font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-brand-light dark:hover:bg-surface-800/40 transition-colors active:scale-[0.98]"
                        >
                            <Check size={16} /> Guardar
                        </button>
                    </div>
                </SectionCard>
            </div>

            {/* Impresora - Sólo Tamaño de Ticket */}
            <SectionCard icon={Printer} title="Tamaño de Ticket" subtitle="Configuración del ancho de papel" iconColor="text-brand">
                <label className="text-[11px] uppercase tracking-wider font-extrabold text-slate-500 dark:text-slate-400 block mb-1.5">Ancho de Papel</label>
                <div className="grid grid-cols-2 gap-2">
                    {[{ val: '58', label: '58 mm (Pequeña)' }, { val: '80', label: '80 mm (Estándar)' }].map(opt => (
                        <button
                            key={opt.val}
                            onClick={() => { setPaperWidth(opt.val); localStorage.setItem('printer_paper_width', opt.val); triggerHaptic?.(); }}
                            className={`py-2.5 px-3 text-xs font-bold rounded-xl transition-all border ${paperWidth === opt.val
                                ? 'bg-brand-light dark:bg-brand/10 border-brand text-brand-dark dark:text-brand shadow-sm'
                                : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                        >
                            {opt.label}
                        </button>
                    ))}
                </div>
            </SectionCard>

            {/* Monedas COP */}
            <SectionCard icon={Coins} title="Peso Colombiano (COP)" subtitle="Habilitar pagos y calculos en COP" iconColor="text-amber-500">
                <div className="flex items-center justify-between">
                    <div>
                        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Habilitar COP</p>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Pagos y calculos rapidos</p>
                    </div>
                    <Toggle
                        enabled={copEnabled}
                        color="amber"
                        onChange={() => {
                            const newVal = !copEnabled;
                            setCopEnabled(newVal);
                            localStorage.setItem('cop_enabled', newVal.toString());
                            forceHeartbeat();
                            showToast(newVal ? 'COP Habilitado' : 'COP Deshabilitado', 'success');
                            triggerHaptic?.();
                        }}
                    />
                </div>
                {copEnabled && (
                    <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200">COP como Moneda Principal</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Los precios se muestran primero en pesos</p>
                            </div>
                            <Toggle
                                enabled={copPrimary}
                                color="amber"
                                onChange={() => {
                                    const newVal = !copPrimary;
                                    setCopPrimary(newVal);
                                    localStorage.setItem('cop_primary', newVal.toString());
                                    triggerHaptic?.();
                                    showToast(newVal ? 'COP es moneda principal' : 'USD es moneda principal', 'success');
                                }}
                            />
                        </div>
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-[13px] font-bold text-slate-700 dark:text-slate-200">Calcular Automaticamente</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">TRM Oficial + Binance USDT</p>
                            </div>
                            <Toggle
                                enabled={autoCopEnabled}
                                color="amber"
                                onChange={() => {
                                    const newVal = !autoCopEnabled;
                                    setAutoCopEnabled(newVal);
                                    localStorage.setItem('auto_cop_enabled', newVal.toString());
                                    triggerHaptic?.();
                                }}
                            />
                        </div>
                        <div>
                            <label className="text-[11px] uppercase tracking-wider font-extrabold text-slate-500 dark:text-slate-400 block mb-1.5">
                                {autoCopEnabled ? 'Tasa Actual Calculada' : 'Tasa Manual (COP por 1 USD)'}
                            </label>
                            <input
                                type="number"
                                placeholder="Ej: 4150"
                                value={autoCopEnabled ? (calculatedTasaCop > 0 ? calculatedTasaCop.toFixed(2) : '') : tasaCopManual}
                                readOnly={autoCopEnabled}
                                onChange={e => {
                                    if (!autoCopEnabled) {
                                        setTasaCopManual(e.target.value);
                                        localStorage.setItem('tasa_cop', e.target.value);
                                    }
                                }}
                                className={`w-full bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2.5 text-sm font-bold focus:outline-none focus:ring-2 focus:ring-amber-500/30 ${autoCopEnabled ? 'text-slate-400 cursor-not-allowed bg-slate-100 dark:bg-slate-800/80' : 'text-amber-600 dark:text-amber-500'}`}
                            />
                            {autoCopEnabled && (
                                <p className="text-[10px] text-amber-650/80 dark:text-amber-400/80 mt-1.5 font-medium">Se actualiza automaticamente cada 30 segundos.</p>
                            )}
                        </div>
                    </div>
                )}
            </SectionCard>
        </div>
    );
}
