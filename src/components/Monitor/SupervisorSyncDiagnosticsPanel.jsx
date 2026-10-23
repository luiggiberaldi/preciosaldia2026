import React from 'react';
import { Clock, Radio, X } from 'lucide-react';

function formatWhen(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function formatBytes(bytes) {
    if (!Number.isFinite(bytes)) return '—';
    if (bytes <= 0) return '0 B';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function echoSourceLabel(source) {
    if (source === 'realtime') return 'Realtime';
    if (source === 'pull-413') return 'Pull de respaldo (413)';
    if (source === 'pull') return 'Pull';
    return source || '—';
}

/**
 * Panel de diagnóstico de sincronización del supervisor: el último eco recibido
 * con su watermark, y los eventos Realtime sin cuerpo (413) con los pulls de
 * respaldo que los resolvieron. Además pinta los bytes del último pull
 * (telemetría de egress: completo ~MB vs incremental ~0 B). Los datos llegan
 * puros desde useMonitorSync (updateSyncDiagnostics); el panel solo los pinta.
 * Gemelo visual de SupervisorCommandDiagnosticsPanel.
 */
export default function SupervisorSyncDiagnosticsPanel({ isOpen, onClose, diagnostics, statusLabel, lastSync }) {
    if (!isOpen) return null;

    const lastEcho = diagnostics?.lastEcho || null;
    const metricCards = [
        { label: 'Estado', value: statusLabel || '—', testId: 'sync-diag-status' },
        { label: 'Último eco', value: formatWhen(lastEcho?.receivedAt), testId: 'sync-diag-last-echo' },
        { label: 'Watermark', value: formatWhen(lastEcho?.updatedAt), testId: 'sync-diag-watermark' },
        { label: 'Eventos 413', value: String(diagnostics?.oversizeEvents ?? 0), testId: 'sync-diag-oversize-events' },
        { label: 'Pulls de respaldo', value: String(diagnostics?.oversizePulls ?? 0), testId: 'sync-diag-oversize-pulls' },
        { label: 'Último pull 413', value: formatWhen(diagnostics?.lastOversizePullAt), testId: 'sync-diag-last-oversize-pull' },
        { label: 'Bytes del pull', value: formatBytes(diagnostics?.lastPull?.bytes), testId: 'sync-diag-last-pull-bytes' },
    ];

    return (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="supervisor-sync-diagnostics-title">
            <div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-t-[2rem] bg-white shadow-2xl dark:bg-slate-900 sm:rounded-[2rem]">
                <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white/95 p-5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 sm:p-6">
                    <div className="flex items-start gap-3">
                        <div className="rounded-2xl bg-blue-50 p-3 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300">
                            <Radio size={21} />
                        </div>
                        <div>
                            <h2 id="supervisor-sync-diagnostics-title" className="text-lg font-black text-slate-900 dark:text-white">Diagnóstico de sincronización</h2>
                            <p className="mt-1 text-xs font-medium text-slate-500">Último eco, watermark, pulls de respaldo 413 y bytes descargados por pull.</p>
                        </div>
                    </div>
                    <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white">
                        <X size={20} />
                    </button>
                </div>

                <div className="space-y-5 p-5 sm:p-6">
                    <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                        {metricCards.map(card => (
                            <div key={card.label} data-testid={card.testId} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-center dark:border-slate-800 dark:bg-slate-950/60">
                                <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">{card.label}</p>
                                <p className="mt-1 text-sm font-black tabular-nums text-slate-800 dark:text-white">{card.value}</p>
                            </div>
                        ))}
                    </div>

                    {lastEcho ? (
                        <div data-testid="sync-diag-echo-detail" className="rounded-2xl border border-slate-200 p-3 dark:border-slate-800">
                            <div className="flex flex-wrap items-center gap-2">
                                <code className="text-[11px] font-bold text-slate-500 dark:text-slate-300">{lastEcho.docId || 'documento desconocido'}</code>
                                <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-black uppercase text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">{echoSourceLabel(lastEcho.source)}</span>
                                <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${lastEcho.applied ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300' : 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300'}`}>
                                    {lastEcho.applied ? 'Aplicado' : 'Descartado'}
                                </span>
                            </div>
                            <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-2 text-[10px] dark:bg-slate-950">
                                <span className="text-slate-500">Recibido<strong className="ml-1 text-slate-800 dark:text-slate-200">{formatWhen(lastEcho.receivedAt)}</strong></span>
                                <span className="text-slate-500">Watermark<strong className="ml-1 text-slate-800 dark:text-slate-200">{lastEcho.updatedAt || '—'}</strong></span>
                            </div>
                            {lastEcho.error && (
                                <p className="mt-2 text-[10px] font-bold text-rose-600">{lastEcho.error}</p>
                            )}
                        </div>
                    ) : (
                        <div data-testid="sync-diag-empty" className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-xs font-bold text-slate-400 dark:border-slate-700">
                            <Clock size={24} className="mx-auto mb-2 opacity-50" />
                            Sin ecos recibidos todavía. Aquí aparecerá cada documento aplicado con su watermark.
                        </div>
                    )}

                    {diagnostics?.lastPull && (
                        <p data-testid="sync-diag-last-pull-detail" className="text-[10px] font-bold text-slate-400">
                            Último pull: {formatWhen(diagnostics.lastPull.at)} · {diagnostics.lastPull.docs} docs · {diagnostics.lastPull.full ? 'completo' : 'incremental'} ({diagnostics.lastPull.source}).
                        </p>
                    )}

                    {lastSync && (
                        <p className="text-[10px] font-bold text-slate-400">
                            Última sincronización confirmada: {lastSync.toLocaleDateString()} {lastSync.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}.
                        </p>
                    )}
                </div>
            </div>
        </div>
    );
}
