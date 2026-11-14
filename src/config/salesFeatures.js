// Funciones opcionales del punto de venta que el dueño ajusta en Ajustes → Ventas.
// Copiado de Precios al Día Farmacia (solo la parte de la cesta compacta).

import { useEffect, useState } from 'react';

export const SALES_FEATURES_EVENT = 'sales-features-changed';

// ── Cesta compacta ───────────────────────────────────────────────────────────
// 'auto' (de fábrica): compacta solo en pantallas bajas (laptops chicas, ≤ 800 px de alto).
// 'always': siempre compacta. 'never': siempre el diseño amplio.
// En teléfono y tablet (menos de 1024 px de ancho) la cesta es SIEMPRE compacta, sin importar el modo
// (pedido del dueño de Bodega); el ajuste solo cambia la cesta de PC.
export const CART_COMPACT_KEY = 'cart_compact_mode_v1';
export const CART_COMPACT_MODES = Object.freeze(['auto', 'always', 'never']);
export const SHORT_SCREEN_QUERY = '(max-height: 800px)';
export const MOBILE_SCREEN_QUERY = '(max-width: 1023px)';

export function getCartCompactMode() {
    try {
        // eslint-disable-next-line no-restricted-properties -- preferencia local de esta caja, igual que en Farmacia
        const v = localStorage.getItem(CART_COMPACT_KEY);
        return CART_COMPACT_MODES.includes(v) ? v : 'auto';
    } catch {
        return 'auto';
    }
}

export function setCartCompactMode(mode) {
    const next = CART_COMPACT_MODES.includes(mode) ? mode : 'auto';
    try {
        // eslint-disable-next-line no-restricted-properties -- preferencia local de esta caja, igual que en Farmacia
        localStorage.setItem(CART_COMPACT_KEY, next);
        globalThis.dispatchEvent?.(new Event(SALES_FEATURES_EVENT));
    } catch (err) {
        console.error('[Ventas] No se pudo guardar el modo de la cesta:', err);
    }
    return next;
}

/** ¿La cesta debe dibujarse compacta? Reactivo al ajuste y al alto de la pantalla. */
export function resolveCartCompact(mode, isShortScreen, isMobileScreen = false) {
    if (isMobileScreen === true) return true;
    return mode === 'always' || (mode === 'auto' && isShortScreen === true);
}

export function useCartCompact() {
    const [mode, setMode] = useState(() => getCartCompactMode());
    const [isShort, setIsShort] = useState(() => globalThis.matchMedia?.(SHORT_SCREEN_QUERY)?.matches === true);
    const [isMobile, setIsMobile] = useState(() => globalThis.matchMedia?.(MOBILE_SCREEN_QUERY)?.matches === true);
    useEffect(() => {
        const refresh = () => setMode(getCartCompactMode());
        globalThis.addEventListener?.(SALES_FEATURES_EVENT, refresh);
        globalThis.addEventListener?.('storage', refresh);
        const mq = globalThis.matchMedia?.(SHORT_SCREEN_QUERY);
        const onMq = () => setIsShort(mq.matches === true);
        mq?.addEventListener?.('change', onMq);
        const mqMobile = globalThis.matchMedia?.(MOBILE_SCREEN_QUERY);
        const onMobile = () => setIsMobile(mqMobile.matches === true);
        mqMobile?.addEventListener?.('change', onMobile);
        return () => {
            globalThis.removeEventListener?.(SALES_FEATURES_EVENT, refresh);
            globalThis.removeEventListener?.('storage', refresh);
            mq?.removeEventListener?.('change', onMq);
            mqMobile?.removeEventListener?.('change', onMobile);
        };
    }, []);
    return { mode, compact: resolveCartCompact(mode, isShort, isMobile) };
}
