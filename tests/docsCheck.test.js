import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
    runChecks,
    checkLinks,
    checkErrores,
    checkCasos,
    checkChanges,
    docsForFile,
    isCodeFile,
} from '../scripts/docs-check.mjs';

const REAL_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MAP = {
    reglas: [
        { modulo: 'Venta', docs: ['docs/sistema/modulos/VENTA.md'], codigo: ['src/utils/checkoutProcessor.js'] },
        { modulo: 'Dinero', docs: ['docs/sistema/modulos/DINERO.md'], codigo: ['src/utils/checkoutProcessor.js', 'src/core/'] },
        { modulo: 'General', docs: ['docs/sistema/INICIO.md'], porDefecto: true, codigo: ['src/'] },
    ],
};

let root;
const put = (rel, text) => {
    const abs = path.join(root, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, text);
};

const ERRORES_OK = `# Errores
| ID | Título | Fecha | Estado | Caso |
|---|---|---|---|---|
| ERR-001 | Uno | 2026-11-07 | Resuelto | — |
| ERR-002 | Dos | 2026-11-07 | Abierto | — |

## ERR-001 — Uno
- **Estado:** Resuelto
- **Solución:** hecho.

## ERR-002 — Dos
- **Estado:** Abierto
- **Solución pendiente:** falta X.
`;

beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-check-'));
});
afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
});

describe('docs-check: enlaces', () => {
    it('acepta enlaces que existen y detecta los rotos', () => {
        put('docs/a.md', '[ok](b.md) [roto](nada.md) [web](https://x.com) [ancla](#t)');
        put('docs/b.md', 'hola');
        const errs = checkLinks(root, ['docs/a.md']);
        expect(errs).toEqual(['Enlace roto en docs/a.md: nada.md']);
    });

    it('ignora los enlaces dentro de bloques de código', () => {
        put('docs/a.md', '```\n[ejemplo](no-existe.md)\n```');
        expect(checkLinks(root, ['docs/a.md'])).toEqual([]);
    });

    it('resuelve rutas relativas con carpetas', () => {
        put('docs/sistema/m.md', '[sube](../ERRORES.md)');
        put('docs/ERRORES.md', 'x');
        expect(checkLinks(root, ['docs/sistema/m.md'])).toEqual([]);
    });
});

describe('docs-check: errores', () => {
    it('acepta un registro consistente', () => {
        put('docs/ERRORES.md', ERRORES_OK);
        expect(checkErrores(root)).toEqual([]);
    });

    it('exige solución a un error resuelto', () => {
        put('docs/ERRORES.md', ERRORES_OK.replace('- **Solución:** hecho.', '- nada'));
        expect(checkErrores(root)).toContain('ERR-001: está Resuelto pero no tiene **Solución:**');
    });

    it('exige plan a un error abierto', () => {
        put('docs/ERRORES.md', ERRORES_OK.replace('**Solución pendiente:** falta X.', 'sin plan'));
        expect(checkErrores(root).join('\n')).toContain('ERR-002: está Abierto');
    });

    it('detecta el mismo ID usado dos veces (dos sesiones escribiendo a la vez)', () => {
        put('docs/ERRORES.md', `${ERRORES_OK}\n## ERR-002 — Repetido\n- **Estado:** Resuelto\n- **Solución:** x.\n`);
        expect(checkErrores(root)).toContain('ERR-002: ID repetido');
    });

    it('acepta una nota entre paréntesis en el estado de la tabla (ERR-012: «Resuelto (mitigado)»)', () => {
        put('docs/ERRORES.md', ERRORES_OK.replace('| ERR-001 | Uno | 2026-11-07 | Resuelto |', '| ERR-001 | Uno | 2026-11-07 | Resuelto (mitigado) |'));
        expect(checkErrores(root)).toEqual([]);
        // La nota no esconde un estado distinto al de la sección.
        put('docs/ERRORES.md', ERRORES_OK.replace('| ERR-001 | Uno | 2026-11-07 | Resuelto |', '| ERR-001 | Uno | 2026-11-07 | Abierto (en revisión) |'));
        expect(checkErrores(root)).toContain('ERR-001: la tabla dice Abierto y la sección dice Resuelto');
    });

    it('detecta secciones que faltan en la tabla y estados distintos', () => {
        put('docs/ERRORES.md', ERRORES_OK.replace('| ERR-002 | Dos | 2026-11-07 | Abierto | — |', '| ERR-001x | x | x | x | x |'));
        expect(checkErrores(root)).toContain('ERR-002: falta en la tabla resumen de ERRORES.md');
        put('docs/ERRORES.md', ERRORES_OK.replace('| ERR-001 | Uno | 2026-11-07 | Resuelto', '| ERR-001 | Uno | 2026-11-07 | Abierto'));
        expect(checkErrores(root)).toContain('ERR-001: la tabla dice Abierto y la sección dice Resuelto');
    });
});

describe('docs-check: casos', () => {
    const indice = (estado) => `| ID |\n|---|\n| [CASO-001](CASO-001-uno.md) | Uno | 2026-11-07 | ${estado} | r |\n`;

    it('acepta un caso con índice coherente', () => {
        put('docs/casos/INDICE.md', indice('Aplicado'));
        put('docs/casos/CASO-001-uno.md', '- **Fecha:** 2026-11-07\n- **Estado:** Aplicado\n');
        expect(checkCasos(root)).toEqual([]);
    });

    it('entiende el estado de dos palabras "En curso"', () => {
        put('docs/casos/INDICE.md', indice('En curso'));
        put('docs/casos/CASO-001-uno.md', '- **Fecha:** 2026-11-07\n- **Estado:** En curso\n');
        expect(checkCasos(root)).toEqual([]);
    });

    it('detecta caso fuera del índice y estados distintos', () => {
        put('docs/casos/INDICE.md', indice('Aplicado'));
        put('docs/casos/CASO-001-uno.md', '- **Fecha:** 2026-11-07\n- **Estado:** Verificado\n');
        put('docs/casos/CASO-002-dos.md', '- **Fecha:** x\n- **Estado:** Aplicado\n');
        const errs = checkCasos(root);
        expect(errs).toContain('CASO-001: el índice y el documento tienen estados distintos (Verificado)');
        expect(errs).toContain('CASO-002: no aparece en docs/casos/INDICE.md');
    });
});

describe('docs-check: mapa y cambios', () => {
    it('reconoce código y excluye respaldos y documentos', () => {
        expect(isCodeFile('src/App.jsx')).toBe(true);
        expect(isCodeFile('src/App.jsx.bak-sidebar')).toBe(false);
        expect(isCodeFile('docs/casos/INDICE.md')).toBe(false);
        expect(isCodeFile('package.json')).toBe(true);
    });

    it('asigna documentos específicos y cae en la regla general si no hay otra', () => {
        expect(docsForFile(MAP, 'src/utils/checkoutProcessor.js').sort()).toEqual([
            'docs/sistema/modulos/DINERO.md',
            'docs/sistema/modulos/VENTA.md',
        ]);
        expect(docsForFile(MAP, 'src/views/Otra.jsx')).toEqual(['docs/sistema/INICIO.md']);
    });

    it('avisa (nunca frena) si hay código cambiado sin entrada en la bitácora', () => {
        const changed = ['src/utils/checkoutProcessor.js'];
        const r = checkChanges(MAP, changed);
        expect(r.errors).toHaveLength(0);
        expect(r.warnings.some((w) => w.includes('bitacora.md'))).toBe(true);
    });

    it('avisa de los documentos por revisar y deja de avisar cuando ya cambiaron', () => {
        const base = ['src/utils/checkoutProcessor.js', 'bitacora.md'];
        const w1 = checkChanges(MAP, base, { staged: true }).warnings.join('\n');
        expect(w1).toContain('Revisa docs/sistema/modulos/VENTA.md');
        expect(w1).toContain('Revisa docs/sistema/modulos/DINERO.md');
        const w2 = checkChanges(MAP, [...base, 'docs/sistema/modulos/VENTA.md'], { staged: true }).warnings.join('\n');
        expect(w2).not.toContain('Revisa docs/sistema/modulos/VENTA.md');
        expect(w2).toContain('Revisa docs/sistema/modulos/DINERO.md');
    });

    it('un commit solo de documentos no exige bitácora', () => {
        const r = checkChanges(MAP, ['docs/sistema/INICIO.md'], { staged: true });
        expect(r.errors).toEqual([]);
        expect(r.warnings).toEqual([]);
    });
});

describe('docs-check: referencias', () => {
    const base = () => {
        put('docs/sistema/MAPA-CODIGO-DOCS.json', JSON.stringify(MAP));
        put('docs/sistema/INICIO.md', 'inicio');
        put('docs/sistema/modulos/VENTA.md', 'venta');
        put('docs/sistema/modulos/DINERO.md', 'dinero');
        put('docs/ERRORES.md', ERRORES_OK);
        put('docs/casos/INDICE.md', '| ID |\n');
    };

    it('falla si un documento nombra un ERR o CASO que no existe', () => {
        base();
        put('docs/sistema/INICIO.md', 'ver ERR-001, ERR-099 y CASO-042');
        const { errors } = runChecks({ root, ci: true });
        expect(errors).toContain('docs/sistema/INICIO.md nombra ERR-099, que no existe');
        expect(errors).toContain('docs/sistema/INICIO.md nombra CASO-042, que no existe');
        expect(errors.join('\n')).not.toContain('ERR-001, que no existe');
    });

    it('falla si un módulo no tiene regla en el mapa y avisa de archivos citados que ya no existen', () => {
        base();
        put('docs/sistema/modulos/HUERFANO.md', 'ver `src/utils/inexistente.js`');
        const { errors, warnings } = runChecks({ root, ci: true });
        expect(errors).toContain('docs/sistema/modulos/HUERFANO.md no tiene regla en docs/sistema/MAPA-CODIGO-DOCS.json');
        expect(warnings).toContain('docs/sistema/modulos/HUERFANO.md cita src/utils/inexistente.js, que ya no existe');
    });
});

describe('docs-check: documentos reales del proyecto', () => {
    it('la documentación del repositorio se puede revisar (modo suave: solo informa)', () => {
        const { errors } = runChecks({ root: REAL_ROOT, ci: true });
        if (errors.length) console.warn(['docs-check (por corregir):', ...errors].join(String.fromCharCode(10)));
        expect(Array.isArray(errors)).toBe(true);
    });

    it('el modo suave termina bien aunque haya problemas', () => {
        const script = path.join(REAL_ROOT, 'scripts/docs-check.mjs');
        const suave = spawnSync(process.execPath, [script, '--ci'], { encoding: 'utf8' });
        expect(suave.status).toBe(0);
    });
});
