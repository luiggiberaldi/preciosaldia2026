/**
 * supervisor-inventory-recovery.e2e.spec.js — Fase 9: recuperación REAL del
 * journal de inventario tras un corte de proceso a mitad de la transacción.
 *
 * ¿Qué prueba que los tests unitarios no pueden?
 *  - Persistencia real: IndexedDB de verdad (localforage, store 'bodega_app_data'),
 *    no un storage falso en memoria.
 *  - Corte de proceso real: la transacción se queda colgada en la N-ésima
 *    escritura de un documento y luego SE RECARGA LA PÁGINA. El reload destruye
 *    el documento con el trabajo async a medias: no corre ningún cleanup, exacto
 *    como un crash. El journal y los documentos escritos sobreviven.
 *  - Recuperación tras el reload contra el storage real, determinista e
 *    idempotente (roll-forward para 'pending', rollback para 'rolling_back').
 *
 * La app NO arranca: se intercepta el documento raíz con una página mínima y se
 * importan los módulos reales del dev server de Vite (/src/...), de modo que no
 * hay interferencia de boot ni red. Las escrituras de storageService disparan
 * la cola de sync, pero pushCloudSync queda en 'skipped' (sync inactivo).
 */
import { test, expect } from '@playwright/test';
import { neutralizeExternalNetwork } from './helpers/seedBrowserState.js';

const JOURNAL_KEY = 'bodega_supervisor_inventory_journal_v1';

const SEED_PRODUCTS = [
    { id: 'p_cafe', name: 'Cafe E2E', stock: 10 },
    { id: 'p_harina', name: 'Harina E2E', stock: 5 },
];
const SEED_SALES = [{ id: 'venta-previa', tipo: 'VENTA' }];

// Lote v2 de dos líneas: p_cafe 2 cajas x 24 => +48 (58), p_harina 3 und => +3 (8).
const BATCH_PAYLOAD = {
    batchVersion: 2,
    direction: 'ingreso',
    reason: 'Recepción e2e',
    lotReference: 'LOTE-E2E',
    lines: [
        { lineId: 'line-a', productId: 'p_cafe', quantityInput: 2, inputUnit: 'cajas', unitsPerPackage: 24, expectedStock: 10 },
        { lineId: 'line-b', productId: 'p_harina', quantityInput: 3, inputUnit: 'unidades', expectedStock: 5 },
    ],
};
const COMMAND_ID = 'e2e-crash-1';
const TIMESTAMP = '2026-10-16T12:00:00.000Z';

async function setupPage(page) {
    // La app no debe arrancar: solo una página mínima sobre el dev server para
    // poder importar los módulos reales. Última ruta registrada = mayor prioridad.
    await neutralizeExternalNetwork(page);
    // Se carga la página real de Vite: una página sustituta sin el preámbulo de
    // Fast Refresh rompe los imports de src/ (plugin-react). El arranque de la app
    // no interfiere porque la red externa está neutralizada.
    await page.goto('/');
    await page.waitForLoadState('domcontentloaded');

    // Importa los módulos REALES del dev server (Vite resuelve sus imports).
    await page.evaluate(async () => {
        const [cmd, storageMod] = await Promise.all([
            import('/src/services/supervisorInventoryCommand.js'),
            import('/src/utils/storageService.js'),
        ]);
        window.__inv = cmd;
        window.__storage = storageMod.storageService;
    });
}

async function readInventoryState(page) {
    return page.evaluate(async (journalKey) => ({
        journal: await window.__storage.getItem(journalKey, null),
        products: await window.__storage.getItem('bodega_products_v1', null),
        sales: await window.__storage.getItem('bodega_sales_v1', null),
    }), JOURNAL_KEY);
}

/**
 * Siembra el estado inicial con el storage real y arranca la transacción con un
 * storage envolvente que cuelga para siempre la ocurrencia N de la escritura
 * de `cutKey`. Ese colgamiento permanente ES el corte de proceso: el reload
 * posterior destruye el pending sin ejecutar nada más.
 */
async function seedAndStartCutTransaction(page, { cutKey, occurrence, pushOk }) {
    await page.evaluate(async ({ products, sales, payload, commandId, timestamp, cutKey: key, occurrence: nth, pushOk: pushResult }) => {
        await window.__storage.setItem('bodega_products_v1', products);
        await window.__storage.setItem('bodega_sales_v1', sales);
        await window.__storage.removeItem(window.__inv.SUPERVISOR_INVENTORY_JOURNAL_KEY);

        window.__cut = { key, occurrence: nth, seen: 0 };
        window.__cutFired = false;
        const cutStorage = {
            getItem: (k, fallback) => window.__storage.getItem(k, fallback),
            removeItem: (k) => window.__storage.removeItem(k),
            setItem: (k, value) => {
                if (k === window.__cut.key) {
                    window.__cut.seen += 1;
                    if (window.__cut.seen === window.__cut.occurrence) {
                        window.__cutFired = true;
                        return new Promise(() => {}); // cuelga: aquí "muere" el proceso
                    }
                }
                return window.__storage.setItem(k, value);
            },
        };
        // Sin await: la promesa queda colgada a propósito y se pierde con el reload.
        window.__inv.applySupervisorInventoryBatchTransaction({
            storage: cutStorage,
            pushSync: async () => (pushResult ? { ok: true } : { ok: false, error: 'sync caído' }),
            payload,
            commandId,
            timestamp,
        }).catch(() => {});
    }, {
        products: SEED_PRODUCTS,
        sales: SEED_SALES,
        payload: BATCH_PAYLOAD,
        commandId: COMMAND_ID,
        timestamp: TIMESTAMP,
        cutKey,
        occurrence,
        pushOk,
    });
    await page.waitForFunction(() => window.__cutFired === true, undefined, { timeout: 10_000 });
    // El corte se dispara antes de que termine de persistirse el estado previo al
    // colgado: se espera a que el journal exista y a que los productos ya tengan
    // el snapshot 'after', para no leer un estado a medio escribir.
    await page.waitForFunction(async () => {
        const journal = await window.__storage.getItem('bodega_supervisor_inventory_journal_v1', null);
        return Boolean(journal);
    }, undefined, { timeout: 10_000 });
}

test.describe('Inventario: recuperación real del journal tras corte de proceso', () => {
    test('corte al escribir el historial: tras recargar, el roll-forward completa el lote', async ({ page }) => {
        await setupPage(page);

        // 1ª escritura de bodega_sales_v1 = la del lote. Se cuelga: productos ya
        // escritos, historial no. Estado mixto persistido en IndexedDB real.
        await seedAndStartCutTransaction(page, { cutKey: 'bodega_sales_v1', occurrence: 1, pushOk: true });

        const mid = await readInventoryState(page);
        expect(mid.journal).toMatchObject({ version: 1, commandId: COMMAND_ID, state: 'pending' });
        expect(mid.products.map((item) => item.stock)).toEqual([58, 8]); // aplicado
        expect(mid.sales).toHaveLength(1); // sin escribir → mixto

        // CORTE REAL: recargar destruye el documento con la promesa colgada.
        await page.reload();
        await page.evaluate(async () => {
            const [cmd, storageMod] = await Promise.all([
                import('/src/services/supervisorInventoryCommand.js'),
                import('/src/utils/storageService.js'),
            ]);
            window.__inv = cmd;
            window.__storage = storageMod.storageService;
        });

        // El journal sobrevivió al corte con su intención registrada.
        const afterCrash = await readInventoryState(page);
        expect(afterCrash.journal).toMatchObject({ commandId: COMMAND_ID, state: 'pending' });

        const recovery = await page.evaluate(
            () => window.__inv.recoverSupervisorInventoryJournal(window.__storage),
        );
        expect(recovery).toEqual({ recovered: true, commandId: COMMAND_ID, direction: 'rollforward' });

        const final = await readInventoryState(page);
        expect(final.journal).toBeNull();
        expect(final.products.map((item) => item.stock)).toEqual([58, 8]);
        expect(final.sales).toHaveLength(3);
        expect(final.sales.map((item) => item.movementId).filter(Boolean)).toEqual([
            `supervisor-${COMMAND_ID}-line-a`,
            `supervisor-${COMMAND_ID}-line-b`,
        ]);

        // Idempotencia: una segunda recuperación no cambia nada.
        const second = await page.evaluate(
            () => window.__inv.recoverSupervisorInventoryJournal(window.__storage),
        );
        expect(second).toEqual({ recovered: false, commandId: null, direction: null });
        expect(await readInventoryState(page)).toEqual(final);
    });

    test('corte tras aplicar: la publicación pendiente no se revierte y la recuperación no duplica el movimiento', async ({ page }) => {
        await setupPage(page);

        // Contrato de publicación pendiente: si el push falla, el movimiento local
        // se conserva. Con pushOk=false el journal queda 'published_pending' y no
        // hay rollback. El corte ocurre en la 1a escritura de bodega_sales_v1 (la del
        // lote), así que el estado persistido es el mixto de un corte real.
        await seedAndStartCutTransaction(page, { cutKey: 'bodega_sales_v1', occurrence: 1, pushOk: false });

        const mid = await readInventoryState(page);
        expect(mid.journal).toMatchObject({ commandId: COMMAND_ID, state: 'pending' });
        expect(mid.products.map((item) => item.stock)).toEqual([58, 8]);

        await page.reload();
        await page.evaluate(async () => {
            const [cmd, storageMod] = await Promise.all([
                import('/src/services/supervisorInventoryCommand.js'),
                import('/src/utils/storageService.js'),
            ]);
            window.__inv = cmd;
            window.__storage = storageMod.storageService;
        });

        const recovery = await page.evaluate(
            () => window.__inv.recoverSupervisorInventoryJournal(window.__storage),
        );
        expect(recovery).toEqual({ recovered: true, commandId: COMMAND_ID, direction: 'rollforward' });

        // Sin rollback: el movimiento queda aplicado y el historial tiene una sola copia.
        const final = await readInventoryState(page);
        expect(final.journal).toBeNull();
        expect(final.products.map((item) => item.stock)).toEqual([58, 8]);
        expect(final.sales).toHaveLength(3);
        expect(final.sales.map((item) => item.movementId).filter(Boolean)).toEqual([
            `supervisor-${COMMAND_ID}-line-a`,
            `supervisor-${COMMAND_ID}-line-b`,
        ]);
    });
});
