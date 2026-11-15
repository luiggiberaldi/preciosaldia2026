import { useEffect, useState } from 'react';
import { Modal } from '../Modal';
import PinField from './PinField';
import CustomSelect from '../CustomSelect';
import { FRECUENCIAS, FRECUENCIA_LABELS } from '../../utils/payrollModel';

const EMPTY = { nombre: '', cedula: '', cargo: '', telefono: '', sueldoUsd: '', frecuencia: 'quincenal', fechaIngreso: '', nota: '' };

const inputCls = 'w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-white font-semibold';
// Lista desplegable con bordes redondeados (un <select> nativo no los permite en su menú).
export const selectBtnCls = '!bg-white dark:!bg-slate-800 !border-slate-200 dark:!border-slate-700 !shadow-none !px-3 !py-2.5 !text-base !text-slate-800 dark:!text-white';

function Field({ label, children }) {
    return (
        <label className="block">
            <span className="block text-xs font-bold text-slate-500 dark:text-slate-400 mb-1">{label}</span>
            {children}
        </label>
    );
}

/** Ficha del empleado: alta y edición. Guardar pide el PIN del Administrador. */
export default function EmployeeFormModal({ isOpen, employee, onClose, onSave }) {
    const [form, setForm] = useState(EMPTY);
    const [pin, setPin] = useState('');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        setForm(employee ? { ...EMPTY, ...employee, sueldoUsd: String(employee.sueldoUsd ?? '') } : EMPTY);
        setPin('');
        setError('');
    }, [isOpen, employee]);

    const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }));
    const sueldoCambia = employee && Number(form.sueldoUsd) !== Number(employee.sueldoUsd);

    const submit = async (e) => {
        e.preventDefault();
        setSaving(true);
        setError('');
        try {
            await onSave({ ...form, id: employee?.id, sueldoUsd: Number(form.sueldoUsd) }, pin);
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal isOpen={isOpen} onClose={onClose} title={employee ? 'Editar empleado' : 'Nuevo empleado'} size="max-w-md">
            <form onSubmit={submit} className="space-y-3" data-testid="employee-form">
                <Field label="Nombre y apellido *">
                    <input className={inputCls} value={form.nombre} onChange={set('nombre')} data-testid="employee-nombre" autoFocus />
                </Field>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Cédula"><input className={inputCls} value={form.cedula} onChange={set('cedula')} /></Field>
                    <Field label="Cargo"><input className={inputCls} value={form.cargo} onChange={set('cargo')} placeholder="Cajera, despacho…" /></Field>
                </div>
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Sueldo en $ *">
                        <input className={inputCls} type="number" inputMode="decimal" min="0" step="0.01" value={form.sueldoUsd} onChange={set('sueldoUsd')} data-testid="employee-sueldo" />
                    </Field>
                    <Field label="Se le paga">
                        <CustomSelect
                            testId="employee-frecuencia"
                            value={form.frecuencia}
                            onChange={(v) => setForm(f => ({ ...f, frecuencia: v }))}
                            options={FRECUENCIAS.map(f => ({ value: f, label: FRECUENCIA_LABELS[f] }))}
                            buttonClassName={selectBtnCls}
                        />
                    </Field>
                </div>
                {sueldoCambia && (
                    <p className="text-xs font-bold rounded-xl px-3 py-2 bg-amber-50 text-amber-900 border border-amber-300 dark:bg-amber-950/40 dark:text-amber-200 dark:border-amber-800">
                        ⚠ Si el periodo actual ya tiene movimientos, sigue con el sueldo anterior. El nuevo vale desde el próximo periodo.
                    </p>
                )}
                <div className="grid grid-cols-2 gap-3">
                    <Field label="Teléfono"><input className={inputCls} value={form.telefono} onChange={set('telefono')} /></Field>
                    <Field label="Fecha de ingreso"><input className={inputCls} type="date" value={form.fechaIngreso} onChange={set('fechaIngreso')} /></Field>
                </div>
                <Field label="Nota"><input className={inputCls} value={form.nota} onChange={set('nota')} /></Field>
                <PinField value={pin} onChange={setPin} />
                {error && <p role="alert" data-testid="employee-error" className="text-sm font-bold text-red-600">{error}</p>}
                <button type="submit" disabled={saving} data-testid="employee-save"
                    className="w-full py-3 rounded-xl font-black text-white bg-brand hover:bg-brand-dark disabled:opacity-50">
                    {saving ? 'Guardando…' : 'Guardar empleado'}
                </button>
            </form>
        </Modal>
    );
}
