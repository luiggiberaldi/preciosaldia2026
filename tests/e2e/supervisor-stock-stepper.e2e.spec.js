import { test, expect } from '@playwright/test';
import { neutralizeExternalNetwork, SEED_INDEXEDDB_SNIPPET } from './helpers/seedBrowserState.js';
import { installCajaSimulada } from './helpers/mockCajaSimulada.js';

/**
 * Supervisor › Inventario: botones + / − y edición directa del stock contra una
 * CAJA SIMULADA. Cubre un producto por unidad y un granel moderno (solo
 * `packagingType: 'granel'`, sin la marca legacy `isWeight`): antes se mostraba
 * en «u» y el − redondeaba 5.6 a 5.
 */

const GRANEL_SIN_ISWEIGHT = {
    id: 'p_especias', name: 'Especias E2E', category: 'abastos', stock: 5.6,
    costUsd: 1.2, priceUsd: 1.9, priceUsdt: 1.9, packagingType: 'granel', unit: 'gramo', granelUnit: 'kg',
    sellByUnit: true, unitsPerPackage: 1, barcode: 'E2EESPE1',
};

async function bootInventory(page) {
    await neutralizeExternalNetwork(page);
    await page.route('**estacion-2026.vercel.app/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    const caja = await installCajaSimulada(page, { applyAfterMs: 0 });
    await page.addInitScript((extra) => { window.__E2E_EXTRA_PRODUCTS = [extra]; }, GRANEL_SIN_ISWEIGHT);
    await page.addInitScript(SEED_INDEXEDDB_SNIPPET);
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
    return caja;
}

const batchLines = (caja) => caja.received
    .filter((row) => row.command_type === 'supervisor.inventory.batch.adjust')
    .map((row) => ({ direction: row.payload.direction, ...row.payload.lines[0] }));

test.describe('Supervisor › Inventario + / −', () => {
    test.describe.configure({ timeout: 90_000 });

    test('producto por unidad: + sube 1 y la caja recibe un ingreso de 1', async ({ page }) => {
        const caja = await bootInventory(page);
        const row = page.locator('[data-testid^="supervisor-product-row-"]').filter({ hasText: 'Harina E2E' }).first();
        await row.getByRole('button', { name: 'Subir stock de Harina E2E' }).first().click();
        await expect(row.getByText('31 u').first()).toBeVisible();
        await row.getByRole('button', { name: /Confirmar cambio/ }).first().click();
        await expect.poll(() => batchLines(caja).length, { timeout: 15_000 }).toBe(1);
        expect(batchLines(caja)[0]).toMatchObject({ direction: 'ingreso', productId: 'p_harina', quantityInput: 1, expectedStock: 30 });
    });

    test('granel sin isWeight: se muestra en kg, − baja 1 kg sin redondear y la edición acepta decimales', async ({ page }) => {
        const caja = await bootInventory(page);
        const row = page.locator('[data-testid^="supervisor-product-row-"]').filter({ hasText: 'Especias E2E' }).first();
        await expect(row.getByText('5.6 kg').first()).toBeVisible();

        await row.getByRole('button', { name: 'Bajar stock de Especias E2E' }).first().click();
        await expect(row.getByText('4.6 kg').first()).toBeVisible();
        await row.getByRole('button', { name: /Confirmar cambio/ }).first().click();
        await expect.poll(() => batchLines(caja).length, { timeout: 15_000 }).toBe(1);
        const [egreso] = batchLines(caja);
        expect(egreso).toMatchObject({ direction: 'egreso', productId: 'p_especias', expectedStock: 5.6 });
        expect(egreso.quantityInput).toBeCloseTo(1, 3);
    });

    test('granel sin isWeight: escribir 5.25 a mano se acepta (antes exigía entero)', async ({ page }) => {
        const caja = await bootInventory(page);
        const row = page.locator('[data-testid^="supervisor-product-row-"]').filter({ hasText: 'Especias E2E' }).first();
        await row.getByRole('button', { name: 'Editar stock de Especias E2E' }).first().click();
        await row.getByLabel('Nuevo stock de Especias E2E').first().fill('5.25');
        await row.getByRole('button', { name: 'Confirmar nuevo stock' }).first().click();
        await expect(row.getByText('5.25 kg').first()).toBeVisible();
        await row.getByRole('button', { name: /Confirmar cambio/ }).first().click();
        await expect.poll(() => batchLines(caja).length, { timeout: 15_000 }).toBe(1);
        const [egreso] = batchLines(caja);
        expect(egreso).toMatchObject({ direction: 'egreso', productId: 'p_especias' });
        expect(egreso.quantityInput).toBeCloseTo(0.35, 3);
    });
});
