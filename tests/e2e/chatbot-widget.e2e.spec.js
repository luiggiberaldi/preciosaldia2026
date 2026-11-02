import { test, expect } from '@playwright/test';
import {
    SEED_INDEXEDDB_SNIPPET,
    SEED_LOCALSTORAGE_SNIPPET,
    neutralizeExternalNetwork,
} from './helpers/seedBrowserState.js';

/**
 * Widget del asistente (chat bot) con /api/chat simulado:
 *  - el contexto del POS viaja aparte (campo `context`) y el equipo se identifica,
 *  - la tabla markdown de la respuesta se dibuja como tabla,
 *  - los botones útil / no útil guardan el voto una sola vez,
 *  - el administrador ve todas las sugerencias y el área de mensajes es un log accesible.
 */

const TABLE_REPLY = '| Método | Vuelto |\n|---|---|\n| Efectivo | Sí |\n| Pago móvil | No |\n\nSolo el efectivo genera vuelto.';

function sse(text) {
    const chunks = text.match(/[\s\S]{1,24}/g) || [];
    return `${chunks.map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`).join('')}data: [DONE]\n\n`;
}

test.describe('Asistente (chat bot)', () => {
    test.describe.configure({ timeout: 120_000 });

    test('responde con tabla, envía el contexto aparte y guarda el voto', async ({ page }) => {
        await neutralizeExternalNetwork(page);
        await page.addInitScript(SEED_LOCALSTORAGE_SNIPPET);
        await page.addInitScript(SEED_INDEXEDDB_SNIPPET);
        const requests = [];
        await page.route('**/api/chat', async (route) => {
            requests.push({ headers: route.request().headers(), body: route.request().postDataJSON() });
            await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(TABLE_REPLY) });
        });
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/');

        // El botón flotante carga en lazy: dev puede recargar al compilar el chunk.
        const fab = page.getByTitle('Asistente Bot 2.0');
        await fab.waitFor({ state: 'visible', timeout: 60_000 });
        await fab.click();

        await expect(page.getByRole('log', { name: 'Conversación con el asistente' })).toBeVisible();
        // Administrador: ve las sugerencias financieras.
        await expect(page.getByRole('button', { name: 'Cuadre de Hoy' })).toBeVisible();

        await page.getByRole('button', { name: 'Vuelto Cambiario' }).click();

        const table = page.locator('table');
        await expect(table).toBeVisible({ timeout: 15_000 });
        await expect(table.locator('th').first()).toHaveText('Método');
        await expect(table.locator('tbody tr')).toHaveCount(2);

        // Contexto aparte, sin mensajes "system" ni mensaje de contexto dentro del historial.
        expect(requests).toHaveLength(1);
        const { body, headers } = requests[0];
        expect(typeof body.context).toBe('string');
        expect(body.context).toContain('Tasa BCV');
        expect(body.messages.every((m) => m.role === 'user' || m.role === 'assistant')).toBe(true);
        expect(JSON.stringify(body.messages)).not.toContain('CONTEXTO EN TIEMPO REAL');
        const deviceId = await page.evaluate(() => localStorage.getItem('pda_device_id'));
        if (deviceId) expect(headers['x-pda-device-id']).toBe(deviceId);

        // Voto: se registra una vez y los botones quedan bloqueados.
        const up = page.getByRole('button', { name: 'Respuesta útil' });
        await up.click();
        await expect(up).toHaveAttribute('aria-pressed', 'true');
        await expect(up).toBeDisabled();
        await expect(page.getByText('¡Gracias por tu opinión!')).toBeVisible();
        const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('pda_bot_feedback_v1') || '[]'));
        expect(stored).toHaveLength(1);
        expect(stored[0].vote).toBe('up');
    });

    test('un 429 del servidor se muestra como aviso, no como respuesta offline', async ({ page }) => {
        await neutralizeExternalNetwork(page);
        await page.addInitScript(SEED_LOCALSTORAGE_SNIPPET);
        await page.addInitScript(SEED_INDEXEDDB_SNIPPET);
        await page.route('**/api/chat', (route) => route.fulfill({
            status: 429,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'Demasiadas consultas seguidas. Espera un momento e inténtalo de nuevo.' }),
        }));
        await page.setViewportSize({ width: 390, height: 844 });
        await page.goto('/');

        const fab = page.getByTitle('Asistente Bot 2.0');
        await fab.waitFor({ state: 'visible', timeout: 60_000 });
        await fab.click();
        await page.getByRole('button', { name: 'Vuelto Cambiario' }).click();

        await expect(page.getByText('Demasiadas consultas seguidas')).toBeVisible({ timeout: 15_000 });
        await expect(page.getByText('Modo Local Offline')).toHaveCount(0);
    });
});
