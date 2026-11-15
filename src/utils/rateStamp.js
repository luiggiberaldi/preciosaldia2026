// Hora de la última actualización de la tasa para el cuadro «TASA BCV» de Vender.
// «hoy 9:00 a. m.» / «ayer 4:30 p. m.» / «12/11 9:00 a. m.». Fecha inválida o vacía: ''.
export function formatRateStamp(value, now = new Date()) {
    const d = value ? new Date(value) : null;
    if (!d || Number.isNaN(d.getTime())) return '';
    const hora = d.toLocaleTimeString('es-VE', { hour: 'numeric', minute: '2-digit' });
    // Días de calendario exactos (UTC evita el desfase por cambio de hora).
    const diff = (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) - Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) / 86400000;
    if (diff === 0) return `hoy ${hora}`;
    if (diff === 1) return `ayer ${hora}`;
    return `${d.toLocaleDateString('es-VE', { day: '2-digit', month: '2-digit' })} ${hora}`;
}
