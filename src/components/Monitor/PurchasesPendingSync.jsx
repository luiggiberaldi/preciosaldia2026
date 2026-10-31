// Supervisor: compras que la caja ya guardó pero que aún no llegan de la nube.
// Van aparte y no suman al total; si tardan, avisa que la caja no está subiendo.
import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { formatUsd } from '../../utils/calculatorUtils';
import { computeUnsyncedPurchases } from '../../utils/purchasesPendingSync';

const fmtDate = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso)
    ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`
    : iso || '');

const fmtTime = (ms) => new Date(ms).toLocaleString('es-VE', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

export default function PurchasesPendingSync({ commands, purchases }) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), 30_000);
        return () => clearInterval(id);
    }, []);

    const { items, oldestAt, stale } = useMemo(
        () => computeUnsyncedPurchases(commands, purchases, now),
        [commands, purchases, now],
    );
    if (items.length === 0) return null;

    return (
        <section
            data-testid="purchases-pending-sync"
            className="rounded-2xl border border-dashed border-amber-300 dark:border-amber-700 bg-amber-50/70 dark:bg-amber-950/30 p-4 space-y-3"
        >
            <div className="flex items-center gap-2">
                <RefreshCw size={16} className="text-amber-600 dark:text-amber-400" />
                <h3 className="text-sm font-black text-amber-800 dark:text-amber-200">
                    Guardadas en la caja, sincronizando… ({items.length})
                </h3>
            </div>
            <p className="text-xs font-semibold text-amber-700 dark:text-amber-300">
                La caja ya las guardó. Aparecerán en la lista cuando la caja las suba a la nube; mientras tanto no suman al total. No las vuelvas a cargar.
            </p>
            {stale && (
                <div role="alert" data-testid="purchases-sync-stale" className="flex items-start gap-2 rounded-xl bg-red-50 dark:bg-red-950/40 border border-red-200 dark:border-red-800 p-3">
                    <AlertTriangle size={16} className="text-red-600 dark:text-red-400 shrink-0 mt-0.5" />
                    <p className="text-xs font-bold text-red-700 dark:text-red-300">
                        La caja no está subiendo datos a la nube desde el {fmtTime(oldestAt)}. Recarga la caja principal (F5) y revisa que su fecha y hora estén bien.
                    </p>
                </div>
            )}
            <ul className="divide-y divide-amber-200/70 dark:divide-amber-800/50">
                {items.map(({ kind, commandId, purchase }) => (
                    <li key={commandId} className="flex items-center justify-between gap-3 py-2 text-xs">
                        <div className="min-w-0">
                            <p className={`font-bold text-slate-700 dark:text-slate-200 truncate ${kind === 'delete' ? 'line-through' : ''}`}>
                                {purchase?.supplier || 'Compra'}
                                {purchase?.note ? <span className="font-semibold text-slate-500"> · {purchase.note}</span> : null}
                            </p>
                            <p className="text-slate-500">
                                {fmtDate(purchase?.date)}{kind === 'delete' ? ' · borrado pendiente' : ''}
                            </p>
                        </div>
                        <span className={`font-black whitespace-nowrap ${kind === 'delete' ? 'text-slate-400 line-through' : 'text-amber-700 dark:text-amber-300'}`}>
                            {formatUsd(purchase?.amountUsd || 0)}
                        </span>
                    </li>
                ))}
            </ul>
        </section>
    );
}
