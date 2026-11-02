import { describe, it, expect } from 'vitest';
import { getChatSuggestions } from '../src/services/chatSuggestions';

describe('sugerencias del asistente por rol', () => {
  it('el cajero no ve cuadre, cuentas por cobrar ni últimas ventas', () => {
    const ids = getChatSuggestions('CAJERO').map((s) => s.id);
    expect(ids).not.toContain('cuadre');
    expect(ids).not.toContain('cobrar');
    expect(ids).not.toContain('ventas');
    expect(ids).toContain('vuelto');
  });

  it('sin rol se trata como cajero', () => {
    expect(getChatSuggestions(undefined).map((s) => s.id)).not.toContain('cuadre');
  });

  it('el administrador ve todas', () => {
    const ids = getChatSuggestions('ADMIN').map((s) => s.id);
    expect(ids).toEqual(expect.arrayContaining(['cuadre', 'cobrar', 'ventas', 'anular', 'supervisor']));
  });
});
