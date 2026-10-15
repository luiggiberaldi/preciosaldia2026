# Backup Automático Supabase Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Crear un respaldo automático remoto, comprimido y restaurable, disponible únicamente para cuentas con licencia permanente activa.

**Architecture:** El POS construye un respaldo completo en formato JSON v2.0, lo comprime como `gzip` binario y calcula su SHA-256. Estación Maestra valida la licencia permanente, asigna el dispositivo a un negocio, guarda el archivo en un bucket privado de Supabase Storage, verifica que el archivo guardado sea idéntico y conserva las tres versiones más recientes. `cloud_backups` y `sync_documents` seguirán sirviendo para sincronización operativa del supervisor, no como depósito principal del archivo de respaldo.

**Tech Stack:** React/Vite, Supabase Postgres/RLS, Supabase Storage privado, Next.js API routes en Estación Maestra, `CompressionStream`/gzip, SHA-256, Vitest.

**Implementación inmediata:** mientras el Storage privado dedicado termina su
configuración, la primera entrega operativa guarda el payload gzip+base64
completo en `cloud_backups`. Esto permite probar y restaurar ahora sin perder
la arquitectura futura de Storage.

---

## Decisiones del producto

1. **Licencia permanente activa:** puede generar respaldos automáticos remotos.
2. **Cualquier otra cuenta:** conserva respaldo local automático, pero no hace llamadas de backup remoto.
3. **El backup local no se elimina:** sirve como red de emergencia sin internet.
4. **El archivo remoto será binario `.json.gz`:** evita el sobrecosto de guardar Base64 dentro de JSON.
5. **Se conservan tres versiones remotas:** la última, la anterior y una tercera de recuperación.
6. **Nunca se informa “backup exitoso” antes de verificar el archivo almacenado.**
7. **Restaurar no debe restaurar sesiones, PIN, credenciales ni tokens de licencia.**

## Fuera de alcance de esta primera entrega

- No se mezclará el backup con Google Script.
- No se borrará `cloud_backups` ni `sync_documents`.
- No se respaldarán imágenes binarias de productos en esta primera versión; se conservarán sus URLs o referencias actuales.
- No se activará el cliente remoto hasta que el servidor y la base dedicada pasen las pruebas.

### Task 1: Definir una única fuente de verdad para la licencia

**Files:**
- Modify: `src/hooks/useAutoBackup.js`
- Modify: `src/config/supervisorPolicy.js` o el servicio actual que expone el estado de licencia
- Create or modify: `src/services/backupEntitlement.js`
- Test: `tests/backupEntitlement.test.js`

**Step 1: Write the failing tests**

Cubrir estos casos:

- licencia `permanent` + `is_active=true` → backup remoto permitido;
- licencia mensual, demo, vencida o inexistente → backup remoto bloqueado;
- una respuesta incompleta de licencia → bloqueada por defecto;
- el backup local continúa permitido en todos los casos.

**Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/backupEntitlement.test.js --maxWorkers=1`

Expected: FAIL porque el evaluador central todavía no existe.

**Step 3: Implement the minimal entitlement helper**

Crear una función pura con resultado explícito:

```js
{ allowed: true, reason: 'permanent_active' }
{ allowed: false, reason: 'license_not_permanent' }
```

El hook debe recibir un booleano ya validado o consultar el estado existente; no debe inventar una licencia usando solo `isPremium`.

**Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/backupEntitlement.test.js --maxWorkers=1`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/services/backupEntitlement.js src/hooks/useAutoBackup.js src/config/supervisorPolicy.js tests/backupEntitlement.test.js
git commit -m "feat: restrict remote backups to active permanent licenses"
```

### Task 2: Congelar el contenido del backup y excluir datos que no deben restaurarse

**Files:**
- Modify: `src/config/backupKeys.js`
- Modify: `src/utils/backupRestoreService.js`
- Test: `tests/backupRestore.test.js`
- Test: `tests/backupKeys.test.js`

**Step 1: Write the failing tests**

Verificar que el backup contiene productos, ventas, clientes, cuentas, proveedores, facturas, categorías, configuración de tasas e inventario.

Verificar que no contiene:

- sesión `sb-*`;
- PIN o `abasto-auth-storage`;
- credencial del dispositivo;
- token de licencia `premium_token`;
- flags temporales de sincronización.

**Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/backupRestore.test.js tests/backupKeys.test.js --maxWorkers=1`

Expected: el test detectará cualquier clave sensible o faltante.

**Step 3: Implement the canonical allowlist**

Mantener una sola lista para crear y restaurar el backup. No duplicar listas en `useAutoBackup`, `useCloudBackup` y otros hooks.

**Step 4: Add round-trip coverage**

Probar: datos originales → backup → compresión → descompresión → validación → restauración. Comparar los datos restaurados con los originales, incluyendo decimales y listas vacías.

**Step 5: Run tests to verify they pass**

Run: `bunx vitest run tests/backupRestore.test.js tests/backupKeys.test.js --maxWorkers=1`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/config/backupKeys.js src/utils/backupRestoreService.js tests/backupRestore.test.js tests/backupKeys.test.js
git commit -m "fix: make backup payload complete and restorable"
```

### Task 3: Generar un archivo ultra comprimido y verificable

**Files:**
- Modify: `src/utils/compression.js`
- Create or modify: `src/utils/backupArchive.js`
- Modify: `src/hooks/useAutoBackup.js`
- Test: `tests/backupArchive.test.js`
- Test: `tests/backupStorageUpload.test.js`

**Step 1: Write the failing tests**

Cubrir:

- el JSON se genera sin espacios innecesarios;
- se comprime a bytes gzip;
- se puede descomprimir y recuperar exactamente el JSON original;
- el SHA-256 cambia si cambia un solo byte;
- un archivo dañado se rechaza antes de restaurar;
- un navegador sin `CompressionStream` no declara éxito remoto.

**Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/backupArchive.test.js --maxWorkers=1`

Expected: FAIL para las funciones nuevas.

**Step 3: Implement the archive contract**

Usar este contrato mínimo:

```js
{
  schemaVersion: 2,
  format: 'tasasaldia-backup',
  compression: 'gzip',
  timestamp: 'ISO-8601',
  sha256: '64 hex characters',
  bytes: Uint8Array
}
```

El SHA-256 debe calcularse sobre los bytes gzip, no sobre el JSON original.

**Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/backupArchive.test.js tests/backupStorageUpload.test.js --maxWorkers=1`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/utils/compression.js src/utils/backupArchive.js src/hooks/useAutoBackup.js tests/backupArchive.test.js tests/backupStorageUpload.test.js
git commit -m "feat: create verified gzip backup archives"
```

### Task 4: Terminar la base dedicada de respaldos

**Files:**
- Modify after approval: `estacion-maestra/docs/migrations/backup-project/001-business-backup-manifest.sql`
- Modify after approval: `estacion-maestra/docs/migrations/backup-project/README.md`
- Create: migration for the private Storage bucket and its configuration
- Test: `estacion-maestra/tests/backupAssignment.test.ts`
- Test: `estacion-maestra/tests/backupUpload.test.ts`

**Step 1: Review the migration without applying it**

Confirmar el proyecto Supabase de backups, el bucket privado y el nombre definitivo de las variables de servidor.

La migración actual está marcada como **borrador local, no aplicada**. No debe ejecutarse contra el proyecto del POS.

**Step 2: Add database tests**

Probar:

- un dispositivo solo puede tener una asignación activa;
- repetir el mismo registro devuelve la asignación existente;
- un dispositivo no puede quedar asignado a dos negocios;
- un negocio archivado no acepta backups;
- las operaciones repetidas con el mismo `operationId` son idempotentes.

**Step 3: Apply the migration in the dedicated backup project**

Ejecutar únicamente después de revisar el proyecto destino, las políticas del bucket y un backup previo de la base. Nunca aplicarla al proyecto `sodgzkablshladvbtnes`.

**Step 4: Verify the database objects**

Confirmar la existencia de `backup_businesses`, `backup_device_assignments`, `backup_manifests` y las RPC de inicio/finalización.

**Step 5: Commit**

```bash
git add estacion-maestra/docs/migrations/backup-project
git commit -m "feat: prepare dedicated backup storage schema"
```

### Task 5: Habilitar la subida verificada en Estación Maestra

**Files:**
- Modify: `estacion-maestra/src/app/api/backup/storage/upload/route.ts`
- Modify: `estacion-maestra/src/lib/backup-assignment.ts`
- Modify: `estacion-maestra/src/lib/backup-upload.ts`
- Modify: `estacion-maestra/src/lib/backup-storage-deps.ts`
- Test: `estacion-maestra/tests/backup-storage-route.test.ts`

**Step 1: Write the failing route tests**

Verificar que:

- sin credencial → `401`;
- licencia no permanente o vencida → `403`;
- asignación inexistente → error controlado, sin escribir;
- archivo mayor al límite → `413`;
- SHA incorrecto → `400`;
- subida válida → solo responde éxito después de verificar el objeto;
- reintento con el mismo `operationId` y mismos datos → mismo resultado;
- mismo `operationId` con datos distintos → `409`.

**Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/backup-storage-route.test.ts tests/backupUpload.test.ts --maxWorkers=1`

Expected: el endpoint actual falla porque está configurado como fail-closed y la asignación aún no está activa.

**Step 3: Connect the configured assignment resolver**

Configurar exclusivamente en servidor:

- URL del proyecto dedicado;
- service role key;
- bucket privado;
- límite máximo de tamaño;
- retención de tres archivos.

Nunca enviar la service role al POS.

**Step 4: Deploy and probe without business data**

Probar primero con un dispositivo sintético y un archivo pequeño. Confirmar que la ruta real devuelve `400`, `401`, `403` o `503` según el caso, y no `404`.

**Step 5: Run tests to verify they pass**

Run: `bunx vitest run tests/backup-storage-route.test.ts tests/backupUpload.test.ts --maxWorkers=1`

Expected: PASS.

**Step 6: Commit**

```bash
git add estacion-maestra/src/app/api/backup/storage/upload/route.ts estacion-maestra/src/lib/backup-assignment.ts estacion-maestra/src/lib/backup-upload.ts estacion-maestra/src/lib/backup-storage-deps.ts estacion-maestra/tests
git commit -m "feat: enable verified backup uploads"
```

### Task 6: Crear listado, descarga y restauración remota

**Files:**
- Modify: `estacion-maestra/src/app/api/backup/storage/versions/route.ts`
- Create: `estacion-maestra/src/app/api/backup/storage/download/route.ts`
- Create or modify: `src/services/remoteBackupService.js`
- Modify: `src/utils/backupRestoreService.js`
- Modify: `src/components/Settings/SettingsTabSistema.jsx`
- Test: `tests/remoteBackupRestore.test.js`
- Test: `estacion-maestra/tests/backup-download-route.test.ts`

**Step 1: Write the failing restore tests**

Cubrir:

- listar las tres versiones disponibles;
- descargar solo una versión autorizada del propio dispositivo;
- verificar tamaño y SHA antes de descomprimir;
- rechazar archivo alterado, incompleto o de versión desconocida;
- validar todo antes de borrar datos locales;
- conservar la sesión y las claves protegidas;
- restaurar productos, clientes, ventas, inventario y configuración;
- activar la sincronización posterior sin crear un ciclo infinito.

**Step 2: Implement the download contract**

El servidor debe devolver el archivo privado solo después de comprobar la asignación. El cliente no debe conocer rutas internas del bucket.

**Step 3: Implement safe restore**

Orden obligatorio:

1. Descargar.
2. Verificar SHA y tamaño.
3. Descomprimir.
4. Validar versión y contenido.
5. Mostrar resumen y pedir confirmación.
6. Limpiar únicamente claves de la aplicación.
7. Escribir datos.
8. Marcar restauración completada.
9. Recargar la aplicación.

**Step 4: Run tests to verify they pass**

Run: `bunx vitest run tests/remoteBackupRestore.test.js estacion-maestra/tests/backup-download-route.test.ts --maxWorkers=1`

Expected: PASS.

**Step 5: Commit**

```bash
git add src/services/remoteBackupService.js src/utils/backupRestoreService.js src/components/Settings/SettingsTabSistema.jsx estacion-maestra/src/app/api/backup/storage/versions estacion-maestra/src/app/api/backup/storage/download estacion-maestra/tests tests/remoteBackupRestore.test.js
git commit -m "feat: restore verified remote backups safely"
```

### Task 7: Activar el backup automático solo para licencia permanente

**Files:**
- Modify: `src/hooks/useAutoBackup.js`
- Modify: `src/utils/backupStorageUpload.js`
- Modify: `src/components/Settings/SettingsTabSistema.jsx`
- Test: `tests/useAutoBackupEntitlement.test.jsx`
- Test: `tests/useAutoBackupRequests.test.jsx`

**Step 1: Write the failing behavior tests**

Verificar:

- permanente activa → backup local + remoto cada 30 minutos;
- mensual/demo/vencida → backup local solamente;
- permanente sin internet → backup local y estado “pendiente”, sin marcar éxito remoto;
- retorno de internet → reintento automático;
- error del servidor → no perder el backup local;
- una solicitud remota solo se marca `completed` después del `ok:true` verificado;
- no se realizan llamadas remotas de Storage para cuentas no elegibles.

**Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/useAutoBackupEntitlement.test.jsx tests/useAutoBackupRequests.test.jsx --maxWorkers=1`

Expected: FAIL en los casos donde el hook actual usa `isPremium` o intenta Storage sin una asignación activa.

**Step 3: Implement the gate**

El hook debe ejecutar siempre la copia local. Solo si `backupEntitlement.allowed === true` podrá continuar hacia Estación Maestra.

El servidor debe repetir la validación; el cliente nunca es la autoridad final de la licencia.

**Step 4: Add clear UI states**

Mostrar únicamente mensajes simples:

- “Backup local activo”.
- “Backup remoto activo: licencia permanente”.
- “Backup remoto no disponible para este tipo de cuenta”.
- “Último backup remoto confirmado: fecha y hora”.
- “Backup pendiente por falta de internet”.

**Step 5: Run tests to verify they pass**

Run: `bunx vitest run tests/useAutoBackupEntitlement.test.jsx tests/useAutoBackupRequests.test.jsx --maxWorkers=1`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/hooks/useAutoBackup.js src/utils/backupStorageUpload.js src/components/Settings/SettingsTabSistema.jsx tests
git commit -m "feat: enable automatic remote backups for permanent licenses"
```

### Task 8: Corregir el proyecto POS y la sincronización de identidad

**Files:**
- Apply after approval: `supabase/migrations/20261015_supervisor_device_session_registration.sql`
- Review: `supabase/migrations/001_device_own_row_rls.sql`
- Modify: `src/config/supabaseCloud.js`
- Modify: `src/utils/deviceIdentity.js`
- Modify: `src/utils/backupRelay.js`
- Test: `tests/deviceIdentity.test.js`
- Test: `tests/backupRelay.test.js`

**Step 1: Verify production objects before SQL**

Confirmar en el proyecto POS que ya existen las políticas propias de `cloud_backups` y `sync_documents`. No aplicar migraciones a ciegas.

**Step 2: Add the device identity header**

Configurar el cliente para enviar el `device_id` de la instalación en las peticiones que necesiten resolver la identidad remota. El valor debe salir del almacenamiento local existente, nunca de un campo libre del usuario.

**Step 3: Apply the registration RPC**

Aplicar `20261015_supervisor_device_session_registration.sql` únicamente en el proyecto POS productivo, después de revisar que no cambie pairing ni comandos del supervisor.

**Step 4: Restrict backup request policies**

Eliminar las políticas anónimas amplias de `backup_requests`. El dispositivo solo debe leer y actualizar sus propias solicitudes; Estación Maestra debe conservar el acceso administrativo.

**Step 5: Run tests**

Run: `bunx vitest run tests/deviceIdentity.test.js tests/backupRelay.test.js --maxWorkers=1`

Expected: PASS.

**Step 6: Commit**

```bash
git add src/config/supabaseCloud.js src/utils/deviceIdentity.js src/utils/backupRelay.js tests/deviceIdentity.test.js tests/backupRelay.test.js supabase/migrations/20261015_supervisor_device_session_registration.sql
git commit -m "fix: stabilize backup device identity and request isolation"
```

### Task 9: Ejecutar la prueba E2E con un dispositivo sintético

**Files:**
- Create: `tests/e2e/backup-permanent-license.e2e.spec.js`
- Modify: `tests/e2e/fixtures/*` only if required
- Update: `docs/BACKUP-RESTORE.md`

**Step 1: Prepare isolated test data**

Usar un device ID sintético, una cuenta permanente de prueba y datos ficticios. No usar ventas reales ni credenciales del propietario.

**Step 2: Test the complete cycle**

1. Crear productos, clientes, ventas y configuración.
2. Esperar o solicitar backup remoto.
3. Confirmar respuesta `ok:true` y hash.
4. Consultar la lista de versiones.
5. Alterar o limpiar los datos locales de prueba.
6. Descargar la versión remota.
7. Restaurar.
8. Confirmar que los datos vuelven completos.
9. Repetir con una cuenta no permanente y confirmar que no se crea archivo remoto.

**Step 3: Test failures**

Simular internet desconectado, hash incorrecto, licencia vencida, archivo dañado y dos dispositivos con el mismo ID.

**Step 4: Run the full validation**

Run:

```bash
bun run typecheck
bun run lint
bunx vitest run tests/backupRestore.test.js tests/backupArchive.test.js tests/useAutoBackupEntitlement.test.jsx tests/remoteBackupRestore.test.js --maxWorkers=1
bun run build
```

Expected: all commands pass and el build no genera errores de backup.

**Step 5: Commit**

```bash
git add tests/e2e/backup-permanent-license.e2e.spec.js docs/BACKUP-RESTORE.md
git commit -m "test: verify permanent-license backup end to end"
```

## Orden de despliegue

1. Preparar y revisar la base dedicada de backups.
2. Desplegar Estación Maestra con las rutas de upload, listado y descarga.
3. Probar con dispositivo sintético.
4. Aplicar únicamente las migraciones aprobadas en el proyecto correcto.
5. Desplegar el POS con la función remota desactivada inicialmente.
6. Activar la función solo después de confirmar una subida y restauración exitosas.
7. Vigilar durante 24 horas: último backup confirmado, fallos, pendientes y espacio del bucket.

## Criterios de aceptación

- Una cuenta permanente activa crea backups remotos automáticamente.
- Una cuenta no permanente nunca sube un backup remoto.
- El backup local continúa funcionando para todos.
- El archivo remoto es gzip válido y tiene SHA-256 verificable.
- La restauración recupera productos, inventario, ventas, clientes y configuración.
- Un archivo alterado o incompleto nunca se aplica.
- Un fallo de internet no borra datos ni se presenta como éxito.
- Se conservan tres versiones remotas.
- El mismo `operationId` no duplica archivos.
- No se restauran sesiones, PIN, credenciales ni tokens de licencia.
- La ruta de producción responde con un estado controlado y nunca queda en `404`.

