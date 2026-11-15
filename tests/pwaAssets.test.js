// Toda imagen de public/ que use la app debe estar en el precache del service worker
// (includeAssets de vite.config.js). Si no, sin internet sale rota (ver
// docs/plans/2026-11-14-plan-logos-offline.md). El catálogo (public/images/catalog/)
// va aparte: se guarda en caché al verse, a propósito, porque pesa 42 MB.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
const PUBLIC = path.join(ROOT, 'public');

function listFiles(dir) {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) return listFiles(full);
        return /\.(jsx?|mjs)$/.test(e.name) ? [full] : [];
    });
}

function includeAssets() {
    const config = fs.readFileSync(path.join(ROOT, 'vite.config.js'), 'utf8');
    const block = config.match(/includeAssets:\s*\[([\s\S]*?)\]/);
    if (!block) throw new Error('No se encontró includeAssets en vite.config.js');
    return new Set([...block[1].matchAll(/'([^']+)'/g)].map((m) => m[1]));
}

// Rutas a imágenes en la raíz de public/: './logo.png', '/logo.png' o 'logo.png' entre comillas.
const IMAGE_REF = /['"`](?:\.?\/)?([\w.-]+\.(?:png|jpe?g|webp|svg|ico|gif))['"`]/g;

function imagesUsedByApp() {
    const used = new Map();
    for (const file of listFiles(SRC)) {
        if (file.includes(`${path.sep}remotion${path.sep}`)) continue; // videos de marketing, no la app
        const text = fs.readFileSync(file, 'utf8');
        for (const m of text.matchAll(IMAGE_REF)) {
            const name = m[1];
            if (!fs.existsSync(path.join(PUBLIC, name))) continue; // no es un archivo de public/
            if (!used.has(name)) used.set(name, path.relative(ROOT, file));
        }
    }
    return used;
}

describe('imágenes de public/ disponibles sin internet', () => {
    it('encuentra las imágenes conocidas (la búsqueda funciona)', () => {
        const used = imagesUsedByApp();
        expect(used.has('logo.png')).toBe(true);
        expect(used.has('apple-touch-icon.png')).toBe(true);
    });

    it('cada imagen usada por la app está en includeAssets', () => {
        const assets = includeAssets();
        const missing = [...imagesUsedByApp()]
            .filter(([name]) => !assets.has(name))
            .map(([name, file]) => `${name} (usada en ${file})`);
        expect(missing).toEqual([]);
    });

    it('cada archivo de includeAssets existe en public/', () => {
        const missing = [...includeAssets()].filter((name) => !fs.existsSync(path.join(PUBLIC, name)));
        expect(missing).toEqual([]);
    });
});
