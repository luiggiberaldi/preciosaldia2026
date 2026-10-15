# Supervisor Inventory Flow Improvement Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convertir la pestaña Inventario del modo Supervisor en un flujo rápido de recepción y egreso por varios productos, sin perder auditoría, control de stock ni confirmación de la caja.

**Architecture:** Se conservará `supervisor.inventory.batch.adjust` como única operación autorizada para cambiar stock. La interfaz construirá un borrador local con varias líneas; al enviar, transformará cada línea en un comando idempotente y esperará el ACK de la caja. `expectedStock` se tomará del catálogo más reciente y cualquier conflicto detendrá únicamente la línea afectada, sin mostrar éxito falso.

**Tech Stack:** React 19, Vite, Supabase RPC/Realtime, IndexedDB/local storage, Vitest, Playwright y Tailwind CSS.

---

## Resultado UX esperado

La pestaña Inventario debe ofrecer dos acciones primarias junto al buscador:

```text
[Escanear código] [Recepción rápida] [Egreso rápido]

[Todos] [Bajo stock] [Agotados] [Movidos hoy]
```

La acción rápida abre una bandeja inferior en móvil y un panel lateral en escritorio. El usuario busca o escanea productos, agrega varias líneas y confirma una sola vez:

```text
Recepción de mercancía

Arroz       5 cajas × 12 = 60 unidades
Harina      3 bultos × 10 = 30 unidades
Aceite      8 unidades

[Cancelar] [Enviar recepción]
```

El formulario debe recordar la última presentación y usar `Compra recibida` como motivo inicial. En egresos debe exigir motivo y mostrar el stock proyectado antes de enviar.

## Alcance y reglas de negocio

- Ingreso y egreso pueden contener varias líneas.
- Una misma línea representa un producto, dirección, presentación, motivo y referencia.
- Líneas compatibles del mismo producto se pueden consolidar antes de enviar; líneas con motivos o referencias diferentes se conservan separadas para auditoría.
- Nunca se escribe stock directamente desde el Supervisor.
- Cada comando conserva `expectedStock`, `commandId`, `reasonCategory`, `reason` y `lotReference`.
- Un egreso que dejaría stock negativo se bloquea en la interfaz y también en la caja.
- Si una línea falla por conflicto de stock, las líneas ya confirmadas permanecen aplicadas y las restantes quedan pendientes de reintento.
- Crear, editar y eliminar productos permanecen disponibles, pero dejan de competir visualmente con las acciones diarias de inventario.

## Plan de implementación

### Task 1: Congelar el contrato de recepción y egreso

**Files:**
- Inspect: `src/components/Monitor/SupervisorInventoryBatchModal.jsx`
- Inspect: `src/services/supervisorInventoryCommand.js`
- Inspect: `src/services/supervisorCommandService.js`
- Modify: `tests/supervisorInventoryCommand.test.js`
- Modify: `tests/supervisorCommands.test.js`

**Step 1: Escribir pruebas de reglas para una línea**

Cubrir ingreso, egreso, consolidación de unidades, presentación por cajas/bultos, stock proyectado, motivo obligatorio y rechazo de stock negativo.

**Step 2: Ejecutar las pruebas actuales**

Run: `bunx vitest run tests/supervisorInventoryCommand.test.js tests/supervisorCommands.test.js --maxWorkers=1`

Expected: PASS antes de cambiar la interfaz; estas pruebas serán la red de seguridad del flujo existente.

**Step 3: Documentar el payload definitivo**

Usar este formato para cada línea enviada:

```js
{
  direction: 'ingreso' | 'egreso',
  productId: String(product.id),
  quantityInput: Number(quantityInput),
  inputUnit: 'unidades' | 'cajas' | 'bultos',
  unitsPerPackage: Number(unitsPerPackage),
  expectedStock: Number(product.stock),
  reasonCategory: direction === 'egreso' ? reasonCategory : null,
  reason: reason.trim(),
  lotReference: lotReference.trim() || null
}
```

**Step 4: Añadir casos de regresión para ambos sentidos**

Verificar que las órdenes de ingreso y egreso siguen siendo aceptadas por `validateSupervisorCommand` y por `isSupervisorCommandEnabled`.

### Task 2: Extraer un borrador de movimientos reutilizable

**Files:**
- Create: `src/services/supervisorInventoryDraft.js`
- Create: `tests/supervisorInventoryDraft.test.js`

**Step 1: Escribir pruebas del borrador**

Cubrir:

- crear borrador vacío con dirección y motivo predeterminados;
- agregar una línea;
- consolidar dos líneas compatibles del mismo producto;
- no consolidar líneas con motivos o referencias distintos;
- actualizar cantidad y presentación;
- eliminar una línea;
- calcular unidades totales y stock proyectado;
- rechazar cantidades no positivas.

**Step 2: Implementar funciones puras**

Exponer funciones pequeñas y sin React:

```js
createInventoryDraft(direction, defaults)
addInventoryDraftLine(draft, line)
updateInventoryDraftLine(draft, lineId, patch)
removeInventoryDraftLine(draft, lineId)
getInventoryDraftSummary(draft, products)
```

No guardar el borrador en Supabase. Debe vivir solo mientras el usuario prepara la recepción o el egreso.

**Step 3: Ejecutar la prueba aislada**

Run: `bunx vitest run tests/supervisorInventoryDraft.test.js --maxWorkers=1`

Expected: PASS.

### Task 3: Rediseñar la barra de inventario

**Files:**
- Modify: `src/views/OwnerMonitorView.jsx:1101-1420`
- Create: `src/components/Monitor/SupervisorInventoryToolbar.jsx`
- Create: `tests/supervisorInventoryToolbar.test.jsx`

**Step 1: Escribir pruebas de renderizado**

Verificar que aparecen:

- búsqueda por nombre y código;
- botón `Recepción rápida`;
- botón `Egreso rápido`;
- filtro `Movidos hoy`;
- acción `Nuevo Producto` como acción secundaria;
- acciones de ingreso/egreso por fila;
- etiquetas accesibles y estados disabled cuando la caja está desconectada.

**Step 2: Extraer la toolbar**

Mover el buscador, filtros y acciones superiores a `SupervisorInventoryToolbar`. Mantener la paginación y el filtro de stock en `OwnerMonitorView` para no mezclar el estado operativo con el estado visual.

**Step 3: Reordenar la jerarquía visual**

Mantener las métricas existentes, pero colocar primero las métricas operativas del día: ingresos, egresos y pendientes. El valor del inventario y la ganancia pueden quedar como información secundaria.

**Step 4: Quitar acciones destructivas del primer nivel**

Mover eliminar producto a un menú secundario con confirmación explícita. El ingreso y el egreso deben ser las acciones visualmente dominantes de cada fila.

**Step 5: Ejecutar pruebas de UI**

Run: `bunx vitest run tests/supervisorInventoryToolbar.test.jsx tests/supervisorResponsive.test.js --maxWorkers=1`

Expected: PASS y sin regresión responsive.

### Task 4: Crear el panel de recepción/egreso múltiple

**Files:**
- Create: `src/components/Monitor/SupervisorInventoryBatchPanel.jsx`
- Modify: `src/components/Monitor/SupervisorInventoryBatchModal.jsx`
- Modify: `src/views/OwnerMonitorView.jsx`
- Create: `tests/supervisorInventoryBatchPanel.test.jsx`

**Step 1: Escribir pruebas del flujo del panel**

Cubrir:

- abrir en modo ingreso o egreso;
- buscar un producto y agregarlo;
- seleccionar presentación y cantidad;
- mostrar unidades resultantes y stock después del movimiento;
- recordar unidades por caja durante la sesión;
- exigir motivo para egreso;
- impedir enviar un borrador vacío;
- mostrar resumen antes de confirmar;
- cerrar sin perder datos solo después de confirmación del usuario.

**Step 2: Implementar la vista responsive**

Usar un panel inferior en pantallas pequeñas y un panel lateral en escritorio. El buscador debe recibir el foco al abrirse. Cada línea debe tener controles grandes para cantidad, presentación, quitar y editar.

**Step 3: Agregar accesos rápidos por fila**

El botón de la fila debe abrir directamente el panel con el producto precargado y dirección definida. El usuario no debe volver a buscar el producto.

**Step 4: Añadir lectura de código de barras como mejora compatible**

Reutilizar el mecanismo de lectura existente del proyecto. Si la cámara no está disponible, conservar búsqueda manual sin bloquear el flujo.

**Step 5: Ejecutar pruebas del panel**

Run: `bunx vitest run tests/supervisorInventoryBatchPanel.test.jsx tests/supervisorInventoryDraft.test.js --maxWorkers=1`

Expected: PASS.

### Task 5: Enviar varias líneas con confirmación segura

**Files:**
- Create: `src/services/supervisorInventoryBatchSender.js`
- Create: `tests/supervisorInventoryBatchSender.test.js`
- Modify: `src/views/OwnerMonitorView.jsx`
- Modify: `src/services/supervisorCommandService.js` only if the sender needs a small reusable ACK helper

**Step 1: Escribir pruebas del envío**

Cubrir:

- enviar líneas en orden;
- esperar ACK por cada comando;
- no enviar líneas posteriores después de un conflicto crítico del mismo producto;
- conservar líneas fallidas para reintento;
- no duplicar una línea al repetir el envío;
- cerrar el panel únicamente cuando todas las líneas se confirmaron;
- mostrar resumen de aplicadas, rechazadas y pendientes.

**Step 2: Implementar el sender secuencial**

Enviar una línea por vez mediante `sendSupervisorCommand`. Generar un `commandId` distinto por línea. Para el mismo producto, actualizar el `expectedStock` con el stock confirmado antes de enviar la siguiente línea.

**Step 3: Añadir estado visual de progreso**

Mostrar `Enviando 2 de 5`, `Confirmado`, `Rechazado` o `Pendiente de reintento`. No usar un toast genérico de éxito si existe alguna línea sin confirmar.

**Step 4: Ejecutar pruebas de envío**

Run: `bunx vitest run tests/supervisorInventoryBatchSender.test.js tests/supervisorInventoryCommand.test.js --maxWorkers=1`

Expected: PASS.

### Task 6: Mejorar el historial operativo y la recuperación

**Files:**
- Modify: `src/views/OwnerMonitorView.jsx`
- Modify: `src/services/supervisorMetrics.js`
- Inspect/modify: `src/hooks/useMonitorSync.js`
- Modify: `tests/supervisorMetrics.test.js`
- Modify: `tests/supervisorSync.test.js`

**Step 1: Añadir métricas del día**

Calcular ingresos, egresos, unidades movidas y movimientos pendientes desde `bodega_sales_v1`, diferenciando `AJUSTE_ENTRADA` y `AJUSTE_SALIDA`.

**Step 2: Añadir filtro `Movidos hoy`**

Usar los movimientos auditados y la fecha local del negocio. No inferir movimientos solo por el stock actual.

**Step 3: Mostrar último movimiento por producto**

En cada fila mostrar fecha, tipo y cantidad del último ajuste, con un estado claro si aún no existe movimiento.

**Step 4: Confirmar refresco después del ACK**

Tras confirmar una línea, forzar la actualización del catálogo y de los movimientos del Supervisor. Si la sincronización queda degradada, mostrar los datos confirmados localmente y un botón `Actualizar`.

### Task 7: Validación visual y E2E

**Files:**
- Create: `tests/e2e/supervisor-inventory-quick-actions.e2e.spec.js`
- Modify: `tests/e2e/supervisor-responsive.e2e.spec.js`
- Create: `docs/reports/YYYY-MM-DD-supervisor-inventory-quick-actions.md`

**Step 1: Probar la ruta rápida de ingreso**

Verificar que un usuario puede abrir Inventario, iniciar Recepción rápida, agregar al menos dos productos, confirmar y ver el ACK.

**Step 2: Probar la ruta rápida de egreso**

Verificar motivo obligatorio, cálculo de stock proyectado y bloqueo de cantidades superiores al stock disponible.

**Step 3: Probar desconexión y reintento**

Desconectar la caja antes del envío. La interfaz debe conservar el borrador y no mostrar éxito. Al reconectar, debe poder reintentarse sin duplicar movimientos.

**Step 4: Probar móvil y escritorio**

Validar panel inferior, panel lateral, botones táctiles, foco del buscador, scroll y resumen fijo de confirmación.

**Step 5: Ejecutar verificación completa**

Run: `bun run verify:supervisor`

Expected: lint sin errores, typecheck correcto, suite Supervisor completa, build exitoso y evidencia visual guardada.

## Criterios de aceptación

- La recepción habitual de varios productos se prepara en una sola pantalla.
- El primer producto se puede agregar sin abrir un modal profundo desde la fila.
- Ingreso y egreso se distinguen visualmente por color, texto y dirección.
- No se puede confirmar un egreso sin motivo ni con stock insuficiente.
- Cada movimiento conserva auditoría y llega mediante el comando Supervisor existente.
- Un error de una línea no se presenta como éxito total.
- El flujo funciona con búsqueda manual aunque el lector de cámara falle.
- La experiencia es usable con una mano en móvil.
- Las acciones destructivas no compiten con las acciones de inventario.

## Verificación y despliegue

1. Ejecutar las pruebas unitarias por tarea.
2. Ejecutar `bun run verify:supervisor`.
3. Ejecutar E2E con una caja de prueba vinculada, nunca sobre inventario real sin respaldo.
4. Revisar que la migración productiva de comandos del Supervisor esté aplicada antes de probar ingreso/egreso reales.
5. Publicar frontend solo después de confirmar ACK, auditoría, conflicto de stock y reintento.
