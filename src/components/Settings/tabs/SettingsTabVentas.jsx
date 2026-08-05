import React, { useState } from 'react';
import { Package, CreditCard, FileText, DollarSign, LayoutGrid, SlidersHorizontal, ShieldCheck, Zap, Smartphone, Monitor, Check } from 'lucide-react';
import { SectionCard, Toggle } from '../../SettingsShared';
import PaymentMethodsManager from '../PaymentMethodsManager';
import CasheaIcon from '../../CasheaIcon';
import { useProductContext } from '../../../context/ProductContext';

export default function SettingsTabVentas({
    allowNegativeStock, setAllowNegativeStock,
    forceHeartbeat, showToast, triggerHaptic
}) {
    const { checkoutMode, setCheckoutMode } = useProductContext();
    const [casheaEnabled, setCasheaEnabled] = useState(localStorage.getItem('cashea_enabled') === 'true');
    const [casheaMinAmount, setCasheaMinAmount] = useState(() => {
        const stored = parseFloat(localStorage.getItem('cashea_min_amount') || '0');
        return isNaN(stored) || stored < 0 ? '0' : stored.toString();
    });
    const [receiptCurrency, setReceiptCurrency] = useState(() => localStorage.getItem('receipt_currency_mode') || 'bs');
    const [cashAdvanceEnabled, setCashAdvanceEnabled] = useState(() => localStorage.getItem('allow_cash_advance') === 'true');
    const [cashAdvancePct, setCashAdvancePct] = useState(() => {
        const stored = parseFloat(localStorage.getItem('cash_advance_default_pct') || '10');
        return isNaN(stored) || stored < 0 ? '10' : stored.toString();
    });

    const handleCasheaMinAmountChange = (e) => {
        let val = e.target.value.replace('-', '');
        setCasheaMinAmount(val);
        const parsed = parseFloat(val);
        const safeVal = isNaN(parsed) || parsed < 0 ? 0 : parsed;
        localStorage.setItem('cashea_min_amount', safeVal.toString());
        forceHeartbeat();
    };

    const handleCasheaMinAmountBlur = () => {
        const parsed = parseFloat(casheaMinAmount);
        if (isNaN(parsed) || parsed < 0) {
            setCasheaMinAmount('0');
            localStorage.setItem('cashea_min_amount', '0');
        } else {
            setCasheaMinAmount(parsed.toString());
            localStorage.setItem('cashea_min_amount', parsed.toString());
        }
    };

    const handleCasheaMinAmountFocus = (e) => {
        e.target.select();
        if (casheaMinAmount === '0' || parseFloat(casheaMinAmount || '0') === 0) {
            setCasheaMinAmount('');
        }
    };

    const handleCashAdvancePctChange = (e) => {
        let val = e.target.value.replace('-', '');
        setCashAdvancePct(val);
        const parsed = parseFloat(val);
        const safeVal = isNaN(parsed) || parsed < 0 ? 0 : parsed;
        localStorage.setItem('cash_advance_default_pct', safeVal.toString());
        forceHeartbeat();
    };

    const handleCashAdvancePctFocus = (e) => {
        e.target.select();
        if (cashAdvancePct === '0' || parseFloat(cashAdvancePct || '0') === 0) {
            setCashAdvancePct('');
        }
    };

    const handleCashAdvancePctBlur = () => {
        const parsed = parseFloat(cashAdvancePct);
        if (isNaN(parsed) || parsed < 0) {
            setCashAdvancePct('10');
            localStorage.setItem('cash_advance_default_pct', '10');
        } else {
            setCashAdvancePct(parsed.toString());
            localStorage.setItem('cash_advance_default_pct', parsed.toString());
        }
    };

    return (
        <div className="space-y-6">
            {/* BLOQUE 1: INTERFAZ & COMPROBANTES DE VENTA */}
            <div>
                <div className="flex items-center gap-2 mb-3 px-1">
                    <SlidersHorizontal size={16} className="text-brand dark:text-brand" />
                    <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        Interfaz & Comprobantes
                    </h2>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
                    {/* Modo de Cobro */}
                    <SectionCard icon={LayoutGrid} title="Modo de Cobro (Interfaz)" subtitle="Selecciona la pantalla de pago activa para esta caja" iconColor="text-indigo-500">
                        <div className="space-y-3 flex flex-col justify-between h-full">
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed">
                                Define la experiencia visual del proceso de cobranza. Puedes dejarlo en automático o fijar un modo permanente:
                            </p>

                            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-1">
                                {[
                                    { 
                                        id: 'auto', 
                                        label: 'Automático', 
                                        desc: 'Auto por pantalla', 
                                        icon: Zap, 
                                        colorClass: 'text-amber-500 bg-amber-50 dark:bg-amber-950/40 border-amber-200/60',
                                        badge: 'Auto'
                                    },
                                    { 
                                        id: 'basic', 
                                        label: 'Modo Móvil', 
                                        desc: '1 columna apilada', 
                                        icon: Smartphone, 
                                        colorClass: 'text-teal-500 bg-teal-50 dark:bg-teal-950/40 border-teal-200/60' 
                                    },
                                    { 
                                        id: 'pos', 
                                        label: 'Modo PC', 
                                        desc: '2 col. Listo POS', 
                                        icon: Monitor, 
                                        colorClass: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200/60' 
                                    }
                                ].map(opt => {
                                    const isSelected = checkoutMode === opt.id;
                                    const IconComponent = opt.icon;
                                    return (
                                        <button
                                            key={opt.id}
                                            type="button"
                                            onClick={() => {
                                                setCheckoutMode(opt.id);
                                                forceHeartbeat();
                                                showToast(`Modo de cobro: ${opt.label}`, 'success');
                                                triggerHaptic?.();
                                            }}
                                            className={`relative group p-3.5 rounded-2xl text-left transition-all border flex flex-col justify-between cursor-pointer active:scale-[0.98] ${
                                                isSelected
                                                    ? 'bg-teal-800 text-white dark:bg-teal-900 dark:text-white border-teal-700 dark:border-teal-700 shadow-md ring-2 ring-teal-500/30'
                                                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-teal-300 dark:hover:border-teal-700 hover:shadow-xs'
                                            }`}
                                        >
                                            <div className="flex items-center justify-between mb-2">
                                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center border ${
                                                    isSelected ? 'bg-white/20 text-white border-white/30' : opt.colorClass
                                                }`}>
                                                    <IconComponent size={15} />
                                                </div>
                                                {isSelected ? (
                                                    <span className="flex items-center gap-0.5 text-[9px] font-black bg-white text-teal-800 px-1.5 py-0.5 rounded-full shadow-xs">
                                                        <Check size={9} strokeWidth={3} /> OK
                                                    </span>
                                                ) : opt.badge ? (
                                                    <span className="text-[9px] font-extrabold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 px-1.5 py-0.5 rounded-md">
                                                        {opt.badge}
                                                    </span>
                                                ) : null}
                                            </div>

                                            <div>
                                                <h4 className="text-xs font-black tracking-tight leading-snug">{opt.label}</h4>
                                                <p className={`text-[9px] mt-0.5 ${isSelected ? 'text-slate-300' : 'text-slate-400 dark:text-slate-500'}`}>
                                                    {opt.desc}
                                                </p>
                                            </div>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </SectionCard>

                    {/* Ticket de Venta */}
                    <SectionCard icon={FileText} title="Ticket de Venta" subtitle="Moneda del comprobante" iconColor="text-blue-500">
                        <div className="space-y-3 flex flex-col justify-between h-full">
                            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                                Elige en qué moneda se expresarán los precios y totales del ticket al imprimir o compartir por WhatsApp:
                            </p>
                            <div className="grid grid-cols-3 gap-2 pt-1">
                                {[
                                    { id: 'bs', label: 'Bolívares' },
                                    { id: 'usd', label: 'Dólares ($)' },
                                    { id: 'mixto', label: 'Mixto' }
                                ].map(opt => {
                                    const isSelected = receiptCurrency === opt.id;
                                    return (
                                        <button
                                            key={opt.id}
                                            type="button"
                                            onClick={() => {
                                                setReceiptCurrency(opt.id);
                                                localStorage.setItem('receipt_currency_mode', opt.id);
                                                forceHeartbeat();
                                                showToast(`Ticket configurado en ${opt.label}`, 'success');
                                                triggerHaptic?.();
                                            }}
                                            className={`py-2.5 px-2 rounded-xl text-xs font-bold transition-all border text-center ${
                                                isSelected
                                                    ? 'bg-brand text-white border-transparent shadow-sm ring-2 ring-brand/30'
                                                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-800 hover:border-brand/40'
                                            }`}
                                        >
                                            {opt.label}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </SectionCard>
                </div>
            </div>

            {/* BLOQUE 2: REGLAS DE VENTA & FINANCIAMIENTO */}
            <div>
                <div className="flex items-center gap-2 mb-3 px-1">
                    <ShieldCheck size={16} className="text-emerald-500" />
                    <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        Reglas Operativas & Crédito
                    </h2>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch">
                    {/* Vender Sin Stock */}
                    <SectionCard icon={Package} title="Inventario" subtitle="Reglas de ventas" iconColor="text-emerald-500">
                        <div className="flex items-center justify-between py-1">
                            <div>
                                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Vender sin Stock</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Permitir ventas si el inventario es 0</p>
                            </div>
                            <Toggle
                                enabled={allowNegativeStock}
                                onChange={() => {
                                    const newVal = !allowNegativeStock;
                                    setAllowNegativeStock(newVal);
                                    localStorage.setItem('allow_negative_stock', newVal.toString());
                                    forceHeartbeat();
                                    showToast(newVal ? 'Se permite vender sin stock' : 'No se permite vender sin stock', 'success');
                                    triggerHaptic?.();
                                }}
                            />
                        </div>
                    </SectionCard>

                    {/* Cashea */}
                    <SectionCard icon={CasheaIcon} title="Cashea" subtitle="Cobros financiados" iconColor="text-purple-500">
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Activar Cashea</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Cobros a crédito financiado</p>
                                </div>
                                <Toggle
                                    enabled={casheaEnabled}
                                    onChange={() => {
                                        const newVal = !casheaEnabled;
                                        setCasheaEnabled(newVal);
                                        localStorage.setItem('cashea_enabled', newVal.toString());
                                        forceHeartbeat();
                                        showToast(newVal ? 'Módulo Cashea activado' : 'Módulo Cashea desactivado', 'success');
                                        triggerHaptic?.();
                                    }}
                                />
                            </div>

                            {casheaEnabled && (
                                <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 animate-in fade-in space-y-2">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-xs font-extrabold text-slate-700 dark:text-slate-200">Monto Mínimo de Compra</p>
                                            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Límite en USD para habilitar Cashea</p>
                                        </div>
                                        <div className="relative flex items-center shrink-0">
                                            <span className="absolute left-2.5 text-xs font-black text-purple-600 dark:text-purple-400 pointer-events-none">$</span>
                                            <input
                                                type="number"
                                                min="0"
                                                step="0.01"
                                                inputMode="decimal"
                                                placeholder="0.00"
                                                value={casheaMinAmount}
                                                onFocus={handleCasheaMinAmountFocus}
                                                onChange={handleCasheaMinAmountChange}
                                                onBlur={handleCasheaMinAmountBlur}
                                                className="w-28 text-right font-black text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-xl pl-6 pr-3 py-2 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 transition-all shadow-inner"
                                            />
                                        </div>
                                    </div>
                                    {parseFloat(casheaMinAmount || '0') > 0 && (
                                        <p className="text-[10px] font-bold text-purple-600 dark:text-purple-400 bg-purple-50 dark:bg-purple-950/40 px-2.5 py-1 rounded-lg border border-purple-100 dark:border-purple-900/30 flex items-center gap-1">
                                            <span>💡</span> Solo compras de <strong>${parseFloat(casheaMinAmount).toFixed(2)} USD</strong> o más mostrarán Cashea.
                                        </p>
                                    )}
                                </div>
                            )}
                        </div>
                    </SectionCard>

                    {/* Avance de Efectivo */}
                    <SectionCard icon={DollarSign} title="Avance Efectivo" subtitle="Servicio de caja" iconColor="text-amber-500">
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Avances</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Avances con comisión</p>
                                </div>
                                <Toggle
                                    enabled={cashAdvanceEnabled}
                                    onChange={() => {
                                        const newVal = !cashAdvanceEnabled;
                                        setCashAdvanceEnabled(newVal);
                                        localStorage.setItem('allow_cash_advance', newVal.toString());
                                        forceHeartbeat();
                                        showToast(newVal ? 'Avances activados' : 'Avances desactivados', 'success');
                                        triggerHaptic?.();
                                    }}
                                />
                            </div>

                            {cashAdvanceEnabled && (
                                <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800/80 animate-in fade-in gap-3">
                                    <div>
                                        <p className="text-xs font-extrabold text-slate-700 dark:text-slate-200">Comisión de Avance</p>
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">% recargo por servicio de caja</p>
                                    </div>
                                    <div className="relative flex items-center shrink-0">
                                        <input
                                            type="number"
                                            min="0"
                                            step="0.1"
                                            inputMode="decimal"
                                            placeholder="10"
                                            value={cashAdvancePct}
                                            onFocus={handleCashAdvancePctFocus}
                                            onChange={handleCashAdvancePctChange}
                                            onBlur={handleCashAdvancePctBlur}
                                            className="w-24 text-right font-black text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-xl pl-3 pr-7 py-2 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-amber-500/30 focus:border-amber-500 transition-all shadow-inner"
                                        />
                                        <span className="absolute right-2.5 text-xs font-black text-amber-600 dark:text-amber-400 pointer-events-none">%</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    </SectionCard>
                </div>
            </div>

            {/* BLOQUE 3: MÉTODOS DE PAGO */}
            <div>
                <div className="flex items-center gap-2 mb-3 px-1">
                    <CreditCard size={16} className="text-brand dark:text-brand" />
                    <h2 className="text-xs font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                        Formas & Cuentas de Pago
                    </h2>
                </div>
                <SectionCard icon={CreditCard} title="Métodos de Pago" subtitle="Configura las formas de pago aceptadas en caja" iconColor="text-brand">
                    <PaymentMethodsManager triggerHaptic={triggerHaptic} />
                </SectionCard>
            </div>
        </div>
    );
}
