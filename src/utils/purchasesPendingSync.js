// Supervisor: compras que la caja ya confirmó (orden aplicada) pero que todavía
// no llegaron en la lista sincronizada desde la nube. Se muestran aparte y NO
// suman al total: la lista sincronizada sigue siendo la única fuente de verdad.
import { PURCHASE_DELETE_TYPE, PURCHASE_UPSERT_TYPE } from './merchandisePurchases';

export const PURCHASE_APPLIED_STATUSES = Object.freeze(['applied', 'applied_with_warnings']);
// Tiempo normal de publicación de la caja; pasado esto se avisa que no está subiendo.
export const PURCHASE_SYNC_STALE_MS = 5 * 60_000;

const commandTime = (command) => Date.parse(command?.issued_at || command?.created_at || '') || 0;

/**
 * @param {Array} commands filas de supervisor_commands (tipos purchase.*)
 * @param {Array} syncedPurchases lista de compras recibida de la nube
 * @param {number} now
 * @returns {{ items: Array<{ kind: 'upsert'|'delete', commandId, purchase, appliedAt }>, oldestAt: number|null, stale: boolean }}
 */
export function computeUnsyncedPurchases(commands, syncedPurchases, now = Date.now()) {
    const synced = new Map();
    for (const record of Array.isArray(syncedPurchases) ? syncedPurchases : []) {
        if (record?.id != null) synced.set(String(record.id), record);
    }

    // Solo la última orden aplicada de cada compra cuenta (corregir y luego borrar).
    const latest = new Map();
    const applied = (Array.isArray(commands) ? commands : [])
        .filter((c) => PURCHASE_APPLIED_STATUSES.includes(c?.status)
            && (c?.command_type === PURCHASE_UPSERT_TYPE || c?.command_type === PURCHASE_DELETE_TYPE))
        .sort((a, b) => commandTime(a) - commandTime(b));
    for (const command of applied) {
        const id = command.command_type === PURCHASE_UPSERT_TYPE
            ? command.payload?.purchase?.id
            : command.payload?.purchaseId;
        if (id) latest.set(String(id), command);
    }

    const items = [];
    for (const [id, command] of latest) {
        const appliedAt = commandTime(command);
        const current = synced.get(id);
        if (command.command_type === PURCHASE_UPSERT_TYPE) {
            const purchase = command.payload.purchase;
            const arrived = current
                && typeof current.updatedAt === 'string'
                && typeof purchase.updatedAt === 'string'
                && current.updatedAt >= purchase.updatedAt;
            if (!arrived) items.push({ kind: 'upsert', commandId: command.command_id, purchase, appliedAt });
        } else if (current) {
            items.push({
                kind: 'delete',
                commandId: command.command_id,
                purchase: { ...current, supplier: current.supplier || command.payload?.supplier || '' },
                appliedAt,
            });
        }
    }
    items.sort((a, b) => a.appliedAt - b.appliedAt);
    const oldestAt = items.length ? items[0].appliedAt : null;
    return { items, oldestAt, stale: oldestAt != null && now - oldestAt > PURCHASE_SYNC_STALE_MS };
}
