#!/usr/bin/env node
/**
 * docs-check.mjs — Revisión automática de la ley de documentación.
 *
 * MODO SUAVE (Bodega): por defecto TODO se muestra como aviso y el comando termina bien.
 * Solo con --strict los problemas hacen fallar el comando (P-002 de PENDIENTES.md).
 *
 * Qué revisa:
 *   PROBLEMAS (con --strict frenan):
 *     - Enlaces rotos entre documentos.
 *     - Errores (ERR-NNN) resueltos sin solución, o abiertos sin plan.
 *     - Casos (CASO-NNN) o errores que no coinciden con su índice.
 *     - Módulos sin regla en el mapa, o reglas que apuntan a documentos que no existen.
 *   Siempre solo aviso:
 *     - Cambios de código sin entrada nueva en bitacora.md.
 *   AVISOS (no frenan, orientan):
 *     - Documentos que probablemente hay que revisar porque cambió el código que describen.
 *     - Archivos citados en los documentos que ya no existen.
 *
 * Uso:
 *   node scripts/docs-check.mjs            revisa el árbol de trabajo actual
 *   node scripts/docs-check.mjs            revisa el árbol de trabajo actual (solo avisa)
 *   node scripts/docs-check.mjs --staged   revisa lo que va en el commit (hook pre-commit, solo avisa)
 *   node scripts/docs-check.mjs --ci       solo reglas de consistencia (sin mirar cambios)
 *   node scripts/docs-check.mjs --strict   los problemas hacen fallar el comando
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const MAP_PATH = 'docs/sistema/MAPA-CODIGO-DOCS.json';
const CODE_DIRS = ['src/', 'api/', 'supabase/', 'scripts/', 'githooks/', 'tests/', '.github/'];
const CODE_ROOT_FILES = /^(package\.json|worker\.js|index\.html|vite\.config\.js|eslint\.config\.js|tailwind\.config\.js|[^/]+\.sql)$/;
// Documentos vivos que revisa el guardia. Los históricos (planes, informes, auditorías, migraciones) no se revisan.
const LIVE_ROOT_DOCS = /^(README|AGENT|bitacora|PENDIENTES)\.md$/i;
const LIVE_DOCS_DIRS = ['docs/casos', 'docs/sistema'];
const LIVE_DOCS_FILES = ['docs/LEY-DOCUMENTACION.md', 'docs/ERRORES.md'];
const IGNORED_CODE = /(\.bak[^/]*|\.log|\.pdf)$/;

const toPosix = (p) => p.split(path.sep).join('/');
const read = (root, rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (root, rel) => fs.existsSync(path.join(root, rel));

export function isCodeFile(file) {
    if (IGNORED_CODE.test(file)) return false;
    if (CODE_DIRS.some((d) => file.startsWith(d))) return true;
    return CODE_ROOT_FILES.test(file);
}

function patternMatches(pattern, file) {
    if (pattern.endsWith('/') || pattern.endsWith('*')) return file.startsWith(pattern.replace(/\*$/, ''));
    return file === pattern || file.startsWith(pattern);
}

/** Documentos que describen un archivo de código, según el mapa. */
export function docsForFile(map, file) {
    const specific = new Set();
    const fallback = new Set();
    for (const regla of map.reglas) {
        if (!regla.codigo.some((p) => patternMatches(p, file))) continue;
        for (const d of regla.docs) (regla.porDefecto ? fallback : specific).add(d);
    }
    return specific.size ? [...specific] : [...fallback];
}

function walk(root, dir, out = []) {
    const abs = path.join(root, dir);
    if (!fs.existsSync(abs)) return out;
    for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
        const rel = toPosix(path.join(dir, entry.name));
        if (entry.name === 'node_modules' || entry.name === '.git' || entry.name === 'dist') continue;
        if (entry.isDirectory()) walk(root, rel, out);
        else out.push(rel);
    }
    return out;
}

export function markdownFiles(root) {
    const files = [];
    for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
        if (entry.isFile() && LIVE_ROOT_DOCS.test(entry.name)) files.push(entry.name);
    }
    for (const f of LIVE_DOCS_FILES) if (exists(root, f)) files.push(f);
    for (const d of LIVE_DOCS_DIRS) files.push(...walk(root, d).filter((f) => f.endsWith('.md')));
    return files;
}

const stripFences = (text) => text.replace(/```[\s\S]*?```/g, '');

/** Enlaces relativos que apuntan a archivos que no existen. */
export function checkLinks(root, files) {
    const errors = [];
    for (const file of files) {
        const text = stripFences(read(root, file));
        const re = /\[[^\]]*\]\(([^)\s]+)\)/g;
        let m;
        while ((m = re.exec(text))) {
            const target = m[1];
            if (/^(https?:|mailto:|#)/i.test(target)) continue;
            const clean = decodeURI(target.split('#')[0].split('?')[0]);
            if (!clean) continue;
            const resolved = toPosix(path.normalize(path.join(path.dirname(file), clean)));
            if (!exists(root, resolved)) errors.push(`Enlace roto en ${file}: ${target}`);
        }
    }
    return errors;
}

/** Cada error documentado debe tener su solución (o su plan, si sigue abierto). */
export function checkErrores(root) {
    const rel = 'docs/ERRORES.md';
    if (!exists(root, rel)) return [`Falta ${rel}`];
    const text = read(root, rel);
    const errors = [];
    const parts = text.split(/^## (?=ERR-\d{3} )/m).slice(1);
    const blockIds = [];
    const blockState = {};
    for (const part of parts) {
        const id = part.slice(0, 7);
        blockIds.push(id);
        const estado = (part.match(/\*\*Estado:\*\*\s*(\w+)/) || [])[1];
        blockState[id] = estado;
        if (!estado) errors.push(`${id}: falta **Estado:**`);
        else if (estado === 'Resuelto' && !/\*\*Solución:\*\*/.test(part)) errors.push(`${id}: está Resuelto pero no tiene **Solución:**`);
        else if (estado === 'Abierto' && !/\*\*Solución (pendiente|temporal):\*\*/.test(part)) errors.push(`${id}: está Abierto pero no dice qué falta (**Solución pendiente:** o **Solución temporal:**)`);
        else if (!['Resuelto', 'Abierto', 'Descartado'].includes(estado || '')) errors.push(`${id}: estado desconocido "${estado}"`);
    }
    const dup = blockIds.filter((id, i) => blockIds.indexOf(id) !== i);
    for (const id of new Set(dup)) errors.push(`${id}: ID repetido`);
    // El estado de la tabla puede llevar una nota entre paréntesis («Resuelto
    // (mitigado)»), igual que la sección: se compara solo la primera palabra.
    const rows = [...text.matchAll(/^\|\s*(ERR-\d{3})\s*\|[^|]*\|[^|]*\|\s*(\w+)(?:\s*\([^|)]*\))?\s*\|/gm)];
    const tableIds = rows.map((r) => r[1]);
    for (const id of blockIds) if (!tableIds.includes(id)) errors.push(`${id}: falta en la tabla resumen de ERRORES.md`);
    for (const r of rows) {
        if (!blockIds.includes(r[1])) errors.push(`${r[1]}: está en la tabla resumen pero no tiene su sección`);
        else if (blockState[r[1]] && blockState[r[1]] !== r[2]) errors.push(`${r[1]}: la tabla dice ${r[2]} y la sección dice ${blockState[r[1]]}`);
    }
    return errors;
}

/** Cada caso tiene su archivo, su fila en el índice y el mismo estado en ambos. */
export function checkCasos(root) {
    const dir = 'docs/casos';
    const indexRel = `${dir}/INDICE.md`;
    if (!exists(root, indexRel)) return [`Falta ${indexRel}`];
    const errors = [];
    const index = read(root, indexRel);
    const files = walk(root, dir).filter((f) => /\/CASO-\d{3}-[^/]+\.md$/.test(f));
    const ids = files.map((f) => f.match(/CASO-\d{3}/)[0]);
    for (const id of new Set(ids.filter((x, i) => ids.indexOf(x) !== i))) errors.push(`${id}: hay dos archivos con el mismo ID`);
    for (const f of files) {
        const id = f.match(/CASO-\d{3}/)[0];
        const base = path.posix.basename(f);
        const row = index.split('\n').find((l) => l.startsWith('|') && l.includes(`(${base})`));
        if (!row) { errors.push(`${id}: no aparece en ${indexRel}`); continue; }
        const text = read(root, f);
        const estado = (text.match(/\*\*Estado:\*\*\s*(En curso|[^\s(.]+)/) || [])[1];
        if (!estado) errors.push(`${id}: falta **Estado:**`);
        else if (!row.includes(`| ${estado} |`)) errors.push(`${id}: el índice y el documento tienen estados distintos (${estado})`);
        if (!/\*\*Fecha:\*\*/.test(text)) errors.push(`${id}: falta **Fecha:**`);
    }
    const rowIds = [...index.matchAll(/^\|\s*\[(CASO-\d{3})\]/gm)].map((m) => m[1]);
    for (const id of rowIds) if (!ids.includes(id)) errors.push(`${id}: está en el índice pero no existe su archivo`);
    return errors;
}

/** Los documentos de módulo deben tener regla en el mapa, y las reglas deben apuntar a documentos reales. */
export function checkMap(root, map) {
    const errors = [];
    if (!map) return errors;
    const referenced = new Set();
    for (const regla of map.reglas) {
        for (const d of regla.docs) {
            referenced.add(d);
            if (!exists(root, d)) errors.push(`El mapa (${regla.modulo}) apunta a un documento que no existe: ${d}`);
        }
    }
    for (const f of walk(root, 'docs/sistema/modulos').filter((x) => x.endsWith('.md'))) {
        if (!referenced.has(f)) errors.push(`${f} no tiene regla en ${MAP_PATH}`);
    }
    return errors;
}

/** Todo ERR-NNN o CASO-NNN que se nombra en un documento debe existir. */
export function checkReferences(root, files) {
    const errors = [];
    const errPath = 'docs/ERRORES.md';
    const knownErr = new Set(exists(root, errPath) ? [...read(root, errPath).matchAll(/^## (ERR-\d{3}) /gm)].map((m) => m[1]) : []);
    const knownCasos = new Set(walk(root, 'docs/casos').map((f) => (f.match(/CASO-\d{3}/) || [])[0]).filter(Boolean));
    for (const file of files) {
        if (file === errPath) continue;
        const text = stripFences(read(root, file));
        const seen = new Set();
        for (const m of text.matchAll(/\b(ERR|CASO)-(\d{3})\b/g)) {
            const id = m[0];
            if (seen.has(id)) continue;
            seen.add(id);
            const ok = m[1] === 'ERR' ? knownErr.has(id) : knownCasos.has(id);
            if (!ok) errors.push(`${file} nombra ${id}, que no existe`);
        }
    }
    return errors;
}

/** Archivos que los documentos de sistema citan con comillas invertidas y ya no existen. */
export function checkStaleRefs(root) {
    const warnings = [];
    const all = ['src', 'tests', 'scripts', 'api', 'supabase', 'githooks', 'docs'].flatMap((d) => walk(root, d));
    const rootFiles = fs.readdirSync(root, { withFileTypes: true }).filter((e) => e.isFile()).map((e) => e.name);
    const known = new Set([...all.map((f) => path.posix.basename(f)), ...rootFiles]);
    const docs = walk(root, 'docs/sistema').filter((f) => f.endsWith('.md'));
    for (const doc of docs) {
        const text = stripFences(read(root, doc));
        for (const m of text.matchAll(/`([\w./@-]+\.(?:js|jsx|mjs|cjs|json|sql))`/g)) {
            const ref = m[1];
            if (/^(src|tests|scripts|api|supabase|docs)\//.test(ref)) {
                if (!exists(root, ref)) warnings.push(`${doc} cita ${ref}, que ya no existe`);
            } else if (!ref.includes('/') && !known.has(ref)) {
                warnings.push(`${doc} cita ${ref}, que ya no existe`);
            }
        }
    }
    return [...new Set(warnings)];
}

export function changedFiles(root, { staged }) {
    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    try {
        if (staged) return git(['diff', '--cached', '--name-only', '--diff-filter=ACMRD']).split('\n').filter(Boolean);
        return git(['status', '--porcelain', '-uall'])
            .split('\n')
            .filter(Boolean)
            .map((l) => l.slice(3).replace(/^.* -> /, '').replace(/^"|"$/g, ''));
    } catch {
        return [];
    }
}

/** Cambios de código sin bitácora, y documentos por revisar. */
export function checkChanges(map, changed) {
    const errors = [];
    const warnings = [];
    const code = changed.filter(isCodeFile);
    if (code.length === 0) return { errors, warnings };
    if (!changed.includes('bitacora.md')) {
        warnings.push(`Hay ${code.length} archivo(s) de código cambiados y bitacora.md no tiene entrada nueva.`);
    }
    const toReview = new Map();
    for (const file of code.filter((f) => f.startsWith('src/') || f.startsWith('api/') || f.startsWith('supabase/') || /\.sql$/.test(f))) {
        for (const doc of docsForFile(map, file)) {
            if (changed.includes(doc)) continue;
            if (!toReview.has(doc)) toReview.set(doc, []);
            toReview.get(doc).push(file);
        }
    }
    for (const [doc, files] of toReview) {
        const sample = files.slice(0, 3).join(', ') + (files.length > 3 ? ` y ${files.length - 3} más` : '');
        warnings.push(`Revisa ${doc} (cambió: ${sample})`);
    }
    return { errors, warnings };
}

export function runChecks({ root, changed = [], staged = false, ci = false }) {
    const hasMap = exists(root, MAP_PATH);
    const map = hasMap ? JSON.parse(read(root, MAP_PATH)) : { reglas: [] };
    const md = markdownFiles(root);
    const errors = [
        ...checkLinks(root, md),
        ...checkReferences(root, md),
        ...checkErrores(root),
        ...checkCasos(root),
        ...(hasMap ? checkMap(root, map) : []),
    ];
    const warnings = [...checkStaleRefs(root)];
    if (!ci) {
        const c = checkChanges(map, changed);
        errors.push(...c.errors);
        warnings.push(...c.warnings);
    }
    return { errors, warnings };
}

function main() {
    const args = process.argv.slice(2);
    const staged = args.includes('--staged');
    const ci = args.includes('--ci');
    const strict = args.includes('--strict');
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
    const changed = ci ? [] : changedFiles(root, { staged });
    const { errors, warnings } = runChecks({ root, changed, staged, ci });
    for (const w of warnings) console.log(`  ⚠️  ${w}`);
    for (const e of errors) console.log(strict ? `  ❌ ${e}` : `  ⚠️  (por corregir) ${e}`);
    if (errors.length && strict) {
        console.log(`\n❌ [docs-check] ${errors.length} problema(s) de documentación. Corrígelos o revisa docs/LEY-DOCUMENTACION.md.`);
        process.exit(1);
    }
    if (errors.length) {
        console.log(`\n⚠️  [docs-check] ${errors.length} problema(s) por corregir (modo suave: no frena el commit). Revisa docs/LEY-DOCUMENTACION.md.`);
        return;
    }
    console.log(warnings.length ? `✅ [docs-check] Sin errores (${warnings.length} aviso(s) arriba).` : '✅ [docs-check] Documentación al día.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
