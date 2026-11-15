import { describe, it, expect } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import { RELEASE_NOTES } from '../src/data/releaseNotes.js';
import { compareVersions, notasPendientes, formatearFecha, versionDesdeNovedades, VERSION_ANTES_DE_NOVEDADES } from '../src/utils/releaseNotes.js';

describe('notas de versión', () => {
  it('la versión actual de package.json tiene su nota (agrégala en src/data/releaseNotes.js)', () => {
    const nota = RELEASE_NOTES.find((n) => n.version === pkg.version);
    expect(nota, `Falta la nota de la versión ${pkg.version}`).toBeTruthy();
  });

  it('cada nota tiene fecha y de 1 a 4 mejoras con título y texto', () => {
    for (const n of RELEASE_NOTES) {
      expect(n.fecha).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(n.mejoras.length).toBeGreaterThanOrEqual(1);
      expect(n.mejoras.length).toBeLessThanOrEqual(4);
      for (const m of n.mejoras) {
        expect(m.icono && m.titulo && m.texto).toBeTruthy();
      }
    }
  });

  it('está ordenada de la más nueva a la más vieja y sin versiones repetidas', () => {
    const v = RELEASE_NOTES.map((n) => n.version);
    expect(new Set(v).size).toBe(v.length);
    for (let i = 1; i < v.length; i += 1) expect(compareVersions(v[i - 1], v[i])).toBe(1);
  });
});

describe('utilidades', () => {
  it('compara versiones numéricamente (2.0.10 > 2.0.9)', () => {
    expect(compareVersions('2.0.10', '2.0.9')).toBe(1);
    expect(compareVersions('2.0.5', '2.0.5')).toBe(0);
    expect(compareVersions('1.9.9', '2.0.0')).toBe(-1);
  });

  it('acumula las versiones saltadas, más nueva primero', () => {
    const notas = [
      { version: '2.0.7', mejoras: [{}] }, { version: '2.0.6', mejoras: [{}] }, { version: '2.0.5', mejoras: [{}] },
    ];
    expect(notasPendientes(notas, '2.0.5').map((n) => n.version)).toEqual(['2.0.7', '2.0.6']);
    expect(notasPendientes(notas, '2.0.5', '2.0.6').map((n) => n.version)).toEqual(['2.0.6']);
    expect(notasPendientes(notas, '2.0.7')).toEqual([]);
    expect(notasPendientes(null, '2.0.5')).toEqual([]);
  });

  it('una caja en uso que viene de 2.0.5 (sin versión vista) ve las novedades nuevas', () => {
    expect(versionDesdeNovedades(null, true)).toBe(VERSION_ANTES_DE_NOVEDADES);
    expect(notasPendientes(RELEASE_NOTES, versionDesdeNovedades(null, true), '2.0.6').map((n) => n.version)).toEqual(['2.0.6']);
  });

  it('una instalación nueva no ve novedades y una versión vista guardada manda', () => {
    expect(versionDesdeNovedades(null, false)).toBeNull();
    expect(versionDesdeNovedades('2.0.6', true)).toBe('2.0.6');
    expect(notasPendientes(RELEASE_NOTES, versionDesdeNovedades('2.0.6', true), '2.0.6')).toEqual([]);
  });

  it('formatea la fecha en español', () => {
    expect(formatearFecha('2026-10-29')).toBe('29 de octubre de 2026');
    expect(formatearFecha('x')).toBe('');
  });
});
