// Supervisor: compras de mercancía de la caja. Cargar, corregir o borrar envía
// una orden (supervisor.purchase.*) que la caja aplica y publica; la lista se
// actualiza cuando llega su mes sincronizado.
import { useMemo, useState } from 'react';
import ReportsPurchasesTab from '../Reports/ReportsPurchasesTab';
import { useMerchandisePurchases } from '../../hooks/useMerchandisePurchases';
import { getDateRange, getLocalISODate } from '../../utils/dateHelpers';
import {
    PURCHASE_DELETE_TYPE,
    PURCHASE_UPSERT_TYPE,
    buildPurchaseDeletePayload,
    buildPurchaseUpsertPayload,
} from '../../utils/merchandisePurchases';
import { sendTracked } from './RemoteSupplierModals';
import PurchasesPendingSync from './PurchasesPendingSync';
import { usePurchaseCommands } from '../../hooks/usePurchaseCommands';

const RANGES = [
    { id: 'month', label: 'Este mes' },
    { id: 'lastMonth', label: 'Mes anterior' },
    { id: 'custom', label: 'Personalizado' },
];

export default function MonitorPurchasesPanel({ businessName = '', targetDeviceId = null, available = true, rate = 0, triggerHaptic }) {
    const { purchases } = useMerchandisePurchases();
    const purchaseCommands = usePurchaseCommands(targetDeviceId);
    const [range, setRange] = useState('month');
    const today = getLocalISODate(new Date());
    const [customFrom, setCustomFrom] = useState(today);
    const [customTo, setCustomTo] = useState(today);

    const send = (type, payload, label) => (available && targetDeviceId
        ? sendTracked({ type, targetDeviceId, payload, label })
        : Promise.resolve(false));
    const onSave = (purchase, { isEdit }) => send(
        PURCHASE_UPSERT_TYPE,
        buildPurchaseUpsertPayload(purchase),
        isEdit ? 'Corregir compra' : 'Compra de mercancía',
    );
    const onDelete = (purchase) => send(PURCHASE_DELETE_TYPE, buildPurchaseDeletePayload(purchase), 'Borrar compra');

    const { from, to } = useMemo(
        () => (range === 'custom' ? { from: customFrom, to: customTo } : getDateRange(range)),
        [range, customFrom, customTo],
    );

    return (
        <div className="space-y-4" data-testid="monitor-purchases-panel">
            <div className="flex flex-wrap items-center gap-2">
                {RANGES.map((opt) => (
                    <button
                        key={opt.id}
                        type="button"
                        onClick={() => { triggerHaptic?.(); setRange(opt.id); }}
                        className={`px-4 py-2 rounded-full text-xs font-bold ${range === opt.id
                            ? 'bg-emerald-600 text-white'
                            : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800'}`}
                    >
                        {opt.label}
                    </button>
                ))}
                {range === 'custom' && (
                    <div className="flex items-center gap-2 text-xs">
                        <input type="date" value={customFrom} max={customTo} onChange={(e) => setCustomFrom(e.target.value)} aria-label="Desde" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 font-bold" />
                        <span className="text-slate-400">a</span>
                        <input type="date" value={customTo} min={customFrom} onChange={(e) => setCustomTo(e.target.value)} aria-label="Hasta" className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 px-2 py-1.5 font-bold" />
                    </div>
                )}
            </div>
            <PurchasesPendingSync commands={purchaseCommands} purchases={purchases} />
            <ReportsPurchasesTab
                purchases={purchases}
                from={from}
                to={to}
                businessName={businessName}
                rate={rate}
                onSave={onSave}
                onDelete={onDelete}
                formHint="Se envía a la caja principal y aparece aquí cuando la caja la guarde. No descuenta de la caja ni sube el stock."
                formDisabledReason={available && targetDeviceId ? null : 'Sin conexión con la caja principal: no se puede cargar ahora.'}
                triggerHaptic={triggerHaptic}
            />
        </div>
    );
}
