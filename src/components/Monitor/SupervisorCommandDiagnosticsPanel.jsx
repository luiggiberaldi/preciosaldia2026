import React, { useCallback, useEffect, useState } from 'react';
import {
    Activity,
    AlertTriangle,
    CheckCircle2,
    Clock,
    Loader2,
    RefreshCw,
    Trash2,
    X,
} from 'lucide-react';
import {
    commandTypeLabel,
    formatAckMs,
    loadCommandDiagnostics,
    clearCommandDiagnostics,
    readLastCommandOutcome,
    shortCommandId,
    statusChipLabel,
} from '../../services/supervisorCommandDiagnostics';

// Chip de estado del comando (misma paleta que las franjas de la vista).
const STATUS_STYLES = {
    applied: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
    applied_with_warnings: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
    rejected: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300',
    cancelled: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300',
    expired: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300',
    failed: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300',
    ack_failed: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300',
};

function statusChipClass(status) {
    return STATUS_STYLES[status] || 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300';
}

function formatWhen(iso) {
    if (!iso) return '—';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

/**
 * Panel de diagnóstico de comandos del supervisor: por commandId muestra el
 * estado del comando, la latencia de su ACK (y sus hitos) y las reconciliaciones
 * que lo resolvieron, más estadísticas globales (p50/p95 del ACK).
 */
export default function SupervisorCommandDiagnosticsPanel({ isOpen, onClose }) {
    const [diagnostics, setDiagnostics] = useState({ rows: [], summary: null });
    const [lastCommand, setLastCommand] = useState(null);
    const [isLoading, setIsLoading] = useState(true);

    const reload = useCallback(async () => {
        setIsLoading(true);
        try {
            const [diag, last] = await Promise.all([loadCommandDiagnostics(), readLastCommandOutcome()]);
            setDiagnostics(diag);
            setLastCommand(last);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        if (!isOpen) return;
        reload();
    }, [isOpen, reload]);

    if (!isOpen) return null;

    const { rows, summary } = diagnostics;
    const metricCards = summary ? [
        { label: 'Órdenes', value: String(summary.total) },
        { label: 'ACK p50', value: formatAckMs(summary.ackP50Ms) },
        { label: 'ACK p95', value: formatAckMs(summary.ackP95Ms) },
        { label: 'ACK peor', value: formatAckMs(summary.ackMaxMs) },
        { label: 'Reconciliadas', value: String(summary.reconciled) },
        { label: 'ACK tras publicar', value: String(summary.confirmAfterPublish) },
    ] : [];

    return (
        <div className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/60 p-0 backdrop-blur-sm sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-labelledby="supervisor-command-diagnostics-title">
            <div className="max-h-[94vh] w-full max-w-3xl overflow-y-auto rounded-t-[2rem] bg-white shadow-2xl dark:bg-slate-900 sm:rounded-[2rem]">
                <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white/95 p-5 backdrop-blur dark:border-slate-800 dark:bg-slate-900/95 sm:p-6">
                    <div className="flex items-start gap-3">
                        <div className="rounded-2xl bg-blue-50 p-3 text-blue-600 dark:bg-blue-950/30 dark:text-blue-300">
                            <Activity size={21} />
                        </div>
                        <div>
                            <h2 id="supervisor-command-diagnostics-title" className="text-lg font-black text-slate-900 dark:text-white">Diagnóstico de comandos</h2>
                            <p className="mt-1 text-xs font-medium text-slate-500">Estado, latencia del ACK y reconciliaciones por commandId.</p>
                        </div>
                    </div>
                    <div className="flex items-center gap-1.5">
                        <button
                            type="button"
                            aria-label="Actualizar diagnóstico"
                            title="Actualizar diagnóstico"
                            onClick={reload}
                            disabled={isLoading}
                            className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-blue-600 disabled:opacity-50 dark:hover:bg-slate-800 dark:hover:text-blue-400"
                        >
                            <RefreshCw size={18} className={isLoading ? 'animate-spin' : ''} />
                        </button>
                        <button
                            type="button"
                            aria-label="Limpiar diagnóstico"
                            title="Limpiar diagnóstico"
                            onClick={async () => {
                                await clearCommandDiagnostics();
                                await reload();
                            }}
                            className="rounded-xl p-2 text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/30"
                        >
                            <Trash2 size={18} />
                        </button>
                        <button type="button" aria-label="Cerrar" onClick={onClose} className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-white">
                            <X size={20} />
                        </button>
                    </div>
                </div>

                <div className="space-y-5 p-5 sm:p-6">
                    {/* Fase 2: "último comando enviado" — el desenlace del último
                        comando con su error real, aunque el panel se cierre y abra. */}
                    {lastCommand && (
                        <div data-testid="diagnostics-last-command" className="flex items-start gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-xs font-bold text-slate-600 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-300">
                            <Clock size={15} className="mt-0.5 shrink-0 opacity-60" />
                            <span>Último comando enviado: {commandTypeLabel(lastCommand.type)} → {statusChipLabel(lastCommand.status)}{lastCommand.error ? ` (${lastCommand.error})` : ''}</span>
                        </div>
                    )}
                    {isLoading ? (
                        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 p-8 text-xs font-bold text-slate-400 dark:border-slate-800">
                            <Loader2 size={16} className="animate-spin" /> Cargando diagnóstico…
                        </div>
                    ) : rows.length === 0 ? (
                        <div data-testid="diagnostics-empty" className="rounded-2xl border border-dashed border-slate-300 p-8 text-center text-xs font-bold text-slate-400 dark:border-slate-700">
                            <Clock size={24} className="mx-auto mb-2 opacity-50" />
                            Sin órdenes registradas todavía. Aparecerán aquí al enviar un lote, ajustar stock o reconciliar comandos.
                        </div>
                    ) : (
                        <>
                            <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                                {metricCards.map(card => (
                                    <div key={card.label} className="rounded-2xl border border-slate-200 bg-slate-50 p-3 text-center dark:border-slate-800 dark:bg-slate-950/60">
                                        <p className="text-[9px] font-black uppercase tracking-wider text-slate-400">{card.label}</p>
                                        <p className="mt-1 text-sm font-black tabular-nums text-slate-800 dark:text-white">{card.value}</p>
                                    </div>
                                ))}
                            </div>

                            <div className="space-y-2">
                                {rows.map(row => (
                                    <div key={row.commandId} data-testid={`diagnostics-row-${row.commandId}`} className="rounded-2xl border border-slate-200 p-3 dark:border-slate-800">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <code className="text-[11px] font-bold text-slate-500 dark:text-slate-300">{shortCommandId(row.commandId)}</code>
                                            <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">{commandTypeLabel(row.type)}</span>
                                            <span className={`rounded-full px-2 py-0.5 text-[9px] font-black uppercase ${statusChipClass(row.status)}`}>{statusChipLabel(row.status)}</span>
                                            {row.reconcileCount > 0 && (
                                                <span className="flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[9px] font-black text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                                                    <CheckCircle2 size={10} /> {row.reconcileCount} reconciliación{row.reconcileCount === 1 ? '' : 'es'}
                                                </span>
                                            )}
                                        </div>
                                        <div className="mt-2 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-2 text-[10px] dark:bg-slate-950 sm:grid-cols-4">
                                            <span className="text-slate-500">Latencia ACK<strong className="ml-1 text-slate-800 dark:text-slate-200">{formatAckMs(row.metrics.ackLatencyMs)}</strong></span>
                                            <span className="text-slate-500">Durable<strong className="ml-1 text-slate-800 dark:text-slate-200">{formatAckMs(row.metrics.localDurableMs)}</strong></span>
                                            <span className="text-slate-500">Publicación<strong className="ml-1 text-slate-800 dark:text-slate-200">{formatAckMs(row.metrics.publishLatencyMs)}</strong></span>
                                            <span className="text-slate-500">ACK vs nube<strong className={`ml-1 ${Number(row.metrics.ackLeadMs) < 0 ? 'text-rose-600' : 'text-emerald-600'}`}>{formatAckMs(row.metrics.ackLeadMs)}</strong></span>
                                        </div>
                                        {row.error && (
                                            <p className="mt-2 flex items-start gap-1.5 text-[10px] font-bold text-rose-600">
                                                <AlertTriangle size={11} className="mt-0.5 shrink-0" /> {row.error}
                                            </p>
                                        )}
                                        {row.reconciliations.length > 0 && (
                                            <div className="mt-2 space-y-1">
                                                {row.reconciliations.map((reconciliation, index) => (
                                                    <p key={`${row.commandId}-${index}`} data-testid="diagnostics-reconciliation" className="text-[10px] font-bold text-slate-500 dark:text-slate-300">
                                                        <span className="text-slate-400">{formatWhen(reconciliation.at)}</span>
                                                        {' · '}{reconciliation.source === 'lote' ? 'Lote' : 'Fila'}{reconciliation.via === 'manual' ? ' · manual' : ' · segundo plano'}{' · '}
                                                        <span className={reconciliation.outcome === 'applied' ? 'text-emerald-600' : 'text-rose-600'}>
                                                            {reconciliation.outcome === 'applied' ? 'resuelto aplicado' : 'resuelto sin aplicar'}
                                                        </span>
                                                        {reconciliation.detail ? ` — ${reconciliation.detail}` : ''}
                                                    </p>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
