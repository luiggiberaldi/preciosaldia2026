// @vitest-environment jsdom

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import RemoteProductFormModal from '../src/components/Monitor/RemoteProductFormModal';
import { showToast } from '../src/components/Toast';

vi.mock('../src/components/Toast', () => ({ showToast: vi.fn() }));
vi.mock('../src/services/supervisorCommandService', () => ({ sendSupervisorCommand: vi.fn() }));
vi.mock('../src/config/supervisorPolicy', () => ({ SUPERVISOR_REMOTE_PRODUCTS_ENABLED: true }));
vi.mock('../src/context/ProductContext', () => ({
    useProductContext: () => ({
        categories: ['General'],
        effectiveRate: 36,
        copEnabled: false,
        copPrimary: false,
        tasaCop: 0,
    }),
}));

describe('RemoteProductFormModal (IVA e imagen)', () => {
    let container;
    let root;

    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        showToast.mockReset();
    });

    afterEach(() => {
        act(() => root.unmount());
        container.remove();
    });

    function render() {
        return act(async () => root.render(
            <RemoteProductFormModal isOpen onClose={() => {}} targetDeviceId="device-1" remoteAvailable />,
        ));
    }

    function buttonByText(text) {
        return Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes(text));
    }

    it('muestra el selector de IVA y permite marcar el producto como exento sin lanzar error', async () => {
        await render();
        const exento = buttonByText('Exento');
        expect(exento).toBeTruthy();
        const errors = [];
        const onError = (event) => errors.push(event.error || event.message);
        window.addEventListener('error', onError);
        const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
            await act(async () => exento.click());
        } finally {
            window.removeEventListener('error', onError);
            consoleError.mockRestore();
        }
        expect(errors.map(String).join(' ')).not.toMatch(/setIvaMode is not a function/);
        expect(container.textContent).toContain('IVA del Producto');
    });

    it('no envía una URL remota de imagen en el patch de edición', async () => {
        const { sendSupervisorCommand } = await import('../src/services/supervisorCommandService');
        sendSupervisorCommand.mockResolvedValue({ ok: false, error: 'stop' });
        const product = { id: 'p-9', name: 'Arroz', priceUsd: 2, stock: 5, image: 'https://example.com/remota.jpg', updatedAt: '2026-10-01T00:00:00.000Z' };
        await act(async () => root.render(
            <RemoteProductFormModal isOpen onClose={() => {}} targetDeviceId="device-1" productToEdit={product} remoteAvailable />,
        ));
        await act(async () => buttonByText('Guardar en Caja').click());
        expect(sendSupervisorCommand).toHaveBeenCalledTimes(1);
        const { payload } = sendSupervisorCommand.mock.calls[0][0];
        expect(payload.patch).not.toHaveProperty('image');
    });

    it('rechaza una imagen que supera el límite antes de convertirla a data URL', async () => {
        await render();
        const input = container.querySelector('input[type="file"]');
        const big = new File([new Uint8Array(3 * 1024 * 1024)], 'grande.png', { type: 'image/png' });
        Object.defineProperty(input, 'files', { value: [big] });
        await act(async () => input.dispatchEvent(new Event('change', { bubbles: true })));
        expect(showToast).toHaveBeenCalledWith(expect.stringMatching(/MB/), 'warning');
    });
});
