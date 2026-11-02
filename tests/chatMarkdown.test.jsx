// @vitest-environment jsdom
// Renderizado del markdown del asistente: tablas, listas numeradas y viñetas.
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderChatMarkdown } from '../src/components/Chat/ChatMarkdown';

let container;
let root;
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

const render = async (text) => act(async () => root.render(<div>{renderChatMarkdown(text)}</div>));

describe('renderChatMarkdown', () => {
  it('dibuja una tabla con encabezado y filas, sin mostrar la fila separadora', async () => {
    await render('| Método | Vuelto |\n|---|---|\n| Efectivo | Sí |\n| Pago móvil | No |');
    expect(container.querySelectorAll('table')).toHaveLength(1);
    expect([...container.querySelectorAll('th')].map((th) => th.textContent)).toEqual(['Método', 'Vuelto']);
    expect(container.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(container.textContent).not.toContain('---');
  });

  it('una sola línea con barras (streaming) se muestra como texto, no como tabla', async () => {
    await render('| Método | Vuelto |');
    expect(container.querySelectorAll('table')).toHaveLength(0);
    expect(container.textContent).toContain('Método');
  });

  it('dibuja listas numeradas y viñetas', async () => {
    await render('1. Abre Reportes\n2) Elige Ventas\n- Filtra por Anuladas');
    expect(container.textContent).toContain('1.');
    expect(container.textContent).toContain('Abre Reportes');
    expect(container.textContent).toContain('2.');
    expect(container.textContent).toContain('•');
  });

  it('negritas dentro de una celda de tabla', async () => {
    await render('| A | B |\n|---|---|\n| **fuerte** | x |');
    expect(container.querySelector('td strong')?.textContent).toBe('fuerte');
  });
});
