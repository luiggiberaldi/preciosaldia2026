// tests/botDeterministicEngine.test.js — Motor offline del asistente (sin IA ni red).
// Cubre: palabras completas sin tildes, «hoy» en hora de Caracas y que el cajero
// no vea montos ni datos de otros turnos como propios.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const salesStore = { value: [] };
vi.mock('../src/utils/storageService', () => ({
  storageService: { getItem: async (_key, fallback) => salesStore.value ?? fallback },
}));

import { processDeterministicOfflineQuery, normalizeBotQuery, matchesAnyWord } from '../src/services/deterministicBotEngine';

const ADMIN = { rol: 'ADMIN', nombre: 'Ana' };
const CAJERO = { rol: 'CAJERO', nombre: 'Luis' };
const ctx = (usuarioActivo = ADMIN) => ({ effectiveRate: 40, tasaCop: 0, products: [], cart: [], usuarioActivo });

describe('normalizeBotQuery y coincidencia por palabra', () => {
  it('quita tildes y pasa a minúsculas', () => {
    expect(normalizeBotQuery('¿Cuánto Dólares?')).toBe('¿cuanto dolares?');
  });

  it('no confunde palabras que solo contienen la clave', () => {
    expect(matchesAnyWord(normalizeBotQuery('¿cuánto trabajo hoy?'), ['bajo'])).toBe(false);
    expect(matchesAnyWord(normalizeBotQuery('quiero cambiar la clave'), ['cambio'])).toBe(false);
    expect(matchesAnyWord(normalizeBotQuery('mis productos bajos'), ['bajo', 'bajos'])).toBe(true);
  });
});

describe('«hoy» en hora de Caracas', () => {
  beforeEach(() => {
    // 31/10/2026 21:00 en Caracas (UTC-4) = 01/11/2026 01:00 UTC.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-01T01:00:00Z'));
    salesStore.value = [
      { id: 'a', timestamp: '2026-10-31T14:00:00Z', totalUsd: 10, totalBs: 400, status: 'COMPLETADA' }, // 31/10 10:00 Caracas
      { id: 'b', timestamp: '2026-11-01T00:30:00Z', totalUsd: 5, totalBs: 200, status: 'COMPLETADA' },  // 31/10 20:30 Caracas
      { id: 'c', timestamp: '2026-10-31T01:00:00Z', totalUsd: 99, totalBs: 9, status: 'COMPLETADA' },   // 30/10 21:00 Caracas (ayer)
      { id: 'd', timestamp: '2026-10-31T15:00:00Z', totalUsd: 7, totalBs: 280, status: 'ANULADA' },     // anulada
    ];
  });
  afterEach(() => vi.useRealTimers());

  it('cuenta las ventas del día de Caracas (no el día UTC) y excluye anuladas', async () => {
    const reply = await processDeterministicOfflineQuery('¿cuántas ventas hoy?', ctx());
    expect(reply).toContain('**Ventas Completadas Hoy**: 2 transacciones');
    expect(reply).toContain('$15.00 USD');
  });

  it('el cajero ve solo el conteo del día, sin montos', async () => {
    const reply = await processDeterministicOfflineQuery('ventas de hoy', ctx(CAJERO));
    expect(reply).toContain('**Ventas procesadas hoy**: 2 transacciones');
    expect(reply).not.toContain('USD');
  });

  it('el cajero no recibe métricas financieras', async () => {
    const reply = await processDeterministicOfflineQuery('¿cuánta ganancia hoy?', ctx(CAJERO));
    expect(reply).toContain('Acceso Restringido');
  });
});

describe('respuesta por defecto', () => {
  it('no menciona variables de entorno al usuario', async () => {
    const reply = await processDeterministicOfflineQuery('hola', { ...ctx(), offlineReason: 'ai_service_error' });
    expect(reply).not.toMatch(/GROQ/);
  });
});
