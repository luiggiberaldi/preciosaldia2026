// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import SupervisorInventoryBatchPanel, {
    buildInventoryBatchTargets,
    formatInventoryLineQuantity,
    formatInventorySummaryTotal,
    getInventoryUnitOptions,
} from '../src/components/Monitor/SupervisorInventoryBatchPanel';
import { getInventoryDraftSummary } from '../src/services/supervisorInventoryDraft';
import SupervisorInventoryBatchModal from '../src/components/Monitor/SupervisorInventoryBatchModal';
import { sendSupervisorInventoryBatch } from '../src/services/supervisorInventoryBatchSender';
import { inspectSupervisorCommandState, sendSupervisorCommand } from '../src/services/supervisorCommandService';
import { clearCommandDiagnostics, getReconciliations } from '../src/services/supervisorCommandDiagnostics';
import { showToast } from '../src/components/Toast';
import { resetSupervisorCommandTracker } from '../src/services/supervisorCommandTracker';

vi.mock('../src/services/supervisorCommandService', () => ({
    sendSupervisorCommand: vi.fn(),
    inspectSupervisorCommandState: vi.fn(),
}));

vi.mock('../src/services/supervisorInventoryBatchSender', () => ({
    sendSupervisorInventoryBatch: vi.fn(),
}));

vi.mock('../src/components/Toast', () => ({
    showToast: vi.fn(),
}));

const product = {
    id: 'p-1',
    name: 'Arroz Premium',
    barcode: '123456',
    stock: 10,
    unitsPerPackage: 12,
};

function setInputValue(input, value) {
    const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
}

describe('SupervisorInventoryBatchPanel', () => {
    let container;
    let root;

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        resetSupervisorCommandTracker();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        sendSupervisorInventoryBatch.mockReset();
        sendSupervisorCommand.mockReset();
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
        expect(container.textContent).toContain('10 unidades');
        expect(container.textContent).not.toContain('× 12 = 120 unidades');
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
        expect(container.textContent).toContain('Stock después11 unidades');
        expect(container.textContent).toContain('Total del movimiento1 unidad');
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

    it('carga factor 24 al elegir Bultos y oculta el campo en unidades', async () => {
        const product24 = { id: 'p-24', name: 'Atún Pack 24', stock: 50, unitsPerPackage: 24 };
        await act(async () => root.render(
            <SupervisorInventoryBatchPanel
                isOpen
                onClose={() => {}}
                products={[product24]}
                remoteAvailable
            />,
        ));

        // 1. Buscar y seleccionar Atún Pack 24
        const searchInput = container.querySelector('input[placeholder="Nombre o código"]');
        await act(async () => setInputValue(searchInput, 'Atún'));
        const productOption = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Atún Pack 24'));
        await act(async () => productOption.click());

        // En unidades el factor no se muestra: siempre es 1 y no significa nada.
        expect(container.querySelector('input[aria-label="Unidades por presentación"]')).toBeNull();

        // Cambiar a bultos: debe cargar el factor 24 del producto
        const selectButton = container.querySelector('button[aria-label="Unidad"]');
        await act(async () => selectButton.click());
        const bultosOption = Array.from(document.querySelectorAll('button[role="option"]')).find(b => b.textContent.includes('Bultos'));
        await act(async () => bultosOption.click());
        expect(container.querySelector('input[aria-label="Unidades por presentación"]').value).toBe('24');
        expect(container.textContent).not.toContain('sin configurar');

        // Volver a unidades: el campo desaparece
        await act(async () => selectButton.click());
        const unidadesOption = Array.from(document.querySelectorAll('button[role="option"]')).find(b => b.textContent.includes('Unidades'));
        await act(async () => unidadesOption.click());
        expect(container.querySelector('input[aria-label="Unidades por presentación"]')).toBeNull();

        // De vuelta a bultos: restaura el factor configurado 24 (no conserva 1)
        await act(async () => selectButton.click());
        const bultosOptionAgain = Array.from(document.querySelectorAll('button[role="option"]')).find(b => b.textContent.includes('Bultos'));
        await act(async () => bultosOptionAgain.click());
        expect(container.querySelector('input[aria-label="Unidades por presentación"]').value).toBe('24');
    });

    it('exige configurar el bulto antes de agregar una línea si el producto no lo tiene', async () => {
        const prodSinFactor = { id: 'p-b', name: 'Manzanas', stock: 10 };
        await act(async () => root.render(
            <SupervisorInventoryBatchPanel
                isOpen
                onClose={() => {}}
                products={[prodSinFactor]}
                remoteAvailable
            />,
        ));

        const searchInput = container.querySelector('input[placeholder="Nombre o código"]');
        await act(async () => setInputValue(searchInput, 'Manzanas'));
        const productOption = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Manzanas'));
        await act(async () => productOption.click());

        const selectButton = container.querySelector('button[aria-label="Unidad"]');
        await act(async () => selectButton.click());
        const bultosOption = Array.from(document.querySelectorAll('button[role="option"]')).find(b => b.textContent.includes('Bultos'));
        await act(async () => bultosOption.click());

        // Sin factor configurado: el campo queda vacío y avisa, no asume 1.
        expect(container.querySelector('input[aria-label="Unidades por presentación"]').value).toBe('');
        expect(container.textContent).toContain('sin configurar');

        // No deja agregar la línea hasta configurar el bulto.
        const addButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Agregar'));
        await act(async () => addButton.click());
        expect(container.textContent).toContain('Este producto no tiene el bulto configurado');
        expect(container.textContent).toContain('0 líneas');

        // Con el factor escrito, la línea entra y muestra la cuenta clara.
        await act(async () => setInputValue(container.querySelector('input[aria-label="Unidades por presentación"]'), '12'));
        expect(container.textContent).toContain('1 bulto × 12 = 12 unidades');
        await act(async () => addButton.click());
        expect(container.textContent).toContain('1 líneas');
    });

    it('guarda el empaque en el producto y el resultado llega como aviso del tracker', async () => {
        sendSupervisorCommand.mockResolvedValue({
            ok: true,
            commandId: 'cmd-package-1',
            ackPromise: Promise.resolve({ ok: true, status: 'applied', commandId: 'cmd-package-1', ack: null, error: null }),
        });
        showToast.mockReset();
        const onOptimisticEcho = vi.fn();
        const product24 = { id: 'p-24', name: 'Atún Pack 24', stock: 50, unitsPerPackage: 24 };
        await act(async () => root.render(
            <SupervisorInventoryBatchPanel
                isOpen
                onClose={() => {}}
                products={[product24]}
                targetDeviceId="device-1"
                remoteAvailable
                onOptimisticEcho={onOptimisticEcho}
            />,
        ));

        const searchInput = container.querySelector('input[placeholder="Nombre o código"]');
        await act(async () => setInputValue(searchInput, 'Atún'));
        const productOption = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Atún Pack 24'));
        await act(async () => productOption.click());

        const selectButton = container.querySelector('button[aria-label="Unidad"]');
        await act(async () => selectButton.click());
        const bultosOption = Array.from(document.querySelectorAll('button[role="option"]')).find(b => b.textContent.includes('Bultos'));
        await act(async () => bultosOption.click());

        // Con el factor igual al del producto no hay nada que guardar.
        expect(Array.from(container.querySelectorAll('button')).some(b => b.textContent.includes('Guardar en el producto'))).toBe(false);

        // Cambiar el factor abre la opción de guardarlo en el producto.
        await act(async () => setInputValue(container.querySelector('input[aria-label="Unidades por presentación"]'), '30'));
        const saveButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Guardar en el producto'));
        expect(saveButton).toBeTruthy();
        await act(async () => saveButton.click());

        expect(sendSupervisorCommand).toHaveBeenCalledExactlyOnceWith({
            type: 'supervisor.product.update',
            targetDeviceId: 'device-1',
            payload: {
                productId: 'p-24',
                baseRevision: expect.any(String),
                baseUpdatedAt: null,
                patch: { unitsPerPackage: 30, baseRevision: expect.any(String) },
            },
        });
        // Contrato "confirma y seguir": el éxito SIEMPRE se avisa, vía tracker.
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('empaque'), 'success');
        expect(showToast).toHaveBeenCalledWith(expect.stringContaining('✅'), 'success');
        // Eco optimista: el empaque nuevo se refleja AL INSTANTE en el catálogo
        // del supervisor (mismo contrato que RemoteProductFormModal), sin
        // esperar el viaje monitor → caja → nube → monitor.
        expect(onOptimisticEcho).toHaveBeenCalledExactlyOnceWith({
            action: 'edit',
            productId: 'p-24',
            patch: { unitsPerPackage: 30 },
            product: null,
            baseUpdatedAt: null,
            commandId: 'cmd-package-1',
            ackPromise: expect.any(Promise),
        });
    });

    it('invalida inmediatamente la selección anterior al escribir en el campo de búsqueda', async () => {
        await act(async () => root.render(
            <SupervisorInventoryBatchPanel
                isOpen
                onClose={() => {}}
                products={[product]}
                remoteAvailable
            />,
        ));

        const searchInput = container.querySelector('input[placeholder="Nombre o código"]');
        await act(async () => setInputValue(searchInput, 'Arroz'));
        const productOption = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Arroz Premium'));
        await act(async () => productOption.click());

        expect(container.textContent).toContain('Seleccionado: Arroz Premium');

        // Modificar el texto de búsqueda
        await act(async () => setInputValue(searchInput, 'Arroz Extra'));

        // La selección previa debe quedar invalidada de inmediato
        expect(container.textContent).not.toContain('Seleccionado: Arroz Premium');

        // Intentar agregar sin selección válida debe ser rechazado
        const addButton = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Agregar'));
        await act(async () => addButton.click());

        expect(container.textContent).toContain('Busca y selecciona un producto');
        expect(container.textContent).toContain('0 líneas');
    });

    it('actualiza el factor al cambiar a otro producto o producto sin factor', async () => {
        const prodA = { id: 'p-a', name: 'Galletas', unitsPerPackage: 30 };
        const prodB = { id: 'p-b', name: 'Manzanas' }; // Sin unitsPerPackage
        await act(async () => root.render(
            <SupervisorInventoryBatchPanel
                isOpen
                onClose={() => {}}
                products={[prodA, prodB]}
                remoteAvailable
            />,
        ));

        const searchInput = container.querySelector('input[placeholder="Nombre o código"]');
        const selectButton = container.querySelector('button[aria-label="Unidad"]');

        // Cambiar primero a bultos
        await act(async () => selectButton.click());
        const bultosOption = Array.from(document.querySelectorAll('button[role="option"]')).find(b => b.textContent.includes('Bultos'));
        await act(async () => bultosOption.click());

        // Seleccionar Galletas con factor 30
        await act(async () => setInputValue(searchInput, 'Galletas'));
        const optA = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Galletas'));
        await act(async () => optA.click());
        expect(container.querySelector('input[aria-label="Unidades por presentación"]').value).toBe('30');

        // Seleccionar Manzanas sin factor: queda vacío y avisa "sin configurar" (nunca 1).
        await act(async () => setInputValue(searchInput, 'Manzanas'));
        const optB = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Manzanas'));
        await act(async () => optB.click());
        expect(container.querySelector('input[aria-label="Unidades por presentación"]').value).toBe('');
        expect(container.textContent).toContain('sin configurar');
    });

    describe('SupervisorInventoryBatchModal presentation factors', () => {
        async function selectPresentation(label) {
            await act(async () => container.querySelector('button[aria-label="Seleccionar presentación del movimiento"]').click());
            const option = Array.from(document.querySelectorAll('button[role="option"]')).find(button => button.textContent.includes(label));
            await act(async () => option.click());
        }

        it('actualiza el producto con el modal abierto y conserva la edición ante un nuevo objeto del mismo producto', async () => {
            const renderProduct = async (nextProduct) => act(async () => root.render(
                <SupervisorInventoryBatchModal isOpen product={nextProduct} targetDeviceId="device-1" remoteAvailable />,
            ));
            await renderProduct({ ...product, unitsPerPackage: 24 });
            await selectPresentation('Bultos');
            await act(async () => {
                setInputValue(container.querySelector('input[aria-label^="Cantidad de"]'), '3');
                setInputValue(container.querySelector('textarea'), 'Compra recibida');
            });
            await renderProduct({ ...product, unitsPerPackage: 24, stock: 15 });
            expect(container.querySelector('input[aria-label="Unidades por bulto"]').value).toBe('24');
            expect(container.querySelector('input[aria-label^="Cantidad de"]').value).toBe('3');
            expect(container.querySelector('textarea').value).toBe('Compra recibida');

            await renderProduct({ id: 'new', name: 'Nuevo producto', unitsPerPackage: 30, stock: 20 });
            expect(container.textContent).toContain('Se registrará unidad por unidad');
            expect(container.querySelector('input[aria-label^="Cantidad de"]').value).toBe('1');
            expect(container.querySelector('textarea').value).toBe('');
            await selectPresentation('Bultos');
            expect(container.querySelector('input[aria-label="Unidades por bulto"]').value).toBe('30');

            await renderProduct({ id: 'none', name: 'Sin factor', stock: 10 });
            await selectPresentation('Bultos');
            // Sin factor configurado: vacío y aviso explícito, nunca un 1 silencioso.
            expect(container.querySelector('input[aria-label="Unidades por bulto"]').value).toBe('');
            expect(container.textContent).toContain('Este producto no tiene el bulto configurado');
            expect(sendSupervisorCommand).not.toHaveBeenCalled();
        });

        it.each(['unidades', 'bultos'])('envía el payload v1 correcto para %s y cierra sin esperar el ACK', async (inputUnit) => {
            let resolveAck;
            const ackPromise = new Promise(resolve => { resolveAck = resolve; });
            sendSupervisorCommand.mockResolvedValue({ ok: true, commandId: `cmd-modal-${inputUnit}`, ackPromise });
            const onClose = vi.fn();
            await act(async () => root.render(
                <SupervisorInventoryBatchModal isOpen onClose={onClose} product={{ ...product, unitsPerPackage: 24 }} targetDeviceId="device-1" remoteAvailable />,
            ));
            await selectPresentation('Bultos');
            await selectPresentation('Unidades');
            if (inputUnit === 'bultos') await selectPresentation('Bultos');
            await act(async () => {
                setInputValue(container.querySelector('input[aria-label^="Cantidad de"]'), '2');
                setInputValue(container.querySelector('textarea'), ' Compra recibida ');
            });
            await act(async () => container.querySelector('button[type="submit"]').click());
            expect(sendSupervisorCommand).toHaveBeenCalledExactlyOnceWith({
                type: 'supervisor.inventory.batch.adjust',
                targetDeviceId: 'device-1',
                payload: {
                    direction: 'ingreso', productId: product.id, quantityInput: 2, inputUnit,
                    unitsPerPackage: inputUnit === 'unidades' ? 1 : 24,
                    expectedStock: 10, reason: 'Compra recibida', reasonCategory: undefined, lotReference: undefined,
                },
            });
            // Contrato "confirma y seguir": el modal se cierra al quedar la
            // orden registrada, SIN esperar la confirmación de la caja.
            expect(onClose).toHaveBeenCalledTimes(1);
            await act(async () => resolveAck({ ok: true, status: 'applied', commandId: `cmd-modal-${inputUnit}`, ack: null, error: null }));
            // El ACK tardío no vuelve a cerrar ni duplica avisos.
            expect(onClose).toHaveBeenCalledTimes(1);
        });

        it('un envío fallido NO cierra el modal y deja el error a la vista', async () => {
            sendSupervisorCommand.mockResolvedValue({ ok: false, status: 'invalid', error: 'Orden rechazada por la caja' });
            const onClose = vi.fn();
            await act(async () => root.render(
                <SupervisorInventoryBatchModal isOpen onClose={onClose} product={{ ...product, unitsPerPackage: 24 }} targetDeviceId="device-1" remoteAvailable />,
            ));
            await act(async () => {
                setInputValue(container.querySelector('input[aria-label^="Cantidad de"]'), '2');
                setInputValue(container.querySelector('textarea'), 'Compra recibida');
            });
            await act(async () => container.querySelector('button[type="submit"]').click());

            expect(onClose).not.toHaveBeenCalled();
            expect(container.textContent).toContain('Orden rechazada por la caja');
        });

        it('usa factor 1 para unidades y restaura el factor configurado (24) al alternar a cajas', async () => {
            const product24 = { id: 'p-24', name: 'Atún Pack 24', stock: 50, unitsPerPackage: 24 };
            await act(async () => root.render(
                <SupervisorInventoryBatchModal
                    isOpen
                    onClose={() => {}}
                    product={product24}
                    targetDeviceId="device-1"
                    remoteAvailable
                />,
            ));

            // Inicialmente en unidades: no muestra el input de unidades por caja
            expect(container.textContent).toContain('Se registrará unidad por unidad');

            // Cambiar a Cajas / Bultos: debe cargar el factor 24 del producto
            const selectButton = container.querySelector('button[aria-label="Seleccionar presentación del movimiento"]');
            await act(async () => selectButton.click());
            const cajaOption = Array.from(document.querySelectorAll('button[role="option"]')).find(b => b.textContent.includes('Bultos'));
            await act(async () => cajaOption.click());

            const factorInput = container.querySelector('input[aria-label="Unidades por bulto"]');
            expect(factorInput.value).toBe('24');

            // Alternar de vuelta a unidades: factor pasa a 1
            await act(async () => selectButton.click());
            const unidadesOption = Array.from(document.querySelectorAll('button[role="option"]')).find(b => b.textContent.includes('Unidades'));
            await act(async () => unidadesOption.click());
            expect(container.textContent).toContain('Se registrará unidad por unidad');

            // Alternar de nuevo a Cajas / Bultos: restaura 24 (no se queda en 1)
            await act(async () => selectButton.click());
            const cajaOptionAgain = Array.from(document.querySelectorAll('button[role="option"]')).find(b => b.textContent.includes('Bultos'));
            await act(async () => cajaOptionAgain.click());
            expect(container.querySelector('input[aria-label="Unidades por bulto"]').value).toBe('24');
        });

        it('marca sin configurar y bloquea el envío si el bulto no está configurado en el modal individual', async () => {
            const productSinFactor = { id: 'p-none', name: 'Manzanas', stock: 10 };
            await act(async () => root.render(
                <SupervisorInventoryBatchModal
                    isOpen
                    onClose={() => {}}
                    product={productSinFactor}
                    targetDeviceId="device-1"
                    remoteAvailable
                />,
            ));

            const selectButton = container.querySelector('button[aria-label="Seleccionar presentación del movimiento"]');
            await act(async () => selectButton.click());
            const bultosOption = Array.from(document.querySelectorAll('button[role="option"]')).find(b => b.textContent.includes('Bultos'));
            await act(async () => bultosOption.click());

            // Sin factor: campo vacío y aviso claro, nunca un 1 silencioso.
            expect(container.querySelector('input[aria-label="Unidades por bulto"]').value).toBe('');
            expect(container.textContent).toContain('Este producto no tiene el bulto configurado');

            // El envío se bloquea con un mensaje accionable antes de mandar nada.
            await act(async () => {
                setInputValue(container.querySelector('textarea'), 'Compra recibida');
            });
            await act(async () => container.querySelector('button[type="submit"]').click());
            expect(container.textContent).toContain('Indica cuántas unidades trae el bulto');
            expect(sendSupervisorCommand).not.toHaveBeenCalled();
        });
    });
});

describe('Fase 4: unidades a granel en el panel', () => {
    const solid = { id: 'g-1', name: 'Azúcar', stock: 2, packagingType: 'granel', granelUnit: 'kg' };
    const liquid = { id: 'l-1', name: 'Aceite', stock: 1, packagingType: 'granel', granelUnit: 'litro' };
    const values = (p) => getInventoryUnitOptions(p).map(option => option.value);

    it('ofrece solo unidades compatibles con el producto', () => {
        expect(values(solid)).toEqual(['kg', 'g']);
        expect(values(liquid)).toEqual(['lt', 'ml']);
        expect(values({ id: 'p', name: 'Arroz', stock: 1 })).toEqual(['unidades', 'bultos']);
        expect(values(undefined)).toEqual(['unidades', 'bultos']);
    });

    it('muestra g/ml con su equivalente canónico y el error de líneas incompatibles', () => {
        const draft = {
            direction: 'ingreso',
            lines: [
                { id: 'a', productId: 'g-1', productName: 'Azúcar', inputUnit: 'g', quantityInput: 500, unitsPerPackage: 1 },
                { id: 'b', productId: 'l-1', productName: 'Aceite', inputUnit: 'kg', quantityInput: 1, unitsPerPackage: 1 },
            ],
        };
        const [grams, wrong] = getInventoryDraftSummary(draft, [solid, liquid]).lines;
        expect(grams).toMatchObject({ valid: true, unitsDelta: 0.5, projectedStock: 2.5 });
        expect(formatInventoryLineQuantity(grams)).toMatch(/^500 gr = /);
        expect(formatInventoryLineQuantity(grams)).toMatch(/0[.,]5/);
        expect(wrong.valid).toBe(false);
        expect(wrong.error).toMatch(/líquido/i);
    });
});

describe('Fase 11: targets optimistas del lote (optimistic update)', () => {
    it('acumula los deltas por producto y reporta el stock objetivo', () => {
        const lines = [
            { productId: 'p-1', valid: true, stock: 10, projectedStock: 13 },
            { productId: 'p-1', valid: true, stock: 10, projectedStock: 5 },
            { productId: 'p-2', valid: true, stock: 7, projectedStock: 8 },
            { productId: 'p-3', valid: false, stock: 1, projectedStock: 2 },
        ];
        expect(buildInventoryBatchTargets(lines)).toEqual([
            { productId: 'p-1', targetStock: 8 },
            { productId: 'p-2', targetStock: 8 },
        ]);
    });

    it('redondea a 3 decimales para productos a granel', () => {
        const lines = [
            { productId: 'g-1', valid: true, stock: 1.2345, projectedStock: 2.3456 },
        ];
        expect(buildInventoryBatchTargets(lines)).toEqual([{ productId: 'g-1', targetStock: 2.346 }]);
    });
});

describe('Fase 10: ACK global del lote en el panel', () => {
    let container;
    let root;

    beforeEach(() => {
        globalThis.IS_REACT_ACT_ENVIRONMENT = true;
        resetSupervisorCommandTracker();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });

    afterEach(async () => {
        await act(async () => root.unmount());
        container.remove();
        sendSupervisorInventoryBatch.mockReset();
        inspectSupervisorCommandState.mockReset();
        showToast.mockReset();
        await clearCommandDiagnostics();
    });

    async function flushBackground() {
        await act(async () => {
            await Promise.resolve();
            await Promise.resolve();
            await Promise.resolve();
        });
    }

    async function openReviewWithOneLine(props = {}) {
        await act(async () => root.render(
            <SupervisorInventoryBatchPanel
                isOpen
                initialProduct={product}
                products={[product]}
                remoteAvailable
                onClose={() => {}}
                {...props}
            />,
        ));
        const addButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Agregar'));
        await act(async () => addButton.click());
        const reviewButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Revisar recepción'));
        await act(async () => reviewButton.click());
        return Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Confirmar recepción'));
    }

    it('timeout del ACK global: estado incierto, sin recomendar reenvío y botón "Revisar estado del lote"', async () => {
        const onCompleted = vi.fn();
        sendSupervisorInventoryBatch.mockImplementation(async ({ draft }) => ({
            ok: false,
            status: 'timeout',
            uncertain: true,
            commandId: 'cmd-1',
            error: 'La caja no confirmó la orden a tiempo',
            results: draft.lines.map(line => ({ line, status: 'pending' })),
            applied: [],
            failed: [],
            pending: draft.lines.map(line => ({ line, status: 'pending' })),
        }));

        const confirmButton = await openReviewWithOneLine({ onCompleted });
        await act(async () => confirmButton.click());

        expect(container.textContent).toContain('La caja aún no confirma el lote');
        expect(container.textContent).toContain('No lo reenvíes');
        expect(container.textContent).not.toContain('para reintentar');
        expect(container.textContent).toContain('Arroz Premium'); // el draft queda intacto
        expect(showToast).toHaveBeenCalledWith('Lote sin confirmar todavía', 'warning');
        expect(onCompleted).toHaveBeenCalledTimes(1);

        const recheckButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Revisar estado del lote'));
        expect(recheckButton).toBeTruthy();
        // Reconciliar = invocar de nuevo el sender (reutiliza el mismo commandId).
        await act(async () => recheckButton.click());
        expect(sendSupervisorInventoryBatch).toHaveBeenCalledTimes(2);
        expect(container.textContent).toContain('No lo reenvíes');
    });

    it('rechazo cierto: nada aplicado, líneas pendientes y reintento permitido', async () => {
        const onCompleted = vi.fn();
        sendSupervisorInventoryBatch.mockImplementation(async ({ draft }) => ({
            ok: false,
            status: 'rejected',
            uncertain: false,
            commandId: 'cmd-1',
            error: 'La caja rechazó el lote',
            results: draft.lines.map(line => ({ line, status: 'pending' })),
            applied: [],
            failed: [],
            pending: draft.lines.map(line => ({ line, status: 'pending' })),
        }));

        const confirmButton = await openReviewWithOneLine({ onCompleted });
        await act(async () => confirmButton.click());

        expect(container.textContent).toContain('La caja rechazó el lote');
        expect(container.textContent).toContain('queda pendiente');
        expect(container.textContent).not.toContain('No lo reenvíes');
        // Conclusión cierta: el reintento con comando nuevo sigue permitido.
        expect(container.textContent).toContain('Confirmar recepción');
        expect(onCompleted).toHaveBeenCalledTimes(1);
    });

    // ── Fase 2 del plan 2026-10-20: ningún error del servidor en silencio ────
    it('(d) un rechazo del servidor muestra su texto REAL además del resumen', async () => {
        const onCompleted = vi.fn();
        sendSupervisorInventoryBatch.mockImplementation(async ({ draft }) => ({
            ok: false,
            status: 'rejected',
            uncertain: false,
            commandId: 'cmd-1',
            error: 'Payload de ajuste por lote inválido',
            results: draft.lines.map(line => ({ line, status: 'pending' })),
            applied: [],
            failed: [],
            pending: draft.lines.map(line => ({ line, status: 'pending' })),
        }));

        const confirmButton = await openReviewWithOneLine({ onCompleted });
        await act(async () => confirmButton.click());

        expect(container.textContent).toContain('Payload de ajuste por lote inválido');
    });

    it('(d) el estado incierto también conserva el texto REAL del servidor', async () => {
        sendSupervisorInventoryBatch.mockImplementation(async ({ draft }) => ({
            ok: false,
            status: 'timeout',
            uncertain: true,
            commandId: 'cmd-1',
            error: 'La caja no confirmó la orden a tiempo',
            results: draft.lines.map(line => ({ line, status: 'pending' })),
            applied: [],
            failed: [],
            pending: draft.lines.map(line => ({ line, status: 'pending' })),
        }));

        const confirmButton = await openReviewWithOneLine({});
        await act(async () => confirmButton.click());

        expect(container.textContent).toContain('La caja aún no confirma el lote');
        expect(container.textContent).toContain('La caja no confirmó la orden a tiempo');
    });

    it('ACK aplicado con advertencias: éxito con advertencias y cierre del panel', async () => {
        const onCompleted = vi.fn();
        const onClose = vi.fn();
        sendSupervisorInventoryBatch.mockResolvedValue({
            ok: true,
            status: 'applied_with_warnings',
            uncertain: false,
            commandId: 'cmd-1',
            results: [],
            applied: [],
            failed: [],
            pending: [],
        });

        const confirmButton = await openReviewWithOneLine({ onCompleted, onClose });
        await act(async () => confirmButton.click());

        expect(showToast).toHaveBeenCalledWith('1 movimiento aplicado con advertencias en caja', 'warning');
        expect(onClose).toHaveBeenCalledTimes(1);
        expect(onCompleted).toHaveBeenCalledTimes(1);
    });

    it('envío aplicado sin advertencias cierra el panel', async () => {
        const onClose = vi.fn();
        sendSupervisorInventoryBatch.mockResolvedValue({
            ok: true,
            status: 'applied',
            uncertain: false,
            commandId: 'cmd-1',
            results: [],
            applied: [],
            failed: [],
            pending: [],
        });

        const confirmButton = await openReviewWithOneLine({ onClose });
        await act(async () => confirmButton.click());

        expect(showToast).toHaveBeenCalledWith('1 movimiento confirmado en caja', 'success');
        expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('timeout del ACK no cierra el panel', async () => {
        const onClose = vi.fn();
        sendSupervisorInventoryBatch.mockImplementation(async ({ draft }) => ({
            ok: false,
            status: 'timeout',
            uncertain: true,
            commandId: 'cmd-1',
            error: 'La caja no confirmó la orden a tiempo',
            results: draft.lines.map(line => ({ line, status: 'pending' })),
            applied: [],
            failed: [],
            pending: draft.lines.map(line => ({ line, status: 'pending' })),
        }));

        const confirmButton = await openReviewWithOneLine({ onClose });
        await act(async () => confirmButton.click());

        expect(container.textContent).toContain('La caja aún no confirma el lote');
        expect(onClose).not.toHaveBeenCalled();
    });

    it('optimistic update: reporta los stocks objetivo al iniciar y al completar el envío', async () => {
        const onSubmitting = vi.fn();
        const onCompleted = vi.fn();
        sendSupervisorInventoryBatch.mockResolvedValue({
            ok: true,
            status: 'applied',
            uncertain: false,
            commandId: 'cmd-1',
            results: [],
            applied: [],
            failed: [],
            pending: [],
        });

        const confirmButton = await openReviewWithOneLine({ onSubmitting, onCompleted });
        await act(async () => confirmButton.click());

        const targets = [{ productId: 'p-1', targetStock: 11 }];
        expect(onSubmitting).toHaveBeenCalledWith(targets);
        expect(onCompleted).toHaveBeenCalledWith(expect.objectContaining({ status: 'applied' }), targets);
    });

    it('lote incierto resuelto en segundo plano (applied): muestra el resultado reconciliado en vez de "Revisar estado del lote"', async () => {
        const onCompleted = vi.fn();
        const onClose = vi.fn();
        sendSupervisorInventoryBatch.mockImplementation(async ({ draft }) => ({
            ok: false,
            status: 'timeout',
            uncertain: true,
            commandId: 'cmd-1',
            error: 'La caja no confirmó la orden a tiempo',
            results: draft.lines.map(line => ({ line, status: 'pending' })),
            applied: [],
            failed: [],
            pending: draft.lines.map(line => ({ line, status: 'pending' })),
        }));
        let resolveInspection;
        inspectSupervisorCommandState.mockImplementation(() => new Promise((resolve) => { resolveInspection = resolve; }));

        const confirmButton = await openReviewWithOneLine({ onCompleted, onClose });
        await act(async () => confirmButton.click());
        await flushBackground();

        // Mientras la caja no resuelve, la revisión manual sigue disponible.
        expect(resolveInspection).toBeTypeOf('function');
        expect(container.textContent).toContain('No lo reenvíes');
        expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent.includes('Revisar estado del lote'))).toBe(true);

        // La caja resuelve el comando en segundo plano (lectura sola).
        await act(async () => { resolveInspection({ state: 'terminal', ack: { status: 'applied' } }); });
        await flushBackground();

        // El panel muestra el resultado reconciliado en vez de pedir revisión.
        expect(container.textContent).toContain('Lote reconciliado en segundo plano');
        expect(container.textContent).toContain('1 movimiento confirmado en caja');
        expect(container.textContent).not.toContain('Revisar estado del lote');
        expect(container.querySelector('[data-testid="batch-reconciled-result"]')).toBeTruthy();
        // La vista recibe el mismo resultado reconciliado sobre los mismos targets.
        expect(onCompleted).toHaveBeenCalledTimes(2);
        expect(onCompleted.mock.calls[1][0]).toMatchObject({ ok: true, status: 'applied', commandId: 'cmd-1', uncertain: false });
        expect(onCompleted.mock.calls[1][1]).toEqual([{ productId: 'p-1', targetStock: 11 }]);
        // Conclusión cierta de éxito: solo queda cerrar (sin reenvío posible).
        const closeButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Cerrar'));
        expect(closeButton).toBeTruthy();
        await act(async () => closeButton.click());
        expect(onClose).toHaveBeenCalledTimes(1);

        // El diagnóstico registró la reconciliación por commandId (segundo plano).
        const recorded = getReconciliations().filter(entry => entry.commandId === 'cmd-1');
        expect(recorded[0]).toMatchObject({ source: 'lote', via: 'auto', outcome: 'applied', status: 'applied' });
    });

    it('"Revisar estado del lote" que resuelve el comando queda registrado como reconciliación manual', async () => {
        sendSupervisorInventoryBatch
            .mockImplementationOnce(async ({ draft }) => ({
                ok: false,
                status: 'timeout',
                uncertain: true,
                commandId: 'cmd-man-1',
                error: 'La caja no confirmó la orden a tiempo',
                results: draft.lines.map(line => ({ line, status: 'pending' })),
                applied: [],
                failed: [],
                pending: draft.lines.map(line => ({ line, status: 'pending' })),
            }))
            .mockResolvedValue({
                ok: true,
                status: 'applied',
                uncertain: false,
                commandId: 'cmd-man-1',
                results: [],
                applied: [],
                failed: [],
                pending: [],
            });

        const confirmButton = await openReviewWithOneLine({});
        await act(async () => confirmButton.click());
        expect(container.textContent).toContain('La caja aún no confirma el lote');

        const recheckButton = Array.from(container.querySelectorAll('button')).find(button => button.textContent.includes('Revisar estado del lote'));
        await act(async () => recheckButton.click());
        await flushBackground();

        // La revisión manual resolvió el mismo commandId → aplicado en caja…
        expect(showToast).toHaveBeenCalledWith('1 movimiento confirmado en caja', 'success');
        // …y el diagnóstico lo registra como reconciliación manual del lote.
        const recorded = getReconciliations().filter(entry => entry.commandId === 'cmd-man-1');
        expect(recorded).toHaveLength(1);
        expect(recorded[0]).toMatchObject({ source: 'lote', via: 'manual', outcome: 'applied' });
    });

    it('lote incierto resuelto en segundo plano (expirado): muestra el fallo reconciliado y habilita el reintento', async () => {
        const onCompleted = vi.fn();
        sendSupervisorInventoryBatch.mockImplementation(async ({ draft }) => ({
            ok: false,
            status: 'timeout',
            uncertain: true,
            commandId: 'cmd-1',
            error: 'La caja no confirmó la orden a tiempo',
            results: draft.lines.map(line => ({ line, status: 'pending' })),
            applied: [],
            failed: [],
            pending: draft.lines.map(line => ({ line, status: 'pending' })),
        }));
        let resolveInspection;
        inspectSupervisorCommandState.mockImplementation(() => new Promise((resolve) => { resolveInspection = resolve; }));

        const confirmButton = await openReviewWithOneLine({ onCompleted });
        await act(async () => confirmButton.click());
        await flushBackground();
        await act(async () => { resolveInspection({ state: 'expired' }); });
        await flushBackground();

        expect(container.textContent).toContain('Lote reconciliado en segundo plano');
        expect(container.textContent).toContain('La orden expiró en la caja sin aplicarse');
        expect(container.textContent).toContain('queda pendiente');
        expect(container.textContent).not.toContain('Revisar estado del lote');
        // Conclusión cierta de fallo: nada aplicado, reintento con comando nuevo.
        expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent.includes('Confirmar recepción'))).toBe(true);
        expect(onCompleted).toHaveBeenCalledTimes(2);
        expect(onCompleted.mock.calls[1][0]).toMatchObject({ ok: false, status: 'expired', uncertain: false });
        expect(sendSupervisorInventoryBatch).toHaveBeenCalledTimes(1);
    });

    it('excepción sin commandId: no hay reconciliación en segundo plano y sigue "Revisar estado del lote"', async () => {
        const onCompleted = vi.fn();
        sendSupervisorInventoryBatch.mockRejectedValue(new Error('fallo de red'));

        const confirmButton = await openReviewWithOneLine({ onCompleted });
        await act(async () => confirmButton.click());
        await flushBackground();

        // Sin commandId no hay nada que reconciliar: jamás se consulta el estado.
        expect(inspectSupervisorCommandState).not.toHaveBeenCalled();
        expect(container.textContent).toContain('No se pudo confirmar el lote');
        expect(Array.from(container.querySelectorAll('button')).some(button => button.textContent.includes('Revisar estado del lote'))).toBe(true);
        expect(onCompleted).toHaveBeenCalledTimes(1);
        expect(onCompleted.mock.calls[0][0]).toMatchObject({ uncertain: true });
    });
});
