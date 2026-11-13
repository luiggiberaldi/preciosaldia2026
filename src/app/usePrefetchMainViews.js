// Traído de Farmacia (RAPIDEZ-R5): con la app ya abierta y el navegador libre, descarga
// en segundo plano Vender e Inventario para que el primer toque no muestre el esqueleto
// mientras baja el archivo. No hace nada con «ahorro de datos».
import { useEffect } from 'react';

export function usePrefetchMainViews(enabled = true) {
  useEffect(() => {
    if (!enabled) return undefined;
    if (typeof navigator !== 'undefined' && navigator.connection?.saveData) return undefined;
    let idleId = null;
    const run = () => {
      import('../views/SalesView').catch(() => {});
      import('../views/ProductsView').catch(() => {});
    };
    const timer = setTimeout(() => {
      if (typeof window.requestIdleCallback === 'function') {
        idleId = window.requestIdleCallback(run, { timeout: 5000 });
      } else {
        run();
      }
    }, 3000);
    return () => {
      clearTimeout(timer);
      if (idleId !== null && typeof window.cancelIdleCallback === 'function') window.cancelIdleCallback(idleId);
    };
  }, [enabled]);
}
