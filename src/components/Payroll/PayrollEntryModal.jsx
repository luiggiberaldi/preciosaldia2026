import { useEffect, useMemo, useState } from 'react';
import { Modal } from '../Modal';
import PinField from './PinField';
import CustomSelect from '../CustomSelect';
import { selectBtnCls } from './EmployeeFormModal';
import { ENTRY_TYPE_LABELS, MONEY_OUT_TYPES } from '../../utils/payrollModel';
import { isCashMethodId } from '../../utils/gastoInterno';
import { formatBs, formatUsd } from '../../utils/calculatorUtils';
import { mulR } from '../../utils/dinero';

const newKey = () => globalThis.crypto?.randomUUID?.() ?? `k_${Date.now()}_${Math.random().toString(36).slice(2)}`;
const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white font-semibold';

/**
 * Formulario de adelanto, pago, bono o descuento.
 * Contrato con el servicio: { employeeId, tipo, moneda, monto, metodoId, nota, idempotencyKey, confirmarExceso }.
 * La tasa NO se manda: la pone el servicio con la tasa de la tienda (D2; el dueño pidió que no se edite).
 */
export default function PayrollEntryModal({ isOpen, tipo, employee, balance, rate, paymentMethods = [], onClose, onSubmit, onReceipt }) {
    const [moneda, setMoneda] = useState('USD');
    const [monto, setMonto] = useState('');
    const [metodoId, setMetodoId] = useState('');
    const [nota, setNota] = useState('');
    const [pin, setPin] = useState('');
    const [error, setError] = useState('');
    const [exceso, setExceso] = useState(null); // { excedenteUsd }
    const [saving, setSaving] = useState(false);
    const [done, setDone] = useState(null); // resultado para el recibo
    const [idempotencyKey, setKey] = useState(newKey);

    const isMoney = MONEY_OUT_TYPES.has(tipo);
    const saldoUsd = Math.max(0, balance?.saldoUsd || 0);

    useEffect(() => {
        if (!isOpen) return;
        setMoneda('USD');
        setMonto(tipo === 'PAGO' && saldoUsd > 0 ? String(saldoUsd) : '');
        setNota('');
        setPin('');
        setError('');
        setExceso(null);
        setDone(null);
        setKey(newKey());
    }, [isOpen, tipo]); // eslint-disable-line react-hooks/exhaustive-deps -- solo al abrir

    const methods = useMemo(() => paymentMethods.filter(m => m.currency === moneda), [paymentMethods, moneda]);
    useEffect(() => { setMetodoId(methods[0]?.id || ''); }, [methods]);

    // Al cambiar de moneda en un pago, se sugiere el saldo en esa moneda.
    const changeMoneda = (m) => {
        setMoneda(m);
        setExceso(null);
        if (tipo === 'PAGO' && saldoUsd > 0) setMonto(String(m === 'BS' ? mulR(saldoUsd, rate) : saldoUsd));
    };

    const submit = async (e) => {
        e?.preventDefault();
        setSaving(true);
        setError('');
        try {
            const res = await onSubmit({
                employeeId: employee.id, tipo, moneda, monto: Number(monto), metodoId: isMoney ? metodoId : null,
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
    const title = `${ENTRY_TYPE_LABELS[tipo] || ''} · ${employee.nombre}`;

    if (done) {
        return (
            <Modal isOpen={isOpen} onClose={onClose} title={title}>
                <div className="space-y-3 text-center" data-testid="payroll-entry-done">
                    <p className="text-lg font-black text-emerald-600">{done.duplicate ? 'Ya estaba registrado' : 'Registrado'}</p>
                    <p className="text-sm text-slate-600 dark:text-slate-300">
                        {ENTRY_TYPE_LABELS[done.entry.tipo]} de <b>${formatUsd(done.entry.montoUsd)}</b>
                        {done.entry.moneda === 'BS' ? ` (Bs ${formatBs(done.entry.montoBs)})` : ''}.
                    </p>
                    {done.arrastre && (
                        <p className="text-xs font-bold rounded-xl px-3 py-2 bg-amber-50 text-amber-900 border border-amber-300">
                            ⚠ Queda debiendo ${formatUsd(done.arrastre.montoUsd)} para el próximo periodo.
                        </p>
                    )}
                    <div className="flex gap-2">
                        <button type="button" data-testid="receipt-print" onClick={() => onReceipt(done.entry, 'print')}
                            className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">Imprimir ticket</button>
                        <button type="button" data-testid="receipt-pdf" onClick={() => onReceipt(done.entry, 'pdf')}
                            className="flex-1 py-2.5 rounded-xl font-bold text-sm bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">Bajar PDF</button>
                    </div>
                    <button type="button" onClick={onClose} className="w-full py-3 rounded-xl font-black text-white bg-brand">Listo</button>
                </div>
            </Modal>
        );
    }

    const montoNum = Number(monto) || 0;
    const equivalente = moneda === 'USD' ? `≈ Bs ${formatBs(mulR(montoNum, rate))}` : (rate > 0 ? `≈ $${formatUsd(montoNum / rate)}` : '');
    const efectivo = isMoney && isCashMethodId(metodoId);

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={title} size="max-w-md">
            <form onSubmit={submit} className="space-y-3" data-testid="payroll-entry-form">
                <div className="rounded-xl bg-slate-50 dark:bg-slate-800/60 px-3 py-2 text-sm flex justify-between">
                    <span className="text-slate-500">Por pagar en el periodo</span>
                    <b className="text-slate-800 dark:text-white" data-testid="payroll-entry-saldo">${formatUsd(saldoUsd)} · Bs {formatBs(mulR(saldoUsd, rate))}</b>
                </div>

                <div className="flex gap-2" role="radiogroup" aria-label="Moneda">
                    {['USD', 'BS'].map(m => (
                        <button type="button" key={m} role="radio" aria-checked={moneda === m} data-testid={`payroll-moneda-${m}`}
                            onClick={() => changeMoneda(m)}
                            className={`flex-1 py-2 rounded-xl font-black text-sm ${moneda === m ? 'bg-brand text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}`}>
                            {m === 'USD' ? 'Dólares' : 'Bolívares'}
                        </button>
                    ))}
                </div>

                <label className="block">
                    <span className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">Monto en {moneda === 'USD' ? '$' : 'Bs'}</span>
                    <input className={`${inputCls} text-lg`} type="number" inputMode="decimal" min="0" step="0.01" autoFocus
                        data-testid="payroll-monto" value={monto} onChange={e => { setMonto(e.target.value); setExceso(null); }} />
                    <span className="block text-xs text-slate-500 mt-1">{equivalente} · tasa de la tienda {rate || '—'}</span>
                </label>

                {isMoney && (
                    <label className="block">
                        <span className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">Forma de pago</span>
                        <CustomSelect
                            testId="payroll-metodo"
                            value={metodoId}
                            onChange={setMetodoId}
                            options={methods.map(m => ({ value: m.id, label: m.label }))}
                            buttonClassName={selectBtnCls}
                        />
                        <span className="block text-xs text-slate-500 mt-1">
                            {efectivo ? 'Sale de la gaveta: necesita la caja abierta.' : 'No sale de la gaveta; igual aparece en el cierre como «Nómina».'}
                        </span>
                    </label>
                )}

                <label className="block">
                    <span className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">Nota (opcional)</span>
                    <input className={inputCls} value={nota} onChange={e => setNota(e.target.value)} maxLength={200} />
                </label>

                <PinField value={pin} onChange={setPin} />

                {error && (
                    <p role="alert" data-testid="payroll-entry-error"
                        className={`text-sm font-bold rounded-xl px-3 py-2 ${exceso ? 'bg-amber-50 text-amber-900 border border-amber-300' : 'text-red-600'}`}>
                        {error}
                    </p>
                )}

                <button type="submit" disabled={saving || !(montoNum > 0) || (isMoney && !metodoId)} data-testid="payroll-entry-submit"
                    className={`w-full py-3 rounded-xl font-black text-white disabled:opacity-50 ${exceso ? 'bg-amber-500' : 'bg-brand hover:bg-brand-dark'}`}>
                    {saving ? 'Guardando…' : exceso ? `Confirmar: queda debiendo $${formatUsd(exceso.excedenteUsd)}` : `Registrar ${(ENTRY_TYPE_LABELS[tipo] || '').toLowerCase()}`}
                </button>
            </form>
        </Modal>
    );
}
