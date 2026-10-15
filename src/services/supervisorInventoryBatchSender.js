import { getInventoryDraftSummary } from './supervisorInventoryDraft';
import { sendSupervisorCommand } from './supervisorCommandService';

function getAckStock(ack, fallback) {
    const value = Number(ack?.ack?.stockAfter ?? ack?.stockAfter);
    return Number.isFinite(value) ? value : fallback;
}

export async function sendSupervisorInventoryBatch({
    draft,
    products = [],
    targetDeviceId,
    sendCommand = sendSupervisorCommand,
    onProgress,
}) {
    const summary = getInventoryDraftSummary(draft, products);
    const stockByProduct = new Map(summary.lines.map(line => [String(line.productId), line.stock]));
    const completedProducts = new Set();
    const results = [];

    for (const line of summary.lines) {
        const productId = String(line.productId);
        if (!line.valid) {
            results.push({ line, status: 'failed', error: 'La línea tiene datos inválidos o stock insuficiente' });
            continue;
        }
        if (completedProducts.has(productId)) {
            results.push({ line, status: 'pending', error: 'Pendiente por conflicto en una línea anterior del mismo producto' });
            continue;
        }

        const expectedStock = stockByProduct.get(productId);
        const response = await sendCommand({
            type: 'supervisor.inventory.batch.adjust',
            targetDeviceId,
            payload: {
                direction: draft.direction,
                productId,
                quantityInput: line.quantityInput,
                inputUnit: line.inputUnit,
                unitsPerPackage: line.unitsPerPackage,
                expectedStock,
                reason: draft.reason.trim(),
                reasonCategory: draft.direction === 'egreso' ? draft.reasonCategory : undefined,
                lotReference: draft.lotReference.trim() || undefined,
            },
        });

        if (!response?.ok) {
            completedProducts.add(productId);
            results.push({ line, status: 'failed', error: response?.error || 'No se pudo enviar la orden' });
            onProgress?.({ line, status: 'failed', error: response?.error });
            continue;
        }

        const ack = response.ackPromise ? await response.ackPromise : response;
        if (!ack?.ok) {
            completedProducts.add(productId);
            results.push({ line, status: 'failed', error: ack?.error || 'La caja no confirmó el movimiento' });
            onProgress?.({ line, status: 'failed', error: ack?.error });
            continue;
        }

        const fallbackStock = draft.direction === 'egreso'
            ? expectedStock - line.unitsDelta
            : expectedStock + line.unitsDelta;
        stockByProduct.set(productId, getAckStock(ack, fallbackStock));
        results.push({ line, status: 'applied', commandId: ack.commandId || response.commandId, ack });
        onProgress?.({ line, status: 'applied', commandId: ack.commandId || response.commandId });
    }

    return {
        ok: results.every(result => result.status === 'applied'),
        results,
        applied: results.filter(result => result.status === 'applied'),
        failed: results.filter(result => result.status === 'failed'),
        pending: results.filter(result => result.status === 'pending'),
    };
}

export default { sendSupervisorInventoryBatch };
