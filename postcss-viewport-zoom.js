// postcss-viewport-zoom.js
//
// La «Escala de interfaz» (Ajustes → Sistema) aplica `zoom` al <html>. Con
// zoom, las unidades de viewport (vh/dvh/svh/lvh, vw/…) también se escalan:
// a 85 % la app ocupaba 85 % de la ventana (franja en blanco abajo) y a 115 %
// se salía (COBRAR y pies de modal cortados). Este plugin reescribe cada
// valor `N<unidad de viewport>` del CSS generado a
// `calc(N<unidad> / var(--ui-zoom, 1))`; `applyUiScale` fija --ui-zoom junto
// con el zoom. Sin escala (100 %) el resultado es idéntico al original.

const VIEWPORT_UNIT = /(-?\d*\.?\d+)(dvh|svh|lvh|vh|dvw|svw|lvw|vw)\b/g;

export function compensateViewportUnits(value) {
    if (typeof value !== 'string' || !/\d(?:d|s|l)?v[hw]\b/.test(value)) return value;
    // Idempotente: PostCSS vuelve a visitar la declaración que cambió; sin
    // esta guarda la reescribiría sin fin (cuelga el build).
    if (value.includes('var(--ui-zoom')) return value;
    return value.replace(VIEWPORT_UNIT, (_, n, unit) => `calc(${n}${unit} / var(--ui-zoom, 1))`);
}

const plugin = () => ({
    postcssPlugin: 'viewport-zoom',
    Declaration(decl) {
        // Las propias variables y las @media no se tocan (Declaration no ve @media).
        if (decl.prop.startsWith('--')) return;
        const next = compensateViewportUnits(decl.value);
        if (next !== decl.value) decl.value = next;
    },
});
plugin.postcss = true;

export default plugin;
