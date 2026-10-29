import React, { useState, useEffect, useMemo } from 'react';
import { X, Truck, Save, Pencil, FileText, CreditCard, Clock, Phone, Trash2, ArrowUpRight, CheckCircle2, Download, Ban, Search } from 'lucide-react';
import { getLocalISODate } from '../../utils/dateHelpers';
import { formatUsd, formatBs, formatCop } from '../../utils/calculatorUtils';
import CustomSelect from '../CustomSelect';
import { filterActivityByRange, REPORT_RANGE_OPTIONS, resolveReportRange, rangeLabel } from '../../utils/supplierReportRange';
import { allocatePaymentsToInvoices } from '../../utils/supplierAllocation';
import { compressImage, getInvoicePhotoUrl } from '../../utils/invoicePhotos';
import { matchesSearch as matchesSearchFields } from '../../utils/searchMatch';

/** Miniatura de la foto de una factura (solo local). */
function InvoicePhotoThumb({ invoiceId, invoiceNumber }) {
    const [url, setUrl] = useState(null);
    const [showFull, setShowFull] = useState(false);
    useEffect(() => {
        let alive = true;
        let objectUrl = null;
        getInvoicePhotoUrl(invoiceId).then(u => { if (alive) { objectUrl = u; setUrl(u); } }).catch(() => {});
        return () => { alive = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
    }, [invoiceId]);
    if (!url) return null;
    return (
        <>
            <button
                type="button"
                onClick={() => setShowFull(true)}
                title="Ver foto"
                className="shrink-0 w-10 h-10 rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 hover:ring-2 hover:ring-teal-500/50 transition-all"
            >
                <img src={url} alt="Factura" className="w-full h-full object-cover" />
            </button>
            <a
                href={url}
                download={`factura-${invoiceNumber || invoiceId}.jpg`}
                title="Descargar foto"
                className="shrink-0 p-2 rounded-lg text-brand-dark dark:text-brand bg-slate-100 dark:bg-slate-800"
            >
                <Download size={14} />
            </a>
            {showFull && (
                <div className="fixed inset-0 z-[80] bg-black/90 flex items-center justify-center p-4" onClick={() => setShowFull(false)}>
                    <img src={url} alt="Factura" className="max-w-full max-h-full rounded-xl" />
                    <button className="absolute top-4 right-4 p-2 bg-white/20 text-white rounded-full" onClick={() => setShowFull(false)}>
                        <X size={20} />
                    </button>
                </div>
            )}
        </>
    );
}

export function AddSupplierModal({ onClose, onSave, editingSupplier = null }) {
    const [name, setName] = useState(editingSupplier?.name || '');
    const [documentId, setDocumentId] = useState(editingSupplier?.documentId || '');
    const [phone, setPhone] = useState(editingSupplier?.phone || '');
    const [contactName, setContactName] = useState(editingSupplier?.contactName || '');

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        
        const supplierData = {
            id: editingSupplier?.id || crypto.randomUUID(),
            name: name.trim(),
            documentId: documentId.trim(),
            phone: phone.trim(),
            contactName: contactName.trim(),
            deuda: editingSupplier ? editingSupplier.deuda : 0,
            createdAt: editingSupplier?.createdAt || new Date().toISOString()
        };
        onSave(supplierData);
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-t-3xl sm:rounded-3xl shadow-xl overflow-hidden animate-in slide-in-from-bottom-10 sm:zoom-in-95 duration-200">
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center bg-slate-50 dark:bg-slate-800/50">
                    <h3 className="text-xl font-black text-slate-800 dark:text-white flex items-center gap-2">
                        {editingSupplier ? <Pencil size={20} className="text-brand" /> : <Truck size={20} className="text-brand" />}
                        {editingSupplier ? 'Editar Proveedor' : 'Nuevo Proveedor'}
                    </h3>
                    <button onClick={onClose} className="p-2 text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-full transition-colors">
                        <X size={20} />
                    </button>
                </div>
                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Nombre de Empresa/Proveedor *</label>
                        <input type="text" required value={name} onChange={(e) => setName(e.target.value)} className="w-full form-input bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-brand/50 transition-all" placeholder="Ej: Distribuidora Polar" autoFocus />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">RIF / Documento</label>
                        <input type="text" value={documentId} onChange={(e) => setDocumentId(e.target.value)} className="w-full form-input bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-brand/50 transition-all" placeholder="Ej: J-123456789" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Teléfono</label>
                        <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full form-input bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-brand/50 transition-all" placeholder="Ej: 0414-1234567" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Persona de Contacto (Opcional)</label>
                        <input type="text" value={contactName} onChange={(e) => setContactName(e.target.value)} className="w-full form-input bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 text-sm font-bold text-slate-800 dark:text-white focus:ring-2 focus:ring-brand/50 transition-all" placeholder="Ej: Juan Pérez" />
                    </div>
                    <button type="submit" disabled={!name.trim()} className="w-full py-3.5 bg-brand-dark hover:bg-brand-dark disabled:bg-brand-dark/50 text-white font-bold rounded-xl active:scale-95 transition-all text-sm flex justify-center items-center gap-2 mt-4">
                        <Save size={18} /> {editingSupplier ? 'Guardar Cambios' : 'Guardar Proveedor'}
                    </button>
                </form>
            </div>
        </div>
    );
}

function SupplierRateToggle({ useBcvRate, onChange, bcvRate, systemRate }) {
    const activeRate = useBcvRate ? bcvRate : systemRate;
    const sourceLabel = useBcvRate ? 'BCV real' : 'tasa del sistema';

    return (
        <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 px-3 py-2">
            <div className="min-w-0">
                <span className="block text-xs font-bold text-slate-700 dark:text-slate-200">Usar tasa BCV real</span>
                <span className="block text-[10px] text-slate-500">Tasa aplicada: {sourceLabel} · {formatBs(activeRate)} Bs/USD</span>
            </div>
            <label className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center cursor-pointer select-none shrink-0">
                <input type="checkbox" checked={useBcvRate} onChange={e => onChange(e.target.checked)} aria-label="Usar tasa BCV real" disabled={!(bcvRate > 0)} className="sr-only peer" />
                <span className="relative w-11 h-6 rounded-full bg-slate-300 dark:bg-slate-700 transition-colors peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-brand peer-checked:bg-brand after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border after:border-slate-300 after:rounded-full after:h-5 after:w-5 after:transition-transform peer-checked:after:translate-x-full peer-disabled:opacity-50" />
            </label>
        </div>
    );
}

export function AddInvoiceModal({ supplier, bcvRate, systemRate = bcvRate, copEnabled = false, activePaymentMethods = [], onClose, onSave }) {
    const [invoiceNumber, setInvoiceNumber] = useState('');
    // «Ya la pagué»: la factura nace saldada (gasto registrado, sin deuda).
    // Por defecto es un pago externo: lo típico es cargar un gasto ya hecho.
    const [alreadyPaid, setAlreadyPaid] = useState(false);
    const [payCurrency, setPayCurrency] = useState('USD');
    const [paymentMethod, setPaymentMethod] = useState('efectivo_usd');
    const [retiraCaja, setRetiraCaja] = useState(false);
    const [amountUsd, setAmountUsd] = useState('');
    const [useBcvRate, setUseBcvRate] = useState(true);
    const rateType = useBcvRate ? 'bcv' : 'system';
    const activeRate = useBcvRate ? bcvRate : systemRate;
    // Fecha de la factura (YYYY-MM-DD local). Por defecto hoy; permite cargar facturas pasadas.
    const [invoiceDate, setInvoiceDate] = useState(() => getLocalISODate());
    const [dueDate, setDueDate] = useState('');
    const [photoBlob, setPhotoBlob] = useState(null);
    const [photoPreview, setPhotoPreview] = useState(null);
    const paymentMethodOptions = activePaymentMethods.filter(m => m.currency === payCurrency);

    // Plazo en días: calcula la fecha de vencimiento a partir de la fecha de la factura.
    const setDueInDays = (days) => {
        const base = new Date(`${invoiceDate}T12:00:00`);
        base.setDate(base.getDate() + days);
        setDueDate(getLocalISODate(base));
    };

    const handlePhotoSelect = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const compressed = await compressImage(file);
            setPhotoBlob(compressed);
            setPhotoPreview(URL.createObjectURL(compressed));
        } catch {
            // Si falla la compresión, se usa el archivo original
            setPhotoBlob(file);
            setPhotoPreview(URL.createObjectURL(file));
        }
        e.target.value = '';
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!invoiceNumber || !amountUsd || parseFloat(amountUsd) <= 0 || !invoiceDate) return;

        const invoiceData = {
            id: crypto.randomUUID(),
            supplierId: supplier.id,
            invoiceNumber: invoiceNumber.trim(),
            // Mediodía local: evita que la fecha caiga en el día anterior al convertir a ISO.
            date: new Date(`${invoiceDate}T12:00:00`).toISOString(),
            // Una factura pagada no vence: se ignora el plazo aunque se haya llenado antes.
            dueDate: alreadyPaid ? null : (dueDate || null),
            amountUsd: parseFloat(amountUsd),
            amountBs: parseFloat(amountUsd) * activeRate,
            rateType,
            exchangeRate: activeRate,
            status: 'PENDIENTE',
            amountPaidUsd: 0,
            type: 'INVOICE',
            hasPhoto: !!photoBlob,
            _photoBlob: photoBlob, // temporal: el hook la guarda en IndexedDB y la quita del registro
        };
        // El selector muestra el primer medio si el elegido no es de esta moneda: se guarda ese mismo.
        const effectiveMethod = paymentMethodOptions.some(m => m.id === paymentMethod)
            ? paymentMethod
            : (paymentMethodOptions[0]?.id || paymentMethod);
        onSave(invoiceData, alreadyPaid
            ? { paymentMethod: effectiveMethod, currencyMode: payCurrency, retiraCaja }
            : null);
    };

    const switchPayCurrency = (currency, defaultMethod) => {
        setPayCurrency(currency);
        setPaymentMethod(defaultMethod);
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-5 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
                        <FileText size={18} className="text-red-500" /> Cargar Factura
                    </h3>
                    <button onClick={onClose} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-full"><X size={18} /></button>
                </div>
                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <p className="text-xs text-slate-500 -mt-2 mb-2">Registrar deuda con: <strong>{supplier.name}</strong></p>
                    
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Nro Control / Factura *</label>
                        <input type="text" required value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} className="w-full form-input border rounded-xl px-3 py-2 text-sm font-bold dark:bg-slate-950" autoFocus />
                    </div>
                    <div>
                        <div className="mb-2 flex items-center justify-between gap-2">
                            <label className="block text-xs font-bold text-slate-400 uppercase">Monto Total a Pagar (USD) *</label>
                        </div>
                        <SupplierRateToggle useBcvRate={useBcvRate} onChange={setUseBcvRate} bcvRate={bcvRate} systemRate={systemRate} />
                        <div className="relative mt-2">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 font-black text-slate-400 pointer-events-none select-none z-10">USD</span>
                            <input type="number" required min="0.01" step="0.01" value={amountUsd} onChange={e => setAmountUsd(e.target.value)} className="w-full form-input border rounded-xl px-3 py-2 pl-14 text-lg font-black dark:bg-slate-950" />
                        </div>
                        {amountUsd && activeRate > 0 && <p className="text-[10px] text-slate-500 mt-1 text-right">Equivale a {formatBs(parseFloat(amountUsd) * activeRate)} Bs</p>}
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Fecha de la factura *</label>
                        <input type="date" required value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} className="w-full form-input border rounded-xl px-3 py-2 text-sm font-bold dark:bg-slate-950 text-slate-700 dark:text-white" />
                    </div>
                    <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800/80">
                        <div className="text-left">
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block">Ya la pagué</span>
                            <span className="text-[9px] text-slate-400 block leading-tight">
                                {alreadyPaid
                                    ? 'Queda saldada y cuenta como gasto del mes. No suma a la deuda.'
                                    : 'Si ya la pagaste, regístrala como gasto sin crear deuda.'}
                            </span>
                        </div>
                        <label className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center cursor-pointer select-none shrink-0">
                            <input type="checkbox" checked={alreadyPaid} onChange={e => setAlreadyPaid(e.target.checked)} aria-label="Ya la pagué" className="sr-only peer" />
                            <div className="relative w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                        </label>
                    </div>

                    {alreadyPaid && (
                        <div className="space-y-3">
                            <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                                <button type="button" onClick={() => switchPayCurrency('BS', 'efectivo_bs')} className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${payCurrency === 'BS' ? 'bg-white shadow text-brand' : 'text-slate-500'}`}>Bs</button>
                                <button type="button" onClick={() => switchPayCurrency('USD', 'efectivo_usd')} className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${payCurrency === 'USD' ? 'bg-white shadow text-emerald-500' : 'text-slate-500'}`}>USD</button>
                                {copEnabled && (
                                    <button type="button" onClick={() => switchPayCurrency('COP', 'efectivo_cop')} className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${payCurrency === 'COP' ? 'bg-white shadow text-amber-500' : 'text-slate-500'}`}>COP</button>
                                )}
                            </div>
                            <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800/80">
                                <div className="text-left">
                                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block">¿Salió de la Caja?</span>
                                    <span className="text-[9px] text-slate-400 block leading-tight">
                                        {retiraCaja
                                            ? 'Se registra como egreso en el arqueo diario.'
                                            : 'Pago con fondos externos. No altera el arqueo de caja.'}
                                    </span>
                                </div>
                                <label className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center cursor-pointer select-none shrink-0">
                                    <input type="checkbox" checked={retiraCaja} onChange={e => setRetiraCaja(e.target.checked)} aria-label="Salió de la Caja" className="sr-only peer" />
                                    <div className="relative w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                                </label>
                            </div>
                            {retiraCaja && (
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 uppercase tracking-wider block">Medio de Pago</label>
                                    <CustomSelect
                                        value={paymentMethodOptions.some(m => m.id === paymentMethod) ? paymentMethod : (paymentMethodOptions[0]?.id || '')}
                                        onChange={setPaymentMethod}
                                        options={paymentMethodOptions.map(method => ({ value: method.id, label: method.label }))}
                                    />
                                </div>
                            )}
                        </div>
                    )}

                    {!alreadyPaid && (
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Plazo de pago</label>
                        <div className="flex gap-2 mb-2">
                            {[7, 15, 30].map((d) => (
                                <button key={d} type="button" onClick={() => setDueInDays(d)} className="flex-1 py-2 rounded-xl border text-xs font-bold hover:bg-slate-50 dark:hover:bg-slate-800">{d} días</button>
                            ))}
                        </div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Fecha Vencimiento (Opcional)</label>
                        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full form-input border rounded-xl px-3 py-2 text-sm font-bold dark:bg-slate-950 text-slate-700 dark:text-white" />
                    </div>
                    )}

                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Foto de Factura <span className="normal-case font-medium">(opcional, solo en este equipo)</span></label>
                        {photoPreview ? (
                            <div className="relative">
                                <img src={photoPreview} alt="Factura" className="w-full h-32 object-cover rounded-xl border border-slate-200 dark:border-slate-700" />
                                <button type="button" onClick={() => { setPhotoBlob(null); setPhotoPreview(null); }} className="absolute top-2 right-2 p-1 bg-white/90 rounded-full text-slate-600"><X size={14} /></button>
                            </div>
                        ) : (
                            <label className="block w-full py-3 text-center rounded-xl border border-dashed text-xs font-bold text-slate-500 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">
                                Adjuntar foto
                                <input type="file" accept="image/*" capture="environment" onChange={handlePhotoSelect} className="hidden" />
                            </label>
                        )}
                    </div>

                    <button type="submit" disabled={!invoiceNumber || !amountUsd || parseFloat(amountUsd) <= 0 || !invoiceDate} className="w-full py-3 bg-red-500 hover:bg-red-600 disabled:bg-red-500/50 text-white font-bold rounded-xl active:scale-95 transition-all text-sm flex justify-center items-center gap-2 mt-4">
                        {alreadyPaid ? 'Registrar Factura Pagada' : 'Registrar Deuda'}
                    </button>
                </form>
            </div>
        </div>
    );
}

export function PayInvoiceModal({ supplier, bcvRate, systemRate = bcvRate, tasaCop, copEnabled, copPrimary, activePaymentMethods = [], invoices = [], payments = [], onClose, onSave }) {
    const [amount, setAmount] = useState('');
    const [useBcvRate, setUseBcvRate] = useState(true);
    const [currencyMode, setCurrencyMode] = useState('BS');
    const rateType = useBcvRate ? 'bcv' : 'system';
    const activeRate = useBcvRate ? bcvRate : systemRate;
    const [paymentMethod, setPaymentMethod] = useState('efectivo_bs');
    const [retiraCaja, setRetiraCaja] = useState(true);
    const [allocationMode, setAllocationMode] = useState('FIFO');
    const [invoiceId, setInvoiceId] = useState('');
    const [invoiceSearch, setInvoiceSearch] = useState('');
    // Calcula los saldos con todo el historial para que el rango del estado de cuenta no afecte pagos.
    const { byInvoice } = allocatePaymentsToInvoices(invoices, payments);
    const openInvoices = invoices
        .filter(i => (byInvoice.get(i.id)?.remainingUsd ?? 0) > 0)
        .map(i => ({ ...i, remaining: byInvoice.get(i.id).remainingUsd }))
        .sort((a, b) => new Date(a.date || a.timestamp) - new Date(b.date || b.timestamp));
    const selectedInvoice = openInvoices.find(invoice => invoice.id === invoiceId);
    const maxPaymentUsd = Math.max(0, Math.min(
        Number(supplier.deuda) || 0,
        allocationMode === 'INVOICE' ? (selectedInvoice?.remaining ?? 0) : (Number(supplier.deuda) || 0),
    ));
    const rawAmount = Number.parseFloat(amount);
    let amountUsdPreview = rawAmount;
    if (currencyMode === 'BS' && activeRate > 0) amountUsdPreview = rawAmount / activeRate;
    if (currencyMode === 'COP' && tasaCop > 0) amountUsdPreview = rawAmount / tasaCop;
    const exceedsLimit = Number.isFinite(amountUsdPreview) && amountUsdPreview > maxPaymentUsd + 0.005;
    const filteredInvoices = openInvoices.filter(invoice => matchesSearchFields(
        [invoice.invoiceNumber, getLocalISODate(new Date(invoice.date || invoice.timestamp))],
        invoiceSearch,
    ));

    const fillMaxPayment = () => {
        if (!(maxPaymentUsd > 0)) return;
        setAmount(currencyMode === 'BS'
            ? (maxPaymentUsd * activeRate).toFixed(2)
            : currencyMode === 'COP'
                ? (maxPaymentUsd * tasaCop).toFixed(2)
                : maxPaymentUsd.toFixed(2));
    };

    const handleSave = (e) => {
        e.preventDefault();
        const rawAmt = Number.parseFloat(amount);
        if (!Number.isFinite(rawAmt) || rawAmt <= 0) return;

        let amountUsd = rawAmt;
        if (currencyMode === 'BS' && activeRate > 0) amountUsd = rawAmt / activeRate;
        if (currencyMode === 'COP' && tasaCop > 0) amountUsd = rawAmt / tasaCop;
        const amountBs = currencyMode === 'BS' ? rawAmt : (amountUsd * activeRate);
        const amountCop = currencyMode === 'COP' ? rawAmt : (amountUsd * tasaCop);
        const allowedUsd = Math.max(0, Math.min(
            Number(supplier.deuda) || 0,
            allocationMode === 'INVOICE' ? (selectedInvoice?.remaining ?? 0) : (Number(supplier.deuda) || 0),
        ));
        if (allocationMode === 'INVOICE' && !selectedInvoice) return;
        if (amountUsd > allowedUsd + 0.005) return;

        onSave({
            amountUsd,
            amountBs,
            amountCop,
            exchangeRate: activeRate,
            rateType,
            paymentMethod: retiraCaja ? paymentMethod : 'pago_externo',
            currencyMode,
            retiraCaja,
            invoiceId: allocationMode === 'INVOICE' ? invoiceId : null,
        });
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200">
            <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200">
                <div className="p-5 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
                        <CreditCard size={18} className="text-emerald-500" /> Pagar a Proveedor
                    </h3>
                    <button onClick={onClose} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-full"><X size={18} /></button>
                </div>
                <form onSubmit={handleSave} className="p-5 space-y-4 max-h-[calc(90vh-5rem)] max-h-[calc(90dvh-5rem)] overflow-y-auto">
                    <p className="text-xs text-slate-500 -mt-2 mb-2">Deuda total: <strong>{copEnabled && copPrimary && tasaCop > 0 ? `${formatCop(supplier.deuda * tasaCop)} COP · USD ${formatUsd(supplier.deuda)}` : `USD ${formatUsd(supplier.deuda)}`}{copEnabled && !copPrimary && tasaCop > 0 ? ` · ${formatCop(supplier.deuda * tasaCop)} COP` : ''}</strong></p>

                    <div>
                        <label className="block text-[10px] font-black text-slate-400 uppercase tracking-wider mb-1">Aplicar pago</label>
                        <div className="grid grid-cols-2 gap-2">
                            <button type="button" onClick={() => { setAllocationMode('FIFO'); setInvoiceId(''); setInvoiceSearch(''); }} aria-label="Automático FIFO" aria-pressed={allocationMode === 'FIFO'} className={`rounded-xl border px-3 py-2 text-xs font-bold ${allocationMode === 'FIFO' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}`}>Automático (FIFO)</button>
                            <button type="button" onClick={() => { setAllocationMode('INVOICE'); setInvoiceId(''); setInvoiceSearch(''); }} aria-label="Factura específica" aria-pressed={allocationMode === 'INVOICE'} className={`rounded-xl border px-3 py-2 text-xs font-bold ${allocationMode === 'INVOICE' ? 'border-emerald-500 bg-emerald-50 text-emerald-700' : 'border-slate-200 text-slate-500'}`}>Factura específica</button>
                        </div>
                        {allocationMode === 'FIFO' ? (
                            <p className="mt-1.5 text-[10px] text-slate-500">Se distribuirá desde la factura pendiente más antigua. Máximo: USD {formatUsd(maxPaymentUsd)}.</p>
                        ) : openInvoices.length === 0 ? (
                            <p className="mt-2 rounded-lg bg-amber-50 p-2 text-[10px] text-amber-700">No hay facturas pendientes disponibles.</p>
                        ) : (
                            <div className="mt-2 space-y-2">
                                <label className="relative block">
                                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                    <input type="search" value={invoiceSearch} onChange={e => setInvoiceSearch(e.target.value)} placeholder="Buscar número de factura" aria-label="Buscar factura" className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs dark:bg-slate-950" />
                                </label>
                                <div className="max-h-36 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
                                    {filteredInvoices.map(invoice => (
                                        <button key={invoice.id} type="button" onClick={() => { setInvoiceId(invoice.id); setAmount(currencyMode === 'BS' ? (invoice.remaining * activeRate).toFixed(2) : currencyMode === 'COP' ? (invoice.remaining * tasaCop).toFixed(2) : invoice.remaining.toFixed(2)); }} className={`w-full border-b border-slate-100 px-3 py-2 text-left last:border-b-0 dark:border-slate-800 ${invoiceId === invoice.id ? 'bg-emerald-50 dark:bg-emerald-950/30' : 'hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
                                            <span className="block text-xs font-bold text-slate-700 dark:text-slate-200">Factura #{invoice.invoiceNumber || '—'} · saldo USD {formatUsd(invoice.remaining)}</span>
                                            <span className="block text-[10px] text-slate-400">{new Date(invoice.date || invoice.timestamp).toLocaleDateString('es-VE')}{invoice.dueDate ? ` · Vence ${new Date(`${invoice.dueDate}T12:00:00`).toLocaleDateString('es-VE')}` : ''}</span>
                                        </button>
                                    ))}
                                    {filteredInvoices.length === 0 && <p className="p-3 text-center text-[10px] text-slate-400">No se encontraron facturas</p>}
                                </div>
                                {selectedInvoice && <p className="text-[10px] font-bold text-emerald-700">Saldo máximo de esta factura: USD {formatUsd(maxPaymentUsd)}</p>}
                                {!selectedInvoice && <p className="text-[10px] text-amber-700">Selecciona una factura pendiente para continuar.</p>}
                            </div>
                        )}
                    </div>

                    <SupplierRateToggle useBcvRate={useBcvRate} onChange={setUseBcvRate} bcvRate={bcvRate} systemRate={systemRate} />

                    {/* Moneda */}
                    <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
                        <button type="button" onClick={() => { setCurrencyMode('BS'); setAmount(''); setPaymentMethod('efectivo_bs'); }} className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${currencyMode === 'BS' ? 'bg-white shadow text-brand' : 'text-slate-500'}`}>Bs</button>
                        <button type="button" onClick={() => { setCurrencyMode('USD'); setAmount(''); setPaymentMethod('efectivo_usd'); }} className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${currencyMode === 'USD' ? 'bg-white shadow text-emerald-500' : 'text-slate-500'}`}>USD</button>
                        {copEnabled && (
                            <button type="button" onClick={() => { setCurrencyMode('COP'); setAmount(''); setPaymentMethod('efectivo_cop'); }} className={`flex-1 py-1.5 text-xs font-bold rounded-lg transition-all ${currencyMode === 'COP' ? 'bg-white shadow text-amber-500' : 'text-slate-500'}`}>COP</button>
                        )}
                    </div>

                    {/* Input */}
                    <div>
                        <div className="relative">
                            <span className={`absolute left-4 top-1/2 -translate-y-1/2 font-black text-lg pointer-events-none select-none z-10 ${currencyMode === 'BS' ? 'text-brand' : currencyMode === 'COP' ? 'text-amber-500' : 'text-emerald-500'}`}>
                                {currencyMode === 'BS' ? 'Bs' : currencyMode === 'COP' ? 'COP' : 'USD'}
                            </span>
                            <input 
                                type="number" 
                                step="0.01" 
                                required 
                                placeholder="0.00"
                                value={amount} 
                                onChange={e => setAmount(e.target.value)} 
                                className={`w-full bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl py-3 pr-4 text-2xl font-black text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-brand/50 transition-all ${
                                    currencyMode === 'BS' ? 'pl-12' : 'pl-16'
                                }`} 
                                autoFocus 
                            />
                        </div>
                        {amount && activeRate > 0 && (
                            <div className="mt-2 text-right">
                                <p className="text-[10px] text-slate-500">
                                    Equivale a {currencyMode === 'BS' ? `USD ${formatUsd(parseFloat(amount)/activeRate)}` : currencyMode === 'COP' ? `USD ${formatUsd(parseFloat(amount)/tasaCop)}` : `${formatBs(parseFloat(amount)*activeRate)} Bs`}
                                </p>
                                {currencyMode !== 'COP' && copEnabled && tasaCop > 0 && (
                                     <p className="text-[10px] text-slate-500">
                                         • {currencyMode === 'BS' ? ((parseFloat(amount)/activeRate) * tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : (parseFloat(amount)*tasaCop).toLocaleString('es-CO', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} COP
                                     </p>
                                )}
                            </div>
                        )}
                        {maxPaymentUsd > 0 && (
                            <button type="button" onClick={fillMaxPayment} className="mt-2 w-full text-xs font-bold text-emerald-600 bg-emerald-50 py-1.5 rounded border border-emerald-200">
                                Pagar saldo completo · USD {formatUsd(maxPaymentUsd)}
                            </button>
                        )}
                        {exceedsLimit && <p role="alert" className="mt-2 text-xs font-bold text-red-600">El pago supera el máximo permitido de USD {formatUsd(maxPaymentUsd)}. Reduce el monto para continuar.</p>}
                        {allocationMode === 'INVOICE' && !selectedInvoice && <p role="alert" className="mt-2 text-xs font-bold text-red-600">Selecciona una factura pendiente antes de procesar el pago.</p>}
                    </div>

                    {/* Switch Retirar de Caja */}
                    <div className="flex items-center justify-between bg-slate-50 dark:bg-slate-800/40 p-3 rounded-xl border border-slate-100 dark:border-slate-800/80">
                        <div className="text-left">
                            <span className="text-xs font-bold text-slate-700 dark:text-slate-200 block">¿Descontar de Caja Chica?</span>
                            <span className="text-[9px] text-slate-400 block leading-tight">
                                {retiraCaja 
                                    ? 'El pago se registrará como egreso en el arqueo diario.' 
                                    : 'Pago con fondos externos. No altera el arqueo de caja.'}
                            </span>
                        </div>
                        <label className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center cursor-pointer select-none shrink-0">
                            <input 
                                type="checkbox" 
                                checked={retiraCaja} 
                                onChange={e => setRetiraCaja(e.target.checked)} 
                                className="sr-only peer" 
                            />
                            <div className="relative w-11 h-6 bg-slate-200 dark:bg-slate-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-emerald-500"></div>
                        </label>
                    </div>

                    {/* Método de pago */}
                    {retiraCaja ? (
                        (() => {
                            const filteredMethods = activePaymentMethods.filter(m => m.currency === currencyMode);
                            return (
                                <div className="space-y-1">
                                    <label className="text-[10px] font-bold text-slate-400 dark:text-slate-505 uppercase tracking-wider block">Medio de Pago</label>
                                    <CustomSelect
                                        value={filteredMethods.some(m => m.id === paymentMethod) ? paymentMethod : (filteredMethods[0]?.id || '')}
                                        onChange={setPaymentMethod}
                                        options={filteredMethods.map(method => ({
                                            value: method.id,
                                            label: method.label
                                        }))}
                                    />
                                </div>
                            );
                        })()
                    ) : (
                        <div className="bg-amber-50 dark:bg-amber-900/10 border border-amber-200/50 dark:border-amber-800/30 p-3 rounded-xl text-left">
                            <p className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                                ℹ️ Este pago disminuirá el saldo adeudado al proveedor en su estado de cuenta, pero no registrará salidas de efectivo en la caja registradora de hoy.
                            </p>
                        </div>
                    )}

                    <button type="submit" disabled={!amount || !Number.isFinite(rawAmount) || rawAmount <= 0 || exceedsLimit || (allocationMode === 'INVOICE' && !selectedInvoice)} className="w-full py-3 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/50 text-white font-bold rounded-xl active:scale-95 transition-all text-sm flex justify-center items-center gap-2 mt-4">
                        Procesar Pago
                    </button>
                </form>
            </div>
        </div>
    );
}

/** Edita una factura: número, monto, fechas y foto. El monto ajusta la deuda en el hook. */
export function EditInvoiceModal({ invoice, onClose, onSave }) {
    const [invoiceNumber, setInvoiceNumber] = useState(invoice.invoiceNumber || '');
    const [amountUsd, setAmountUsd] = useState(String(invoice.amountUsd ?? ''));
    const [invoiceDate, setInvoiceDate] = useState(() => getLocalISODate(new Date(invoice.date)));
    const [dueDate, setDueDate] = useState(invoice.dueDate || '');
    const [photoBlob, setPhotoBlob] = useState(undefined); // undefined = sin cambio
    const [photoPreview, setPhotoPreview] = useState(null);
    const [photoRemoved, setPhotoRemoved] = useState(false);

    const amount = parseFloat(amountUsd) || 0;
    const valid = invoiceNumber.trim() && amount > 0 && invoiceDate;

    const handlePhotoSelect = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        try {
            const compressed = await compressImage(file);
            setPhotoBlob(compressed);
            setPhotoPreview(URL.createObjectURL(compressed));
        } catch {
            setPhotoBlob(file);
            setPhotoPreview(URL.createObjectURL(file));
        }
        setPhotoRemoved(false);
        e.target.value = '';
    };

    const handleSubmit = (e) => {
        e.preventDefault();
        if (!valid) return;
        const patch = {
            invoiceNumber: invoiceNumber.trim(),
            amountUsd: amount,
            date: new Date(`${invoiceDate}T12:00:00`).toISOString(),
            dueDate: dueDate || null,
        };
        if (photoBlob !== undefined) patch.newPhotoBlob = photoBlob;
        else if (photoRemoved) patch.newPhotoBlob = null;
        onSave(patch);
    };

    return (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm">
            <div className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl shadow-xl overflow-hidden">
                <div className="p-5 border-b border-slate-100 flex justify-between items-center">
                    <h3 className="text-lg font-black text-slate-800 dark:text-white">Editar Factura</h3>
                    <button onClick={onClose} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-full"><X size={18} /></button>
                </div>
                <form onSubmit={handleSubmit} className="p-5 space-y-4">
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Nro Control / Factura *</label>
                        <input type="text" required value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} className="w-full form-input border rounded-xl px-3 py-2 text-sm font-bold dark:bg-slate-950" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Monto (USD) *</label>
                        <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 font-black text-slate-400 pointer-events-none select-none z-10">USD</span>
                            <input type="number" required min="0.01" step="0.01" value={amountUsd} onChange={e => setAmountUsd(e.target.value)} className="w-full form-input border rounded-xl px-3 py-2 pl-14 text-lg font-black dark:bg-slate-950" />
                        </div>
                        <p className="text-[10px] text-slate-500 mt-1">Al cambiar el monto, la deuda del proveedor se ajusta por la diferencia.</p>
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Fecha de la factura *</label>
                        <input type="date" required value={invoiceDate} onChange={e => setInvoiceDate(e.target.value)} className="w-full form-input border rounded-xl px-3 py-2 text-sm font-bold dark:bg-slate-950" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Fecha Vencimiento (Opcional)</label>
                        <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="w-full form-input border rounded-xl px-3 py-2 text-sm font-bold dark:bg-slate-950" />
                    </div>
                    <div>
                        <label className="block text-xs font-bold text-slate-400 uppercase mb-2">Foto de Factura</label>
                        {photoPreview ? (
                            <img src={photoPreview} alt="Nueva foto" className="w-full h-28 object-cover rounded-xl border" />
                        ) : invoice.hasPhoto && !photoRemoved ? (
                            <div className="flex items-center justify-between text-xs text-slate-500">
                                <span>Tiene foto</span>
                                <button type="button" onClick={() => setPhotoRemoved(true)} className="font-bold text-red-500">Quitar foto</button>
                            </div>
                        ) : null}
                        <label className="block w-full mt-2 py-2 text-center rounded-xl border border-dashed text-xs font-bold text-slate-500 cursor-pointer">
                            {photoRemoved ? 'Foto se quitará al guardar' : 'Cambiar / adjuntar foto'}
                            <input type="file" accept="image/*" capture="environment" onChange={handlePhotoSelect} className="hidden" />
                        </label>
                    </div>
                    <button type="submit" disabled={!valid} className="w-full py-3 bg-brand-dark disabled:opacity-50 text-white font-bold rounded-xl text-sm">
                        Guardar cambios
                    </button>
                </form>
            </div>
        </div>
    );
}

/** Elige el período del PDF de estado de cuenta (hoy, ayer, este mes, personalizado...). */
export function SupplierReportRangeModal({ supplierName, historyData = [], initialDesde = '', initialHasta = '', onClose, onGenerate }) {
    const hasInitialRange = !!(initialDesde || initialHasta);
    const [option, setOption] = useState(hasInitialRange ? 'custom' : 'month');
    const [customDesde, setCustomDesde] = useState(initialDesde);
    const [customHasta, setCustomHasta] = useState(initialHasta);
    const { desde, hasta } = resolveReportRange(option, { desde: customDesde, hasta: customHasta });
    const count = filterActivityByRange(historyData, desde, hasta).length;
    const invalidCustom = option === 'custom' && !!desde && !!hasta && desde > hasta;

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm animate-in fade-in duration-200" onClick={(e) => { e.stopPropagation(); onClose(); }}>
            <div role="dialog" aria-label="Período del reporte" className="bg-white dark:bg-slate-900 w-full max-w-sm rounded-3xl shadow-xl overflow-hidden animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
                <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex justify-between items-center">
                    <h3 className="text-lg font-black text-slate-800 dark:text-white flex items-center gap-2">
                        <Download size={18} className="text-brand-dark dark:text-brand" /> Reporte PDF
                    </h3>
                    <button onClick={onClose} aria-label="Cerrar" className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-full"><X size={18} /></button>
                </div>
                <div className="p-5 space-y-4">
                    <p className="text-xs text-slate-500 -mt-1">Reporte de <strong>{supplierName}</strong>. ¿De qué período lo quieres?</p>
                    <div className="grid grid-cols-2 gap-2">
                        {REPORT_RANGE_OPTIONS.map(opt => (
                            <button
                                key={opt.id}
                                type="button"
                                onClick={() => setOption(opt.id)}
                                aria-pressed={option === opt.id}
                                className={`rounded-xl border px-3 py-2.5 text-xs font-bold ${option === opt.id ? 'border-brand bg-brand/10 text-brand-dark dark:text-brand' : 'border-slate-200 dark:border-slate-700 text-slate-500'}`}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                    {option === 'custom' && (
                        <div className="flex items-center gap-2">
                            <input type="date" value={customDesde} onChange={e => setCustomDesde(e.target.value)} aria-label="Reporte desde" className="form-input min-w-0 flex-1 border rounded-lg px-2 py-1.5 text-xs dark:bg-slate-950" />
                            <span className="text-[10px] text-slate-400">a</span>
                            <input type="date" value={customHasta} onChange={e => setCustomHasta(e.target.value)} aria-label="Reporte hasta" className="form-input min-w-0 flex-1 border rounded-lg px-2 py-1.5 text-xs dark:bg-slate-950" />
                        </div>
                    )}
                    <p className={`text-[11px] font-bold ${invalidCustom ? 'text-red-600' : 'text-slate-500'}`} role={invalidCustom ? 'alert' : undefined}>
                        {invalidCustom
                            ? 'La fecha "desde" no puede ser posterior a "hasta".'
                            : `${rangeLabel(desde, hasta)} · ${count} ${count === 1 ? 'movimiento' : 'movimientos'}`}
                    </p>
                    <button
                        type="button"
                        disabled={count === 0 || invalidCustom}
                        onClick={() => onGenerate({ desde, hasta })}
                        className="w-full py-3 bg-brand-dark hover:opacity-90 disabled:opacity-40 text-white font-bold rounded-xl active:scale-95 transition-all text-sm flex justify-center items-center gap-2"
                    >
                        <Download size={14} /> Generar PDF
                    </button>
                </div>
            </div>
        </div>
    );
}

export function SupplierDetailsSheet({ supplier, isOpen, isAdmin, onClose, onAddInvoice, onPayInvoice, onEdit, onDelete, bcvRate, tasaCop, copEnabled, copPrimary, historyData, triggerHaptic, onEditInvoice, onDeleteInvoice, onVoidPayment }) {
    // Rango para estado de cuenta (YYYY-MM-DD local). Vacío = todo el historial.
    const [desde, setDesde] = useState('');
    const [hasta, setHasta] = useState('');
    const [invoiceStatusFilter, setInvoiceStatusFilter] = useState('PENDIENTES');
    const [invoiceSearch, setInvoiceSearch] = useState('');
    const [isReportRangeOpen, setIsReportRangeOpen] = useState(false);

    // Cálculos del estado de cuenta. Se memorizan para no repetir el reparto FIFO,
    // los filtros y el ordenado en cada render (p. ej. al escribir en la búsqueda).
    // Los hooks van ANTES del return temprano para respetar las reglas de hooks.
    const derived = useMemo(() => {
        const visibleHistory = filterActivityByRange(historyData, desde, hasta);
        // Estado por factura: los pagos se reparten FIFO sobre TODO el historial, no solo el rango visible.
        const allocation = allocatePaymentsToInvoices(
            historyData.filter(r => r.type === 'INVOICE'),
            historyData.filter(r => r.type !== 'INVOICE'),
        );
        const todayStart = new Date(new Date().toDateString());
        const invoiceById = new Map(historyData.filter(r => r.type === 'INVOICE').map(r => [r.id, r]));
        const invoiceStatusById = new Map([...allocation.byInvoice].map(([id, balance]) => {
            const invoice = invoiceById.get(id);
            const overdue = invoice?.dueDate && new Date(`${invoice.dueDate}T12:00:00`) < todayStart && balance.remainingUsd > 0;
            return [id, overdue ? 'VENCIDA' : balance.status];
        }));
        const visibleInvoices = visibleHistory.filter(record => record.type === 'INVOICE');
        const pendingInvoiceCount = visibleInvoices.filter(record => (allocation.byInvoice.get(record.id)?.remainingUsd ?? 0) > 0).length;
        const invoiceCounts = {
            PENDIENTES: pendingInvoiceCount,
            PAGADAS: visibleInvoices.filter(record => allocation.byInvoice.get(record.id)?.status === 'PAGADA').length,
            TODAS: visibleInvoices.length,
        };
        const pendingInvoices = visibleHistory.filter(record => {
            if (record.type !== 'INVOICE') return false;
            const balance = allocation.byInvoice.get(record.id);
            const overdue = record.dueDate && new Date(`${record.dueDate}T12:00:00`) < todayStart;
            return (balance?.remainingUsd ?? 0) > 0 && !overdue;
        });
        return { visibleHistory, allocation, invoiceStatusById, invoiceCounts, pendingInvoices, pendingInvoiceCount };
    }, [historyData, desde, hasta]);

    const { visibleHistory, allocation, invoiceStatusById, invoiceCounts, pendingInvoices, pendingInvoiceCount } = derived;

    const sortedHistory = useMemo(() => {
        const filteredHistory = visibleHistory.filter(record => {
            if (record.type !== 'INVOICE') return true;
            const balance = allocation.byInvoice.get(record.id);
            const status = invoiceStatusById.get(record.id);
            if (invoiceStatusFilter === 'PENDIENTES' && !(balance?.remainingUsd > 0)) return false;
            if (invoiceStatusFilter === 'PAGADAS' && status !== 'PAGADA') return false;
            return matchesSearchFields([record.invoiceNumber], invoiceSearch);
        });
        return [...filteredHistory].sort((a, b) => {
            if (invoiceStatusFilter === 'PENDIENTES' && a.type === 'INVOICE' && b.type === 'INVOICE') {
                const overdueA = invoiceStatusById.get(a.id) === 'VENCIDA' ? 1 : 0;
                const overdueB = invoiceStatusById.get(b.id) === 'VENCIDA' ? 1 : 0;
                if (overdueA !== overdueB) return overdueB - overdueA;
            }
            return new Date(b.date || b.timestamp) - new Date(a.date || a.timestamp);
        });
    }, [visibleHistory, allocation, invoiceStatusById, invoiceStatusFilter, invoiceSearch]);

    if (!isOpen || !supplier) return null;

    const overdueInvoiceCount = pendingInvoiceCount - pendingInvoices.length;
    const STATUS_LABEL = { PAGADA: 'Pagada', PARCIAL: 'Parcial', PENDIENTE: 'Pendiente' };
    const STATUS_CLASS = {
        PAGADA: 'bg-emerald-100 text-emerald-700',
        PARCIAL: 'bg-amber-100 text-amber-700',
        PENDIENTE: 'bg-red-100 text-red-600',
    };

    return (
        <div className="fixed inset-0 z-40 bg-slate-900/60 backdrop-blur-sm animate-in fade-in duration-200 sm:flex sm:items-center sm:justify-center sm:p-6" onClick={onClose}>
            <div className="fixed bottom-0 left-0 right-0 max-w-lg mx-auto bg-white dark:bg-slate-900 rounded-t-3xl max-h-[90vh] overflow-y-auto shadow-2xl animate-in slide-in-from-bottom sm:static sm:w-full sm:max-w-2xl sm:rounded-3xl sm:max-h-[min(88vh,900px)] sm:animate-in sm:zoom-in-95" onClick={e => e.stopPropagation()}>
                {/* Close + Drag Handle */}
                <div className="flex items-center justify-between px-4 pt-3 pb-2">
                    <div className="w-8" />
                    <div className="w-8 h-1 bg-slate-300 dark:bg-slate-700 rounded-full" />
                    <button onClick={onClose} className="p-1.5 text-slate-400 hover:bg-slate-100 rounded-full transition-colors"><X size={18} /></button>
                </div>

                <div className="px-5 pb-6 space-y-5">
                    {/* Header */}
                    <div className="flex items-center gap-4">
                        <div className="w-14 h-14 rounded-full bg-brand-dark dark:bg-brand-dark/30 flex items-center justify-center shrink-0">
                            <span className="text-2xl font-black text-brand dark:text-brand">
                                {supplier.name.charAt(0).toUpperCase()}
                            </span>
                        </div>
                        <div>
                            <h3 className="text-lg font-black text-slate-800 dark:text-white">{supplier.name}</h3>
                            <div className="flex items-center gap-2 mt-0.5">
                                {supplier.documentId && <p className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded">{supplier.documentId}</p>}
                            </div>
                            {supplier.contactName && <p className="text-xs text-slate-500 mt-1">Contacto: {supplier.contactName}</p>}
                        </div>
                    </div>

                    {/* Deuda / Saldo */}
                    <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/30 rounded-xl px-4 py-3 text-center">
                        <p className="text-[10px] font-bold text-red-500 uppercase tracking-widest">Total por Pagar</p>
                        <p className={`text-3xl font-black ${copEnabled && copPrimary ? 'text-amber-600 dark:text-amber-400' : 'text-red-600 dark:text-red-400'}`}>
                            {copEnabled && copPrimary && tasaCop > 0
                                ? `${formatCop(supplier.deuda * tasaCop)} COP`
                                : `USD ${formatUsd(supplier.deuda)}`}
                        </p>
                        <div className="flex items-center justify-center gap-2 mt-1">
                            {copEnabled && copPrimary && <p className="text-xs font-bold text-red-400/80">USD {formatUsd(supplier.deuda)}</p>}
                            {copEnabled && !copPrimary && tasaCop > 0 && <p className="text-xs font-bold text-red-400/80">{formatCop(supplier.deuda * tasaCop)} COP</p>}
                            {bcvRate > 0 && <p className="text-xs font-bold text-red-400/80">{formatBs(supplier.deuda * bcvRate)} Bs</p>}
                        </div>
                    </div>

                    {/* Actions */}
                    <div className="grid grid-cols-2 gap-3">
                        <button onClick={onAddInvoice} className="py-3 bg-red-100 text-red-600 rounded-xl text-xs font-bold active:scale-95 flex flex-col items-center gap-1">
                            <FileText size={18} /> Cargar Factura
                        </button>
                        <button onClick={onPayInvoice} className="py-3 bg-emerald-100 text-emerald-600 rounded-xl text-xs font-bold active:scale-95 flex flex-col items-center gap-1" disabled={supplier.deuda <= 0}>
                            <CreditCard size={18} /> Registrar Pago
                        </button>
                    </div>

                    {/* Historial (Facturas y Pagos) */}
                    <div>
                        <div className="flex items-center justify-between mb-3">
                            <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                <Clock size={12} /> Estado de Cuenta
                            </h4>
                            {historyData.length > 0 && (
                                <button
                                    onClick={() => { triggerHaptic && triggerHaptic(); setIsReportRangeOpen(true); }}
                                    className="text-[10px] font-bold text-brand-dark dark:text-brand bg-slate-100 dark:bg-slate-800/40 px-2.5 py-1 rounded-lg flex items-center gap-1 active:scale-95 transition-all animate-in fade-in duration-200"
                                >
                                    <Download size={10} /> Reporte PDF
                                </button>
                            )}
                        </div>
                        <div className="flex items-center gap-2 mb-3">
                            <input type="date" value={desde} onChange={e => setDesde(e.target.value)} aria-label="Fecha desde" className="form-input min-w-0 flex-1 border rounded-lg px-2 py-1 text-xs dark:bg-slate-950" />
                            <span className="text-[10px] text-slate-400">a</span>
                            <input type="date" value={hasta} onChange={e => setHasta(e.target.value)} aria-label="Fecha hasta" className="form-input min-w-0 flex-1 border rounded-lg px-2 py-1 text-xs dark:bg-slate-950" />
                            {(desde || hasta) && (
                                <button type="button" onClick={() => { setDesde(''); setHasta(''); }} className="text-[10px] font-bold text-slate-500 px-2 py-1 rounded-lg bg-slate-100 dark:bg-slate-800">Limpiar</button>
                            )}
                        </div>
                        <div className="mb-3 space-y-2">
                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-500">Facturas por estado</p>
                            <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
                                {[['PENDIENTES', 'Pendientes'], ['PAGADAS', 'Pagadas'], ['TODAS', 'Todas']].map(([value, label]) => (
                                    <button key={value} type="button" onClick={() => setInvoiceStatusFilter(value)} aria-pressed={invoiceStatusFilter === value} className={`rounded-lg px-1 py-2 text-[10px] font-bold ${invoiceStatusFilter === value ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-950 dark:text-white' : 'text-slate-500'}`}>{label} <span className="opacity-70">{invoiceCounts[value]}</span></button>
                                ))}
                            </div>
                            {invoiceStatusFilter === 'PENDIENTES' && overdueInvoiceCount > 0 && <p className="text-[10px] font-bold text-red-600">Vencidas: {overdueInvoiceCount}</p>}
                            <p className="text-[10px] text-slate-400">Los pagos se muestran en todos los filtros.</p>
                            <label className="relative block">
                                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                                <input type="search" value={invoiceSearch} onChange={e => setInvoiceSearch(e.target.value)} placeholder="Buscar número de factura" aria-label="Buscar factura en estado de cuenta" className="w-full rounded-xl border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs dark:bg-slate-950" />
                            </label>
                        </div>
                        {sortedHistory.length === 0 ? (
                            <p className="text-xs text-slate-400 text-center py-4">Sin movimientos en este rango</p>
                        ) : (
                            <div className="space-y-4">
                                {[
                                    { key: 'INVOICE', title: 'Facturas', items: sortedHistory.filter(r => r.type === 'INVOICE').sort((a, b) => {
                                        if (invoiceStatusFilter === 'PENDIENTES') {
                                            const overdueA = invoiceStatusById.get(a.id) === 'VENCIDA' ? 1 : 0;
                                            const overdueB = invoiceStatusById.get(b.id) === 'VENCIDA' ? 1 : 0;
                                            if (overdueA !== overdueB) return overdueB - overdueA;
                                            return new Date(a.date || a.timestamp) - new Date(b.date || b.timestamp);
                                        }
                                        return new Date(b.date || b.timestamp) - new Date(a.date || a.timestamp);
                                    }) },
                                    { key: 'PAYMENT', title: 'Pagos', items: sortedHistory.filter(r => r.type !== 'INVOICE') },
                                ].filter(section => section.items.length > 0).map(section => (
                                <div key={section.key}>
                                <p className="text-[10px] font-black text-slate-400 uppercase tracking-wider mb-2">{section.title} ({section.items.length})</p>
                                <div className="space-y-2">
                                {section.items.map(record => {
                                    const isInvoice = record.type === 'INVOICE';
                                    const dateStr = new Date(record.date || record.timestamp).toLocaleDateString('es-VE');
                                    // Estado de vencimiento (solo facturas no pagadas con fecha de vencimiento).
                                    const due = isInvoice && record.dueDate && allocation.byInvoice.get(record.id)?.remainingUsd > 0 ? new Date(record.dueDate + 'T12:00:00') : null;
                                    const vencida = due && due < new Date(new Date().toDateString());
                                    const voided = !isInvoice && record.status === 'ANULADA';
                                    return (
                                        <div key={record.id} className={`flex items-center gap-3 p-2 bg-slate-50 dark:bg-slate-950 rounded-xl ${voided ? 'opacity-50' : ''}`}>
                                            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${isInvoice ? 'bg-red-100/50 text-red-500' : 'bg-emerald-100/50 text-emerald-500'}`}>
                                                {isInvoice ? <FileText size={14} /> : <ArrowUpRight size={14} />}
                                            </div>
                                            <div className="flex-1 min-w-0">
                                                <p className={`text-xs font-bold text-slate-700 dark:text-slate-200 ${voided ? 'line-through' : ''}`}>
                                                    {isInvoice ? `Factura #${record.invoiceNumber}` : (record.description || 'Abono/Pago')}
                                                    {voided && <span className="ml-1.5 no-underline text-[9px] font-black uppercase px-1.5 py-0.5 rounded bg-rose-100 text-rose-600">Anulado</span>}
                                                </p>                                                    <p className="text-[10px] text-slate-400">{dateStr} {isInvoice && record.dueDate && `• Venc: ${new Date(record.dueDate + 'T12:00:00').toLocaleDateString('es-VE')}`} {vencida && <span className="font-bold text-red-500">• VENCIDA</span>}</p>
                                                    {isInvoice && allocation.byInvoice.get(record.id) && (() => {
                                                        const a = allocation.byInvoice.get(record.id);
                                                        const visualStatus = invoiceStatusById.get(record.id) || a.status;
                                                        return (
                                                            <p className="mt-0.5">
                                                                <span className={`text-[9px] font-black uppercase px-1.5 py-0.5 rounded ${visualStatus === 'VENCIDA' ? 'bg-red-600 text-white' : STATUS_CLASS[a.status]}`}>{visualStatus === 'VENCIDA' ? 'Vencida' : STATUS_LABEL[a.status]}</span>
                                                                {a.paidUsd > 0 && <span className="text-[10px] text-slate-500 ml-1">Pagado USD {formatUsd(a.paidUsd)} · Saldo USD {formatUsd(a.remainingUsd)}</span>}
                                                            </p>
                                                        );
                                                    })()}
                                            </div>
                                            {isInvoice && record.hasPhoto && <InvoicePhotoThumb invoiceId={record.id} invoiceNumber={record.invoiceNumber} />}
                                            {isInvoice && (
                                                <div className="shrink-0 flex flex-col gap-1">
                                                    <button type="button" title="Editar factura" onClick={() => onEditInvoice && onEditInvoice(record)} className="p-1.5 rounded-lg text-slate-500 bg-white dark:bg-slate-900 border"><Pencil size={12} /></button>
                                                    <button type="button" title="Eliminar factura" onClick={() => onDeleteInvoice && onDeleteInvoice(record)} className="p-1.5 rounded-lg text-red-500 bg-white dark:bg-slate-900 border"><Trash2 size={12} /></button>
                                                </div>
                                            )}
                                            {!isInvoice && !voided && onVoidPayment && (
                                                <button type="button" title="Anular pago" onClick={() => onVoidPayment(record)} className="shrink-0 p-1.5 rounded-lg text-rose-500 bg-white dark:bg-slate-900 border"><Ban size={12} /></button>
                                            )}
                                            <div className="text-right">
                                                <p className={`text-sm font-black ${isInvoice ? 'text-red-500' : 'text-emerald-500'} ${voided ? 'line-through' : ''}`}>
                                                    {copEnabled && copPrimary && tasaCop > 0
                                                        ? <>{isInvoice ? '+' : '-'}{formatCop((isInvoice ? record.amountUsd : Math.abs(record.totalUsd || 0)) * tasaCop)} COP</>
                                                        : <>{isInvoice ? '+' : '-'}USD {formatUsd(isInvoice ? record.amountUsd : Math.abs(record.totalUsd || 0))}</>}
                                                </p>
                                                {copEnabled && copPrimary && (
                                                    <p className={`text-[10px] font-bold ${isInvoice ? 'text-red-400/80' : 'text-emerald-400/80'}`}>
                                                        {isInvoice ? '+' : '-'}USD {formatUsd(isInvoice ? record.amountUsd : Math.abs(record.totalUsd || 0))}
                                                    </p>
                                                )}
                                                {copEnabled && !copPrimary && tasaCop > 0 && (
                                                    <p className={`text-[10px] font-bold ${isInvoice ? 'text-red-400/80' : 'text-emerald-400/80'}`}>
                                                        {isInvoice ? '+' : '-'}{formatCop((isInvoice ? record.amountUsd : Math.abs(record.totalUsd || 0)) * tasaCop)} COP
                                                    </p>
                                                )}
                                            </div>
                                        </div>
                                    )
                                })}
                                </div>
                                </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Editar / Eliminar */}
                    <div className="flex gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                        <button onClick={onEdit} className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-slate-100 rounded-xl text-xs font-bold text-slate-600 active:scale-95">
                            <Pencil size={14} /> Editar
                        </button>
                        {isAdmin && (
                            <button onClick={onDelete} className="px-4 py-2 bg-red-50 text-red-500 rounded-xl text-xs font-bold active:scale-95" disabled={supplier.deuda > 0}>
                                <Trash2 size={14} />
                            </button>
                        )}
                    </div>
                </div>
            </div>
            {isReportRangeOpen && (
                <SupplierReportRangeModal
                    supplierName={supplier.name}
                    historyData={historyData}
                    initialDesde={desde}
                    initialHasta={hasta}
                    onClose={() => setIsReportRangeOpen(false)}
                    onGenerate={async ({ desde: from, hasta: to }) => {
                        const { generateSupplierHistoryPDF } = await import('../../utils/supplierReportGenerator');
                        await generateSupplierHistoryPDF({ supplier, historyData, bcvRate, tasaCop, copEnabled, desde: from, hasta: to });
                        setIsReportRangeOpen(false);
                    }}
                />
            )}
        </div>
    );
}
