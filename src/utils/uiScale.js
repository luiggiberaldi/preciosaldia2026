// Escala de interfaz (Ajustes → Sistema). El `zoom` del <html> también escala
// las unidades de viewport; --ui-zoom permite compensarlas en el CSS
// (postcss-viewport-zoom.js), así la app llena la ventana a cualquier escala.
export const UI_SCALE_MIN = 60;
export const UI_SCALE_MAX = 140;

export function applyUiScale(scale, root = document.documentElement) {
    const value = Number(scale);
    const valid = Number.isFinite(value) && value >= UI_SCALE_MIN && value <= UI_SCALE_MAX;
    const percent = valid ? value : 100;
    root.style.zoom = percent === 100 ? '' : `${percent}%`;
    if (percent === 100) root.style.removeProperty('--ui-zoom');
    else root.style.setProperty('--ui-zoom', String(percent / 100));
    return percent;
}
