import { test, expect } from '@playwright/test';
import {
    SEED_INDEXEDDB_SNIPPET,
    SEED_LOCALSTORAGE_SNIPPET,
    neutralizeExternalNetwork,
} from './helpers/seedBrowserState.js';
import { installCajaSimulada } from './helpers/mockCajaSimulada.js';

/**
 * Regla costo fijo del trío costo / precio / margen (auditoría 2026-10-28):
 *   - cambiar el margen recalcula el PRECIO, nunca el costo
 *   - cambiar el precio recalcula el MARGEN, nunca el costo
 *   - cambiar el costo mantiene el margen y recalcula el precio
 * Antes, al editar un producto existente, cambiar el margen o el precio
 * reescribía el costo (la regla "los 2 últimos editados" no sabía el orden).
 * Se prueba en la caja (producto sembrado) y en el supervisor (alta remota).
 */

const costInput = (page) => page.locator('input[placeholder="1.00"]').first();
const priceInput = (page) => page.locator('input[placeholder="1.50"]').first();
const marginInput = (page) => page.getByLabel('Factor costo');

async function readProduct(page, name) {
    return page.evaluate(async (productName) => {
        const request = indexedDB.open('BodegaApp');
        const db = await new Promise((resolve, reject) => {
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
        const products = await new Promise((resolve, reject) => {
            const tx = db.transaction('bodega_app_data', 'readonly');
            const get = tx.objectStore('bodega_app_data').get('bodega_products_v1');
            get.onsuccess = () => resolve(get.result || []);
            get.onerror = () => reject(get.error);
        });
        db.close();
        return products.find((p) => p.name === productName) || null;
    }, name);
}

test.describe('costo fijo al editar margen y precio', () => {
    test.describe.configure({ timeout: 120_000 });

    test('caja: el margen y el precio nunca reescriben el costo de un producto existente', async ({ page }) => {
        await neutralizeExternalNetwork(page);
        await page.addInitScript(SEED_LOCALSTORAGE_SNIPPET);
        await page.addInitScript(SEED_INDEXEDDB_SNIPPET);
        await page.setViewportSize({ width: 360, height: 740 });
        await page.goto('/');

        // Inventario es lazy: en dev su chunk compila al primer acceso y vite
        // puede recargar la página; re-pulsar la pestaña absorbe eso (mismo
        // patrón que auditoria-flujos).
        const search = () => page.locator('input[placeholder="Buscar producto..."]:visible').first();
        for (let intento = 1; intento <= 4; intento++) {
            await page.locator('[data-tour="tab-catalogo"]').click();
            try {
                await search().waitFor({ state: 'visible', timeout: 20_000 });
                break;
            } catch (error) {
                if (intento === 4) throw error;
            }
        }
        // Harina E2E sembrada: costo 0.50, precio 1.00 → 50 % de margen.
        await search().fill('Harina E2E');
        // La tarjeta expone [Imprimir | Editar | Eliminar].
        await page.locator('button[title="Imprimir Etiqueta"]').first()
            .locator('xpath=following-sibling::button[1]').click();

        await expect(marginInput(page)).toHaveValue('50');
        await expect(costInput(page)).toHaveValue('0.50');

        // A: margen 50 → 40 % → precio 0.50 / 0.60 = 0.83; el costo no se mueve.
        await marginInput(page).fill('40');
        await expect(priceInput(page)).toHaveValue('0.83');
        await expect(costInput(page)).toHaveValue('0.50');

        // B: precio → 1.25 → margen 60 %; el costo no se mueve.
        await priceInput(page).fill('1.25');
        await marginInput(page).blur();
        await expect(marginInput(page)).toHaveValue('60');
        await expect(costInput(page)).toHaveValue('0.50');

        // C: costo → 0.60 → conserva el 60 % → precio 1.50.
        await costInput(page).fill('0.60');
        await expect(priceInput(page)).toHaveValue('1.50');
        await expect(marginInput(page)).toHaveValue('60');

        await page.getByRole('button', { name: /Actualizar Producto/ }).click();
        await expect.poll(async () => {
            const saved = await readProduct(page, 'Harina E2E');
            return saved && { cost: saved.costUsd, price: saved.priceUsdt, factor: saved.costFactor };
        }, { timeout: 10_000 }).toEqual({ cost: 0.6, price: 1.5, factor: 0.4 });
    });

    test('supervisor: alta remota con costo + margen → precio, y el margen no toca el costo', async ({ page }) => {
        await neutralizeExternalNetwork(page);
        await page.route('**estacion-2026.vercel.app/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
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
        await page.getByRole('button', { name: 'Inventario', exact: true }).click();
        await page.getByRole('button', { name: 'Nuevo producto', exact: true }).click();

        await page.getByPlaceholder('Ej: Harina PAN 1kg').fill('Cigarro Capi E2E');
        // E: costo 0.60 + margen 40 % → precio 1.00.
        await costInput(page).fill('0.60');
        await marginInput(page).fill('40');
        await expect(priceInput(page)).toHaveValue('1.00');
        // J: margen 40 → 50 % → precio 1.20; el costo sigue en 0.60.
        await marginInput(page).fill('50');
        await expect(priceInput(page)).toHaveValue('1.20');
        await expect(costInput(page)).toHaveValue('0.60');
        // K: precio → 1.50 → margen 60 %; el costo sigue en 0.60.
        await priceInput(page).fill('1.50');
        await marginInput(page).blur();
        await expect(marginInput(page)).toHaveValue('60');
        await expect(costInput(page)).toHaveValue('0.60');

        await page.getByRole('button', { name: /Guardar en Caja/ }).click();
        await expect(page.getByText(/✅ La caja aplicó tu cambio — el alta de/)).toBeVisible({ timeout: 20_000 });
        const sent = caja.received.find((row) => row.command_type === 'supervisor.product.create');
        const product = sent?.payload?.product || sent?.payload;
        expect({ cost: product.costUsd, price: product.priceUsdt ?? product.priceUsd, factor: product.costFactor })
            .toEqual({ cost: 0.6, price: 1.5, factor: 0.4 });
    });
});
