// @vitest-environment jsdom

// Gate de medición de la Fase 4: parte las ventas REALES del backup local de
// producción (backups/supabase/, descargado el 2026-10-19) con el plan de
// periodos real y exige que ningún documento supere el tope de ~500 KB.
// Si el backup no existe en este checkout la prueba se salta sola: es
// evidencia de medición, no una dependencia de la suite.
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
    buildSalesSyncPlan,
    mergeSalesSyncDoc,
    SALES_SYNC_BASE_KEY,
    SALES_SYNC_MAX_DOC_BYTES,
} from '../src/hooks/useCloudSync';

const BACKUP = path.resolve(
    process.cwd(),
    'backups/supabase/backup_sodgzkablshladvbtnes_2026-10-19T01-11-34-291Z.json',
);
const hasBackup = fs.existsSync(BACKUP);

function loadRealSalesDocs() {
    const raw = JSON.parse(fs.readFileSync(BACKUP, 'utf8'));
    return (raw.tables?.sync_documents || [])
        .filter((row) => row.doc_id === SALES_SYNC_BASE_KEY && Array.isArray(row.data?.payload))
        .map((row) => ({ deviceId: row.device_id, sales: row.data.payload }));
}

describe.skipIf(!hasBackup)('medición Fase 4 con ventas reales del backup local', () => {
    it('ningún documento de las ventas reales supera el tope de ~500 KB', () => {
        const docs = loadRealSalesDocs();
        expect(docs.length).toBeGreaterThan(0);

        const summary = [];
        for (const { deviceId, sales } of docs) {
            const beforeBytes = JSON.stringify(sales).length;
            const plan = buildSalesSyncPlan(sales);

            for (const slice of plan) {
                expect(JSON.stringify(slice.records).length).toBeLessThan(SALES_SYNC_MAX_DOC_BYTES);
            }

            // Round-trip real: la partición no pierde ni duplica ventas.
            const merged = plan.flatMap((slice) => slice.records);
            expect(new Set(merged.map((r) => r.id)).size).toBe(sales.length);

            // El merge del lector reconstruye exactamente las ventas reales.
            let local = [];
            for (const slice of plan) {
                local = mergeSalesSyncDoc(local, slice.docId, slice.records);
            }
            expect(new Set(local.map((r) => r.id)).size).toBe(sales.length);

            summary.push(
                `${deviceId.slice(0, 12)}… ${sales.length} ventas | monolítico ${(beforeBytes / 1024).toFixed(1)}KB → ${plan.length} docs [` +
                plan.map((s) => `${s.docId.replace(SALES_SYNC_BASE_KEY, 'sales')}: ${(JSON.stringify(s.records).length / 1024).toFixed(1)}KB`).join(', ') +
                ']',
            );
        }
        console.info(`[Fase 4] medición antes/después:\n${summary.join('\n')}`);
    });
});
