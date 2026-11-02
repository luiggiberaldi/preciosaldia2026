// @vitest-environment jsdom
// Contexto en tiempo real del asistente: turno, compras del mes y proveedores (solo roles no cajero).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildPurchase } from '../src/utils/merchandisePurchases';

const store = {};
vi.mock('../src/utils/storageService', () => ({
  storageService: { getItem: async (key, fallback) => (key in store ? store[key] : fallback) },
}));

import { compileSystemConsciousnessContext } from '../src/services/systemConsciousnessService';

const base = { effectiveRate: 40, tasaCop: 0, products: [], cart: [], isOnline: true };

beforeEach(() => {
  vi.useFakeTimers();
  // 15/11/2026 10:00 en Caracas.
  vi.setSystemTime(new Date('2026-11-15T14:00:00Z'));
  const purchase = buildPurchase({ date: '2026-11-10', supplier: 'COLORANTES', amount: 37, currency: 'USD' }).purchase;
  store.bodega_merchandise_purchases_v1 = [purchase];
  store.bodega_suppliers_v1 = [{ id: 's1', name: 'Distribuidora Sol', deuda: 120 }];
  store.bodega_supplier_invoices_v1 = [{ id: 'f1', supplierId: 's1', amountUsd: 120, date: '2026-11-01', dueDate: '2026-11-05' }];
  store.bodega_sales_v1 = [{ id: 'a1', tipo: 'APERTURA_CAJA', timestamp: '2026-11-15T12:00:00Z', cajaCerrada: false }];
});
afterEach(() => { vi.useRealTimers(); Object.keys(store).forEach((k) => delete store[k]); });

describe('compileSystemConsciousnessContext', () => {
  it('el administrador recibe turno, compras del mes y cuentas por pagar', async () => {
    const text = await compileSystemConsciousnessContext({ ...base, usuarioActivo: { rol: 'ADMIN', nombre: 'Ana' } });
    expect(text).toContain('Turno de caja: Abierto desde');
    expect(text).toContain('1 compras este mes | Total: $37.00 USD | Mayor proveedor: COLORANTES');
    expect(text).toContain('1 proveedores con deuda | Total por pagar: $120.00 USD');
    expect(text).toContain('1 facturas vencidas');
  });

  it('el cajero ve el turno pero nunca compras ni proveedores', async () => {
    const text = await compileSystemConsciousnessContext({ ...base, usuarioActivo: { rol: 'CAJERO', nombre: 'Luis' } });
    expect(text).toContain('Turno de caja: Abierto desde');
    expect(text).not.toContain('COLORANTES');
    expect(text).not.toContain('Distribuidora');
    expect(text).not.toContain('por pagar');
  });

  it('sin turno abierto lo dice', async () => {
    store.bodega_sales_v1 = [];
    const text = await compileSystemConsciousnessContext({ ...base, usuarioActivo: { rol: 'ADMIN' } });
    expect(text).toContain('Turno de caja: Sin turno abierto');
  });
});
