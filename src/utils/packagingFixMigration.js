// FIX-EMPAQUE-002: corrección AUTOMÁTICA del empaque del catálogo.
//
// Se ejecuta sola al abrir la app (una sola vez), sin que el usuario toque nada:
//   1) Backup automático del catálogo completo ANTES de escribir (sin clics).
//   2) Bitácora con el valor anterior de cada producto (para deshacer en 1 clic).
//   3) Aplica SOLO los campos packagingType y granelUnit. Jamás stock, precios,
//      ventas, fiado ni clientes (garantía verificada por pruebas).
//   4) Marca "corrido una sola vez"; correr 1 vez o 5 da el mismo resultado.
//
// DESPLIEGUE POR ETAPAS (canary): primero el equipo del dueño, luego todos.
// Para pasar a todos: cambiar PACKAGING_FIX_ROLLOUT a 'todos'.

import { storageService } from './storageService';
import { PRODUCTS_KEY } from './catalogLock';
import { applyCatalogPackagingFix, planCatalogPackagingFix } from './granel';

export const PACKAGING_FIX_BACKUP_KEY = 'packaging_fix_v1_backup';
export const PACKAGING_FIX_LOG_KEY = 'packaging_fix_v1_log';
export const PACKAGING_FIX_STATUS_KEY = 'packaging_fix_v1_status';

// 'canary' = solo los equipos de la lista. 'todos' = todos los negocios.
export const PACKAGING_FIX_ROLLOUT = 'canary';
export const PACKAGING_FIX_CANARY_DEVICES = [
    'PDA-V2-AD516DDAEB9E7203AABE16E1ABE6B575', // equipo del dueño: canary (primero su tienda)
    'PDA-V2-D6F45E08E50D0996048FC4F10640776F', // equipo del dueño: canary (activo ahora)
];

/**
 * ¿Este equipo recibe la corrección automática en esta etapa del despliegue?
 */
export function isPackagingFixEnabled(deviceId) {
    if (PACKAGING_FIX_ROLLOUT === 'todos') return true;
    return Boolean(deviceId) && PACKAGING_FIX_CANARY_DEVICES.includes(deviceId);
}

const getStatus = () => {
    if (typeof localStorage === 'undefined') return null;
    try {
        return localStorage.getItem(PACKAGING_FIX_STATUS_KEY);
    } catch {
        return null;
    }
};

const setStatus = (value) => {
    if (typeof localStorage === 'undefined') return;
    try {
        localStorage.setItem(PACKAGING_FIX_STATUS_KEY, value);
    } catch {
        // Modo incógnito estricto: sin marca, la próxima sesión volverá a evaluar.
    }
};

/**
 * Corrección automática única. Nunca lanza: devuelve un resumen en su lugar.
 * @param {{deviceId?: string|null, storage?: object, now?: () => string}} opts
 * @returns {Promise<{ran: boolean, reason?: string, total?: number, corregidos?: number}>}
 */
export async function maybeRunPackagingFixMigration({
    deviceId = null,
    storage = storageService,
    now = () => new Date().toISOString(),
} = {}) {
    try {
        const status = getStatus();
        if (status === 'applied' || status === 'undone') return { ran: false, reason: 'ya-corrido' };
        if (!isPackagingFixEnabled(deviceId)) return { ran: false, reason: 'canary' };

        const products = (await storage.getItem(PRODUCTS_KEY, [])) || [];
        if (!Array.isArray(products) || products.length === 0) return { ran: false, reason: 'sin-productos' };

        const plan = planCatalogPackagingFix(products);
        if (plan.length === 0) {
            setStatus('applied');
            return { ran: false, reason: 'sin-cambios' };
        }

        // 1) Backup automático ANTES de cualquier escritura (sin que el usuario toque nada).
        await storage.setItem(PACKAGING_FIX_BACKUP_KEY, { timestamp: now(), products });

        // 2) Bitácora de reversión: valor anterior por producto.
        await storage.setItem(PACKAGING_FIX_LOG_KEY,
            plan.map(({ id, name, antes, despues }) => ({ id, name, antes, despues })));

        // 3) Aplicar SOLO packagingType/granelUnit y escribir el catálogo.
        //    storageService avisa a la app (app_storage_update) y la interfaz refresca.
        const { productos } = applyCatalogPackagingFix(products);
        await storage.setItem(PRODUCTS_KEY, productos);

        // 4) Marca de "una sola vez" (se escribe AL FINAL, cuando todo quedó bien).
        setStatus('applied');
        return { ran: true, total: products.length, corregidos: plan.length };
    } catch (err) {
        console.warn('[packagingFixMigration] No se pudo aplicar la corrección automática:', err);
        return { ran: false, reason: 'error' };
    }
}

/**
 * ¿Hay una corrección aplicada que se pueda deshacer? (para el botón de Ajustes).
 */
export async function hasPackagingFixUndo({ storage = storageService } = {}) {
    if (getStatus() !== 'applied') return false;
    const log = await storage.getItem(PACKAGING_FIX_LOG_KEY, null);
    return Array.isArray(log) && log.length > 0;
}

/**
 * Deshace la corrección usando la bitácora: devuelve cada producto a su valor
 * anterior de empaque. Luego queda marcado como 'undone' para no repetirla.
 * Nunca toca stock ni precios.
 */
export async function undoPackagingFixMigration({ storage = storageService } = {}) {
    try {
        const log = await storage.getItem(PACKAGING_FIX_LOG_KEY, null);
        if (!Array.isArray(log) || log.length === 0) return { undone: 0 };
        const products = (await storage.getItem(PRODUCTS_KEY, [])) || [];
        const antesById = new Map(log.map(l => [l.id, l.antes]));
        const productos = products.map(p => {
            const antes = p && typeof p === 'object' ? antesById.get(p.id) : undefined;
            if (!antes) return p;
            return {
                ...p,
                packagingType: antes.packagingType ?? null,
                granelUnit: antes.granelUnit ?? null,
            };
        });
        await storage.setItem(PRODUCTS_KEY, productos);
        await storage.removeItem(PACKAGING_FIX_LOG_KEY);
        setStatus('undone');
        return { undone: log.length };
    } catch (err) {
        console.warn('[packagingFixMigration] No se pudo deshacer la corrección:', err);
        return { undone: 0, reason: 'error' };
    }
}
