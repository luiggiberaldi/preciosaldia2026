// Portero de pantallas (auditoría del Cajero 2026-11-13, ERR-118).
// Una sola regla para todas las entradas: barra, paleta de comandos (Ctrl+K / Esc),
// avisos, enlaces y cualquier `setActiveTab` futuro. El Cajero nunca abre Reportes ni Ajustes.

/** Pantallas que solo ve el Administrador (con la pantalla de inicio encendida). */
export const ADMIN_ONLY_TABS = new Set(['reportes', 'ajustes']);

/** ¿Puede este rol abrir la pantalla? `isCajero` ya incluye «pantalla de inicio encendida». */
export function canOpenTab(tab, isCajero) {
    return !(isCajero && ADMIN_ONLY_TABS.has(tab));
}

/** Pantalla a la que se va de verdad: si el rol no la tiene, se queda en Vender. */
export function safeTab(tab, isCajero) {
    return canOpenTab(tab, isCajero) ? tab : 'ventas';
}
