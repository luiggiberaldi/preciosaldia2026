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
        // Desde el ajuste del 2026-11-19 el incidente (450 POST de 420 KB) lo atrapa
        // «muchas reescrituras pesadas» (largePosts) en vez del POST suelto (> 450 KB).
        expect(kinds).toEqual(['dailyUpload', 'largePosts', 'maxDoc', 'realtimeConnections']);
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

describe('falsa alarma del 2026-11-18 (issue #5): tramos cerrados de ventas de 400 KB', () => {
    // Día real: 651 POST, 24.7 MB, el más grande 400 KB, 6 POST > 150 KB.
    const rows = [
        { rango: 'a', n: 226, bytes: 2_100_000, max_b: 19_000 },
        { rango: 'b', n: 345, bytes: 14_500_000, max_b: 69_000 },
        { rango: 'c', n: 74, bytes: 6_300_000, max_b: 149_000 },
        { rango: 'd', n: 3, bytes: 605_000, max_b: 290_000 },
        { rango: 'e', n: 3, bytes: 1_200_000, max_b: 400_000 },
    ];

    it('el día real ya no dispara la alarma', () => {
        const day = { day: '2026-11-18', uploads: summarizeUploads(rows), realtimeConnections: 76 };
        expect(evaluateThresholds({ days: [day] })).toEqual([]);
    });

    it('muchas reescrituras pesadas en un día sí avisan', () => {
        const heavy = [...rows.slice(0, 3), { rango: 'd', n: 11, bytes: 2_500_000, max_b: 280_000 }];
        const day = { day: '2026-11-20', uploads: summarizeUploads(heavy), realtimeConnections: 76 };
        const violations = evaluateThresholds({ days: [day] });
        expect(violations).toEqual([expect.objectContaining({ kind: 'largePosts', value: 11, limit: 10 })]);
        expect(renderReport({ days: [day], violations })).toContain('11 POST de más de 150 KB (límite 10 por día)');
    });

    it('un POST suelto de más de 450 KB sigue avisando', () => {
        const day = { day: '2026-11-20', uploads: summarizeUploads([{ rango: 'f', n: 1, bytes: 600_000, max_b: 600_000 }]), realtimeConnections: 1 };
        expect(evaluateThresholds({ days: [day] }).map(v => v.kind)).toEqual(['maxPost']);
    });
});
