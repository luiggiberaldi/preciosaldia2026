// @vitest-environment jsdom

// ── Propuesta 5: la cola local a la vista, con mando del usuario ───────────
// Aviso abajo con el contador honesto, SUBIR AL SISTEMA (forzar envío) y
// DESCARTAR (con confirmación explícita que explica qué se pierde). La cola
// nunca se descarta sola. ANULAR TODOS (propuesta 6) solo aparece cuando hay
// cambios esperando a la caja.

import React from 'react';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import LocalQueueBanner from '../src/components/Monitor/LocalQueueBanner';

const buttonWith = (container, text) => Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes(text));

describe('LocalQueueBanner (cola local con mando)', () => {
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
    });

    const render = async (props) => act(async () => root.render(<LocalQueueBanner {...props} />));

    it('0 pendientes → sin banner', async () => {
        await render({ queueCount: 0, pendingCount: 0, onUpload: vi.fn(), onDiscard: vi.fn() });
        expect(container.querySelector('[data-testid="local-queue-banner"]')).toBeNull();
    });

    it('3 cambios en cola → contador honesto y los mandos', async () => {
        await render({ queueCount: 3, isOnline: true, onUpload: vi.fn(), onDiscard: vi.fn() });
        const banner = container.querySelector('[data-testid="local-queue-banner"]');
        expect(banner).toBeTruthy();
        expect(banner.textContent).toContain('3 cambios en cola');
        expect(banner.textContent).toContain('Aún no se han enviado a la caja');
        expect(banner.textContent).not.toContain('cuando vuelva la conexión');
        expect(buttonWith(container, 'SUBIR AL SISTEMA')).toBeTruthy();
        expect(buttonWith(container, 'DESCARTAR')).toBeTruthy();
    });

    it('sin conexión lo dice y promete el reintento automático', async () => {
        await render({ queueCount: 1, isOnline: false, onUpload: vi.fn(), onDiscard: vi.fn() });
        expect(container.textContent).toContain('1 cambio en cola');
        expect(container.textContent).toContain('Se subirán solos cuando vuelva la conexión');
    });

    it('SUBIR AL SISTEMA llama a onUpload (el padre decide cómo enviar)', async () => {
        const onUpload = vi.fn();
        await render({ queueCount: 2, onUpload, onDiscard: vi.fn() });
        await act(async () => buttonWith(container, 'SUBIR AL SISTEMA').click());
        expect(onUpload).toHaveBeenCalledTimes(1);
    });

    it('DESCARTAR pide confirmación que explica qué se pierde y no descarta sin confirmar', async () => {
        const onDiscard = vi.fn();
        await render({ queueCount: 2, onUpload: vi.fn(), onDiscard });

        await act(async () => buttonWith(container, 'DESCARTAR').click());
        expect(container.textContent).toContain('Se descartarán 2 cambios que nunca llegaron a la caja');
        expect(onDiscard).not.toHaveBeenCalled();

        await act(async () => buttonWith(container, 'Seguir en cola').click());
        expect(onDiscard).not.toHaveBeenCalled();

        await act(async () => buttonWith(container, 'DESCARTAR').click());
        await act(async () => buttonWith(container, 'Descartar cambios').click());
        expect(onDiscard).toHaveBeenCalledTimes(1);
    });

    it('ANULAR TODOS solo aparece con cambios esperando a la caja y también confirma', async () => {
        const onCancelAll = vi.fn();
        await render({ queueCount: 1, pendingCount: 0, onUpload: vi.fn(), onDiscard: vi.fn(), onCancelAll });
        expect(buttonWith(container, 'ANULAR TODOS')).toBeUndefined();

        await render({ queueCount: 1, pendingCount: 3, onUpload: vi.fn(), onDiscard: vi.fn(), onCancelAll });
        expect(container.textContent).toContain('3 esperando a la caja');
        await act(async () => buttonWith(container, 'ANULAR TODOS').click());
        expect(container.textContent).toContain('aún no ha tomado');
        expect(onCancelAll).not.toHaveBeenCalled();
        await act(async () => buttonWith(container, 'Anular todos').click());
        expect(onCancelAll).toHaveBeenCalledTimes(1);
    });

    it('los modales viven FUERA del wrapper pointer-events-none y reactivan el tacto', async () => {
        // jsdom ignora el hit-testing de CSS (`.click()` siempre dispara), así
        // que se guarda la ESTRUCTURA: un modal dentro del wrapper
        // `pointer-events-none` hereda taps muertos en navegadores reales y el
        // usuario queda atrapado sin poder confirmar, cancelar ni cerrar.
        await render({ queueCount: 1, pendingCount: 1, onUpload: vi.fn(), onDiscard: vi.fn(), onCancelAll: vi.fn() });
        await act(async () => buttonWith(container, 'DESCARTAR').click());

        const banner = container.querySelector('[data-testid="local-queue-banner"]');
        expect(banner.className).toContain('pointer-events-none');

        const modalRoot = buttonWith(container, 'Descartar cambios').closest('div.fixed');
        expect(modalRoot).toBeTruthy();
        // El modal re-activa el tacto por si un padre apaga pointer-events.
        expect(modalRoot.className).toContain('pointer-events-auto');
        // Y no es descendiente del wrapper que lo apaga.
        expect(banner.contains(modalRoot)).toBe(false);
    });

    it('SUBIR AL SISTEMA usa colores que existen en el tema', async () => {
        // El tema (tailwind.config.js) no define la paleta `primary`: esas
        // utilidades compilan a nada y el botón blanco sobre blanco queda
        // invisible (texto blanco sin fondo). Bug real visto en móvil.
        await render({ queueCount: 1, onUpload: vi.fn(), onDiscard: vi.fn() });
        const upload = buttonWith(container, 'SUBIR AL SISTEMA');
        expect(upload.className).not.toMatch(/\bbg-primary-/);
        expect(upload.className).toMatch(/\bbg-emerald-600\b/);
    });
});
