import { test, expect } from '@playwright/test';
import { neutralizeExternalNetwork } from './helpers/seedBrowserState.js';
import { installCajaSimulada } from './helpers/mockCajaSimulada.js';

/**
 * Supervisor — pestaña Proveedores (piloto del checklist de deploy).
 *
 * Flujo end-to-end contra una CAJA VINCULADA SIMULADA (helpers/mockCajaSimulada.js
 * con opción `ledger`): la caja lleva su estado real de proveedores/facturas,
 * aplica las órdenes con los MISMOS aplicadores puros del receptor
 * (supervisorSupplierCommand, incluidos los rechazos de regla de negocio) y
 * publica el eco por sync_documents (snapshot `bodega_suppliers_v1` + familia
 * `bodega_supplier_invoices_v1:<año>`) que el monitor aplica y el panel renderiza.
 *
 * Cubre: lectura inicial del estado publicado, el indicador de divergencia
 * (deuda publicada ≠ saldo derivado de facturas), alta de proveedor, registro
 * de factura (con la deuda derivada sin divergencia), edición, baja de factura
 * y baja de proveedor — cada uno con su ACK confirmado por la caja.
 *
 * Textos del tracker de comandos (supervisorCommandTracker.buildCommandNotice):
 *   - envío:      '✈️ Cambio enviado a la caja — esperando confirmación: …'
 *   - confirmado: '✅ La caja aplicó tu cambio — …'
 */

async function bootSupervisor(page, ledger) {
    await neutralizeExternalNetwork(page);
    // El auto-backup nunca debe tocar el backend real desde el e2e.
    await page.route('**estacion-2026.vercel.app/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    // Confirmación inmediata: el ACK viaja por Realtime (la lectura final de
    // waitForCommandAck a los 10 s lo cubre como respaldo).
    const caja = await installCajaSimulada(page, { applyAfterMs: 0, ledger });

    await page.addInitScript(() => {
        localStorage.setItem('pda_pairing_mode', 'monitor');
        localStorage.setItem('pda_paired_device_id', 'e2e-primary-device');
        localStorage.setItem('business_name', 'Negocio E2E Sintético');
        localStorage.setItem('pda_terms_accepted', 'true');
        localStorage.setItem('pda_onboarding_done', 'true');
        localStorage.setItem('sounds_enabled', 'false');
    });
    // Los borrados del panel piden confirmación nativa.
    page.on('dialog', (dialog) => dialog.accept());

    await page.goto('/');
    // Vite en frío transforma los chunks del monitor con calma; el fallback
    // "Cargando monitor..." puede durar más que 15 s en la primera pasada.
    await expect(page.getByTestId('supervisor-panel')).toBeVisible({ timeout: 45_000 });
    await page.getByRole('button', { name: 'Proveedores', exact: true }).click();
    await expect(page.getByTestId('supplier-ledger-panel')).toBeVisible();
    return caja;
}

test.describe('Supervisor — pestaña Proveedores (piloto con caja vinculada)', () => {
    // El arranque en frío de Vite varía mucho entre corridas; el flujo en sí
    // corre en segundos. Tope amplio como en supervisor-product-actions.
    test.describe.configure({ timeout: 120_000 });

    test('publica, administra facturas y propaga cada cambio con ACK de la caja', async ({ page }) => {
        const caja = await bootSupervisor(page, {
            suppliers: [
                // Deuda publicada 500 con una sola factura de 100: divergencia 400
                // deliberada para validar el indicador con datos publicados por la caja.
                { id: 'prov-divergente', name: 'Distribuidora La Nube', phone: '0412-0000000', deuda: 500 },
            ],
            invoices: [
                {
                    id: 'inv-seed-1', supplierId: 'prov-divergente', invoiceNumber: 'A-1',
                    amountUsd: 100, date: '2026-10-01T12:00:00.000Z', dueDate: null,
                },
            ],
        });

        // ── Lectura inicial del eco + indicador de divergencia ───────────────
        const seededRow = page.getByTestId('supplier-ledger-row-prov-divergente');
        await expect(seededRow).toBeVisible({ timeout: 15_000 });
        const divergenceBadge = page.getByTestId('supplier-divergence-prov-divergente');
        await expect(divergenceBadge).toBeVisible();
        await expect(divergenceBadge).toContainText('Δ USD 400.00');

        // El detalle ampliado explica ambas cifras.
        await seededRow.locator('button').first().click();
        await expect(page.getByText('Divergencia: la deuda publicada por la caja (USD 500.00)')).toBeVisible();
        await expect(page.getByText('el saldo derivado de las facturas (USD 100.00)')).toBeVisible();

        // ── Alta de proveedor ────────────────────────────────────────────────
        await page.getByRole('button', { name: 'Proveedor', exact: true }).click();
        await page.getByLabel('Nombre').fill('Proveedor Piloto E2E');
        await page.getByRole('button', { name: /Enviar a la caja/ }).click();

        await expect(page.getByText(/✈️ Cambio enviado a la caja — esperando confirmación: el alta de "Proveedor Piloto E2E"/)).toBeVisible({ timeout: 10_000 });
        await expect(page.getByText(/✅ La caja aplicó tu cambio — el alta de "Proveedor Piloto E2E"/)).toBeVisible({ timeout: 20_000 });

        // El eco de la caja trae la fila nueva al panel.
        const newRow = page.getByTestId('supplier-ledger-list').locator('li').filter({ hasText: 'Proveedor Piloto E2E' });
        await expect(newRow).toHaveCount(1, { timeout: 15_000 });

        // ── Registro de factura (la deuda derivada queda sin divergencia) ────
        await newRow.locator('button').first().click();
        await newRow.getByRole('button', { name: 'Factura', exact: true }).click();
        await page.getByLabel('Nº de factura (opcional)').fill('P-001');
        await page.getByLabel('Monto USD').fill('250');
        await page.getByRole('button', { name: /Enviar a la caja/ }).click();

        await expect(page.getByText(/✅ La caja aplicó tu cambio — el registro de factura #P-001/)).toBeVisible({ timeout: 20_000 });

        // La caja la aplicó con su contabilidad real y el panel la refleja.
        expect(caja.ledger().invoices.some((invoice) => invoice.invoiceNumber === 'P-001' && invoice.amountUsd === 250)).toBe(true);
        await expect(newRow).toContainText('1 factura · pendiente USD 250.00', { timeout: 15_000 });
        await expect(newRow).toContainText('USD 250.00');
        // Alta + factura = deuda publicada 250 = saldo derivado 250 → sin badge.
        await expect(newRow.locator('[data-testid^="supplier-divergence-"]')).toHaveCount(0);

        // ── Edición del proveedor ────────────────────────────────────────────
        await newRow.getByRole('button', { name: 'Editar proveedor' }).click();
        await page.getByLabel('Nombre').fill('Proveedor Piloto Editado');
        await page.getByRole('button', { name: /Enviar a la caja/ }).click();

        await expect(page.getByText(/✅ La caja aplicó tu cambio — la edición de "Proveedor Piloto Editado"/)).toBeVisible({ timeout: 20_000 });
        const editedRow = page.getByTestId('supplier-ledger-list').locator('li').filter({ hasText: 'Proveedor Piloto Editado' });
        await expect(editedRow).toHaveCount(1, { timeout: 15_000 });

        // ── Baja de factura de la caja sembrada ───────────────────────────────
        // La caja resta también la factura borrada de SU deuda (contabilidad de
        // useSupplierManagement): deuda 500 → 400 y el saldo derivado cae a 0.
        // La deuda sin respaldo de facturas queda marcada, no se "limpia".
        await seededRow.locator('button').first().click();
        await page.getByRole('button', { name: 'Eliminar factura A-1' }).click();
        await expect(page.getByText(/✅ La caja aplicó tu cambio — la baja de la factura #A-1/)).toBeVisible({ timeout: 20_000 });

        await expect(seededRow).toContainText('Sin facturas registradas', { timeout: 15_000 });
        await expect(divergenceBadge).toContainText('Δ USD 400.00');
        await expect(page.getByText('Divergencia: la deuda publicada por la caja (USD 400.00)')).toBeVisible();
        await expect(page.getByText('el saldo derivado de las facturas (USD 0.00)')).toBeVisible();

        // ── Baja del proveedor ───────────────────────────────────────────────
        await editedRow.locator('button').first().click();
        await editedRow.getByRole('button', { name: 'Eliminar proveedor' }).click();
        await expect(page.getByText(/✅ La caja aplicó tu cambio — la baja de "Proveedor Piloto Editado"/)).toBeVisible({ timeout: 20_000 });
        await expect(page.getByTestId('supplier-ledger-list').locator('li').filter({ hasText: 'Proveedor Piloto Editado' })).toHaveCount(0, { timeout: 15_000 });

        // La caja simulada recibió exactamente el flujo completo, en orden.
        expect(caja.commandTypes()).toEqual([
            'supervisor.supplier.create',
            'supervisor.invoice.create',
            'supervisor.supplier.update',
            'supervisor.invoice.delete',
            'supervisor.supplier.delete',
        ]);
    });
});
