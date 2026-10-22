// @vitest-environment jsdom
//
// ¿Cuánto del «cuelgue» de la caja es RED y cuánto es CPU? Medido en staging
// (wapczm) con la MISMA telemetría de ACK que corre en la caja
// (`markAckTelemetry`/`finishAckTelemetry` → entradas `supervisor_ack_telemetry_v1`
// y logs `[AckLatency]`), sin tocar código de producto.
//
// Metodología: se ejecuta el flujo receptor REAL (applySupervisorProductCommand,
// applySupervisorInventoryBatchTransaction, pushCloudSync, ackCommand) sobre los
// datos reales del backup de producción, cableado como las Fases 1–2 del plan
// (solo la fase local bajo pos_write_lock; ACK y publicación fuera), DOS veces.
// `lockMsAntes` reconstruye lo que el lock retenía antes del fix para comparar:
//   - modo 'cpu':    el transporte resuelve al instante → todo el tiempo es
//                    CPU + persistencia local (serializar, clonar, hashear).
//   - modo 'staging': cada upsert y el round-trip del ACK van por HTTP REAL al
//                    proyecto wapczmlwljkrjtfhmqko → tiempo CPU + red.
// La diferencia es la RED. Los hitos salen del módulo real de telemetría con el
// mismo cableado de `useRemoteCommands` (processing_start → local_applied →
// publish_end → ack_sent/ack_confirmed); `lockMs` es la ventana que retiene
// `pos_write_lock` HOY y `lockMsAntes` la que retenía antes del fix
// (docs/plans/2026-10-21-plan-fix-cuelgue-caja-comandos-supervisor.md).
//
// Convención de pruebas seguras contra staging (SUPERVISOR-E2E-STAGING.md):
//   - solo corre con SUPERVISOR_STAGING_E2E=true
//   - device_id sintético `e2e-test-ackperf-*`; limpieza obligatoria al final
//   - las keys viajan por env y jamás se imprimen
import { afterAll, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
    markAckTelemetry,
    finishAckTelemetry,
    flushAckTelemetry,
} from '../src/services/supervisorAckTelemetry';
import { ackCommand } from '../src/hooks/useRemoteCommands';
import {
    applySupervisorInventoryBatchTransaction,
    retryInventoryPublish,
} from '../src/services/supervisorInventoryCommand';
import {
    applySupervisorProductCommand,
    buildProductRevision,
} from '../src/services/supervisorProductCommand';
import { pushCloudSync } from '../src/hooks/useCloudSync';
import { isGranelProduct } from '../src/utils/granel';

// ── Transporte conmutable: instantáneo (CPU) o HTTP real a staging ──────────
const { RUN, SERVICE_KEY, STAGING_URL, DEVICE_ID, restHeaders, transport } = vi.hoisted(() => {
    const run = process.env.SUPERVISOR_STAGING_E2E === 'true';
    const serviceKey = process.env.SUPABASE_STAGING_SERVICE_KEY || '';
    const stagingUrl = (process.env.SUPABASE_STAGING_URL || process.env.VITE_SUPABASE_STAGING_URL || '').replace(/\/$/, '');
    return {
        RUN: run,
        SERVICE_KEY: serviceKey,
        STAGING_URL: stagingUrl,
        DEVICE_ID: `e2e-test-ackperf-${Date.now().toString(36)}`,
        restHeaders: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
        },
        transport: { mode: 'cpu', uploadedBytes: 0, uploadedDocs: 0, httpRequests: 0 },
    };
});

vi.mock('../src/config/supabaseCloud', () => ({
    supabaseCloud: {
        from: (table) => ({
            upsert: async (document, options = {}) => {
                // Serialización del transporte SIEMPRE real (igual que supabase-js).
                const body = JSON.stringify(document);
                transport.uploadedBytes += body.length;
                transport.uploadedDocs += 1;
                if (transport.mode === 'cpu') return { data: [document], error: null };
                transport.httpRequests += 1;
                const response = await fetch(
                    `${STAGING_URL}/rest/v1/${table}?on_conflict=${options.onConflict || 'device_id,collection,doc_id'}`,
                    {
                        method: 'POST',
                        headers: { ...restHeaders, Prefer: 'resolution=merge-duplicates,return=representation' },
                        body,
                    },
                );
                if (!response.ok) {
                    return { data: null, error: { message: `${response.status}: ${await response.text()}` } };
                }
                return { data: await response.json(), error: null };
            },
        }),
        // El ack RPC real es una fila + trigger: se modela con un round-trip HTTP
        // real al mismo proyecto (misma red, sin necesidad de una orden creada).
        rpc: async () => {
            if (transport.mode === 'cpu') return { data: null, error: null };
            transport.httpRequests += 1;
            const response = await fetch(
                `${STAGING_URL}/rest/v1/sync_documents?select=id&limit=1`,
                { headers: restHeaders },
            );
            return { data: null, error: response.ok ? null : { message: `rpc ${response.status}` } };
        },
        channel: () => ({ on: () => ({ subscribe: () => {} }) }),
        removeChannel: () => {},
    },
    supabaseCloudUrl: STAGING_URL,
}));

// ── Backup real (misma puerta que los otros tests de medición) ──────────────
const BACKUP_PATH = path.resolve(
    process.cwd(),
    'backups/supabase/backup_sodgzkablshladvbtnes_2026-10-19T01-11-34-291Z.json',
);
const hasBackup = fs.existsSync(BACKUP_PATH);
const realStringify = JSON.stringify.bind(JSON);

function loadBackup() {
    const raw = JSON.parse(fs.readFileSync(BACKUP_PATH, 'utf8'));
    const docs = (raw.tables?.sync_documents || []).filter((d) => Array.isArray(d.data?.payload));
    const heaviest = (docId) => docs
        .filter((d) => d.doc_id === docId)
        .map((d) => ({ payload: d.data.payload, bytes: realStringify(d.data.payload).length }))
        .sort((a, b) => b.bytes - a.bytes)[0] || { payload: [], bytes: 0 };
    return {
        products: heaviest('bodega_products_v1').payload,
        sales: heaviest('bodega_sales_v1').payload,
    };
}

// ── Storage con el mismo perfil de clonado que storageService/localforage ───
function makeStorage(initial = {}) {
    const map = new Map(Object.entries(initial));
    const clone = (value) => globalThis.structuredClone(value);
    return {
        async getItem(key, defaultValue = null) {
            return map.has(key) ? clone(map.get(key)) : defaultValue;
        },
        async setItem(key, value) {
            const current = map.has(key) ? clone(map.get(key)) : null;
            if (Array.isArray(current) && current.length > 0) clone(current); // sombra
            map.set(key, clone(value));
        },
        async removeItem(key) {
            map.delete(key);
        },
    };
}

function makePayloadLines(products, count) {
    return products
        .filter((p) => !isGranelProduct(p) && Number.isFinite(Number(p.stock)) && Number(p.stock) >= 0)
        .slice(0, count)
        .map((p, i) => ({
            lineId: String(i),
            productId: String(p.id),
            expectedStock: Number(p.stock || 0),
            quantityInput: 1,
            inputUnit: 'unidades',
            unitsPerPackage: 1,
        }));
}

const now = () => performance.now();

/**
 * Escenario A — edit de producto, exactamente como applyProductCommand:
 * la sección entre t0 y tLockEnd es lo que HOY corre bajo pos_write_lock
 * (getItem → apply → setItem → push+publish_end); el ACK va después (L602).
 */
async function runProductEdit() {
    const { products } = loadBackup();
    const storage = makeStorage({ bodega_products_v1: products, bodega_sales_v1: [] });
    const commandId = `e2e-test-ackperf-product-${Date.now().toString(36)}`;
    const target = products.find((p) => !isGranelProduct(p) && Number.isFinite(Number(p.stock)));
    const payload = {
        action: 'edit',
        product: { id: target.id, name: target.name, priceCop: Number(target.priceCop || 0) + 1 },
        baseRevision: buildProductRevision(target),
    };

    markAckTelemetry(commandId, 'processing_start', { type: 'product_edit', deviceId: DEVICE_ID });
    const t0 = now();
    // ── Fase 1: bajo pos_write_lock SOLO la fase local ──
    const currentProducts = await storage.getItem('bodega_products_v1', []);
    const result = applySupervisorProductCommand(currentProducts, payload);
    await storage.setItem('bodega_products_v1', result.products);
    markAckTelemetry(commandId, 'local_applied');
    const tLockEnd = now();
    // ── FUERA del lock (el «Cobrar» no espera la red): publicación + ACK ──
    let pushResult;
    try {
        pushResult = await pushCloudSync('bodega_products_v1', result.products, true, true, DEVICE_ID);
    } finally {
        markAckTelemetry(commandId, 'publish_end');
    }
    await ackCommand(commandId, 'applied', {
        commandId,
        productId: payload.product.id,
        action: 'edit',
        status: 'applied',
    });
    const entry = finishAckTelemetry(commandId, { status: 'applied' });
    await flushAckTelemetry();

    return { entry, lockMs: tLockEnd - t0, pushOk: pushResult.ok };
}

/**
 * Escenario B — lote de inventario, exactamente como applyInventoryBatchCommand:
 * TODO corre bajo pos_write_lock hoy, INCLUIDO el ACK (onLocalApplied →
 * ackCommand, L319) y el retryInventoryPublish final.
 */
async function runInventoryBatch() {
    const { products, sales } = loadBackup();
    const storage = makeStorage({ bodega_products_v1: products, bodega_sales_v1: sales });
    const commandId = `e2e-test-ackperf-batch-${Date.now().toString(36)}`;
    const payload = {
        direction: 'ingreso',
        reason: 'ingreso de mercancía',
        lotReference: 'ACKPERF-1',
        lines: makePayloadLines(products, 20),
    };

    markAckTelemetry(commandId, 'processing_start', { type: 'inventory_batch', deviceId: DEVICE_ID });
    const t0 = now();
    // ── Fase 2: bajo pos_write_lock SOLO la fase local (journal incluido) ──
    let ackPayload = null;
    const adjustment = await applySupervisorInventoryBatchTransaction({
        storage,
        pushSync: async (key, value, force) => {
            try {
                return await pushCloudSync(key, value, force, true, DEVICE_ID);
            } finally {
                markAckTelemetry(commandId, 'publish_end');
            }
        },
        payload,
        commandId,
        deferPublish: true,
        onLocalApplied: async (applied) => {
            markAckTelemetry(commandId, 'local_applied', { acknowledgedEarly: true });
            ackPayload = {
                commandId,
                productId: payload.lines[0].productId,
                unitsDelta: applied.unitsDelta,
                stockBefore: applied.stockBefore,
                stockAfter: applied.stockAfter,
                status: 'applied',
            };
        },
    });
    const tLockEnd = now();
    // ── FUERA del lock: ACK temprano + publicación (journal 'published_pending')
    await ackCommand(commandId, 'applied', ackPayload);
    await retryInventoryPublish({
        storage,
        pushSync: async (key, value, force) => {
            try {
                return await pushCloudSync(key, value, force, true, DEVICE_ID);
            } finally {
                markAckTelemetry(commandId, 'publish_end');
            }
        },
    });
    const entry = finishAckTelemetry(commandId, {
        status: adjustment.status,
        acknowledgedEarly: true,
    });
    await flushAckTelemetry();

    return { entry, lockMs: tLockEnd - t0, status: adjustment.status };
}

function phaseMs(entry, from, to) {
    const a = entry?.marks?.[from];
    const b = entry?.marks?.[to];
    return Number.isFinite(a) && Number.isFinite(b) ? b - a : null;
}

function report(label, run) {
    const { entry, lockMs } = run;
    const m = entry?.metrics || {};
    const localMs = Math.round(m.localDurableMs ?? NaN);
    const publishMs = Math.round(phaseMs(entry, 'local_applied', 'publish_end') ?? NaN);
    const ackMs = Math.round(phaseMs(entry, 'ack_sent', 'ack_confirmed') ?? NaN);
    // lockMsAntes = lo que el lock retenía ANTES de las Fases 1–2 (fase local +
    // ACK + publicación para lotes; fase local + publicación para productos).
    // lockMs = lo que retiene HOY (solo fase local: la red quedó fuera).
    const lockMsAntes = label.startsWith('lote')
        ? localMs + ackMs + publishMs
        : localMs + publishMs;
    return {
        escenario: label,
        localMs,
        publishMs,
        ackMs,
        lockMsAntes,
        lockMs: Math.round(lockMs),
        ackLeadMs: Math.round(m.ackLeadMs ?? NaN),
    };
}

const skip = !RUN || !SERVICE_KEY || !STAGING_URL || !hasBackup;

describe.skipIf(skip)('red vs CPU por comando del supervisor (telemetría de ACK real, staging wapczm)', () => {
    afterAll(async () => {
        if (skip) return;
        await fetch(`${STAGING_URL}/rest/v1/sync_documents?device_id=eq.${DEVICE_ID}`, {
            method: 'DELETE',
            headers: { ...restHeaders, Prefer: 'return=minimal' },
        });
    });

    it('edit de producto: separa CPU (instant) de red (staging) con los hitos reales', async () => {
        // Calentamiento (JIT + clonados) fuera de la medición.
        transport.mode = 'cpu';
        await runProductEdit();

        transport.mode = 'cpu';
        transport.uploadedBytes = 0;
        transport.uploadedDocs = 0;
        const cpu = await runProductEdit();

        transport.mode = 'staging';
        transport.uploadedBytes = 0;
        transport.uploadedDocs = 0;
        transport.httpRequests = 0;
        const staging = await runProductEdit();

        const rowCpu = report('producto/cpu', cpu);
        const rowNet = report('producto/staging', staging);
        console.info('[AckTelemetrySplit] edit de producto', {
            cpu: rowCpu,
            staging: rowNet,
            red_ms: rowNet.publishMs - rowCpu.publishMs, // ventana de red (fuera del lock)
            lock_antes_ms: rowNet.lockMsAntes,
            lock_hoy_ms: rowNet.lockMs,
            subido_MB: (transport.uploadedBytes / 1e6).toFixed(2),
            http_requests: transport.httpRequests,
        });

        expect(cpu.entry).toBeTruthy();
        expect(staging.entry).toBeTruthy();
        // Contrato de producto: el ACK nunca PRECEDE a la publicación. La
        // telemetría tiene resolución de 1 ms: si el ACK sale en el mismo
        // milisegundo que publish_end, ackLeadMs es 0 y no negativo.
        expect(staging.entry.metrics.ackLeadMs).toBeLessThanOrEqual(0);
        // La ventana de red (fuera del lock) es real: staging ≫ instantáneo.
        expect(rowNet.publishMs).toBeGreaterThan(rowCpu.publishMs);
        expect(transport.httpRequests).toBeGreaterThan(0);
    }, 240_000);

    it('lote de inventario: separa CPU (instant) de red (staging) con los hitos reales', async () => {
        transport.mode = 'cpu';
        await runInventoryBatch(); // calentamiento

        transport.mode = 'cpu';
        transport.uploadedBytes = 0;
        transport.uploadedDocs = 0;
        const cpu = await runInventoryBatch();

        transport.mode = 'staging';
        transport.uploadedBytes = 0;
        transport.uploadedDocs = 0;
        transport.httpRequests = 0;
        const staging = await runInventoryBatch();

        const rowCpu = report('lote/cpu', cpu);
        const rowNet = report('lote/staging', staging);
        console.info('[AckTelemetrySplit] lote de inventario 20 líneas', {
            cpu: rowCpu,
            staging: rowNet,
            red_ms: rowNet.publishMs - rowCpu.publishMs, // ventana de red (fuera del lock)
            lock_antes_ms: rowNet.lockMsAntes,
            lock_hoy_ms: rowNet.lockMs,
            subido_MB: (transport.uploadedBytes / 1e6).toFixed(2),
            http_requests: transport.httpRequests,
        });

        expect(cpu.entry).toBeTruthy();
        expect(staging.entry).toBeTruthy();
        // Contrato de lote: el ACK es temprano (ackLeadMs positivo: ACK antes de publicar).
        expect(staging.entry.metrics.ackLeadMs).toBeGreaterThan(0);
        expect(staging.status).toBe('applied');
        expect(rowNet.publishMs).toBeGreaterThan(rowCpu.publishMs);
        expect(transport.httpRequests).toBeGreaterThan(0);
    }, 240_000);
});
