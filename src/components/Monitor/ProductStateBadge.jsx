import React from 'react';

// Etiqueta de estado por producto (propuesta 4): "EN COLA" · "ESPERANDO A LA
// CAJA" · "APLICADO". Solo pinta: el estado lo deriva `productQueueState`.

const TONE_CLASSES = {
    info: 'bg-sky-100 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-900',
    warning: 'bg-amber-100 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900',
    success: 'bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-900',
};

export default function ProductStateBadge({ state }) {
    if (!state?.key) return null;
    return (
        <span
            data-product-state={state.key}
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[9px] font-black uppercase tracking-wide ${TONE_CLASSES[state.tone] || TONE_CLASSES.info}`}
        >
            <span className={`h-1.5 w-1.5 rounded-full ${state.tone === 'warning' ? 'bg-amber-500 animate-pulse' : state.tone === 'success' ? 'bg-emerald-500' : 'bg-sky-500'}`} />
            {state.label}
        </span>
    );
}
