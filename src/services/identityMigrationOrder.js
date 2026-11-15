/**
 * identityMigrationOrder.js — Aviso remoto de cambio de ID para UNA instalación.
 *
 * Caso: dos computadoras comparten el mismo `PDA-V2-…`. Las órdenes remotas van
 * por device_id y las tomaría cualquiera de las dos; este aviso va dirigido a la
 * sesión de la nube de la instalación (auth.uid()), que es distinta en cada una.
 *
 * Flujo (migración 20261115_identity_migration_orders.sql):
 *   1. La caja pregunta `get_my_identity_migration_order(su ID actual)`.
 *      La base solo devuelve avisos de su propia sesión.
 *   2. Si su ID actual es el viejo del aviso, adopta el ID nuevo con
 *      migrateDeviceIdentity (el mismo cambio que el botón de Ajustes: no borra
 *      datos; el ID viejo y su licencia en la nube no se tocan).
 *   3. Confirma con `complete_identity_migration_order`. Si la confirmación se
 *      pierde, el siguiente chequeo la repite (el aviso también acepta el ID nuevo).
 *
 * Solo usa una sesión que YA exista en el equipo: nunca crea una sesión anónima
 * nueva (eso sumaría usuarios en la nube por cada caja sin Supervisor ni respaldo).
 * Una caja sin sesión no puede tener aviso, así que no pregunta.
 *
 * Cualquier error deja la caja como estaba.
 *
 * @module services/identityMigrationOrder
 */

import { supabaseCloud } from '../config/supabaseCloud';
import { migrateDeviceIdentity } from '../security/installIdentity';

const ASSIGNED_ID_RE = /^PDA-V2-[0-9A-F]{32}$/;

/**
 * @param {string} currentDeviceId
 * @param {{client?: any, getSession?: Function, migrate?: Function}} [deps]
 * @returns {Promise<{status: string, newDeviceId?: string, confirmed?: boolean, error?: any}>}
 */
export async function checkIdentityMigrationOrder(currentDeviceId, deps = {}) {
    const client = deps.client ?? supabaseCloud;
    const getSession = deps.getSession ?? (async () => {
        const { data } = await client.auth.getSession();
        return data?.session ?? null;
    });
    const migrate = deps.migrate ?? migrateDeviceIdentity;

    if (!client || typeof client.rpc !== 'function' || !currentDeviceId) return { status: 'skipped' };
    if (!deps.getSession && typeof client.auth?.getSession !== 'function') return { status: 'skipped' };

    try {
        const session = await getSession();
        if (!session?.user?.id) return { status: 'no_session' };

        const { data, error } = await client.rpc('get_my_identity_migration_order', {
            p_device_id: currentDeviceId,
        });
        // Base sin la migración aplicada (función inexistente) o red caída: no hacer nada.
        if (error) return { status: 'error', error };
        if (!data?.id) return { status: 'none' };

        const { id, oldDeviceId, newDeviceId } = data;
        if (!ASSIGNED_ID_RE.test(String(newDeviceId || '')) || !oldDeviceId || newDeviceId === oldDeviceId) {
            return { status: 'invalid' };
        }

        if (currentDeviceId === oldDeviceId) {
            const result = migrate({ newDeviceId, expectedCurrentId: oldDeviceId });
            if (result?.skipped || result?.deviceId !== newDeviceId) {
                return { status: 'not_applied', reason: result?.skipped || 'UNKNOWN' };
            }
        } else if (currentDeviceId !== newDeviceId) {
            return { status: 'mismatch' };
        }

        const { data: done, error: doneError } = await client.rpc('complete_identity_migration_order', {
            p_order_id: id,
            p_device_id: newDeviceId,
        });
        return {
            status: 'migrated',
            newDeviceId,
            confirmed: !doneError && done?.success === true,
            ...(doneError ? { error: doneError } : {}),
        };
    } catch (error) {
        return { status: 'error', error };
    }
}

export default { checkIdentityMigrationOrder };
