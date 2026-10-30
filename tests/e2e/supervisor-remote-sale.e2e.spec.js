import { test, expect } from '@playwright/test';
import { neutralizeExternalNetwork, SEED_INDEXEDDB_SNIPPET } from './helpers/seedBrowserState.js';
import { installCajaSimulada } from './helpers/mockCajaSimulada.js';

/**
 * H6 — Supervisor › Vender (supervisor.sale.create) contra una CAJA SIMULADA
 * que decide con el MISMO planRemoteSale del receptor real.
 *
 * Cubre: venta feliz con número de la caja, precio cambiado en la caja
 * (rechazo con el total nuevo), caja cerrada (rechazo) y caja que no toma la
 * orden (cancelación: la venta NO se registra).
 */

// Catálogo de la caja (autoritativo) = mismo que siembra SEED_INDEXEDDB_SNIPPET
// en el monitor: Harina E2E USD 1.00, Cafe E2E USD 2.00.
const CAJA_PRODUCTS = [
    { id: 'p_cafe', name: 'Cafe E2E', stock: 50, costUsd: 1, priceUsd: 2, priceUsdt: 2 },
    { id: 'p_harina', name: 'Harina E2E', stock: 30, costUsd: 0.5, priceUsd: 1, priceUsdt: 1 },
];
const OPEN_SHIFT = { id: 'ap', tipo: 'APERTURA_CAJA', timestamp: '2026-01-01T08:00:00.000Z', cajaCerrada: false };
const METHODS = [
    { id: 'efectivo_usd', label: 'Efectivo en Dólares', currency: 'USD' },
    { id: 'efectivo_bs', label: 'Efectivo en Bolívares', currency: 'BS' },
    { id: 'pago_movil', label: 'Pago Móvil', currency: 'BS' },
    { id: 'punto_venta', label: 'Punto de Venta', currency: 'BS' },
];

async function bootSeller(page, saleCaja, monitorStorage = {}) {
    await neutralizeExternalNetwork(page);
    await page.route('**estacion-2026.vercel.app/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }));
    const caja = await installCajaSimulada(page, { applyAfterMs: 0, saleCaja });
    await page.addInitScript(SEED_INDEXEDDB_SNIPPET);
    await page.addInitScript(() => {
        localStorage.setItem('pda_pairing_mode', 'monitor');
        localStorage.setItem('pda_paired_device_id', 'e2e-primary-device');
        localStorage.setItem('business_name', 'Negocio E2E Sintético');
        localStorage.setItem('pda_terms_accepted', 'true');
        localStorage.setItem('pda_onboarding_done', 'true');
        localStorage.setItem('sounds_enabled', 'false');
        localStorage.setItem('bodega_rate_mode', 'manual');
        localStorage.setItem('bodega_custom_rate', '40');
        localStorage.setItem('bodega_use_auto_rate', 'false');
        localStorage.setItem('checkout_mode', 'basic');
    });
    await page.addInitScript((extra) => {
        for (const [key, value] of Object.entries(extra)) localStorage.setItem(key, value);
    }, monitorStorage);
    await page.goto('/');
    await expect(page.getByTestId('supervisor-panel')).toBeVisible({ timeout: 15_000 });
    await page.getByTestId('supervisor-tab-vender').click();
    await expect(page.getByTestId('remote-sale-panel')).toBeVisible();
    return caja;
}

async function setSellerAndCart(page) {
    await page.getByLabel('Nombre del vendedor').fill('Tienda 2 - María');
    await page.getByRole('button', { name: 'Guardar' }).click();
    // Mismo flujo que la caja: buscar, tocar el resultado y sumar en la cesta.
    await page.getByPlaceholder('Buscar producto...').fill('Harina E2E');
    await page.getByTestId('search-results-scroll-container').getByRole('button', { name: /Harina E2E/ }).click();
    const cart = await openCart(page);
    await cart.getByRole('button', { name: 'Agregar uno' }).locator('visible=true').click();
    await expect(cart.getByLabel('Cantidad de Harina E2E').locator('visible=true')).toHaveText('2');
}

/** Cesta visible: columna derecha en escritorio, hoja inferior en móvil. */
async function openCart(page) {
    const fab = page.getByRole('button', { name: /Ver Cesta/ });
    if (await fab.isVisible().catch(() => false)) await fab.click();
    return page.getByTestId('remote-sale-panel');
}

async function payInFull(page) {
    const cart = await openCart(page);
    await cart.getByRole('button', { name: /^COBRAR/ }).locator('visible=true').click();
    // El cobro se adapta a la pantalla: PC → modo POS («Procesar Pago»);
    // móvil → modo básico («COBRAR»).
    const pos = page.getByText('Procesar Pago').first();
    const basic = page.getByRole('heading', { name: 'COBRAR' });
    await expect(pos.or(basic)).toBeVisible();
    if (await pos.isVisible()) {
        await page.getByTitle('Llenar saldo restante').first().click();
        const pagar = page.getByRole('button', { name: /PAGAR \(LISTO\)|CONFIRMA EL CAMBIO/ });
        await expect(pagar).toBeEnabled();
        await pagar.click();
    } else {
        await page.getByRole('button', { name: /Total/ }).first().click();
        const confirm = page.getByRole('button', { name: /CONFIRMAR VENTA|CONFIRMA EL CAMBIO/ });
        await expect(confirm).toBeEnabled();
        await confirm.click();
    }
    const distribution = page.getByRole('button', { name: 'Confirmar venta', exact: true });
    if (await distribution.isVisible().catch(() => false)) await distribution.click();
}

test.describe('Supervisor › Vender (venta remota)', () => {
    test.describe.configure({ timeout: 120_000 });

    test('venta de contado: la caja la registra y el vendedor ve el número', async ({ page }) => {
        const caja = await bootSeller(page, { products: CAJA_PRODUCTS, sales: [OPEN_SHIFT], paymentMethods: METHODS });
        await setSellerAndCart(page);
        await payInFull(page);

        const status = page.getByTestId('remote-sale-status');
        await expect(status).toContainText('Venta #1 registrada en la caja principal', { timeout: 20_000 });
        await expect(page.getByRole('button', { name: /Imprimir ticket/ })).toBeVisible();

        const sent = caja.received.find((row) => row.command_type === 'supervisor.sale.create');
        expect(sent.payload).toMatchObject({
            v: 1,
            seller: { name: 'Tienda 2 - María' },
            items: [{ productId: 'p_harina', mode: 'package', qty: 2, priceUsdSeen: 1 }],
            totalsSeen: { totalUsd: 2, totalBs: 80 },
        });
        expect(caja.sales()[0]).toMatchObject({ saleNumber: 1, totalUsd: 2, remoteSale: { sellerName: 'Tienda 2 - María' } });
        // El carrito se vacía tras registrar.
        await page.getByRole('button', { name: 'Nueva venta' }).click();
        await expect(page.getByText('Tu cesta está vacía')).toBeVisible();
    });

    test('precio cambiado en la caja: rechazo con el total nuevo y la venta no se registra', async ({ page }) => {
        const repriced = CAJA_PRODUCTS.map((p) => (p.id === 'p_harina' ? { ...p, priceUsdt: 1.25 } : p));
        const caja = await bootSeller(page, { products: repriced, sales: [OPEN_SHIFT], paymentMethods: METHODS });
        await setSellerAndCart(page);
        await payInFull(page);

        const status = page.getByTestId('remote-sale-status');
        await expect(status).toContainText('Venta rechazada por la caja principal', { timeout: 20_000 });
        await expect(status).toContainText('el total ahora es USD 2.50');
        await expect(status).toContainText('Harina E2E: USD 1.00 → USD 1.25');
        expect(caja.sales()).toHaveLength(1); // solo la apertura
        await page.getByRole('button', { name: 'Volver al carrito' }).click();
        await expect(page.getByLabel('Cantidad de Harina E2E').locator('visible=true')).toHaveText('2');
    });

    test('el supervisor ve la caja cerrada: no deja cobrar ni envía nada', async ({ page }) => {
        await page.addInitScript(() => { window.__E2E_SHIFT_CLOSED = true; });
        const caja = await bootSeller(page, { products: CAJA_PRODUCTS, sales: [{ ...OPEN_SHIFT, cajaCerrada: true }], paymentMethods: METHODS });
        await setSellerAndCart(page);
        await expect(page.getByTestId('remote-sale-shift-closed')).toContainText('La caja principal está cerrada');
        const cart = await openCart(page);
        await expect(cart.getByRole('button', { name: /^COBRAR/ }).locator('visible=true')).toBeDisabled();
        expect(caja.sales()).toHaveLength(1); // solo la apertura: nada se envió
    });

    test('caja cerrada: la venta se rechaza', async ({ page }) => {
        await bootSeller(page, { products: CAJA_PRODUCTS, sales: [{ ...OPEN_SHIFT, cajaCerrada: true }], paymentMethods: METHODS });
        await setSellerAndCart(page);
        await payInFull(page);
        await expect(page.getByTestId('remote-sale-status')).toContainText('La caja principal está cerrada', { timeout: 20_000 });
    });

    test('móvil 360 px: la pestaña Vender cabe sin desbordar y el carrito queda alcanzable', async ({ page }) => {
        await page.setViewportSize({ width: 360, height: 740 });
        await bootSeller(page, { products: CAJA_PRODUCTS, sales: [OPEN_SHIFT], paymentMethods: METHODS });
        await setSellerAndCart(page);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(1);
        await expect(page.getByTestId('supervisor-tab-vender')).toBeVisible();
        // La pestaña Vender va de segunda en la barra inferior.
        const tabs = page.getByTestId('supervisor-tabs').getByRole('button');
        await expect(tabs.nth(1)).toHaveAttribute('data-testid', 'supervisor-tab-vender');
        await expect(page.getByRole('button', { name: /^COBRAR/ }).locator('visible=true')).toBeEnabled();
        await page.screenshot({ path: 'test-results/remote-sale-360.png', fullPage: true });
    });

    test('caja que no toma la orden: se cancela y el vendedor sabe que NO se registró', async ({ page }) => {
        const caja = await bootSeller(page, { products: CAJA_PRODUCTS, sales: [OPEN_SHIFT], paymentMethods: METHODS, holdPending: true });
        await setSellerAndCart(page);
        await payInFull(page);

        const status = page.getByTestId('remote-sale-status');
        await expect(status).toContainText('No entregues la mercancía todavía');
        await expect(status).toContainText('La venta no se registró', { timeout: 40_000 });
        await expect(status).toContainText('no tomó la venta a tiempo');
        const row = caja.received.find((r) => r.command_type === 'supervisor.sale.create');
        expect(row.status).toBe('cancelled');
        expect(caja.sales()).toHaveLength(1);
    });
    test('avance de efectivo: aparece si la caja lo tiene activo y la caja lo registra', async ({ page }) => {
        const caja = await bootSeller(
            page,
            { products: CAJA_PRODUCTS, sales: [OPEN_SHIFT], paymentMethods: METHODS, context: { allowCashAdvance: true } },
            { allow_cash_advance: 'true', cash_advance_default_pct: '10' },
        );
        await setSellerAndCart(page);
        await page.getByRole('button', { name: 'Avance Efectivo' }).click();
        await page.locator('input[inputmode="decimal"]').last().fill('400');
        await page.getByRole('button', { name: 'Confirmar Avance' }).click();
        await payInFull(page);

        await expect(page.getByTestId('remote-sale-status')).toContainText('registrada en la caja principal', { timeout: 20_000 });
        const sent = caja.received.find((row) => row.command_type === 'supervisor.sale.create');
        expect(sent.payload.cashAdvances).toEqual([{ currency: 'BS', montoEfectivo: 400, comisionPct: 10 }]);
        const sale = caja.sales().find((s) => s.remoteSale);
        expect(sale.items.find((i) => i.isCashAdvance)).toMatchObject({ montoEfectivo: 400, montoComision: 40, currency: 'BS' });
    });

    test('sin avances activos en la caja el botón no aparece', async ({ page }) => {
        await bootSeller(page, { products: CAJA_PRODUCTS, sales: [OPEN_SHIFT], paymentMethods: METHODS });
        await page.getByLabel('Nombre del vendedor').fill('Tienda 2');
        await page.getByRole('button', { name: 'Guardar' }).click();
        await expect(page.getByRole('button', { name: 'Avance Efectivo' })).toHaveCount(0);
        await expect(page.getByRole('button', { name: 'Monto Libre' })).toHaveCount(0);
    });
    test('anular una venta del turno: la caja la anula con motivo y quién la pidió', async ({ page }) => {
        const turnSale = {
            id: 'venta_turno_1', saleNumber: 41, tipo: 'VENTA', status: 'COMPLETADA',
            timestamp: new Date().toISOString(), cajaCerrada: false,
            items: [{ id: 'p_cafe', name: 'Cafe E2E', qty: 1, priceUsd: 2 }],
            totalUsd: 2, totalBs: 80, payments: [{ methodId: 'efectivo_usd', currency: 'USD', amountUsd: 2 }],
        };
        // Hora posterior a la apertura sembrada (el turno solo lista ventas tras abrir).
        await page.addInitScript((sale) => {
            window.__E2E_EXTRA_SALES = [{ ...sale, timestamp: new Date(Date.now() + 1000).toISOString() }];
        }, turnSale);
        const caja = await bootSeller(page, { products: CAJA_PRODUCTS, sales: [OPEN_SHIFT, { ...turnSale }], paymentMethods: METHODS });
        await page.getByLabel('Nombre del vendedor').fill('Dueño');
        await page.getByRole('button', { name: 'Guardar' }).click();

        await page.getByRole('button', { name: /Turno Activo/ }).click();
        await page.getByRole('button', { name: 'Anular venta #41' }).click();
        const modal = page.getByTestId('remote-void-modal');
        const submit = modal.getByRole('button', { name: 'Anular venta' });
        await expect(submit).toBeDisabled(); // motivo obligatorio
        await modal.getByLabel('Motivo de la anulación').fill('Cliente devolvió el café');
        await submit.click();

        await expect(page.getByTestId('remote-void-status')).toContainText('Venta anulada', { timeout: 20_000 });
        const sent = caja.received.find((row) => row.command_type === 'supervisor.sale.void');
        expect(sent.payload).toMatchObject({ v: 1, saleId: 'venta_turno_1', reason: 'Cliente devolvió el café', requestedBy: { name: 'Dueño' } });
        expect(caja.sales().find((s) => s.id === 'venta_turno_1')).toMatchObject({ status: 'ANULADA', voidInfo: { by: 'Dueño' } });
    });
});
