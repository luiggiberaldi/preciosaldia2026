# POS: credencial por dispositivo para upload de respaldos (pendiente, sin commit)

Estado: cambio en el working tree del POS, **no committeado** a propósito.
Se separa del commit de Estación `32d1f75`.

## Qué cambió en el POS
- `src/utils/backupStorageUpload.js`: el upload envía `x-device-credential`
  leído de `localStorage` (clave `estacion_device_upload_credential`).
  Sin credencial no hace llamada de red. Se quitó el secreto público
  `VITE_ESTACION_BACKUP_SECRET` de este camino.
- `tests/backupStorageUpload.test.js`: 7 casos, incluido "sin credencial no
  llama a fetch" y "no envía x-backup-secret".

## Pendiente antes de committear
1. Aplicar la migración `docs/migrations/004-device-upload-credentials.sql`
   de Estación (hoy es borrador, no aplicada).
2. Que el emparejamiento llame a `POST /api/backup/device-credential` y guarde
   la respuesta con `saveDeviceCredential`. Hoy la entrega es manual.
3. El relay (`src/utils/backupRelay.js`) sigue usando `x-backup-secret` con
   `VITE_ESTACION_BACKUP_SECRET`. Mientras exista ese camino, el secreto sigue
   en el bundle.

## Verificación hecha
- `vitest` del POS: 880 passed / 12 skipped / 0 fallidos (con el cambio).
- ESLint de los archivos tocados: exit 0.

## No verificado
- Prueba HTTP end-to-end contra la ruta de Estación y la base real
  (la tabla no está migrada).

## Revisión del canje de token (decisión)
- El emparejamiento ya tiene canje de un solo uso: `pair_monitor_device(p_token, p_monitor_device_id)`
  valida hash y expiración de `device_pairings` (staging: `20261011_002_staging_supervisor_pairing_auth.sql`).
- Un canje paralelo en Estación duplicaría ese flujo y exige tocar la base operativa.
- Pendiente: decidir si la credencial sale del mismo RPC (extender su respuesta) o de una ruta aparte.
  No se implementó en esta iteración.

## Verificación de esquema y diseño del canje (revisión 2)

Fuentes: repo POS, no la base viva. No se consultó Supabase en esta revisión.

### Esquema real de `device_pairings`
- No hay `CREATE TABLE device_pairings` completo en el repo. Las columnas se
  infieren de las migraciones y RPC de staging (`20261011_001/002`, `20261012_003`,
  `20261013_004`) y del borrador de producción.
- Columnas usadas: `primary_device_id`, `monitor_device_id`, `monitor_auth_id`,
  `owner_auth_id`, `token_hash`, `token_expires_at`, `token_used_at`, `revoked_at`, `paired_at`.
- Con RLS forzado. `pair_monitor_device` es `SECURITY DEFINER`, con grant solo a `authenticated`.
- Producción (`sodgzkablshladvbtnes`) NO tiene estos cambios: el 004 multi-locale
  está aplicado solo en staging; los borradores de producción no están aplicados.

### Canje propuesto (sin implementar)
- La credencial sale del mismo flujo de un solo uso: el POS, al llamar
  `pair_monitor_device`, recibe además una credencial emitida server-side.
- Guardar solo `secret_hash` en `device_upload_credentials` (migración 004 de
  Estación). Devolver el secreto una sola vez en la respuesta del RPC o de una
  ruta que valide el mismo token.
- Riesgo: el RPC vive en Supabase y el upload en Estación. Hace falta que la
  respuesta del RPC y la tabla `device_upload_credentials` estén en la misma base.
  Hoy `device_upload_credentials` solo existe como borrador en Estación.

### Bloqueos antes de implementar
1. Confirmar que `device_upload_credentials` y `device_pairings` están en la
   misma base operativa, o decidir cómo se sincroniza la credencial.
2. Aplicar la migración 004 (Estación) tras aprobación explícita.
3. Revisar el borrador de producción `20261013_prod_pairing_token_owner_proof.sql`
   antes de cualquier cambio en `generate_pairing_token`.

## Verificación en producción (solo lectura, revisión 3)

Base consultada: `sodgzkablshladvbtnes` (producción, la base operativa). Solo lectura
vía PostgREST con la clave de servicio de Estación. No se leyeron filas de pairings.

- `device_pairings` EXISTE en producción. Columnas: `id` (uuid), `primary_device_id`,
  `monitor_device_id`, `pairing_token`, `token_hash`, `token_expires_at`, `token_used_at`,
  `paired_at`, `revoked_at`, `created_at`, `owner_auth_id` (uuid), `monitor_auth_id` (uuid),
  `last_seen_at`. Requeridas: `id`, `primary_device_id`. Hay 19 filas (conteo, sin contenido).
- `device_upload_credentials` NO EXISTE en producción (404). La migración 004 sigue sin aplicar.
- RPC expuestos en producción: `pair_monitor_device`, `generate_pairing_token`, `unpair_monitor`.
- Diferencia de esquema: producción tiene ambas columnas, `pairing_token` (texto) y
  `token_hash`. El OpenAPI solo confirma que existen; NO se leyeron valores, así que no
  se sabe si `pairing_token` guarda tokens en claro. El cuerpo real de `pair_monitor_device`
  en producción tampoco se verificó: PostgREST no lo expone.

Conclusión: el canje propuesto necesita la migración 004 en producción, aprobada
explícitamente, y revisar qué versión de `pair_monitor_device` corre en producción.

## Cuerpo real de `pair_monitor_device` en producción (revisión 4)

Leído del catálogo de Postgres de `sodgzkablshladvbtnes` (solo lectura, sin cambios).

Comportamiento:
1. Exige sesión (`auth.uid()`); si no hay, responde `success:false`.
2. Valida el código: entre 16 y 64 caracteres.
3. Busca la fila por `token_hash = sha256(upper(trim(token)))`, con
   `token_expires_at > now()`, `token_used_at IS NULL` y `revoked_at IS NULL`. Usa `FOR UPDATE`.
4. Si `monitor_auth_id` ya está ocupado por otro monitor, responde `success:false`.
5. Marca el vínculo: guarda `monitor_device_id`, `monitor_auth_id`, `paired_at`,
   `token_used_at`, y pone `pairing_token` y `token_hash` en NULL.
6. Devuelve `{success: true, primary_device_id}`.

Diferencias con staging: producción no exige prefijo `e2e-` ni valida el formato
de `p_monitor_device_id` (solo `NULLIF(trim(...), '')`).

## Diseño del canje sobre esta función (no implementado)

- El token se consume en el paso 5, así que el canje puede salir de la misma respuesta.
- Propuesta: extender el JSON de éxito con `credential` (secreto aleatorio, una sola vez)
  y guardar solo su SHA-256 en `device_upload_credentials`.
- Requisitos previos: migración 004 aplicada en producción, con aprobación explícita.
- Riesgo: `pair_monitor_device` es SECURITY DEFINER y se llama desde el cliente. El
  secreto viajaría en la respuesta del RPC; hay que confirmar que el cliente lo guarda
  sin registrarlo en logs.
- Riesgo: si la inserción de la credencial falla después del paso 5, el token ya quedó
  consumido. Hace falta una transacción que cubra ambos pasos.
- Pendiente de confirmar: si `pairing_token` contiene valores en claro en filas existentes.
