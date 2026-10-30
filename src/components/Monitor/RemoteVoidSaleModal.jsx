// Anular una venta del turno desde el Supervisor (supervisor.sale.void).
// La caja principal la anula con su flujo normal (devuelve stock, revierte
// cartera); aquí solo se pide, se espera el resultado y se puede cancelar
// mientras la caja no la haya tomado.
import React, { useRef, useState } from 'react';
import { Ban, X } from 'lucide-react';
import { sendSupervisorCommand } from '../../services/supervisorCommandService';
import { waitRemoteSaleOutcome } from '../../services/supervisorSaleSender';
import { reportSupervisorCommandOutcome } from '../../services/supervisorCommandDiagnostics';
import { REMOTE_VOID_LIMITS, REMOTE_VOID_TYPE, buildRemoteVoidPayload, validateRemoteVoidPayload } from '../../services/supervisorSaleVoidCommand';
import { formatBs, formatUsd } from '../../utils/calculatorUtils';
import { SELLER_NAME_KEY } from './RemoteSalePanel';

const VOID_MESSAGES = {
    registered: 'Venta anulada en la caja principal. El stock volvió al inventario.',
    not_registered_user: 'Cancelaste la anulación antes de que la caja la tomara. La venta sigue activa.',
    not_registered: 'La caja principal no tomó la anulación a tiempo. La venta sigue activa: revisa que la caja tenga la app abierta.',
};

export default function RemoteVoidSaleModal({ sale, targetDeviceId, available = true, onClose, triggerHaptic }) {
    const [reason, setReason] = useState('');
    const [state, setState] = useState({ phase: 'idle', message: null });
    const cancelRequestedRef = useRef(false);
    const busy = ['sending', 'waiting', 'received', 'cancelling'].includes(state.phase);
    const done = ['registered', 'rejected', 'not_registered', 'failed', 'unresolved'].includes(state.phase);

    const submit = async () => {
        triggerHaptic?.();
        const payload = buildRemoteVoidPayload({
            sale,
            reason,
            requestedBy: { name: localStorage.getItem(SELLER_NAME_KEY) || 'Supervisor', deviceId: localStorage.getItem('pda_device_id') },
        });
        const check = validateRemoteVoidPayload(payload);
        if (!check.ok) { setState({ phase: 'invalid', message: check.error }); return; }

        cancelRequestedRef.current = false;
        setState({ phase: 'sending', message: null });
        let sent;
        try {
            sent = await sendSupervisorCommand({ type: REMOTE_VOID_TYPE, targetDeviceId, payload });
        } catch (error) {
            sent = { ok: false, error: error?.message };
        }
        if (!sent?.ok) {
            reportSupervisorCommandOutcome({ type: REMOTE_VOID_TYPE, status: sent?.status || 'failed', error: sent?.error });
            setState({ phase: 'failed', message: sent?.error || 'No se pudo enviar la anulación' });
            return;
        }
        setState({ phase: 'waiting', message: null });
        const outcome = await waitRemoteSaleOutcome({
            commandId: sent.commandId,
            ackPromise: sent.ackPromise,
            isCancelRequested: () => cancelRequestedRef.current,
            onProgress: (p) => {
                if (p === 'received') setState({ phase: 'received', message: null });
                if (p === 'cancel_refused') setState({ phase: 'received', message: 'Ya no se puede cancelar: la caja la está anulando.' });
            },
        });
        reportSupervisorCommandOutcome({
            commandId: sent.commandId,
            type: REMOTE_VOID_TYPE,
            status: outcome.phase === 'registered' ? outcome.status : (outcome.phase === 'rejected' ? 'rejected' : 'failed'),
            error: outcome.error || null,
        });
        const message = outcome.phase === 'registered'
            ? VOID_MESSAGES.registered
            : outcome.phase === 'not_registered'
                ? (cancelRequestedRef.current ? VOID_MESSAGES.not_registered_user : VOID_MESSAGES.not_registered)
                : outcome.error;
        setState({ phase: outcome.phase, message });
    };

    const tone = state.phase === 'registered' ? 'emerald' : (state.phase === 'rejected' || state.phase === 'failed' ? 'red' : 'amber');

    return (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/50 backdrop-blur-sm p-4" role="dialog" aria-modal="true" aria-label="Anular venta">
            <div data-testid="remote-void-modal" className="w-full max-w-sm rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-5 space-y-4">
                <div className="flex items-start justify-between gap-3">
                    <div>
                        <h3 className="text-base font-black text-slate-800 dark:text-white flex items-center gap-2"><Ban size={18} className="text-red-500" /> Anular venta{sale.saleNumber ? ` #${sale.saleNumber}` : ''}</h3>
                        <p className="text-xs text-slate-500 mt-1">
                            ${formatUsd(sale.totalUsd || 0)} · {formatBs(sale.totalBs || 0)} Bs
                            {sale.remoteSale?.sellerName ? ` · Remota · ${sale.remoteSale.sellerName}` : ''}
                        </p>
                    </div>
                    {!busy && (
                        <button type="button" onClick={onClose} aria-label="Cerrar" className="p-1.5 rounded-full text-slate-400 hover:text-slate-600"><X size={18} /></button>
                    )}
                </div>

                {state.phase === 'idle' || state.phase === 'invalid' ? (
                    <>
                        <p className="text-xs text-slate-600 dark:text-slate-300">La caja principal anulará la venta, devolverá el stock y la sacará del cierre. No se puede deshacer.</p>
                        <label className="block">
                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">Motivo</span>
                            <input
                                autoFocus
                                value={reason}
                                onChange={(e) => setReason(e.target.value)}
                                maxLength={REMOTE_VOID_LIMITS.MAX_REASON}
                                placeholder="Ej: el cliente devolvió el producto"
                                aria-label="Motivo de la anulación"
                                className="mt-1 w-full form-input border border-slate-200 dark:border-slate-800 rounded-xl px-3 py-2.5 text-sm font-bold dark:bg-slate-950"
                            />
                        </label>
                        {state.phase === 'invalid' && <p role="alert" className="text-xs font-bold text-red-600">{state.message}</p>}
                        {!available && <p role="alert" className="text-xs font-bold text-amber-700 bg-amber-50 rounded-xl p-2">Sin conexión con la caja principal: no se puede anular ahora.</p>}
                        <div className="flex gap-2">
                            <button type="button" onClick={onClose} className="flex-1 py-2.5 rounded-xl border text-xs font-bold text-slate-500">Volver</button>
                            <button
                                type="button"
                                onClick={submit}
                                disabled={!available || reason.trim().length < REMOTE_VOID_LIMITS.MIN_REASON}
                                className="flex-1 py-2.5 rounded-xl bg-red-600 disabled:opacity-40 text-white text-xs font-black"
                            >
                                Anular venta
                            </button>
                        </div>
                    </>
                ) : (
                    <div role={done ? 'alert' : 'status'} data-testid="remote-void-status" className={`rounded-2xl border p-4 space-y-2 ${tone === 'emerald' ? 'border-emerald-300 bg-emerald-50 dark:bg-emerald-950/30' : tone === 'red' ? 'border-red-300 bg-red-50 dark:bg-red-950/30' : 'border-amber-300 bg-amber-50 dark:bg-amber-950/30'}`}>
                        {busy && <div className="w-6 h-6 rounded-full border-4 border-amber-200 border-t-amber-500 animate-spin" />}
                        <p className="text-sm font-black text-slate-800 dark:text-slate-100">
                            {state.phase === 'registered' ? '✅ Venta anulada'
                                : state.phase === 'rejected' ? 'La caja rechazó la anulación'
                                    : state.phase === 'cancelling' ? 'Cancelando la anulación…'
                                        : state.phase === 'received' ? 'La caja recibió la orden, anulando…'
                                            : busy ? 'Enviando la anulación a la caja…'
                                                : state.phase === 'unresolved' ? 'Anulación sin confirmar' : 'La anulación no se hizo'}
                        </p>
                        {state.message && <p className="text-xs text-slate-700 dark:text-slate-300">{state.message}</p>}
                        {state.phase === 'waiting' && (
                            <>
                                <p className="text-[11px] text-amber-700/80">La caja principal debe tener la app abierta. Si no la toma en 2 minutos se cancela sola y la venta sigue activa.</p>
                                <button
                                    type="button"
                                    onClick={() => { cancelRequestedRef.current = true; setState({ phase: 'cancelling', message: null }); }}
                                    className="w-full py-2.5 rounded-xl border border-amber-300 bg-white dark:bg-slate-900 text-amber-800 text-xs font-black"
                                >
                                    Cancelar anulación
                                </button>
                            </>
                        )}
                        {done && (
                            <button type="button" onClick={onClose} className="w-full py-2.5 rounded-xl bg-slate-800 text-white text-xs font-black">Cerrar</button>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
