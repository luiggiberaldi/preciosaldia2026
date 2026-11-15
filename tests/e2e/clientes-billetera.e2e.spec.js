/**
 * clientes-billetera.e2e.spec.js — Flujo de clientes en el cobro de PC («Procesar Pago»).
 *
 * Cubre (2026-11-14, verificación de clientes):
 *  - Vuelto a la billetera del cliente («A su billetera») y el botón apagado sin cliente.
 *  - Venta a crédito parcial en «Procesar Pago» → deuda.
 *  - Abono mayor que la deuda desde Clientes → deuda 0 y saldo a favor por el sobrante.
 *  - Compra pagada con ese saldo a favor → el saldo baja y la venta no trae efectivo.
 *  - Cartera y ledger siguen cuadrando al final.
 *
 * Reusa el arnés de la auditoría (caja abierta, tasa 40, «Juan E2E» con $18,50 a favor).
 * Ejecutar: bunx playwright test tests/e2e/clientes-billetera.e2e.spec.js
 */
import { test, expect } from '@playwright/test';
import { seedAudit, readIdb } from './helpers/auditHarness';

test.use({ viewport: { width: 1366, height: 768 }, hasTouch: false, isMobile: false });
test.setTimeout(150_000);

const buscador = (page) => page.locator('input[placeholder="Buscar producto..."]:visible').first();
// Con un cliente con saldo a favor, el primer campo «0.00» es el del saldo: se paga con los billetes.
const billete = (page, den) => page.getByRole('button', { name: `Sumar billete de ${den} dólares` });
const irA = (page, tab) => page.locator(`[data-testid="sidenav-${tab}"]`).click();
const botonCobrar = (page) => page.getByRole('button', { name: /COBRAR \$|PAGAR|CONFIRMA EL CAMBIO|FALTAN|FIAR TOTALMENTE|PROCESAR CON ABONO/ }).last();

async function iniciar(page) {
    await seedAudit(page, {
        reseedOnReload: false,
        extraInitScripts: [`try { localStorage.setItem('checkout_mode', 'pos'); localStorage.removeItem('checkout_shell_v2'); localStorage.setItem('checkout_smallest_usd_bill','1'); localStorage.setItem('checkout_bs_round_step','0'); } catch (_) {}`],
    });
    await page.goto('/');
    await expect(page.locator('[data-tour="tab-ventas"]:visible').first()).toBeVisible({ timeout: 30_000 });
}

async function abrirCobro(page, productos) {
    await page.locator('[data-tour="tab-ventas"]:visible').first().click();
    await expect(page.getByRole('heading', { name: 'Caja Cerrada' })).toHaveCount(0, { timeout: 15_000 });
    for (const nombre of productos) {
        const b = buscador(page);
        await b.fill(nombre);
        await page.waitForTimeout(500);
        await b.press('Enter');
        await expect(b).toHaveValue('', { timeout: 8_000 });
    }
    await page.keyboard.press('F9');
    await expect(page.getByText('Procesar Pago').first()).toBeVisible({ timeout: 20_000 });
}

async function elegirCliente(page, nombre) {
    await page.getByRole('button', { name: /Consumidor Final/ }).first().click();
    await page.getByText(nombre).first().click();
}

async function confirmarYCerrarRecibo(page, revisarRecibo = null) {
    const confirmar = page.getByRole('button', { name: /Confirmar venta|Confirmar igual|Vuelto entregado|Confirmar fiado/ });
    if (await confirmar.count()) await confirmar.first().click();
    await expect(page.getByText('Tasa BCV Aplicada')).toBeVisible({ timeout: 15_000 });
    if (revisarRecibo) await revisarRecibo();
    const nuevaVenta = page.getByRole('button', { name: /Nueva Venta/ });
    if (await nuevaVenta.count()) await nuevaVenta.first().click();
    else await page.getByLabel('Cerrar').first().click();
    await expect(page.getByText('Tasa BCV Aplicada')).toHaveCount(0, { timeout: 10_000 });
}

const cliente = async (page, nombre) => ((await readIdb(page, 'bodega_customers_v1')) || []).find(c => c.name === nombre);

// En PC (≥1024 px) y en pantalla angosta hay un selector de cliente distinto: se prueban los dos.
for (const ancho of [1366, 900]) test(`Sin cliente, la opción de billetera del vuelto está apagada (${ancho} px)`, async ({ page }) => {
    await page.setViewportSize({ width: ancho, height: 768 });
    await iniciar(page);
    await abrirCobro(page, ['Caraota E2E']); // $5
    await billete(page, 10).click();
    const billetera = page.getByRole('button', { name: /Billetera: elige cliente/ });
    await expect(billetera).toBeVisible();
    await billetera.click();
    await expect(page.getByText('Elige un cliente para pasar el vuelto a su billetera')).toBeVisible();
    await expect(botonCobrar(page)).toContainText('CONFIRMA EL CAMBIO');
    // F7: además del aviso, se abre el selector de cliente.
    await expect(page.locator('[data-testid="customer-picker-toggle"]:visible')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('button:visible', { hasText: 'Juan E2E' }).first()).toBeVisible();
    if (process.env.CLIENTES_SHOTS) await page.screenshot({ path: `${process.env.CLIENTES_SHOTS}/billetera-sin-cliente-${ancho}.png` });
});

test('Vuelto «A su billetera»: $5 de vuelto suben el saldo a favor de Juan de $18,50 a $23,50', async ({ page }) => {
    await iniciar(page);
    await abrirCobro(page, ['Caraota E2E']); // $5
    await elegirCliente(page, 'Juan E2E');
    // F7: el saldo del cliente se ve también en Bs a la tasa del día.
    await expect(page.locator('[data-testid="customer-balance-chip"]:visible')).toHaveText('Favor $18.50 · Bs 740,00');
    if (process.env.CLIENTES_SHOTS) await page.screenshot({ path: `${process.env.CLIENTES_SHOTS}/selector-chip.png` });
    await billete(page, 10).click();
    await page.getByRole('button', { name: 'A su billetera' }).click();
    await expect(botonCobrar(page)).toContainText('COBRAR $5.00');
    await botonCobrar(page).click();
    // ERR-013: el recibo en pantalla dice a dónde fue el vuelto.
    await confirmarYCerrarRecibo(page, () => expect(page.getByTestId('recibo-vuelto-billetera')).toContainText('$5.00'));

    await expect.poll(async () => (await cliente(page, 'Juan E2E'))?.favor, { timeout: 15_000 }).toBe(23.5);
    const venta = ((await readIdb(page, 'bodega_sales_v1')) || []).find(s => s.tipo === 'VENTA');
    expect(venta.vueltoParaMonedero).toBe(5);
    expect(venta.changeUsd || 0).toBe(0);
    expect(venta.changeBs || 0).toBe(0);
    expect(venta.changeAllocation).toMatchObject({ creditedUsd: 5, deliveredUsd: 0 });

    // ERR-014: el siguiente cobro ya muestra el saldo nuevo (antes podía quedar el viejo, $18,50).
    await abrirCobro(page, ['Harina E2E']);
    await elegirCliente(page, 'Juan E2E');
    await expect(page.getByText('$23.50').first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('$18.50')).toHaveCount(0);
});

test('Crédito parcial → abono mayor que la deuda → compra con el saldo a favor', async ({ page }) => {
    await iniciar(page);

    // Cliente nueva desde Clientes.
    await irA(page, 'clientes');
    await page.locator('button:has-text("Nuevo Contacto")').first().click();
    await page.getByPlaceholder('Ej. María Pérez').fill('María Prueba');
    await page.getByRole('button', { name: /Guardar Cliente/ }).click();
    await expect.poll(async () => Boolean(await cliente(page, 'María Prueba')), { timeout: 15_000 }).toBe(true);

    // Venta $5 a crédito: paga $2, quedan $3 de deuda.
    await abrirCobro(page, ['Caraota E2E']);
    await page.getByRole('button', { name: /Crédito/ }).first().click();
    await elegirCliente(page, 'María Prueba');
    await billete(page, 1).click();
    await billete(page, 1).click();
    await expect(page.getByText('Queda debiendo').first()).toBeVisible();
    await expect(botonCobrar(page)).toContainText('PROCESAR CON ABONO');
    await botonCobrar(page).click();
    await confirmarYCerrarRecibo(page);
    await expect.poll(async () => (await cliente(page, 'María Prueba'))?.deuda, { timeout: 15_000 }).toBe(3);
    const fiada = ((await readIdb(page, 'bodega_sales_v1')) || []).find(s => s.tipo === 'VENTA_FIADA');
    expect(fiada.fiadoUsd).toBe(3);

    // Abono de $5 con deuda $3: deuda 0 y $2 a favor.
    await irA(page, 'clientes');
    await page.getByPlaceholder('Buscar cliente...').fill('María');
    await page.getByText('María Prueba').first().click();
    // F7: el historial explica el fiado parcial.
    await expect(page.getByTestId('historial-fiado_parcial').first()).toHaveText('Pagó $2.00 · fió $3.00');
    if (process.env.CLIENTES_SHOTS) await page.screenshot({ path: `${process.env.CLIENTES_SHOTS}/historial-notas.png` });
    await page.getByText('Ajustar Cuenta').first().click();
    await page.getByRole('button', { name: /Recibir Abono/ }).click();
    // F7: en Bs, aviso de que la deuda se lleva en dólares.
    await expect(page.getByTestId('deuda-en-dolares')).toContainText('La deuda es de $3.00');
    // F7: «Pagar Total» en Bs muestra también los dólares.
    await expect(page.getByTestId('pagar-total')).toHaveText('Pagar Total: Bs 120,00 ($3.00)');
    await page.getByRole('button', { name: 'USD', exact: true }).click();
    await page.getByPlaceholder('0.00').last().fill('5');
    await page.getByRole('button', { name: /^Abonar / }).click();
    await expect.poll(async () => {
        const c = await cliente(page, 'María Prueba');
        return c && { deuda: c.deuda, favor: c.favor };
    }, { timeout: 15_000 }).toEqual({ deuda: 0, favor: 2 });
    await expect.poll(async () => ((await readIdb(page, 'bodega_sales_v1')) || []).find(s => s.tipo === 'COBRO_DEUDA')?.saldoFavorGeneradoUsd,
        { timeout: 15_000 }).toBe(2);

    // Compra de $1 (Harina) pagada con el saldo a favor.
    await abrirCobro(page, ['Harina E2E']);
    await elegirCliente(page, 'María Prueba');
    const usarTodo = page.getByTitle('Aplicar el máximo saldo a favor permitido');
    await expect(usarTodo).toBeVisible({ timeout: 15_000 });
    await usarTodo.click();
    await expect(botonCobrar(page)).toBeEnabled({ timeout: 10_000 });
    await botonCobrar(page).click();
    await confirmarYCerrarRecibo(page);
    await expect.poll(async () => (await cliente(page, 'María Prueba'))?.favor, { timeout: 15_000 }).toBe(1);

    let venta;
    await expect.poll(async () => {
        venta = ((await readIdb(page, 'bodega_sales_v1')) || []).find(s => s.tipo === 'VENTA' && s.customerName === 'María Prueba');
        return Boolean(venta);
    }, { timeout: 15_000 }).toBe(true);
    expect(venta.payments.map(p => p.methodId)).toEqual(['saldo_favor']);

    // La cartera guardada coincide con el último saldo del ledger.
    const ledger = (await readIdb(page, 'bodega_customer_ledger_v1')) || [];
    const maria = await cliente(page, 'María Prueba');
    const movs = ledger.filter(m => m.customerId === maria.id);
    expect(movs.at(-1).balanceAfterUsd).toBe(1);
    expect(movs.map(m => m.type)).toEqual(['VENTA_FIADA', 'ABONO_DEUDA', 'SALDO_FAVOR_USADO']);
});

test('Anular desde Inicio una venta pagada con saldo a favor: la confirmación dice cómo queda la cuenta y el saldo vuelve (F3)', async ({ page }) => {
    await iniciar(page);
    // Juan tiene $18,50 a favor: compra $5 con «Todo» el saldo.
    await abrirCobro(page, ['Caraota E2E']);
    await elegirCliente(page, 'Juan E2E');
    await page.getByTitle('Aplicar el máximo saldo a favor permitido').click();
    await botonCobrar(page).click();
    await confirmarYCerrarRecibo(page);
    await expect.poll(async () => (await cliente(page, 'Juan E2E'))?.favor, { timeout: 15_000 }).toBe(13.5);

    await irA(page, 'inicio');
    await page.getByText('Juan E2E').first().click();       // abre el detalle de la venta en el historial
    await page.getByRole('button', { name: /Anular/ }).first().click();
    const detalles = page.getByTestId('confirm-details');
    await expect(detalles).toContainText('Cuenta de Juan E2E: $13.50 a favor → $18.50 a favor.');
    await page.getByRole('button', { name: 'Sí, anular' }).click();
    await expect.poll(async () => (await cliente(page, 'Juan E2E'))?.favor, { timeout: 15_000 }).toBe(18.5);
});

test('Abono mixto: $2 + Bs 200 saldan una deuda de $7 en un solo abono (F5)', async ({ page }) => {
    await iniciar(page);
    await irA(page, 'clientes');
    await page.locator('button:has-text("Nuevo Contacto")').first().click();
    await page.getByPlaceholder('Ej. María Pérez').fill('Pedro Mixto');
    await page.getByRole('button', { name: /Guardar Cliente/ }).click();
    await expect.poll(async () => Boolean(await cliente(page, 'Pedro Mixto')), { timeout: 15_000 }).toBe(true);

    // Deuda de $7 con «Agregar Deuda».
    await page.getByPlaceholder('Buscar cliente...').fill('Pedro');
    await page.getByText('Pedro Mixto').first().click();
    await page.getByText('Ajustar Cuenta').first().click();
    await page.getByRole('button', { name: /Agregar Deuda/ }).click();
    await page.getByRole('button', { name: 'USD', exact: true }).click();
    await page.getByPlaceholder('0.00').last().fill('7');
    await page.getByRole('button', { name: /^Cargar Deuda/ }).click();
    await expect.poll(async () => (await cliente(page, 'Pedro Mixto'))?.deuda, { timeout: 15_000 }).toBe(7);

    // Abono mixto (el detalle se cierra tras cada operación: se vuelve a abrir).
    await page.getByText('Pedro Mixto').first().click();
    await page.getByText('Ajustar Cuenta').first().click();
    await page.getByRole('button', { name: /Recibir Abono/ }).click();
    await page.getByRole('button', { name: '$ y Bs', exact: true }).click();
    await page.getByLabel('Parte en dólares').fill('2');
    await page.getByLabel('Parte en bolívares').fill('200');
    await expect(page.getByTestId('abono-mixto-total')).toHaveText('$7.00 USD');
    const abonar = page.getByRole('button', { name: /^Abonar \$2\.00 \+ Bs 200,00/ });
    await expect(abonar).toBeEnabled();
    // F7: a 1366×768 el título y el botón se ven sin desplazar (el centro es el que se desplaza).
    await expect(page.getByTestId('ajustar-cuenta').getByText('Ajustar Cuenta')).toBeInViewport();
    await expect(abonar).toBeInViewport();
    if (process.env.CLIENTES_SHOTS) await page.screenshot({ path: `${process.env.CLIENTES_SHOTS}/abono-mixto.png` });
    await abonar.click();

    await expect.poll(async () => (await cliente(page, 'Pedro Mixto'))?.deuda, { timeout: 15_000 }).toBe(0);
    let abono;
    await expect.poll(async () => {
        abono = ((await readIdb(page, 'bodega_sales_v1')) || []).find(s => s.tipo === 'COBRO_DEUDA' && s.customerName === 'Pedro Mixto');
        return Boolean(abono);
    }, { timeout: 15_000 }).toBe(true);
    expect(abono.totalUsd).toBe(7);
    expect(abono.payments.map(p => [p.methodId, p.currency, p.amount])).toEqual([['efectivo_usd', 'USD', 2], ['efectivo_bs', 'BS', 200]]);
});

test('Fiado a un cliente con saldo a favor: Reportes muestra cuánto cubrió el saldo (F6)', async ({ page }) => {
    await iniciar(page);
    // Juan tiene $18,50 a favor: se le fían $5 (Crédito, sin pago).
    await abrirCobro(page, ['Caraota E2E']);
    await page.getByRole('button', { name: /Crédito/ }).first().click();
    await elegirCliente(page, 'Juan E2E');
    await expect(botonCobrar(page)).toContainText('FIAR TOTALMENTE');
    await botonCobrar(page).click();
    await confirmarYCerrarRecibo(page);
    await expect.poll(async () => (await cliente(page, 'Juan E2E'))?.favor, { timeout: 15_000 }).toBe(13.5);

    await irA(page, 'reportes');
    const fila = page.locator('[data-view="reportes"]').getByTestId('cxc-fiado_cubierto');
    await expect(fila).toBeVisible({ timeout: 45_000 });
    await expect(fila).toContainText('De eso, cubierto con saldo a favor');
    await expect(fila).toContainText('USD 5.00');
    if (process.env.CLIENTES_SHOTS) {
        await fila.locator('xpath=ancestor::div[contains(@class,"rounded")][1]').screenshot({ path: `${process.env.CLIENTES_SHOTS}/fiado-cubierto.png` });
    }
});
