import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderMarkdownReport, compareSnapshots } from './schemaCompareCore.mjs';

const PROJECTS = Object.freeze({
    production: Object.freeze({
        name: 'preciosaldia rebranding',
        ref: 'sodgzkablshladvbtnes',
    }),
    staging: Object.freeze({
        name: 'precios-al-dia-staging',
        ref: 'tdfcpwctvumbdjmifypd',
    }),
});

const SCHEMA_SNAPSHOT_SQL = `
WITH relations AS (
    SELECT jsonb_agg(jsonb_build_object(
        'name', c.relname,
        'kind', CASE c.relkind WHEN 'r' THEN 'table' WHEN 'p' THEN 'partitioned_table' WHEN 'v' THEN 'view' WHEN 'm' THEN 'materialized_view' WHEN 'f' THEN 'foreign_table' ELSE c.relkind::text END,
        'rls_enabled', c.relrowsecurity,
        'rls_forced', c.relforcerowsecurity,
        'replica_identity', c.relreplident,
        'columns', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'name', a.attname,
                'type', format_type(a.atttypid, a.atttypmod),
                'nullable', NOT a.attnotnull,
                'default', pg_get_expr(ad.adbin, ad.adrelid),
                'identity', a.attidentity,
                'generated', a.attgenerated
            ) ORDER BY a.attnum)
            FROM pg_attribute a
            LEFT JOIN pg_attrdef ad ON ad.adrelid = a.attrelid AND ad.adnum = a.attnum
            WHERE a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
        ), '[]'::jsonb),
        'constraints', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'name', con.conname,
                'type', con.contype::text,
                'definition', pg_get_constraintdef(con.oid, true)
            ) ORDER BY con.conname)
            FROM pg_constraint con WHERE con.conrelid = c.oid
        ), '[]'::jsonb),
        'indexes', COALESCE((
            SELECT jsonb_agg(jsonb_build_object(
                'name', idx.relname,
                'index_definition', pg_get_indexdef(idx.oid)
            ) ORDER BY idx.relname)
            FROM pg_index ix
            JOIN pg_class idx ON idx.oid = ix.indexrelid
            WHERE ix.indrelid = c.oid
        ), '[]'::jsonb)
    ) ORDER BY c.relname) AS value
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
), routines AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'signature', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')',
        'returns', pg_get_function_result(p.oid),
        'language', l.lanname,
        'security_definer', p.prosecdef,
        'volatility', p.provolatile,
        'search_path', p.proconfig
    ) ORDER BY p.proname, pg_get_function_identity_arguments(p.oid)), '[]'::jsonb) AS value
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
    WHERE n.nspname = 'public'
), policies AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'table_name', tablename,
        'name', policyname,
        'permissive', permissive,
        'roles', roles,
        'command', cmd,
        'qual', qual,
        'with_check', with_check
    ) ORDER BY tablename, policyname), '[]'::jsonb) AS value
    FROM pg_policies WHERE schemaname = 'public'
), triggers AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'table_name', c.relname,
        'name', t.tgname,
        'definition', pg_get_triggerdef(t.oid, true)
    ) ORDER BY c.relname, t.tgname), '[]'::jsonb) AS value
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND NOT t.tgisinternal
), extensions AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', e.extname,
        'version', e.extversion,
        'schema', n.nspname
    ) ORDER BY e.extname), '[]'::jsonb) AS value
    FROM pg_extension e
    JOIN pg_namespace n ON n.oid = e.extnamespace
    WHERE e.extname NOT IN ('plpgsql')
), publication AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'schema_name', schemaname,
        'table_name', tablename
    ) ORDER BY schemaname, tablename), '[]'::jsonb) AS value
    FROM pg_publication_tables WHERE pubname = 'supabase_realtime'
), grants AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'table_name', c.relname,
        'grantee', CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE roles.rolname END,
        'privilege_type', acl.privilege_type
    ) ORDER BY c.relname, CASE WHEN acl.grantee = 0 THEN 'PUBLIC' ELSE roles.rolname END, acl.privilege_type), '[]'::jsonb) AS value
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) acl
    LEFT JOIN pg_roles roles ON roles.oid = acl.grantee
    WHERE n.nspname = 'public'
      AND c.relkind IN ('r', 'p', 'v', 'm', 'f')
      AND (acl.grantee = 0 OR roles.rolname IN ('anon', 'authenticated', 'service_role'))
), enum_types AS (
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', t.typname,
        'labels', (SELECT jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid)
    ) ORDER BY t.typname), '[]'::jsonb) AS value
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typtype = 'e'
)
SELECT jsonb_build_object(
    'server_version', current_setting('server_version'),
    'relations', COALESCE((SELECT value FROM relations), '[]'::jsonb),
    'routines', (SELECT value FROM routines),
    'policies', (SELECT value FROM policies),
    'triggers', (SELECT value FROM triggers),
    'extensions', (SELECT value FROM extensions),
    'publication', (SELECT value FROM publication),
    'grants', (SELECT value FROM grants),
    'enum_types', (SELECT value FROM enum_types)
) AS snapshot;
`;

function parseEnv(text) {
    const values = {};
    for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
        if (!match || match[1].startsWith('#')) continue;
        let value = match[2].trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        values[match[1]] = value;
    }
    return values;
}

async function managementAccessToken() {
    if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN;
    try {
        const env = parseEnv(await readFile(resolve('.env'), 'utf8'));
        return env.SUPABASE_ACCESS_TOKEN || null;
    } catch {
        return null;
    }
}

export async function readSchemaSnapshot(projectRef, accessToken) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
        method: 'POST',
        headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query: SCHEMA_SNAPSHOT_SQL }),
    });

    if (!response.ok) {
        // Avoid echoing Management API response text; it may include sensitive query context.
        throw new Error(`Schema inspection failed for ${projectRef} (HTTP ${response.status}).`);
    }

    const result = await response.json();
    const row = Array.isArray(result) ? result[0] : result?.[0];
    if (!row?.snapshot) throw new Error(`Schema metadata missing from response for ${projectRef}.`);
    return row.snapshot;
}

export async function verifyProjectHealth(projectRef, accessToken) {
    const response = await fetch(`https://api.supabase.com/v1/projects/${projectRef}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) throw new Error(`Could not verify project ${projectRef} (HTTP ${response.status}).`);
    const project = await response.json();
    if (project.id !== projectRef || project.status !== 'ACTIVE_HEALTHY') {
        throw new Error(`Project ${projectRef} is not ACTIVE_HEALTHY; refusing to run schema comparison.`);
    }
    return project.name;
}

export const schemaCompareConfig = Object.freeze({
    projects: PROJECTS,
    query: SCHEMA_SNAPSHOT_SQL,
});

async function main() {
    const token = await managementAccessToken();
    if (!token) {
        throw new Error('Set SUPABASE_ACCESS_TOKEN in the environment or local .env file; the value is never printed or included in the report.');
    }

    await Promise.all([
        verifyProjectHealth(PROJECTS.production.ref, token),
        verifyProjectHealth(PROJECTS.staging.ref, token),
    ]);
    const [productionSnapshot, stagingSnapshot] = await Promise.all([
        readSchemaSnapshot(PROJECTS.production.ref, token),
        readSchemaSnapshot(PROJECTS.staging.ref, token),
    ]);

    const production = { ...PROJECTS.production, snapshot: productionSnapshot };
    const staging = { ...PROJECTS.staging, snapshot: stagingSnapshot };
    const diffs = compareSnapshots(productionSnapshot, stagingSnapshot);
    const report = renderMarkdownReport({
        generatedAt: new Date().toISOString(),
        production,
        staging,
        diffs,
    });

    const outputPath = resolve(process.env.SCHEMA_COMPARE_OUTPUT || 'reports/preciosaldia-schema-comparison.md');
    await (await import('node:fs/promises')).mkdir(dirname(outputPath), { recursive: true });
    await (await import('node:fs/promises')).writeFile(outputPath, report, { encoding: 'utf8', flag: 'wx' });

    console.log(`Schema comparison written to ${outputPath}`);
    console.log(`Production ${PROJECTS.production.ref}: ${productionSnapshot.relations.length} relations; staging ${PROJECTS.staging.ref}: ${stagingSnapshot.relations.length} relations; ${diffs.length} differences.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main().catch(error => {
        console.error(`[schema:compare] ${error.message}`);
        process.exitCode = 1;
    });
}
