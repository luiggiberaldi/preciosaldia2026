// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SupervisorInventoryBatchPanel, {
    formatInventoryLineQuantity,
    formatInventorySummaryTotal,
} from '../src/components/Monitor/SupervisorInventoryBatchPanel';
import { sendSupervisorInventoryBatch } from '../src/services/supervisorInventoryBatchSender';

vi.mock('../src/services/supervisorInventoryBatchSender', () => ({
    sendSupervisorInventoryBatch: vi.fn(),
}));

const product = {
    id: 'p-1',
    name: 'Arroz Premium',
    barcode: '123456',
    stock: 10,
    unitsPerPackage: 12,
};

function setInputValue(input, value) {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('SupervisorInventoryBatchPanel', () => {
    let container;
    let root;

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        sendSupervisorInventoryBatch.mockReset();
    });

    it('oculta el dropdown al seleccionar y conserva el producto elegido', async () => {
        await act(async () => root.render(
            <SupervisorInventoryBatchPanel
                isOpen
                onClose={() => {}}
                products={[product]}
                remoteAvailable={false}
            />,
        ));

        const productInput = container.querySelector('input[placeholder="Nombre o código"]');
        await act(async () => setInputValue(productInput, 'Arroz'));

        const productOption = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Arroz Premium'));
        expect(productOption).toBeTruthy();
        await act(async () => productOption.click());

        expect(productInput.value).toBe('Arroz Premium');
        expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent.includes('Arroz Premium') && button !== productOption)).toBe(false);
        expect(container.textContent).toContain('Seleccionado: Arroz Premium');
    });

    it('preselecciona initialProduct sin crear una línea automática', async () => {
        await act(async () => root.render(
            <SupervisorInventoryBatchPanel
                isOpen
                onClose={() => {}}
                initialProduct={product}
                products={[product]}
                remoteAvailable={false}
            />,
        ));

        expect(container.querySelector('input[placeholder="Nombre o código"]').value).toBe('Arroz Premium');
        expect(container.textContent).toContain('0 líneas');
        expect(container.textContent).toContain('Agrega productos para comenzar');
    });

    it('usa la cantidad ingresada al agregar el producto preseleccionado', async () => {
        await act(async () => root.render(
            <SupervisorInventoryBatchPanel
                isOpen
                onClose={() => {}}
                initialProduct={product}
                products={[product]}
                remoteAvailable={false}
            />,
        ));

        const quantityInput = container.querySelector('input[type="number"]');
        await act(async () => setInputValue(quantityInput, '10'));
        const addButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Agregar'));
        await act(async () => addButton.click());

        expect(container.textContent).toContain('1 líneas');
        expect(container.textContent).toContain('10 unidades × 12 = 120 unidades');
        expect(container.textContent).toContain('Stock 10');
    });

    it('explicita la presentación y la conversión a unidades', () => {
        expect(formatInventoryLineQuantity({ quantityInput: 20, inputUnit: 'unidades', unitsPerPackage: 1, unitsDelta: 20 }))
            .toBe('20 unidades');
        expect(formatInventoryLineQuantity({ quantityInput: 2, inputUnit: 'cajas', unitsPerPackage: 12, unitsDelta: 24 }))
            .toBe('2 cajas × 12 = 24 unidades');
        expect(formatInventoryLineQuantity({ quantityInput: 1.5, inputUnit: 'kg', unitsPerPackage: 1, unitsDelta: 1.5 }))
            .toBe('1,5 kg');
        expect(formatInventoryLineQuantity({ quantityInput: 3, inputUnit: 'lt', unitsPerPackage: 1, unitsDelta: 3 }))
            .toBe('3 lt');
        expect(formatInventoryLineQuantity({ quantityInput: 500, inputUnit: 'gr/ml', unitsPerPackage: 1, unitsDelta: 500 }))
            .toBe('500 gr/ml');
        expect(formatInventoryLineQuantity({ quantityInput: 1.5, inputUnit: 'unidades', unitsPerPackage: 1, unitsDelta: 1.5, product: { isWeight: true, granelUnit: 'kg' } }))
            .toBe('1.5 kg');
        expect(formatInventoryLineQuantity({ quantityInput: 3, inputUnit: 'unidades', unitsPerPackage: 1, unitsDelta: 3, product: { packagingType: 'granel', granelUnit: 'litro' } }))
            .toBe('3 L');
    });

    it('aclara el total y marca equivalentes cuando mezcla presentaciones', () => {
        expect(formatInventorySummaryTotal([
            { inputUnit: 'cajas', unitsPerPackage: 12 },
        ], 24)).toBe('24 unidades');
        expect(formatInventorySummaryTotal([
            { inputUnit: 'cajas', unitsPerPackage: 12 },
            { inputUnit: 'unidades', unitsPerPackage: 1 },
        ], 26)).toBe('26 unidades equivalentes');
    });

    it('deshabilita la confirmación y no inicia envío si la caja está desconectada', async () => {
        await act(async () => root.render(
            <SupervisorInventoryBatchPanel
                isOpen
                onClose={() => {}}
                initialProduct={product}
                products={[product]}
                remoteAvailable={false}
            />,
        ));

        const addButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Agregar'));
        await act(async () => addButton.click());
        const confirmButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Conecta la caja'));

        expect(confirmButton).toBeTruthy();
        expect(confirmButton.disabled).toBe(true);
        expect(container.textContent).not.toContain('Enviando…');
        expect(container.textContent).not.toContain('Procesados 0 de 1');
        expect(sendSupervisorInventoryBatch).not.toHaveBeenCalled();
    });

    it('muestra revisión sin enviar y solo envía después de la confirmación final', async () => {
        sendSupervisorInventoryBatch.mockImplementation(async ({ draft }) => ({
            ok: false,
            results: draft.lines.map(line => ({ line, status: 'failed', error: 'Sin conexión con la caja' })),
            applied: [],
            failed: draft.lines.map(line => ({ line, status: 'failed', error: 'Sin conexión con la caja' })),
            pending: [],
        }));

        await act(async () => root.render(
            <SupervisorInventoryBatchPanel
                isOpen
                onClose={() => {}}
                initialProduct={product}
                products={[product]}
                remoteAvailable
            />,
        ));

        const addButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Agregar'));
        await act(async () => addButton.click());

        const reviewButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Revisar recepción'));
        await act(async () => reviewButton.click());

        expect(container.textContent).toContain('Revisión antes de enviar');
        expect(container.textContent).toContain('Tipo de movimientoIngreso');
        expect(container.textContent).toContain('MotivoCompra recibida');
        expect(container.textContent).toContain('Presentación: unidades');
        expect(container.textContent).toContain('Stock antes10 unidades');
        expect(container.textContent).toContain('Stock después22 unidades');
        expect(container.textContent).toContain('Total del movimiento12 unidades');
        expect(sendSupervisorInventoryBatch).not.toHaveBeenCalled();

        const backButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Volver a editar'));
        await act(async () => backButton.click());
        expect(container.textContent).not.toContain('Revisión antes de enviar');
        expect(sendSupervisorInventoryBatch).not.toHaveBeenCalled();

        const reviewAgainButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Revisar recepción'));
        await act(async () => reviewAgainButton.click());
        const confirmButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Confirmar recepción'));
        await act(async () => confirmButton.click());

        expect(container.textContent).toContain('La conexión con la caja se perdió');
        expect(container.textContent).toContain('1 línea queda pendiente para reintentar');
        expect(container.textContent).not.toContain('Procesados 0 de 1');
        expect(container.textContent).toContain('Arroz Premium');
    });
});
