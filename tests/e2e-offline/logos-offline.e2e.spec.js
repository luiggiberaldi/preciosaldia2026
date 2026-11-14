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

