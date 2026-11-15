// Regla única para decidir qué pantalla de cobro se muestra.
// 'basic' = Modo Móvil (1 columna) · 'pos' = Modo PC (2 columnas).
//
// - 'basic' elegido a mano → siempre Móvil.
// - Interruptor de soporte `checkout_shell_v2` encendido → siempre Móvil (palanca de rollback).
// - 'pos' elegido a mano → siempre PC.
// - 'auto' (o vacío) → PC solo si la pantalla mide 1024 px o más y no es teléfono/tablet.

export const POS_MIN_WIDTH = 1024;
export const MOBILE_UA = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i;

export function resolveCheckoutMode(mode, { isWide = false, userAgent = '', shellV2 = false } = {}) {
    if (mode === 'basic') return 'basic';
    if (shellV2) return 'basic';
    if (mode === 'pos') return 'pos';
    return isWide && !MOBILE_UA.test(userAgent) ? 'pos' : 'basic';
}

export const isWideViewport = () =>
    typeof window !== 'undefined' && window.innerWidth >= POS_MIN_WIDTH;
