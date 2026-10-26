import { test, expect } from '@playwright/test';
import { neutralizeExternalNetwork } from './helpers/seedBrowserState.js';
import { installCajaSimulada } from './helpers/mockCajaSimulada.js';

/**
 * Supervisor acciones de productos — crea y edita un producto de punta a punta
 * contra una CAJA SIMULADA (helpers/mockCajaSimulada.js): no hace falta ningún
 * POS real, staging ni credenciales. El transporte Supabase se intercepta y la
 * caja simulada recibe los comandos y los confirma con ACK aplicado.
 *
 * Los textos afirmados son los vigentes del tracker de comandos
 * (supervisorCommandTracker.buildCommandNotice):
 *   - envío:      '✈️ Cambio enviado a la caja — esperando confirmación: …'
 *   - confirmado: '✅ La caja aplicó tu cambio — …'
 * Los textos viejos ('Producto creado en la caja', 'Edición confirmada en la
 * caja', 'La caja no confirmó la orden') ya no existen en la UI.
 */

async function bootSupervisor(page) {
    await neutralizeExternalNetwork(page);
    // El auto-backup nunca debe tocar el backend real desde el e2e.
    await page.route('**estacion-2026.vercel.app/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    // Confirmación inmediata: el ACK también viaja por Realtime (y la lectura
    // final de waitForCommandAck a los 10 s lo cubre como respaldo), así el
    // flujo completo corre sin esperas largas.
    const caja = await installCajaSimulada(page, { applyAfterMs: 0 });

    await page.addInitScript(() => {
        localStorage.setItem('pda_pairing_mode', 'monitor');
        localStorage.setItem('pda_paired_device_id', 'e2e-primary-device');
        localStorage.setItem('business_name', 'Negocio E2E Sintético');
        localStorage.setItem('pda_terms_accepted', 'true');
        localStorage.setItem('pda_onboarding_done', 'true');
        localStorage.setItem('sounds_enabled', 'false');
    });
    await page.goto('/');
    await expect(page.getByTestId('supervisor-panel')).toBeVisible({ timeout: 15_000 });
    return caja;
}

test.describe('Supervisor acciones de productos', () => {
    // El arranque en frío de Vite varía mucho entre corridas; el flujo en sí
    // corre en segundos. Tope amplio como en supervisor-m3 para no flotar.
    test.describe.configure({ timeout: 90_000 });

    test('crea y edita un producto con confirmación de la caja simulada', async ({ page }) => {
        const caja = await bootSupervisor(page);
        await page.getByRole('button', { name: 'Inventario', exact: true }).click();

        // ── Alta de producto ────────────────────────────────────────────────
        const productName = `Producto E2E ${Date.now()}`;
        await page.getByRole('button', { name: 'Nuevo producto', exact: true }).click();
        await page.getByPlaceholder('Ej: Harina PAN 1kg').fill(productName);
        await page.locator('input[placeholder="1.50"]').fill('2.50');
        await page.getByRole('button', { name: /Guardar en Caja/ }).click();

        await expect(page.getByText(/✈️ Cambio enviado a la caja — esperando confirmación: el alta de/)).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/✅ La caja aplicó tu cambio — el alta de/)).toBeVisible({ timeout: 20_000 });

        const productRow = page.locator('[data-testid^="supervisor-product-row-"]').filter({ hasText: productName }).first();
        await expect(productRow).toBeVisible({ timeout: 10_000 });

        // ── Edición del producto ────────────────────────────────────────────
        // La fila expone dos variantes (compacta y ancha) del mismo botón.
        await productRow.getByTitle('Editar Producto Remotamente').first().click();
        await page.getByPlaceholder('Ej: Harina PAN 1kg').fill(`${productName} Editado`);
        await page.getByRole('button', { name: /Guardar en Caja/ }).click();

        await expect(page.getByText(/✈️ Cambio enviado a la caja — esperando confirmación: la edición de/)).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/✅ La caja aplicó tu cambio — la edición de/)).toBeVisible({ timeout: 20_000 });

        // La fila refleja el cambio una vez confirmado.
        await expect(
            page.locator('[data-testid^="supervisor-product-row-"]').filter({ hasText: `${productName} Editado` }).first(),
        ).toBeVisible({ timeout: 10_000 });

        // La caja simulada recibió exactamente el alta y la edición.
        expect(caja.commandTypes()).toEqual(['supervisor.product.create', 'supervisor.product.update']);
    });
});
