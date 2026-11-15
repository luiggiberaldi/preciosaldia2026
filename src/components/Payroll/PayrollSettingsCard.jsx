import { useState } from 'react';
import { Wallet } from 'lucide-react';
import { SectionCard } from '../SettingsShared';
import { showToast } from '../Toast';
import { GOODS_VALUATION_KEY, GOODS_VALUATIONS, GOODS_VALUATION_LABELS, readGoodsValuation } from '../../utils/payrollModel';

const DESCRIPTIONS = {
    costo: 'Se le descuenta lo que le costó a la bodega.',
    venta: 'Se le descuenta como si lo comprara un cliente.',
};

/**
 * Ajustes › Negocio › Nómina (P-012, F6): a qué precio se descuenta del sueldo
 * la mercancía que se lleva un empleado. Decisión del dueño (15-11-2026): que
 * sea una opción. Vive solo en este equipo y viaja en el respaldo (LS_KEYS).
 */
export default function PayrollSettingsCard({ triggerHaptic }) {
    const [valuation, setValuation] = useState(() => readGoodsValuation());

    const choose = (v) => {
        setValuation(v);
        try { localStorage.setItem(GOODS_VALUATION_KEY, v); } catch { /* sin almacenamiento: queda en memoria */ }
        triggerHaptic?.();
        showToast(`Mercancía de empleados: ${GOODS_VALUATION_LABELS[v].toLowerCase()}`, 'success');
    };

    return (
        <SectionCard icon={Wallet} title="Nómina" subtitle="Mercancía que se lleva un empleado" iconColor="text-brand">
            <div className="space-y-2">
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Cuando un empleado se lleva productos, se restan de su sueldo a este precio:
                </p>
                <div className="grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Precio de la mercancía de empleados">
                    {GOODS_VALUATIONS.map(v => (
                        <button
                            key={v}
                            type="button"
                            role="radio"
                            aria-checked={valuation === v}
                            data-testid={`payroll-valuation-${v}`}
                            onClick={() => choose(v)}
                            className={`py-2.5 px-2 text-left rounded-xl transition-all border ${valuation === v
                                ? 'bg-brand-light dark:bg-brand/10 border-brand text-brand-dark dark:text-brand shadow-sm'
                                : 'bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                            }`}
                        >
                            <span className="block text-xs font-black">{GOODS_VALUATION_LABELS[v]}</span>
                            <span className="block text-[10px] mt-0.5 opacity-80">{DESCRIPTIONS[v]}</span>
                        </button>
                    ))}
                </div>
            </div>
        </SectionCard>
    );
}
