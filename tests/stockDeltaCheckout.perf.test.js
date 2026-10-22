// tests/stockDeltaCheckout.perf.test.js — Gate de medición del PASO 4 del plan
// de stock delta (docs/plans/2026-10-21-plan-stock-delta-en-doc-de-venta.md):
//
//   "un ciclo de N cobros publica 0 bytes de catálogo y ~N docs de periodo
//    (los de la venta, ya inevitables)"
//
// La cadena es REAL de punta a punta; solo se simulan las fronteras de red y
// sesión (el transporte de Supabase graba cada upsert con sus bytes):
//
//   processSaleTransaction (checkout real)
//     → storageService REAL (localforage real del navegador)
//       → queueCloudSync / _debouncePush REALES (debounce de 3 s)
//         → pushCloudSync REAL (envelope + hash + familia de ventas)
//           → transporte grabador (mismo trabajo de serialización que supabase-js)
//
// El motor se activa montando el hook real `useCloudSync` con sesión + pairing
// simulados en las fronteras: es la misma vía de producción que pone
// `isCloudSyncActive` en true (sin ella todo push se salta y la medición sería
// vacía). El warm-up del motor (snapshot de pairing, que SÍ publica el catálogo
// una vez) ocurre ANTES de abrir la ventana de medición.
//
// Control positivo: al final, la escritura LEGACY del catálogo (sin
// `skipSyncPush`, como hacía el call-site antes de la Fase 1) sí publica el
// catálogo completo — el detector no está ciego, el 0 es por la bandera.
import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { renderHook, act } from '@testing-library/react';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ── Transporte grabador + bus mínimo de Supabase ────────────────────────────
const h = vi.hoisted(() => ({ upserts: [] }));

vi.mock('../src/config/supabaseCloud', () => {
    const from = () => {
        const api = {
            select: () => api,
            eq: () => api,
            in: () => api,
            order: () => api,
            limit: () => api,
            delete: () => api,
            upsert: async (document) => {
                const body = JSON.stringify(document); // serialización real del transporte
                h.upserts.push({ doc_id: document.doc_id, bytes: body.length, document });
                return { data: [document], error: null };
            },
            then: (resolve, reject) => Promise.resolve({ data: [], error: null }).then(resolve, reject),
        };
        return api;
    };
    return {
        supabaseCloud: {
            from,
            channel: () => {
                const ch = {
                    on() { return ch; },
                    subscribe(cb) { queueMicrotask(() => cb?.('SUBSCRIBED')); return ch; },
                };
                return ch;
            },
            removeChannel: () => Promise.resolve(),
            rpc: async () => ({ data: null, error: null }),
        },
    };
});

// ── Fronteras de sesión/pairing (plomería del test, no la lógica bajo prueba) ─
vi.mock('../src/services/supervisorAuth', () => ({
    ensureSupervisorSession: vi.fn(async () => ({ session: { user: { id: 'auth-perf' } }, error: null })),
}));
vi.mock('../src/utils/deviceIdentity', () => ({
    ensureDeviceSessionRegistered: vi.fn(async () => ({ ok: true })),
}));
vi.mock('../src/services/supervisorPairingState', () => ({
    readPairingRow: vi.fn(async () => ({ data: { monitor_device_id: 'MON-PERF' }, error: null })),
    isPrimaryPairingActive: vi.fn(() => true),
}));
vi.mock('../src/components/Toast', () => ({ showToast: vi.fn() }));
vi.mock('../src/hooks/store/useAuthStore', () => ({
    useAuthStore: {
        getState: () => ({ usuarioActivo: { id: 'perf-user', nombre: 'Tester', rol: 'ADMIN' } }),
    },
}));
vi.mock('../src/services/auditService', () => ({ logEvent: vi.fn(() => Promise.resolve()) }));

import { useCloudSync, isSalesSyncDocId } from '../src/hooks/useCloudSync';
import { storageService } from '../src/utils/storageService';
import { processSaleTransaction } from '../src/utils/checkoutProcessor';

const DEVICE_ID = 'PDA-V2-PERFMEASURE';
const PRODUCTS_KEY = 'bodega_products_v1';
const SALES_KEY = 'bodega_sales_v1';
const CATALOG_HASH_KEY = 'bodega_last_periodic_push_hash_bodega_products_v1';
const DEBOUNCE_FLUSH_MS = 3350; // debounce pesado (3000 ms) + margen de timer
const N_COBROS = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Catálogo: el backup real (2434 productos ≈ 1.32 MB) si existe, si no uno sintético ──
const BACKUP_PATH = path.resolve(
    process.cwd(),
    'backups/supabase/backup_sodgzkablshladvbtnes_2026-10-19T01-11-34-291Z.json',
);

function loadBackupCatalog() {
    const raw = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
    const docs = (raw.tables?.sync_documents || []).filter((d) => Array.isArray(d.data?.payload));
    const heaviest = docs
        .filter((d) => d.doc_id === PRODUCTS_KEY)
        .map((d) => d.data.payload)
        .sort((a, b) => JSON.stringify(b).length - JSON.stringify(a).length)[0];
    return heaviest || null;
}

function syntheticCatalog() {
    return Array.from({ length: 400 }, (_, i) => ({
        id: `p${i}`,
        name: `Producto de prueba ${i} ${'x'.repeat(40)}`,
        barcode: `759${String(i).padStart(10, '0')}`,
        category: 'General',
        stock: 50 + (i % 20),
        priceUsd: 1 + (i % 7),
        costUsd: 0.5,
        isWeight: false,
        isActive: true,
    }));
}

// Productos NO granel con precio para el carrito (el descuento de stock es la
// mecánica bajo prueba, no el modo granel — ese ya cubierto en granelSaleVoidE2E).
function pickCartProducts(catalog, count) {
    const candidates = catalog.filter((p) => (
        typeof p.name === 'string'
        && Number(p.priceUsd) > 0
        && Number.isFinite(Number(p.stock))
        && !p.isWeight
        && p.packagingType !== 'granel'
    ));
    expect(candidates.length).toBeGreaterThanOrEqual(count);
    return candidates.slice(0, count);
}

function checkoutOpts(catalog, items) {
    const cart = items.map((p) => ({ ...p, qty: 1, _originalId: p.id }));
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
        products: catalog,
        effectiveRate: 40,
        tasaCop: 0,
        copEnabled: false,
        discountData: null,
        useAutoRate: false,
        granelUnitMode: 'kg_lt',
    };
}

let unmountHook = null;

afterEach(async () => {
    if (unmountHook) {
        await act(async () => { unmountHook(); });
        unmountHook = null;
    }
});

describe('stock delta · N cobros publican 0 bytes de catálogo (cadena real)', () => {
    it('mide 0 docs / 0 bytes de catálogo y ~N docs de periodo de venta, y el detector no está ciego', async () => {
        const catalog = (fs.existsSync(BACKUP_PATH) ? loadBackupCatalog() : null) || syntheticCatalog();
        const catalogChars = JSON.stringify(catalog).length;

        // ── 1. Semilla SIN encolar (skipSyncPush): el motor aún no está montado,
        //    y las escrituras de semilla no deben contaminar la medición. ──
        await storageService.setItem(PRODUCTS_KEY, catalog, { skipSyncPush: true });
        await storageService.setItem(SALES_KEY, [], { skipSyncPush: true });

        // ── 2. Motor REAL activado por la vía de producción (sesión + pairing). ──
        const { unmount } = renderHook(() => useCloudSync(DEVICE_ID));
        unmountHook = unmount;

        // Warm-up: el snapshot de pairing SÍ publica el catálogo una vez (diseño).
        // Se espera a que el hash de push confirme que terminó y se abre la ventana.
        await act(async () => {
            const deadline = Date.now() + 10_000;
            while (Date.now() < deadline && localStorage.getItem(CATALOG_HASH_KEY) == null) {
                await sleep(50);
            }
        });
        expect(localStorage.getItem(CATALOG_HASH_KEY)).not.toBeNull();
        await act(async () => { await sleep(150); });
        h.upserts.length = 0; // ← ventana de medición abierta

        // ── 3. N cobros espaciados (cada uno con su ventana de debounce). ──
        const cartProducts = pickCartProducts(catalog, 2);
        const saleIds = [];
        const soldByProduct = new Map();
        for (let i = 0; i < N_COBROS; i += 1) {
            const item = cartProducts[i % cartProducts.length];
            soldByProduct.set(item.id, (soldByProduct.get(item.id) || 0) + 1);
            let result;
            await act(async () => {
                result = await processSaleTransaction(checkoutOpts(catalog, [item]));
            });
            expect(result.success, `cobro ${i} falló: ${result?.error}`).toBe(true);
            saleIds.push(result.sale.id);
            await act(async () => { await sleep(DEBOUNCE_FLUSH_MS); });
        }

        // ── 4. La medición. ──
        const catalogUpserts = h.upserts.filter((u) => u.doc_id === PRODUCTS_KEY);
        const catalogBytes = catalogUpserts.reduce((sum, u) => sum + u.bytes, 0);
        const salesUpserts = h.upserts.filter((u) => isSalesSyncDocId(u.doc_id));
        const salesBytes = salesUpserts.reduce((sum, u) => sum + u.bytes, 0);

        // EL GATE: cero docs y cero bytes de catálogo por los N cobros.
        expect(catalogUpserts).toHaveLength(0);
        expect(catalogBytes).toBe(0);

        // Los cobros SÍ publican sus registros de venta (lo inevitable): ~N docs
        // de periodo, uno por ventana de debounce, con los N viajes embebidos.
        expect(salesUpserts.length).toBe(N_COBROS);
        const lastPayload = salesUpserts[salesUpserts.length - 1].document.data.payload;
        expect(lastPayload.map((r) => r.id).sort()).toEqual([...saleIds].sort());
        for (const record of lastPayload) {
            expect(Array.isArray(record.stockEffects)).toBe(true);
            expect(record.stockEffects.length).toBeGreaterThan(0);
        }

        // Cada cobro también descontó el stock local (sanidad del flujo real).
        const after = await storageService.getItem(PRODUCTS_KEY, []);
        for (const item of cartProducts) {
            const sold = after.find((p) => p.id === item.id);
            expect(Number(sold.stock)).toBe(Number(item.stock) - (soldByProduct.get(item.id) || 0));
        }

        console.log(
            `[PERF] ${N_COBROS} cobros → catálogo: 0 docs / 0 bytes publicados `
            + `(catálogo local intacto: ${catalogChars} chars); `
            + `ventas: ${salesUpserts.length} docs / ${salesBytes} bytes (${N_COBROS} registros)`,
        );

        // ── 5. Control positivo: el detector no está ciego. La escritura LEGACY
        //    del catálogo (sin skipSyncPush — el call-site de antes de la Fase 1)
        //    sí publica el catálogo completo. Si este control falla, el 0 de arriba
        //    sería vacío y el gate no probaría nada. ──
        await storageService.setItem(PRODUCTS_KEY, after); // SIN opciones = se encola (el catálogo cambió vs el hash del warm-up)
        await act(async () => { await sleep(DEBOUNCE_FLUSH_MS); });

        const controlUpserts = h.upserts.filter((u) => u.doc_id === PRODUCTS_KEY);
        expect(controlUpserts).toHaveLength(1);
        expect(controlUpserts[0].bytes).toBeGreaterThan(50_000);
        console.log(
            `[PERF] control positivo (escritura legacy del catálogo) → `
            + `${controlUpserts.length} doc / ${controlUpserts[0].bytes} bytes — el detector ve los bytes que el gate dice que no hay`,
        );
    }, 90_000);
});
