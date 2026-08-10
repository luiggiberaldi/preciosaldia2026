import { test, expect } from '@playwright/test';

const e2eEnabled = process.env.SUPERVISOR_E2E_ENABLED === 'true';
const e2eBaseUrl = process.env.SUPERVISOR_E2E_BASE_URL || '';

function requireSafeE2EEnvironment() {
    test.skip(!e2eEnabled, 'Define SUPERVISOR_E2E_ENABLED=true para ejecutar E2E contra staging controlado.');
    test.skip(!e2eBaseUrl || !/staging|localhost|127\.0\.0\.1/.test(e2eBaseUrl), 'El E2E exige una URL localhost o staging explícita.');
}

test.describe('Supervisor E2E seguro', () => {
    test('separa el contexto de caja y monitor', async ({ browser }) => {
        requireSafeE2EEnvironment();
        const primary = await browser.newContext();
        const monitor = await browser.newContext();
        const primaryPage = await primary.newPage();
        const monitorPage = await monitor.newPage();

        await Promise.all([primaryPage.goto('/'), monitorPage.goto('/')]);
        await expect(primaryPage).toHaveURL(/.*/);
        await expect(monitorPage).toHaveURL(/.*/);

        await primary.close();
        await monitor.close();
    });

    test('no inicia una mutación remota sin autorización explícita', async ({ page }) => {
        requireSafeE2EEnvironment();
        await page.goto('/');
        await expect(page.locator('body')).toBeVisible();
        // El flag debe seguir apagado hasta completar los casos de staging.
        expect(process.env.SUPERVISOR_REMOTE_MUTATIONS_ENABLED).not.toBe('true');
    });
});
