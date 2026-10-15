import React, { useMemo, useState } from 'react';
import {
    AlertTriangle, Ban, CheckCircle2, ChevronLeft, ChevronRight, Clock3,
    Eye, FileWarning, Loader2, RefreshCw, WifiOff, XCircle,
} from 'lucide-react';
import {
    CONTROL_FILTERS,
    CONTROL_STATUS,
    getCommandDetails,
    getCommandTitle,
    getControlStatus,
    getControlStatusMeta,
    matchesControlFilter,
} from '../../services/supervisorControlService';

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

function formatTime(value) {
    if (!value) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function Kpi({ label, value, tone, hint }) {
    return <div className="rounded-3xl border border-slate-200/70 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5">
        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">{label}</p>
        <div className="mt-2 flex items-end justify-between gap-2">
            <strong className={`font-outfit text-2xl font-black leading-none ${tone}`}>{value}</strong>
            <span className="text-right text-[10px] font-bold text-slate-400">{hint}</span>
        </div>
    </div>;
}

function CommandRow({ command, onDetail, onCancel, onRetry, actionId }) {
    const status = getControlStatusMeta(command);
    const Icon = STATUS_ICONS[status.tone] || FileWarning;
    const details = getCommandDetails(command);
    const canCancel = status.status === CONTROL_STATUS.PENDING;
    const canRetry = [CONTROL_STATUS.FAILED, CONTROL_STATUS.REJECTED].includes(status.status);
    return <article className="rounded-3xl border border-slate-200/70 bg-white p-4 shadow-sm transition hover:border-primary-200 hover:shadow-md dark:border-slate-800 dark:bg-slate-900 sm:p-5">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-black uppercase tracking-wide ${TONE_CLASSES[status.tone]}`}>
                        <Icon size={13} /> {status.label}
                    </span>
                    <span className="text-[10px] font-bold text-slate-400">{formatTime(command.created_at || command.issued_at)}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                    <h3 className="truncate text-sm font-black text-slate-800 dark:text-white sm:text-base">{getCommandTitle(command)}</h3>
                    <span className="rounded-lg bg-slate-100 px-2 py-1 text-[10px] font-black uppercase text-slate-500 dark:bg-slate-800 dark:text-slate-300">{command.command_type?.replace('supervisor.', '') || 'orden'}</span>
                </div>
                {details.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{details.map((detail, index) => <span key={`${detail}-${index}`} className="rounded-lg border border-slate-200/70 bg-slate-50 px-2 py-1 text-[10px] font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300">{detail}</span>)}</div>}
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[10px] font-bold text-slate-400">
                    <span>Enviado: {formatTime(command.issued_at || command.created_at)}</span>
                    {(command.applied_at || (getControlStatus(command) === CONTROL_STATUS.APPLIED && command.updated_at)) && <span>Aplicado: {formatTime(command.applied_at || command.updated_at)}</span>}
                    <span>ID: {String(command.command_id || '').slice(0, 12)}…</span>
                </div>
                {command.error_message && <p className="mt-2 text-xs font-bold text-danger-600">{command.error_message}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
                {canRetry && <button type="button" onClick={() => onRetry(command)} disabled={actionId === command.command_id} className="min-h-10 rounded-2xl border border-warning-200 bg-warning-50 px-3 text-xs font-black text-warning-700 transition hover:bg-warning-100 disabled:opacity-50"><span className="inline-flex items-center gap-1.5">{actionId === command.command_id ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Reintentar</span></button>}
                {canCancel && <button type="button" onClick={() => onCancel(command.command_id)} disabled={actionId === command.command_id} className="min-h-10 rounded-2xl border border-danger-200 bg-danger-50 px-3 text-xs font-black text-danger-600 transition hover:bg-danger-100 disabled:opacity-50"><span className="inline-flex items-center gap-1.5">{actionId === command.command_id ? <Loader2 size={14} className="animate-spin" /> : <Ban size={14} />} Anular</span></button>}
                <button type="button" onClick={() => onDetail(command)} className="min-h-10 rounded-2xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-700 transition hover:border-primary-300 hover:text-primary-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"><span className="inline-flex items-center gap-1.5"><Eye size={14} /> Detalle</span></button>
            </div>
        </div>
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

export default function SupervisorControlPanel({ control, isConnected, onToast }) {
    const [filter, setFilter] = useState('all');
    const visibleCommands = useMemo(() => control.commands.filter(command => matchesControlFilter(command, filter)), [control.commands, filter]);
    const pageCount = Math.max(1, Math.ceil(control.total / control.pageSize));
    const currentPage = control.page + 1;
    const kpis = control.counts;

    const cancel = async commandId => {
        const result = await control.cancel(commandId);
        onToast?.(result.ok ? 'Orden anulada' : result.error, result.ok ? 'success' : 'error');
    };
    const retry = async command => {
        const result = await control.retry(command);
        onToast?.(result.ok ? 'Orden reenviada a la caja' : result.error, result.ok ? 'success' : 'error');
    };

    return <section className="space-y-5 animate-fade-in" data-testid="supervisor-control-panel">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"><div><p className="text-[10px] font-black uppercase tracking-widest text-primary-600">Trazabilidad operativa</p><h2 className="mt-1 text-xl font-black text-slate-900 dark:text-white sm:text-2xl">Control de órdenes</h2><p className="mt-1 max-w-2xl text-xs font-semibold text-slate-500">Confirma qué llegó a la caja, qué sigue en espera y qué requiere revisión.</p></div><button type="button" onClick={() => control.refresh({ silent: true })} disabled={control.refreshing || !isConnected} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 text-xs font-black text-slate-700 shadow-sm transition hover:border-primary-300 disabled:opacity-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"><RefreshCw size={14} className={control.refreshing ? 'animate-spin' : ''} /> Actualizar</button></div>
        {!isConnected && <div className="flex items-start gap-2 rounded-2xl border border-warning-200 bg-warning-50 p-3 text-xs font-bold text-warning-700"><WifiOff size={16} className="mt-0.5 shrink-0" /> Sin conexión en tiempo real. Mostramos el último estado disponible.</div>}
        {control.error && <div className="flex items-start gap-2 rounded-2xl border border-danger-200 bg-danger-50 p-3 text-xs font-bold text-danger-700"><AlertTriangle size={16} className="mt-0.5 shrink-0" /> {control.error}</div>}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5"><Kpi label="Sin enviar" value="0" tone="text-primary-600" hint="Navegador" /><Kpi label="En espera" value={kpis.pending} tone="text-warning-600" hint="Caja" /><Kpi label="Aplicados" value={kpis.applied} tone="text-success-600" hint="Confirmados" /><Kpi label="Advertencias" value={kpis.warnings} tone="text-warning-600" hint="Revisar" /><Kpi label="Fallidos" value={kpis.failed} tone="text-danger-600" hint="Acción" /></div>
        <div className="rounded-3xl border border-slate-200/70 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900"><div className="flex gap-1 overflow-x-auto scrollbar-hide">{CONTROL_FILTERS.map(item => { const count = item.id === 'all' ? kpis.total : item.id === 'pending' ? kpis.pending : item.id === 'applied' ? kpis.applied : item.id === 'warnings' ? kpis.warnings : item.id === 'failed' ? kpis.failed : kpis.cancelled; return <button key={item.id} type="button" onClick={() => setFilter(item.id)} className={`min-h-10 shrink-0 rounded-2xl px-3 text-xs font-black transition ${filter === item.id ? 'bg-primary-600 text-white shadow-primary' : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>{item.label} ({count})</button>; })}</div></div>
        {control.loading ? <div className="flex min-h-56 items-center justify-center rounded-3xl border border-slate-200/70 bg-white dark:border-slate-800 dark:bg-slate-900"><Loader2 className="animate-spin text-primary-600" /></div> : visibleCommands.length === 0 ? <div className="rounded-3xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center dark:border-slate-700 dark:bg-slate-900"><CheckCircle2 size={30} className="mx-auto text-success-500" /><p className="mt-3 text-sm font-black text-slate-700 dark:text-slate-200">No hay órdenes en este estado</p><p className="mt-1 text-xs font-semibold text-slate-400">Las nuevas operaciones aparecerán aquí sin descargar el historial completo.</p></div> : <div className="space-y-3">{visibleCommands.map(command => <CommandRow key={command.command_id} command={command} onDetail={control.openDetail} onCancel={cancel} onRetry={retry} actionId={control.actionId} />)}</div>}
        {pageCount > 1 && <div className="flex items-center justify-between rounded-3xl border border-slate-200/70 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900"><button type="button" onClick={() => control.setPage(Math.max(0, control.page - 1))} disabled={control.page === 0 || control.loading} className="rounded-xl border border-slate-200 p-2 text-slate-500 disabled:opacity-40 dark:border-slate-700"><ChevronLeft size={16} /></button><span className="text-xs font-bold text-slate-500">Página <strong className="text-slate-800 dark:text-white">{currentPage}</strong> de {pageCount}</span><button type="button" onClick={() => control.setPage(Math.min(pageCount - 1, control.page + 1))} disabled={currentPage >= pageCount || control.loading} className="rounded-xl border border-slate-200 p-2 text-slate-500 disabled:opacity-40 dark:border-slate-700"><ChevronRight size={16} /></button></div>}
        <DetailDrawer command={control.selectedCommand} loading={control.detailLoading} onClose={control.closeDetail} />
    </section>;
}

