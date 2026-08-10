import { test, expect } from '@playwright/test';

const e2eEnabled = process.env.SUPERVISOR_E2E_ENABLED === 'true';
const e2eBaseUrl = process.env.SUPERVISOR_E2E_BASE_URL || '';

function requireSafeE2EEnvironment() {
    test.skip(!e2eEnabled, 'Define SUPERVISOR_E2E_ENABLED=true para ejecutar E2E contra staging controlado.');
    test.skip(!e2eBaseUrl || !/staging|localhost|127\.0\.0\.1/.test(e2eBaseUrl), 'El E2E exige una URL localhost o staging explícita.');
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

test.describe('Supervisor lectura segura', () => {
    test('recorre las pestañas sin habilitar mutaciones', async ({ page }) => {
        requireSafeE2EEnvironment();
        await bootSupervisor(page);

        for (const tab of ['Cierres', 'Inventario', 'Reportes', 'Terminales', 'Cajeros']) {
            await page.getByRole('button', { name: tab, exact: true }).click();
            await expect(page.getByTestId('supervisor-panel')).toBeVisible({ timeout: 15_000 });
        }

        await expect(page.getByText(/mutaciones remotas/i)).toHaveCount(0);
    });
});
