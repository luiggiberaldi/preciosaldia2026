#!/usr/bin/env node
// Reporte de egress de Supabase (plan 2026-11-14-plan-fixeo-egress-realtime, F0/F6).
//
// Uso:
//   node scripts/egress-report.mjs                       # ayer (UTC)
//   node scripts/egress-report.mjs --days 7              # últimos 7 días completos
//   node scripts/egress-report.mjs --from 2026-11-10 --to 2026-11-14
//   node scripts/egress-report.mjs --check               # sale con código 1 si se pasa algún límite
//   node scripts/egress-report.mjs --out reporte.md      # además guarda el Markdown
//   node scripts/egress-report.mjs --redact             # sin ids de equipos (issues públicos)
//   --max-post 150000 --max-doc 450000 --daily-upload 40000000 --max-connections 150
//
// Token: SUPABASE_ACCESS_TOKEN del `.env` de la raíz si existe (en local la
// variable de entorno del sistema puede ser un token viejo); si no, del entorno
// (GitHub Actions lo pasa como secreto). Nunca se imprime.
import { readFileSync, existsSync } from 'node:fs';
import { writeFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import {
    DEFAULT_THRESHOLDS,
    PUBLICATION_SQL,
    REALTIME_CONNECTIONS_SQL,
    SYNC_GETS_SQL,
    TOP_DOCS_SQL,
    buildUploadsByRangeSql,
    evaluateThresholds,
    listDays,
    nextDay,
    renderReport,
    sumConnections,
    summarizeUploads,
} from './egressReportCore.mjs';

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'sodgzkablshladvbtnes';
const API = `https://api.supabase.com/v1/projects/${PROJECT_REF}`;

function readTokenFromDotEnv() {
    const path = resolve(process.cwd(), '.env');
    if (!existsSync(path)) return null;
    const line = readFileSync(path, 'utf8').split(/\r?\n/).find((l) => l.startsWith('SUPABASE_ACCESS_TOKEN='));
    return line ? line.slice('SUPABASE_ACCESS_TOKEN='.length).trim().replace(/^["']|["']$/g, '') : null;
}

const TOKEN = readTokenFromDotEnv() || process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
    console.error('Falta SUPABASE_ACCESS_TOKEN (entorno o .env).');
    process.exit(2);
}

function parseArgs(argv) {
    const args = { check: false };
    for (let i = 0; i < argv.length; i += 1) {
        const key = argv[i];
        const value = argv[i + 1];
        if (key === '--check') args.check = true;
        else if (key === '--redact') args.redact = true;
        else if (key === '--from') { args.from = value; i += 1; }
        else if (key === '--to') { args.to = value; i += 1; }
        else if (key === '--days') { args.days = Number(value); i += 1; }
        else if (key === '--out') { args.out = value; i += 1; }
        else if (key === '--max-post') { args.maxPostBytes = Number(value); i += 1; }
        else if (key === '--max-doc') { args.maxDocBytes = Number(value); i += 1; }
        else if (key === '--daily-upload') { args.dailyUploadBytes = Number(value); i += 1; }
        else if (key === '--max-connections') { args.realtimeConnections = Number(value); i += 1; }
    }
    return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function request(url, init, label) {
    for (let attempt = 0; attempt < 4; attempt += 1) {
        const res = await fetch(url, { ...init, headers: { Authorization: `Bearer ${TOKEN}`, ...(init?.headers || {}) } });
        const text = await res.text();
        // La API de logs limita la tasa: esperar y reintentar.
        if (res.status === 429 || text.includes('ThrottlerException')) {
            await sleep(10_000 * (attempt + 1));
            continue;
        }
        if (!res.ok) throw new Error(`${label}: HTTP ${res.status} ${text.slice(0, 300)}`);
        return JSON.parse(text);
    }
    throw new Error(`${label}: la API siguió limitando la tasa`);
}

async function queryLogs(sql, day) {
    const params = new URLSearchParams({
        sql,
        iso_timestamp_start: `${day}T00:00:00Z`,
        iso_timestamp_end: `${nextDay(day)}T00:00:00Z`,
    });
    const body = await request(`${API}/analytics/endpoints/logs?${params}`, { method: 'GET' }, `logs ${day}`);
    if (body?.error) throw new Error(`logs ${day}: ${JSON.stringify(body.error).slice(0, 300)}`);
    await sleep(2_000);
    return body?.result || [];
}

async function querySql(sql) {
    return request(`${API}/database/query`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: sql }),
    }, 'sql');
}

function resolveDays(args) {
    if (args.from) return listDays(args.from, args.to || args.from);
    const count = Number.isFinite(args.days) && args.days > 0 ? args.days : 1;
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const first = new Date(Date.parse(`${yesterday}T00:00:00Z`) - (count - 1) * 86_400_000).toISOString().slice(0, 10);
    return listDays(first, yesterday);
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const thresholds = { ...DEFAULT_THRESHOLDS };
    for (const key of Object.keys(DEFAULT_THRESHOLDS)) {
        if (Number.isFinite(args[key])) thresholds[key] = args[key];
    }

    const days = [];
    for (const day of resolveDays(args)) {
        const uploads = summarizeUploads(await queryLogs(buildUploadsByRangeSql(), day));
        const gets = await queryLogs(SYNC_GETS_SQL, day);
        const connections = await queryLogs(REALTIME_CONNECTIONS_SQL, day);
        days.push({
            day,
            uploads,
            syncGets: Number(gets?.[0]?.n) || 0,
            realtimeConnections: sumConnections(connections),
            realtimeTop: connections,
        });
    }
    const topDocs = await querySql(TOP_DOCS_SQL);
    const publication = await querySql(PUBLICATION_SQL);
    const violations = evaluateThresholds({ days, topDocs }, thresholds);
    const report = renderReport({ days, topDocs, publication, violations, redact: Boolean(args.redact) });

    console.log(report);
    if (args.out) {
        const outPath = resolve(process.cwd(), args.out);
        await mkdir(dirname(outPath), { recursive: true });
        await writeFile(outPath, `${report}\n`, 'utf8');
    }
    if (args.check && violations.length) process.exitCode = 1;
}

main().catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 2;
});
