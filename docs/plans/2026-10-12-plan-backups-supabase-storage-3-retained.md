# Plan de fixeo — respaldos automáticos en Supabase Storage (3 por negocio)

**Fecha:** 12 de octubre de 2026  
**Estado:** propuesta de arquitectura; destino indicado por el usuario; no se han creado buckets ni se han escrito datos remotos.  
**Objetivo:** retirar la carga directa del navegador a Google Apps Script/Drive y almacenar los backups automáticos comprimidos en un bucket privado de Storage de un proyecto Supabase separado, dejando solo los tres backups más recientes de cada negocio licenciado y descargándolos únicamente cuando se solicita una restauración.

## 1. Decisión de arquitectura

- **Destino indicado:** proyecto Supabase `qlujyvauumzfpdefdkyl`, URL `https://qlujyvauumzfpdefdkyl.supabase.co` (confirmados por el usuario). El usuario indica que pertenece a la cuenta/correo `luiggiberladi94@gmail.com`; esta titularidad no fue verificada independientemente por las herramientas conectadas.
- **Estado de acceso:** las herramientas Supabase conectadas rechazaron `get_project` y `get_project_url` por falta de permiso. No se obtuvo confirmación remota del nombre, organización, región, estado ni cuotas efectivas. No se hicieron llamadas de escritura; el proyecto no fue modificado.
- **Bucket:** configuración local apunta al nombre `business-backups`; el recurso remoto aún no se ha inspeccionado ni creado. No crear ni cambiar configuración hasta tener permiso de acceso y aprobación explícita de la operación remota.
- **Producto:** Supabase Storage privado (objetos), no Postgres `cloud_backups` como depósito del binario. El proyecto actual de licencias/POS continúa siendo la fuente de identidad/licencia y puede conservar el sync operativo existente.
- **Unidad de retención:** un negocio licenciado, identificado en servidor. No usar `business_name`, `deviceId`, una ruta elegida por el navegador ni un header arbitrario como autorización de pertenencia.
- **Retención:** tres objetos exitosos más recientes por negocio. Orden estable por `created_at`/versión, con el timestamp del servidor y el ID de operación; un objeto nuevo debe subirse y verificarse antes de eliminar los anteriores.
- **Egress:** envío del backup desde el POS/backend a Storage es tráfico entrante; no es egress de descarga. No descargar backups en tareas periódicas. La restauración descarga solo el objeto solicitado y cuenta como egress.
- **Drive:** retirar el uso de `uploadToGoogleDrive` de las rutas de backup automático/manual de esta app. No retirar el backup local JSON de emergencia ni confundir Supabase Storage con Drive.
- **Credenciales:** service-role del proyecto de backups solo server-side en Estación Maestra/endpoint de confianza; jamás en variables `VITE_*`, browser, URLs, logs o fixtures. Mantener secretos existentes solo en despliegue seguro. No introducir los valores actuales de `.env` en el repo.

### Cuotas que condicionan la decisión

Según la documentación oficial consultada el 12 de octubre de 2026, Supabase Free anuncia 500 MB de base de datos por proyecto, 1 GB de Storage por organización, máximo 50 MB por archivo y 5 GB de egress no cacheado + 5 GB cacheado. Storage y egress se comparten entre proyectos de la misma organización: un segundo proyecto dentro de la misma organización **no duplica** esas cuotas. Free puede pausar proyectos tras una semana de inactividad y no incluye backup gestionado de Postgres.

La cuota de 1 GB exige dimensionar número de negocios × tres objetos × bytes comprimidos y mantener alarmas/telemetría. Si se supera, no degradar silenciosamente a pérdida de retención: fallar el nuevo backup, conservar los tres anteriores, avisar y documentar el límite/upgrade. Si el proyecto se crea en otra organización, las cuotas pueden separarse, pero no se debe asumir que la cuenta permite esa configuración o que no afecta el límite de proyectos Free.

Fuentes oficiales:
- [Precios Supabase](https://supabase.com/pricing)
- [Facturación y cuotas](https://supabase.com/docs/guides/platform/billing-on-supabase)
- [Cuota de egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress)
- [Medir cuota Storage](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size)
- [Control de acceso Storage](https://supabase.com/docs/guides/storage/security/access-control)
- [Eliminar objetos Storage](https://supabase.com/docs/guides/storage/management/delete-objects)
- [Pausa de proyectos Free](https://supabase.com/docs/guides/platform/free-project-pausing)

## 2. Auditoría de Estación Maestra (12-oct-2026)

### Estado del checkout y seguridad

- Rama observada: `main`. Hay 594 archivos con cambios/deletions/untracked no relacionados en `product-images/` y `scratch/`; ninguno fue revertido ni incluido en este trabajo. No se encontró diff previo en las superficies editadas de UI/catálogo de producto. Revisar estos cambios antes de cualquier commit.
- Stack: Next.js 16.3, TypeScript strict, Supabase JS ya instalado. No hay script de test configurado en el `package.json` de Estación; sí hay lint/build.
- `.env.local` tiene `SUPABASE_BACKUP_URL`, `SUPABASE_BACKUP_SERVICE_ROLE_KEY` y bucket `business-backups`, está ignorado por git y nunca debe inspeccionarse imprimiendo valores. El scaffold de upload valida existencia/forma de URL y bucket, pero no crea cliente Supabase ni usa el secreto para upload.
- `src/lib/supabase.ts` tiene el cliente público (`NEXT_PUBLIC_*`) y `getSupabaseAdmin()` con `SUPABASE_SERVICE_ROLE_KEY` del proyecto operativo. El nuevo Storage debe tener cliente server-only independiente, URL validada contra el project ref esperado, sesión persistente desactivada y timeout. El scaffold actual todavía no crea cliente Supabase ni sube payload.
- `/api/backup/complete` guarda metadata (`drive_url`, tamaños y conteos) en `cloud_backups` y marca solicitudes completadas; no confirma el archivo de Drive ni guarda el payload en Storage.
- `/api/backup/relay` hace upsert/lectura de `cloud_backups` por `device_id`; los dos endpoints legacy usan `BACKUP_SHARED_SECRET` + CORS allowlist, no sesión admin. El secreto compartido autentica cliente/origen, pero el `deviceId` del body/header no prueba por sí solo ownership o entitlement. La migración SQL local `002-aislamiento-respaldos-por-producto.sql` existe pero dice **PREPARADA, NO APLICAR**, y su backfill/restricción tampoco se han validado remotamente.
- Se añadió `/api/backup/storage/upload` como scaffold **fail-closed** que exige sesión admin, valida URL contra el host destino y el nombre del bucket, pero siempre devuelve 503 mientras falten ownership de negocio, límites/hash, manifiesto e idempotencia. No hace llamadas ni escrituras a Supabase.
- Rutas legacy permanecen activas para el flujo actual; no reemplazarlas hasta versionar y coordinar cliente POS, idempotencia y reconciliación. No declarar estos backups como Storage.
- Hallazgo crítico corregido en este checkout: `src/middleware.ts` ahora verifica la cookie HMAC para las páginas admin; solo `/api/track` y endpoints POS legacy con header shared-secret pasan sin cookie. `/api/backup/storage/upload` queda detrás de sesión admin y vuelve a validarla server-side. `src/lib/auth-context.tsx` ya carga/crea/cierra sesión mediante server actions; `/login` vuelve a mostrar el formulario PIN. Confirmar esta barrera con pruebas de interfaz/ruta antes de desplegar.
- La herramienta conectada `get_project` fue denegada (sin permiso); nombre/org/estado/cuotas/buckets/schema de `qlujyvauumzfpdefdkyl` siguen sin verificar. No se hicieron escrituras remotas.

### PRO temporalmente oculto, reversible

- El usuario pidió no usar PRO por ahora. El selector global ahora muestra solo Lite; `PRODUCT_PRO`, el discriminador y las vistas/capacidades existentes quedan preservadas para reactivación posterior.
- El formulario de generación de licencias y los badges de notificaciones filtran a productos disponibles. El barrido de notificaciones no crea nuevos avisos de demos PRO mientras PRO esté oculto. No se borran licencias, datos, rutas, tipos ni precios existentes.
- La selección global está bloqueada también en el contexto: una vista o llamada que intente seleccionar `pro` no puede cambiar el producto operativo de Lite.
- Limitación intencional: el ocultamiento es UI/operativo, no una desactivación server-side de endpoints/acciones ni de datos PRO. No registrar ni modificar operaciones PRO hasta que se reactive y se complete el aislamiento.

### Brechas críticas antes de activar backup Storage

0. **P0 — validar auth de extremo a extremo:** la reparación local está aplicada, pero requiere probar UI/redirect, PIN incorrecto/correcto, cookie expirada/falsificada, logout y APIs privadas/legacy antes del despliegue. El scaffold de upload exige cookie válida.
1. Falta identidad durable del negocio (el alias `cloud_licenses.business_name` y `device_id` no bastan como tenant ID); resolver licencias, pairing y multi-dispositivo en el backend antes de guardar/listar/borrar.
2. Falta contrato de cliente/servidor para upload gzip con límites, `operationId`, checksum, HTTP receipts y manejo de timeout/retry.
3. Falta manifiesto durable con estado `uploading/verified/cleanup_pending/failed` y restricción única por negocio + `operationId`; Storage y Postgres no comparten transacción.
4. Falta upload Storage + verificación objetiva de tamaño/hash antes de marcar completado; endpoint actual devuelve 2xx tras guardar solo metadata.
5. Falta endpoint autorizado de listado top-3, restore bajo demanda y limpieza que nunca borre versiones antiguas antes de verificar la nueva. Aplicar aislamiento A/B, tamaño, cuota, carreras y objetos huérfanos.
6. Falta creación/autorización del bucket privado, schema/migraciones, políticas/RLS (si procede) y cuota real confirmada del proyecto destino.
7. Falta coordinar POS: upload actual Google Drive/no-cors y relay `cloud_backups` todavía no implementan este contrato.
8. Falta prueba de integración real en staging aislado; mocks no prueban permisos, cuota ni comportamiento de Storage.

## 3. Estado actual y superficies a cambiar

### POS (`preciosaldia-bodega`)

- `src/utils/driveBackupUploader.js` manda `action: upload_backup` directamente al Google Script mediante `no-cors`, por lo que el cliente no puede verificar si se guardó el archivo; eliminar su uso de los flujos tras cambiar a endpoint server-side.
- `src/hooks/useAutoBackup.js` llama uploader Drive y `/api/backup/complete`; el segundo endpoint actualiza metadatos de `cloud_backups`, no el archivo Drive. Debe llamar al endpoint de Storage verificable y solo declarar `completed` después de éxito real.
- `src/hooks/useCloudBackup.js` mezcla el upload best-effort a Drive con el backup completo de Supabase Cloud. Definir si “Sincronizar con la Nube” continúa siendo copia de sync P2P o si es backup remoto archivado; mantener cada estado y mensaje inequívocos.
- `src/utils/backupRelay.js` hace fallback a una fila Postgres de `cloud_backups`; no es el bucket ni debe confundirse con Storage. El camino de backup automático nuevo debe tener rutas explícitas de subida/listado/descarga de objetos.
- Mantener `backupRestoreService.js`, `backupKeys.js`, compresión v2 y export/import JSON local compatibles.

### Estación Maestra (`../estacion-maestra`)

- Extender o crear endpoints server-side autenticados para aceptar carga, listar las últimas tres versiones y descargar/restaurar un objeto desde el proyecto/bucket dedicado; hallazgos detallados y superficies están en §2 (Auditoría).
- El backend ya tiene `BACKUP_SHARED_SECRET` y service-role del proyecto actual para endpoints `/api/backup/*`; **no reutilizar automáticamente esa service-role contra otro proyecto**. Añadir configuración específica server-only para el proyecto de backups y definir rotación/secret management.
- El endpoint actual `/api/backup/complete` guarda solo metadata (incluye `drive_url`) en la base operativa y marca solicitudes; no demuestra almacenamiento del contenido en Drive. Sustituir su semántica o añadir endpoint versionado; no seguir marcando complete desde un endpoint de metadata.
- Las rutas `/api/backup/relay` actual guardan/leen fila `cloud_backups`. No modificarla silenciosamente para que cambie de backend: migrar con contrato y versión explícitos para el cliente POS.
- Hacer que el server derive business/license/device ownership usando identidad/licencia existente y tablas autorizadas, no confiar en `deviceId` solo ni en el secreto compartido como permiso de negocio. Un secreto compartido de cliente no es una identidad de usuario/tenant adecuada para operaciones de Storage multi-cliente.

## 4. Decisiones pendientes y precondiciones

1. Project ref/URL ya indicados por el usuario: `qlujyvauumzfpdefdkyl` / `https://qlujyvauumzfpdefdkyl.supabase.co`; titularidad indicada: `luiggiberladi94@gmail.com`. Falta permiso de lectura para verificar proyecto y organización. No es necesario compartir una anon key por chat; para la implementación server-to-server basta configurar el URL y la service-role key únicamente en el gestor seguro de secretos del backend.
2. Habilitar acceso de solo lectura del conector Supabase a ese proyecto (o confirmar manualmente el nombre/organización/región/plan y cuota observada). El intento de consulta actual falló por permisos.
3. **Configuración local preparada:** `SUPABASE_BACKUP_URL`, `SUPABASE_BACKUP_SERVICE_ROLE_KEY` y `SUPABASE_BACKUP_BUCKET` están en `../estacion-maestra/.env.local`, que está ignorado por git; la clave se retiró del `.env` del POS para que no quede asociada al frontend Vite. No se muestra ni se valida el valor de la clave. Aún falta configurar los secretos en el host de despliegue, cuando se autorice una integración y staging.
4. Confirmar organización destino y sus cuotas efectivas; verificar que el bucket Storage Free de 1 GB es compartido organizacionalmente. No crear recursos ni cambiar organización automáticamente.
5. Confirmar mapeo `device_id → negocio licenciado/tenant`, considerando dispositivos emparejados; varios device IDs del mismo negocio cuentan para la misma política de tres copias si el modelo dice que comparten negocio. Si cada licencia equivale a un negocio, dejar esa regla escrita.
6. Definir comportamiento para clientes sin licencia, demo, licencia vencida/en gracia, dispositivo eliminado, reactivación, y cuota agotada. Por defecto: solo licencia elegible activa genera copia remota; mantener export local en todos los equipos.
7. Definir intervalo y triggering de backup periódico, solicitud remota/manual, tamaño máximo admitido y cifrado. Reducir egress es objetivo principal; storage no debe recibir un dump en cada cambio si la política de backup es diaria o por solicitud.
8. Confirmar si la base vieja `cloud_backups` se conserva para sync y panel histórico durante transición; no eliminar contenido, `drive_url` ni tablas sin inventario/plan de migración.

**Gate 0:** el usuario ya indicó el project ref y URL, pero la inspección de solo lectura fue rechazada por falta de permisos. No se hacen escrituras ni se provisiona el bucket hasta tener acceso y aprobación explícita; se puede adelantar desarrollo con adaptadores/mocks. La credencial service-role no debe compartirse en chat.

## 5. Contrato propuesto

### POST `/api/backup/storage/upload` (solo backend de confianza)

- Verificar autenticación del origen POS y entitlement de licencia; derivar device/business ID autorizado en servidor.
- Validar JSON v2, tamaño comprimido máximo, `operationId` y checksum; limitar Content-Length antes de parsear para evitar consumo de memoria.
- Comprimir en POS gzip+base64 si es compatible o enviar representación raw al backend; guardar bytes binarios `.json.gz` siempre que el contrato lo permita (no almacenar base64 si se puede enviar bytes, evita 33% de overhead).
- Path interno determinista pero no enumerable, por ejemplo `<business-uuid>/<yyyy>/<mm>/<server-time>-<operation-id>.json.gz`; UUIDs internos, nunca nombre ni teléfono del negocio.
- Bucket `business-backups` privado, sin policy pública/anon. La service-role solo corre en servidor.
- Usar metadata de Storage y/o tabla de manifiesto para guardar `business_id`, `device_id`, `operation_id`, `created_at`, `size_bytes`, `sha256`, `schema_version`, `storage_path`, estado. Si se crea tabla, definir RLS/GRANT y política; no guardar payload dentro del manifiesto Postgres.
- Subir con operación idempotente. Si se repite el mismo `operationId`, devolver la fila/object previamente verificado en vez de duplicar.

Respuesta exitosa solo después de upload confirmado + `head`/lectura metadata y validación de checksum/size:

```json
{
  "ok": true,
  "operationId": "uuid",
  "backupId": "uuid interno",
  "createdAt": "ISO-8601 server",
  "sizeBytes": 123,
  "sha256": "hex",
  "retained": 3
}
```

Un objeto subido sin manifiesto confirmado se trata como operación incierta y se reconcilia por `operationId`; no marca completed hasta comprobar object y manifest.

### POST/list GET `/api/backup/storage/versions`

- Autenticar y autorizar el dispositivo/admin actual; calcular `business_id` en servidor.
- Devolver máximo las 3 versiones más recientes de ese negocio, solo metadata (ID opaco, fecha, tamaño, checksum); no enviar el objeto ni una URL pública.
- Descarga por endpoint autorizado `GET /api/backup/storage/:backupId` con `Cache-Control: no-store`; usar descarga server-side/proxy si signed URL filtraría acceso. Si se usa signed URL, vigencia corta y vincularla a usuario/restore iniciado.
- Ningún endpoint permite enviar un `business_id` arbitrario o navegar a otro tenant.

### Retención

- Subir objeto nuevo con path único → validar checksum y metadata → confirmar manifiesto → listar por business UUID ordenado por `created_at DESC, backup_id DESC` → borrar objetos mayores al top 3 a través de `storage.from(bucket).remove(paths)` → registrar cleanup.
- Si falla el upload/validación: conservar los 3 anteriores, registrar solicitud `failed`, no borrar nada.
- Si falla la limpieza luego de éxito: la nueva copia queda válida; dejar alerta `retention_cleanup_pending` y reintentar limpieza server-side. No volver a fallar el backup confirmado.
- Si quota/storage límite alcanzado: no borrar antiguos para hacer sitio antes de subir; informar falta de espacio, conservar anteriores y requerir intervención. Definir operación de cleanup manual con preview antes de borrar.
- Prevenir carreras (dos backups simultáneos por negocio): lock/claim de manifiesto/DB transacción o RPC atómica. La selección/deleción no puede exceder política ni borrar el objeto de una operación reciente.
- Hacer lifecycle/reconciler para objetos huérfanos y manifiestos huérfanos. Borrar Storage mediante API, nunca borrar filas con SQL esperando que se borren objetos.

## 6. Fases de implementación

### Fase A — Contrato, identidad y cuota

1. Inspeccionar schema actual de licencias, pairing, `backup_requests`, `cloud_backups` y `business_id` disponible. Diseñar el vínculo del dispositivo con negocio licenciado; no inventar una equivalencia por `business_name`.
2. Una vez habilitado el acceso, verificar el proyecto/organización y cuotas efectivas sin revelar keys. Las URL/key de POS y server deben apuntar al mismo project ref ya indicado por el usuario.
3. Elegir función para generar bytes gzip, tamaño límite por archivo, cadencia del backup y política de licencias.
4. Calcular presupuesto con muestras sintéticas representativas: `max_businesses × 3 × p95_compressed_bytes`, dejando margen para staging/temp/orphan objects dentro del 1 GB.
5. Crear/configurar bucket privado y tabla de manifiesto/RLS solo tras contar con project ref y aprobación para cambios de schema/bucket; staging primero.

**Gate A:** mapa de tenants probado, proyecto destino confirmado, bucket/DB quota presupuestada y RLS/private verificado.

### Fase B — Endpoint de Estación Maestra

1. Añadir env vars server-only dedicadas al proyecto de backups: `SUPABASE_BACKUP_URL`, `SUPABASE_BACKUP_SERVICE_ROLE_KEY`, `SUPABASE_BACKUP_BUCKET` (nombres definitivos según convención). Validar al arrancar y fail-closed si faltan. La service-role del proyecto operativo no se reutiliza.
2. Añadir helper server-only para crear cliente Supabase backup con `persistSession:false`, validación de project URL y no permitir que el cliente elija endpoint/proyecto/bucket.
3. Implementar upload, list/read y restore proxy con autenticación/autorización ya establecida; unir solicitud con device autorizado y licencia del backend. Los errores devuelven código safe, no stack/secret.
4. Aplicar límite máximo de tamaño y content-type, validación de schema/compression/checksum, timeout/request body cap, rate limit y protección de replays; el shared secret existente no sustituye entitlement ni tenant isolation.
5. Asegurar lectura solo del mismo negocio y de usuario admin autorizado; no usar link público ni bucket público. No exponer service-role al POS ni a scripts ejecutados en browser.
6. Añadir manifest rows/operation idempotency, retención y worker/retry de cleanup. Manejar atomicidad parcial entre Storage y DB con estado `uploading/verified/cleanup_pending/failed` y reconciliación.
7. Mantener legacy `/api/backup/relay` para nube actual y `/api/backup/complete` solo mientras haya clientes antiguos. Versionar nueva API para evitar romper builds previos.

**Gate B:** pruebas de autenticación verifican requests anon a admin API → 401/redirect; business A no puede listar/descargar/restaurar objetos B; endpoint solo devuelve éxito tras `head`/checksum; cleanup conserva tres.

### Fase C — Cliente POS sin Drive ni descarga redundante

1. Crear `src/utils/supabaseBackupClient.js` o ampliar `backupRelay.js` con contrato HTTP hacia Estación Maestra; no instalar SDK de Supabase para browser para acceder al project backup ni exponer service-role.
2. Retirar `uploadToGoogleDrive` del flujo de `useAutoBackup` y `useCloudBackup`; mantener archivo local y path legacy si hay import histórico, sin enviar a Google Scripts.
3. El POS manda un backup completo v2 gzip+base64 actual. Considerar decodificarlo a bytes gzip en servidor antes de Storage para ahorrar espacio; documentar encoding y checksum end-to-end.
4. Para backup automático/manual, generar `operationId` idempotente, mostrar éxito solo después del acuse `verified`. En `useAutoBackup`, marcar `backup_requests.completed` solo tras confirmación del endpoint y conservar `failed`/backoff en cualquier error/timeout incierto.
5. Mantener periodicidad con hash, pero corregir hash actual si compara solo `idbData`: el backup contiene también localStorage; hash debe cubrir exactamente payload canónico/comprimido, no omitir cambios locales.
6. Separar explícitamente estado del backup Storage dedicado y de sync `cloud_backups/sync_documents`. El texto de UI debe decir “Backup remoto seguro” y aclarar última fecha; no presentar sincronización P2P como archivo durable.
7. Añadir listado de últimos tres backups y restauración elegida: descargar solo al actuar, verificar size+SHA-256+gzip+`validateBackupJson`, mostrar fecha/summary, pedir confirmación si hay datos y aplicar vía `applyBackupToStorage` anti-eco. Cancelar o invalidar restore no toca datos locales.
8. Definir interacción para conflicto, update success + cleanup pending, falta de cuota, fallo de red, licencia vencida y proyecto pausado. Export/import JSON local sigue disponible como contingencia.

**Gate C:** backup no usa script.google.com, no descarga durante upload/periodicidad y la UI separa datos sync de snapshots recuperables.

### Fase D — Tests locales, API y políticas

POS:
- `driveBackupUploader` queda sin referencias de runtime; prueba estática/import test previene uso accidental.
- Unit tests de cliente: env ausente, request shape, payload comprimido, HTTP 2xx/invalid JSON, 401/403, 413, 5xx, timeout, respuesta perdida; solo receipt válido da `ok`.
- Hook: licencia válida sube, demo/no licencia no crea remoto; pending → completed tras receipt verified; failure mantiene failed/retryable y no setea processed; no excede backoff ni duplica `operationId`.
- Restore: válido restaura roundtrip; corrupto, checksum/schema incorrecto o acceso negado deja IDB/localStorage intactos.
- Retención simulada por API adapter: 0–3 copias, 4+ elimina solo old entries tras nuevo objeto confirmado, upload failure no borra antiguas, cleanup failure reporta pendiente/reintenta; dos cargas concurrentes permanecen dentro de la política.

Estación:
- Unit/route tests: missing credentials fail closed; auth/licence invalid; `business_id` no confiable del body ignorado; service-role solo server; paths no atraviesan `..`; tamaño límite; mime/schema; checksum; duplicate idempotency; Supabase Storage upload/head/list/download/remove; SQL/manifest error y compensación.
- RLS tests reales/locales para manifest, si browser/client participa. Service role no reduce el requisito de la autorización del usuario antes de operarla.
- Cuota agotada → no se ejecuta deletion previa; respuesta 507/413/domain code y UI muestra sin ocultar las tres copias existentes.

**Gate D:** tests de ambos repos pasan localmente; fakes/mocks prueban el contrato pero no se llaman E2E de Storage real.

### Fase E — E2E opt-in en staging del proyecto backup

1. Staging project/bucket con licencia/device/negocio sintético (`e2e-*`), secretos CI privados, cuota monitoreada y ninguna credencial de producción.
2. Crear cuatro backups sintéticos consecutivos: verificar objetos reales, lista contiene exactamente los tres más recientes y la copia más vieja ya no está. Verificar upload/read metadata y descarga de fixture por operación explícita.
3. Borrar datos locales solo del perfil browser efímero; restaurar última versión y comprobar fingerprint exacto en IDB/LS tras reload y anti-eco.
4. Failure cases: offline, storage 401/403/413/5xx, error intermedio manifest, upload success+lost response, retry same operation id, cleanup fail, concurrencia, no licencia, business A intentando backupId/business B.
5. Probar la ruta real por la API del backend, no escribir directamente a Storage con una anon key para saltar autorización. No loguear backup, tokens, URLs firmadas ni HAR con header secrets.
6. Sin config E2E opt-in, test falla con explicación o se omite explícitamente, nunca cae al backend real por default.

**Gate E:** la copia descargada/restaurada coincide; cuatro subidas dejan los últimos tres; ningún caso de error borra previos, cruza tenant o marca falsamente completed.

### Fase F — Despliegue y observabilidad

1. Estructurar métricas sin datos sensibles: bytes almacenados, objetos por negocio, porcentaje de cuota, upload/restore/cleanup success/fail, razón, duración, retries, operaciones huérfanas.
2. Aviso antes del límite (por ejemplo, 70/85/95% de cuota organizacional); umbrales finales según número de comercios y tamaño medido. Storage/egress cuotas compartidas si los proyectos comparten organización.
3. Probar local build/typecheck/lint/tests de POS y Estación Maestra, integración local con Supabase/Storage si el proyecto permite emularlo, E2E staging opt-in, `git diff --check`.
4. Configurar bucket solo en el project ref indicado y verificado, tras aprobación explícita de la escritura remota. Nunca copiar `SUPABASE_SERVICE_ROLE_KEY` en chat. Configurarla en Vercel/secret manager y host POS correspondiente.
5. Despliegue staging backend primero; app POS apuntando staging; probar backup y restore, cuota/RLS, y verificar que ningún backup llega a Drive ni al Supabase operativo por error.
6. Migración de transición opcional de históricos: conservar backups actuales en `cloud_backups`/Drive mientras se copia y verifica cada uno al nuevo bucket; borrar origen solo con política/autorización independiente. No se migra nada como parte del cambio de código.
7. Rollback deja bucket/objetos intactos; desactivar nuevos uploads no borra respaldos ni cambia restauración antigua. Producción requiere autorización explícita separada.

**Gate F:** restore de staging demostrado, límites/alertas activos, identidad/proyecto revisados y rollback probado. No declarar productivo solo por build verde.

## 7. Matriz de aceptación final

| Caso | Resultado | Evidencia |
|---|---|---|
| Backup de negocio con licencia elegible | Objeto gzip confirmado, checksum/tamaño/fecha, estado completed | API receipt + manifest + `head`/download en staging |
| Demo/no licencia/vencida | No hay upload remoto automático | Unit + API integration |
| Cuatro snapshots del mismo negocio | Se conservan solo los tres más recientes; otras tiendas no se afectan | Listado Storage/manifest + E2E staging |
| Fallo antes de confirmar upload | Se conservan los backups anteriores y request reintentable | Inyección de error en upload |
| Fallo de cleanup tras upload nuevo | La nueva copia sigue válida; cleanup pending y visible/logged, reintento seguro | Test route/worker |
| Restore bajo demanda | Solo una descarga explícita; bytes, checksum, gzip y schema válidos; contenido correcto | Download de Storage + fingerprint tras reload |
| Restore corrupto/cancelado/no autorizado | No se cambian datos locales ni tenant | Tests negativos + perfil efímero |
| Uso egress cotidiano | No hay descargas automáticas del payload en backup/sync diario | Network assertions (requests y bytes) |
| Quota llena/Storage project pausado | No se borran las tres copias vigentes ni se anuncia éxito; se informa y solicita acción | Simulación de quota/paused project |

## 8. Riesgos y límites explícitos

- “Sin egress” no puede ser literalmente cero: upload responses, Postgres/RPC y restauraciones envían algunos bytes hacia el cliente. El objetivo es **cero egress del contenido completo del backup durante la rutina automática**, descargándolo solo en restore.
- Supabase Storage Free 1 GB se comparte a nivel de organización. Si el proyecto nuevo está en la misma org que productos/assets, estos consumen esa misma cuota. El presupuesto debe incluir `3 × tamaño comprimido × cantidad de negocios` y margen de objetos transitorios.
- Un solo archivo puede superar el límite Free de 50 MB aunque Storage total esté bajo; el sistema debe rechazarlo con claridad o definir estrategia multipart/resumible compatible, no fragmentar silenciosamente.
- Free puede pausar por inactividad; elegir dos proyectos no garantiza disponibilidad continua. Confirmar tráfico/heartbeat permitido sin generar carga ineficiente o manipular artificialmente el umbral.
- Un segundo proyecto en Supabase no equivale a copia fuera del proveedor/cuenta. Recomendar export cifrado off-site independiente para recuperación ante cierre/bloqueo de la cuenta, pero ese destino queda como fase posterior y no se afirma configurado.
- Las URLs firmadas deben tener expiración corta y emitirse solo tras autorización; bucket permanece private. Paths/metadata no deben incluir nombres/emails/PII.
- Service-role tiene bypass total de RLS. El server tiene que autorizar business ownership antes de cada list/download/delete; nunca exponerla en cliente.
- Tres copias pueden ser insuficientes frente a corrupción que se descubre tarde. La retención de 3 es decisión expresa del negocio; no añadir copia mensual fuera de política sin confirmar.

## 9. Seguridad y límites de ejecución

- El usuario confirmó arquitectura de proyecto separado, retención tres, destino `qlujyvauumzfpdefdkyl` (`https://qlujyvauumzfpdefdkyl.supabase.co`) y titularidad declarada `luiggiberladi94@gmail.com`. URL, nombre de bucket y service-role están preparados en el `.env.local` server-only de Estación Maestra; la clave no se verificó ni se mostró. La herramienta conectada aún no pudo verificar el proyecto por permisos.
- PRO está oculto temporalmente de los controles y superficies visibles, preservando la funcionalidad; ver §2. No usar PRO ni habilitar sus flujos de backup hasta implementar scoping product-aware.
- No crear proyecto, bucket, tablas, políticas, Storage objects, usuarios, despliegues ni escrituras remotas en esta etapa del plan. La consulta `get_project`/`get_project_url` fue solo lectura y falló por falta de permiso.
- No usar `scripts/e2e_upload.mjs` (escribe cloud_backups y sync_documents en un project real con ID fijo).
- `.env` local y `../estacion-maestra/.env.local` contienen credenciales/secrets; no imprimir su contenido ni copiarlos a ningún archivo. `VITE_*` es público de bundle; no poner service-role ahí.
- No tocar, stagear, descartar ni reformattear cambios existentes en ambos repos. Al implementar: diff por archivos propios y no usar `git add -A`.
- La retención destructiva remota solo puede correr en bucket aislado y después de verificar la copia nueva. Producción necesita autorización aparte.

## 10. Entregables de implementación

1. Storage bucket privado y tabla/manifest mínima versionada en proyecto separado, con ownership verificable y políticas.
2. Endpoints server-side autenticados para upload, latest-3, download/restore, status/idempotency y cleanup.
3. Cliente POS sin Google Script/Drive en el flujo, receipt tipado, hash/backoff y estado de éxito real.
4. UI/listado/restauración explícitos con confirmación, metadata útil y separación con sync operativo.
5. Tests unitarios, de API y E2E staging de retención tres, isolation, cleanup seguro y restore.
6. Métricas/alertas de Storage quota, procedimiento de rollback y documentación de los límites Free.

**Definición de terminado:** un fixture de un negocio licenciado se sube a Storage privado en el proyecto autorizado, el servidor confirma bytes/checksum, cuatro subidas de ese negocio dejan solo las tres últimas, ninguna rutina automática descarga los payloads, el usuario puede escoger/restaurar una versión y el roundtrip reproduce los datos; los errores no borran backups previos ni afirman éxito. Hasta completar staging y recibir autorización separada para configurar/desplegar, el sistema actual no debe declararse migrado ni productivo.
