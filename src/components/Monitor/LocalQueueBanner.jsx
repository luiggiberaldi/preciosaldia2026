import React, { useState } from 'react';
import { Ban, CloudUpload, Loader2, Trash2 } from 'lucide-react';
import ConfirmModal from '../ConfirmModal';

// Aviso abajo del modelo Donde Juancho (propuesta 5): "N cambios en cola —
// SUBIR AL SISTEMA / DESCARTAR". La cola local son cambios guardados en el
// navegador que aún no llegaron a la nube; ANULAR TODOS (propuesta 6) ataca en
// cambio a lo que YA está esperando a la caja y esta aún no tomó.

export default function LocalQueueBanner({
    queueCount = 0,
    pendingCount = 0,
    isOnline = true,
    uploading = false,
    onUpload,
    onDiscard,
    onCancelAll = null,
}) {
    const [confirmDiscard, setConfirmDiscard] = useState(false);
    const [confirmCancelAll, setConfirmCancelAll] = useState(false);

    if (queueCount <= 0 && pendingCount <= 0) return null;

    return (
        <div data-testid="local-queue-banner" className="pointer-events-none fixed inset-x-0 bottom-0 z-[90] flex justify-center px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <div className="pointer-events-auto w-full max-w-2xl rounded-3xl border border-slate-200/80 bg-white/95 p-3 shadow-2xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95 sm:p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                        {queueCount > 0 && (
                            <p className="text-xs font-black text-slate-800 dark:text-white">
                                <span data-testid="queue-count">{queueCount}</span> {queueCount === 1 ? 'cambio en cola' : 'cambios en cola'}
                                <span className="font-bold text-slate-500"> — Aún no se han enviado a la caja.</span>
                            </p>
                        )}
                        {pendingCount > 0 && (
                            <p className="mt-0.5 text-[11px] font-bold text-slate-500">
                                {pendingCount} {pendingCount === 1 ? 'esperando' : 'esperando'} a la caja.
                            </p>
                        )}
                        {!isOnline && queueCount > 0 && (
                            <p className="mt-0.5 text-[11px] font-bold text-slate-400">Se subirán solos cuando vuelva la conexión.</p>
                        )}
                    </div>

                    <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {queueCount > 0 && (
                            <>
                                <button
                                    type="button"
                                    onClick={onUpload}
                                    disabled={uploading}
                                    className="inline-flex min-h-11 items-center gap-1.5 rounded-2xl bg-primary-600 px-4 text-xs font-black text-white shadow-md transition hover:bg-primary-700 active:scale-95 disabled:opacity-50"
                                >
                                    {uploading ? <Loader2 size={15} className="animate-spin" /> : <CloudUpload size={15} />} SUBIR AL SISTEMA
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setConfirmDiscard(true)}
                                    className="inline-flex min-h-11 items-center gap-1.5 rounded-2xl border border-slate-200 bg-white px-4 text-xs font-black text-slate-600 transition hover:border-rose-300 hover:text-rose-600 active:scale-95 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                                >
                                    <Trash2 size={15} /> DESCARTAR
                                </button>
                            </>
                        )}
                        {pendingCount > 0 && onCancelAll && (
                            <button
                                type="button"
                                onClick={() => setConfirmCancelAll(true)}
                                className="inline-flex min-h-11 items-center gap-1.5 rounded-2xl border border-rose-200 bg-rose-50 px-4 text-xs font-black text-rose-600 transition hover:bg-rose-100 active:scale-95 dark:border-rose-900/50 dark:bg-rose-950/30 dark:text-rose-300"
                            >
                                <Ban size={15} /> ANULAR TODOS
                            </button>
                        )}
                    </div>
                </div>
            </div>

            <ConfirmModal
                isOpen={confirmDiscard}
                onClose={() => setConfirmDiscard(false)}
                onConfirm={() => onDiscard?.()}
                title="¿Descartar los cambios en cola?"
                message={`Se descartarán ${queueCount} ${queueCount === 1 ? 'cambio' : 'cambios'} que nunca llegaron a la caja. Esta acción no se puede deshacer.`}
                confirmText="Descartar cambios"
                cancelText="Seguir en cola"
            />

            <ConfirmModal
                isOpen={confirmCancelAll}
                onClose={() => setConfirmCancelAll(false)}
                onConfirm={() => onCancelAll?.()}
                title="¿Anular todos los cambios?"
                message={`Se intentarán anular los ${pendingCount} ${pendingCount === 1 ? 'cambio' : 'cambios'} que la caja aún no ha tomado. Lo que la caja ya aplicó no se puede anular.`}
                confirmText="Anular todos"
                cancelText="No anular"
                variant="warning"
            />
        </div>
    );
}
