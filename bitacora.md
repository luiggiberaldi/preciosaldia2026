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
- ~~Igualar `VITE_ESTACION_BACKUP_SECRET` (proyecto Vercel del Lite) con `BACKUP_SHARED_SECRET`
  (Estación). Sin eso, el endpoint responde 401 y los respaldos se marcarán fallidos con ese motivo.~~
- ~~Push + deploy a producción (`preciosaldiaoficial.vercel.app`) — tiene usuarios en vivo,
  hacerlo con cuidado y con autorización explícita de luigi.~~

## 2026-09-29 (23:09) — deploy a producción + secreto compartido sincronizado

- Push a GitHub (`main`: `09b5b6e` → `3e3141c`) con autorización de luigi.
- El proyecto Vercel `preciosaldia2026` (otra cuenta, token provisto por luigi, uso
  transitorio sin guardarlo) tiene auto-deploy por Git: el push generó deployment READY
  a las 23:09 con el fix, sirviendo en `preciosaldiaoficial.vercel.app` (HTTP 200).
- `BACKUP_SHARED_SECRET` NO existía en el proyecto Vercel de la Estación → el endpoint
  estaba fail-closed (401 a todo). Se creó con el mismo valor de
  `VITE_ESTACION_BACKUP_SECRET` del Lite (comparación por hash; primer intento con
  `type: "encrypted"` corrompió el valor — se eliminó y recreó con `type: "sensitive"`).
- Redespliegue de la Estación (`estacion-2026`, commit `ab947ba`, árbol limpio) para que
  tome la variable. Verificación funcional: sin secreto → 401; con el secreto del Lite
  y body vacío → 400 "Falta el ID del dispositivo" (auth superada).
- Cadena completa verificada: Lite en campo → `/api/backup/complete` → Estación.
- PENDIENTE: luigi debe rotar el token de Vercel que pegó en el chat (quedó expuesto).

---

## 2026-09-30 — feat(registro): teléfono obligatorio del negocio + en solicitud de licencia

**Decisión de luigi:** el teléfono en el registro del Lite es **obligatorio** (no opcional).
Motivo: el campo existe para que él pueda contactar al cliente por WhatsApp (licencia,
soporte, novedades); opcional lo dejarían vacío y quedaría igual que hoy.

**Cambios:**
- `src/utils/phoneValidation.js` (nuevo): `normalizeVzlaPhone` (acepta +58/58,
  espacios, guiones → 11 dígitos `04XXXXXXXXX`), `isValidVzlaPhone` (móvil
  venezolano `^04\d{9}$`), `displayVzlaPhone` (`0412 123 4567`). No se usó el
  `formatVzlaPhone` de `calculatorUtils.js` porque valida, no solo normaliza.
- `src/components/TermsOverlay.jsx` (paso 2, después de T&C): nuevo campo
  "Número de Teléfono *" con `type="tel"`, icono Phone, validación en vivo con
  mensaje de error en rojo, y auto-formato al salir del campo. El botón
  "Finalizar Registro" se habilita solo con nombre + teléfono válido.
  Se guarda en `localStorage` como `business_phone` (dígitos normalizados).
- `src/components/Settings/tabs/SettingsTabLicencia.jsx`: el mensaje de
  "Solicitar por WhatsApp" ahora incluye `Negocio:` y `Mi teléfono:` (leídos de
  localStorage) además del ID — así el número llega a la Estación con la
  solicitud y luigi lo registra al activar.
- `src/components/Settings/tabs/SettingsTabNegocio.jsx` + `src/views/SettingsView.jsx`
  + `src/components/SettingsModal.jsx`: campo "Teléfono del Negocio" editable en
  Ajustes → Mi Negocio (para clientes que se registraron antes de este cambio);
  al guardar valida el formato y muestra error si es inválido.
- `tests/phoneValidation.test.js` (nuevo): 5 tests, todos pasan.
- Build de producción (`npm run build`) verificado OK.

**Flujo del teléfono:** registro local (`business_phone`) → viaja en el mensaje de
WhatsApp de solicitud de licencia → luigi lo carga en la Estación (campo Teléfono
en "Generar licencia") → queda en `clients.phone` y disponible en la vista Mensajes.
