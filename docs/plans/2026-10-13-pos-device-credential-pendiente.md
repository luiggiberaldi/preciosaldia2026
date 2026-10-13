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
