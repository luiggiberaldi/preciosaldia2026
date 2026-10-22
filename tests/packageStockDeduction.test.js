/**
 * TDD: Deducción correcta de stock para modos 'package' y 'unit'.
 * Ejecutar: npx vitest tests/packageStockDeduction.test.js
 */
import { describe, it, expect } from 'vitest';
import { calculateItemStockDeduction } from '../src/utils/granel.js';

describe('calculateItemStockDeduction — bultos y unidades sueltas', () => {

  // ── Modo package (bultos) ──────────────────────────────────────────────────
  it('1 bulto de 20 unidades deduce 20 del stock', () => {
    const item = { qty: 1, _mode: 'package', packagingType: 'lote', _unitsPerPackage: 20 };
    expect(calculateItemStockDeduction(item)).toBe(20);
  });

  it('3 bultos de 6 unidades deducen 18 del stock', () => {
    const item = { qty: 3, _mode: 'package', packagingType: 'lote', _unitsPerPackage: 6 };
    expect(calculateItemStockDeduction(item)).toBe(18);
  });

  it('bulto sin unitsPerPackage (default 1) deduce qty × 1', () => {
    const item = { qty: 2, _mode: 'package', packagingType: 'lote' };
    expect(calculateItemStockDeduction(item)).toBe(2);
  });

  it('producto legado unit=paquete también multiplica', () => {
    const item = { qty: 2, _mode: 'package', unit: 'paquete', _unitsPerPackage: 10 };
    expect(calculateItemStockDeduction(item)).toBe(20);
  });

  // ── Modo unit (unidades sueltas) ───────────────────────────────────────────
  it('1 unidad suelta deduce 1 del stock (no divide)', () => {
    const item = { qty: 1, _mode: 'unit', packagingType: 'lote', _unitsPerPackage: 20 };
    expect(calculateItemStockDeduction(item)).toBe(1);
  });

  it('5 unidades sueltas de bulto-12 deducen 5 del stock', () => {
    const item = { qty: 5, _mode: 'unit', packagingType: 'lote', _unitsPerPackage: 12 };
    expect(calculateItemStockDeduction(item)).toBe(5);
  });

  // ── NO multiplicar fuera de bulto (regresión) ──────────────────────────────
  it('suelto/unidad con unitsPerPackage configurado NO multiplica', () => {
    const item = { qty: 2, _mode: 'package', packagingType: 'suelto', _unitsPerPackage: 24 };
    expect(calculateItemStockDeduction(item)).toBe(2);
  });

  // ── Granel (no tocar — debe seguir igual) ─────────────────────────────────
  // Nota: llevan _unitsPerPackage a propósito; si la rama granel se elimina,
  // qty × 20 rompería el test y la prueba fallaría (tests discriminantes).
  it('granel 0.125 kg deduce 0.125 exacto del stock', () => {
    const item = { qty: 0.125, _mode: 'package', isWeight: true, granelUnit: 'kg', _unitsPerPackage: 20 };
    expect(calculateItemStockDeduction(item)).toBeCloseTo(0.125, 3);
  });

  it('granel 2.5 L deduce 2.5 del stock', () => {
    const item = { qty: 2.5, _mode: 'package', isWeight: true, granelUnit: 'litro', _unitsPerPackage: 20 };
    expect(calculateItemStockDeduction(item)).toBeCloseTo(2.5, 3);
  });
});
