// Lógica pura del informe de la caja negra del supervisor (2026-11-19).
// La usa scripts/supervisor-failures-report.mjs; se prueba sin red.

export const DEFAULT_FAILURE_THRESHOLDS = Object.freeze({
    // Un mismo rechazo de la nube que se repite ≥ N veces = algo atascado.
    repeatedRejection: 3,
    // Órdenes vencidas sin que la caja las tomara (caja apagada o versión vieja).
    expiredUntaken: 5,
});

const KIND_LABEL = Object.freeze({
    rechazada_por_nube: 'Rechazada por la nube (nunca llegó a la caja)',
    fallida_en_caja: 'La caja la recibió pero falló al aplicarla',
    vencida_sin_tomar: 'Venció sin que la caja la tomara',
});

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`;

export function buildProblemsSql({ hours = 24, device = null } = {}) {
    const h = Math.max(1, Math.min(24 * 30, Math.floor(Number(hours) || 24)));
    const deviceFilter = device ? `AND p.target_device_id = ${quote(device)}` : '';
    return `
SELECT p.kind, p.target_device_id, coalesce(l.business_name, '') AS business_name,
       p.command_type, p.error_message, p.error_detail, p.occurrences,
       p.first_seen_at, p.last_seen_at, p.command_id, p.app_version
FROM public.supervisor_command_problems p
LEFT JOIN public.cloud_licenses l ON l.device_id = p.target_device_id
WHERE p.last_seen_at > now() - interval '${h} hours' ${deviceFilter}
ORDER BY p.last_seen_at DESC
LIMIT 500;`.trim();
}

/** Agrupa filas por (negocio/caja, tipo de problema, tipo de orden, error). */
export function summarizeProblems(rows = []) {
    const groups = new Map();
    for (const row of rows) {
        const key = [row.target_device_id, row.kind, row.command_type, row.error_message, row.error_detail].join('|');
        const current = groups.get(key);
        const occurrences = Number(row.occurrences) || 1;
        if (!current) {
            groups.set(key, { ...row, occurrences, orders: 1 });
        } else {
            current.occurrences += occurrences;
            current.orders += 1;
            if (row.last_seen_at > current.last_seen_at) current.last_seen_at = row.last_seen_at;
            if (row.first_seen_at < current.first_seen_at) current.first_seen_at = row.first_seen_at;
        }
    }
    return [...groups.values()].sort((a, b) => String(b.last_seen_at).localeCompare(String(a.last_seen_at)));
}

export function evaluateProblems(groups = [], thresholds = DEFAULT_FAILURE_THRESHOLDS, { redact = false } = {}) {
    const alerts = [];
    const where = (g) => (redact ? 'una caja' : (g.business_name || g.target_device_id));
    for (const g of groups) {
        if (g.kind === 'rechazada_por_nube' && g.occurrences >= thresholds.repeatedRejection) {
            alerts.push(`Rechazo repetido ${g.occurrences} veces en ${where(g)}: ${g.error_detail || g.error_message}`);
        }
    }
    const expiredByDevice = new Map();
    for (const g of groups.filter(item => item.kind === 'vencida_sin_tomar')) {
        const k = where(g);
        expiredByDevice.set(k, (expiredByDevice.get(k) || 0) + g.orders);
    }
    for (const [name, count] of expiredByDevice) {
        if (count >= thresholds.expiredUntaken) alerts.push(`${count} órdenes vencidas sin tomar en ${name} (¿caja apagada o versión vieja?)`);
    }
    return alerts;
}

const shortId = (id) => (id ? `${String(id).slice(0, 14)}…` : '—');

export function renderProblemsReport(groups = [], { hours = 24, redact = false, alerts = [] } = {}) {
    const lines = [`# Caja negra del supervisor · últimas ${hours} h`, ''];
    if (!groups.length) {
        lines.push('Sin problemas registrados. ✅');
        return lines.join('\n');
    }
    if (alerts.length) {
        lines.push('## ⚠️ Alertas', '', ...alerts.map(a => `- ${redact ? a.replace(/PDA-V2-[0-9A-F]+/gi, 'PDA-V2-…') : a}`), '');
    }
    lines.push('## Detalle', '');
    for (const g of groups) {
        const who = redact ? 'caja (oculta)' : `${g.business_name || 'sin nombre'} · ${shortId(g.target_device_id)}`;
        lines.push(`### ${KIND_LABEL[g.kind] || g.kind}`);
        lines.push(`- **Dónde:** ${who}`);
        lines.push(`- **Orden:** ${g.command_type || '—'}`);
        lines.push(`- **Error:** ${g.error_message}`);
        if (g.error_detail) lines.push(`- **Motivo exacto:** ${g.error_detail}`);
        lines.push(`- **Veces:** ${g.occurrences}${g.orders > 1 ? ` (en ${g.orders} órdenes)` : ''} · primera ${g.first_seen_at} · última ${g.last_seen_at}`);
        if (g.app_version) lines.push(`- **Versión del monitor:** ${g.app_version}`);
        if (!redact && g.command_id) lines.push(`- **Última orden:** ${g.command_id}`);
        lines.push('');
    }
    return lines.join('\n');
}
