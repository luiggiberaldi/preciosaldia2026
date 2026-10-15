# Optimización de Egress de Supabase Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Reducir de forma medible el egress de Supabase, especialmente las lecturas repetidas de `sync_documents` y `cloud_backups`, sin perder sincronización en vivo ni capacidad de recuperación ante desconexiones.

**Architecture:** Realtime será el camino principal para cambios en el monitor. El polling quedará como fallback con backoff y solo descargará documentos cuyo `updated_at` haya cambiado. Las listas de backups devolverán metadatos; el `backup_data` completo se solicitará únicamente durante una restauración explícita. Las consultas de pairing y comandos conservarán columnas limitadas y se validarán con métricas de Postgres, sin enviar telemetría adicional a Supabase.

**Tech Stack:** React, Supabase JS/PostgREST, Supabase Realtime, PostgreSQL, Vitest, TypeScript, Vite.

## Estado de esta implementación

- **Implementado:** Realtime queda como vía primaria; el fallback del monitor y la comprobación de pairing pasan a 5 minutos.
- **Implementado:** la recuperación del monitor consulta primero `doc_id, updated_at` y descarga `data` únicamente para documentos modificados.
- **Implementado:** el arranque normal de la caja usa reconciliación protegida por hash y deja el envío incondicional solo para importaciones/restauraciones explícitas.
- **Verificado:** suites de sincronización/lifecycle (20 pruebas), pairing/control/backup/schema (43 pruebas), typecheck y build.
- **Pendiente de producción:** ejecutar el SQL correctivo indicado al final de la entrega y medir una ventana comparable de 24 horas.
- **No aplicado sin evidencia:** cambios a listados de `cloud_backups`; la auditoría del código actual no encontró un listado activo que descargue `backup_data` innecesariamente.

---

## Evidencia y objetivos

- El panel de Supabase muestra aproximadamente **113.98 MB de PostgREST**, **12.17 MB de Realtime**, **29.8 KB de Storage** y **155 KB de Auth**.
- El JSON exportado contiene 287 eventos internos de PostgREST; 210 son `Thread killed by timeout manager`. No incluye rutas ni tamaños por endpoint, por lo que no se debe usar como atribución exacta de bytes.
- `pg_stat_statements` muestra aproximadamente **269.083 upserts** a `sync_documents` acumulados desde junio y lecturas repetidas que devuelven el campo pesado `data`.
- `useMonitorSync` hace un pull de todos los documentos cada 30 segundos durante recuperación, aun cuando Realtime está conectado.
- Las consultas administrativas de `cloud_backups` usan `select *` en algunos caminos y pueden devolver `backup_data` completo.

Objetivos de aceptación:

1. Cuando Realtime está conectado, no realizar pulls periódicos de `sync_documents`.
2. Cuando Realtime está degradado, descargar solo metadatos primero y datos modificados después.
3. Reducir al menos 80% las lecturas completas de `sync_documents` durante una ventana comparable.
4. No descargar `cloud_backups.backup_data` en listados o dashboards.
5. Mantener pairing, desvinculación, sincronización inicial, restauración y aplicación de comandos funcionando.
6. Verificar la tendencia de egress durante 24 horas antes de ampliar el rollout.

### Task 1: Capturar baseline de egress sin generar tráfico adicional

**Files:**
- Create: `docs/reports/2026-10-15-egress-baseline.md`
- Reference: `src/hooks/useMonitorSync.js`
- Reference: `src/hooks/useCloudSync.js`
- Reference: `src/hooks/useCloudBackup.js`

**Step 1: Ejecutar consultas de solo lectura en producción**

Registrar el período de `pg_stat_statements`, llamadas y tamaños de `sync_documents`, `cloud_backups`, `device_pairings` y `supervisor_commands`. No ejecutar `ALTER`, `DROP`, `CREATE` ni resets de estadísticas.

**Step 2: Documentar las consultas candidatas**

Separar lecturas de `data`, lecturas de `backup_data`, polling de pairing, consultas de comandos y upserts. Aclarar que `pg_stat_statements` es acumulado desde `2026-06-24`, no equivalente automáticamente al día mostrado por el dashboard.

**Step 3: Guardar el reporte**

Documentar fecha, rango, consultas, tamaño actual y limitaciones. El reporte no debe incluir tokens, JWT, URLs con credenciales ni datos de clientes.

**Step 4: Verificar**

Confirmar que el reporte se puede reproducir con SQL de solo lectura y que no agrega llamadas a Supabase desde la aplicación.

### Task 2: Escribir pruebas para decidir cuándo ejecutar recuperación

**Files:**
- Modify: `src/services/supervisorSyncService.js`
- Modify: `tests/supervisorSync.test.js`

**Step 1: Escribir pruebas fallidas**

Cubrir una función pura que devuelva `false` cuando Realtime está conectado, cuando el intervalo de fallback aún no vence o cuando ya existe un pull en curso. Cubrir `true` cuando Realtime está desconectado y venció el intervalo.

**Step 2: Ejecutar las pruebas**

Run: `npx vitest run tests/supervisorSync.test.js --pool=forks --maxWorkers=1`

Expected: FAIL porque la función de decisión todavía no existe o conserva el comportamiento de pull periódico.

**Step 3: Implementar la decisión mínima**

Agregar una función pura y constantes explícitas para intervalo normal, backoff y máximo de espera. No leer ni escribir Supabase desde esta función.

**Step 4: Ejecutar las pruebas**

Run: `npx vitest run tests/supervisorSync.test.js --pool=forks --maxWorkers=1`

Expected: PASS.

### Task 3: Desactivar el pull completo cuando Realtime está saludable

**Files:**
- Modify: `src/hooks/useMonitorSync.js`
- Modify: `src/services/supervisorSyncService.js`
- Test: `tests/supervisorLifecycle.test.js`

**Step 1: Escribir la prueba de regresión**

Verificar que el timer de recuperación no llame `pullDocuments` mientras `subscriptionRef.current` esté conectado y que haga un pull inmediato solo al iniciar o reconectar.

**Step 2: Ejecutar la prueba**

Run: `npx vitest run tests/supervisorLifecycle.test.js --pool=forks --maxWorkers=1`

Expected: FAIL con el comportamiento actual de pull cada 30 segundos.

**Step 3: Cambiar el timer**

Mantener Realtime como fuente primaria. El timer debe:

- comprobar pairing solo como fallback;
- saltar `pullDocuments` si el canal está conectado;
- ejecutar recuperación únicamente en estado `DEGRADED`, `DISCONNECTED` o tras un timeout de suscripción;
- evitar solapamientos con `recoveryPullInFlightRef`;
- usar backoff, iniciando en 60 segundos y llegando como máximo a 5 minutos.

**Step 4: Ejecutar pruebas y typecheck**

Run: `npx vitest run tests/supervisorSync.test.js tests/supervisorLifecycle.test.js --pool=forks --maxWorkers=1`

Run: `npm run typecheck`

Expected: PASS.

### Task 4: Convertir la recuperación en sincronización incremental

**Files:**
- Modify: `src/hooks/useMonitorSync.js`
- Modify: `src/services/supervisorSyncService.js`
- Modify: `tests/supervisorSync.test.js`

**Step 1: Escribir pruebas fallidas**

Cubrir estos casos:

- metadatos iguales: no se solicita ningún `data`;
- un documento nuevo: se descarga solo ese documento;
- varios documentos cambiados: se agrupan en una sola consulta limitada;
- documento remoto más antiguo: no pisa la copia local más reciente;
- primer pull: se permite snapshot completo una sola vez.

**Step 2: Ejecutar las pruebas**

Run: `npx vitest run tests/supervisorSync.test.js --pool=forks --maxWorkers=1`

Expected: FAIL hasta que exista el selector incremental.

**Step 3: Implementar dos fases**

Primero consultar únicamente `doc_id, updated_at` para el dispositivo. Comparar con metadatos locales. Solo si hay cambios, consultar `collection, doc_id, data, updated_at` con `in('doc_id', changedIds)`. Persistir el último `updated_at` localmente y conservar la validación de envelopes.

**Step 4: Proteger el tamaño de la consulta**

Limitar la cantidad de documentos por lote y procesar lotes secuenciales. No usar `select('*')`. Si el lote excede el umbral previsto, registrar estado degradado y reintentar con backoff.

**Step 5: Ejecutar pruebas**

Run: `npx vitest run tests/supervisorSync.test.js tests/supervisorLifecycle.test.js --pool=forks --maxWorkers=1`

Expected: PASS.

### Task 5: Eliminar upserts forzados y duplicados del POS

**Files:**
- Modify: `src/hooks/useCloudSync.js`
- Modify: `src/services/supervisorPairingService.js`
- Modify: `tests/hooks.test.js`
- Modify: `tests/supervisorPairing.test.js`

**Step 1: Escribir pruebas fallidas**

Verificar que el arranque normal no llame `forceSyncAllPOSData` con `forceUnconditional=true`, que el hash evite un upsert sin cambios y que el pairing inicial solo fuerce el envío cuando realmente hay datos nuevos o una importación explícita.

**Step 2: Ejecutar las pruebas**

Run: `npx vitest run tests/hooks.test.js tests/supervisorPairing.test.js --pool=forks --maxWorkers=1`

Expected: FAIL para el arranque que fuerza las cinco claves críticas.

**Step 3: Implementar deduplicación**

Usar el hash por clave ya existente como condición normal. Reservar `forceUnconditional` para restauración/importación manual y pairing recién autorizado. Mantener el debounce de claves pesadas y no reintroducir listeners globales de `localStorage`.

**Step 4: Validar que el monitor no escribe**

Mantener la regla de que el modo supervisor no publica snapshots del POS. Verificar que un cambio recibido por Realtime no produzca un eco de vuelta a `sync_documents`.

**Step 5: Ejecutar pruebas**

Run: `npx vitest run tests/hooks.test.js tests/supervisorPairing.test.js --pool=forks --maxWorkers=1`

Expected: PASS.

### Task 6: Reducir egress de backups en listados

**Files:**
- Modify: `src/hooks/useCloudBackup.js`
- Modify: `src/components/Settings/PairingManager.jsx`
- Modify: `tests/backupRestore.test.js`
- Modify: `tests/cloudSchemaContract.test.js`

**Step 1: Escribir pruebas fallidas**

Verificar que el listado solicite solo `id, device_id, updated_at, email` o metadatos equivalentes, y que la restauración solicite `backup_data` únicamente para el backup seleccionado.

**Step 2: Ejecutar las pruebas**

Run: `npx vitest run tests/backupRestore.test.js tests/cloudSchemaContract.test.js --pool=forks --maxWorkers=1`

Expected: FAIL si algún listado devuelve `backup_data`.

**Step 3: Separar listado y restauración**

Crear una consulta de metadatos para dashboards y una consulta explícita por `id/device_id` para restaurar. No cambiar el esquema de `cloud_backups` ni duplicar el payload comprimido.

**Step 4: Ejecutar pruebas**

Run: `npx vitest run tests/backupRestore.test.js tests/cloudSchemaContract.test.js --pool=forks --maxWorkers=1`

Expected: PASS.

### Task 7: Mantener pairing y comandos con lecturas pequeñas

**Files:**
- Modify: `src/hooks/useCloudSync.js`
- Modify: `src/hooks/useMonitorSync.js`
- Modify: `src/services/supervisorCommandService.js`
- Modify: `src/services/supervisorControlService.js`
- Test: `tests/supervisorControl.test.js`
- Test: `tests/supervisorSync.test.js`

**Step 1: Auditar selectores**

Confirmar que pairing use solo columnas de estado, que comandos pendientes tengan límite 25 y que el panel de control use el RPC de contadores en lugar de descargar payloads históricos.

**Step 2: Escribir pruebas de contrato**

Rechazar `select('*')` en estos servicios y comprobar límites explícitos para listas de comandos y snapshots.

**Step 3: Implementar fallback económico**

Mantener polling de token de 3 segundos únicamente mientras el modal de pairing esté abierto. Fuera de ese flujo, depender de Realtime y del fallback de backoff definido en Task 3.

**Step 4: Ejecutar pruebas**

Run: `npx vitest run tests/supervisorControl.test.js tests/supervisorSync.test.js --pool=forks --maxWorkers=1`

Expected: PASS.

### Task 8: Evaluar índices SQL solo después de confirmar el plan de consulta

**Files:**
- Create if justified: `supabase/migrations/20261015_egress_sync_indexes.sql`
- Test: `tests/supervisorSqlGuardrails.test.js`

**Step 1: Ejecutar `EXPLAIN` de solo lectura**

Medir los selectores de `sync_documents` por `device_id`, `collection`, `doc_id` y `updated_at`. No crear índices por intuición.

**Step 2: Crear solo índices necesarios**

Si el plan demuestra un scan costoso, agregar como máximo el índice que ayude al patrón real, por ejemplo `(device_id, updated_at DESC)`. Mantener el índice único existente para upsert por `(device_id, collection, doc_id)`.

**Step 3: Validar costo**

Comparar tiempo, buffers y tamaño de índice. Rechazar el cambio si solo aumenta escritura/Storage sin reducir el tiempo de la consulta.

### Task 9: Reparar únicamente el SQL de producción que realmente falta

**Files:**
- Reference: `supabase/migrations/20261015_supervisor_pairing_revoke_pending.sql`
- Reference: `supabase/migrations/20261015_supervisor_control_audit.sql`
- Create if approved: `supabase/production-repair/20261015_supervisor_missing_objects.sql`

**Step 1: Ejecutar auditoría de solo lectura**

Confirmar antes del cambio que falta `revoke_pairing_token`, que faltan `applied_at`, `cancelled_at`, `cancelled_by`, `cancel_reason`, que el status check no incluye `cancelled` y que falta `idx_supervisor_commands_control_page`.

**Step 2: Preparar un parche idempotente**

No ejecutar a ciegas todo `20261015_supervisor_control_audit.sql`, porque la producción ya contiene funciones compatibles con dos supervisores. El parche debe agregar columnas, constraint e índice sin reemplazar esas funciones; debe incluir la función de `ack` solo si se conserva compatibilidad con `applied_with_warnings`.

**Step 3: Ejecutar en una ventana controlada**

Tomar respaldo, ejecutar en una transacción y verificar funciones, columnas, constraint, índice y permisos. Este SQL corrige consistencia y evita reintentos fallidos; no reemplaza las optimizaciones de egress del cliente.

### Task 10: Validación integral antes del despliegue

**Files:**
- Reference: `package.json`
- Reference: `docs/reports/2026-10-15-egress-baseline.md`

**Step 1: Ejecutar pruebas enfocadas**

Run: `npx vitest run tests/supervisorSync.test.js tests/supervisorLifecycle.test.js tests/supervisorPairing.test.js tests/supervisorControl.test.js tests/backupRestore.test.js tests/cloudSchemaContract.test.js --pool=forks --maxWorkers=1`

Expected: PASS.

**Step 2: Ejecutar typecheck y build**

Run: `npm run typecheck`

Run: `npm run build`

Expected: PASS; las advertencias de tamaño de chunk se registran aparte y no se confunden con errores de egress.

**Step 3: Probar escenarios manuales**

Validar: monitor conectado por Realtime, Realtime desconectado, reconexión, cambio de producto, ingreso/egreso por lote, pairing de segundo supervisor, desvinculación desde caja y supervisor, backup listado y restauración.

**Step 4: Medir después del despliegue**

Comparar una ventana de 24 horas con el baseline: PostgREST, Realtime, llamadas a `sync_documents`, lecturas de `cloud_backups` y eventos de timeout. Si los timeouts aumentan, pausar el rollout y volver a la última versión funcional.

### Task 11: Commits y rollout

Crear commits pequeños y reversibles:

```text
perf(sync): gate recovery pulls and add delta sync
perf(backup): avoid full backup payload reads
perf(sync): deduplicate initial POS uploads
chore(supabase): apply targeted production repair
```

No incluir capturas de `dogfood-output`, tokens, dumps de producción ni logs completos en Git. Aplicar SQL de producción por separado, registrar su resultado y desplegar el frontend solo después de validar el esquema.
