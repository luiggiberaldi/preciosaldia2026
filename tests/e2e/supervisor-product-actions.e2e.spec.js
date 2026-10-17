import { test, expect } from '@playwright/test';

const e2eEnabled = process.env.SUPERVISOR_E2E_ENABLED === 'true';
const e2eBaseUrl = process.env.SUPERVISOR_E2E_BASE_URL || '';

function requireSafeE2EEnvironment() {
    test.skip(!e2eEnabled, 'Define SUPERVISOR_E2E_ENABLED=true para ejecutar el E2E contra una caja controlada.');
    test.skip(
        !e2eBaseUrl || (!/staging|localhost|127\.0\.0\.1/.test(e2eBaseUrl)
            && process.env.SUPERVISOR_E2E_ALLOW_VERCEL_PREVIEW !== 'true'),
        'El E2E exige localhost, staging o Preview Vercel autorizado.'
    );
}

async function bootSupervisor(page) {
    await page.addInitScript(() => {
        localStorage.setItem('pda_pairing_mode', 'monitor');
        localStorage.setItem('pda_paired_device_id', 'e2e-primary-device');
        localStorage.setItem('business_name', 'Negocio E2E Sintético');
    });
    await page.goto('/');
    await expect(page.getByTestId('supervisor-panel')).toBeVisible({ timeout: 15_000 });
}

test.describe('Supervisor acciones de productos', () => {
    test('crea y edita un producto con confirmación de la caja', async ({ page }) => {
        requireSafeE2EEnvironment();
        await bootSupervisor(page);
        await page.getByRole('button', { name: 'Inventario', exact: true }).click();

        const productName = `Producto E2E ${Date.now()}`;
        await page.getByRole('button', { name: 'Nuevo producto', exact: true }).click();
        await page.getByPlaceholder('Ej: Harina PAN 1kg').fill(productName);
        await page.locator('input[placeholder="1.50"]').fill('2.50');
        await page.getByRole('button', { name: /Guardar en Caja/ }).click();

        await expect(page.getByText(/Producto creado en la caja|La caja no confirmó la orden/)).toBeVisible({ timeout: 20_000 });
        await expect(page.getByText(productName, { exact: false })).toBeVisible({ timeout: 20_000 });

        const productRow = page.locator('[data-testid^="supervisor-product-row-"]').filter({ hasText: productName }).first();
        await productRow.getByTitle('Editar Producto Remotamente').click();
        await page.getByPlaceholder('Ej: Harina PAN 1kg').fill(`${productName} Editado`);
        await page.getByRole('button', { name: /Guardar en Caja/ }).click();

        await expect(page.getByText(/Edición confirmada en la caja|La caja no confirmó la orden/)).toBeVisible({ timeout: 20_000 });
    });
});
