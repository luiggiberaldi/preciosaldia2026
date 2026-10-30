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

---

## 2026-10-18 — release 2.0.1 a producción (push a main → auto-deploy Vercel)

**Decisión de luigi:** publicar la versión 2.0.1 con todo el acumulado de la rama
`preview/all-changes-oct14` (29 commits desde el 2.0.0: modo supervisor con inventario
remoto, comandos, cola/tracker/recibos y avisos de equipo; resiliencia de sync nube/caja;
fixes de catálogo con `pos_write_lock` + merge 3-way; mejoras POS; seguridad; y el CI de
GitHub Actions) y con las **mutaciones remotas del supervisor activas**. El código ya las
trae activas por defecto (`supervisorPolicy.js`, `fallback=true`; la env var
`VITE_SUPERVISOR_REMOTE_MUTATIONS_ENABLED` solo sirve para apagarlas con `'false'`).
Con esta decisión queda sin efecto el gate "E2E funcional contra staging seguro" del
PLAN-FIXEO-SUPERVISOR-E2E.md, por ser decisión explícita del dueño.

**Cambios:**
- Versión `2.0.1` en `package.json`, `src/views/SettingsView.jsx` y
  `src/components/security/LockScreen.jsx` (misma convención del 2.0.0).
- Tags `2.0.1` y `v2.0.1` sobre `main`, igual que el 2.0.0.
- Sin migraciones SQL ni cambios de infraestructura.

**QA:** lint 0 errores, `tsc` limpio, 1525 tests en verde (141 archivos) y build PWA OK,
todo sobre el árbol exacto del release; más el gate pre-push (e2e checkout móvil) y el CI
de Actions en el push. **Pendiente post-deploy:** confirmar en el bundle servido de
`preciosaldiaoficial.vercel.app` que el flag de mutaciones no venga apagado por una
variable forzada a `'false'` en el proyecto Vercel.

---

## 2026-10-18 — release 2.0.2 a producción (eco optimista del supervisor + blindaje LF)

**Contenido del release:**
- **Eco optimista del catálogo:** crear, editar o borrar un producto desde el supervisor se ve AL INSTANTE en su lista (como el cambio de tasa), con la etiqueta "ESPERANDO A LA CAJA" del tracker encima. Si la caja rechaza el cambio, la vista se revierte sola y el aviso trae el motivo; cuando llega el eco real, la entrada optimista se retira sola. Solo presentación: no toca almacenamiento ni nube.
- **Refresco inmediato en la caja:** al aplicar un comando de producto, la pantalla de la caja refresca ANTES de reportar a la nube (antes dependía de la velocidad del internet); el rollback de una publicación fallida también se ve al instante.
- **Optimización de interfaz móvil del supervisor** y eliminación de botones redundantes.
- **Blindaje de fin de línea:** `.gitattributes` fija LF para archivos de texto. Un cambio de rama en Windows reescribía los archivos con CRLF y rompía 4 tests de guardrails SQL que comparan literales multi-línea (causa raíz reparada; aserciones intactas).

**QA:** lint 0 errores, `tsc` limpio, suite completa **142 archivos / 1535 tests en verde**, build OK; más el gate pre-push (e2e checkout móvil) y el CI de Actions en el push. La suite corrió completa DESPUÉS de la reparación de fin de línea.

---

## 2026-10-19 — release 2.0.3 a producción (el supervisor surte efecto sin recargas)

**Contenido del release:**
- **La caja aplica las órdenes del supervisor sin recargar.** Dos huecos dejaban un ajuste de stock del supervisor "sin efecto" hasta recargar la caja: (1) si la sesión Auth fallaba al arrancar, el receptor quedaba mudo — sin canal y sin reintentos — hasta la próxima recarga; (2) un canal Realtime que decía "conectado" pero no entregaba eventos no tenía respaldo alguno (los eventos de un corte no se reenvían). Ahora el arranque reintenta con backoff hasta suscribirse (jamás dos canales), hay un barrido de respaldo cada 15 s con el canal conectado (una consulta ligera de órdenes pendientes, normalmente vacía) y se barre al volver red/visibilidad. Realtime sigue siendo la entrega inmediata (< 1 s típico); el peor caso queda acotado a ~15 s y ninguna orden vence sin aplicar (TTL 5 min).
- **El Supervisor recibe el eco de la caja sin recargar:** barrido de respaldo conectado cada 45 s en `useMonitorSync` (pull incremental: solo metadatos cuando no hay cambios, payload únicamente de lo nuevo) + barrido al instante al volver a la pestaña. Hueco simétrico al de la caja.
- Los tests que afirmaban "con Realtime conectado no se consulta" se reescribieron al nuevo contrato (barrido acotado, una consulta por intervalo, sin ráfagas): ese comportamiento era exactamente el bug. Casos nuevos: sesión caída al arrancar, barrido silencioso, eco aplicado por barrido y limpieza de timers.

**QA:** lint 0 errores, `tsc` limpio, suite completa **143 archivos / 1542 tests en verde** (10 skipped preexistentes), build PWA OK; más el gate pre-push (e2e) y el CI de Actions en el push. p95 del ACK sin regresión (2.3 ms sobre un presupuesto de 60 ms).

---

## 2026-10-22 — release 2.0.4 a producción (el lote de inventario ya no re-publica el catálogo)

**Contenido del release:**
- **El lote de inventario del supervisor se desacopló de la publicación del catálogo.** Un ajuste de stock ya no vuelve a subir el catálogo completo (~1.3 MB) aunque solo cambien unas pocas líneas: el movimiento viaja dentro del historial de ventas (con su "antes/después" de stock embebido) y el monitor calcula el stock visible solo. Medido con el respaldo real de producción: un lote de 20 líneas pasó de subir 3 documentos / 2.00 MB a 2 / 0.68 MB, con cero bytes de catálogo.
- **El historial de ventas se publica por meses** en vez de un bloque gigante, y el lote trae su diario de recuperación: si la caja se corta a mitad del ajuste, al reiniciar se termina el movimiento una sola vez, sin perder ni duplicar. Las escrituras locales que solo cambian stock (cobro, anulación, lote) ya no re-encolan la subida del catálogo, y la publicación a la nube queda fuera del bloqueo del cajero: el botón "Cobrar" no espera internet.
- **Semántica unificada de bulto/unidad.** La venta congela el modo de venta por línea, así que recibos, ticket impreso, historial, PDF del cierre y comprobante de WhatsApp dicen "1 bulto · 12 uds" (o "1 ud" la suelta). La valorización canónica divide precio/costo por bulto (corrige la sobrevaluación ×unitsPerPackage en métricas e inventario), los "más vendidos" suman unidades canónicas y un solo umbral (`lowStockThreshold`) gobierna las alertas de stock bajo.
- **Batería cerrada:** las 6 pruebas preexistentes en rojo quedaron alineadas con los contratos vigentes (panel plegable del bloqueo, "sin rollback" del fallo de publicación) y `DashboardCashControls` quedó blindado contra props ausentes.

**QA:** lint 0 errores, `tsc` limpio, suite completa **160 archivos / 1724 tests en verde** (16 skipped), build PWA OK; más el gate pre-push (e2e) y el CI de Actions en el push.

---

## 2026-10-29 — release 2.0.5 (ventas remotas, anulación, compras de mercancía y EN VIVO)

**Contenido del release:**
- **Vender desde el Supervisor** (`supervisor.sale.create`, migración 20261029): misma vista que la caja (buscador, categorías, cesta; cobro modo PC/móvil según la pantalla), solo contado, la caja re-precia y registra con su pipeline normal. Avance de efectivo si la caja lo tiene activo (20261030). Botón «Cancelar venta» mientras espera. **No deja cobrar con la caja cerrada.** Sigue tras el interruptor `VITE_SUPERVISOR_REMOTE_SALES_ENABLED` (apagado por defecto).
- **Anular ventas del turno desde el Supervisor** (`supervisor.sale.void`, 20261031) con motivo obligatorio; la caja anula con `processVoidSale`.
- **Compras de mercancía** (nuevo): registro de facturas ya pagadas para saber cuánto se gastó en el mes. En la caja: Reportes → Compras (cargar, editar, borrar). Reporte por período con total, por proveedor, por día y detalle, más PDF. No toca caja, cierre, stock ni deudas. Sync por **mes** (`bodega_merchandise_purchases_v1:<YYYY-MM>`) para no inflar el egress. En el Supervisor: Proveedores → Compras de mercancía, también con cargar/editar/borrar por órdenes `supervisor.purchase.*` (20261101).
- **Carrera al recargar la caja:** una descarga vieja del pull inicial podía borrar una compra recién guardada por orden del Supervisor. La caja ahora registra el watermark de lo que publica y conserva las compras locales posteriores al doc.
- **EN VIVO:** se quedaba en «Recuperando»/«Sincronizando» tras un corte de red o «Actualizar datos» con el canal Realtime aún vivo. Corregido.
- Encabezado del Supervisor: diagnósticos ocultos (`?diag=1` para soporte), versión visible (`v2.0.5 · commit`) y nombre del negocio de la caja sincronizado en vivo.
- Inventario en orden alfabético; granel muestra stock en kg/L en todo el sistema; +/− y lápiz corrigen stock granel con decimales.
- Ajustes de venta (IVA, avances, stock negativo) sincronizados al Supervisor solo cuando cambian.

**Migraciones aplicadas en producción:** 20261029, 20261030, 20261031, 20261101 (verificadas).

**QA:** lint 0 errores, `tsc` limpio, suite completa en verde, e2e de ventas remotas y stock; prueba real de compra desde el Supervisor a la caja (alta y borrado).
