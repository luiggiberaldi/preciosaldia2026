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
