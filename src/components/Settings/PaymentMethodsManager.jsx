import React, { useState, useEffect } from 'react';
import { Plus, Trash2, CreditCard, Banknote, Smartphone, DollarSign, Store, ShoppingCart, Package, Coins, Key, Fingerprint } from 'lucide-react';
import { getAllPaymentMethods, savePaymentMethods, togglePaymentMethodEnabled, setPaymentMethodRefMode, FACTORY_PAYMENT_METHODS, PAYMENT_ICONS, ICON_COMPONENTS, toTitleCase } from '../../config/paymentMethods';
import { showToast } from '../Toast';

const ICON_OPTIONS = [
    { key: 'Banknote', Icon: Banknote },
    { key: 'Smartphone', Icon: Smartphone },
    { key: 'CreditCard', Icon: CreditCard },
    { key: 'DollarSign', Icon: DollarSign },
    { key: 'Store', Icon: Store },
    { key: 'ShoppingCart', Icon: ShoppingCart },
    { key: 'Package', Icon: Package },
    { key: 'Coins', Icon: Coins },
    { key: 'Key', Icon: Key },
    { key: 'Fingerprint', Icon: Fingerprint },
];

export default function PaymentMethodsManager({ triggerHaptic }) {
    const [methods, setMethods] = useState([]);
    const [showAdd, setShowAdd] = useState(false);
    const [newLabel, setNewLabel] = useState('');
    const [newCurrency, setNewCurrency] = useState('BS');
    const [newIcon, setNewIcon] = useState('Banknote');

    const copEnabled = localStorage.getItem('cop_enabled') === 'true';

    useEffect(() => {
        getAllPaymentMethods().then(setMethods);
    }, []);

    const handleAdd = async () => {
        if (!newLabel.trim()) {
            showToast('Escribe un nombre para el método', 'error');
            return;
        }
        // Check for duplicate or very similar names
        const normalize = s => s.toLowerCase().trim().replace(/[áàä]/g,'a').replace(/[éèë]/g,'e').replace(/[íìï]/g,'i').replace(/[óòö]/g,'o').replace(/[úùü]/g,'u').replace(/\s+/g,' ');
        const newNorm = normalize(newLabel);
        const similar = methods.find(m => normalize(m.label) === newNorm);
        if (similar) {
            showToast(`Ya existe "${similar.label}" — usa un nombre diferente`, 'error');
            return;
        }
        triggerHaptic && triggerHaptic();
        const updated = [...methods, {
            id: 'custom_' + Date.now(),
            label: toTitleCase(newLabel.trim()),
            icon: newIcon,
            currency: newCurrency,
            isFactory: false,
        }];
        await savePaymentMethods(updated);
        // Rehidratar para el estado local del componente
        const hydrated = await getAllPaymentMethods();
        setMethods(hydrated);
        setNewLabel('');
        setShowAdd(false);
        showToast('Método de pago agregado', 'success');
    };

    const handleRemove = async (id) => {
        triggerHaptic && triggerHaptic();
        const updated = methods.filter(m => m.id !== id);
        await savePaymentMethods(updated);
        const hydrated = await getAllPaymentMethods();
        setMethods(hydrated);
        showToast('Método eliminado', 'success');
    };

    const handleToggleState = async (id) => {
        triggerHaptic && triggerHaptic();
        const updated = await togglePaymentMethodEnabled(id);
        setMethods(updated);
    };

    // Referencia de pago (últimos 4): No / Opcional / Obligatoria. El efectivo nunca la pide.
    const handleRefMode = async (id, mode) => {
        triggerHaptic && triggerHaptic();
        const updated = await setPaymentMethodRefMode(id, mode);
        setMethods(updated);
    };
    const REF_OPTIONS = [
        { id: 'none', label: 'No' },
        { id: 'optional', label: 'Opcional' },
        { id: 'required', label: 'Obligatoria' },
    ];

    const visibleMethods = methods.filter(m => !m.isVirtual);
    const methodsBs = visibleMethods.filter(m => m.currency === 'BS');
    const methodsUsd = visibleMethods.filter(m => m.currency === 'USD');
    const methodsCop = visibleMethods.filter(m => m.currency === 'COP');

    const renderMethod = (m) => {
        const isEnabled = m.isEnabled !== false;
        const esEfectivo = String(m.id).startsWith('efectivo');
        const refMode = m.refMode || 'none';
        return (
            <div key={m.id} className={`py-2.5 px-3 bg-white dark:bg-slate-900 rounded-xl border mb-2 transition-colors ${isEnabled ? 'border-emerald-200 dark:border-emerald-800 ring-1 ring-emerald-500/10' : 'border-slate-100 dark:border-slate-800 opacity-60'}`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5 flex-1 min-w-0">
                    {(() => { const MIcon = m.Icon || PAYMENT_ICONS[m.id] || ICON_COMPONENTS[m.icon]; return MIcon ? <MIcon size={18} className={isEnabled ? "text-emerald-500" : "text-slate-400"} /> : <span className="text-lg grayscale opacity-50">{m.icon}</span>; })()}
                    <span className={`text-sm font-bold truncate ${isEnabled ? 'text-slate-700 dark:text-slate-200' : 'text-slate-400 dark:text-slate-500 line-through decoration-slate-300 dark:decoration-slate-600'}`}>
                        {m.label}
                    </span>
                    {m.isFactory && (
                        <span className="text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 px-1.5 py-0.5 rounded shrink-0" title="Viene con la app">De fábrica</span>
                    )}
                </div>
                <div className="flex items-center gap-2 shrink-0 ml-2">
                    {/* Zona táctil de 44 px alrededor del interruptor (antes medía 20 px de alto). */}
                    <button
                        type="button"
                        role="switch"
                        aria-checked={isEnabled}
                        aria-label={`${isEnabled ? 'Desactivar' : 'Activar'} ${m.label}`}
                        onClick={() => handleToggleState(m.id)}
                        className="h-11 w-12 -my-2 flex items-center justify-center rounded-xl"
                    >
                        <span className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
                            isEnabled ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'
                        }`}>
                            <span className="inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform" style={{ transform: isEnabled ? 'translateX(18px)' : 'translateX(4px)' }} />
                        </span>
                    </button>
                    {!m.isFactory && (
                        <button
                            onClick={() => handleRemove(m.id)}
                            aria-label={`Eliminar ${m.label}`}
                            className="p-2.5 min-h-[40px] min-w-[40px] flex items-center justify-center text-red-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors ml-1"
                        >
                            <Trash2 size={16} />
                        </button>
                    )}
                </div>
              </div>
              {!esEfectivo && isEnabled && (
                <div className="mt-2 flex items-center justify-between gap-2" role="group" aria-label={`Referencia de ${m.label}`}>
                    <span className="text-xs font-bold text-slate-500 dark:text-slate-400">Pide referencia (últimos 4)</span>
                    <div className="inline-flex rounded-[10px] border border-slate-200 dark:border-slate-700 overflow-hidden shrink-0">
                        {REF_OPTIONS.map(opt => (
                            <button
                                key={opt.id}
                                type="button"
                                onClick={() => handleRefMode(m.id, opt.id)}
                                aria-pressed={refMode === opt.id}
                                className={`min-h-[36px] px-2.5 text-xs font-black transition-colors ${refMode === opt.id
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'}`}
                            >{opt.label}</button>
                        ))}
                    </div>
                </div>
              )}
            </div>
        );
    };

    return (
        <div className="space-y-4">
            <div className="flex items-center justify-between">
                <h3 className="text-sm font-black text-slate-700 dark:text-slate-200 flex items-center gap-2">
                    <CreditCard size={16} /> Métodos de Pago
                </h3>
                <button
                    onClick={() => setShowAdd(!showAdd)}
                    className="px-3 py-2 min-h-[40px] rounded-xl text-xs font-bold text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-900/20 flex items-center gap-1 hover:bg-emerald-100 dark:hover:bg-emerald-900/40"
                >
                    <Plus size={14} /> Agregar
                </button>
            </div>

            {/* Formulario agregar */}
            {showAdd && (
                <div className="p-3 bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 rounded-xl space-y-3">
                    <input
                        type="text"
                        value={newLabel}
                        onChange={e => setNewLabel(e.target.value)}
                        placeholder="Nombre del método..."
                        className="w-full py-2.5 px-3 rounded-lg border border-emerald-200 dark:border-emerald-700 bg-white dark:bg-slate-900 text-sm font-bold text-slate-700 dark:text-white outline-none focus:ring-2 focus:ring-emerald-500/30"
                    />
                    <div className="flex flex-wrap gap-2">
                        <button
                            onClick={() => setNewCurrency('BS')}
                            className={`flex-1 min-w-[120px] py-2 rounded-lg text-xs font-black transition-all ${newCurrency === 'BS' ? 'bg-brand text-white' : 'bg-white dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'}`}
                        >
                            Bolívares (Bs)
                        </button>
                        <button
                            onClick={() => setNewCurrency('USD')}
                            className={`flex-1 min-w-[120px] py-2 rounded-lg text-xs font-black transition-all ${newCurrency === 'USD' ? 'bg-emerald-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'}`}
                        >
                            Dólares ($)
                        </button>
                        {copEnabled && (
                            <button
                                onClick={() => setNewCurrency('COP')}
                                className={`flex-1 min-w-[120px] py-2 rounded-lg text-xs font-black transition-all ${newCurrency === 'COP' ? 'bg-amber-500 text-white' : 'bg-white dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'}`}
                            >
                                Pesos (COP)
                            </button>
                        )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                        {ICON_OPTIONS.map(({ key, Icon }) => (
                            <button
                                key={key}
                                onClick={() => setNewIcon(key)}
                                className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all ${newIcon === key ? 'bg-emerald-500 text-white ring-2 ring-emerald-300 scale-110' : 'bg-white dark:bg-slate-800 text-slate-500 border border-slate-200 dark:border-slate-700'}`}
                            >
                                <Icon size={20} />
                            </button>
                        ))}
                    </div>
                    <button
                        onClick={handleAdd}
                        className="w-full py-2.5 bg-emerald-500 text-white font-bold text-sm rounded-xl hover:bg-emerald-600 transition-colors active:scale-[0.98]"
                    >
                        Guardar Método
                    </button>
                </div>
            )}

            {/* Sección Dólares */}
            {methodsUsd.length > 0 && (
                <div>
                    <p className="text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-2">Dólares ($)</p>
                    {methodsUsd.map(renderMethod)}
                </div>
            )}

            {/* Sección Bolívares */}
            {methodsBs.length > 0 && (
                <div>
                    <p className="text-[10px] font-black text-brand uppercase tracking-widest mb-2">Bolívares (Bs)</p>
                    {methodsBs.map(renderMethod)}
                </div>
            )}

            {/* Sección COP */}
            {copEnabled && methodsCop.length > 0 && (
                <div>
                    <p className="text-[10px] font-black text-amber-500 uppercase tracking-widest mb-2 mt-4">Pesos Colombianos (COP)</p>
                    {methodsCop.map(renderMethod)}
                </div>
            )}
        </div>
    );
}
