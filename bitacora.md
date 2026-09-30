# Bitácora — preciosaldia2026 (Lite / app original)

Regla: todo cambio de código lleva su entrada aquí (qué cambió y por qué).
Aprendizajes reutilizables van a `inteligencia.md`.

---

## 2026-09-29 — fix(respaldos): errores honestos en useAutoBackup, fallback muerto eliminado

**Problema:** el pipeline de respaldos remotos era silencioso. `performBackup()` tragaba
todos los errores (`catch` sin propagar) y el flujo de solicitudes marcaba `completed`
sin importar si el respaldo realmente se hizo — éxito falso. Además existía un
"fallback" directo a Supabase (`cloud_backups` vía `auth.getSession()`) que nunca podía
funcionar porque la app no tiene sesión Auth; fallaba en silencio con `.catch(() => null)`.
Resultado en la Estación: solicitudes colgadas en `pending` para siempre (las 41 zombies
que se limpiaron el 2026-09-30) o marcadas completadas sin respaldo real.

**Cambios en `src/hooks/useAutoBackup.js`:**
- `performBackup()` ahora devuelve `{ ok, driveUrl, error }` en todos los caminos:
  guardas tempranos (sin datos, demo, localhost, ya respaldó hoy, sin cambios) devuelven
  `{ ok: false, error: '<motivo>' }` en vez de `undefined` silencioso.
- Eliminado el fallback muerto a Supabase (`auth.getSession()` + upsert a `cloud_backups`
  con `.catch(() => null)`). Si `/api/backup/complete` no responde con éxito, se devuelve
  `{ ok: false, error: 'La estación rechazó los metadatos (401/403...)' }` — sin éxito falso.
  (Se quitó también el import ya sin uso de `buildCloudBackupsRow`.)
- Nuevo helper `markBackupRequestFailed(requestId, reason)`: marca la solicitud como
  `failed` guardando el motivo en la columna `error` (tolerante: si la columna no existe,
  reintenta solo con `status`).
- `checkPendingRequests`: solo marca `completed` cuando `result.ok` es real, y revisa el
  error del UPDATE; en fracaso llama a `markBackupRequestFailed` para que la Estación lo
  muestre como "Fallido" con el motivo en vez de dejarlo colgado.
- El path periódico (cada 30 min) ignora el retorno como antes; solo el flujo de
  solicitudes usa el resultado.

**Alcance:** solo Lite (app original, `product_id='bodega'`). NO se tocaron los guards
`deviceBackend` del multilocal: aquí la tabla `backup_requests` sí existe en el proyecto
Supabase original, el poll funciona sin ese blindaje.

**QA:** `node --check` limpio; eslint 0 errores (14 warnings, todos preexistentes — el
original tenía 15, se eliminó uno con el import muerto); `vitest run
tests/backupRelay.test.js tests/backupRestore.test.js` → 31/31 pasan.

**Pendiente (no es código):**
- Igualar `VITE_ESTACION_BACKUP_SECRET` (proyecto Vercel del Lite) con `BACKUP_SHARED_SECRET`
  (Estación). Sin eso, el endpoint responde 401 y los respaldos se marcarán fallidos con ese motivo.
- Push + deploy a producción (`preciosaldiaoficial.vercel.app`) — tiene usuarios en vivo,
  hacerlo con cuidado y con autorización explícita de luigi.
