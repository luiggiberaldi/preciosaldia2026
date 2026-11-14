/**
 * cobro-pos.e2e.spec.js — Cobro «Procesar Pago» de PC (modo POS) a 1366x768.
 *
 * Cubre el plan COBRO (fases 1 a 6): resumen único, botón COBRAR junto al resumen,
 * opciones del vuelto, Esc que no cierra el cobro, cobro directo y guardado final.
 * Reusa el arnés de siembra de la auditoría (caja abierta, tasa 40, 3 productos).
 *
 * Ejecutar: bunx playwright test tests/e2e/cobro-pos.e2e.spec.js
 * Capturas opcionales: COBRO_SHOTS=<carpeta> bunx playwright test ...
 */
import { test, expect } from '@playwright/test';
import { seedAudit, readIdb } from './helpers/auditHarness';

test.use({ viewport: { width: 1366, height: 768 }, hasTouch: false, isMobile: false });
test.setTimeout(120_000);

const SHOTS = process.env.COBRO_SHOTS || '';
const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

const buscador = (page) => page.locator('input[placeholder="Buscar producto..."]:visible').first();

async function abrirCobro(page, productos = ['Caraota E2E'], antes = null) {
    await seedAudit(page, {
        extraInitScripts: [`try { localStorage.setItem('checkout_mode', 'pos'); localStorage.removeItem('checkout_shell_v2'); localStorage.setItem('checkout_smallest_usd_bill','1'); localStorage.setItem('checkout_bs_round_step','0'); } catch (_) {}`],
    });
    await page.goto('/');
    await expect(page.locator('[data-tour="tab-ventas"]').first()).toBeVisible({ timeout: 30_000 });
    if (antes) await antes(page);
    await page.locator('[data-tour="tab-ventas"]').first().click();
    await expect(page.getByRole('heading', { name: 'Caja Cerrada' })).toHaveCount(0, { timeout: 15_000 });
    for (const nombre of productos) {
        const b = buscador(page);
        await b.fill(nombre);
        await page.waitForTimeout(500); // deja que el filtro termine antes de Enter
        await b.press('Enter');
        await expect(b).toHaveValue('', { timeout: 8_000 });
    }
    await page.keyboard.press('F9');
    await expect(page.getByText('Procesar Pago').first()).toBeVisible({ timeout: 20_000 });
}

const campo = (page, nombre) => page.locator('label', { hasText: nombre }).first().locator('xpath=ancestor::div[contains(@class,"relative")][1]').locator('input').first();

test('POS: abre, paga exacto con Efectivo $ y guarda la venta', async ({ page }) => {
    await abrirCobro(page);
    await shot(page, '01-abierto');
    const usd = page.getByPlaceholder('0.00').first();
    await usd.fill('5');
    const pagar = page.getByRole('button', { name: /PAGAR|COBRAR \$/ }).last();
    await expect(pagar).toBeEnabled();
    await shot(page, '02-pago-exacto');
    await pagar.click();
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 15_000 });
    const venta = ((await readIdb(page, 'bodega_sales_v1')) || []).find(s => s.tipo === 'VENTA');
    expect(venta.totalUsd).toBeCloseTo(5, 2);
    expect(venta.redondeoUsd).toBe(0);
});

const efectivoUsd = (page) => page.getByPlaceholder('0.00').first();
const botonCobrar = (page) => page.getByRole('button', { name: /COBRAR \$|PAGAR|CONFIRMA EL CAMBIO|FALTAN/ }).last();

test('Esc con un monto escrito lo borra y NO cierra el cobro (COBRO-002)', async ({ page }) => {
    await abrirCobro(page);
    await efectivoUsd(page).fill('3');
    await efectivoUsd(page).press('Escape');
    await expect(efectivoUsd(page)).toHaveValue('');
    await expect(page.getByText('Procesar Pago').first()).toBeVisible();
});

test('Vuelto: pagar $10 una venta de $5, «Todo en Bs» y cobrar guarda el vuelto en Bs', async ({ page }) => {
    await abrirCobro(page);
    await efectivoUsd(page).fill('10');
    await expect(page.getByText('¿Cómo entregas el vuelto?')).toBeVisible();
    await expect(botonCobrar(page)).toContainText('CONFIRMA EL CAMBIO');
    await shot(page, '10-vuelto-sin-elegir');
    await page.getByRole('button', { name: 'Todo en Bs' }).click();
    await shot(page, '11-vuelto-todo-bs');
    await expect(botonCobrar(page)).toContainText('COBRAR $5.00');
    await botonCobrar(page).click();
    // Mientras no exista el cobro directo, el modal final pide confirmar.
    const confirmar = page.getByRole('button', { name: /Confirmar venta|Confirmar igual|Vuelto entregado/ });
    if (await confirmar.count()) await confirmar.first().click();
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 15_000 });
    const venta = ((await readIdb(page, 'bodega_sales_v1')) || []).find(s => s.tipo === 'VENTA');
    expect(venta.changeBs).toBeCloseTo(200, 2);
    expect(venta.changeUsd || 0).toBe(0);
});

test('Vuelto: «Lo deja (propina)» no entrega vuelto', async ({ page }) => {
    await abrirCobro(page);
    await efectivoUsd(page).fill('6');
    await page.getByRole('button', { name: /Lo deja/ }).click();
    await expect(botonCobrar(page)).toContainText('COBRAR $5.00');
    await botonCobrar(page).click();
    const confirmar = page.getByRole('button', { name: /Confirmar venta|Confirmar igual|Vuelto entregado/ });
    if (await confirmar.count()) await confirmar.first().click();
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 15_000 });
    const venta = ((await readIdb(page, 'bodega_sales_v1')) || []).find(s => s.tipo === 'VENTA');
    expect(venta.tipDonated?.amountUsd).toBeCloseTo(1, 2);
});

test('Vuelto «En $ y Bs»: escribir $2 llena los Bs solos', async ({ page }) => {
    await abrirCobro(page);
    await efectivoUsd(page).fill('10');
    await page.getByRole('button', { name: 'En $ y Bs' }).click();
    await page.getByRole('textbox', { name: 'Vuelto en dólares' }).fill('2');
    await expect(page.getByRole('textbox', { name: 'Vuelto en bolívares' })).toHaveValue('120');
    await shot(page, '12-vuelto-mixto');
    await expect(botonCobrar(page)).toContainText('COBRAR $5.00');
});

test('Vuelto con centavos: «Sugerido» da $2 en billetes + Bs 20 y la venta lo guarda así (COBRO-003)', async ({ page }) => {
    await abrirCobro(page, ['Cafe E2E', 'Harina E2E']); // $3,00
    await efectivoUsd(page).fill('5.5'); // vuelto $2,50
    const sugerido = page.getByRole('button', { name: /Sugerido: \$2 \+ Bs 20/ });
    await expect(sugerido).toBeVisible();
    await shot(page, '13-sugerido');
    await sugerido.click();
    await expect(page.getByRole('textbox', { name: 'Vuelto en dólares' })).toHaveCount(0); // no abre el reparto a mano
    await expect(botonCobrar(page)).toContainText('COBRAR $3.00');
    await botonCobrar(page).click();
    const confirmar = page.getByRole('button', { name: /Confirmar venta|Confirmar igual|Vuelto entregado/ });
    if (await confirmar.count()) await confirmar.first().click();
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 15_000 });
    const venta = ((await readIdb(page, 'bodega_sales_v1')) || []).find(s => s.tipo === 'VENTA');
    expect(venta.changeUsd).toBeCloseTo(2, 2);
    expect(venta.changeBs).toBeCloseTo(20, 2);
});

test('Con vuelto, después de COBRAR siempre sale la distribución para confirmar (decisión del dueño)', async ({ page }) => {
    await abrirCobro(page);
    await efectivoUsd(page).fill('10');
    await page.getByRole('button', { name: 'Todo en Bs' }).click();
    await botonCobrar(page).click();
    const confirmar = page.getByRole('button', { name: /Confirmar venta/ });
    await expect(confirmar).toBeVisible();
    await expect(page.getByText('Tasa BCV Aplicada')).toHaveCount(0);
    await shot(page, '14-confirmar-vuelto');
    await page.keyboard.press('Enter'); // el botón queda enfocado: Enter confirma
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 15_000 });
});

test('La confirmación muestra el aviso si en la gaveta no hay Bs suficientes (COBRO-004)', async ({ page }) => {
    await abrirCobro(page);
    await efectivoUsd(page).fill('120'); // vuelto $115 = Bs 4.600; la gaveta sembrada tiene Bs 4.000
    await page.getByRole('button', { name: 'Todo en Bs' }).click();
    await botonCobrar(page).click();
    await expect(page.getByTestId('aviso-fondo-gaveta').or(page.getByText(/en la gaveta hay/)).first()).toBeVisible({ timeout: 5_000 });
    await expect(page.getByRole('button', { name: /Confirmar igual/ })).toBeVisible();
    await shot(page, '20-aviso-efectivo');
    await page.keyboard.press('Escape'); // cierra solo el modal, no el cobro (COBRO-002)
    await expect(page.getByRole('button', { name: /Confirmar igual/ })).toHaveCount(0);
    await expect(page.getByText('Procesar Pago').first()).toBeVisible();
});

test('F9 dentro del cobro cobra cuando todo está listo (COBRO-005)', async ({ page }) => {
    await abrirCobro(page);
    await efectivoUsd(page).fill('5');
    await page.keyboard.press('F9');
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 15_000 });
});

test('F9 con vuelto sin repartir no cobra y avisa (COBRO-005)', async ({ page }) => {
    await abrirCobro(page);
    await efectivoUsd(page).fill('10');
    await page.keyboard.press('F9');
    await expect(page.getByText('Elige cómo entregas el vuelto antes de cobrar')).toBeVisible();
    await expect(page.getByText('Tasa BCV Aplicada')).toHaveCount(0);
});

test('Enter en el último campo cobra (COBRO-005)', async ({ page }) => {
    await abrirCobro(page);
    const ultimo = page.getByPlaceholder('0.00').last(); // último método (Biopago)
    await ultimo.fill('200');
    await ultimo.press('Enter');
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 15_000 });
});

test('De fábrica ningún método pide referencia (COBRO-006)', async ({ page }) => {
    await abrirCobro(page);
    await page.getByPlaceholder('0.00').nth(2).fill('200'); // Pago Móvil
    await expect(page.locator('[data-ref-for="pago_movil"]')).toHaveCount(0);
});

// Ajustes → Ventas → Caja & Vuelto → Pago Móvil: «Obligatoria».
async function pagoMovilObligatoria(page) {
    await page.locator('[data-tour="tab-ajustes"]').first().click();
    await page.getByRole('tab', { name: 'Ventas', exact: true }).first().click();
    await page.getByRole('tab', { name: /Caja & Vuelto/ }).first().click();
    await page.getByRole('group', { name: 'Referencia de Pago Móvil' }).getByRole('button', { name: 'Obligatoria' }).click();
    await expect(page.getByRole('group', { name: 'Referencia de Pago Móvil' }).getByRole('button', { name: 'Obligatoria' })).toHaveAttribute('aria-pressed', 'true');
}

test('Referencia de Pago Móvil «Obligatoria»: sin los últimos 4 no cobra; con ellos sale en el recibo (COBRO-006)', async ({ page }) => {
    await abrirCobro(page, ['Caraota E2E'], pagoMovilObligatoria);
    await page.getByPlaceholder('0.00').nth(2).fill('200'); // Pago Móvil
    const ref = page.locator('[data-ref-for="pago_movil"]');
    await expect(ref).toBeVisible();
    await shot(page, '30-referencia');
    await botonCobrar(page).click();
    await expect(page.getByText(/Falta la referencia de Pago Móvil/)).toBeVisible();
    await expect(ref).toBeFocused();
    await ref.fill('12a345'); // solo números, máximo 4
    await expect(ref).toHaveValue('1234');
    await botonCobrar(page).click();
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Pago Móvil \(Ref\. 1234\)/).first()).toBeVisible();
    const venta = ((await readIdb(page, 'bodega_sales_v1')) || []).find(s => s.tipo === 'VENTA');
    expect(venta.payments.find(p => p.methodId === 'pago_movil').referencia).toBe('1234');
});

test('Teclado numérico táctil (forzado en «Siempre»): las teclas escriben en el campo activo (COBRO-007)', async ({ page }) => {
    await page.addInitScript(`try { localStorage.setItem('pda_touch_mode', 'on'); } catch (_) {}`);
    await abrirCobro(page);
    await expect(page.getByText(/Escribiendo en/).first()).toBeVisible();
    for (const k of ['Número 1', 'Número 5', 'Coma decimal', 'Número 6', 'Número 3']) await page.getByRole('button', { name: k, exact: true }).dispatchEvent('pointerdown');
    await expect(efectivoUsd(page)).toHaveValue('15.63');
    await shot(page, '40-teclado-tactil');
});

test('Sin el modo táctil no sale el teclado numérico (COBRO-007)', async ({ page }) => {
    await abrirCobro(page);
    await expect(page.getByText(/Escribiendo en/)).toHaveCount(0);
});

test('1024x768 (laptop pequeña): con Sugerido y vuelto, el botón COBRAR se ve sin desplazar', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await abrirCobro(page, ['Cafe E2E', 'Harina E2E']);
    await efectivoUsd(page).fill('5.5');
    await page.getByRole('button', { name: /Sugerido/ }).click();
    await expect(botonCobrar(page)).toBeInViewport();
    await page.waitForTimeout(400); // fin de la animación antes de la captura
    await shot(page, '50-1024-sugerido');
});
