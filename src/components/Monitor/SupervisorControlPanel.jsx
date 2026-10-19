import React, { useMemo, useState } from 'react';
import {
    AlertTriangle, Ban, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronUp,
    Clock3, Eye, FileWarning, Loader2, RefreshCw, ShieldCheck, ShieldQuestion,
    WifiOff, XCircle,
} from 'lucide-react';
import {
    CONTROL_STATUS,
    getCommandDetails,
    getCommandTitle,
    getControlStatus,
    getControlStatusMeta,
} from '../../services/supervisorControlService';
import { getCommandReceipt } from '../../services/supervisorCommandReceipt';
import { getTrackedSupervisorCommands } from '../../services/supervisorCommandTracker';

const STATUS_ICONS = {
    info: Clock3,
    warning: AlertTriangle,
    success: CheckCircle2,
    danger: XCircle,
    muted: Ban,
};

const TONE_CLASSES = {
    info: 'border-primary-200 bg-primary-50 text-primary-700',
    warning: 'border-warning-200 bg-warning-50 text-warning-700',
    success: 'border-success-200 bg-success-50 text-success-700',
    danger: 'border-danger-200 bg-danger-50 text-danger-700',
    muted: 'border-slate-200 bg-slate-50 text-slate-600',
};

const SEAL_ICON = {
    success: ShieldCheck,
    warning: AlertTriangle,
    danger: XCircle,
    info: Clock3,
    muted: Ban,
};

// Modelo del panel de Donde Juancho: cinco filtros con sus conteos. Las
// advertencias (applied_with_warnings) se ven como sello dentro de "Aplicados".
const RECEIPT_FILTERS = [
    { id: 'all', label: 'Todos' },
    { id: 'pending', label: 'Pendientes' },
    { id: 'applied', label: 'Aplicados' },
    { id: 'cancelled', label: 'Anulados' },
    { id: 'rejected', label: 'Rechazados' },
];

const FILTER_STATUSES = {
    all: null,
    pending: [CONTROL_STATUS.PENDING, CONTROL_STATUS.RECEIVED, CONTROL_STATUS.LOCAL_PENDING],
    applied: [CONTROL_STATUS.APPLIED, CONTROL_STATUS.APPLIED_WITH_WARNINGS],
    cancelled: [CONTROL_STATUS.CANCELLED],
    // Requieren acción: rechazados, fallidos, expirados y los que piden revisión.
    rejected: [CONTROL_STATUS.REJECTED, CONTROL_STATUS.FAILED, CONTROL_STATUS.EXPIRED, CONTROL_STATUS.CONFLICT],
};

function matchesReceiptFilter(command, filterId) {
    const statuses = FILTER_STATUSES[filterId];
    if (!statuses) return true;
    return statuses.includes(getControlStatus(command));
}

// Aviso honesto de arrepentimiento tardío (propuesta 6): si la anulación
// falla porque la caja ya pudo tomar el cambio, decirlo literalmente en vez de
// dejar un error seco que prometa menos de lo que pasó.
export function describeCancelFailure(result = {}) {
    const base = result?.error || 'No se pudo anular la orden';
    const alreadyTaken = Boolean(result?.status)
        && result.status !== 'unknown'
        && result.status !== CONTROL_STATUS.CANCELLED;
    return alreadyTaken
        ? `${base}. El cambio puede haber llegado ya a la caja; verifica su estado.`
        : base;
}

function formatTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function Kpi({ label, value, tone, hint, testid }) {
    return <div data-testid={testid} className="rounded-3xl border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5">
        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p>
        <div className="mt-2 flex items-end justify-between gap-2">
            <strong className={`font-outfit text-2xl font-black leading-none ${tone}`}>{value}</strong>
            <span className="text-right text-[10px] font-bold text-slate-400">{hint}</span>
        </div>
    </div>;
}

function VerificationSeal({ verification }) {
    const tone = verification?.tone || 'info';
    const Icon = SEAL_ICON[tone] || ShieldQuestion;
    return <span
        data-testid="receipt-verification"
        className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${TONE_CLASSES[tone]}`}
    >
        <Icon size={13} /> {verification?.label || 'Recibido por la caja'}
    </span>;
}

function CommandRow({ command, resolveName, verification, onDetail, onCancel, onRetry, actionId }) {
    const [techOpen, setTechOpen] = useState(false);
    const receipt = getCommandReceipt(command, { verification, resolveName });
    const status = getControlStatusMeta(command);
    const Icon = STATUS_ICONS[status.tone] || FileWarning;
    const details = getCommandDetails(command);
    const canCancel = status.status === CONTROL_STATUS.PENDING;
    const canRetry = [CONTROL_STATUS.FAILED, CONTROL_STATUS.REJECTED].includes(status.status);
    const isMismatch = receipt.verification?.level === 'mismatch';
    const sealIcon = SEAL_ICON[receipt.seal.tone] || ShieldCheck;

    return <article
        data-command-id={command.command_id}
        data-verification={receipt.verification?.level || 'received'}
        className={`rounded-3xl border bg-white p-4 shadow-sm transition hover:shadow-md dark:bg-slate-900 sm:p-5 ${isMismatch ? 'border-danger-300 ring-2 ring-danger-500/20' : 'border-slate-200/70 hover:border-primary-200 dark:border-slate-800'}`}
    >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0 flex-1">
                {/* Sello de estado + fecha tipo recibo */}
                <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${TONE_CLASSES[status.tone]}`}>
                        <Icon size={13} /> {receipt.dateLabel}
                    </span>
                    <VerificationSeal verification={receipt.verification} />
                </div>

                {/* Qué se pidió */}
                <div className="mt-2 flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-black text-slate-800 dark:text-white sm:text-base">{receipt.title}</h3>
                    <span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-black uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-300">{receipt.typeLabel}</span>
                </div>

                {/* Detalle del movimiento */}
                {receipt.detailLines.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">
                    {receipt.detailLines.map((line, index) => (
                        <span key={`${line}-${index}`} className="rounded-lg border border-slate-200/70 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{line}</span>
                    ))}
                </div>}
                {details.length > 0 && <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {details.map((detail, index) => (
                        <span key={`${detail}-${index}`} className="rounded-lg border border-slate-200/60 px-2 py-0.5 text-[10px] font-bold text-slate-400">{detail}</span>
                    ))}
                </div>}

                {/* Quién y cuándo */}
                <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-bold text-slate-400">
                    <span>{receipt.actorLabel}</span>
                    <span>Enviado: {formatTime(receipt.sentAt)}</span>
                    {receipt.appliedAt && <span>Aplicado a las {formatTime(receipt.appliedAt)}</span>}
                    <span>ID: {String(command.command_id || '').slice(0, 12)}…</span>
                </div>

                {/* Sello final de la caja */}
                <div className="mt-2 flex items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${TONE_CLASSES[receipt.seal.tone]}`}>
                        {React.createElement(sealIcon, { size: 13 })} {receipt.seal.label}
                    </span>
                </div>
            </div>

            <div className="flex shrink-0 flex-col items-stretch gap-2 lg:items-end">
                <div className="flex items-center gap-2">
                    {canRetry && <button type="button" onClick={() => onRetry(command)} disabled={actionId === command.command_id} className="min-h-10 rounded-2xl border border-warning-200 bg-warning-50 px-3 text-xs font-black text-warning-700 transition hover:bg-warning-100 disabled:opacity-50"><span className="inline-flex items-center gap-1.5">{actionId === command.command_id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Reintentar</span></button>}
                    {canCancel && <button type="button" onClick={() => onCancel(command.command_id)} disabled={actionId === command.command_id} className="min-h-10 rounded-2xl border border-danger-200 bg-danger-50 px-3 text-xs font-black text-danger-600 transition hover:bg-danger-100 disabled:opacity-50"><span className="inline-flex items-center gap-1.5">{actionId === command.command_id ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />} Anular</span></button>}
                    <button type="button" onClick={() => onDetail(command)} className="min-h-10 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-primary-300 hover:text-primary-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"><span className="inline-flex items-center gap-1.5"><Eye size={14} /> Detalle</span></button>
                </div>
                {/* Detalle técnico plegable: auditable sin ensuciar la ficha */}
                <button
                    type="button"
                    onClick={() => setTechOpen(open => !open)}
                    className="inline-flex min-h-9 items-center justify-center gap-1.5 rounded-2xl px-3 text-[10px] font-black uppercase tracking-wide text-slate-400 transition hover:text-slate-600 dark:hover:text-slate-300"
                >
                    {techOpen ? <ChevronUp size={13} /> : <ChevronDown size={13} />} Ver detalle técnico
                </button>
            </div>
        </div>

        {techOpen && <div className="mt-3 space-y-3 rounded-2xl border border-slate-200/70 p-3 dark:border-slate-800">
            {command.error_message && <div className="rounded-2xl border border-danger-200 bg-danger-50 p-3 text-xs font-bold text-danger-700"><div className="flex gap-2"><AlertTriangle size={15} className="mt-0.5 shrink-0" />{command.error_message}</div></div>}
            <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Payload técnico</p>
                <pre className="max-h-56 overflow-auto rounded-2xl bg-slate-950 p-3 text-[11px] leading-relaxed text-slate-200">{JSON.stringify(command.payload || {}, null, 2)}</pre>
            </div>
            {command.ack_payload && <div>
                <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Respuesta de la caja</p>
                <pre className="max-h-56 overflow-auto rounded-2xl bg-slate-950 p-3 text-[11px] leading-relaxed text-emerald-200">{JSON.stringify(command.ack_payload, null, 2)}</pre>
            </div>}
        </div>}
    </article>;
}

function DetailDrawer({ command, loading, onClose }) {
    if (!command) return null;
    const status = getControlStatusMeta(command);
    return <div className="fixed inset-0 z-[1000] flex justify-end bg-slate-900/40 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Detalle del comando">
        <button type="button" className="absolute inset-0 cursor-default" aria-label="Cerrar detalle" onClick={onClose} />
        <aside className="relative z-10 h-full w-full max-w-xl overflow-y-auto border-l border-slate-200 bg-white p-5 shadow-2xl dark:border-slate-800 dark:bg-slate-950 sm:p-7">
            <div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-black uppercase tracking-widest text-primary-600">Auditoría del comando</p><h2 className="mt-1 text-xl font-black text-slate-900 dark:text-white">{getCommandTitle(command)}</h2></div><button type="button" onClick={onClose} className="rounded-2xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800" aria-label="Cerrar"><XCircle size={22} /></button></div>
            <div className={`mt-5 inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-black ${TONE_CLASSES[status.tone]}`}><CheckCircle2 size={15} />{status.label}</div>
            {loading ? <div className="flex min-h-40 items-center justify-center"><Loader2 className="animate-spin text-primary-600" /></div> : <div className="mt-6 space-y-5">
                <div className="grid grid-cols-2 gap-3">{[['Creado', command.created_at], ['Enviado', command.issued_at], ['Aplicado', command.applied_at || (getControlStatus(command) === CONTROL_STATUS.APPLIED ? command.updated_at : null)], ['Actualizado', command.updated_at]].map(([label, value]) => <div key={label} className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-900"><p className="text-[10px] font-black uppercase text-slate-400">{label}</p><p className="mt-1 text-xs font-bold text-slate-700 dark:text-slate-200">{formatTime(value)}</p></div>)}</div>
                <div className="rounded-2xl border border-slate-200/70 p-4 dark:border-slate-800"><p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Identificación</p><p className="mt-2 break-all font-mono text-xs text-slate-700 dark:text-slate-200">{command.command_id}</p><p className="mt-2 text-xs font-bold text-slate-500">Caja: {command.target_device_id || '—'}</p><p className="mt-1 text-xs font-bold text-slate-500">Actor: {command.actor_auth_id || '—'}</p></div>
                {command.error_message && <div className="rounded-2xl border border-danger-200 bg-danger-50 p-4 text-xs font-bold text-danger-700"><div className="flex gap-2"><AlertTriangle size={16} />{command.error_message}</div></div>}
                <div><p className="mb-2 text-[10px] font-black uppercase tracking-wider text-slate-400">Payload técnico</p><pre className="max-h-72 overflow-auto rounded-2xl bg-slate-950 p-4 text-[11px] leading-relaxed text-slate-200">{JSON.stringify(command.payload || {}, null, 2)}</pre></div>
                {command.ack_payload && <div><p className="mb-2 text-[10px] font-black uppercase tracking-wider text-slate-400">Respuesta de la caja</p><pre className="max-h-56 overflow-auto rounded-2xl bg-slate-950 p-4 text-[11px] leading-relaxed text-emerald-200">{JSON.stringify(command.ack_payload, null, 2)}</pre></div>}
            </div>}
        </aside>
    </div>;
}

export default function SupervisorControlPanel({ control, isConnected, onToast, resolveName = null }) {
    const [filter, setFilter] = useState('all');
    const verificationByCommand = useMemo(() => new Map(
        (control.verifications || []).map(entry => [String(entry.commandId), entry]),
    ), [control.verifications]);

    const visibleCommands = useMemo(
        () => control.commands.filter(command => matchesReceiptFilter(command, filter)),
        [control.commands, filter],
    );
    const filterCounts = useMemo(() => Object.fromEntries(
        RECEIPT_FILTERS.map(item => [item.id, control.commands.filter(command => matchesReceiptFilter(command, item.id)).length]),
    ), [control.commands]);

    // Contadores del modelo de Donde Juancho. Los globales vienen del RPC de
    // conteos; "Sin subir" es local por definición (tracker en vuelo + pendientes
    // de enviar del listado): la nube no puede saberlo.
    const kpis = control.counts || {};
    const inFlight = useMemo(() => getTrackedSupervisorCommands().filter(record => !record.finalNotified).length, [control.commands, control.verifications]);
    const localPending = useMemo(() => control.commands.filter(command => getControlStatus(command) === CONTROL_STATUS.LOCAL_PENDING).length, [control.commands]);
    const expiredOnPage = useMemo(() => control.commands.filter(command => getControlStatus(command) === CONTROL_STATUS.EXPIRED).length, [control.commands]);

    const pageCount = Math.max(1, Math.ceil(control.total / control.pageSize));
    const currentPage = control.page + 1;

    const cancel = async commandId => {
        const result = await control.cancel(commandId);
        onToast?.(result.ok ? 'Orden anulada' : describeCancelFailure(result), result.ok ? 'success' : 'error');
    };
    const retry = async command => {
        const result = await control.retry(command);
        onToast?.(result.ok ? 'Orden reenviada a la caja' : result.error, result.ok ? 'success' : 'error');
    };

    return <section className="space-y-5 animate-fade-in" data-testid="supervisor-control-panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-black uppercase tracking-widest text-primary-600">Trazabilidad operativa</p><h2 className="mt-1 text-xl font-black text-slate-900 dark:text-white sm:text-2xl">Control de órdenes</h2><p className="mt-1 max-w-2xl text-xs font-semibold text-slate-500">Confirma qué llegó a la caja, qué sigue en espera y qué requiere revisión.</p></div><button type="button" onClick={() => control.refresh({ silent: true })} disabled={control.refreshing || !isConnected} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-xs font-black text-slate-700 shadow-sm transition hover:border-primary-300 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"><RefreshCw size={14} className={control.refreshing ? 'animate-spin' : ''} /> Actualizar</button></div>
        {!isConnected && <div className="flex items-start gap-2 rounded-2xl border border-warning-200 bg-warning-50 p-3 text-xs font-bold text-warning-700"><WifiOff size={16} className="mt-0.5 shrink-0" /> Sin conexión en tiempo real. Mostramos el último estado disponible.</div>}
        {control.error && <div className="flex items-start gap-2 rounded-2xl border border-danger-200 bg-danger-50 p-3 text-xs font-bold text-danger-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> {control.error}</div>}

        {/* Los cuatro contadores grandes del panel de Donde Juancho */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Kpi testid="kpi-sin-subir" label="Sin subir (en navegador)" value={localPending + inFlight} tone="text-primary-600" hint="En navegador" />
            <Kpi testid="kpi-en-espera" label="En espera de la caja" value={Number(kpis.pending || 0)} tone="text-warning-600" hint="Espera a la caja" />
            <Kpi testid="kpi-aplicados" label="Aplicados por la caja" value={Number(kpis.applied || 0) + Number(kpis.warnings || 0)} tone="text-success-600" hint="Completados" />
            <Kpi testid="kpi-anulados" label="Anulados / cancelados" value={Number(kpis.cancelled || 0)} tone="text-danger-600" hint={expiredOnPage > 0 ? 'Incluye expirados' : 'Cancelados'} />
        </div>

        <div className="rounded-3xl border border-slate-200/70 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex gap-1 overflow-x-auto scrollbar-hide">{RECEIPT_FILTERS.map(item => (
            <button key={item.id} type="button" onClick={() => setFilter(item.id)} className={`min-h-10 shrink-0 rounded-2xl px-3 text-xs font-black transition ${filter === item.id ? 'bg-emerald-600 text-white shadow-emerald-500/20' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{item.label} ({filterCounts[item.id]})</button>
        ))}</div></div>

        {control.loading ? <div className="flex min-h-56 items-center justify-center rounded-3xl border border-slate-200/70 bg-white dark:border-slate-800 dark:bg-slate-900"><Loader2 className="animate-spin text-primary-600" /></div>
            : control.commands.length === 0 ? <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center dark:border-slate-700 dark:bg-slate-900"><CheckCircle2 size={30} className="mx-auto text-success-500" /><p className="mt-3 text-sm font-black text-slate-700 dark:text-slate-200">Todavía no hay cambios registrados</p><p className="mt-1 text-xs font-semibold text-slate-400">Las órdenes que envíes desde el supervisor aparecerán aquí con su recibo y su sello.</p></div>
                : visibleCommands.length === 0 ? <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center dark:border-slate-700 dark:bg-slate-900"><CheckCircle2 size={30} className="mx-auto text-success-500" /><p className="mt-3 text-sm font-black text-slate-700 dark:text-slate-200">No hay órdenes en este estado</p><p className="mt-1 text-xs font-semibold text-slate-400">Cambia de filtro para ver el resto del historial.</p></div>
                    : <div className="space-y-3">{visibleCommands.map(command => <CommandRow key={command.command_id} command={command} resolveName={resolveName} verification={verificationByCommand.get(String(command.command_id))} onDetail={control.openDetail} onCancel={cancel} onRetry={retry} actionId={control.actionId} />)}</div>}

        {pageCount > 1 && <div className="flex items-center justify-between rounded-3xl border border-slate-200/70 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900"><button type="button" onClick={() => control.setPage(Math.max(0, control.page - 1))} disabled={control.page === 0 || control.loading} className="rounded-xl border border-slate-200 p-2 text-slate-500 disabled:opacity-40 dark:border-slate-700"><ChevronLeft size={16} /></button><span className="text-xs font-bold text-slate-500">Página <strong className="text-slate-800 dark:text-white">{currentPage}</strong> de {pageCount}</span><button type="button" onClick={() => control.setPage(Math.min(pageCount - 1, control.page + 1))} disabled={currentPage >= pageCount || control.loading} className="rounded-xl border border-slate-200 p-2 text-slate-500 disabled:opacity-40 dark:border-slate-700"><ChevronRight size={16} /></button></div>}
        <DetailDrawer command={control.selectedCommand} loading={control.detailLoading} onClose={control.closeDetail} />
    </section>;
}
