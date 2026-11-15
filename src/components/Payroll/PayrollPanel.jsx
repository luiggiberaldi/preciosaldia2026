import { useCallback, useEffect, useMemo, useState } from 'react';
import { Wallet, Plus, Pencil, ChevronLeft, ChevronRight, Printer, FileDown, Ban, UserX, UserCheck, ArrowLeft } from 'lucide-react';
import { showToast } from '../Toast';
import { Modal } from '../Modal';
import EmptyState from '../EmptyState';
import PinField from './PinField';
import EmployeeFormModal from './EmployeeFormModal';
import PayrollEntryModal from './PayrollEntryModal';
import PayrollGoodsModal from './PayrollGoodsModal';
import { useAuthStore } from '../../hooks/store/useAuthStore';
import { useAudit } from '../../hooks/useAudit';
import { getActivePaymentMethods } from '../../config/paymentMethods';
import { formatBs, formatUsd } from '../../utils/calculatorUtils';
import { mulR } from '../../utils/dinero';
import {
    computePeriodBalance, periodIdFor, periodLabel, nextPeriodId, previousPeriodId,
    FRECUENCIA_LABELS, ENTRY_TYPE_LABELS, MONEY_OUT_TYPES, GOODS_TYPE, goodsSummary,
} from '../../utils/payrollModel';
import {
    loadPayroll, saveEmployee, setEmployeeActive, registerEntry, registerGoods, voidEntry, recoverPayroll,
} from '../../services/payrollService';
import { buildPayrollReceiptData, printPayrollReceipt, downloadPayrollReceiptPdf } from '../../utils/payrollReceipt';

const ESTADO = {
    PAGADO: { label: 'Pagado', cls: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300' },
    EN_CURSO: { label: 'En curso', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300' },
    SIN_MOVIMIENTOS: { label: 'Sin movimientos', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
};

/**
 * Gestión › Nómina (plan 2026-11-14, F3). Solo Administrador.
 * Toda escritura pasa por services/payrollService (candado, PIN, idempotencia).
 */
export default function PayrollPanel({ rate = 0, isActive = true, triggerHaptic }) {
    const authorize = useAuthStore(s => s.verifyAdminPin);
    const { log } = useAudit();
    const [employees, setEmployees] = useState([]);
    const [entries, setEntries] = useState([]);
    const [loading, setLoading] = useState(true);
    const [showInactive, setShowInactive] = useState(false);
    const [selectedId, setSelectedId] = useState(null);
    const [viewPeriod, setViewPeriod] = useState(null);
    const [employeeModal, setEmployeeModal] = useState({ open: false, employee: null });
    const [entryModal, setEntryModal] = useState({ open: false, tipo: null });
    const [goodsOpen, setGoodsOpen] = useState(false);
    const [pinAction, setPinAction] = useState(null); // { title, message, run(pin) }
    const [pin, setPin] = useState('');
    const [pinError, setPinError] = useState('');
    const [paymentMethods, setPaymentMethods] = useState([]);

    const ctxFor = useCallback((pinValue) => ({
        authorize, pin: pinValue, getRate: () => rate, audit: (cat, action, desc) => log(cat, action, desc),
    }), [authorize, rate, log]);

    const reload = useCallback(async () => {
        const data = await loadPayroll();
        setEmployees(data.employees);
        setEntries(data.entries);
    }, []);

    useEffect(() => {
        if (!isActive) return;
        let alive = true;
        (async () => {
            try {
                const rec = await recoverPayroll({ audit: (c, a, d) => log(c, a, d) });
                if (rec.movimientosAnulados || rec.renglonesAnulados) {
                    showToast('Se corrigió un movimiento de nómina que quedó a medias.', 'warning');
                }
            } catch (err) {
                console.warn('[Nómina] recuperación falló:', err?.message ?? err);
            }
            if (alive) { await reload(); setLoading(false); }
        })();
        getActivePaymentMethods().then(ms => alive && setPaymentMethods(
            ms.filter(m => (m.currency === 'USD' || m.currency === 'BS') && !m.isVirtual && m.id !== 'cashea'),
        ));
        return () => { alive = false; };
    }, [isActive, reload, log]);

    const now = new Date();
    const rows = useMemo(() => employees
        .filter(e => showInactive || e.activo !== false)
        .map(e => ({ employee: e, balance: computePeriodBalance(entries, e, periodIdFor(now, e.frecuencia)) }))
        .sort((a, b) => a.employee.nombre.localeCompare(b.employee.nombre)),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `now` cambia cada render a propósito
    [employees, entries, showInactive]);

    const totalPorPagar = rows.filter(r => r.employee.activo !== false).reduce((s, r) => s + Math.max(0, r.balance.saldoUsd), 0);

    const selected = employees.find(e => e.id === selectedId) || null;
    const currentPeriod = selected ? periodIdFor(now, selected.frecuencia) : null;
    const shownPeriod = viewPeriod || currentPeriod;
    const shownBalance = selected ? computePeriodBalance(entries, selected, shownPeriod) : null;
    const isCurrent = shownPeriod === currentPeriod;

    const openEmployee = (id) => { setSelectedId(id); setViewPeriod(null); triggerHaptic && triggerHaptic(); };

    const handleSaveEmployee = async (input, pinValue) => {
        const saved = await saveEmployee(input, ctxFor(pinValue));
        await reload();
        showToast(input.id ? 'Empleado actualizado' : 'Empleado creado', 'success');
        return saved;
    };

    const handleSubmitEntry = async (input, pinValue) => {
        const res = await registerEntry(input, ctxFor(pinValue));
        await reload();
        if (!res.duplicate) showToast(`${ENTRY_TYPE_LABELS[input.tipo]} registrado`, 'success');
        return res;
    };

    const handleSubmitGoods = async (input, pinValue) => {
        const res = await registerGoods(input, ctxFor(pinValue));
        await reload();
        if (!res.duplicate) showToast('Mercancía registrada', 'success');
        return res;
    };

    const receipt = useCallback((entry, mode) => {
        const employee = employees.find(e => e.id === entry.employeeId);
        const bal = computePeriodBalance(entries, employee, entry.periodoId);
        const label = paymentMethods.find(m => m.id === entry.metodoId)?.label;
        const data = buildPayrollReceiptData({ entry, employee, saldoDespuesUsd: bal.saldoUsd, methodLabel: label });
        if (mode === 'pdf') downloadPayrollReceiptPdf(data).catch(err => showToast(err.message || 'No se pudo crear el PDF', 'error'));
        else printPayrollReceipt(data);
    }, [employees, entries, paymentMethods]);

    const askPin = (title, message, run) => { setPin(''); setPinError(''); setPinAction({ title, message, run }); };
    const runPinAction = async () => {
        try {
            await pinAction.run(pin);
            setPinAction(null);
        } catch (err) {
            setPinError(err.message);
        }
    };

    if (loading) {
        return <div className="p-6 text-center text-slate-500 font-bold">Cargando nómina…</div>;
    }

    // ─── Detalle del empleado ──────────────────────────────────────────────
    if (selected) {
        const b = shownBalance;
        const est = ESTADO[b.estado];
        return (
            <div className="p-3 sm:p-6 pb-24 space-y-4" data-testid="payroll-detail">
                <button onClick={() => setSelectedId(null)} className="flex items-center gap-1 text-sm font-bold text-slate-500 hover:text-slate-800 dark:hover:text-white">
                    <ArrowLeft size={16} /> Volver a la lista
                </button>
                <div className="flex justify-between items-start gap-2">
                    <div>
                        <h2 className="text-2xl font-black text-surface-700 dark:text-white">{selected.nombre}</h2>
                        <p className="text-sm text-slate-500">
                            {[selected.cargo, FRECUENCIA_LABELS[selected.frecuencia], `Sueldo $${formatUsd(selected.sueldoUsd)}`].filter(Boolean).join(' · ')}
                            {selected.activo === false && ' · Desactivado'}
                        </p>
                    </div>
                    <div className="flex gap-1">
                        <button title="Editar" data-testid="employee-edit" onClick={() => setEmployeeModal({ open: true, employee: selected })}
                            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"><Pencil size={16} /></button>
                        <button title={selected.activo === false ? 'Activar' : 'Desactivar'}
                            onClick={() => askPin(selected.activo === false ? 'Activar empleado' : 'Desactivar empleado',
                                selected.activo === false ? `${selected.nombre} vuelve a la lista.` : `${selected.nombre} sale de la lista. Su historial se conserva.`,
                                async (p) => { await setEmployeeActive(selected.id, selected.activo === false, ctxFor(p)); await reload(); })}
                            className="p-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                            {selected.activo === false ? <UserCheck size={16} /> : <UserX size={16} />}
                        </button>
                    </div>
                </div>

                <div className="flex items-center justify-between rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-2">
                    <button aria-label="Periodo anterior" onClick={() => setViewPeriod(previousPeriodId(shownPeriod))} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"><ChevronLeft size={18} /></button>
                    <div className="text-center">
                        <p className="text-sm font-black text-slate-800 dark:text-white" data-testid="payroll-period-label">{periodLabel(shownPeriod)}</p>
                        <span className={`inline-block mt-0.5 text-[10px] font-black px-2 py-0.5 rounded-full ${est.cls}`}>{isCurrent ? 'Periodo actual · ' : ''}{est.label}</span>
                    </div>
                    <button aria-label="Periodo siguiente" disabled={isCurrent} onClick={() => setViewPeriod(nextPeriodId(shownPeriod))} className="p-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30"><ChevronRight size={18} /></button>
                </div>

                <div className="rounded-2xl bg-white dark:bg-slate-900 border border-slate-100 dark:border-slate-800 p-4 text-sm space-y-1">
                    {[
                        ['Sueldo del periodo', b.sueldoPeriodoUsd, '+'],
                        ['Bonos', b.bonosUsd, '+'],
                        ['Descuentos', b.descuentosUsd, '−'],
                        ['Mercancía', b.mercanciaUsd, '−'],
                        ['Deuda del periodo anterior', b.arrastreRecibidoUsd, '−'],
                        ['Adelantos', b.adelantosUsd, '−'],
                        ['Pagos', b.pagosUsd, '−'],
                        ['Pasa como deuda al siguiente', b.arrastreEnviadoUsd, '+'],
                    ].filter(([, v], i) => i === 0 || v > 0).map(([k, v, sign]) => (
                        <div key={k} className="flex justify-between"><span className="text-slate-500">{k}</span><span className="font-bold">{sign} ${formatUsd(v)}</span></div>
                    ))}
                    <div className="flex justify-between border-t border-slate-100 dark:border-slate-800 pt-2 mt-2 text-base">
                        <span className="font-black">Por pagar</span>
                        <span className="font-black text-brand" data-testid="payroll-detail-saldo">${formatUsd(Math.max(0, b.saldoUsd))} · Bs {formatBs(mulR(Math.max(0, b.saldoUsd), rate))}</span>
                    </div>
                    {b.saldoUsd < 0 && <p className="text-xs font-bold text-amber-700">⚠ El periodo quedó en −${formatUsd(-b.saldoUsd)} (se pagó de más tras anular un bono).</p>}
                </div>

                {isCurrent && selected.activo !== false && (
                    <div className="grid grid-cols-2 gap-2">
                        {['ADELANTO', 'PAGO', 'BONO', 'DESCUENTO'].map(t => (
                            <button key={t} data-testid={`payroll-action-${t}`} onClick={() => setEntryModal({ open: true, tipo: t })}
                                className={`py-3 rounded-xl font-black text-sm ${t === 'PAGO' ? 'bg-brand text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'}`}>
                                {t === 'ADELANTO' ? 'Dar adelanto' : t === 'PAGO' ? 'Pagar periodo' : ENTRY_TYPE_LABELS[t]}
                            </button>
                        ))}
                        <button data-testid={`payroll-action-${GOODS_TYPE}`} onClick={() => setGoodsOpen(true)}
                            className="col-span-2 py-3 rounded-xl font-black text-sm bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200">
                            Se lleva mercancía
                        </button>
                    </div>
                )}

                <div className="space-y-2" data-testid="payroll-entries">
                    {b.renglones.length === 0 && <p className="text-sm text-slate-500 text-center py-4">Sin movimientos en este periodo.</p>}
                    {[...b.renglones].reverse().map(e => {
                        const voided = e.status !== 'ACTIVO';
                        return (
                            <div key={e.id} data-testid="payroll-entry-row" className={`rounded-xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 flex justify-between items-center gap-2 ${voided ? 'opacity-50' : ''}`}>
                                <div className="min-w-0">
                                    <p className="font-bold text-sm text-slate-800 dark:text-white">
                                        {e.origen === 'ARRASTRE' ? 'Deuda del periodo anterior' : ENTRY_TYPE_LABELS[e.tipo]}
                                        {voided && <span className="ml-2 text-[10px] font-black bg-slate-200 dark:bg-slate-700 px-1.5 py-0.5 rounded">ANULADO</span>}
                                    </p>
                                    <p className="text-xs text-slate-500 truncate">
                                        {new Date(e.timestamp).toLocaleString('es-VE', { timeZone: 'America/Caracas', dateStyle: 'short', timeStyle: 'short' })}
                                        {e.metodoId ? ` · ${paymentMethods.find(m => m.id === e.metodoId)?.label || e.metodoId}` : ''}
                                        {e.tipo === GOODS_TYPE && Array.isArray(e.items) ? ` · ${goodsSummary(e.items)}` : ''}
                                        {e.nota ? ` · ${e.nota}` : ''}
                                    </p>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                    <span className={`font-black text-sm ${e.tipo === 'BONO' ? 'text-emerald-600' : 'text-red-500'}`}>
                                        {e.tipo === 'BONO' ? '+' : '−'}${formatUsd(e.montoUsd)}
                                        {e.moneda === 'BS' && <span className="block text-[10px] text-slate-500 text-right">Bs {formatBs(e.montoBs)}</span>}
                                    </span>
                                    {e.origen !== 'ARRASTRE' && (
                                        <>
                                            <button title="Imprimir ticket" onClick={() => receipt(e, 'print')} className="p-1.5 text-slate-400 hover:text-slate-700"><Printer size={14} /></button>
                                            <button title="Bajar PDF" onClick={() => receipt(e, 'pdf')} className="p-1.5 text-slate-400 hover:text-slate-700"><FileDown size={14} /></button>
                                        </>
                                    )}
                                    {!voided && e.origen !== 'ARRASTRE' && (
                                        <button title="Anular" data-testid="payroll-entry-void"
                                            onClick={() => askPin('Anular movimiento',
                                                MONEY_OUT_TYPES.has(e.tipo)
                                                    ? `El ${ENTRY_TYPE_LABELS[e.tipo].toLowerCase()} de $${formatUsd(e.montoUsd)} se tacha y su salida de caja también.`
                                                    : e.tipo === GOODS_TYPE
                                                        ? `La mercancía de $${formatUsd(e.montoUsd)} se tacha y los productos vuelven al inventario.`
                                                        : `El ${ENTRY_TYPE_LABELS[e.tipo].toLowerCase()} de $${formatUsd(e.montoUsd)} se tacha.`,
                                                async (p) => { await voidEntry(e.id, ctxFor(p)); await reload(); showToast('Movimiento anulado', 'success'); })}
                                            className="p-1.5 text-slate-400 hover:text-red-500"><Ban size={14} /></button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <EmployeeFormModal isOpen={employeeModal.open} employee={employeeModal.employee}
                    onClose={() => setEmployeeModal({ open: false, employee: null })} onSave={handleSaveEmployee} />
                <PayrollEntryModal isOpen={entryModal.open} tipo={entryModal.tipo} employee={selected} balance={shownBalance}
                    rate={rate} paymentMethods={paymentMethods} onClose={() => setEntryModal({ open: false, tipo: null })}
                    onSubmit={handleSubmitEntry} onReceipt={receipt} />
                <PayrollGoodsModal isOpen={goodsOpen} employee={selected} balance={shownBalance} rate={rate}
                    onClose={() => setGoodsOpen(false)} onSubmit={handleSubmitGoods} onReceipt={receipt} />
                {renderPinModal()}
            </div>
        );
    }

    function renderPinModal() {
        return (
            <Modal isOpen={!!pinAction} onClose={() => setPinAction(null)} title={pinAction?.title || ''}>
                <div className="space-y-3">
                    {pinAction?.message && <p className="text-sm text-slate-600 dark:text-slate-300">{pinAction.message}</p>}
                    <PinField value={pin} onChange={setPin} autoFocus />
                    {pinError && <p role="alert" data-testid="payroll-pin-error" className="text-sm font-bold text-red-600">{pinError}</p>}
                    <button onClick={runPinAction} data-testid="payroll-pin-confirm" className="w-full py-3 rounded-xl font-black text-white bg-brand">Confirmar</button>
                </div>
            </Modal>
        );
    }

    // ─── Lista ──────────────────────────────────────────────────────────────
    return (
        <div className="p-3 sm:p-6 pb-24 space-y-4" data-testid="payroll-panel">
            <div className="flex justify-between items-start gap-2">
                <div>
                    <h2 className="text-2xl font-black text-surface-700 dark:text-white tracking-tight flex items-center gap-2">
                        <Wallet size={26} className="text-brand" aria-hidden="true" /> Nómina
                    </h2>
                    <p className="text-sm text-slate-500" data-testid="payroll-total">
                        Por pagar este periodo: <b>${formatUsd(totalPorPagar)}</b> · Bs {formatBs(mulR(totalPorPagar, rate))}
                    </p>
                </div>
                <button onClick={() => setEmployeeModal({ open: true, employee: null })} data-testid="employee-new"
                    className="flex items-center gap-1 px-3 py-2.5 rounded-xl font-black text-sm text-white bg-brand hover:bg-brand-dark">
                    <Plus size={16} /> Empleado
                </button>
            </div>

            {employees.some(e => e.activo === false) && (
                <label className="flex items-center gap-2 text-xs font-bold text-slate-500">
                    <input type="checkbox" checked={showInactive} onChange={e => setShowInactive(e.target.checked)} /> Mostrar desactivados
                </label>
            )}

            {rows.length === 0 ? (
                <EmptyState icon={Wallet} title="Aún no hay empleados" description="Agrega a tu personal para llevar sus adelantos y pagos, y que salgan bien en el cierre de caja." />
            ) : (
                <div className="space-y-2">
                    {rows.map(({ employee: e, balance: b }) => {
                        const est = ESTADO[b.estado];
                        return (
                            <button key={e.id} data-testid="payroll-employee-row" onClick={() => openEmployee(e.id)}
                                className={`w-full text-left rounded-2xl border border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 flex justify-between items-center gap-3 hover:shadow-md transition-shadow ${e.activo === false ? 'opacity-60' : ''}`}>
                                <div className="min-w-0">
                                    <p className="font-black text-slate-800 dark:text-white truncate">{e.nombre}</p>
                                    <p className="text-xs text-slate-500 truncate">
                                        {[e.cargo, FRECUENCIA_LABELS[e.frecuencia], periodLabel(b.periodoId)].filter(Boolean).join(' · ')}
                                    </p>
                                </div>
                                <div className="text-right shrink-0">
                                    <p className="font-black text-brand">${formatUsd(Math.max(0, b.saldoUsd))}</p>
                                    <span className={`text-[10px] font-black px-2 py-0.5 rounded-full ${est.cls}`}>{est.label}</span>
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}

            <EmployeeFormModal isOpen={employeeModal.open} employee={employeeModal.employee}
                onClose={() => setEmployeeModal({ open: false, employee: null })} onSave={handleSaveEmployee} />
            {renderPinModal()}
        </div>
    );
}
