/**
 * Novedades por versión — lo que ve el dueño en el aviso de actualización.
 *
 * CÓMO SE MANTIENE (1 minuto por versión):
 *  1. Al subir la versión en package.json, agrega UNA entrada AL PRINCIPIO de esta lista.
 *  2. Máximo 4 mejoras, en lenguaje de bodega (nada técnico), título corto + una frase.
 *  3. La prueba tests/releaseNotes.test.js falla si falta la nota de la versión actual.
 *
 * Orden: la más nueva primero. `fecha` en formato AAAA-MM-DD.
 */
export const RELEASE_NOTES = [
  {
    version: '2.0.5',
    fecha: '2026-10-29',
    mejoras: [
      { icono: '🛒', titulo: 'Vende desde el monitor', texto: 'Ahora puedes vender y anular ventas desde tu teléfono, aunque no estés en la caja.' },
      { icono: '📦', titulo: 'Compras de mercancía', texto: 'Registra lo que compras a tus proveedores y se actualiza el inventario.' },
      { icono: '🧾', titulo: 'Facturas de proveedores', texto: 'Carga facturas con foto, marca las pagadas y saca el reporte en PDF por período.' },
    ],
  },
  {
    version: '2.0.4',
    fecha: '2026-10-22',
    mejoras: [
      { icono: '⚡', titulo: 'Inventario más rápido', texto: 'Cargar o ajustar muchos productos a la vez ya no hace lenta la caja.' },
      { icono: '📦', titulo: 'Bultos más claros', texto: 'El inventario por bultos y unidades se entiende mejor.' },
    ],
  },
];
