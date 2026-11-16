// Núcleo puro del reporte de egress (plan 2026-11-14-plan-fixeo-egress-realtime, F0/F6).
// Sin red ni disco: lo usan el CLI `egress-report.mjs` y las pruebas.

export const SIZE_RANGES = Object.freeze([
    { id: 'a', label: '< 20 KB', max: 20_000 },
    { id: 'b', label: '20-70 KB', max: 70_000 },
    { id: 'c', label: '70-150 KB', max: 150_000 },
    { id: 'd', label: '150-300 KB', max: 300_000 },
    { id: 'e', label: '300-500 KB', max: 500_000 },
    { id: 'f', label: '> 500 KB', max: Infinity },
]);

// Límites de la alarma diaria (F6). Se pueden pisar por CLI.
export const DEFAULT_THRESHOLDS = Object.freeze({
    dailyUploadBytes: 40_000_000,
    maxPostBytes: 150_000,
    // Por encima del tramo cerrado de ventas (400 KB, casi nunca se reescribe)
    // y por debajo del límite de ~1 MB de Realtime. Las reescrituras frecuentes
    // las vigila maxPostBytes.
    maxDocBytes: 450_000,
    realtimeConnections: 150,
});

/** Lista de días `YYYY-MM-DD` entre `from` y `to`, ambos incluidos (UTC). */
export function listDays(from, to) {
    const start = Date.parse(`${from}T00:00:00Z`);
    const end = Date.parse(`${to}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        throw new Error(`Rango de fechas inválido: ${from} → ${to}`);
    }
    const days = [];
    for (let t = start; t <= end; t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
    return days;
}

export function nextDay(day) {
    return new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);
}

/** SQL de ClickHouse que agrupa los POST a sync_documents por rango de tamaño. */
export function buildUploadsByRangeSql() {
    const cases = SIZE_RANGES
        .filter((range) => Number.isFinite(range.max))
        .map((range) => `b < ${range.max}, '${range.id}'`)
        .join(', ');
    return `select multiIf(${cases}, 'f') as rango, count() as n, sum(b) as bytes, max(b) as max_b `
        + `from (select toInt64OrZero(log_attributes['request.headers.content_length']) as b from logs `
        + `where source = 'edge_logs' and log_attributes['request.method'] = 'POST' `
        + `and log_attributes['request.path'] = '/rest/v1/sync_documents') group by rango order by rango`;
}

export const SYNC_GETS_SQL = `select count() as n from logs where source = 'edge_logs' `
    + `and log_attributes['request.method'] = 'GET' and log_attributes['request.path'] = '/rest/v1/sync_documents'`;

export const REALTIME_CONNECTIONS_SQL = `select log_attributes['request.cf.city'] as city, `
    + `log_attributes['request.headers.user_agent'] as ua, count() as n from logs `
    + `where source = 'edge_logs' and log_attributes['request.path'] like '/realtime/%' `
    + `group by city, ua order by n desc limit 500`;

// Solo docs vivos (actualizados en 7 días): los legacy congelados de equipos
// viejos pesan más de 1 MB pero ya no generan tráfico de Realtime.
export const TOP_DOCS_SQL = `select device_id, doc_id, octet_length(data::text) as bytes, updated_at `
    + `from public.sync_documents where updated_at > now() - interval '7 days' `
    + `order by octet_length(data::text) desc nulls last limit 15`;

export const PUBLICATION_SQL = `select tablename from pg_publication_tables `
    + `where pubname = 'supabase_realtime' order by tablename`;

/** Normaliza la respuesta de los rangos a un resumen del día. */
export function summarizeUploads(rows = []) {
    const byRange = Object.fromEntries(SIZE_RANGES.map((range) => [range.id, { n: 0, bytes: 0 }]));
    let total = 0;
    let count = 0;
    let maxPost = 0;
    for (const row of rows || []) {
        const id = byRange[row?.rango] ? row.rango : 'f';
        const n = Number(row?.n) || 0;
        const bytes = Number(row?.bytes) || 0;
        byRange[id].n += n;
        byRange[id].bytes += bytes;
        total += bytes;
        count += n;
        maxPost = Math.max(maxPost, Number(row?.max_b) || 0);
    }
    return { count, bytes: total, maxPost, byRange };
}

export function sumConnections(rows = []) {
    return (rows || []).reduce((acc, row) => acc + (Number(row?.n) || 0), 0);
}

/**
 * Evalúa los límites de la alarma. `days` es la lista de resúmenes diarios
 * ({ day, uploads, realtimeConnections }); `topDocs` es el top actual por tamaño.
 * Devuelve la lista de violaciones (vacía si todo está bien).
 */
export function evaluateThresholds({ days = [], topDocs = [] } = {}, thresholds = DEFAULT_THRESHOLDS) {
    const limits = { ...DEFAULT_THRESHOLDS, ...thresholds };
    const violations = [];
    for (const day of days) {
        const uploads = day?.uploads || { bytes: 0, maxPost: 0 };
        if (uploads.bytes > limits.dailyUploadBytes) {
            violations.push({ kind: 'dailyUpload', day: day.day, value: uploads.bytes, limit: limits.dailyUploadBytes });
        }
        if (uploads.maxPost > limits.maxPostBytes) {
            violations.push({ kind: 'maxPost', day: day.day, value: uploads.maxPost, limit: limits.maxPostBytes });
        }
        if ((day?.realtimeConnections || 0) > limits.realtimeConnections) {
            violations.push({ kind: 'realtimeConnections', day: day.day, value: day.realtimeConnections, limit: limits.realtimeConnections });
        }
    }
    for (const doc of topDocs || []) {
        const bytes = Number(doc?.bytes) || 0;
        if (bytes > limits.maxDocBytes) {
            violations.push({ kind: 'maxDoc', docId: doc.doc_id, deviceId: doc.device_id, value: bytes, limit: limits.maxDocBytes });
        }
    }
    return violations;
}

export function formatBytes(bytes) {
    const value = Number(bytes) || 0;
    if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} MB`;
    if (value >= 1_000) return `${(value / 1_000).toFixed(0)} KB`;
    return `${value} B`;
}

const VIOLATION_TEXT = {
    dailyUpload: (v) => `${v.day}: subida a sync_documents ${formatBytes(v.value)} (límite ${formatBytes(v.limit)})`,
    maxPost: (v) => `${v.day}: un POST a sync_documents pesó ${formatBytes(v.value)} (límite ${formatBytes(v.limit)})`,
    realtimeConnections: (v) => `${v.day}: ${v.value} conexiones de Realtime (límite ${v.limit})`,
    maxDoc: (v, redact) => `doc ${v.docId}${redact ? '' : ` (${String(v.deviceId || '').slice(0, 14)}…)`} pesa ${formatBytes(v.value)} (límite ${formatBytes(v.limit)})`,
};

/** `redact`: sin identificadores de equipos (el repo es público y la alarma abre issues). */
export function describeViolation(violation, { redact = false } = {}) {
    const text = VIOLATION_TEXT[violation?.kind];
    return text ? text(violation, redact) : `${violation?.kind ?? 'límite'} superado`;
}

/** Texto Markdown del reporte (consola, issue de la alarma). */
export function renderReport({ days = [], topDocs = [], publication = [], violations = [], redact = false } = {}) {
    const lines = [];
    lines.push('## Subidas a `sync_documents` por día');
    lines.push('');
    lines.push(`| Día | POST | Subido | POST más grande | ${SIZE_RANGES.map((r) => r.label).join(' | ')} | GET | Conexiones Realtime |`);
    lines.push(`|---|---|---|---|${SIZE_RANGES.map(() => '---').join('|')}|---|---|`);
    for (const day of days) {
        const u = day.uploads;
        const ranges = SIZE_RANGES.map((r) => `${u.byRange[r.id].n} (${formatBytes(u.byRange[r.id].bytes)})`).join(' | ');
        lines.push(`| ${day.day} | ${u.count} | ${formatBytes(u.bytes)} | ${formatBytes(u.maxPost)} | ${ranges} | ${day.syncGets} | ${day.realtimeConnections} |`);
    }
    lines.push('');
    lines.push('## Documentos vivos más pesados (actualizados en 7 días)');
    lines.push('');
    lines.push(redact ? '| doc_id | Tamaño | Actualizado |' : '| doc_id | Equipo | Tamaño | Actualizado |');
    lines.push(redact ? '|---|---|---|' : '|---|---|---|---|');
    for (const doc of topDocs) {
        lines.push(redact
            ? `| ${doc.doc_id} | ${formatBytes(doc.bytes)} | ${doc.updated_at} |`
            : `| ${doc.doc_id} | ${String(doc.device_id || '').slice(0, 14)}… | ${formatBytes(doc.bytes)} | ${doc.updated_at} |`);
    }
    lines.push('');
    lines.push(`Tablas en \`supabase_realtime\`: ${publication.map((p) => `\`${p.tablename}\``).join(', ') || '(ninguna)'}`);
    lines.push('');
    if (violations.length) {
        lines.push('## ⚠️ Límites superados');
        lines.push('');
        for (const violation of violations) lines.push(`- ${describeViolation(violation, { redact })}`);
    } else {
        lines.push('Sin límites superados.');
    }
    return lines.join('\n');
}
