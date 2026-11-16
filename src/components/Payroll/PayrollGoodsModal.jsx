import { useEffect, useMemo, useState } from 'react';
import { Search, Trash2 } from 'lucide-react';
import { Modal } from '../Modal';
import PinField from './PinField';
import { storageService } from '../../utils/storageService';
import { PRODUCTS_KEY } from '../../services/gastosInternosService';
import { GOODS_VALUATION_LABELS, goodsUnitPriceUsd, readGoodsValuation } from '../../utils/payrollModel';
import { formatBs, formatUsd } from '../../utils/calculatorUtils';
import { mulR, sumR } from '../../utils/dinero';

const newKey = () => globalThis.crypto?.randomUUID?.() ?? `k_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white font-semibold';
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/**
 * Mercancía que se lleva un empleado (P-012, F6). La pantalla solo elige
 * productos y cantidades: el precio y el stock los valida el servicio con los
 * datos frescos (contrato: { employeeId, tipo:'MERCANCIA', items:[{id,qty}], nota, idempotencyKey, confirmarExceso }).
 */
export default function PayrollGoodsModal({ isOpen, employee, balance, rate, onClose, onSubmit, onReceipt }) {
    const [products, setProducts] = useState([]);
    const [query, setQuery] = useState('');
    const [items, setItems] = useState([]); // [{ id, qty }]
    const [nota, setNota] = useState('');
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const [exceso, setExceso] = useState(null);
    const [saving, setSaving] = useState(false);
    const [done, setDone] = useState(null);
    const [idempotencyKey, setKey] = useState(newKey);
    const valuation = useMemo(() => (isOpen ? readGoodsValuation() : 'costo'), [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        setQuery(''); setItems([]); setNota(''); setPin(''); setError(''); setExceso(null); setDone(null); setKey(newKey());
        let alive = true;
        storageService.getItem(PRODUCTS_KEY, []).then(list => { if (alive) setProducts(Array.isArray(list) ? list : []); });
        return () => { alive = false; };
    }, [isOpen]);

    const byId = useMemo(() => new Map(products.map(p => [p.id, p])), [products]);
    const results = useMemo(() => {
        const q = norm(query.trim());
        if (!q) return [];
        return products
            .filter(p => !items.some(i => i.id === p.id))
            .filter(p => norm(p.name).includes(q) || String(p.barcode ?? '').includes(q))
            .slice(0, 8);
    }, [products, query, items]);

    const lines = items.map(i => {
        const p = byId.get(i.id);
        const unit = goodsUnitPriceUsd(p, valuation);
        return { ...i, product: p, unit, subtotal: mulR(unit, Number(i.qty) || 0) };
    });
    const totalUsd = sumR(...lines.map(l => l.subtotal));
    const saldoUsd = Math.max(0, balance?.saldoUsd || 0);

    const add = (p) => { setItems(list => [...list, { id: p.id, qty: 1 }]); setQuery(''); setExceso(null); };
    const setQty = (id, qty) => { setItems(list => list.map(i => (i.id === id ? { ...i, qty } : i))); setExceso(null); };
    const remove = (id) => { setItems(list => list.filter(i => i.id !== id)); setExceso(null); };

    const submit = async (e) => {
        e?.preventDefault();
        setSaving(true);
        setError('');
        try {
            const res = await onSubmit({
                employeeId: employee.id, tipo: 'MERCANCIA', items: items.map(i => ({ id: i.id, qty: Number(i.qty) })),
                nota, idempotencyKey, confirmarExceso: !!exceso,
            }, pin);
            setDone(res);
        } catch (err) {
            if (err.code === 'EXCEDE_SALDO') setExceso({ excedenteUsd: err.excedenteUsd });
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    if (!employee) return null;
    const title = `Mercancía · ${employee.nombre}`;

    if (done) {
        return (
            <Modal isOpen={isOpen} onClose={onClose} title={title}>
                <div className="space-y-3 text-center" data-testid="payroll-goods-done">
                    <p className="text-lg font-black text-emerald-600">{done.duplicate ? 'Ya estaba registrado' : 'Registrado'}</p>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                        Se descuentan <b>${formatUsd(done.entry.montoUsd)}</b> del sueldo y salió del inventario.
                    </p>
                    {done.arrastre && (
                        <p className="text-xs font-bold rounded-xl px-3 py-2 bg-amber-50 text-amber-900 border border-amber-300">
                            ⚠ Queda debiendo ${formatUsd(done.arrastre.montoUsd)} para el próximo periodo.
                        </p>
                    )}
                    <div className="flex gap-2">
                        <button type="button" onClick={() => onReceipt(done.entry, 'print')}
                            className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">Imprimir ticket</button>
                        <button type="button" onClick={() => onReceipt(done.entry, 'pdf')}
                            className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">Bajar PDF</button>
                    </div>
                    <button type="button" onClick={onClose} className="w-full py-3 rounded-xl font-black text-white bg-brand">Listo</button>
                </div>
            </Modal>
        );
    }

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title} size="max-w-md">
            <form onSubmit={submit} className="space-y-3" data-testid="payroll-goods-form">
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-sm flex justify-between">
                    <span className="text-slate-500">Por pagar en el periodo</span>
                    <b className="text-slate-800 dark:text-white">${formatUsd(saldoUsd)}</b>
                </div>
                <p className="text-xs text-slate-500" data-testid="payroll-goods-valuation">
                    Se descuenta a <b>{GOODS_VALUATION_LABELS[valuation].toLowerCase()}</b> (se cambia en Ajustes › Negocio › Nómina).
                </p>

                <div className="relative">
                    <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                    <input className={`${inputCls} pl-9`} placeholder="Buscar producto por nombre o código" value={query}
                        data-testid="payroll-goods-search" onChange={e => setQuery(e.target.value)} autoFocus />
                    {results.length > 0 && (
                        <ul className="absolute z-10 mt-1 w-full max-h-56 overflow-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 shadow-lg">
                            {results.map(p => (
                                <li key={p.id}>
                                    <button type="button" data-testid="payroll-goods-result" onClick={() => add(p)}
                                        className="w-full text-left px-3 py-2 hover:bg-slate-50 dark:hover:bg-slate-800">
                                        <span className="block text-sm font-bold text-slate-800 dark:text-white">{p.name}</span>
                                        <span className="block text-[11px] text-slate-500">Stock {p.stock ?? 0} · ${formatUsd(goodsUnitPriceUsd(p, valuation))} c/u</span>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>

                <div className="space-y-2" data-testid="payroll-goods-lines">
                    {lines.length === 0 && <p className="text-sm text-slate-500 text-center py-2">Busca y agrega los productos que se lleva.</p>}
                    {lines.map(l => (
                        <div key={l.id} data-testid="payroll-goods-line" className="flex items-center gap-2 rounded-xl border border-slate-100 dark:border-slate-800 p-2">
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-bold text-slate-800 dark:text-white truncate">{l.product?.name || '—'}</p>
                                <p className="text-[11px] text-slate-500">${formatUsd(l.unit)} c/u · stock {l.product?.stock ?? 0}</p>
                            </div>
                            <input type="number" inputMode="decimal" min="0" step="any" aria-label={`Cantidad de ${l.product?.name}`}
                                className="w-20 px-2 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-right font-bold"
                                value={l.qty} onChange={e => setQty(l.id, e.target.value)} />
                            <span className="w-16 text-right text-sm font-black">${formatUsd(l.subtotal)}</span>
                            <button type="button" aria-label={`Quitar ${l.product?.name}`} onClick={() => remove(l.id)} className="p-1 text-slate-400 hover:text-red-500"><Trash2 size={14} /></button>
                        </div>
                    ))}
                </div>

                {lines.length > 0 && (
                    <div className="flex justify-between text-sm font-black" data-testid="payroll-goods-total">
                        <span>Se descuenta</span>
                        <span>${formatUsd(totalUsd)} · Bs {formatBs(mulR(totalUsd, rate))}</span>
                    </div>
                )}

                <label className="block">
                    <span className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">Nota (opcional)</span>
                    <input className={inputCls} value={nota} onChange={e => setNota(e.target.value)} maxLength={200} />
                </label>

                <PinField value={pin} onChange={setPin} />

                {error && (
                    <p role="alert" data-testid="payroll-goods-error"
                        className={`text-sm font-bold rounded-xl px-3 py-2 ${exceso ? 'bg-amber-50 text-amber-900 border border-amber-300' : 'text-red-600'}`}>
                        {error}
                    </p>
                )}

                <button type="submit" disabled={saving || lines.length === 0 || !(totalUsd > 0)} data-testid="payroll-goods-submit"
                    className={`w-full py-3 rounded-xl font-black text-white disabled:opacity-50 ${exceso ? 'bg-amber-500' : 'bg-brand hover:bg-brand-dark'}`}>
                    {saving ? 'Guardando…' : exceso ? `Confirmar: queda debiendo $${formatUsd(exceso.excedenteUsd)}` : 'Registrar mercancía'}
                </button>
            </form>
        </Modal>
    );
}
