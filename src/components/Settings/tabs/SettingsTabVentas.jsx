import React, { useState } from 'react';
import { Package, CreditCard, FileText, DollarSign } from 'lucide-react';
import { SectionCard, Toggle } from '../../SettingsShared';
import PaymentMethodsManager from '../PaymentMethodsManager';
import CasheaIcon from '../../CasheaIcon';

export default function SettingsTabVentas({
    allowNegativeStock, setAllowNegativeStock,
    forceHeartbeat, showToast, triggerHaptic
}) {
    const [casheaEnabled, setCasheaEnabled] = useState(localStorage.getItem('cashea_enabled') === 'true');
    const [casheaMinAmount, setCasheaMinAmount] = useState(localStorage.getItem('cashea_min_amount') || '0');
    const [receiptCurrency, setReceiptCurrency] = useState(() => localStorage.getItem('receipt_currency_mode') || 'bs');
    const [cashAdvanceEnabled, setCashAdvanceEnabled] = useState(() => localStorage.getItem('allow_cash_advance') === 'true');
    const [cashAdvancePct, setCashAdvancePct] = useState(() => localStorage.getItem('cash_advance_default_pct') || '10');

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 items-start">
            <SectionCard icon={Package} title="Inventario" subtitle="Reglas de ventas" iconColor="text-emerald-500">
                <div className="flex items-center justify-between">
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

            <SectionCard icon={CasheaIcon} title="Financiamiento Cashea" subtitle="Configuración de Cashea" iconColor="text-purple-500">
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Activar Cashea</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Habilitar cobros financiados por Cashea en caja</p>
                        </div>
                        <Toggle
                            enabled={casheaEnabled}
                            onChange={() => {
                                const newVal = !casheaEnabled;
                                setCasheaEnabled(newVal);
                                localStorage.setItem('cashea_enabled', newVal.toString());
                                forceHeartbeat(); // Trigger refresh in consumer components (like POS screen)
                                showToast(newVal ? 'Módulo Cashea activado' : 'Módulo Cashea desactivado', 'success');
                                triggerHaptic?.();
                            }}
                        />
                    </div>

                    {casheaEnabled && (
                        <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 animate-in fade-in">
                            <div>
                                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Compra Mínima ($)</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Monto mínimo en dólares para permitir Cashea</p>
                            </div>
                            <input
                                type="number"
                                placeholder="0.00"
                                value={casheaMinAmount}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    setCasheaMinAmount(val);
                                    localStorage.setItem('cashea_min_amount', val);
                                    forceHeartbeat(); // Notify hook of change
                                }}
                                className="w-24 text-right font-bold text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-700 dark:text-white outline-none focus:ring-1 focus:ring-purple-500"
                            />
                        </div>
                    )}
                </div>
            </SectionCard>

            <SectionCard icon={FileText} title="Ticket de Venta" subtitle="Moneda del comprobante" iconColor="text-blue-500">
                <div className="space-y-3">
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                        Elige en qué moneda se expresarán los precios y totales del ticket al imprimir o compartir:
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
                                    className={`py-2 rounded-xl text-xs font-bold transition-all border ${
                                        isSelected
                                            ? 'bg-brand text-white border-transparent shadow-sm'
                                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-400 border-slate-200 dark:border-slate-850 hover:border-brand/40'
                                    }`}
                                >
                                    {opt.label}
                                </button>
                            );
                        })}
                    </div>
                </div>
            </SectionCard>

            <SectionCard icon={DollarSign} title="Avance de Efectivo" subtitle="Configuración de Avances" iconColor="text-amber-500">
                <div className="space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Habilitar Avances</p>
                            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Permitir avances de efectivo con comisión en caja</p>
                        </div>
                        <Toggle
                            enabled={cashAdvanceEnabled}
                            onChange={() => {
                                const newVal = !cashAdvanceEnabled;
                                setCashAdvanceEnabled(newVal);
                                localStorage.setItem('allow_cash_advance', newVal.toString());
                                forceHeartbeat();
                                showToast(newVal ? 'Módulo de Avance de Efectivo activado' : 'Módulo de Avance de Efectivo desactivado', 'success');
                                triggerHaptic?.();
                            }}
                        />
                    </div>

                    {cashAdvanceEnabled && (
                        <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800 animate-in fade-in">
                            <div>
                                <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Comisión por Defecto (%)</p>
                                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Porcentaje de recargo por el servicio de avance</p>
                            </div>
                            <input
                                type="number"
                                placeholder="10"
                                value={cashAdvancePct}
                                onChange={(e) => {
                                    const val = e.target.value;
                                    setCashAdvancePct(val);
                                    localStorage.setItem('cash_advance_default_pct', val);
                                    forceHeartbeat();
                                }}
                                className="w-20 text-right font-bold text-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-700 dark:text-white outline-none focus:ring-1 focus:ring-amber-500"
                            />
                        </div>
                    )}
                </div>
            </SectionCard>

            <div className="md:col-span-2 xl:col-span-3">
                <SectionCard icon={CreditCard} title="Metodos de Pago" subtitle="Configura como te pagan" iconColor="text-brand">
                    <PaymentMethodsManager triggerHaptic={triggerHaptic} />
                </SectionCard>
            </div>
        </div>
    );
}
