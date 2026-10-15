import { describe, expect, it, vi } from 'vitest';
import { createInventoryDraft, addInventoryDraftLine } from '../src/services/supervisorInventoryDraft';
import { sendSupervisorInventoryBatch } from '../src/services/supervisorInventoryBatchSender';

function makeDraft() {
    let draft = createInventoryDraft('ingreso', { reason: 'Recepción del día' });
    draft = addInventoryDraftLine(draft, { productId: 'a', inputUnit: 'unidades', quantityInput: 4, unitsPerPackage: 1 }).draft;
    draft = addInventoryDraftLine(draft, { productId: 'b', inputUnit: 'cajas', quantityInput: 2, unitsPerPackage: 6 }).draft;
    return draft;
}

describe('sendSupervisorInventoryBatch', () => {
    it('envía líneas secuencialmente usando stock esperado y continúa con otros productos', async () => {
        const sendCommand = vi.fn()
            .mockResolvedValueOnce({ ok: true, commandId: 'cmd-a', ackPromise: Promise.resolve({ ok: true, commandId: 'cmd-a', ack: { stockAfter: 14 } }) })
            .mockResolvedValueOnce({ ok: true, commandId: 'cmd-b', ackPromise: Promise.resolve({ ok: true, commandId: 'cmd-b', ack: { stockAfter: 14 } }) });
        const result = await sendSupervisorInventoryBatch({
            draft: makeDraft(),
            products: [{ id: 'a', stock: 10 }, { id: 'b', stock: 2 }],
            targetDeviceId: 'device-1',
            sendCommand,
        });

        expect(result.applied).toHaveLength(2);
        expect(sendCommand.mock.calls[0][0].payload.expectedStock).toBe(10);
        expect(sendCommand.mock.calls[1][0].payload.expectedStock).toBe(2);
    });

    it('marca la línea fallida y no intenta otra línea del mismo producto', async () => {
        let draft = createInventoryDraft('ingreso', { reason: 'Recepción' });
        draft = addInventoryDraftLine(draft, { productId: 'a', inputUnit: 'unidades', quantityInput: 1, unitsPerPackage: 1 }).draft;
        draft = addInventoryDraftLine(draft, { productId: 'a', inputUnit: 'cajas', quantityInput: 1, unitsPerPackage: 6 }).draft;
        const sendCommand = vi.fn().mockResolvedValue({ ok: false, error: 'conflicto' });
        const result = await sendSupervisorInventoryBatch({ draft, products: [{ id: 'a', stock: 10 }], targetDeviceId: 'device-1', sendCommand });

        expect(sendCommand).toHaveBeenCalledTimes(1);
        expect(result.failed).toHaveLength(1);
        expect(result.pending).toHaveLength(1);
    });
});
