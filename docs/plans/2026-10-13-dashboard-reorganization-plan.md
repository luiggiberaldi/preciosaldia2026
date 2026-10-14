# Plan: reorganización del dashboard con caja abierta

**Fecha:** 2026-10-13  
**Estado:** propuesta; no implementar hasta aprobación.  
**Alcance:** reorganizar la zona principal de resumen y acciones del dashboard; conservar los cálculos financieros existentes.

## Objetivo

Aprovechar el espacio horizontal que queda libre cuando la caja está abierta, presentar primero la información necesaria para operar y cerrar caja, y evitar filas excesivamente anchas o huecos causados por tarjetas de tamaños distintos.

## Diagnóstico actual

- [DashboardStats.jsx](../../src/components/Dashboard/DashboardStats.jsx) usa `grid-cols-2 lg:grid-cols-4`. Las tarjetas de ingresos, transacciones, ganancia y tasa ocupan una celda cada una; egresos y acciones ocupan cuatro columnas. La composición depende de si hoy hay egresos.
- El bloque de acciones coloca «Cerrar Caja» y «Registrar Gasto» dentro de un contenedor de cuatro columnas, con dos tarjetas grandes a partir de `sm`.
- [DashboardView.jsx](../../src/views/DashboardView.jsx) coloca medios de pago, efectivo esperado y actividad semanal en una sola columna, aunque haya espacio disponible al lado.
- [EfectivoEsperadoCard.jsx](../../src/components/Dashboard/EfectivoEsperadoCard.jsx) ya existe y utiliza la fórmula compartida con el cierre; moverla en el layout no debe cambiar cálculo ni visibilidad.
- El dashboard de cajero usa una rama de render diferente del dashboard completo. El rediseño debe preservar ese flujo de caja activa e historial.
- En las capturas, la columna lateral de inventario y la cabecera ya consumen ancho. El nuevo grid debe evitar comprimir excesivamente la columna principal en portátiles.

## Propuesta de composición

### Resumen y acciones principales

1. Convertir la zona de métricas en un grid adaptable: 2 columnas en móvil y hasta 4 en escritorio.
2. Dar a las tarjetas de ingresos, ventas, egresos y ganancia el mismo patrón de tamaño y jerarquía visual. Egresos debe ocupar una tarjeta normal, no una fila completa; mostrar total y cantidad de movimientos sin eliminar el desglose caja chica/proveedores existente.
3. Reubicar el efectivo esperado dentro del bloque prioritario, agrupando USD y Bs y conservando COP solo cuando está habilitado. En escritorio podrá ocupar dos columnas; en móvil se apila sin desbordarse.
4. Presentar «Cerrar Caja» como acción primaria y «Registrar Gasto» / «Aporte» como acciones secundarias. Mantener sus permisos y handlers sin cambios.
5. Dejar la tasa como indicador secundario o llevarla al bloque de contexto operativo, no al mismo nivel visual que saldo/egresos.

### Actividad y detalle

6. Agrupar medios de pago y actividad semanal en dos columnas cuando haya ancho suficiente; apilarlos en pantallas estrechas.
7. Mantener historial de ventas y alertas de stock debajo o en la columna lateral, sin duplicar datos ni ocultar accesos actuales.
8. Conservar una sola columna principal si la columna lateral activa dejaría menos de un ancho útil acordado para tarjetas y texto. Definir el breakpoint mediante prueba visual (objetivo inicial: principal ≥ 720 px; lateral 300–340 px).

## Fases de implementación

### Fase 1 — Baseline y criterios de layout

- Registrar screenshots de la vista con caja abierta y datos vacíos / datos con ventas y egresos.
- Confirmar anchos disponibles y comportamiento actual en 390 px, 768 px, 1024 px y 1366×768 px.
- Verificar la vista ADMIN y la vista CAJERO; inventariar cuáles secciones tiene cada rol.

**Salida:** casos y anchos de referencia reproducibles; no se modifican valores ni cálculos.

### Fase 2 — Reorganizar métricas y acciones

- Cambiar el layout en [DashboardStats.jsx](../../src/components/Dashboard/DashboardStats.jsx) para que egresos y acciones no fuerzen filas de ancho completo sin necesidad.
- Ajustar variantes responsivas y alturas; asegurar que texto de moneda y contadores no se recorten.
- Conservar acciones, colores de estado, `triggerHaptic` y estado sin movimientos.

**Salida:** el resumen no deja celdas vacías en los anchos objetivo y la jerarquía de acciones sigue clara.

### Fase 3 — Crear una sección de trabajo de caja

- Agrupar efectivo esperado, medios de pago y actividad semanal en el área principal de [DashboardView.jsx](../../src/views/DashboardView.jsx).
- En escritorio, ubicar efectivo esperado junto a las acciones/resumen y medios de pago junto a actividad semanal; en móvil, ordenarlos verticalmente por prioridad.
- Preservar `calcularEfectivoEsperado` como fuente única usada por dashboard y cierre; no duplicar ni recalcular importes en componentes.
- Mantener los egresos visualmente separados de los medios de pago y evitar que distorsionen sus porcentajes.

**Salida:** dashboard y wizard muestran los mismos valores esperados para USD/Bs/COP; cerrar caja y registrar movimientos mantienen el comportamiento actual.

### Fase 4 — Validar por rol, estado y viewport

- Confirmar el permiso de la tarjeta de efectivo esperado: ADMIN la ve; CAJERO no la ve cuando el login por rol está activo. Probar explícitamente el modo sin login antes de decidir su visibilidad.
- Probar caja abierta y caja sin movimientos; una caja cerrada debe seguir usando su overlay y no presentar controles de turno activo.
- Revisar contraste, foco de teclado, targets táctiles, modo oscuro y scroll en viewport bajo.

**Salida:** criterios de aceptación abajo satisfechos en cada viewport y rol.

## Archivos candidatos

- `src/components/Dashboard/DashboardStats.jsx` — grid de métricas, egresos y acciones.
- `src/views/DashboardView.jsx` — composición de la columna principal/lateral y orden de secciones.
- `src/components/Dashboard/EfectivoEsperadoCard.jsx` — solo ajustes visuales/responsive; conservar fórmula y recibir datos existentes.
- `src/components/Dashboard/DashboardPaymentBreakdown.jsx` — solo si la nueva composición exige clases responsive; conservar egresos separados y porcentajes.
- Tests de componentes / utilidades del dashboard — cubrir visibilidad de efectivo esperado por rol si existe infraestructura de render; en todo caso mantener pruebas de `cajaEsperada`.

No cambiar `FinancialEngine`, `useDashboardMetrics`, lógica de cierre, permisos de gastos/aportes o contratos del supervisor como parte de esta reorganización, salvo que la auditoría de UI encuentre un defecto independiente y se apruebe su alcance.

## Criterios de aceptación

- En escritorio (1366×768), la zona inicial no deja celdas vacías en el grid de métricas cuando hay egresos ni cuando no los hay.
- El efectivo esperado en USD y Bs se encuentra junto a la información/acción de caja, es legible y coincide exactamente con el wizard de cierre para los mismos datos.
- Medios de pago no presenta egresos como pagos negativos ni calcula porcentajes con los egresos incluidos.
- En 390 px y 768 px no hay scroll horizontal, texto recortado ni botones inaccesibles; el orden prioriza efectivo y cierre antes de gráficas e historial.
- ADMIN y CAJERO conservan las acciones y datos autorizados; la tarjeta administrativa no queda visible al cajero con login activo.
- No cambia el cómputo financiero, filtros de turno, creación de cierres ni registros almacenados.
- Modo claro/oscuro conserva contraste suficiente y foco visible.

## Verificación prevista

1. Pruebas unitarias existentes de `cajaEsperada`, `paymentBreakdownView`, métricas y cierre; añadir pruebas de render/permiso si el repositorio ya tiene patrón para componentes React.
2. ESLint sobre cada archivo tocado y `vite build`.
3. Ejecutar la app en navegador con datos controlados: sin actividad, ventas, gasto USD, gasto Bs, aporte, vuelta y actividad mixta; comparar efectivo esperado con el wizard.
4. Capturar y revisar los viewports 390×844, 768×1024, 1024×768 y 1366×768; revisar consola y scroll horizontal.
5. Validar estados ADMIN, CAJERO y sin login si ese modo sigue soportado.

## Riesgos y decisiones pendientes

- **Visibilidad de efectivo esperado sin login:** el dashboard usa `isCajero` (solo CAJERO autenticado), así que `!isCajero` también incluye modo sin login. Confirmar si esto es aceptable o si «solo admin» debe ocultarla sin sesión.
- **Breakpoints:** la columna lateral de inventario se activa al breakpoint `lg`; decidir con capturas reales si debe retrasarse a `xl` cuando deje una columna principal demasiado estrecha.
- **Densidad de datos:** no eliminar egresos, deuda, movimientos o alertas para llenar espacio; priorizar compactación, agrupación y orden responsivo.
- **Sin inventar totales:** no sumar monedas distintas en una cifra única sin una tasa y semántica explícitas; mostrar USD, Bs y COP por separado.
