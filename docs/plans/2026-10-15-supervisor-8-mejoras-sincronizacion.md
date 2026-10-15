# Modo Supervisor: 8 mejoras de sincronización y operación

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Hacer que el modo Supervisor sea funcional y recuperable de principio a fin, tomando las mejores ideas de Donde Juancho sin copiar su complejidad innecesaria.

**Architecture:** Mantener una sola relación caja-supervisor y el mecanismo actual de órdenes. La caja enviará primero una fotografía inicial de sus datos; el Supervisor usará Realtime como vía rápida y una recuperación periódica como respaldo. Las acciones remotas usarán identificadores únicos, confirmación explícita y protección contra datos atrasados.

**Tech Stack:** React 19, Vite, Supabase RPC/Realtime, localStorage/localforage, Vitest, Playwright y Bun.

---

## Alcance

Las ocho mejoras son:

1. Subir los datos antes de mostrar el QR.
2. Descargar una copia inicial y tener recuperación automática cada 30 segundos.
3. Evitar que datos viejos sobrescriban datos nuevos.
4. Leer únicamente la caja vinculada mediante un acceso controlado.
5. No repetir órdenes cuando hay reintentos o cortes de Internet.
6. Resolver correctamente ediciones consecutivas y conflictos de productos.
7. Mantener la presencia y recuperación aunque el dispositivo no emita eventos de conexión.
8. Probar y documentar los casos reales antes de producción.

No se incluye en esta fase: múltiples supervisores, sistema de dueño/reclamo, administración remota de usuarios, cierres remotos ni rediseño completo de permisos.

## Criterios de terminado

La fase queda terminada cuando:

- El QR solo aparece después de preparar la sincronización inicial.
- Un Supervisor nuevo recibe productos, ventas y configuración sin quedar vacío.
- Una caída de Realtime se recupera automáticamente sin recargar la aplicación.
- Una actualización vieja no reemplaza una actualización nueva.
- Crear o editar un producto produce un solo cambio aunque se reintente.
- El mismo Supervisor puede hacer varias ediciones consecutivas.
- Un conflicto real se informa claramente y no destruye el dato más reciente.
- La caja y el Supervisor muestran cuándo están conectados, atrasados o pendientes.
- Las pruebas de regresión pasan antes de aplicar SQL o publicar frontend.

## Optimización del uso de agentes y recursos

- Ejecutar las tareas en orden: cada etapa deja una base estable para la siguiente.
- Usar un solo agente para modificar cada grupo de archivos compartidos; no editar `useMonitorSync.js`, `useRemoteCommands.js` o las migraciones en paralelo.
- Hacer primero inspección y pruebas; solo crear SQL si la prueba demuestra que falta una función en Supabase.
- Mantener un solo mecanismo de sincronización y reutilizar `supervisorSyncService.js`, `supervisorCommandService.js` y `supervisorContracts.js`.
- No agregar polling agresivo: el respaldo será cada 30 segundos, no cada 10 segundos.
- Después de cada tarea, ejecutar solo la prueba relacionada; ejecutar la verificación completa en los puntos de control.
- Hacer commits pequeños por etapa, para poder revertir una mejora sin deshacer las demás.

---

### Tarea 1: Preparar la sincronización antes del QR

**Files:**
- Modify: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/components/Settings/PairingManager.jsx`
- Inspect/modify: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/hooks/useCloudSync.js`
- Inspect: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/components/PairingScanScreen.jsx`
- Test: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/supervisorPairing.test.js`

**Step 1: Escribir la prueba de orden correcto**

Verificar que generar el vínculo llama primero a la subida de datos esenciales y después a `generate_pairing_token`.

Expected: la prueba falla si el QR se genera antes de terminar la subida.

**Step 2: Reutilizar la subida existente**

Usar la función de sincronización existente. No crear una segunda rutina de subida ni duplicar la lista de documentos.

Expected: el flujo usa el mismo formato que la caja ya entiende.

**Step 3: Mostrar estado entendible**

Mostrar “Preparando datos”, “Generando código” y “Código listo”. Si la subida falla, no mostrar un QR que parezca válido.

**Step 4: Ejecutar la prueba**

Run: `bunx vitest run tests/supervisorPairing.test.js --maxWorkers=1`

Expected: PASS.

**Step 5: Commit**

Run: `git add src/components/Settings/PairingManager.jsx src/hooks/useCloudSync.js tests/supervisorPairing.test.js && git commit -m "fix: preparar datos antes de vincular supervisor"`

---

### Tarea 2: Crear descarga inicial y recuperación cada 30 segundos

**Files:**
- Modify: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/hooks/useMonitorSync.js`
- Modify: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/services/supervisorSyncService.js`
- Test: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/supervisorSync.test.js`
- Test: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/supervisorLifecycle.test.js`

**Step 1: Escribir las pruebas de recuperación**

Cubrir tres casos:

- La descarga inicial trae todos los documentos permitidos.
- Realtime está conectado pero no entrega cambios.
- Realtime se cae y la siguiente recuperación vuelve a descargar los datos.

Expected: las pruebas nuevas fallan si solo existe la suscripción Realtime.

**Step 2: Mantener la descarga inicial completa**

Al abrir el Supervisor, hacer una descarga completa antes de depender de eventos nuevos. El cursor guardado se usará para optimizar recuperaciones posteriores, no para omitir la primera carga.

**Step 3: Agregar el respaldo de 30 segundos**

Crear un temporizador único por sesión. Si no hay cambios nuevos, debe terminar sin alterar datos. Si hay cambios, debe aplicar solo los documentos nuevos.

**Step 4: Reutilizar la función de actualización**

La descarga manual, la recuperación automática y Realtime deben pasar por la misma función de aplicación. No mantener tres caminos con reglas diferentes.

**Step 5: Limpiar el temporizador**

Al salir del Supervisor, cambiar de caja o desvincular, cancelar el temporizador y evitar que una respuesta tardía escriba datos.

**Step 6: Ejecutar pruebas**

Run: `bunx vitest run tests/supervisorSync.test.js tests/supervisorLifecycle.test.js --maxWorkers=1`

Expected: PASS.

**Step 7: Commit**

Run: `git add src/hooks/useMonitorSync.js src/services/supervisorSyncService.js tests/supervisorSync.test.js tests/supervisorLifecycle.test.js && git commit -m "fix: recuperar sincronizacion del supervisor cada 30 segundos"`

---

### Tarea 3: Proteger contra datos viejos

**Files:**
- Inspect/modify: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/services/supervisorSyncService.js`
- Modify: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/hooks/useMonitorSync.js`
- Test: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/supervisorSync.test.js`

**Step 1: Escribir pruebas de versiones**

Cubrir:

- Un documento nuevo seguido de uno antiguo conserva el nuevo.
- Una descarga vieja que termina tarde no pisa un cambio de Realtime.
- Un fallo al guardar localmente no avanza la versión guardada.
- Al cambiar de vínculo, una respuesta del vínculo anterior se descarta.

**Step 2: Guardar cursor por documento**

Usar `getSyncMetadataKey` y `isNewerSyncDocument` existentes. Si falta una regla, completarla en `supervisorSyncService.js`, sin crear otro formato paralelo.

**Step 3: Serializar escrituras por documento**

Agregar una cola pequeña por `doc_id` para que dos actualizaciones del mismo documento se apliquen en orden. Las ventas y el inventario no deben bloquearse entre sí.

**Step 4: Ejecutar pruebas**

Run: `bunx vitest run tests/supervisorSync.test.js --maxWorkers=1`

Expected: PASS y ninguna regresión de `supervisorLifecycle.test.js`.

**Step 5: Commit**

Run: `git add src/services/supervisorSyncService.js src/hooks/useMonitorSync.js tests/supervisorSync.test.js && git commit -m "fix: impedir que sincronizacion antigua sobrescriba datos nuevos"`

---

### Tarea 4: Limitar la lectura a la caja realmente vinculada

**Files:**
- Inspect: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/hooks/useMonitorSync.js`
- Inspect: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/services/supervisorAuth.js`
- Inspect/modify: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/supabase_supervisor_preflight.sql`
- Inspect/modify: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/supabase_pairing_setup.sql`
- Test: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/supervisorSqlGuardrails.test.js`

**Step 1: Verificar el alcance actual**

Confirmar que toda lectura usa el `pairedDeviceId` exacto y que no existe una consulta que elija “la caja más activa” o cualquier emparejamiento disponible.

Expected: queda identificado si hace falta una función SQL o si la protección actual es suficiente.

**Step 2: Escribir pruebas de aislamiento**

Probar que:

- La caja A no puede leer documentos de la caja B.
- Un Supervisor sin vínculo no puede descargar documentos.
- Un vínculo reemplazado deja de servir para la sesión anterior.

**Step 3: Crear RPC solo si es necesario**

Si las pruebas muestran que el `SELECT` directo no está suficientemente limitado, crear una función de lectura con parámetros explícitos: caja principal, monitor y lista blanca de documentos. No cambiar permisos generales ni copiar todo el SQL de Donde Juancho.

**Step 4: Ejecutar guardrails**

Run: `bunx vitest run tests/supervisorSqlGuardrails.test.js tests/supervisorPairing.test.js --maxWorkers=1`

Expected: PASS. Si se creó SQL, dejarlo en una migración fechada dentro de `supabase/migrations/` y documentar que todavía requiere ejecución en Supabase.

**Step 5: Commit**

Run: `git add src/hooks/useMonitorSync.js src/services/supervisorAuth.js supabase_pairing_setup.sql supabase_supervisor_preflight.sql supabase/migrations tests/supervisorSqlGuardrails.test.js tests/supervisorPairing.test.js && git commit -m "fix: limitar lectura del supervisor a su caja vinculada"`

---

### Tarea 5: Hacer idempotentes las órdenes y sus reintentos

**Files:**
- Modify: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/services/supervisorCommandService.js`
- Modify: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/hooks/useRemoteCommands.js`
- Inspect/modify: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/supabase_supervisor_commands.sql`
- Test: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/supervisorCommands.test.js`

**Step 1: Escribir pruebas de orden repetida**

Cubrir:

- El mismo `command_id` recibido dos veces aplica la acción una sola vez.
- Un reintento de confirmación no vuelve a ejecutar la acción.
- Una orden vencida se rechaza sin tocar productos.
- Un doble clic del usuario no crea dos órdenes distintas para la misma acción pendiente.

**Step 2: Confirmar el identificador único**

Conservar `buildSupervisorCommand` y `command_id`. Si se necesita persistir una orden pendiente, usar la misma clave y no introducir una segunda tabla local.

**Step 3: Separar aplicación y confirmación**

La caja debe aplicar primero y registrar el resultado localmente. Los reintentos posteriores solo deben repetir el ACK o consultar el estado existente.

**Step 4: Limitar reintentos**

Aplicar retrasos breves y finitos para errores temporales. No repetir una operación de producto, stock o venta automáticamente.

**Step 5: Ejecutar pruebas**

Run: `bunx vitest run tests/supervisorCommands.test.js tests/supervisorProductCommand.test.js --maxWorkers=1`

Expected: PASS.

**Step 6: Commit**

Run: `git add src/services/supervisorCommandService.js src/hooks/useRemoteCommands.js supabase_supervisor_commands.sql tests/supervisorCommands.test.js tests/supervisorProductCommand.test.js && git commit -m "fix: evitar repetir ordenes del supervisor"`

---

### Tarea 6: Resolver ediciones consecutivas y conflictos de productos

**Files:**
- Modify: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/services/supervisorProductCommand.js`
- Modify: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/components/Monitor/RemoteProductFormModal.jsx`
- Modify: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/views/OwnerMonitorView.jsx`
- Test: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/supervisorProductCommand.test.js`
- Test: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/supervisorLifecycle.test.js`

**Step 1: Escribir prueba de ediciones consecutivas**

El mismo Supervisor debe poder cambiar nombre, precio y stock en dos órdenes consecutivas sin que la segunda sea rechazada por una fecha base antigua.

**Step 2: Escribir prueba de conflicto real**

Una edición de otro Supervisor con una versión base vieja debe ser rechazada de manera controlada, sin perder el valor más nuevo.

**Step 3: Aplicar cambios parciales**

La edición debe modificar solo los campos enviados y conservar los demás. El ID del producto nunca debe cambiar.

**Step 4: Mostrar resultado claro**

Usar mensajes sencillos:

- “Producto guardado en la caja”.
- “La caja está desconectada”.
- “El producto cambió mientras lo editabas; vuelve a cargarlo”.

No mostrar errores técnicos de Supabase al usuario.

**Step 5: Ejecutar pruebas**

Run: `bunx vitest run tests/supervisorProductCommand.test.js tests/supervisorLifecycle.test.js --maxWorkers=1`

Expected: PASS.

**Step 6: Commit**

Run: `git add src/services/supervisorProductCommand.js src/components/Monitor/RemoteProductFormModal.jsx src/views/OwnerMonitorView.jsx tests/supervisorProductCommand.test.js tests/supervisorLifecycle.test.js && git commit -m "fix: resolver ediciones consecutivas del supervisor"`

---

### Tarea 7: Mantener presencia y recuperación sin depender del evento online

**Files:**
- Modify: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/hooks/useMonitorSync.js`
- Modify: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/views/OwnerMonitorView.jsx`
- Inspect/modify: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/services/supervisorSyncService.js`
- Test: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/supervisorLifecycle.test.js`

**Step 1: Escribir prueba de recuperación silenciosa**

Simular un navegador que nunca dispara `online`. La sincronización debe volver a intentar por su temporizador de respaldo.

**Step 2: Separar estados de conexión**

Distinguir entre:

- Conectado.
- Sin cambios recientes.
- Recuperando.
- Sin conexión.
- Vínculo revocado.

No mostrar “desconectado” cuando simplemente falló una consulta puntual.

**Step 3: Evitar múltiples temporizadores**

Garantizar que cada Supervisor tenga un único heartbeat y un único canal Realtime.

**Step 4: Añadir acción manual segura**

El botón “Actualizar ahora” debe reutilizar la misma recuperación, cancelar duplicados y no perder una actualización en curso.

**Step 5: Ejecutar pruebas**

Run: `bunx vitest run tests/supervisorLifecycle.test.js tests/supervisorSync.test.js --maxWorkers=1`

Expected: PASS.

**Step 6: Commit**

Run: `git add src/hooks/useMonitorSync.js src/views/OwnerMonitorView.jsx src/services/supervisorSyncService.js tests/supervisorLifecycle.test.js tests/supervisorSync.test.js && git commit -m "fix: mantener recuperacion del supervisor sin evento online"`

---

### Tarea 8: Verificación E2E, documentación y salida a producción

**Files:**
- Modify: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/e2e/supervisor.e2e.spec.js`
- Create/modify: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/e2e/supervisor-product-actions.e2e.spec.js`
- Create: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/docs/reports/2026-10-15-supervisor-8-mejoras-verificacion.md`
- Reference: `C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/docs/reports/2026-10-15-supervisor-operativo-productos.md`

**Step 1: Crear prueba E2E de producto**

Con una caja controlada:

- Vincular el Supervisor.
- Crear un producto.
- Confirmar que aparece en la caja.
- Editar el producto.
- Confirmar que nombre, precio y stock cambian.

**Step 2: Probar fallos**

Cubrir caja desconectada, doble clic, respuesta lenta, reintento y llegada de datos viejos.

Expected: ninguna prueba afirma éxito si la caja no confirmó la operación.

**Step 3: Ejecutar validación local**

Run:

```powershell
bun run lint:supervisor
bun run typecheck
bun run test:supervisor -- --maxWorkers=1
bun run build
```

Expected: todo termina sin errores.

**Step 4: Ejecutar E2E controlado**

Run: `bunx playwright test tests/e2e/supervisor-product-actions.e2e.spec.js`

Expected: crear, editar, recuperar y mostrar errores terminan correctamente.

**Step 5: Verificar SQL antes de tocar Supabase**

Solo si una tarea creó una migración:

- Revisar que sea idempotente.
- Confirmar que no elimine datos.
- Ejecutar primero en una base de prueba.
- Registrar el nombre exacto de la migración aplicada.

No aplicar SQL remoto automáticamente desde este plan.

**Step 6: Documentar resultado**

El reporte debe incluir:

- Las ocho mejoras realizadas.
- Archivos modificados.
- Pruebas ejecutadas y resultado.
- Qué SQL, si alguno, quedó pendiente.
- Qué comportamiento se verificó con caja y celular.
- Commit final de producción.

**Step 7: Commit final**

Run: `git add tests/e2e/supervisor.e2e.spec.js tests/e2e/supervisor-product-actions.e2e.spec.js docs/reports/2026-10-15-supervisor-8-mejoras-verificacion.md && git commit -m "test: verificar modo supervisor de extremo a extremo"`

## Orden recomendado de ejecución

1. Preparar datos antes del QR.
2. Recuperación cada 30 segundos.
3. Protección contra datos viejos.
4. Alcance exacto de la caja vinculada.
5. Órdenes idempotentes.
6. Conflictos de productos.
7. Presencia y recuperación silenciosa.
8. Pruebas E2E y documentación.

Las tareas 1 a 3 corrigen la base de sincronización. Las tareas 5 y 6 habilitan una operación segura de productos. Las tareas 4 y 7 se validan después de que el flujo funcional esté estable. La tarea 8 es la puerta obligatoria antes de producción.

## Plan de reversión

- Cada tarea tiene un commit independiente.
- Si una etapa falla, se revierte únicamente su commit y se conservan las anteriores.
- No ejecutar `git reset --hard` ni borrar migraciones aplicadas.
- Si una migración ya llegó a Supabase, preparar una migración correctiva; no editar la historia remota.

@writing-plans
