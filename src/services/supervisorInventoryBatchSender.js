import { getInventoryDraftSummary } from './supervisorInventoryDraft';
import { buildInventoryBatchV2Payload, validateInventoryBatchV2Payload } from './supervisorContracts';
import {
    awaitSupervisorCommandAck,
    generateSupervisorCommandId,
    inspectSupervisorCommandState,
    sendSupervisorCommand,
} from './supervisorCommandService';

// ── Fase 10: un solo comando batch v2 + ACK global ──────────────────────────
// Un envío multiartículo produce UN comando (payload v2) y se resuelve con UN
// ACK global. Las líneas nunca se marcan aplicadas antes de ese ACK. Ante
// timeout se persiste y reutiliza el MISMO commandId: la reconciliación
// consulta el estado primero y jamás crea otro comando mientras el anterior
// siga vivo o sea incierto.

const BATCH_COMMAND_TYPE = 'supervisor.inventory.batch.adjust';
const TERMINAL_ACK_STATUSES = ['applied', 'applied_with_warnings', 'rejected', 'failed', 'cancelled'];

function getAckStock(ack, fallback) {
    const value = Number(ack?.ack?.stockAfter ?? ack?.stockAfter);
    return Number.isFinite(value) ? value : fallback;
}

/**
 * Persistencia del comando en vuelo por alcance (caja + dirección). Guarda
 * { commandId, payloadKey } para poder reconciliar el mismo comando aunque se
 * vuelva a enviar el mismo lote, y bloquear un segundo comando mientras haya
 * uno sin confirmar.
 */
export function createBatchCommandStore(storage = globalThis.localStorage, scopeKey = 'default') {
    const storageKey = `supervisor_batch_command_${scopeKey}`;
    return {
        load() {
            try {
                const raw = storage?.getItem(storageKey);
                return raw ? JSON.parse(raw) : null;
            } catch {
                return null;
            }
        },
        save(entry) {
            try {
                storage?.setItem(storageKey, JSON.stringify(entry));
            } catch { /* sin persistencia el reintento sigue siendo seguro por memoria */ }
        },
        clear() {
            try {
                storage?.removeItem(storageKey);
            } catch { /* best effort */ }
        },
    };
}

function payloadKeyOf(payload) {
    return JSON.stringify({
        direction: payload.direction,
        reason: payload.reason,
        reasonCategory: payload.reasonCategory ?? null,
        lotReference: payload.lotReference ?? null,
        lines: payload.lines.map(line => [
            String(line.productId),
            line.inputUnit,
            Number(line.quantityInput),
            Number(line.expectedStock),
            line.unitsPerPackage ?? null,
        ]),
    });
}

function finishBatch(summary, { status, error = null, commandId = null, ack = null, uncertain = false }) {
    const applied = status === 'applied' || status === 'applied_with_warnings';
    const results = summary.lines.map(line => {
        const lineStatus = applied ? 'applied' : (line.valid ? 'pending' : 'failed');
        return {
            line,
            status: lineStatus,
            error: lineStatus === 'applied'
                ? undefined
                : (line.valid
                    ? (error || 'La caja no confirmó el movimiento')
                    : (line.error || 'La línea tiene datos inválidos o stock insuficiente')),
            commandId,
            stockAfter: getAckStock(ack, line.projectedStock),
            ack,
        };
    });
    return {
        ok: applied,
        status,
        commandId,
        uncertain,
        ack,
        error,
        results,
        applied: results.filter(result => result.status === 'applied'),
        failed: results.filter(result => result.status === 'failed'),
        pending: results.filter(result => result.status === 'pending'),
    };
}

/**
 * Envía el lote completo como un solo comando batch v2 y devuelve la respuesta
 * por línea derivada del ACK global.
 *
 * Estados del resultado: 'applied', 'applied_with_warnings', 'rejected',
 * 'cancelled', 'failed', 'expired', 'invalid', 'timeout'. Solo 'timeout' marca
 * `uncertain: true` (estado desconocido → NO se recomienda reenvío; el próximo
 * intento reconcilia el mismo commandId sin crear otro comando).
 */
export async function sendSupervisorInventoryBatch({
    draft,
    products = [],
    targetDeviceId,
    sendCommand = sendSupervisorCommand,
    inspectCommandState = inspectSupervisorCommandState,
    awaitCommandAck = awaitSupervisorCommandAck,
    commandStore,
    commandIdFactory = generateSupervisorCommandId,
    now = () => Date.now(),
    onProgress,
}) {
    const summary = getInventoryDraftSummary(draft, products);
    const store = commandStore
        || createBatchCommandStore(globalThis.localStorage, `${targetDeviceId || 'sin-caja'}:${draft.direction}`);

    // 1. Payload v2 único y validación completa (todo-o-nada): si una línea no
    //    vale, no se crea ningún comando.
    const payload = buildInventoryBatchV2Payload(
        {
            direction: draft.direction,
            reason: draft.reason,
            reasonCategory: draft.direction === 'egreso' ? draft.reasonCategory : undefined,
            lotReference: draft.lotReference,
        },
        summary.lines.map(line => ({
            lineId: line.id,
            productId: line.productId,
            inputUnit: line.inputUnit,
            quantityInput: line.quantityInput,
            unitsPerPackage: line.unitsPerPackage,
            expectedStock: line.stock,
        })),
    );
    const hasInvalidLines = summary.invalidLines.length > 0;
    if (hasInvalidLines || !validateInventoryBatchV2Payload(payload)) {
        return finishBatch(summary, {
            status: 'invalid',
            error: hasInvalidLines
                ? 'Revisa las líneas marcadas antes de enviar'
                : 'El lote no cumple el contrato batch v2',
        });
    }

    const payloadKey = payloadKeyOf(payload);

    // 2. Reconciliación: si hay un comando persistido, primero se consulta su
    //    estado. Jamás se crea otro mientras siga vivo o sea incierto.
    let commandId = null;
    let ack = null;
    const entry = store.load();
    if (entry?.commandId) {
        commandId = entry.commandId;
        let inspection;
        try {
            inspection = await inspectCommandState(entry.commandId);
        } catch {
            return finishBatch(summary, {
                status: 'timeout',
                error: 'No se pudo verificar el estado del lote anterior. No lo reenvíes todavía.',
                commandId: entry.commandId,
                uncertain: true,
            });
        }

        if (inspection.state === 'terminal') {
            store.clear();
            if (entry.payloadKey === payloadKey) {
                // El reintento ya estaba resuelto: se reporta el ACK global real.
                return finishBatch(summary, {
                    status: inspection.ack.status,
                    error: inspection.ack.error,
                    commandId: entry.commandId,
                    ack: inspection.ack,
                });
            }
            // Lote anterior terminó (otro contenido): se permite uno nuevo,
            // con un commandId fresco para no colisionar con el ya terminado.
            commandId = null;
        } else if (inspection.state === 'expired') {
            store.clear();
            if (entry.payloadKey === payloadKey) {
                return finishBatch(summary, {
                    status: 'expired',
                    error: 'La orden expiró en la caja sin aplicarse',
                    commandId: entry.commandId,
                });
            }
            commandId = null;
        } else if (inspection.state === 'active') {
            if (entry.payloadKey !== payloadKey) {
                // Hay otro lote sin confirmar: bloquear sin crear otro comando.
                return finishBatch(summary, {
                    status: 'timeout',
                    error: 'Hay un lote anterior sin confirmar en la caja. No se envió este nuevo lote.',
                    commandId: entry.commandId,
                    uncertain: true,
                });
            }
            onProgress?.({ commandId: entry.commandId, status: 'reconciling' });
            try {
                ack = await awaitCommandAck(entry.commandId);
            } catch (error) {
                return finishBatch(summary, {
                    status: 'timeout',
                    error: error?.message || 'No se pudo consultar el ACK del lote anterior',
                    commandId: entry.commandId,
                    uncertain: true,
                });
            }
        }
        // 'absent': el comando nunca llegó a crearse → se reutiliza su ID abajo.
    }

    if (!ack && !commandId) {
        commandId = commandIdFactory();
        store.save({ commandId, payloadKey });
    }

    // 3. Un solo comando v2 para todo el lote, con el commandId estable.
    if (!ack) {
        const response = await sendCommand({
            type: BATCH_COMMAND_TYPE,
            targetDeviceId,
            payload,
            commandId,
        });

        if (!response?.ok) {
            const creationUncertain = response?.status === 'failed';
            return finishBatch(summary, {
                status: creationUncertain ? 'timeout' : 'failed',
                error: response?.error || 'No se pudo enviar la orden',
                commandId,
                uncertain: creationUncertain,
            });
        }

        onProgress?.({ commandId, status: 'sent' });
        ack = response.ackPromise ? await response.ackPromise : response;
    }

    // 4. ACK global → respuesta por línea. Solo un ACK con commandId y estado
    //    terminal es conclusión cierta; cualquier otra cosa es incierta y se
    //    conserva el commandId para reconciliar sin duplicar.
    const terminalAck = ack
        && ack.commandId === commandId
        && TERMINAL_ACK_STATUSES.includes(ack.status)
        ? ack
        : null;

    if (terminalAck) {
        store.clear();
        return finishBatch(summary, {
            status: terminalAck.status,
            error: terminalAck.error,
            commandId,
            ack: terminalAck,
        });
    }

    return finishBatch(summary, {
        status: 'timeout',
        error: ack?.error || 'La caja no confirmó la orden a tiempo',
        commandId,
        ack: ack || null,
        uncertain: true,
    });
}

export default { sendSupervisorInventoryBatch, createBatchCommandStore };
