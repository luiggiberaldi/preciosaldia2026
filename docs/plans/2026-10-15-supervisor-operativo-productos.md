# Modo Supervisor Operativo: productos y acciones remotas

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convertir el modo Supervisor en una herramienta operativa, empezando por crear y editar productos desde el celular y confirmando que los cambios lleguen correctamente a la caja.

**Architecture:** Se reutilizará el mecanismo que ya existe: el Supervisor envía una orden, la caja la recibe, modifica su catálogo local, sincroniza el resultado y devuelve una confirmación. Se habilitarán únicamente las acciones de productos en esta primera fase; no se activarán todas las mutaciones remotas de una vez ni se crearán sistemas paralelos.

**Tech Stack:** React 19, Vite, Supabase RPC/Realtime, almacenamiento local de la caja, Vitest, Playwright y Bun.

---

## Decisión de alcance

La primera entrega debe ser sencilla y útil:

### Incluido en esta fase

- Crear producto.
- Editar producto.
- Cambiar nombre, código de barras, categoría, precio, costo, existencia y alerta de bajo stock.
- Mantener los campos de productos a granel que ya usa la caja.
- Confirmar claramente si la caja guardó o rechazó el cambio.
- Actualizar la lista del Supervisor después de guardar.
- Mostrar que la acción no está disponible si la caja está desconectada.

### Fuera de esta fase

- Administración de usuarios y PINs.
- Cierre o reapertura de turnos.
- Egresos de inventario.
- Cambios complejos de tasas.
- Seguridad avanzada adicional.
- Reparar todo el entorno de staging antes de comenzar.

Eliminación de productos y ajustes de inventario pueden venir después de comprobar que crear y editar funcionan bien.

## Diagnóstico actual en lenguaje simple

La aplicación ya tiene:

- El formulario de producto del Supervisor.
- El botón Nuevo Producto.
- El botón Editar.
- La orden que viaja hacia la caja.
- El código de la caja que sabe crear y actualizar productos.
- El sistema de confirmación de la caja.

Actualmente no funciona de punta a punta porque existe un interruptor general que mantiene apagadas las acciones remotas. El primer arreglo consiste en encender solo las acciones de productos y comprobar el recorrido completo.

---

## Criterios de aceptación

La fase termina cuando una persona puede:

1. Abrir el inventario desde el Supervisor.
2. Pulsar Nuevo Producto.
3. Completar los datos y guardar.
4. Ver un mensaje de confirmación.
5. Ver el producto en la caja.
6. Editar ese mismo producto desde el Supervisor.
7. Ver los cambios en la caja y en el Supervisor.
8. Recibir un mensaje claro si la caja está desconectada.
9. Recibir un mensaje claro si la caja rechaza el cambio.
10. No crear productos duplicados por doble clic o reintento de la misma orden.

---

### Task 1: Confirmar el punto de partida

**Files:**
- Inspect: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/config/supervisorPolicy.js
- Inspect: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/services/supervisorCommandService.js
- Inspect: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/components/Monitor/RemoteProductFormModal.jsx
- Inspect: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/hooks/useRemoteCommands.js
- Inspect: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/views/OwnerMonitorView.jsx
- Inspect: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/supabase_supervisor_commands.sql

**Step 1: Ejecutar las pruebas actuales**

Run:
bun run test:supervisor -- --maxWorkers=1

Expected: la suite actual pasa y queda registrado el baseline antes del cambio.

**Step 2: Verificar el bloqueo actual**

Revisar que src/config/supervisorPolicy.js mantiene SUPERVISOR_REMOTE_MUTATIONS_ENABLED en false y que supervisorCommandService.js rechaza la orden de producto antes de enviarla.

Expected: se confirma que el bloqueo está en la política del frontend, no en que falte el formulario.

**Step 3: Confirmar el soporte existente del servidor**

Revisar supabase_supervisor_commands.sql.

Expected: las órdenes supervisor.product.create y supervisor.product.update ya están permitidas y validadas. Si el proyecto remoto no tiene esa versión aplicada, se documenta como tarea de despliegue y no se inventa una segunda RPC.

---

### Task 2: Encender solo crear y editar productos

**Files:**
- Modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/config/supervisorPolicy.js
- Modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/services/supervisorCommandService.js
- Modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/components/Monitor/RemoteProductFormModal.jsx
- Modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/views/OwnerMonitorView.jsx
- Test: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/supervisorPolicy.test.js
- Test: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/supervisorCommands.test.js

**Step 1: Escribir las pruebas de la nueva política**

Agregar pruebas que expresen:

- Crear producto está habilitado.
- Editar producto está habilitado.
- El resto de acciones generales todavía no se habilita automáticamente.
- Usuarios, PINs y acciones de turno siguen fuera del alcance.

Expected: las pruebas fallan porque hoy todas las mutaciones generales están bloqueadas.

**Step 2: Crear una bandera exclusiva para productos**

En supervisorPolicy.js crear SUPERVISOR_REMOTE_PRODUCTS_ENABLED para controlar únicamente crear y editar productos.

La política debe ser explícita: activar productos no debe activar usuarios, cierres, egresos ni otras acciones.

Expected: el código puede distinguir entre una orden de producto y una orden de otro tipo.

**Step 3: Permitir las dos órdenes de producto**

En supervisorCommandService.js permitir supervisor.product.create y supervisor.product.update cuando la bandera de productos esté activa.

Conservar:

- Validación de caja vinculada.
- Confirmación de recepción.
- Tiempo límite de la orden.
- Rechazo si no existe una caja objetivo.
- Rechazo si la caja está desconectada.

Expected: crear y editar avanzan hacia la caja; las demás acciones continúan bloqueadas.

**Step 4: Actualizar el formulario**

En RemoteProductFormModal.jsx reemplazar el bloqueo general por el bloqueo específico de productos.

Expected: el formulario deja de mostrar “mutaciones remotas deshabilitadas” al crear o editar un producto.

**Step 5: Actualizar la pantalla**

En OwnerMonitorView.jsx:

- Permitir Nuevo Producto cuando la caja está conectada.
- Permitir Editar cuando la caja está conectada.
- Deshabilitar o explicar el botón cuando la caja no está conectada.
- No mostrar todavía eliminación como parte de esta primera entrega.

Expected: el usuario entiende qué puede hacer y por qué una acción no está disponible.

**Step 6: Ejecutar las pruebas**

Run:
bunx vitest run tests/supervisorPolicy.test.js tests/supervisorCommands.test.js --maxWorkers=1

Expected: PASS.

---

### Task 3: Validar el contenido del producto antes de enviarlo

**Files:**
- Inspect/modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/components/Monitor/RemoteProductFormModal.jsx
- Inspect/modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/utils/productProcessor.js
- Inspect: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/components/Products/ProductFormQuick.jsx
- Create/modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/supervisorProductForm.test.js
- Reference: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/granelUnits.test.js

**Step 1: Escribir pruebas de campos obligatorios**

Cubrir:

- Nombre vacío.
- Precio inválido.
- Producto nuevo con ID.
- Edición que conserva el ID original.
- Código de barras opcional.
- Categoría opcional.
- Stock cero válido.
- Producto a granel con unidades correctas.

Expected: la pantalla no envía una orden incompleta.

**Step 2: Escribir prueba del formato de la orden**

La orden de creación debe contener:

- product.id
- product.name
- product.priceUsd
- product.category
- product.stock
- campos de unidad y presentación cuando correspondan

La orden de edición debe contener:

- productId
- patch con los valores modificados
- el mismo ID del producto original

Expected: la caja puede identificar exactamente qué producto crear o editar.

**Step 3: Ejecutar para confirmar el fallo actual**

Run:
bunx vitest run tests/supervisorProductForm.test.js --maxWorkers=1

Expected: las pruebas nuevas fallan si algún campo puede salir con formato incorrecto.

**Step 4: Ajustar la preparación del formulario**

Usar las funciones existentes de productProcessor.js y useProductForm.js. No duplicar conversiones de gramos, kilos, litros, paquetes o monedas.

Expected: el Supervisor y la caja interpretan el stock y precios de la misma manera.

**Step 5: Ejecutar la suite de productos**

Run:
bunx vitest run tests/supervisorProductForm.test.js tests/granelUnits.test.js --maxWorkers=1

Expected: PASS sin romper productos a granel ni productos existentes.

---

### Task 4: Hacer confiable la aplicación del cambio en la caja

**Files:**
- Create: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/services/supervisorProductCommand.js
- Modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/hooks/useRemoteCommands.js
- Create: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/supervisorProductCommand.test.js

**Step 1: Extraer la operación a una función comprobable**

Crear una función para aplicar una orden de producto al catálogo local de la caja.

Debe aceptar:

- create con un producto completo.
- update con productId y patch.
- estado actual de productos.
- una función para guardar y sincronizar.

Expected: la lógica de productos puede probarse sin levantar toda la pantalla.

**Step 2: Escribir la prueba de creación**

Con una lista inicial, aplicar un producto nuevo.

Expected:

- la lista termina con el producto nuevo.
- el ID se conserva.
- no se modifican los productos existentes.
- se solicita sincronización.

**Step 3: Escribir la prueba de edición**

Editar nombre, precio, categoría y stock de un producto existente.

Expected:

- solo cambia el producto solicitado.
- conserva campos que no estaban en el patch.
- mantiene el mismo ID.

**Step 4: Escribir la prueba de error**

Intentar editar un producto que no existe.

Expected: la caja rechaza la orden y no confirma una operación falsa.

**Step 5: Escribir la prueba de doble entrega**

Aplicar dos veces la misma orden con el mismo command_id.

Expected: el producto no aparece duplicado y el resultado final es el mismo.

**Step 6: Escribir la prueba de fallo de sincronización**

Guardar localmente y forzar un fallo al subir el cambio.

Expected: la operación se marca como fallida y la caja no envía una confirmación de éxito falsa.

**Step 7: Conectar la función al receptor**

En useRemoteCommands.js reemplazar la lógica duplicada por la función nueva y conservar:

- bloqueo de escritura.
- guardia de órdenes repetidas.
- mensaje visible en la caja.
- ACK aplicado o fallido.
- actualización del catálogo local.

**Step 8: Ejecutar las pruebas**

Run:
bunx vitest run tests/supervisorProductCommand.test.js tests/supervisorCommands.test.js --maxWorkers=1

Expected: PASS.

---

### Task 5: Confirmar el resultado en el Supervisor

**Files:**
- Modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/components/Monitor/RemoteProductFormModal.jsx
- Modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/views/OwnerMonitorView.jsx
- Inspect/modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/hooks/useMonitorSync.js
- Test: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/supervisorLifecycle.test.js
- Test: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/supervisorSync.test.js

**Step 1: Escribir la prueba de confirmación positiva**

Simular una respuesta aplicada de la caja.

Expected:

- el formulario muestra “Producto guardado en caja”.
- se cierra solo después del ACK correcto.
- la lista se actualiza cuando llega el catálogo nuevo.

**Step 2: Escribir la prueba de rechazo**

Simular una respuesta fallida.

Expected:

- el formulario permanece abierto.
- el usuario ve el motivo del rechazo.
- los datos escritos no se pierden.
- no aparece un mensaje de éxito.

**Step 3: Evitar doble envío**

Mientras la caja procesa la orden, deshabilitar Guardar en Caja.

Expected: un doble clic no crea dos productos.

**Step 4: Actualizar datos después del ACK**

Usar la sincronización existente para que bodega_products_v1 vuelva al Supervisor. Si la actualización no llega, mostrar un botón o mensaje de Actualizar datos.

Expected: el usuario puede comprobar el cambio sin recargar manualmente toda la aplicación.

**Step 5: Ejecutar las pruebas**

Run:
bunx vitest run tests/supervisorLifecycle.test.js tests/supervisorSync.test.js --maxWorkers=1

Expected: PASS.

---

### Task 6: Probar la función de forma sencilla con una caja y un celular

**Files:**
- Create/modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/e2e/supervisor-product-actions.e2e.spec.js
- Reference: tests/e2e/supervisor-readonly.e2e.spec.js
- Reference: tests/e2e/supervisor.e2e.spec.js
- Evidence: docs/reports/2026-10-15-supervisor-operativo-productos.md

**Step 1: Preparar una caja de prueba**

Usar una caja que no contenga ventas reales o un catálogo de prueba. Vincular el celular del Supervisor como ya se hace actualmente.

Expected: el test no toca el catálogo real de clientes.

**Step 2: Probar crear un producto**

Crear “Producto E2E Supervisor” con precio y stock conocidos.

Expected:

- aparece confirmación en el celular.
- aparece en la caja.
- aparece después en la lista del Supervisor.

**Step 3: Probar editar el producto**

Cambiar nombre, precio y stock.

Expected: los tres valores cambian en la caja y en el Supervisor.

**Step 4: Probar desconexión**

Desconectar la caja o cerrar su conexión antes de guardar.

Expected: el Supervisor informa que la caja no está disponible y no afirma que guardó el producto.

**Step 5: Probar recuperación**

Volver a conectar la caja y repetir la operación.

Expected: la orden se procesa una sola vez y el producto queda actualizado.

**Step 6: Guardar evidencia**

Registrar captura del producto antes, después y del mensaje de confirmación. No guardar contraseñas, tokens ni datos reales.

Expected: queda una evidencia comprensible para una persona no técnica.

---

### Task 7: Dejar inventario y otras funciones como segunda etapa

**Files:**
- Reference: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/components/Monitor/SupervisorInventoryBatchModal.jsx
- Reference: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/services/supervisorInventoryCommand.js
- Reference: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/components/Monitor/SupervisorRateModal.jsx
- Reference: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/views/OwnerMonitorView.jsx

**Step 1: No mezclar funciones**

No activar inventario, eliminación, tasas ni turnos dentro del mismo cambio de crear/editar productos.

Expected: si algo falla, será fácil saber si el problema está en productos.

**Step 2: Definir el siguiente orden de trabajo**

Después de productos:

1. Entrada de mercancía.
2. Ajuste manual de stock.
3. Eliminación o desactivación de productos.
4. Cambios de tasa.
5. Otras operaciones de caja.

Expected: cada capacidad se prueba y activa por separado.

---

### Task 8: Verificación final y documentación

**Files:**
- Modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/docs/reports/2026-10-14-auditoria-e2e-modo-supervisor.md
- Create: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/docs/reports/2026-10-15-supervisor-operativo-productos.md

**Step 1: Ejecutar verificación local**

Run:
bun run lint:supervisor
bun run typecheck
bun run test:supervisor -- --maxWorkers=1
bun run build

Expected: cero errores.

**Step 2: Ejecutar la prueba funcional de producto**

Run:
bunx vitest run tests/supervisorPolicy.test.js tests/supervisorCommands.test.js tests/supervisorProductForm.test.js tests/supervisorProductCommand.test.js --maxWorkers=1

Expected: todas las pruebas de producto pasan.

**Step 3: Ejecutar la prueba con caja y celular**

Run the controlled E2E:
bunx playwright test tests/e2e/supervisor-product-actions.e2e.spec.js

Expected: crear y editar terminan con confirmación y datos actualizados.

**Step 4: Revisar la pantalla como usuario**

Comprobar manualmente:

- El botón Nuevo Producto es fácil de encontrar.
- Editar abre los datos correctos.
- Guardar indica que está trabajando.
- Éxito y error se distinguen.
- Una caja desconectada se entiende sin leer mensajes técnicos.

**Step 5: Documentar el resultado**

El reporte final debe indicar:

- Qué funciones se habilitaron.
- Qué pruebas pasaron.
- Qué quedó para la siguiente fase.
- Si se utilizó staging o una caja controlada.
- Qué commit contiene el cambio.

## Definición de terminado

El primer fixeo queda terminado cuando el Supervisor puede crear y editar productos de principio a fin, la caja confirma cada operación, los datos se actualizan en ambas pantallas y las pruebas locales pasan.

El staging no bloquea el inicio de este trabajo. Se usará después como una comprobación adicional antes de publicar cambios que puedan afectar datos reales.

@writing-plans

