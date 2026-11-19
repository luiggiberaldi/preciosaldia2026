#!/usr/bin/env node
// Informe de la caja negra del supervisor (2026-11-19, caso Bodega mani).
// Muestra por qué falló cada orden del supervisor: rechazadas por la nube (con
// el motivo exacto), fallidas al aplicarse en la caja y vencidas sin tomar.
//
// Uso:
//   node scripts/supervisor-failures-report.mjs                    # últimas 24 h
//   node scripts/supervisor-failures-report.mjs --hours 72
//   node scripts/supervisor-failures-report.mjs --device PDA-V2-F5D31FEF...
//   node scripts/supervisor-failures-report.mjs --check            # código 1 si hay alertas
//   node scripts/supervisor-failures-report.mjs --redact --out r.md
//
// Solo lectura (read_only en la API de administración). Token:
// SUPABASE_ACCESS_TOKEN del `.env` de la raíz o del entorno. Nunca se imprime.
import { readFileSync, existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
    DEFAULT_FAILURE_THRESHOLDS,
    buildProblemsSql,
    evaluateProblems,
    renderProblemsReport,
    summarizeProblems,
} from './supervisorFailuresCore.mjs';

const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || 'sodgzkablshladvbtnes';

function readTokenFromDotEnv() {
    const path = resolve(process.cwd(), '.env');
    if (!existsSync(path)) return null;
    const line = readFileSync(path, 'utf8').split(/\r?\n/).find((l) => l.startsWith('SUPABASE_ACCESS_TOKEN='));
    return line ? line.slice('SUPABASE_ACCESS_TOKEN='.length).trim().replace(/^["']|["']$/g, '') : null;
}

function parseArgs(argv) {
    const args = { hours: 24, check: false, redact: false };
    for (let i = 0; i < argv.length; i += 1) {
        const key = argv[i];
        const value = argv[i + 1];
        if (key === '--check') args.check = true;
        else if (key === '--redact') args.redact = true;
        else if (key === '--hours') { args.hours = Number(value); i += 1; }
        else if (key === '--device') { args.device = value; i += 1; }
        else if (key === '--out') { args.out = value; i += 1; }
    }
    return args;
}

async function main() {
    const token = readTokenFromDotEnv() || process.env.SUPABASE_ACCESS_TOKEN;
    if (!token) {
        console.error('Falta SUPABASE_ACCESS_TOKEN (entorno o .env).');
        return 2;
    }
    const args = parseArgs(process.argv.slice(2));
    const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: buildProblemsSql(args), read_only: true }),
    });
    const text = await res.text();
    if (!res.ok) {
        console.error(`No se pudo leer la caja negra: HTTP ${res.status} ${text.slice(0, 300)}`);
        return 2;
    }
    const groups = summarizeProblems(JSON.parse(text));
    const alerts = evaluateProblems(groups, DEFAULT_FAILURE_THRESHOLDS, { redact: args.redact });
    const report = renderProblemsReport(groups, { hours: args.hours, redact: args.redact, alerts });
    console.log(report);
    if (args.out) await writeFile(args.out, report + '\n', 'utf8');
    return args.check && alerts.length ? 1 : 0;
}

// exitCode (no process.exit): cerrar a la fuerza con la salida en un tubo rompe Node en Windows.
main().then((code) => { process.exitCode = code; }).catch((error) => {
    console.error(error?.message || error);
    process.exitCode = 2;
});
