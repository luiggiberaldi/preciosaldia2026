/**
 * Novedades por versión — lo que ve el dueño en el aviso de actualización.
 *
 * CÓMO SE MANTIENE (1 minuto por versión):
 *  1. Al subir la versión en package.json, agrega UNA entrada AL PRINCIPIO de esta lista.
 *  2. Máximo 4 mejoras, en lenguaje de bodega (nada técnico), título corto + una frase.
 *  3. La prueba tests/releaseNotes.test.js falla si falta la nota de la versión actual.
 *
 * `icono` es un nombre de la lista ICONOS de UpdateBanner.jsx: carrito, paquete, factura, rayo,
 * dinero, inicio, ajustes, grafico, escudo, estrella (si no existe, se usa estrella).
 *
 * Orden: la más nueva primero. `fecha` en formato AAAA-MM-DD.
 */
export const RELEASE_NOTES = [
  {
    version: '2.0.6',
    fecha: '2026-11-15',
    mejoras: [
      { icono: 'inicio', titulo: 'Pantalla nueva', texto: 'Menú a un lado, pantalla completa y un inicio más claro.' },
      { icono: 'carrito', titulo: 'Vender y cobrar más fácil', texto: 'Buscador mejorado, ventana de pago más clara y el vuelto bien anotado en $ y Bs.' },
      { icono: 'dinero', titulo: 'Nómina de tus empleados', texto: 'En Gestión anota adelantos, pagos, bonos y lo que se lleva cada empleado.' },
      { icono: 'factura', titulo: 'IVA en tus tickets', texto: 'Marca productos exentos y el IVA sale desglosado en el ticket y el cierre.' },
    ],
  },
  {
    version: '2.0.5',
    fecha: '2026-10-29',
    mejoras: [
      { icono: 'carrito', titulo: 'Vende desde el monitor', texto: 'Ahora puedes vender y anular ventas desde tu teléfono, aunque no estés en la caja.' },
      { icono: 'paquete', titulo: 'Compras de mercancía', texto: 'Registra lo que compras a tus proveedores y se actualiza el inventario.' },
      { icono: 'factura', titulo: 'Facturas de proveedores', texto: 'Carga facturas con foto, marca las pagadas y saca el reporte en PDF por período.' },
    ],
  },
  {
    version: '2.0.4',
    fecha: '2026-10-22',
    mejoras: [
      { icono: 'rayo', titulo: 'Inventario más rápido', texto: 'Cargar o ajustar muchos productos a la vez ya no hace lenta la caja.' },
      { icono: 'paquete', titulo: 'Bultos más claros', texto: 'El inventario por bultos y unidades se entiende mejor.' },
    ],
  },
];
