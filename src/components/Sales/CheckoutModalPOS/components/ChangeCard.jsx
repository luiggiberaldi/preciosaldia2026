import { memo, useState } from 'react';
import { AlertTriangle, CheckCircle, DollarSign, Banknote, Shuffle, HandCoins, Wallet, Zap, Sparkles } from 'lucide-react';
import { round2 } from '../../../../utils/dinero';
import AvisoFondoGaveta from '../../AvisoFondoGaveta';

const fmtBs = (n) => round2(n).toLocaleString('es-VE', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * ChangeCard — «¿Cómo entregas el vuelto?» (CASO-056).
 * Cinco opciones de un toque. Solo «En $ y Bs» muestra los dos campos para
 * repartir a mano; ahí el resto puede ir a la billetera o quedarse (propina).
 * Las cuentas las hace el hook (elegirVuelto, handleVueltoDistChange…).
 * Al escribir en un campo, el otro se llena solo con lo que falta (si el cajero no lo
 * cambió a mano); «⚡ Completar» vuelve a llenar un campo con lo que falta.
 */
function ChangeCard({
    cambioUSD, tasaSegura,
    distVueltoUSD, distVueltoBS, handleVueltoDistChange, elegirVuelto, completarVuelto,
    autoCampo = null, restoLoDeja, restoABilletera, sugerido = null,
    isTipDonated, toggleTipDonated, cashKeptUsd,
    isChangeCredited, handleCreditChange, setIsChangeCredited, walletRemainderUsd,
    remainingChangeUsd, remainingChangeBs, clienteSeleccionado,
    currentFloatUsd = null, currentFloatBs = null,
    isTouch = false, onFocusField, activeField = null,
}) {
    const [mixtoAbierto, setMixtoAbierto] = useState(false);
    const usd = Math.max(0, parseFloat(distVueltoUSD) || 0);
    const bs = Math.max(0, parseFloat(distVueltoBS) || 0);
    const full = round2(cambioUSD);
    const todoEnCaja = isTipDonated && cashKeptUsd >= full - 0.009;
    const faltaRepartir = isChangeCredited ? 0 : Math.max(0, remainingChangeUsd);

    let elegida = null;
    if (mixtoAbierto) elegida = 'mixto';
    else if (todoEnCaja) elegida = 'propina';
    else if (sugerido && usd === sugerido.usdPart && bs === sugerido.bsPart && !isChangeCredited && faltaRepartir <= 0.001) elegida = 'sugerido';
    else if (isChangeCredited && usd === 0 && bs === 0 && !isTipDonated) elegida = 'billetera';
    else if (usd > 0 && bs === 0 && !isTipDonated && !isChangeCredited && faltaRepartir <= 0.001) elegida = 'usd';
    else if (bs > 0 && usd === 0 && !isTipDonated && !isChangeCredited && faltaRepartir <= 0.001) elegida = 'bs';
    else if (usd > 0 || bs > 0 || isTipDonated || isChangeCredited) elegida = 'mixto';
    const verCampos = elegida === 'mixto';

    const elegir = (op) => {
        setMixtoAbierto(op === 'mixto');
        elegirVuelto(op);
    };

    const sinCliente = !clienteSeleccionado;
    const opciones = [
        ...(sugerido ? [{ id: 'sugerido', label: `Sugerido: $${sugerido.usdPart} + Bs ${fmtBs(sugerido.bsPart)}`, Icon: Sparkles, tone: 'teal' }] : []),
        { id: 'usd', label: 'Todo en $', Icon: DollarSign, tone: 'emerald' },
        { id: 'bs', label: 'Todo en Bs', Icon: Banknote, tone: 'blue' },
        { id: 'mixto', label: 'En $ y Bs', Icon: Shuffle, tone: 'slate' },
        { id: 'propina', label: 'Lo deja (propina)', Icon: HandCoins, tone: 'amber' },
        { id: 'billetera', label: sinCliente ? 'Billetera: elige cliente' : 'A su billetera', Icon: Wallet, tone: 'brand', off: sinCliente },
    ];
    const toneOn = {
        teal: 'bg-teal-700 border-teal-700 text-white',
        emerald: 'bg-emerald-600 border-emerald-600 text-white',
        blue: 'bg-blue-600 border-blue-600 text-white',
        slate: 'bg-slate-700 border-slate-700 text-white',
        amber: 'bg-amber-500 border-amber-500 text-white',
        brand: 'bg-brand border-brand text-white',
    };
    const toneOff = {
        teal: 'border-teal-400 text-teal-900 dark:text-teal-200',
        emerald: 'border-emerald-300 text-emerald-800 dark:text-emerald-300',
        blue: 'border-blue-300 text-blue-800 dark:text-blue-300',
        slate: 'border-slate-300 text-slate-800 dark:text-slate-200',
        amber: 'border-amber-300 text-amber-800 dark:text-amber-300',
        brand: 'border-brand/40 text-brand-dark dark:text-brand',
    };

    const campo = (moneda) => {
        const esUsd = moneda === 'usd';
        const id = esUsd ? '__vuelto_usd' : '__vuelto_bs';
        return (
            <div className="min-w-0">
                <div className="flex items-center justify-between gap-1 mb-1">
                    <label className={`text-xs font-black ${esUsd ? 'text-emerald-800 dark:text-emerald-300' : 'text-blue-800 dark:text-blue-300'}`}>
                        {esUsd ? 'En dólares' : 'En bolívares'}
                    </label>
                    {completarVuelto && (
                        <button
                            type="button"
                            onClick={() => completarVuelto(moneda)}
                            title="Poner aquí lo que falta del vuelto"
                            aria-label={esUsd ? 'Completar el vuelto en dólares' : 'Completar el vuelto en bolívares'}
                            className={`min-h-[36px] px-2.5 rounded-[10px] border text-[11px] font-black inline-flex items-center gap-0.5 bg-white dark:bg-slate-900 active:scale-95
                                ${esUsd ? 'border-emerald-300 text-emerald-700 dark:text-emerald-300' : 'border-blue-300 text-blue-700 dark:text-blue-300'}`}
                        >
                            <Zap size={12} /> Completar
                        </button>
                    )}
                </div>
                <div className="relative">
                    <span className={`absolute left-3 top-1/2 -translate-y-1/2 text-sm font-black pointer-events-none ${esUsd ? 'text-emerald-600' : 'text-blue-600'}`}>
                        {esUsd ? '$' : 'Bs'}
                    </span>
                    <input
                        type="text"
                        inputMode={isTouch ? 'none' : 'decimal'}
                        value={esUsd ? distVueltoUSD : distVueltoBS}
                        onChange={e => handleVueltoDistChange(moneda, e.target.value)}
                        onFocus={e => { e.target.select(); onFocusField && onFocusField(id); }}
                        placeholder="0"
                        aria-label={esUsd ? 'Vuelto en dólares' : 'Vuelto en bolívares'}
                        className={`w-full h-12 pl-9 ${autoCampo === moneda ? 'pr-11' : 'pr-2'} rounded-xl border-2 bg-white dark:bg-slate-900 font-black text-base outline-none transition-all ${autoCampo === moneda ? 'text-slate-500 dark:text-slate-400 italic' : 'text-slate-800 dark:text-white'}
                            ${activeField === id ? (esUsd ? 'border-emerald-500 ring-2 ring-emerald-500/20' : 'border-blue-500 ring-2 ring-blue-500/20') : (esUsd ? 'border-emerald-300' : 'border-blue-300')}`}
                    />
                    {autoCampo === moneda && (
                        <span title="Se llenó solo con lo que falta" className="absolute right-2 top-1/2 -translate-y-1/2 px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-[10px] font-black text-slate-600 dark:text-slate-300 pointer-events-none">auto</span>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div className="p-3.5 rounded-[16px] border-2 border-emerald-200 dark:border-emerald-800/40 bg-emerald-50 dark:bg-emerald-950/20 shadow-sm" data-testid="pos-change-card">
            {/* Cabecera: en celular muestra el monto (en PC ya está en el resumen) */}
            <div className="flex items-center justify-between gap-2">
                <div>
                    <div className="flex items-baseline gap-1.5 lg:hidden">
                        <span className="text-xs font-black uppercase text-emerald-700">Vuelto</span>
                        <span className="text-xl font-black text-emerald-700 dark:text-emerald-400">${full.toFixed(2)}</span>
                        <span className="text-xs font-bold text-emerald-600">Bs {fmtBs(full * tasaSegura)}</span>
                    </div>
                    <p className="text-sm font-black text-emerald-900 dark:text-emerald-200">¿Cómo entregas el vuelto?</p>
                </div>
                {elegida && elegida !== 'mixto' && (
                    <span className="inline-flex items-center gap-1 text-xs font-black text-emerald-700 dark:text-emerald-300">
                        <CheckCircle size={16} /> Listo
                    </span>
                )}
            </div>

            {/* Opciones de un toque: Sugerido sola arriba (es la más larga), luego 3 y 2 por fila */}
            {(() => {
                const boton = ({ id, label, Icon, tone, off }) => {
                    const on = elegida === id;
                    return (
                        <button
                            key={id}
                            type="button"
                            onClick={() => elegir(id)}
                            aria-pressed={on}
                            className={`min-h-[46px] px-2 xl:px-3 rounded-[12px] border-2 text-[12px] xl:text-[13px] font-black inline-flex items-center justify-center gap-1.5 xl:gap-2 text-center leading-tight transition-all active:scale-95
                                ${on ? toneOn[tone] : `bg-white dark:bg-slate-900 ${toneOff[tone]}`}
                                ${off ? 'opacity-60' : ''}`}
                        >
                            <Icon size={16} className="shrink-0" />
                            <span>{label}</span>
                        </button>
                    );
                };
                const sug = opciones.find(o => o.id === 'sugerido');
                const fila1 = opciones.filter(o => ['usd', 'bs', 'mixto'].includes(o.id));
                const fila2 = opciones.filter(o => ['propina', 'billetera'].includes(o.id));
                return (
                    <div className="mt-2.5 space-y-2">
                        {sug && <div className="grid grid-cols-1">{boton(sug)}</div>}
                        <div className="grid grid-cols-3 gap-2">{fila1.map(boton)}</div>
                        <div className="grid grid-cols-2 gap-2">{fila2.map(boton)}</div>
                    </div>
                );
            })()}

            {/* Reparto a mano: solo con «En $ y Bs» */}
            {verCampos && (
                <div className="mt-3 pt-2 border-t border-emerald-200/70 dark:border-emerald-800/40">
                    <div className="grid grid-cols-2 gap-2">
                        {campo('usd')}
                        {campo('bs')}
                    </div>

                    {faltaRepartir > 0.001 ? (
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                            <span className="inline-flex items-center gap-1 text-xs font-black text-amber-800 dark:text-amber-300">
                                <AlertTriangle size={14} />
                                Falta repartir ${faltaRepartir.toFixed(2)} · Bs {fmtBs(remainingChangeBs)}
                            </span>
                            <span className="text-xs font-bold text-slate-600 dark:text-slate-300">El resto:</span>
                            <button
                                type="button"
                                onClick={toggleTipDonated}
                                className="min-h-[40px] px-3 rounded-[10px] border-2 border-amber-300 bg-white dark:bg-slate-900 text-xs font-black text-amber-800 dark:text-amber-300 active:scale-95"
                            >
                                Lo deja
                            </button>
                            {!sinCliente && (
                                <button
                                    type="button"
                                    onClick={handleCreditChange}
                                    className="min-h-[40px] px-3 rounded-[10px] border-2 border-brand/40 bg-white dark:bg-slate-900 text-xs font-black text-brand-dark dark:text-brand active:scale-95"
                                >
                                    A su billetera
                                </button>
                            )}
                        </div>
                    ) : (
                        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-black text-emerald-700 dark:text-emerald-300">
                            {(autoCampo === 'usd' || autoCampo === 'bs') && (autoCampo === 'usd' ? usd : bs) > 0 && restoLoDeja ? (
                                <span className="inline-flex flex-wrap items-center gap-1.5 font-bold text-slate-600 dark:text-slate-300">
                                    <CheckCircle size={14} className="text-emerald-600" />
                                    {autoCampo === 'usd' ? '¿No le das los $?' : '¿No le das los Bs?'}
                                    <button
                                        type="button"
                                        onClick={restoLoDeja}
                                        className="min-h-[36px] px-2.5 rounded-[10px] border-2 border-amber-300 bg-white dark:bg-slate-900 text-xs font-black text-amber-800 dark:text-amber-300 active:scale-95"
                                    >
                                        El resto lo deja
                                    </button>
                                    {!sinCliente && restoABilletera && (
                                        <button
                                            type="button"
                                            onClick={restoABilletera}
                                            className="min-h-[36px] px-2.5 rounded-[10px] border-2 border-brand/40 bg-white dark:bg-slate-900 text-xs font-black text-brand-dark dark:text-brand active:scale-95"
                                        >
                                            A su billetera
                                        </button>
                                    )}
                                </span>
                            ) : (
                                <span className="inline-flex items-center gap-1"><CheckCircle size={14} /> Vuelto repartido</span>
                            )}
                            {isTipDonated && (
                                <button type="button" onClick={toggleTipDonated} className="underline underline-offset-2">
                                    Deja ${cashKeptUsd.toFixed(2)} · quitar
                                </button>
                            )}
                            {isChangeCredited && (
                                <button type="button" onClick={() => setIsChangeCredited(false)} className="underline underline-offset-2">
                                    Billetera ${walletRemainderUsd.toFixed(2)} · quitar
                                </button>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* CAJA-FONDO-002: aviso legible de efectivo insuficiente (fondo null = desconocido: no avisa). */}
            <AvisoFondoGaveta
                usdGiven={distVueltoUSD}
                bsGiven={distVueltoBS}
                floatUsd={currentFloatUsd}
                floatBs={currentFloatBs}
            />
        </div>
    );
}

export default memo(ChangeCard);
