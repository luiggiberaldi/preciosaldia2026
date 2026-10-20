import React, { useCallback, useEffect, useState } from 'react';
import { Activity, Clock, Cloud, Loader2, RefreshCw, Terminal } from 'lucide-react';
import { SectionCard } from '../SettingsShared';
import {
    describeClockSkew,
    measureClockSkew,
    readLastSyncInfo,
} from '../../services/systemHealthService';
import {
    commandTypeLabel,
    readLastCommandOutcome,
    statusChipLabel,
} from '../../services/supervisorCommandDiagnostics';

const LEVEL_BADGE = {
    green: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300',
    yellow: 'bg-amber-50 text-amber-700 dark:bg-amber-950/30 dark:text-amber-300',
    red: 'bg-rose-50 text-rose-700 dark:bg-rose-950/30 dark:text-rose-300',
    unknown: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300',
};

const LEVEL_DOT = {
    green: 'bg-emerald-500',
    yellow: 'bg-amber-500',
    red: 'bg-rose-500',
    unknown: 'bg-slate-400',
};

/**
 * Sección "Salud del sistema" de Ajustes (Fase 3): desfase de reloj local vs
 * servidor con semáforo (verde <30 s, ámbar 30 s–2 min, rojo >2 min), último
 * comando del Supervisor con su resultado real (Fase 2) y última sincronización.
 * Todo degrada a "Sin datos" sin romperse; nada de esto interrumpe la app.
 */
export default function SystemHealthPanel({ triggerHaptic, measureImpl = measureClockSkew }) {
    const [clock, setClock] = useState({ level: 'unknown', text: 'Sin datos' });
    const [lastCommand, setLastCommand] = useState(null);
    const [isChecking, setIsChecking] = useState(false);

    const check = useCallback(async () => {
        setIsChecking(true);
        try {
            // Una medida que rechaza (sin red, sesión ausente…) degrada a
            // "Sin datos": jamás un rechazo sin manejar ni una pantalla rota.
            const [result, last] = await Promise.all([
                Promise.resolve().then(() => measureImpl()).catch(() => null),
                readLastCommandOutcome().catch(() => null),
            ]);
            if (result?.ok && Number.isFinite(Number(result.skewMs))) {
                setClock(describeClockSkew(result.skewMs));
            } else {
                setClock({ level: 'unknown', text: 'Sin datos' });
            }
            setLastCommand(last || null);
        } finally {
            setIsChecking(false);
        }
    }, [measureImpl]);

    useEffect(() => {
        check();
    }, [check]);

    // Lectura síncrona y fresca en cada render: la fila no se queda congelada.
    const syncInfo = readLastSyncInfo();
    const syncText = syncInfo.lastSyncAt
        ? new Date(syncInfo.lastSyncAt).toLocaleString()
        : (syncInfo.confirmedPushKeys
            ? `Sin fecha registrada (${syncInfo.confirmedPushKeys} colecciones con push confirmado)`
            : 'Sin datos');

    return (
        <SectionCard icon={Activity} title="Salud del sistema" subtitle="Reloj del equipo, sincronización y último comando" iconColor="text-teal-500">
            <div className="space-y-3">
                {/* Desfase de reloj local vs servidor (semáforo) */}
                <div className="flex items-start justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                    <div className="flex min-w-0 items-start gap-2">
                        <Clock size={15} className="mt-0.5 shrink-0 text-slate-400" />
                        <div className="min-w-0">
                            <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Reloj del equipo</p>
                            <p data-testid="clock-skew-state" data-level={clock.level} className="text-xs font-bold text-slate-700 dark:text-slate-200">
                                <span className={`mr-1.5 inline-block h-2 w-2 rounded-full ${LEVEL_DOT[clock.level] || LEVEL_DOT.unknown}`} />
                                {clock.text}
                            </p>
                        </div>
                    </div>
                    <button
                        type="button"
                        onClick={() => { triggerHaptic?.(); check(); }}
                        disabled={isChecking}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-[11px] font-black text-slate-600 transition hover:bg-slate-100 hover:text-slate-800 active:scale-95 disabled:opacity-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800"
                    >
                        {isChecking ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
                        Revisar ahora
                    </button>
                </div>

                {/* Último comando del Supervisor con su resultado real (Fase 2) */}
                <div className="flex items-start gap-2 rounded-2xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                    <Terminal size={15} className="mt-0.5 shrink-0 text-slate-400" />
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Último comando enviado</p>
                        <p className="break-words text-xs font-bold text-slate-700 dark:text-slate-200">
                            {lastCommand
                                ? `${commandTypeLabel(lastCommand.type)} → ${statusChipLabel(lastCommand.status)}${lastCommand.error ? ` (${lastCommand.error})` : ''}`
                                : 'Sin datos'}
                        </p>
                    </div>
                </div>

                {/* Última sincronización exitosa */}
                <div className="flex items-start gap-2 rounded-2xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-950/40">
                    <Cloud size={15} className="mt-0.5 shrink-0 text-slate-400" />
                    <div className="min-w-0">
                        <p className="text-[10px] font-black uppercase tracking-wider text-slate-400">Última sincronización</p>
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-200">{syncText}</p>
                    </div>
                </div>
            </div>
        </SectionCard>
    );
}
