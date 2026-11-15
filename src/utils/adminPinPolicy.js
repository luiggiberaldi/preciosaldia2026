// Política del PIN del Administrador (auditoría de Ajustes, 13-nov-2026).
// Con la pantalla de inicio activa, el Administrador SIEMPRE entra con PIN: si no, cualquiera
// que toque su tarjeta entra como dueño. Esta regla la usan Ajustes › Usuarios, el almacén de
// usuarios (useAuthStore) y los comandos de usuarios del Supervisor.
import { validatePin } from './securityConstants';

/** PIN de fábrica con el que nacen los usuarios (useAuthStore). No sirve para proteger al dueño. */
export const FACTORY_PIN = '000000';

/** Administradores que hoy entran sin pedir PIN. */
export function adminsWithoutPin(usuarios) {
    return (Array.isArray(usuarios) ? usuarios : []).filter(u => u?.rol === 'ADMIN' && u.requirePin === false);
}

/** ¿Se puede marcar a este usuario como «entra sin PIN»? No, si es Administrador y la pantalla de inicio está activa. */
export function canBypassPin(user, requireLogin) {
    return !(user?.rol === 'ADMIN' && requireLogin);
}

/** Valida el PIN nuevo del Administrador. Devuelve el texto del error o null si está bien. */
export function validateNewAdminPin(pin, confirm) {
    const p = String(pin ?? '');
    const base = validatePin(p);
    if (base) return base;
    if (p === FACTORY_PIN) return 'Elige un PIN distinto de 000000 (es el de fábrica)';
    if (confirm !== undefined && p !== String(confirm ?? '')) return 'Los PIN no coinciden';
    return null;
}
