import { useState } from 'react';
import {
    Package, CreditCard, FileText, DollarSign, LayoutGrid,
    ShieldCheck, Zap, Smartphone, Monitor, Check, HandCoins, Printer, Scale,
    FileSpreadsheet
} from 'lucide-react';
import { SectionCard, Toggle } from '../../SettingsShared';
import PaymentMethodsManager from '../PaymentMethodsManager';
import CasheaIcon from '../../CasheaIcon';
import PrinterHardwareManager from '../PrinterHardwareManager';
import { useProductContext } from '../../../context/ProductContext';
import { loadTaxConfig, saveTaxConfig, resetTaxConfig, IVA_FACTORY_RATE, normalizeIvaRate } from '../../../config/taxConfig';

const SUB_TABS = [
    {
        id: 'terminal',
        label: 'Terminal & Cobro',
        icon: LayoutGrid,
        desc: 'Pantalla, ticket y pesaje',
    },
    {
        id: 'caja',
        label: 'Caja & Vuelto',
        icon: HandCoins,
        desc: 'Cambio, avances y formas de pago',
    },
    {
        id: 'politicas',
        label: 'Políticas & Crédito',
        icon: ShieldCheck,
        desc: 'Inventario, Cashea y fiados',
    },
    {
        id: 'ticketera',
        label: 'Ticketera & Hardware',
        icon: Printer,
        desc: 'Papel, driver y calibración',
    },
];

export default function SettingsTabVentas({
    allowNegativeStock, setAllowNegativeStock,
    forceHeartbeat, showToast, triggerHaptic,
    paperWidth, setPaperWidth,
}) {
    const { checkoutMode, setCheckoutMode, granelUnitMode, setGranelUnitMode } = useProductContext();

    // ── SUB-PESTAÑA ACTIVA CON PERSISTENCIA ──
    const [activeSubTab, setActiveSubTab] = useState(() => {
        const stored = localStorage.getItem('settings_ventas_active_subtab');
        return ['terminal', 'caja', 'politicas', 'ticketera'].includes(stored) ? stored : 'terminal';
    });

    const handleSubTabChange = (tabId) => {
        setActiveSubTab(tabId);
        localStorage.setItem('settings_ventas_active_subtab', tabId);
        triggerHaptic?.();
    };

    // ── ESTADO DE CONFIGURACIONES EXISTENTES ──
    const [casheaEnabled, setCasheaEnabled] = useState(localStorage.getItem('cashea_enabled') === 'true');
    const [casheaMinAmount, setCasheaMinAmount] = useState(() => {
        const stored = parseFloat(localStorage.getItem('cashea_min_amount') || '0');
        return isNaN(stored) || stored < 0 ? '0' : stored.toString();
    });
    const [receiptCurrency, setReceiptCurrency] = useState(() => localStorage.getItem('receipt_currency_mode') || 'bs');
    // SYNC-CESTA-001: flag de escape de la re-sincronización viva cesta↔inventario.
    const [liveCartResync, setLiveCartResync] = useState(() => localStorage.getItem('cart_live_resync') !== 'false');
    // FIA-REPORT-001: flag de escape de la sección de cuentas por cobrar del reporte.
    const [fiadoSplit, setFiadoSplit] = useState(() => localStorage.getItem('reportes_fiado_split') !== 'false');
    // FIA-REPORT-001 (H5): reconstruir la cartera desde el ledger es una escritura
    // sobre datos de clientes ⇒ apagado por defecto y solo para no-cajeros.
    const [ledgerRepair, setLedgerRepair] = useState(() => localStorage.getItem('reportes_reparacion_ledger') === 'true');
    const [cashAdvanceEnabled, setCashAdvanceEnabled] = useState(() => localStorage.getItem('allow_cash_advance') === 'true');
    const [cashAdvancePct, setCashAdvancePct] = useState(() => {
        const stored = parseFloat(localStorage.getItem('cash_advance_default_pct') || '10');
        return isNaN(stored) || stored < 0 ? '10' : stored.toString();
    });
    // VUELTO-REALISTA Fase 3: desglose del cambio ajustable por tienda.
    const [smallestUsdBill, setSmallestUsdBill] = useState(() => {
        const stored = parseFloat(localStorage.getItem('checkout_smallest_usd_bill') || '1');
        return isNaN(stored) || stored <= 0 ? '1' : stored.toString();
    });
    const [bsRoundStep, setBsRoundStep] = useState(() => {
        const stored = parseFloat(localStorage.getItem('checkout_bs_round_step') || '0');
        return isNaN(stored) || stored < 0 ? '0' : stored.toString();
    });
    const [bsRoundMode, setBsRoundMode] = useState(() => localStorage.getItem('checkout_bs_round_mode') || 'ceil');

    // ── IVA (fase 3): configuración fiscal guardada en taxConfig ──
    const [taxConfig, setTaxConfig] = useState(() => loadTaxConfig());
    const [ivaRateInput, setIvaRateInput] = useState(() => String(loadTaxConfig().ivaRate));

    const handleIvaToggle = () => {
        const next = saveTaxConfig({ ...loadTaxConfig(), ivaEnabled: !loadTaxConfig().ivaEnabled });
        setTaxConfig(next);
        forceHeartbeat?.();
        showToast?.(next.ivaEnabled ? 'IVA activado' : 'IVA desactivado', 'success');
        triggerHaptic?.();
    };

    // Guarda solo valores válidos (0–100). Mientras se escribe no se corrige el texto.
    const handleIvaRateChange = (e) => {
        const raw = e.target.value;
        setIvaRateInput(raw);
        const rate = normalizeIvaRate(raw);
        if (rate !== null) {
            // Usa la configuración leída de storage en este mismo paso, no el estado del render.
            const next = saveTaxConfig({ ...loadTaxConfig(), ivaRate: rate });
            setTaxConfig(next);
            forceHeartbeat?.();
        }
    };

    // Al salir del campo, si el valor no es válido, vuelve al último valor guardado.
    const handleIvaRateBlur = () => {
        const rate = normalizeIvaRate(ivaRateInput);
        if (rate === null) {
            setIvaRateInput(String(taxConfig.ivaRate));
        } else {
            setIvaRateInput(String(rate));
        }
    };

    const handleIvaRestore = () => {
        const next = resetTaxConfig();
        setTaxConfig(next);
        setIvaRateInput(String(IVA_FACTORY_RATE));
        forceHeartbeat?.();
        showToast?.(`IVA restaurado a ${IVA_FACTORY_RATE}% (de fábrica)`, 'success');
        triggerHaptic?.();
    };

    // ── HANDLERS DE CASHEA ──
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

    // ── HANDLERS DE AVANCE DE EFECTIVO ──
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

    // ── VUELTO-REALISTA Fase 3: handlers de desglose del cambio ──
    const persistBill = (val) => {
        const parsed = parseFloat(val);
        const safe = isNaN(parsed) || parsed <= 0 ? 1 : parsed;
        setSmallestUsdBill(safe.toString());
        localStorage.setItem('checkout_smallest_usd_bill', safe.toString());
        forceHeartbeat();
    };
    const persistRoundStep = (val) => {
        const parsed = parseFloat(val);
        const safe = isNaN(parsed) || parsed < 0 ? 0 : parsed;
        setBsRoundStep(safe.toString());
        localStorage.setItem('checkout_bs_round_step', safe.toString());
        forceHeartbeat();
    };
    const persistRoundMode = (mode) => {
        setBsRoundMode(mode);
        localStorage.setItem('checkout_bs_round_mode', mode);
        forceHeartbeat();
        showToast(mode === 'ceil' ? 'Redondeo a favor del cliente' : 'Redondeo a favor de la tienda', 'success');
        triggerHaptic?.();
    };

    return (
        <div className="space-y-4">
            {/* ═══ SUB-BARRA DE NAVEGACIÓN SEGMENTADA (SMART PILLS) ═══ */}
            <div
                role="tablist"
                aria-label="Subsecciones de Ventas"
                className="flex items-center gap-1.5 p-1.5 bg-slate-100 dark:bg-slate-900/90 rounded-2xl border border-slate-200/80 dark:border-slate-800 overflow-x-auto shadow-xs"
            >
                {SUB_TABS.map(tab => {
                    const isActive = activeSubTab === tab.id;
                    const IconComponent = tab.icon;
                    return (
                        <button
                            key={tab.id}
                            role="tab"
                            id={`tab-ventas-${tab.id}`}
                            aria-selected={isActive}
                            aria-controls={`panel-ventas-${tab.id}`}
                            type="button"
                            onClick={() => handleSubTabChange(tab.id)}
                            className={`flex-1 min-w-[135px] sm:min-w-0 flex items-center justify-center gap-2 py-2 px-3 rounded-xl text-xs font-black transition-all cursor-pointer select-none active:scale-[0.98] ${
                                isActive
                                    ? 'bg-teal-700 text-white dark:bg-teal-800 shadow-sm ring-2 ring-teal-500/20'
                                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-white/80 dark:hover:bg-slate-800/80'
                            }`}
                        >
                            <IconComponent size={15} />
                            <span className="whitespace-nowrap">{tab.label}</span>
                        </button>
                    );
                })}
            </div>

            {/* ═══════════════════════════════════════════════════════ */}
            {/* SUB-PANEL 1: TERMINAL & COBRO                          */}
            {/* ═══════════════════════════════════════════════════════ */}
            {activeSubTab === 'terminal' && (
                <div
                    id="panel-ventas-terminal"
                    role="tabpanel"
                    aria-labelledby="tab-ventas-terminal"
                    className="grid grid-cols-1 lg:grid-cols-3 gap-4 items-stretch animate-in fade-in duration-200"
                >
                    {/* Modo de Cobro (Interfaz) */}
                    <SectionCard icon={LayoutGrid} title="Modo de Cobro (Interfaz)" subtitle="Selecciona la pantalla de pago activa para esta caja" iconColor="text-indigo-500">
                        <div className="space-y-3 flex flex-col justify-between h-full">
                            <p className="text-xs font-medium text-slate-500 dark:text-slate-400 leading-relaxed">
                                Define la experiencia visual del proceso de cobranza. Puedes dejarlo en automático o fijar un modo permanente:
                            </p>

                            <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-1 gap-2 pt-1">
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
                                            className={`relative group p-3 rounded-xl text-left transition-all border flex items-center justify-between cursor-pointer active:scale-[0.98] ${
                                                isSelected
                                                    ? 'bg-teal-800 text-white dark:bg-teal-900 dark:text-white border-teal-700 dark:border-teal-700 shadow-md ring-2 ring-teal-500/30'
                                                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-teal-300 dark:hover:border-teal-700 hover:shadow-xs'
                                            }`}
                                        >
                                            <div className="flex items-center gap-2.5">
                                                <div className={`w-7 h-7 rounded-lg flex items-center justify-center border shrink-0 ${
                                                    isSelected ? 'bg-white/20 text-white border-white/30' : opt.colorClass
                                                }`}>
                                                    <IconComponent size={14} />
                                                </div>
                                                <div>
                                                    <h4 className="text-xs font-black tracking-tight leading-snug">{opt.label}</h4>
                                                    <p className={`text-[10px] mt-0.5 ${isSelected ? 'text-teal-100' : 'text-slate-400 dark:text-slate-500'}`}>
                                                        {opt.desc}
                                                    </p>
                                                </div>
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
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </SectionCard>

                    {/* Ticket de Venta */}
                    <SectionCard icon={DollarSign} title="IVA" subtitle="Impuesto al valor agregado sobre la venta" iconColor="text-emerald-600">
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Cobrar IVA</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Suma el IVA al total de cada venta nueva. Las ventas anteriores no cambian.</p>
                                </div>
                                <Toggle enabled={taxConfig.ivaEnabled} onChange={handleIvaToggle} aria-label="Cobrar IVA" />
                            </div>

                            <div className="pt-3 border-t border-slate-100 dark:border-slate-800/80 space-y-2">
                                <div className="flex items-center justify-between gap-3">
                                    <div>
                                        <p className="text-xs font-extrabold text-slate-700 dark:text-slate-200">Tasa de IVA</p>
                                        <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Porcentaje general (0 a 100). Por defecto 16%.</p>
                                    </div>
                                    <div className="relative flex items-center shrink-0">
                                        <input
                                            type="number"
                                            min="0"
                                            max="100"
                                            step="0.01"
                                            inputMode="decimal"
                                            value={ivaRateInput}
                                            onChange={handleIvaRateChange}
                                            onBlur={handleIvaRateBlur}
                                            disabled={!taxConfig.ivaEnabled}
                                            aria-label="Tasa de IVA en porcentaje"
                                            className="w-24 text-right font-black text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-xl pl-3 pr-7 py-2 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all shadow-inner disabled:opacity-50"
                                        />
                                        <span className="absolute right-2.5 text-xs font-black text-emerald-600 dark:text-emerald-400 pointer-events-none">%</span>
                                    </div>
                                </div>
                                <div className="flex justify-end">
                                    <button
                                        type="button"
                                        onClick={handleIvaRestore}
                                        className="text-[11px] font-bold text-emerald-700 dark:text-emerald-400 px-3 py-1.5 rounded-lg border border-emerald-200 dark:border-emerald-900/40 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 transition-all"
                                    >
                                        Restaurar {IVA_FACTORY_RATE}% (de fábrica)
                                    </button>
                                </div>
                            </div>
                        </div>
                    </SectionCard>

                    <SectionCard icon={FileText} title="Ticket de Venta" subtitle="Moneda del comprobante" iconColor="text-blue-500">
                        <div className="space-y-3 flex flex-col justify-between h-full">
                            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                                Elige en qué moneda se expresarán los precios y subtotales al imprimir o compartir por WhatsApp:
                            </p>
                            <div className="grid grid-cols-1 gap-2 pt-1">
                                {[
                                    { id: 'bs', label: 'Bolívares (Bs)', desc: 'Precios expresados en moneda nacional' },
                                    { id: 'usd', label: 'Dólares ($)', desc: 'Precios expresados en divisas USD' },
                                    { id: 'mixto', label: 'Mixto (Bs + $)', desc: 'Desglose simultáneo en ambas monedas' }
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
                                            className={`p-3 rounded-xl text-left transition-all border flex items-center justify-between cursor-pointer active:scale-[0.98] ${
                                                isSelected
                                                    ? 'bg-teal-800 text-white dark:bg-teal-900 dark:text-white border-teal-700 dark:border-teal-700 shadow-md ring-2 ring-teal-500/30'
                                                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-teal-300 dark:hover:border-teal-700 hover:shadow-xs'
                                            }`}
                                        >
                                            <div>
                                                <h4 className="text-xs font-black tracking-tight leading-snug">{opt.label}</h4>
                                                <p className={`text-[10px] mt-0.5 ${isSelected ? 'text-teal-100' : 'text-slate-400 dark:text-slate-500'}`}>
                                                    {opt.desc}
                                                </p>
                                            </div>
                                            {isSelected && (
                                                <span className="flex items-center gap-0.5 text-[9px] font-black bg-white text-teal-800 px-1.5 py-0.5 rounded-full shadow-xs">
                                                    <Check size={9} strokeWidth={3} /> OK
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    </SectionCard>

                    {/* Unidad de Granel y Pesaje */}
                    <SectionCard icon={Scale} title="Unidad de Granel" subtitle="Pesaje y fraccionamiento" iconColor="text-amber-500">
                        <div className="space-y-3 flex flex-col justify-between h-full">
                            <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                                Elige cómo registrar y visualizar los productos por peso o volumen en ventas y tickets:
                            </p>
                            <div className="grid grid-cols-1 gap-2 pt-1">
                                {[
                                    {
                                        id: 'gr_ml',
                                        label: 'Gramos / ml (Enteros)',
                                        desc: 'Entrada rápida entera: 500 g, 800 ml sin comas',
                                    },
                                    {
                                        id: 'kg_lt',
                                        label: 'Kg / Litros (Decimales)',
                                        desc: 'Entrada fraccionaria estándar: 0.5 kg, 0.8 L',
                                    }
                                ].map(opt => {
                                    const isSelected = (granelUnitMode || 'kg_lt') === opt.id;
                                    return (
                                        <button
                                            key={opt.id}
                                            type="button"
                                            onClick={() => {
                                                setGranelUnitMode(opt.id);
                                                forceHeartbeat();
                                                showToast(`Unidad de granel: ${opt.label}`, 'success');
                                                triggerHaptic?.();
                                            }}
                                            className={`p-3 rounded-xl text-left transition-all border flex items-center justify-between cursor-pointer active:scale-[0.98] ${
                                                isSelected
                                                    ? 'bg-amber-600 text-white border-transparent shadow-md ring-2 ring-amber-500/30'
                                                    : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-amber-400'
                                            }`}
                                        >
                                            <div>
                                                <h4 className="text-xs font-black tracking-tight leading-snug">{opt.label}</h4>
                                                <p className={`text-[10px] mt-0.5 ${isSelected ? 'text-amber-100' : 'text-slate-400 dark:text-slate-500'}`}>
                                                    {opt.desc}
                                                </p>
                                            </div>
                                            {isSelected && (
                                                <span className="text-[9px] font-black bg-white text-amber-700 px-1.5 py-0.5 rounded-full shadow-xs">
                                                    Activo
                                                </span>
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
                                💡 En <strong>Gramos / ml</strong>, el inventario canónico se conserva intacto en kilogramos sin alterar los reportes.
                            </p>
                        </div>
                    </SectionCard>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════════ */}
            {/* SUB-PANEL 2: CAJA & VUELTO                              */}
            {/* ═══════════════════════════════════════════════════════ */}
            {activeSubTab === 'caja' && (
                <div
                    id="panel-ventas-caja"
                    role="tabpanel"
                    aria-labelledby="tab-ventas-caja"
                    className="space-y-4 animate-in fade-in duration-200"
                >
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
                        {/* Desglose del Cambio */}
                        <SectionCard
                            icon={HandCoins}
                            title="Cómo entrega la caja el cambio"
                            subtitle="Ajusta la propuesta automática a lo que realmente hay en caja"
                            iconColor="text-emerald-600"
                        >
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                {/* Billete más pequeño */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-xs font-extrabold text-slate-700 dark:text-slate-200">Billete más pequeño ($)</p>
                                            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">El menor que manejas en caja</p>
                                        </div>
                                        <div className="relative flex items-center shrink-0">
                                            <span className="absolute left-2.5 text-xs font-black text-emerald-600 dark:text-emerald-400 pointer-events-none">$</span>
                                            <input
                                                type="number"
                                                min="0.01"
                                                step="0.5"
                                                inputMode="decimal"
                                                value={smallestUsdBill}
                                                onChange={(e) => { setSmallestUsdBill(e.target.value); }}
                                                onBlur={(e) => persistBill(e.target.value)}
                                                aria-label="Valor del billete de dólar más pequeño disponible en caja"
                                                className="w-24 text-right font-black text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-xl pl-6 pr-3 py-2 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30 focus:border-emerald-500 transition-all shadow-inner"
                                            />
                                        </div>
                                    </div>
                                    <p className="text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/40 px-2.5 py-1 rounded-lg border border-emerald-100 dark:border-emerald-900/30">
                                        💡 Sin billetes de $1: pon <strong>5</strong> — la propuesta dará más cambio en bolívares.
                                    </p>
                                </div>

                                {/* Redondeo en Bs */}
                                <div className="space-y-2">
                                    <div className="flex items-center justify-between gap-3">
                                        <div>
                                            <p className="text-xs font-extrabold text-slate-700 dark:text-slate-200">Redondeo en Bs</p>
                                            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">0 = monto exacto; 1, 5, 10…</p>
                                        </div>
                                        <div className="relative flex items-center shrink-0">
                                            <span className="absolute left-2.5 text-xs font-black text-blue-600 dark:text-blue-400 pointer-events-none">Bs</span>
                                            <input
                                                type="number"
                                                min="0"
                                                step="1"
                                                inputMode="numeric"
                                                value={bsRoundStep}
                                                onChange={(e) => { setBsRoundStep(e.target.value); }}
                                                onBlur={(e) => persistRoundStep(e.target.value)}
                                                aria-label="Paso de redondeo en bolívares para el cambio"
                                                className="w-24 text-right font-black text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700/80 rounded-xl pl-8 pr-3 py-2 text-slate-800 dark:text-white outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition-all shadow-inner"
                                            />
                                        </div>
                                    </div>
                                    {parseFloat(bsRoundStep || '0') > 0 && (
                                        <div className="flex items-center justify-between gap-2 pt-1">
                                            <button
                                                type="button"
                                                onClick={() => persistRoundMode('ceil')}
                                                aria-pressed={bsRoundMode === 'ceil'}
                                                className={`flex-1 min-h-[34px] px-2 rounded-lg text-[10px] font-black transition-all active:scale-[0.98] border ${bsRoundMode === 'ceil' ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}
                                            >
                                                A favor del cliente
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => persistRoundMode('floor')}
                                                aria-pressed={bsRoundMode === 'floor'}
                                                className={`flex-1 min-h-[34px] px-2 rounded-lg text-[10px] font-black transition-all active:scale-[0.98] border ${bsRoundMode === 'floor' ? 'bg-slate-700 text-white border-slate-700 shadow-sm' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}
                                            >
                                                A favor de la tienda
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                            <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2 leading-relaxed">
                                Ejemplo: cambio de $6.20 · billete $1 · redondeo Bs 1 a favor del cliente → la caja entrega <strong>$6 + Bs 16</strong>.
                            </p>
                        </SectionCard>

                        {/* Avance de Efectivo */}
                        <SectionCard icon={DollarSign} title="Avance de Efectivo" subtitle="Servicio de retiro en caja con recargo" iconColor="text-amber-500">
                            <div className="space-y-3 flex flex-col justify-between h-full">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Habilitar Avances</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Permite entregar efectivo cobrando con tarjeta o transferencia</p>
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

                                {cashAdvanceEnabled ? (
                                    <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800/80 animate-in fade-in gap-3">
                                        <div>
                                            <p className="text-xs font-extrabold text-slate-700 dark:text-slate-200">Comisión por Servicio</p>
                                            <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">% recargo sumado al monto entregado</p>
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
                                ) : (
                                    <p className="text-[10px] text-slate-400 dark:text-slate-500 bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
                                        Active esta opción si su negocio ofrece el servicio de dar efectivo a clientes aplicando una comisión porcentual.
                                    </p>
                                )}
                            </div>
                        </SectionCard>
                    </div>

                    {/* Métodos de Pago */}
                    <SectionCard icon={CreditCard} title="Formas & Cuentas de Pago" subtitle="Configura las formas de pago y cuentas bancarias receptoras aceptadas en caja" iconColor="text-teal-600">
                        <PaymentMethodsManager triggerHaptic={triggerHaptic} />
                    </SectionCard>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════════ */}
            {/* SUB-PANEL 3: POLÍTICAS & CRÉDITO                       */}
            {/* ═══════════════════════════════════════════════════════ */}
            {activeSubTab === 'politicas' && (
                <div
                    id="panel-ventas-politicas"
                    role="tabpanel"
                    aria-labelledby="tab-ventas-politicas"
                    className="space-y-4 animate-in fade-in duration-200"
                >
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-stretch">
                        {/* Inventario & Carrito */}
                        <SectionCard icon={Package} title="Inventario en Caja" subtitle="Reglas de cobro y sincronización de existencias" iconColor="text-emerald-500">
                            <div className="divide-y divide-slate-100 dark:divide-slate-800">
                                <div className="flex items-center justify-between py-2.5">
                                    <div className="pr-2">
                                        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Vender sin Stock</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Permitir concretar ventas aunque el inventario esté en 0 o negativo</p>
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
                                <div className="flex items-center justify-between py-2.5">
                                    <div className="pr-2">
                                        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Cesta viva</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Reflejar cambios de catálogo (precio vigente) en los ítems ya agregados a la cesta</p>
                                    </div>
                                    <Toggle
                                        enabled={liveCartResync}
                                        onChange={() => {
                                            const newVal = !liveCartResync;
                                            setLiveCartResync(newVal);
                                            localStorage.setItem('cart_live_resync', newVal.toString());
                                            showToast(newVal ? 'La cesta reflejará el inventario vigente' : 'La cesta conservará el precio con el que se agregó cada ítem', 'success');
                                            triggerHaptic?.();
                                        }}
                                    />
                                </div>
                            </div>
                        </SectionCard>

                        {/* Cashea */}
                        <SectionCard icon={CasheaIcon} title="Financiamiento Cashea" subtitle="Cobros en cuotas para compras aprobadas" iconColor="text-purple-500">
                            <div className="space-y-3">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Activar Cashea</p>
                                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Muestra la opción de pago por cuotas en la pantalla de cobro</p>
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
                                                <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5">Límite mínimo en USD para habilitar Cashea</p>
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
                    </div>

                    {/* Cuentas por Cobrar & Fiados */}
                    <SectionCard icon={FileSpreadsheet} title="Cuentas por Cobrar & Auditoría de Fiados" subtitle="Tratamiento contable de deudas de clientes y conciliación del libro mayor" iconColor="text-indigo-500">
                        <div className="divide-y divide-slate-100 dark:divide-slate-800">
                            <div className="flex items-center justify-between py-2.5">
                                <div className="pr-2">
                                    <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Fiados y cobranzas en el reporte</p>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Presentar fiado otorgado, cobranzas cobradas y cartera deudora por separado en el cierre</p>
                                </div>
                                <Toggle
                                    enabled={fiadoSplit}
                                    onChange={() => {
                                        const newVal = !fiadoSplit;
                                        setFiadoSplit(newVal);
                                        localStorage.setItem('reportes_fiado_split', newVal.toString());
                                        showToast(newVal ? 'El reporte separará fiados y cobranzas' : 'El reporte volverá al desglose anterior', 'success');
                                        triggerHaptic?.();
                                    }}
                                />
                            </div>

                            <div className="flex items-center justify-between py-2.5">
                                <div className="pr-2">
                                    <div className="flex items-center gap-1.5">
                                        <p className="text-sm font-bold text-slate-700 dark:text-slate-200">Reparar cartera desde el ledger</p>
                                        <span className="text-[9px] font-extrabold uppercase px-1.5 py-0.2 bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 rounded border border-amber-300 dark:border-amber-800">Técnico</span>
                                    </div>
                                    <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Permite la reconstrucción de saldos cuando se detecte un descuadre contable (no para cajeros)</p>
                                </div>
                                <Toggle
                                    enabled={ledgerRepair}
                                    onChange={() => {
                                        const newVal = !ledgerRepair;
                                        setLedgerRepair(newVal);
                                        localStorage.setItem('reportes_reparacion_ledger', newVal.toString());
                                        showToast(newVal ? 'El reporte podrá reconstruir saldos desde el ledger' : 'La reconstrucción desde el ledger queda deshabilitada', 'success');
                                        triggerHaptic?.();
                                    }}
                                />
                            </div>
                        </div>
                    </SectionCard>
                </div>
            )}

            {/* ═══════════════════════════════════════════════════════ */}
            {/* SUB-PANEL 4: TICKETERA & HARDWARE                      */}
            {/* ═══════════════════════════════════════════════════════ */}
            {activeSubTab === 'ticketera' && (
                <div
                    id="panel-ventas-ticketera"
                    role="tabpanel"
                    aria-labelledby="tab-ventas-ticketera"
                    className="space-y-4 animate-in fade-in duration-200"
                >
                    <SectionCard
                        icon={Printer}
                        title="Configuración de Ticketera"
                        subtitle="Drivers USB/ESC-POS, formato de papel (58 mm / 80 mm) y calibración de impresión"
                        iconColor="text-teal-600"
                    >
                        <PrinterHardwareManager
                            paperWidth={paperWidth}
                            setPaperWidth={setPaperWidth}
                            showToast={showToast}
                            triggerHaptic={triggerHaptic}
                        />
                    </SectionCard>
                </div>
            )}
        </div>
    );
}
