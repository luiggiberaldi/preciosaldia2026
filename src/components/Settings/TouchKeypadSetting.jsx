import { Keyboard } from 'lucide-react';
import { SectionCard } from '../SettingsShared';
import { setTouchMode, useTouchModeSetting, detectsTouchScreen } from '../../hooks/useCoarsePointer';

/**
 * Teclado numérico del cobro (pantallas táctiles). COBRO fase 7.
 * Automático: sale solo si el equipo es táctil. Siempre / Nunca lo fuerzan.
 * Es de cada equipo (localStorage `pda_touch_mode`), no se copia a otras cajas.
 */
export default function TouchKeypadSetting({ triggerHaptic, showToast }) {
    const touchMode = useTouchModeSetting();
    return (
        <SectionCard icon={Keyboard} title="Teclado numérico en el cobro" subtitle="Teclas grandes para cobrar con el dedo" iconColor="text-violet-500">
            <div className="space-y-2">
                <p className="text-xs text-slate-500 dark:text-slate-400">
                    Sale debajo de los métodos de pago y evita que se abra el teclado de Windows.
                    Automático: aparece solo en pantallas táctiles.
                    {touchMode === 'auto' && (detectsTouchScreen()
                        ? ' Este equipo es táctil, así que se mostrará.'
                        : ' Este equipo no informa pantalla táctil, así que no se mostrará.')}
                </p>
                <div role="group" aria-label="Teclado numérico en el cobro" className="flex flex-wrap gap-1.5">
                    {[['auto', 'Automático'], ['on', 'Siempre'], ['off', 'Nunca']].map(([id, label]) => (
                        <button
                            key={id}
                            type="button"
                            aria-pressed={touchMode === id}
                            onClick={() => {
                                setTouchMode(id);
                                triggerHaptic?.();
                                showToast?.(`Teclado numérico: ${label}`, 'success');
                            }}
                            className={`min-h-[36px] rounded-xl px-3 py-1.5 text-xs font-black transition-colors ${touchMode === id
                                ? 'bg-brand text-white'
                                : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300'}`}
                        >{label}</button>
                    ))}
                </div>
            </div>
        </SectionCard>
    );
}
