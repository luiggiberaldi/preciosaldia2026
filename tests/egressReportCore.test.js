import { describe, expect, it } from 'vitest';
import {
    DEFAULT_THRESHOLDS,
    buildUploadsByRangeSql,
    evaluateThresholds,
    listDays,
    renderReport,
    sumConnections,
    summarizeUploads,
} from '../scripts/egressReportCore.mjs';

describe('egressReportCore (F0/F6 del plan de egress Realtime)', () => {
    it('lista los días del rango, ambos extremos incluidos', () => {
        expect(listDays('2026-11-10', '2026-11-12')).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
        expect(() => listDays('2026-11-12', '2026-11-10')).toThrow();
    });

    it('el SQL de rangos usa los cortes por tamaño de los POST', () => {
        const sql = buildUploadsByRangeSql();
        expect(sql).toContain("b < 20000, 'a'");
        expect(sql).toContain("b < 500000, 'e'");
        expect(sql).toContain("'/rest/v1/sync_documents'");
    });

    it('resume los rangos del día (medido el 13-nov-2026)', () => {
        const summary = summarizeUploads([
            { rango: 'a', n: 12, bytes: 119971, max_b: 19000 },
            { rango: 'b', n: 327, bytes: 13879105, max_b: 69000 },
            { rango: 'e', n: 450, bytes: 167305943, max_b: 420000 },
        ]);
        expect(summary.count).toBe(789);
        expect(summary.bytes).toBe(181305019);
        expect(summary.maxPost).toBe(420000);
        expect(summary.byRange.e.n).toBe(450);
    });

    it('la alarma salta con el día del incidente y calla con un día sano', () => {
        const incident = {
            day: '2026-11-13',
            uploads: summarizeUploads([{ rango: 'e', n: 450, bytes: 167305943, max_b: 420000 }]),
            realtimeConnections: 254,
        };
        const healthy = {
            day: '2026-11-20',
            uploads: summarizeUploads([{ rango: 'b', n: 600, bytes: 18_000_000, max_b: 61_000 }]),
            realtimeConnections: 30,
        };
        const kinds = evaluateThresholds({ days: [incident], topDocs: [{ doc_id: 'abasto_audit_log_v1', bytes: 600_000 }] })
            .map((v) => v.kind).sort();
        expect(kinds).toEqual(['dailyUpload', 'maxDoc', 'maxPost', 'realtimeConnections']);
        expect(evaluateThresholds({ days: [healthy], topDocs: [{ doc_id: 'x', bytes: 50_000 }] })).toEqual([]);
    });

    it('los límites se pueden pisar (prueba manual de la alarma)', () => {
        const day = { day: 'd', uploads: summarizeUploads([{ rango: 'b', n: 1, bytes: 60_000, max_b: 60_000 }]), realtimeConnections: 0 };
        expect(evaluateThresholds({ days: [day] }, { ...DEFAULT_THRESHOLDS, maxPostBytes: 1_000 })).toHaveLength(1);
    });

    it('suma conexiones y arma el Markdown con las violaciones', () => {
        expect(sumConnections([{ n: 3 }, { n: '4' }])).toBe(7);
        const report = renderReport({
            days: [{ day: '2026-11-13', uploads: summarizeUploads([]), syncGets: 5, realtimeConnections: 7 }],
            topDocs: [{ doc_id: 'abasto_audit_log_v1', device_id: 'PDA-V2-0000TEST0001', bytes: 406963, updated_at: 'x' }],
            publication: [{ tablename: 'sync_documents' }],
            violations: [{ kind: 'maxDoc', docId: 'abasto_audit_log_v1', deviceId: 'PDA', value: 406963, limit: 200000 }],
        });
        expect(report).toContain('Límites superados');
        expect(report).toContain('abasto_audit_log_v1');
        expect(report).toContain('`sync_documents`');
    });

    it('--redact no muestra identificadores de equipos (el repo es público)', () => {
        const input = {
            days: [],
            topDocs: [{ doc_id: 'bodega_sales_v1:2026-11#16', device_id: 'PDA-V2-0000TEST0001', bytes: 120_000, updated_at: 'x' }],
            violations: [{ kind: 'maxDoc', docId: 'bodega_sales_v1:2026-11#16', deviceId: 'PDA-V2-0000TEST0001', value: 300_000, limit: 200_000 }],
        };
        expect(renderReport(input)).toContain('PDA-V2-0000TES');
        const redacted = renderReport({ ...input, redact: true });
        expect(redacted).not.toContain('PDA-V2');
        expect(redacted).toContain('bodega_sales_v1:2026-11#16');
    });
});
