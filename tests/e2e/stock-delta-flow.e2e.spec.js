/**
 * stock-delta-flow.e2e.spec.js — Paso 4 del plan de stock delta: el flujo real
 * de cobro/anulación con los efectos de stock viajando DENTRO del documento de
 * venta, en un navegador de verdad.
 *
 * ¿Qué prueba que los unitarios no pueden?
 *  - Persistencia real: IndexedDB de verdad (localforage, store 'bodega_app_data'),
 *    no un storage falso en memoria.
 *  - La costura real de publicación: la escritura del catálogo cruza
 *    `storageService.setItem` con `skipSyncPush: true` (no republica el catálogo
 *    por cada cobro) mientras la escritura de ventas SÍ se encola — observado
 *    envolviendo el objeto REAL de storageService, misma instancia que usan los
 *    procesadores (la medición de bytes vive en tests/stockDeltaCheckout.perf.test.js).
 *  - Durabilidad: un reload de la página destruye el contexto JS y el estado
 *    persistido sobrevive idéntico (efectos incluidos).
 *  - La invariante del lector/monitor: `reconcileStockFromEffects` (función real)
 *    sobre el baseline + los efectos embebidos reproduce EXACTAMENTE el stock
 *    persistido — incluso con la venta anulada (su log append-only suma el
 *    inverso y la red queda en 0).
 *
 * La app no interviere: red externa neutralizada y se importan los módulos
 * reales del dev server de Vite (/src/...), igual que el e2e de inventario.
 */
import { test, expect } from '@playwright/test';
import { neutralizeExternalNetwork } from './helpers/seedBrowserState.js';

const PRODUCTS_KEY = 'bodega_products_v1';
const SALES_KEY = 'bodega_sales_v1';

// Un producto entero, otro entero y uno a granel (decimales de 3 cifras).
const SEED_PRODUCTS = [
    {
        id: 'p_cafe', name: 'Cafe E2E', category: 'abastos', stock: 50,
        costUsd: 1, priceUsd: 2, priceUsdt: 2, isWeight: false, barcode: 'E2ECAFE1',
    },
    {
        id: 'p_harina', name: 'Harina E2E', category: 'abastos', stock: 30,
        costUsd: 0.5, priceUsd: 1, priceUsdt: 1, isWeight: false, barcode: 'E2EHARI1',
    },
    {
        id: 'p_queso', name: 'Queso E2E', category: 'abastos', stock: 55.5,
        costUsd: 3, priceUsd: 5, priceUsdt: 5, isWeight: true, unit: 'kg',
        granelUnit: 'kg', packagingType: 'granel', barcode: 'E2EQUES1',
    },
];

// stockAsOf anterior a cualquier efecto: el fold debe plegarlos todos.
const BASELINE_AS_OF = '2020-01-01T00:00:00.000Z';

async function setupPage(page) {
    await neutralizeExternalNetwork(page);
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    await page.evaluate(async () => {
        const [storageMod, checkoutMod, voidMod, syncMod, authMod] = await Promise.all([
            import('/src/utils/storageService.js'),
            import('/src/utils/checkoutProcessor.js'),
            import('/src/utils/voidSaleProcessor.js'),
            import('/src/hooks/useCloudSync.js'),
            import('/src/hooks/store/useAuthStore.js'),
        ]);
        window.__storage = storageMod.storageService;
        window.__checkout = checkoutMod;
        window.__void = voidMod;
        window.__reconcile = syncMod.reconcileStockFromEffects;
        authMod.useAuthStore.setState({
            usuarioActivo: { id: 'e2e-user', nombre: 'E2E', rol: 'ADMIN' },
        });

        // Semilla SIN encolar (el motor de sync está inactivo igualmente) y
        // envoltorio de observación sobre el objeto REAL de storageService.
        await window.__storage.setItem('bodega_products_v1', [], { skipSyncPush: true });
        await window.__storage.setItem('bodega_sales_v1', [], { skipSyncPush: true });

        // Estado del flujo compartido entre evaluaciones.
        window.__flow = { saleIds: [], writes: [] };
        const origSetItem = window.__storage.setItem.bind(window.__storage);
        window.__storage.setItem = (key, value, options) => {
            window.__flow.writes.push({ key, skipSyncPush: !!(options && options.skipSyncPush) });
            return origSetItem(key, value, options);
        };
    });
}

test.describe('Stock delta: flujo de cobro/anulación en navegador real', () => {
    test('los efectos viajan en la venta, el catálogo no se republica y la derivación cuadra tras recargar', async ({ page }) => {
        await setupPage(page);

        // ── Tres cobros reales + una anulación real sobre módulos del dev server ──
        const flow = await page.evaluate(async (seed) => {
            const saleOpts = (products, cart) => {
                const total = cart.reduce((sum, item) => sum + item.qty * Number(item.priceUsd), 0);
                return {
                    cart,
                    cartTotalUsd: total,
                    cartTotalBs: total * 40,
                    cartSubtotalUsd: total,
                    payments: [{ amountUsd: total, amountBs: 0, currency: 'USD', methodId: 'efectivo_usd', methodLabel: 'Efectivo $' }],
                    changeBreakdown: { changeUsdGiven: 0, changeBsGiven: 0 },
                    selectedCustomerId: null,
                    customers: [],
                    products,
                    effectiveRate: 40,
                    tasaCop: 0,
                    copEnabled: false,
                    discountData: null,
                    useAutoRate: false,
                    granelUnitMode: 'kg_lt',
                };
            };

            await window.__storage.setItem('bodega_products_v1', seed, { skipSyncPush: true });

            const runSale = async (productId, qty) => {
                const products = await window.__storage.getItem('bodega_products_v1', []);
                const product = products.find((p) => p.id === productId);
                const result = await window.__checkout.processSaleTransaction(
                    saleOpts(products, [{ ...product, qty, _originalId: product.id }]),
                );
                if (!result.success) throw new Error(`cobro falló: ${result.error}`);
                window.__flow.saleIds.push(result.sale.id);
                return result.sale;
            };

            // 1) unidad entera ×2 → 50 → 48; 2) unidad ×1 → 30 → 29;
            // 3) granel 0.35 kg → 55.5 → 55.15.
            await runSale('p_cafe', 2);
            await runSale('p_harina', 1);
            const granelSale = await runSale('p_queso', 0.35);

            // Anulación REAL de la venta a granel (la tramposa: decimales + log).
            const sales = await window.__storage.getItem('bodega_sales_v1', []);
            const products = await window.__storage.getItem('bodega_products_v1', []);
            const voidResult = await window.__void.processVoidSale(granelSale, sales, products);
            if (!voidResult?.success) throw new Error(`anulación falló: ${voidResult?.error}`);

            const finalSales = await window.__storage.getItem('bodega_sales_v1', []);
            const finalProducts = await window.__storage.getItem('bodega_products_v1', []);
            const derived = window.__reconcile(seed, finalSales, '2020-01-01T00:00:00.000Z');

            return {
                saleIds: window.__flow.saleIds,
                writes: window.__flow.writes,
                finalSales,
                finalProducts,
                derived,
                voidedId: granelSale.id,
            };
        }, SEED_PRODUCTS);

        // ── Los efectos viajan embebidos en cada venta ──
        const byId = new Map(flow.finalSales.map((s) => [s.id, s]));
        expect(byId.get(flow.saleIds[0]).stockEffects).toEqual([
            { productId: 'p_cafe', delta: -2, stockBefore: 50, stockAfter: 48, at: expect.any(String) },
        ]);
        expect(byId.get(flow.saleIds[1]).stockEffects).toEqual([
            { productId: 'p_harina', delta: -1, stockBefore: 30, stockAfter: 29, at: expect.any(String) },
        ]);

        // ── La anulación agrega el inverso al log (append-only) del reemplazo ──
        const voided = byId.get(flow.voidedId);
        expect(voided.status).toBe('ANULADA');
        expect(voided.stockEffects).toEqual([
            { productId: 'p_queso', delta: -0.35, stockBefore: 55.5, stockAfter: 55.15, at: expect.any(String) },
            { productId: 'p_queso', delta: 0.35, stockBefore: 55.15, stockAfter: 55.5, at: expect.any(String) },
        ]);

        // ── Stock persistido: entero estricto y granel a 3 decimales, exacto ──
        const stockOf = (id) => Number(flow.finalProducts.find((p) => p.id === id).stock);
        expect(stockOf('p_cafe')).toBe(48);
        expect(stockOf('p_harina')).toBe(29);
        expect(stockOf('p_queso')).toBe(55.5); // 55.5 − 0.35 + 0.35, bit a bit

        // ── Costura de publicación: el catálogo NO se republica, las ventas sí ──
        const productWrites = flow.writes.filter((w) => w.key === PRODUCTS_KEY);
        const saleWrites = flow.writes.filter((w) => w.key === SALES_KEY);
        expect(productWrites.length).toBeGreaterThanOrEqual(4); // 3 cobros + anulación
        expect(productWrites.every((w) => w.skipSyncPush)).toBe(true);
        expect(saleWrites.length).toBeGreaterThanOrEqual(4);
        expect(saleWrites.some((w) => w.skipSyncPush)).toBe(false);

        // ── Invariante del lector/monitor: baseline + efectos = stock persistido ──
        // La venta anulada ya no descuenta: su log suma −0.35 y +0.35 (red 0).
        for (const product of flow.finalProducts) {
            const derivedStock = Number(flow.derived.find((p) => p.id === product.id).stock);
            expect(derivedStock).toBe(Number(product.stock));
        }

        // ── Durabilidad: el reload destruye el contexto JS y todo sobrevive ──
        const beforeReload = JSON.stringify({ sales: flow.finalSales, products: flow.finalProducts });
        await page.reload();
        await page.waitForLoadState('domcontentloaded');
        const afterReload = await page.evaluate(async () => {
            const storageMod = await import('/src/utils/storageService.js');
            const sales = await storageMod.storageService.getItem('bodega_sales_v1', []);
            const products = await storageMod.storageService.getItem('bodega_products_v1', []);
            return JSON.stringify({ sales, products });
        });
        expect(afterReload).toBe(beforeReload);
    });
});
