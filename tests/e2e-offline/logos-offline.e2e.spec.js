// Logos e imágenes de marca SIN INTERNET (plan docs/plans/2026-11-14-plan-logos-offline.md).
// Abre la app con internet para que el service worker guarde todo, corta la red, recarga
// y comprueba que ninguna imagen visible quedó rota.
import { test, expect } from '@playwright/test';
import { seedAudit, navTab } from '../e2e/helpers/auditHarness.js';

async function brokenVisibleImages(page) {
    return page.evaluate(() => [...document.images]
        .filter((img) => img.offsetParent !== null)
        .filter((img) => !(img.complete && img.naturalWidth > 0))
        .map((img) => img.getAttribute('src')?.slice(0, 80)));
}

async function openOnlineThenOffline(page, context) {
    await page.goto('/');
    await expect(navTab(page, 'inicio')).toBeVisible({ timeout: 30_000 });
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await expect(navTab(page, 'inicio')).toBeVisible({ timeout: 30_000 });
    expect(await page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);
    await context.setOffline(true);
    await page.reload();
    await expect(navTab(page, 'inicio')).toBeVisible({ timeout: 30_000 });
    await page.waitForLoadState('load');
}

const CASES = [
    { name: 'PC, tema claro', width: 1440, height: 900, theme: 'light' },
    { name: 'PC, tema oscuro', width: 1440, height: 900, theme: 'dark' },
    { name: 'celular', width: 390, height: 844, theme: 'light' },
];

for (const c of CASES) {
    test(`sin internet no hay imágenes rotas en el inicio (${c.name})`, async ({ page, context }) => {
        await page.setViewportSize({ width: c.width, height: c.height });
        await seedAudit(page, { extraInitScripts: [`localStorage.setItem('theme', '${c.theme}');`] });
        await openOnlineThenOffline(page, context);

        const logo = page.locator('img[alt="Precios Al Día"]:visible').first();
        await expect(logo).toBeVisible();
        expect(await brokenVisibleImages(page)).toEqual([]);
    });
}

test('sin internet las letras de la app siguen disponibles', async ({ page, context }) => {
    await seedAudit(page);
    await openOnlineThenOffline(page, context);
    await page.evaluate(() => document.fonts.ready);
    // document.fonts.load devuelve las letras que sí cargó: vacío = no se pudo cargar.
    const missing = await page.evaluate(async () => {
        const fonts = ['700 16px Outfit', '400 16px "Work Sans"', '400 16px "JetBrains Mono"'];
        const loaded = await Promise.all(fonts.map((f) => document.fonts.load(f).catch(() => [])));
        return fonts.filter((f, i) => loaded[i].length === 0);
    });
    expect(missing).toEqual([]);
});

test('sin internet se ve el logo propio del negocio (Ajustes › Negocio)', async ({ page, context }) => {
    // PNG de 1×1 px: el logo propio vive en el equipo (localStorage), no depende de la red.
    const PNG_1PX = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedAudit(page, { extraInitScripts: [`localStorage.setItem('business_logo', '${PNG_1PX}');`] });
    await openOnlineThenOffline(page, context);

    const logo = page.locator('[data-testid="dashboard-header"] img[alt="Logo del negocio"]:visible');
    await expect(logo).toBeVisible();
    expect(await logo.getAttribute('src')).toBe(PNG_1PX);
    expect(await brokenVisibleImages(page)).toEqual([]);
});
