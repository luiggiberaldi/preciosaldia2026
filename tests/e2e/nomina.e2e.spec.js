/**
 * nomina.e2e.spec.js — Gestión › Nómina de punta a punta (plan 2026-11-14, F4).
 *
 * Reusa el arnés de la auditoría (caja abierta, tasa 40 Bs/$). El Administrador
 * sembrado tiene un PIN de relleno; aquí se le pone el PIN de prueba 123456
 * (hash PBKDF2 generado con src/utils/crypto.js) para poder autorizar.
 *
 * Recorre: crear empleado → adelanto $10 en efectivo → PIN equivocado → pago del
 * resto en Bs por pago móvil → periodo «Pagado» → anular el adelanto → la caja
 * vuelve y el saldo reaparece. Cada paso se audita en IndexedDB, no solo en pantalla.
 *
 * Ejecutar: bunx playwright test tests/e2e/nomina.e2e.spec.js
 */
import { test, expect } from '@playwright/test';
import { seedAudit, readIdb, navTab } from './helpers/auditHarness';

test.use({ viewport: { width: 1366, height: 768 }, hasTouch: false, isMobile: false });
test.setTimeout(150_000);

const PIN = '123456';
const PIN_HASH = 'pbkdf2$250000$He0cM7hPt6fVY9I6pb6lbg==$PrO/Kru3h5X87EahzMat02MDx8Htq/aRlZYEYE+FdDk=';

const PIN_SCRIPT = `
try {
    const raw = localStorage.getItem('abasto-auth-storage');
    if (raw) {
        const s = JSON.parse(raw);
        s.state.usuarios = (s.state.usuarios || []).map(u => u.rol === 'ADMIN' ? { ...u, pin: ${JSON.stringify(PIN_HASH)} } : u);
        localStorage.setItem('abasto-auth-storage', JSON.stringify(s));
    }
} catch (_) {}`;

const nominaMovs = async (page) => ((await readIdb(page, 'bodega_sales_v1')) || []).filter(s => s.isPayroll);
const renglones = async (page) => (await readIdb(page, 'bodega_payroll_entries_v1')) || [];

async function abrirNomina(page) {
    await seedAudit(page, { reseedOnReload: false, extraInitScripts: [PIN_SCRIPT] });
    await page.goto('/');
    await expect(navTab(page, 'inicio')).toBeVisible({ timeout: 30_000 });
    await navTab(page, 'clientes').click();
    await page.getByTestId('gestion-tab-nomina').click();
    await expect(page.getByTestId('payroll-panel')).toBeVisible();
}

test('Nómina: adelanto en efectivo, pago en Bs, anular y caja de vuelta', async ({ page }) => {
    await abrirNomina(page);

    // La pestaña principal ya se llama «Gestión», con sus tres sub-pestañas.
    await expect(navTab(page, 'clientes')).toContainText('Gestión');
    await expect(page.getByTestId('gestion-tab-clientes')).toBeVisible();
    await expect(page.getByTestId('gestion-tab-proveedores')).toBeVisible();

    // 1. Nuevo empleado (PIN obligatorio).
    await page.getByTestId('employee-new').click();
    await page.getByTestId('employee-nombre').fill('María E2E');
    await page.getByTestId('employee-sueldo').fill('100');
    // Lista desplegable propia (bordes redondeados): se abre y se toca la opción.
    await page.getByTestId('employee-frecuencia').click();
    await page.screenshot({ path: 'test-results/nomina-lista-frecuencia.png' });
    await page.getByTestId('employee-frecuencia-option-quincenal').click();
    await expect(page.getByTestId('employee-frecuencia')).toHaveAttribute('data-value', 'quincenal');
    await page.getByTestId('payroll-pin').fill(PIN);
    await page.getByTestId('employee-save').click();
    const fila = page.getByTestId('payroll-employee-row').filter({ hasText: 'María E2E' });
    await expect(fila).toContainText('$100');
    await expect(fila).toContainText('Sin movimientos');

    // 2. Adelanto de $10 en efectivo.
    await fila.click();
    await expect(page.getByTestId('payroll-detail-saldo')).toContainText('$100');
    await page.getByTestId('payroll-action-ADELANTO').click();
    await page.getByTestId('payroll-monto').fill('10');
    await expect(page.getByTestId('payroll-metodo')).toHaveAttribute('data-value', 'efectivo_usd');

    // PIN equivocado: no se registra nada.
    await page.getByTestId('payroll-pin').fill('999999');
    await page.getByTestId('payroll-entry-submit').click();
    await expect(page.getByTestId('payroll-entry-error')).toContainText(/PIN/);
    expect(await nominaMovs(page)).toHaveLength(0);

    await page.getByTestId('payroll-pin').fill(PIN);
    await page.getByTestId('payroll-entry-submit').click();
    await expect(page.getByTestId('payroll-entry-done')).toContainText('Registrado');
    await page.getByRole('button', { name: 'Listo' }).click();
    await expect(page.getByTestId('payroll-detail-saldo')).toContainText('$90');

    let movs = await nominaMovs(page);
    expect(movs).toHaveLength(1);
    expect(movs[0]).toMatchObject({ tipo: 'GASTO_INTERNO', category: 'nomina', paymentMethod: 'efectivo_usd', totalUsd: -10, afectaCaja: true });

    // 3. Pagar el periodo en Bs por pago móvil: se sugiere el saldo (90 × 40 = 3.600).
    await page.getByTestId('payroll-action-PAGO').click();
    await page.getByTestId('payroll-moneda-BS').click();
    await expect(page.getByTestId('payroll-monto')).toHaveValue('3600');
    await page.getByTestId('payroll-metodo').click();
    await page.screenshot({ path: 'test-results/nomina-lista-metodo.png' });
    await page.getByTestId('payroll-metodo-option-pago_movil').click();
    await expect(page.getByTestId('payroll-metodo')).toHaveAttribute('data-value', 'pago_movil');
    await page.getByTestId('payroll-pin').fill(PIN);
    await page.getByTestId('payroll-entry-submit').click();
    await expect(page.getByTestId('payroll-entry-done')).toContainText('$90');
    await page.screenshot({ path: 'test-results/nomina-pago-registrado.png' });
    await page.getByRole('button', { name: 'Listo' }).click();
    await expect(page.getByTestId('payroll-detail-saldo')).toContainText('$0');
    await expect(page.getByTestId('payroll-detail')).toContainText('Pagado');

    movs = await nominaMovs(page);
    expect(movs).toHaveLength(2);
    const pago = movs.find(m => m.paymentMethod === 'pago_movil');
    expect(pago).toMatchObject({ totalUsd: -90, totalBs: -3600 });
    let rs = await renglones(page);
    expect(rs.map(r => r.tipo).sort()).toEqual(['ADELANTO', 'PAGO']);
    expect(rs.find(r => r.tipo === 'PAGO')).toMatchObject({ moneda: 'BS', montoBs: 3600, tasa: 40, saleDeGaveta: false });
    await page.screenshot({ path: 'test-results/nomina-detalle-pagado.png', fullPage: true });

    // 4. Anular el adelanto: su salida de caja se tacha y el saldo vuelve a $10.
    const filaAdelanto = page.getByTestId('payroll-entry-row').filter({ hasText: 'Adelanto' });
    await filaAdelanto.getByTestId('payroll-entry-void').click();
    await page.getByTestId('payroll-pin').fill(PIN);
    await page.getByTestId('payroll-pin-confirm').click();
    await expect(filaAdelanto).toContainText('ANULADO');
    await expect(page.getByTestId('payroll-detail-saldo')).toContainText('$10');

    movs = await nominaMovs(page);
    expect(movs.find(m => m.paymentMethod === 'efectivo_usd').status).toBe('ANULADA');
    expect(movs).toHaveLength(2); // nunca un movimiento «al revés»
    rs = await renglones(page);
    expect(rs.find(r => r.tipo === 'ADELANTO').status).toBe('ANULADO');

    // 5. Persistencia: tras recargar, todo sigue igual.
    await page.reload();
    await expect(navTab(page, 'inicio')).toBeVisible({ timeout: 30_000 });
    await navTab(page, 'clientes').click();
    await page.getByTestId('gestion-tab-nomina').click();
    await expect(page.getByTestId('payroll-employee-row').filter({ hasText: 'María E2E' })).toContainText('$10');
    await page.screenshot({ path: 'test-results/nomina-lista.png' });
});

test('Gastos internos: un gasto de nómina no se anula desde la lista de gastos', async ({ page }) => {
    await abrirNomina(page);
    await page.getByTestId('employee-new').click();
    await page.getByTestId('employee-nombre').fill('Beto E2E');
    await page.getByTestId('employee-sueldo').fill('50');
    await page.getByTestId('payroll-pin').fill(PIN);
    await page.getByTestId('employee-save').click();
    await page.getByTestId('payroll-employee-row').filter({ hasText: 'Beto E2E' }).click();
    await page.getByTestId('payroll-action-ADELANTO').click();
    await page.getByTestId('payroll-monto').fill('5');
    await page.getByTestId('payroll-pin').fill(PIN);
    await page.getByTestId('payroll-entry-submit').click();
    await expect(page.getByTestId('payroll-entry-done')).toBeVisible();
    await page.getByRole('button', { name: 'Listo' }).click();

    // En Inicio › Gastos internos el gasto aparece, pero sin botón de anular.
    await navTab(page, 'inicio').click();
    await page.getByText('Registrar Gasto').first().click();
    await page.getByText('Historial de Hoy').click();
    await expect(page.getByText(/Adelanto: Beto E2E/).first()).toBeVisible({ timeout: 10_000 });
    // El único gasto del día es el de nómina: no debe haber ningún botón de anular.
    await expect(page.locator('button[title="Anular gasto"]')).toHaveCount(0);
    await page.screenshot({ path: 'test-results/nomina-gastos-internos.png' });
});

// P-012 · F6: mercancía que se lleva el empleado, a precio de venta (opción de Ajustes).
test('Nómina: mercancía del empleado baja stock y saldo, y al anular vuelve todo', async ({ page }) => {
    await abrirNomina(page);
    const stock = async (id) => ((await readIdb(page, 'bodega_products_v1')) || []).find(p => p.id === id)?.stock;
    expect(await stock('p_caraota')).toBe(10);

    // Ajustes › Negocio › Nómina: de fábrica es «costo»; se cambia a «venta».
    await navTab(page, 'ajustes').click();
    await page.getByTestId('settings-tab-negocio').click();
    await expect(page.getByTestId('payroll-valuation-costo')).toHaveAttribute('aria-checked', 'true');
    await page.getByTestId('payroll-valuation-venta').click();
    await expect(page.getByTestId('payroll-valuation-venta')).toHaveAttribute('aria-checked', 'true');
    expect(await page.evaluate(() => localStorage.getItem('payroll_goods_valuation'))).toBe('venta');
    await page.getByTestId('payroll-valuation-venta').scrollIntoViewIfNeeded();
    await page.screenshot({ path: 'test-results/nomina-ajustes-mercancia.png' });
    await navTab(page, 'clientes').click();
    await page.getByTestId('gestion-tab-nomina').click();

    await page.getByTestId('employee-new').click();
    await page.getByTestId('employee-nombre').fill('Carla E2E');
    await page.getByTestId('employee-sueldo').fill('50');
    await page.getByTestId('payroll-pin').fill(PIN);
    await page.getByTestId('employee-save').click();
    await page.getByTestId('payroll-employee-row').filter({ hasText: 'Carla E2E' }).click();

    // Se lleva 2 Caraotas a precio de venta ($5 c/u).
    await page.getByTestId('payroll-action-MERCANCIA').click();
    await expect(page.getByTestId('payroll-goods-valuation')).toContainText('precio de venta');
    await page.getByTestId('payroll-goods-search').fill('caraota');
    await page.getByTestId('payroll-goods-result').first().click();
    await page.getByLabel('Cantidad de Caraota E2E').fill('2');
    await expect(page.getByTestId('payroll-goods-total')).toContainText('$10');
    await page.screenshot({ path: 'test-results/nomina-mercancia-form.png' });
    await page.getByTestId('payroll-pin').fill(PIN);
    await page.getByTestId('payroll-goods-submit').click();
    await expect(page.getByTestId('payroll-goods-done')).toContainText('$10');
    await page.getByRole('button', { name: 'Listo' }).click();

    await expect(page.getByTestId('payroll-detail-saldo')).toContainText('$40');
    await expect(page.getByTestId('payroll-detail')).toContainText('Mercancía');
    await expect(page.getByTestId('payroll-entry-row').filter({ hasText: 'Mercancía' })).toContainText('2 × Caraota E2E');
    expect(await stock('p_caraota')).toBe(8);
    const [mov] = await nominaMovs(page);
    expect(mov).toMatchObject({ isAutoconsumo: true, afectaCaja: false, category: 'nomina', totalUsd: -10, valoracion: 'venta' });
    await page.screenshot({ path: 'test-results/nomina-mercancia-detalle.png', fullPage: true });

    // Anular: el stock vuelve y el saldo también.
    const filaMerc = page.getByTestId('payroll-entry-row').filter({ hasText: 'Mercancía' });
    await filaMerc.getByTestId('payroll-entry-void').click();
    await page.getByTestId('payroll-pin').fill(PIN);
    await page.getByTestId('payroll-pin-confirm').click();
    await expect(filaMerc).toContainText('ANULADO');
    await expect(page.getByTestId('payroll-detail-saldo')).toContainText('$50');
    expect(await stock('p_caraota')).toBe(10);
    expect((await nominaMovs(page))[0]).toMatchObject({ status: 'ANULADA', stockDevuelto: true });
});
