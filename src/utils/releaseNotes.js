// Lógica pura de las novedades por versión (sin React, fácil de probar).

/** Convierte '2.0.10' en [2,0,10]. Valores raros cuentan como 0. */
function parts(v) {
  return String(v || '0').split('-')[0].split('.').map((n) => parseInt(n, 10) || 0);
}

/** -1 si a<b, 0 si iguales, 1 si a>b. */
export function compareVersions(a, b) {
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Notas con versión mayor que `desde` y menor o igual que `hasta`
 * (las que el usuario aún no ha visto). Más nueva primero.
 * Si `desde` falta, no hay nada "nuevo" que mostrar.
 */
export function notasPendientes(notas, desde, hasta) {
  if (!Array.isArray(notas) || !desde) return [];
  return notas
    .filter((n) => n && n.version && Array.isArray(n.mejoras) && n.mejoras.length > 0)
    .filter((n) => compareVersions(n.version, desde) > 0 && (!hasta || compareVersions(n.version, hasta) <= 0))
    .sort((a, b) => compareVersions(b.version, a.version));
}

/** '2026-10-29' → '29 de octubre de 2026' (sin depender de zona horaria). */
export function formatearFecha(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return '';
  const meses = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  return `${parseInt(m[3], 10)} de ${meses[parseInt(m[2], 10) - 1]} de ${m[1]}`;
}

const LAST_SEEN_KEY = 'pda_last_seen_version';

export function leerUltimaVersionVista() {
  try { return localStorage.getItem(LAST_SEEN_KEY); } catch { return null; }
}

export function guardarUltimaVersionVista(v) {
  try { localStorage.setItem(LAST_SEEN_KEY, v); } catch { /* sin almacenamiento: se omite */ }
}
