import React from 'react';
import {
    DollarSign, Banknote, Smartphone, CreditCard, Wallet, Send, Bitcoin, Zap
} from 'lucide-react';

const ICON_MAP = { CreditCard, Smartphone, Banknote, Wallet, Send, Bitcoin, DollarSign };

/**
 * Estilos por marca de método de pago.
 */
const getBrandStyles = (name, type) => {
    const n = name.toLowerCase();
    if (n.includes('zelle')) return {
        text: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200',
        iconBg: 'bg-purple-100', activeRing: 'ring-purple-500/20'
    };
    if (n.includes('binance') || n.includes('usdt')) return {
        text: 'text-yellow-600', bg: 'bg-yellow-50', border: 'border-yellow-200',
        iconBg: 'bg-yellow-100', activeRing: 'ring-yellow-500/20'
    };
    if (n.includes('pago móvil') || n.includes('pago movil') || type === 'BS') return {
        text: 'text-blue-600', bg: 'bg-blue-50', border: 'border-blue-200',
        iconBg: 'bg-blue-100', activeRing: 'ring-blue-500/20'
    };
    if (n.includes('cop') || type === 'COP') return {
        text: 'text-amber-600', bg: 'bg-amber-50', border: 'border-amber-200',
        iconBg: 'bg-amber-100', activeRing: 'ring-amber-500/20'
    };
    // Default USD
    return {
        text: 'text-emerald-600', bg: 'bg-emerald-50', border: 'border-emerald-200',
        iconBg: 'bg-emerald-100', activeRing: 'ring-emerald-500/20'
    };
};

/**
 * InputPago — Input individual por método de pago.
 */
const InputPago = React.memo(React.forwardRef(({
    label, icon: Icon, value, onChange, onAutoFill, moneda, onKeyDown,
    requiereRef, pideRef = false, refFormat = 'digits', refSelected = false, methodId,
    refPago, onChangeRef, tasa, isSelected, onFocus, onFocusRef, isTouch = false
}, ref) => {
    const brand = getBrandStyles(label, moneda);
    const isActive = value && parseFloat(value) > 0;
    // Referencia (últimos 4): aparece en la fila del título solo si el método tiene monto. CASO-058.
    const showRef = (pideRef || requiereRef) && isActive;
    const refLen = String(refPago || '').length;
    const refPendiente = requiereRef && refLen < 4;
    const equivalenciaUSD = moneda === 'BS' && isActive && tasa > 0
        ? (parseFloat(value) / tasa).toFixed(2)
        : null;

    return (
        <div className="relative group">
            <div className="flex justify-between items-center mb-1 ml-0.5">
                <label className={`text-[10px] font-bold uppercase tracking-wider transition-colors ${isActive ? brand.text : 'text-slate-400'}`}>
                    {label}
                </label>
                <div className="flex items-center gap-2 min-w-0">
                    {/* Equivalencia en USD (solo BS), junto al título para no sumar alto */}
                    {equivalenciaUSD && (
                        <span className="text-xs font-black text-blue-700 dark:text-blue-300">≈ ${equivalenciaUSD}</span>
                    )}
                    {showRef && (
                        <label className="flex items-center gap-1">
                            <span className={`text-[11px] font-black ${refPendiente ? 'text-amber-700 dark:text-amber-300' : 'text-slate-500'}`}>
                                Ref{requiereRef ? '' : ' (opc.)'}
                            </span>
                            <input
                                type="text"
                                data-ref-for={methodId}
                                // ERR-111: con letras (Zelle) se usa el teclado del sistema también en táctil;
                                // el teclado propio solo tiene números.
                                inputMode={refFormat === 'alnum' ? 'text' : (isTouch ? 'none' : 'numeric')}
                                autoComplete="off"
                                value={refPago || ''}
                                onChange={(e) => {
                                    const raw = e.target.value.toUpperCase();
                                    const clean = (refFormat === 'alnum' ? raw.replace(/[^0-9A-Z]/g, '') : raw.replace(/\D/g, '')).slice(0, 4);
                                    onChangeRef({ target: { value: clean } });
                                }}
                                onFocus={onFocusRef}
                                placeholder="····"
                                aria-label={`Referencia de ${label}, últimos 4`}
                                className={`w-[5.25rem] h-8 px-1 rounded-lg border-2 text-center font-mono font-black text-sm tracking-[0.35em] outline-none bg-white dark:bg-slate-900 text-slate-800 dark:text-white transition-all
                                    ${refSelected ? 'border-slate-700 ring-2 ring-slate-400/40' : refPendiente ? 'border-amber-400 bg-amber-50 dark:bg-amber-950/30' : 'border-emerald-300'}`}
                            />
                        </label>
                    )}
                </div>
            </div>

            <div className="flex flex-col">
                <div className="flex items-stretch gap-2">
                <div className="relative flex-1 min-w-0">
                    {/* Icono */}
                    <div className={`absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none transition-colors ${isActive ? brand.text : 'text-slate-300'}`}>
                        <Icon size={16} strokeWidth={isActive ? 2.5 : 2} />
                    </div>

                    {/* Input */}
                    <input
                        ref={ref}
                        type="text"
                        inputMode={isTouch ? 'none' : 'decimal'}
                        onFocus={onFocus}
                        placeholder="0.00"
                        value={value}
                        onChange={(e) => {
                            let v = e.target.value.replace(',', '.');
                            if (!/^[0-9.]*$/.test(v)) return;
                            const dots = v.match(/\./g);
                            if (dots && dots.length > 1) return;
                            onChange({ target: { value: v } });
                        }}
                        onKeyDown={(e) => {
                            if (e.key === ' ' || e.code === 'Space') {
                                e.preventDefault();
                                if (onAutoFill) onAutoFill();
                            }
                            if (e.key === 'Escape' && value !== '' && value != null && String(value) !== '0') {
                                // COBRO-002: con un monto escrito, Esc solo lo borra; no debe subir
                                // hasta la ventana y cerrar todo el cobro. Con el campo vacío sí cierra.
                                e.preventDefault();
                                e.stopPropagation();
                                onChange({ target: { value: '' } });
                            }
                            if (onKeyDown) onKeyDown(e);
                        }}
                        className={`w-full h-14 pl-9 pr-2 rounded-xl border-2 outline-none transition-all font-bold text-lg text-slate-800 dark:text-white shadow-sm
                            ${isSelected
                                ? `${brand.border} ${brand.bg} ring-4 ${brand.activeRing}`
                                : isActive
                                    ? `${brand.border} ${brand.bg} ring-1 ${brand.activeRing}`
                                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:border-slate-300 focus:border-slate-400 focus:ring-4 focus:ring-slate-50 dark:focus:ring-slate-800'
                            }`}
                    />
                    {/* La moneda ya la dice la tarjeta (Divisas / Bolívares / COP); se quitó la etiqueta interna para que quepan montos en Bs. */}
                </div>

                {/* «Completar»: llena lo que falta en la moneda de esta fila (igual que la tecla Espacio). CASO-056 fase 2. */}
                <button
                    type="button"
                    onClick={onAutoFill}
                    className={`shrink-0 h-14 min-w-[5.75rem] px-2 rounded-xl border-2 inline-flex items-center justify-center gap-1.5 text-sm font-black transition-all active:scale-95 ${brand.border} ${brand.text} bg-white dark:bg-slate-900 hover:brightness-95`}
                    title="Llenar saldo restante"
                    aria-label={`Completar lo que falta con ${label}`}
                    tabIndex={-1}
                >
                    <Zap size={15} fill="currentColor" />
                    Completar
                </button>
                </div>

            </div>
        </div>
    );
}));

/**
 * PaymentInputs — Panel derecho con los inputs de pago agrupados por moneda.
 * Soporte COP condicional (solo si copEnabled=true).
 */
export default function PaymentInputs({
    metodosDivisa,
    metodosBs,
    metodosCop = [],
    pagos,
    handleInputChange,
    llenarSaldo,
    referencias,
    handleRefChange,
    inputRefs,
    handleInputKeyDown,
    tasa,
    sumarBillete,
    isTouch = false,
    onFocusInput,
    activeInputId,
    activeInputType = 'amount',
    onFocusRef,
    copEnabled = false,
    mobileCurrency = null,
}) {
    const renderQuickCash = (id) => (
        <div className="grid grid-cols-6 gap-1.5 mt-2.5">
            {[1, 5, 10, 20, 50, 100].map(den => (
                <button
                    key={den}
                    type="button"
                    onClick={() => sumarBillete(id, den)}
                    aria-label={`Sumar billete de ${den} dólares`}
                    className="min-h-[44px] px-1 font-black rounded-[10px] border-2 border-emerald-100 text-[13px] tracking-tight whitespace-nowrap bg-white dark:bg-slate-900 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:border-emerald-200 hover:bg-emerald-50 dark:hover:bg-emerald-950/20 active:scale-95 transition-all"
                >${den}</button>
            ))}
        </div>
    );

    let globalIndex = 0;

    return (
        <div className={`grid grid-cols-1 ${copEnabled && metodosCop.length > 0 ? 'sm:grid-cols-3' : 'sm:grid-cols-2'} ${mobileCurrency ? 'gap-3' : 'gap-4'}`}>
            {/* DIVISAS (USD) */}
            <div className={`${mobileCurrency && mobileCurrency !== 'USD' ? 'hidden lg:flex' : 'flex'} bg-emerald-50/30 dark:bg-emerald-950/10 border border-emerald-100 dark:border-emerald-900/30 rounded-2xl p-3 sm:p-4 flex-col gap-3 sm:gap-4`}>

                <h3 className="text-xs font-bold text-emerald-800 dark:text-emerald-300 flex items-center gap-2 uppercase tracking-wide border-b border-emerald-100 dark:border-emerald-900/30 pb-2.5">
                    <div className="p-1 bg-emerald-100 dark:bg-emerald-900/50 rounded-lg"><DollarSign size={14} strokeWidth={3} /></div>
                    Divisas ($)
                </h3>
                <div className="space-y-4">
                    {metodosDivisa.map((m) => {
                        const idx = globalIndex++;
                        const Icon = ICON_MAP[m.icono] || DollarSign;
                        const isEfectivo = m.nombre.toLowerCase().includes('efectivo');
                        return (
                            <div key={m.id}>
                                <InputPago
                                    ref={el => inputRefs.current[idx] = el}
                                    label={m.nombre} icon={Icon}
                                    value={pagos[m.id] || ''}
                                    onChange={e => handleInputChange(m.id, e.target.value)}
                                    onAutoFill={() => llenarSaldo(m.id, 'USD')}
                                    moneda="USD"
                                    onKeyDown={e => handleInputKeyDown(e, idx, m.id, 'USD')}
                                    requiereRef={m.requiereRef}
                                    pideRef={m.pideRef}
                                    refFormat={m.refFormat}
                                    methodId={m.id}
                                    refSelected={activeInputId === m.id && activeInputType === 'ref'}
                                    refPago={referencias[m.id]}
                                    onChangeRef={e => handleRefChange(m.id, e.target.value)}
                                    tasa={tasa}
                                    isTouch={isTouch}
                                    onFocus={() => onFocusInput(m.id)}
                                    isSelected={activeInputId === m.id}
                                    onFocusRef={() => onFocusRef(m.id)}
                                />
                                {isEfectivo && renderQuickCash(m.id)}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* BOLÍVARES (BS) */}
            <div className={`${mobileCurrency && mobileCurrency !== 'BS' ? 'hidden lg:flex' : 'flex'} bg-blue-50/30 dark:bg-blue-950/10 border border-blue-100 dark:border-blue-900/30 rounded-2xl p-4 flex-col gap-4`}>

                <div className="flex items-center justify-between border-b border-blue-100 dark:border-blue-900/30 pb-2.5">
                    <h3 className="text-xs font-bold text-blue-800 dark:text-blue-300 flex items-center gap-2 uppercase tracking-wide">
                        <div className="p-1 bg-blue-100 dark:bg-blue-900/50 rounded-lg"><Banknote size={14} strokeWidth={3} /></div>
                        Bolívares (Bs)
                    </h3>
                </div>
                <div className="space-y-4">
                    {metodosBs.map((m) => {
                        const idx = globalIndex++;
                        const Icon = ICON_MAP[m.icono] || Banknote;
                        return (
                            <InputPago
                                key={m.id}
                                ref={el => inputRefs.current[idx] = el}
                                label={m.nombre} icon={Icon}
                                value={pagos[m.id] || ''}
                                onChange={e => handleInputChange(m.id, e.target.value)}
                                onAutoFill={() => llenarSaldo(m.id, 'BS')}
                                moneda="BS"
                                onKeyDown={e => handleInputKeyDown(e, idx, m.id, 'BS')}
                                requiereRef={m.requiereRef}
                                    pideRef={m.pideRef}
                                    refFormat={m.refFormat}
                                    methodId={m.id}
                                    refSelected={activeInputId === m.id && activeInputType === 'ref'}
                                refPago={referencias[m.id]}
                                onChangeRef={e => handleRefChange(m.id, e.target.value)}
                                tasa={tasa}
                                isTouch={isTouch}
                                onFocus={() => onFocusInput(m.id)}
                                isSelected={activeInputId === m.id}
                                onFocusRef={() => onFocusRef(m.id)}
                            />
                        );
                    })}
                </div>
            </div>

            {/* PESOS COLOMBIANOS (COP) — solo si copEnabled */}
            {copEnabled && metodosCop.length > 0 && (
                <div className={`${mobileCurrency && mobileCurrency !== 'COP' ? 'hidden lg:flex' : 'flex'} bg-amber-50/30 dark:bg-amber-950/10 border border-amber-100 dark:border-amber-900/30 rounded-2xl p-3 sm:p-4 flex-col gap-3 sm:gap-4`}>

                    <h3 className="text-xs font-bold text-amber-800 dark:text-amber-300 flex items-center gap-2 uppercase tracking-wide border-b border-amber-100 dark:border-amber-900/30 pb-2.5">
                        <div className="p-1 bg-amber-100 dark:bg-amber-900/50 rounded-lg"><DollarSign size={14} strokeWidth={3} /></div>
                        COP ($)
                    </h3>
                    <div className="space-y-4">
                        {metodosCop.map((m) => {
                            const idx = globalIndex++;
                            const Icon = ICON_MAP[m.icono] || DollarSign;
                            return (
                                <InputPago
                                    key={m.id}
                                    ref={el => inputRefs.current[idx] = el}
                                    label={m.nombre} icon={Icon}
                                    value={pagos[m.id] || ''}
                                    onChange={e => handleInputChange(m.id, e.target.value)}
                                    onAutoFill={() => llenarSaldo(m.id, 'COP')}
                                    moneda="COP"
                                    onKeyDown={e => handleInputKeyDown(e, idx, m.id, 'COP')}
                                    requiereRef={m.requiereRef}
                                    pideRef={m.pideRef}
                                    refFormat={m.refFormat}
                                    methodId={m.id}
                                    refSelected={activeInputId === m.id && activeInputType === 'ref'}
                                    refPago={referencias[m.id]}
                                    onChangeRef={e => handleRefChange(m.id, e.target.value)}
                                    tasa={tasa}
                                    isTouch={isTouch}
                                    onFocus={() => onFocusInput(m.id)}
                                    isSelected={activeInputId === m.id}
                                    onFocusRef={() => onFocusRef(m.id)}
                                />
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
}
