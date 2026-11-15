// Plan de egress Realtime F5: ningún `.channel()` escucha una tabla que no esté
// en la publicación `supabase_realtime`. Hasta el 14-nov-2026 había tres canales
// muertos (`licenses` ×2 y `backup_requests`): ocupaban conexiones y nunca
// recibían nada, y el respaldo remoto dependía en silencio del polling.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

function walk(dir, filter, out = []) {
    for (const name of readdirSync(dir)) {
        if (name === 'node_modules' || name.startsWith('.')) continue;
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path, filter, out);
        else if (filter(path)) out.push(path);
    }
    return out;
}

function listenedTables() {
    const tables = new Map();
    for (const file of walk('src', (p) => /\.(js|jsx|ts|tsx)$/.test(p))) {
        const code = readFileSync(file, 'utf8');
        const re = /['"]postgres_changes['"]\s*,\s*\{[^}]*?table:\s*['"]([a-z_]+)['"]/gs;
        for (const match of code.matchAll(re)) {
            if (!tables.has(match[1])) tables.set(match[1], []);
            tables.get(match[1]).push(file);
        }
    }
    return tables;
}

function publishedTables() {
    const sqlFiles = [
        ...readdirSync('.').filter((n) => n.endsWith('.sql')),
        ...walk('supabase', (p) => p.endsWith('.sql')),
    ];
    const published = new Set();
    for (const file of sqlFiles) {
        const sql = readFileSync(file, 'utf8');
        for (const match of sql.matchAll(/ALTER\s+PUBLICATION\s+supabase_realtime\s+ADD\s+TABLE\s+public\.([a-z_]+)/gi)) {
            published.add(match[1]);
        }
    }
    return published;
}

describe('Realtime: tablas escuchadas vs publicación', () => {
    it('toda tabla escuchada con postgres_changes está en supabase_realtime', () => {
        const listened = listenedTables();
        const published = publishedTables();
        const missing = [...listened.keys()].filter((table) => !published.has(table));
        expect(missing, `Tablas escuchadas fuera de la publicación: ${missing.map((t) => `${t} (${listened.get(t).join(', ')})`).join('; ')}`).toEqual([]);
    });

    it('licenses no se escucha por Realtime (el heartbeat la actualiza seguido)', () => {
        expect(listenedTables().has('licenses')).toBe(false);
        expect(publishedTables().has('licenses')).toBe(false);
    });

    it('backup_requests está publicada (camino primario de los respaldos remotos)', () => {
        expect(publishedTables().has('backup_requests')).toBe(true);
    });
});
