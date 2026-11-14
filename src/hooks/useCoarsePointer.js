import { useEffect, useState } from 'react';

/**
 * useCoarsePointer — ¿Se usa esta pantalla con el dedo? (CASO-056 fase 3)
 *
 * «Puntero grueso» (`any-pointer: coarse`) es como el navegador llama a un
 * dedo: impreciso comparado con la punta fina del mouse. Una laptop táctil
 * responde «sí» aunque también tenga touchpad.
 *
 * Se puede forzar con `localStorage.pda_touch_mode`:
 *   'auto' (de fábrica) · 'on' (siempre táctil) · 'off' (nunca)
 * Sirve si Windows o el navegador no informan bien la pantalla táctil.
 */
export const TOUCH_MODE_KEY = 'pda_touch_mode';
export const TOUCH_MODE_EVENT = 'pda-touch-mode-change';
const COARSE_QUERY = '(any-pointer: coarse)';

export function getTouchMode() {
    try {
        const v = globalThis.localStorage?.getItem(TOUCH_MODE_KEY);
        return v === 'on' || v === 'off' ? v : 'auto';
    } catch {
        return 'auto';
    }
}

/** Guarda el modo ('auto' | 'on' | 'off') y avisa a la pantalla abierta. Ajustes → Ventas. */
export function setTouchMode(mode) {
    const next = mode === 'on' || mode === 'off' ? mode : 'auto';
    try {
        if (next === 'auto') globalThis.localStorage?.removeItem(TOUCH_MODE_KEY);
        else globalThis.localStorage?.setItem(TOUCH_MODE_KEY, next);
    } catch { /* sin almacenamiento: queda en automático */ }
    globalThis.dispatchEvent?.(new Event(TOUCH_MODE_EVENT));
    return next;
}

/** Modo elegido en Ajustes, al día si cambia en otra pestaña o en otro lugar. */
export function useTouchModeSetting() {
    const [mode, setMode] = useState(() => getTouchMode());
    useEffect(() => {
        const refresh = () => setMode(getTouchMode());
        globalThis.addEventListener?.(TOUCH_MODE_EVENT, refresh);
        globalThis.addEventListener?.('storage', refresh);
        return () => {
            globalThis.removeEventListener?.(TOUCH_MODE_EVENT, refresh);
            globalThis.removeEventListener?.('storage', refresh);
        };
    }, []);
    return mode;
}

/** ¿Este equipo informa pantalla táctil? (para explicar qué hará «Automático») */
export function detectsTouchScreen() {
    return globalThis.matchMedia?.(COARSE_QUERY)?.matches === true;
}

export function resolveTouch(mode, coarse) {
    if (mode === 'on') return true;
    if (mode === 'off') return false;
    return coarse === true;
}

export function useCoarsePointer() {
    const [mode, setMode] = useState(() => getTouchMode());
    const [coarse, setCoarse] = useState(() => globalThis.matchMedia?.(COARSE_QUERY)?.matches === true);

    useEffect(() => {
        const refresh = () => setMode(getTouchMode());
        globalThis.addEventListener?.(TOUCH_MODE_EVENT, refresh);
        globalThis.addEventListener?.('storage', refresh);
        const mq = globalThis.matchMedia?.(COARSE_QUERY);
        const onMq = () => setCoarse(mq.matches === true);
        mq?.addEventListener?.('change', onMq);
        return () => {
            globalThis.removeEventListener?.(TOUCH_MODE_EVENT, refresh);
            globalThis.removeEventListener?.('storage', refresh);
            mq?.removeEventListener?.('change', onMq);
        };
    }, []);

    return resolveTouch(mode, coarse);
}
