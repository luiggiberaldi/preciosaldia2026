import { createHash } from 'node:crypto';

const SECRET_PATTERNS = [
    /\beyJ[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{8,}\b/g,
    /\bsb_(?:secret|publishable|service_role)_[A-Za-z0-9_-]{12,}\b/gi,
    /\b(?:Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi,
    /\b(?:bearer|token)\s*(?:=|:)?\s*[^\s,;)]+/gi,
    /\b(?:service[_ -]?role|anon[_ -]?key|api[_ -]?key|access[_ -]?token|refresh[_ -]?token|password|secret|credential)\b\s*(?:=|:|=>)\s*[^\s,;)]+/gi,
];

const SQL_LITERAL_FIELDS = new Set([
    'default',
    'definition',
    'index_definition',
    'using',
    'qual',
    'with_check',
]);

function escapeMarkdown(value) {
    return String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
}

export function redactSqlLiterals(value) {
    if (typeof value !== 'string') return value;
    return value.replace(/'(?:''|[^'])*'/g, "'[redacted literal]'");
}

function redactSecretPatterns(value) {
    return SECRET_PATTERNS.reduce((safeValue, pattern) => safeValue.replace(pattern, '[REDACTED]'), value);
}

export function sanitizeForReport(value, fieldName = '') {
    if (Array.isArray(value)) {
        return value.map(item => sanitizeForReport(item, fieldName));
    }

    if (value && typeof value === 'object') {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [key, sanitizeForReport(item, key)])
        );
    }

    if (typeof value !== 'string') return value;

    const isSql = SQL_LITERAL_FIELDS.has(fieldName);
    let safeValue = isSql ? redactSqlLiterals(value) : value;
    safeValue = redactSecretPatterns(safeValue);
    if (!isSql) return safeValue;

    return safeValue;
}

function identityFor(path, item) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
    const collection = path.split(/[/.]/).at(-1).replace(/\[.*$/, '');
    if (collection === 'routines') return item.signature;
    if (collection === 'triggers' || collection === 'policies') return `${item.table_name}.${item.name}`;
    if (collection === 'publication') return `${item.schema_name}.${item.table_name}`;
    if (collection === 'grants') return `${item.table_name}.${item.grantee}.${item.privilege_type}`;
    if (collection === 'columns' || collection === 'constraints' || collection === 'indexes' || collection === 'enum_types') return item.name;
    if (collection === 'relations' || collection === 'extensions') return item.name;
    return item.name ?? item.signature ?? item.table_name ?? null;
}

function normalizedValue(value, path = '') {
    if (Array.isArray(value)) {
        const values = value.map(item => normalizedValue(item, path));
        if (path.split(/[/.]/).at(-1) === 'labels') return values;
        return values.sort((left, right) => {
            const leftId = identityFor(path, left);
            const rightId = identityFor(path, right);
            if (leftId == null || rightId == null) {
                return JSON.stringify(left).localeCompare(JSON.stringify(right));
            }
            return String(leftId).localeCompare(String(rightId));
        });
    }

    if (!value || typeof value !== 'object') return value;

    return Object.fromEntries(
        Object.keys(value).sort().map(key => [key, normalizedValue(value[key], `${path}/${key}`)])
    );
}

function sanitizedDiffValue(value, fieldName = '') {
    return sanitizeForReport(value, fieldName);
}

function addDiff(diffs, path, production, staging, fieldName = '') {
    const productionValue = sanitizedDiffValue(production, fieldName);
    const stagingValue = sanitizedDiffValue(staging, fieldName);
    const sqlLiteralDiff = SQL_LITERAL_FIELDS.has(fieldName)
        && production !== undefined
        && staging !== undefined
        && production !== staging;

    diffs.push({
        path: path || '/',
        production: sqlLiteralDiff ? `${productionValue} [different]` : productionValue,
        staging: sqlLiteralDiff ? `${stagingValue} [different]` : stagingValue,
    });
}

function diffValues(production, staging, path, diffs, fieldName = '') {
    if (Object.is(production, staging)) return;

    if (Array.isArray(production) && Array.isArray(staging)) {
        const canKey = [...production, ...staging].every(item => (
            item && typeof item === 'object' && identityFor(path, item) != null
        ));

        if (canKey) {
            const prodMap = new Map(production.map(item => [identityFor(path, item), item]));
            const stageMap = new Map(staging.map(item => [identityFor(path, item), item]));
            const ids = new Set([...prodMap.keys(), ...stageMap.keys()]);
            for (const id of [...ids].sort((a, b) => String(a).localeCompare(String(b)))) {
                const childPath = `${path}[${id}]`;
                if (!prodMap.has(id)) addDiff(diffs, childPath, undefined, stageMap.get(id));
                else if (!stageMap.has(id)) addDiff(diffs, childPath, prodMap.get(id), undefined);
                else diffValues(prodMap.get(id), stageMap.get(id), childPath, diffs);
            }
            return;
        }

        if (JSON.stringify(production) !== JSON.stringify(staging)) {
            addDiff(diffs, path, production, staging, fieldName);
        }
        return;
    }

    if (production && staging && typeof production === 'object' && typeof staging === 'object') {
        const keys = new Set([...Object.keys(production), ...Object.keys(staging)]);
        for (const key of [...keys].sort()) {
            const childPath = path ? `${path}.${key}` : key;
            if (!(key in production)) addDiff(diffs, childPath, undefined, staging[key], key);
            else if (!(key in staging)) addDiff(diffs, childPath, production[key], undefined, key);
            else diffValues(production[key], staging[key], childPath, diffs, key);
        }
        return;
    }

    addDiff(diffs, path, production, staging, fieldName);
}

export function compareSnapshots(productionSnapshot, stagingSnapshot) {
    const production = normalizedValue(productionSnapshot);
    const staging = normalizedValue(stagingSnapshot);
    const diffs = [];
    diffValues(production, staging, '', diffs);
    return diffs.sort((left, right) => left.path.localeCompare(right.path));
}

export function snapshotSummary(snapshot) {
    return {
        server_version: snapshot.server_version ?? 'unknown',
        relations: snapshot.relations?.length ?? 0,
        routines: snapshot.routines?.length ?? 0,
        policies: snapshot.policies?.length ?? 0,
        triggers: snapshot.triggers?.length ?? 0,
        extensions: snapshot.extensions?.length ?? 0,
        publication_tables: snapshot.publication?.length ?? 0,
        grants: snapshot.grants?.length ?? 0,
        enum_types: snapshot.enum_types?.length ?? 0,
    };
}

export function renderMarkdownReport({ generatedAt, production, staging, diffs }) {
    const productionSummary = snapshotSummary(production.snapshot);
    const stagingSummary = snapshotSummary(staging.snapshot);
    const lines = [
        '# Precios al Día — comparativo de esquema Supabase',
        '',
        `Generado: ${generatedAt}`,
        '',
        '> Comparación de metadatos de esquema únicamente. No consulta filas de negocio ni incluye cuerpos de funciones o valores secretos. Literales SQL en definiciones/defaults se redactan en este reporte.',
        '',
        '## Proyectos',
        '',
        '| Entorno | Proyecto | Ref | PostgreSQL | Relaciones | Rutinas | Políticas RLS | Triggers | Extensiones instaladas | Tablas Realtime | Grants | Tipos enum |',
        '|---|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|',
        `| Producción | ${escapeMarkdown(production.name)} | \`${production.ref}\` | ${escapeMarkdown(productionSummary.server_version)} | ${productionSummary.relations} | ${productionSummary.routines} | ${productionSummary.policies} | ${productionSummary.triggers} | ${productionSummary.extensions} | ${productionSummary.publication_tables} | ${productionSummary.grants} | ${productionSummary.enum_types} |`,
        `| Staging | ${escapeMarkdown(staging.name)} | \`${staging.ref}\` | ${escapeMarkdown(stagingSummary.server_version)} | ${stagingSummary.relations} | ${stagingSummary.routines} | ${stagingSummary.policies} | ${stagingSummary.triggers} | ${stagingSummary.extensions} | ${stagingSummary.publication_tables} | ${stagingSummary.grants} | ${stagingSummary.enum_types} |`,
        '',
        '## Resultado',
        '',
        diffs.length === 0
            ? 'No se detectaron diferencias en los metadatos incluidos.'
            : `Se detectaron **${diffs.length} diferencias**. Cada ruta es una ubicación del snapshot; «—» indica ausencia en ese entorno.`,
        '',
    ];

    if (diffs.length > 0) {
        lines.push('| Ruta | Producción | Staging |', '|---|---|---|');
        for (const diff of diffs) {
            const prodValue = diff.production === undefined ? '—' : JSON.stringify(diff.production);
            const stageValue = diff.staging === undefined ? '—' : JSON.stringify(diff.staging);
            lines.push(`| \`${escapeMarkdown(diff.path)}\` | \`${escapeMarkdown(prodValue)}\` | \`${escapeMarkdown(stageValue)}\` |`);
        }
        lines.push('');
    }

    lines.push(
        '## Alcance y limitaciones',
        '',
        '- La consulta lee catálogos de PostgreSQL (`pg_catalog`, `information_schema` y metadatos de publicación); no selecciona registros de las tablas de la aplicación.',
        '- Se compara `public`: relaciones/columnas, defaults y restricciones (literales ocultos), índices, RLS y políticas, firmas/seguridad de rutinas (sin source), triggers, extensiones instaladas, grants a roles cliente, tipos enum y membresía de Realtime.',
        '- No compara Auth/Storage gestionados, configuración de proveedores, objetos Storage, secretos, datos, propietarios completos ni cuerpos de funciones.',
        '- Los literales SQL se redactan antes de guardar. El script usa refs fijas y un token de Management API leído del entorno o `.env`, que nunca se imprime ni escribe en el reporte.',
        '- Revisar manualmente el diff antes de usar staging. Este artefacto no aplica migraciones ni modifica Supabase.',
        '',
        '## Reproducción',
        '',
        '```bash',
        'bun run schema:compare',
        '```',
        '',
    );

    return `${lines.join('\n')}\n`;
}

export function stableSnapshotDigest(snapshot) {
    return createHash('sha256').update(JSON.stringify(normalizedValue(snapshot))).digest('hex');
}
