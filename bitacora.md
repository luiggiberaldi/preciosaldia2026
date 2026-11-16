# Bitácora — preciosaldia2026 (Lite / app original)

Regla: todo cambio de código lleva su entrada aquí (qué cambió y por qué).
Aprendizajes reutilizables van a `inteligencia.md`.

---

## 2026-11-15 — Licencias: aviso remoto de cambio de ID para separar un ID compartido (P-020)

- Nuevo buzón `identity_migration_orders` (migración `20261115_identity_migration_orders.sql`, **aplicada**): tabla cerrada, solo service_role crea avisos; la caja solo ve y completa avisos de su propia sesión (`auth.uid()`).
- La caja revisa su aviso al abrir y cada 30 min, solo si ya tiene sesión; si su ID actual es el viejo, adopta el nuevo con `migrateDeviceIdentity({ newDeviceId, expectedCurrentId })`. No borra datos ni toca la licencia del ID viejo.
- Publicado en producción: commit `0552a69` en `main` (rama `fix/aviso-cambio-id`, desde la versión publicada, sin el resto del trabajo sin publicar). Vercel `dpl_3f3YT1jjNg6Gc3kfzsUrZZesXktp`.
- Prueba real con el equipo de prueba (sesión `8c42499b`): `…36EE3855` → `…BED0F3A9` a las 20:24:55 UTC, aviso cumplido, licencia `ACTIV-BED0-F3A9` creada antes; el usuario confirmó ID, premium y datos en pantalla.
- Cosméticos: licencia `ACTIV-49CF-C294` («cosméticos») y aviso para la sesión `8bc85903` creados; cambia al abrir o recargar la caja. Identificación: es la sesión que usa `…CB675980` sin tener su identidad ni subir respaldos; «bueno y sano» es `d20bcf79` (Telemic) y sube el respaldo (282 productos de víveres).

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

---

## 2026-10-30 — fix(ui): la escala de interfaz ya no deja franja en blanco ni corta COBRAR

**Problema:** en algunas laptops la pantalla Vender (y el resto) terminaba antes del borde inferior, con el menú flotando en una franja vacía. Causa: «Escala de interfaz» (Ajustes → Sistema) aplica `zoom` al `<html>`, y el zoom también escala las unidades de viewport. A 85 % la app medía el 85 % de la ventana; por encima de 100 % se salía (COBRAR y pies de modal cortados). Solo pasaba en equipos con la escala distinta de 100 %.

**Cambio:** plugin PostCSS `postcss-viewport-zoom.js` que reescribe cada `vh/dvh/svh/lvh/vw…` del CSS generado a `calc(N / var(--ui-zoom, 1))` (cubre las 39 vistas y modales sin tocarlas; idempotente). `applyUiScale` (`src/utils/uiScale.js`) fija `zoom` y `--ui-zoom` juntos al arrancar y desde Ajustes. A 100 % el resultado es idéntico al anterior.

**QA:** medido en Vender a 80/85/100/115 % (el contenido llega al borde; COBRAR visible a 115 %), 4 tests nuevos, lint 0 errores, `tsc` limpio.

---

## 2026-10-30 — fix(reportes): los % de «Medios de pago» ya no cambian al mover la tasa

**Problema:** el equivalente en Bs de los medios en USD se calculaba con la tasa de HOY, así que al cambiar la tasa (p. ej. de 889 a 1,00) los porcentajes de la tarjeta «Medios de pago» (panel y Reportes) se movían aunque las ventas ya estaban cobradas.

**Cambio:** `FinancialEngine.calculatePaymentBreakdown` guarda en cada bucket USD `usdAtSale` (USD con tasa de venta conocida) y `bsAtSale` (su peso en Bs con ESA tasa); aditivo, `total` no cambia. `toBsEquivalent` usa `bsAtSale` y solo lo que no trae tasa (legacy) usa la tasa vigente. El panel del Supervisor ya calculaba sus % en USD por pago y no cambia.

**QA:** 4 tests nuevos (`paymentBreakdownRateStable`), 231 tests de finanzas/reportes/cierre en verde, lint 0 errores, `tsc` limpio.

## 2026-10-31 — feat(supervisor): compras «guardadas en la caja, sincronizando…»

**Problema:** las compras cargadas desde el Supervisor solo aparecen cuando la caja
publica su mes en la nube. La caja F5D31 dejó de publicar el 30/10 y el Supervisor
mostraba $0 aunque la caja había confirmado las 8 compras: invitaba a cargarlas de nuevo.

**Cambios:**
- `src/utils/purchasesPendingSync.js` (nuevo): `computeUnsyncedPurchases` cruza las
  órdenes `supervisor.purchase.*` aplicadas con la lista sincronizada (por id y
  `updatedAt`; borrados pendientes mientras la compra siga en la nube) y marca `stale`
  pasados 5 minutos.
- `fetchAppliedPurchaseCommands` (`supervisorControlService.js`) y
  `src/hooks/usePurchaseCommands.js`: lee las órdenes aplicadas de los últimos 7 días
  (sondeo de 30 s + recarga cuando el tracker confirma una orden).
- `src/components/Monitor/PurchasesPendingSync.jsx` (nuevo), en `MonitorPurchasesPanel`:
  bloque aparte que NO suma al total, con aviso «La caja no está subiendo datos a la nube
  desde…» cuando tarda.
- Pruebas: `tests/purchasesPendingSync.test.js`, `tests/purchasesPendingSyncView.test.jsx`.

---

## 2026-11-13 — (reconstruido) Cambios del 31-oct al 13-nov

**Contexto:** la bitácora quedó sin entradas desde el 29-oct. Esta entrada resume, desde `git log`, lo que se guardó en ese tiempo. No se inventó nada: solo los títulos de los commits.
**Cambios (commits, de más viejo a más nuevo):**
- 2026-11-01: asistente con contexto de productos, ventas, clientes, reportes y proveedores; cupo por dispositivo; día de Caracas; prueba e2e del widget.
- 2026-11-04: en productos, el margen elegido se mantiene a cualquier nivel de precio y la ficha muestra el margen y los Bs reales tras redondear a centavos.
- 2026-11-07: ticket y recibo con IVA desglosado y productos exentos marcados con (E); cierre de caja con IVA desglosado y «Tasa activa».
- 2026-11-08: opción «Mis precios ya incluyen IVA».
- 2026-11-13: inicio con barra lateral, pantalla completa y encabezado estilo Farmacia.
**Casos y errores:** ninguno (aún no existía la ley).
**Verificación:** no verificado; solo se leyó el historial de git.

---

## 2026-11-13 — Auditoría y arreglo de la apertura de caja

**Contexto:** el dueño vio «Efectivo esperado −2.159,35 Bs». Informe: [docs/auditorias/AUDITORIA-APERTURA-CAJA-2026-11-13.md](docs/auditorias/AUDITORIA-APERTURA-CAJA-2026-11-13.md).
**Cambios:** no se pueden abrir dos cajas a la vez (`useCheckoutFlow.js`); regla única del fondo real de la gaveta (`cashShift.js`, `fondoGaveta.js`, `SalesView.jsx` y `useDashboardMetrics.js`); aviso legible de efectivo insuficiente para el vuelto (`AvisoFondoGaveta.jsx` y componentes del cobro), con «Registrar aporte», «Dejar en saldo a favor» y «Confirmar igual» en la confirmación final; aviso al abrir con 0 Bs y explicación del número rojo en el Inicio. Marcas en el código: `CAJA-APERTURA-001`, `CAJA-FONDO-001`, `CAJA-FONDO-002`.
**Casos y errores:** [CASO-002](docs/casos/CASO-002-caja-apertura-y-fondo.md); ERR-001, ERR-002, ERR-003.
**Verificación:** 124 de 124 pruebas de caja y cobro (incluye 12 nuevas: `tests/fondoGaveta.test.js`, `tests/aperturaDuplicada.test.js`). Batería completa: 2.241 de 2.244; fallan 3 de licencias (`licenseMonitoringMissing`, `licensePolicy`), ajenas a este cambio. Probado en el navegador: apertura con 0 Bs, vuelto en Bs sin Bs, aporte que quita el aviso, Inicio con USD 30,00 y 144,84 Bs. Guardado el 2026-11-13.

---

## 2026-11-13 — Documentación estilo Farmacia (fases 1 a 4)

**Contexto:** el dueño pidió copiar el modelo de documentación de Farmacia en versión ligera. Caso: [CASO-001](docs/casos/CASO-001-documentacion-estilo-farmacia.md).
**Cambios:**
- Fase 1: `docs/LEY-DOCUMENTACION.md`, `docs/ERRORES.md` (con 3 errores de caja de hoy y 3 reconstruidos de informes), `docs/casos/` (índice, CASO-001, CASO-002), `PENDIENTES.md`, sección en `AGENT.md`.
- Fase 2: `scripts/docs-check.mjs`, `tests/docsCheck.test.js`, script `docs:check`, llamada en `githooks/pre-commit` y en `.github/workflows/ci.yml`. Solo avisa.
- Fase 3: manual corto en `docs/sistema/`.
- Fase 4: auditorías de la raíz movidas a `docs/auditorias/`.
**Casos y errores:** CASO-001.
- Fase 4 (detalle): movidas las 10 `AUDITORIA-*.md` de la raíz y `docs/AUDITORIA-MODO-SUPERVISOR.md` a `docs/auditorias/` con los enlaces ajustados; el enlace absoluto roto del README a `ROLLBACK-STABLE-BASELINE.md` se hizo relativo. Los `PLAN-*` y reportes de la raíz **no** se movieron (P-006).
**Verificación:** `node scripts/docs-check.mjs --ci` → «Documentación al día»; `npx vitest run tests/docsCheck.test.js` → 20 de 20. No se corrió la batería completa ni ESLint. Sin commit. Quedan 10 enlaces rotos antiguos dentro de `docs/auditorias/` (rutas absolutas de otro equipo y un test inexistente), no revisados por el guardia.

---

## 2026-11-14 — Vender estilo Farmacia (fases 1 a 7)

**Contexto:** el dueño pidió auditar Vender de Farmacia y traer lo útil a Bodega, fase a fase. Informe y plan con medidas antes/después: [docs/auditorias/AUDITORIA-VENDER-BODEGA-VS-FARMACIA-2026-11-13.md](docs/auditorias/AUDITORIA-VENDER-BODEGA-VS-FARMACIA-2026-11-13.md) y [docs/plans/2026-11-13-plan-vender-bodega-alinear-con-farmacia.md](docs/plans/2026-11-13-plan-vender-bodega-alinear-con-farmacia.md).
**Cambios:**
- Hora de la tasa en el cuadro «TASA BCV» (`src/utils/rateStamp.js`, `SalesView.jsx`).
- Fichas uniformes con recuadro de imagen fijo e iniciales si no hay foto; rejilla que se acomoda al ancho (mín. 170 px); poco stock en ámbar; aviso de producto sin precio; botones de 38 px; nombres completos sin «…» (`CategoryBar.jsx`, `src/utils/productInitials.js`, `tailwind.config.js` con pantalla `short`).
- Barra de categorías: se esconden «Todos/General» si hay una sola categoría; ayuda = botón «?»; una sola fila (`CategoryBar.jsx`).
- Buscador con 2 modos: «Teclado y escáner» y «Pantalla táctil»; se quitó «Lista» (`SearchBar.jsx`, `SalesView.jsx`, `RemoteSalePanel.jsx`).
- Ajustes → Ventas → «Cesta» (Automática / Siempre compacta / Siempre amplia), cesta compacta con precio por unidad cuando hay 2 o más, siempre compacta en teléfono; «Vaciar» en el encabezado de la cesta (`src/config/salesFeatures.js`, `SettingsTabVentas.jsx`, `CartPanel.jsx`).
- Más vendidos primero y «Productos frecuentes» en la cesta vacía (`src/utils/hotProducts.js`, `CategoryBar.jsx`, `CartPanel.jsx`, `SalesView.jsx`).
- Decisión del dueño: el sistema no usará tema oscuro.
**Casos y errores:** [CASO-003](docs/casos/CASO-003-vender-estilo-farmacia.md); ERR-007 (resuelto), ERR-008 (descartado); P-007 (descartado), P-008.
**Verificación:** batería completa 2.241 de 2.244 (16 omitidas); fallan las mismas 3 de licencias de antes (`licenseMonitoringMissing` ×2, `licensePolicy` ×1), ajenas a este cambio. Pruebas nuevas: `rateStamp`, `productInitials`, `salesFeaturesCartCompact`, `hotProducts`; ajustada `posSearchViewModes`. ESLint sin errores en los archivos tocados. `docs:check` al día. Probado en el navegador a 1366×768, 1920×1080, 1024×768, 768 y 375 con 2.400 productos de prueba. No verificado: varias categorías y fotos reales (P-008). Sin commit.

## 2026-11-14 — Cobro «Procesar Pago» estilo Farmacia y vueltos (CASO-004)

**Contexto:** el dueño comparó el cobro de PC con el de Farmacia y pidió auditoría, plan y ejecución fase a fase.
**Cambios:** resumen único y botón COBRAR junto al total; «Completar» y atajos de 44 px; vuelto en opciones de un toque con «Sugerido» ($ en billetes + resto en Bs) y reparto automático; confirmación del vuelto siempre; F9/Enter cobran; `redondeoUsd`; Esc ya no cierra el cobro; Bs con 2 decimales; Biopago de fábrica; referencia de pago por método (de fábrica en «No»); teclado numérico táctil; `index.jsx` partido en `parts/`. Detalle y archivos en el caso.
**Casos y errores:** CASO-004, ERR-009 a ERR-012.
**Verificación:** pruebas del cobro 157 de 157; batería completa 2296 pasan, 3 fallan (licencias, ya fallaban antes); navegador `tests/e2e/cobro-pos.e2e.spec.js` 17 de 17 a 1366×768 y 1024×768. No verificado: laptop táctil real, impresora térmica y PDF con referencia, cuadre con ventas reales.

## 2026-11-14 — Verificación de punta a punta del flujo de clientes (billetera, abonos, deudas)

**Contexto:** después de cambiar el cobro y los vueltos (CASO-004) se revisó todo el flujo de clientes: fiado total y parcial, abonos ($, Bs, mixto, mayor que la deuda), vuelto a la billetera, compras con saldo a favor, anulaciones, cambio de tasa, centavos, «Recalcular deudas» y cierre.
**Cambios:** recibo con «Vuelto a su billetera» (ERR-013); Vender ya no muestra el saldo viejo del cliente tras cobrar (ERR-014, `useSalesData.js`); el resumen del cierre cuenta el vuelto a billetera como saldo generado (ERR-015, `closeDaySummary.js`).
**Pruebas nuevas:** `tests/clientesBilleteraFlujo.test.js` (6) y `tests/e2e/clientes-billetera.e2e.spec.js` (3).
**Verificación:** pruebas de cartera, caja y cierre 320 de 320; e2e nuevo 3 de 3; recorrido a mano en el navegador a 1366×768 con datos de prueba. Informe: [docs/reports/2026-11-14-verificacion-clientes-e2e.md](docs/reports/2026-11-14-verificacion-clientes-e2e.md).

## 2026-11-14 — Clientes F1: «Reparar cartera» con datos frescos (ERR-016)

**Plan:** `PLAN-FIXEO-CLIENTES-BILLETERA.md`, fase F1.
**Cambios:** `rebuildAllCustomersFromLedger()` en `customerWalletService.js` (lee dentro de `pos_write_lock`, solo toca descuadrados); `ReportsView.jsx` la usa y, al anular, aplica `updatedCustomers`.
**Verificación:** `tests/ledgerRepairFresh.test.js` 5/5; e2e «Reconstruir…» pasa; pruebas de cartera y reportes 90/90. La e2e «cartera desviada…» falla también sin este cambio (Reportes tarda más de 15 s en la primera carga en frío): queda para F2.

## 2026-11-14 — Clientes F2: pruebas e2e antiguas de clientes otra vez en verde

**Plan:** `PLAN-FIXEO-CLIENTES-BILLETERA.md`, fase F2.
**Cambios (solo pruebas):** `tests/e2e/helpers/auditHarness.js` toma el botón visible del menú (`navTab`; `[data-tour="tab-*"]` existe en la barra lateral y en la inferior). `reportes-fiado`: espera de Reportes a 45 s (en frío tardaba más de 15 s) y montos de proveedor que salen dos veces con `.first()`. `auditoria-flujos` F12b: el botón del cobro POS se llama «COBRAR $5.00» desde CASO-004 (solo esa línea; los cambios de F8 de otra sesión no se incluyeron).
**Verificación:** F3, F3b, F12, F12b, F13, `reportes-fiado` (3) y `clientes-billetera` (3) pasan.

## 2026-11-14 — Clientes F3: la confirmación de anular dice cómo queda la cuenta del cliente

**Plan:** `PLAN-FIXEO-CLIENTES-BILLETERA.md`, fase F3 (decisión D4: anular se permite, con aviso).
**Cambios:** `buildVoidReversalMovements` exportada desde `voidSaleProcessor.js` (misma regla para anular y para la vista previa); `src/utils/voidImpact.js` (impacto y texto); `src/hooks/useVoidImpact.js` (lee cliente y ledger frescos); `ConfirmModal.jsx` acepta `details` (líneas destacadas, ámbar si empiezan con «⚠»); Inicio y Reportes las muestran al anular. Ej.: «Cuenta de María: al día → debe $5.00» y «⚠ El cliente quedará debiendo $5.00 (Bs 200,00): ya usó el saldo a favor que le dio esta venta».
**Verificación:** `tests/voidImpact.test.js` 6/6 (la vista previa coincide con la anulación real); e2e `clientes-billetera` 4/4 (nueva: anular desde Inicio una venta pagada con saldo); pruebas de anulación y cartera 51/51.

## 2026-11-14 — Clientes F4: el cierre separa lo pagado con saldo a favor

**Plan:** `PLAN-FIXEO-CLIENTES-BILLETERA.md`, fase F4.
**Cambios:** `closeDaySummary.js` calcula `saldoFavorUsadoUsd` y, si es mayor que 0, agrega bajo «Cobrado» las filas «De eso, pagado con saldo a favor» y «Entró hoy a caja y bancos» (columna izquierda del PDF carta; etiquetas cortas para el ticket de 58 mm) y cambia la ayuda de «Cobrado». `dailyCloseGenerator.js`: la nota bajo el resumen lo aclara. Sin pagos con saldo, el cierre queda igual que antes.
**Verificación:** pruebas de cierre, motor y reportes pasan (3 nuevas en `closeDaySummary.test.js`, con medidas de PDF y ticket); PDF de muestra generado en el navegador y revisado: cobrado $14 → con saldo $4 → entró a caja $10.

## 2026-11-14 — Clientes F5: abono mixto ($ + Bs) en una sola ventana

**Plan:** `PLAN-FIXEO-CLIENTES-BILLETERA.md`, fase F5 (decisión D2).
**Cambios:** `customerTransactionProcessor.js` acepta `payments` (varias partes) y arma siempre el abono desde sus partes: un solo `COBRO_DEUDA` con un pago por moneda y un solo movimiento `ABONO_DEUDA` por el total en $. `TransactionModal.jsx`: pestaña «$ y Bs» (solo en «Recibir Abono») con un campo y un método por moneda, total en $ y aviso de sobrante. `CustomersView.jsx` pasa los pagos. `receivablesReport.js` guarda `methodIds` y Reportes muestra «Efectivo $ + Pago Móvil» en el detalle de cobranzas.
**Verificación:** 4 pruebas nuevas en `clientesBilleteraFlujo.test.js` (mixto, sobrante, un solo campo, vacío); e2e «Abono mixto…» pasa con captura revisada; unitarias de cartera/cierre/motor 146/146; e2e de clientes y reportes 8/8 (una pasó al reintento: carga en frío de Reportes con otras sesiones usando el mismo servidor).

## 2026-11-14 — Clientes F6: reportes y cierre dicen cuánto del fiado cubrió el saldo a favor

**Plan:** `PLAN-FIXEO-CLIENTES-BILLETERA.md`, fase F6 (decisión D1: el fiado se sigue contando entero; se muestra aparte lo cubierto).
**Cambios:** `receivablesReport.js` calcula por fiado `cubiertoConFavorUsd` con la foto `walletSnapshot.favorAntes` (menos lo pagado con saldo en la misma venta; Cashea y ventas viejas = 0) y el total `fiadoCubiertoConFavorUsd`; la vista agrega la sub-fila «De eso, cubierto con saldo a favor». Reportes e Inicio la muestran con sangría. `closeDaySummary.js`: la misma fila bajo «Fiado a clientes» en el PDF y el ticket.
**Verificación:** pruebas nuevas en `clientesBilleteraFlujo.test.js` (3), `closeDaySummary.test.js` (2) y `receivablesReport.test.js` (1); 102/102 de cartera, cierre y reportes; e2e «Fiado a un cliente con saldo a favor…» pasa con captura revisada.

## 2026-11-14 — Documentos del Escritorio pasados al repo

**Contexto:** varias sesiones dejaron auditorías, planes, propuestas y un mockup de Bodega sueltos en el Escritorio, fuera del repo. El dueño pidió tenerlos todos dentro del proyecto, ordenados según la ley de documentación.
**Cambios:** movidos (no copiados) 13 archivos: 6 auditorías a `docs/auditorias/` (Ajustes, apertura de caja, cobro y vueltos, documentación de Farmacia, nómina de Donde Juancho, Vender); 3 planes a `docs/plans/` (`2026-11-13-plan-vender-bodega-alinear-con-farmacia.md`, `2026-11-14-plan-cobro-bodega-alinear-con-farmacia.md`, `2026-11-13-plan-preciosaldia-multicaja.md`); 2 informes a `docs/reports/` (`2026-11-13-reporte-cliente-dos-sedes-v2.md`, `2026-11-14-verificacion-clientes-e2e.md`); la propuesta de logos sin internet a `docs/propuestas/` y el mockup del aviso de actualización a `docs/mockups/` (carpetas nuevas, registradas en `docs/LEY-DOCUMENTACION.md`). Enlaces arreglados en esta bitácora, CASO-001 a CASO-004, `PLAN-FIXEO-CLIENTES-BILLETERA.md`, `docs/plans/2026-11-14-plan-logos-offline.md` y dentro de los documentos movidos. Quedan en el Escritorio, a propósito: `REPORTE-CLIENTE-DOS-SEDES.md` (versión 1, recomendaba Listo POS Lite; la reemplaza la v2), `propuesta.html` (de Synaptica, otro proyecto) y la carpeta de capturas de logos.
**Casos y errores:** ninguno.
**Verificación:** `bun run docs:check`: sin enlaces rotos; sus únicos avisos (ERR-012 sin fila en la tabla y módulos por revisar) vienen de cambios de otras sesiones. Sin cambios de código, así que no se corrió ESLint.

## 2026-11-14 — Clientes F7: la pantalla del cliente explica mejor su cuenta

**Plan:** `PLAN-FIXEO-CLIENTES-BILLETERA.md`, fase F7 (decisión D3: la cuenta sigue en dólares; los Bs son referencia a la tasa del día).
**Cambios:** `src/utils/customerBalanceText.js` (nuevo): texto del saldo («Debe $5.00 · Bs 200,00» en rojo / «Favor $3.00 · Bs 120,00» en verde) y notas del historial («Pagó con su saldo a favor», «Pagó $2.00 · fió $3.00», «El fiado lo cubrió su saldo a favor»). `CheckoutCustomerPicker.jsx` usa ese texto en el cobro. `useCheckoutPosChange.js`: «Billetera: elige cliente» sin cliente abre el selector de cliente además del aviso (toca el selector que se ve: hay uno para PC y otro para pantalla angosta). `TransactionModal.jsx`: «Ajustar Cuenta» con título y botón fijos y el centro desplazable (a 1366×768 ya no se corta), aviso «La deuda es de $X. En bolívares cambia con la tasa del día» y «Pagar Total» en Bs muestra también los dólares. `CustomersView.jsx` muestra las notas en el historial. `receivablesReport.js` exporta `fiadoCoveredByCredit`.
**Simplificado del plan:** el aviso «cuando se fió eran Bs 400» no se hizo (la deuda puede venir de varios fiados con tasas distintas); el historial se basa en las ventas, no en los movimientos del ledger, así que los nombres van como notas de cada venta.
**Verificación:** `customerBalanceText.test.js` 7/7; cartera y reportes 74/74; e2e `clientes-billetera` 7/7 (nueva a 900 px para el selector de pantalla angosta), capturas revisadas: selector con el saldo en Bs, historial con «Pagó $2.00 · fió $3.00», abono «$ y Bs» entero a 1366×768.

## 2026-11-14 — Plan de «Nómina simple» para Bodega

**Contexto:** el dueño pidió el plan para añadir la nómina, partiendo del estudio de Donde Juancho pero corregida (sin sus errores E1–E3) y adaptada a Bodega.
**Cambios:** nuevo `docs/plans/2026-11-14-plan-nomina-simple-bodega.md`, con fases F0–F4 del núcleo y F6–F7 opcionales. Decisiones del dueño D1–D8: la frecuencia la elige cada empleado; el sueldo va en $ y se paga en $ o Bs con la tasa de la tienda; los consumos de mercancía quedan para después; los adelantos los da solo el Administrador; solo se anula lo del turno abierto; no se paga más que el saldo sin confirmar (la diferencia se arrastra al periodo siguiente); nada en el Supervisor por ahora; bono y descuento manuales por defecto. Sin cambios de código.
**Casos y errores:** ninguno todavía. El caso se abre al empezar F0.
**Verificación:** no aplica (solo documento).

## 2026-11-14 — Nómina simple en «Gestión» (fases F0 a F4)

**Contexto:** el dueño pidió ejecutar el plan de nómina fase a fase. A mitad del trabajo decidió (D9) que la nómina va en la pestaña «Clientes», que pasa a llamarse «Gestión». También decidió que la tasa en Bs no se edita, que el recibo sale en ticket y en PDF y que los gastos viejos de «Personal» se dejan como están.
**Cambios:** F0 «Gastos internos» con candado, lectura fresca, redondeo, actor, caja abierta para efectivo y confirmación al guardar (`utils/gastoInterno.js`, `services/gastosInternosService.js`, `hooks/useGastosInternos.js`). F1 modelo puro (`utils/payrollModel.js`). F2 servicio con PIN, idempotencia, anular sin movimiento al revés y recuperación tras un corte (`services/payrollService.js`), más las claves en `config/backupKeys.js`. F3 pestaña «Gestión» (`App.jsx`, `MiniNav.jsx`, `CommandPalette.jsx`, `OnboardingOverlay.jsx`), sub-pestañas `components/Gestion/GestionTabs.jsx`, pantalla `components/Payroll/*`, recibo `utils/payrollReceipt.js` y la categoría «Nómina» en Reportes y en el cierre. F4 e2e `tests/e2e/nomina.e2e.spec.js`. Ajuste al plan: el pago por pago móvil se guarda con `afectaCaja: true`, como todo gasto, para que salga en el cierre (el método decide si toca la gaveta). Detalle en CASO-005.
**Casos y errores:** CASO-005. Sin errores nuevos de la app. P-010 (prueba en el equipo real), P-011 (3 pruebas de licencias que ya fallaban, ajenas a este trabajo) y P-012 (fases opcionales F6 y F7).
**Verificación:** Vitest de nómina y gastos 45/45 (`gastosInternosService` 9, `payrollModel` 19, `payrollService` 14, `payrollUi` 3). E2E `nomina` 2/2, con capturas revisadas. Suite completa: 2393 pasan y 3 fallan, las de licencias de P-011. ESLint sin errores en los archivos tocados. No verificado: impresora térmica real ni PDF en el celular.

## 2026-11-14 — Plan de multicaja por red local (LAN), anotado como pendiente

**Contexto:** el dueño preguntó qué faltaba para tener multicaja por LAN, si se podía hacer como PWA, qué cambiaba para los usuarios actuales y si seguía el Modo Supervisor. Pidió dejar el plan escrito como pendiente.
**Cambios:** nuevo `docs/plans/2026-11-14-plan-multicaja-lan.md` (fases F0–F7, barandas L1–L8, decisiones P-L1 a P-L7). Nueva entrada P-013 en `PENDIENTES.md`. Sin cambios de código.
**Decisiones del dueño:** ninguna todavía. Propuestas en el plan: cajas en la app de escritorio o Android (no PWA pura, por las restricciones del navegador con la red local), LAN para cobrar + nube para respaldo y Supervisor, y mismo repo con interruptor.
**Casos y errores:** ninguno. El caso se abre al empezar F0.
**Verificación:** no aplica (solo documento).

## 2026-11-14 — Nómina: listas desplegables con bordes redondeados

**Contexto:** el dueño pidió que el menú de «Se le paga» tenga bordes redondeados. Un `<select>` nativo no lo permite: su menú lo dibuja el sistema.
**Cambios:** «Se le paga» (`Payroll/EmployeeFormModal.jsx`) y «Forma de pago» (`Payroll/PayrollEntryModal.jsx`) usan el `CustomSelect` de la app. `CustomSelect.jsx` acepta un `testId` opcional (no cambia nada para quien no lo pasa). La e2e `nomina` abre la lista y toca la opción.
**Casos y errores:** CASO-005.
**Verificación:** e2e `nomina` 2/2, con capturas revisadas de las dos listas abiertas. ESLint sin errores.

## 2026-11-15 — Licencias: la caja corta una licencia borrada o vencida, y la política se iguala con la Estación (P-011)

**Contexto:** el dueño pidió resolver P-011, las 3 pruebas de licencias que llevaban días en rojo. No eran pruebas rotas: señalaban dos problemas reales.
**Cambios:** `src/hooks/useLicenseMonitoring.js`: si la fila de licencia ya no existe (se borró en la Estación), la caja quita el acceso tras 3 consultas seguidas (`MISSING_LICENSE_LIMIT`, ~6 min con el latido de 3 min). Solo cuenta como «borrada» cuando el RPC `get_license_status` (SECURITY DEFINER) y el SELECT responden sin error y vacíos; sin red no se quita nada. Además, una permanente con vencimiento ya pasado se corta, como dice `licensePolicy.js`. `src/config/licensePolicy.js`: se trae la copia de la Estación Maestra (`139e33c`, 31-10), igual a la de Farmacia: precio de Farmacia ($300 / $20) y gracia mensual configurable. Para Bodega no cambia nada (no pasa `graceDays` y sus precios son los mismos). `tests/licensePolicy.test.js`: nuevo SHA anclado y precio de Farmacia.
**Casos y errores:** P-011 pasa a Hechos.
**Verificación:** suite completa 2401 pasan, 1 falla y 16 omitidas. La que falla es la comparación con los checkouts vecinos: el worktree `pad-egress-realtime` aún tiene la copia vieja de la política, y se igualará al unir `fix/egress-realtime`. ESLint 0 errores (los avisos ya estaban). No verificado en una caja real con una licencia borrada.

## 2026-11-15 — Revisión de licencias y migraciones para cerrar la lectura pública (P-018)

**Contexto:** el dueño pidió buscar licencias revocadas o eliminadas sospechosas y, con su permiso, se leyó la base en vivo en solo lectura (Management API, cada consulta en una transacción `read only`).
**Hallazgos:** no se borró ninguna licencia desde el 22-10 (respaldo local comparado con 555 filas vivas); las 9 desactivaciones de pago desde entonces son pruebas del dueño; las 11 permanentes activas tienen el código normal y su fila en `cloud_licenses`; no hay duplicados ni intentos fallidos de entrar a la Estación. Lo grave es de seguridad: `licenses` y `backup_requests` son legibles con la clave pública, y `backup_requests` además se puede borrar. También se vio que `20261106_backup_identity_seed_and_monthly.sql` no está aplicada (P-019) y que `verify_activation_code` no compara el código, solo mira `cloud_licenses`.
**Cambios:** nuevas `supabase/migrations/20261115_licenses_cerrar_lectura_publica.sql` y `20261115_backup_requests_solo_propias.sql` (sin aplicar), con su reversión en el encabezado. Nueva prueba `tests/licenseRlsMigrationsSql.test.js`. Entradas P-018 y P-019 en `PENDIENTES.md`.
**Verificación:** `licenseRlsMigrationsSql` 7/7. El SQL no se probó contra una base: aplicarlo y verificar en una caja real es P-018.

## 2026-11-15 — Seguridad: aplicadas en producción las migraciones de licenses y backup_requests (P-018)

**Qué:** con el visto bueno del dueño se aplicaron `20261115_backup_requests_solo_propias.sql` y `20261115_licenses_cerrar_lectura_publica.sql` (Management API).
**Después:** `backup_requests` queda con `backup_requests_admin_write`, `backup_requests_own_select` y `backup_requests_own_update`; `licenses` solo con `licenses_own_device_read`.
**Prueba con la clave pública (anon):** leer `licenses` → `[]`; leer `backup_requests` → `[]`; un borrado no afecta filas; `get_license_status` de Bodega (1 argumento) y de Farmacia (2 argumentos) devuelven la permanente activa; `verify_activation_code` → `true`; equipo inexistente → `[]`. Filas intactas: 555 licencias y 43 solicitudes.
**Falta:** ver en una caja real que abre premium y que un «Solicitar respaldo» de la Estación se completa.

## 2026-11-15 — Documentación: planes y reportes de la raíz pasan a docs/ (P-006)

**Cambios:** 26 archivos movidos con `git mv`, sin cambiarles el nombre (el código y las pruebas los citan por nombre): 20 `PLAN-*`, `REBRAND-PLAN` y `HANDOFF-PLAN-CLIENTES-BILLETERA` a `docs/plans/`; `REPORTE-*`, `M5-*` y `CASO-DESCUADRE-*` a `docs/reports/`. 60 enlaces corregidos con un script (los que apuntaban a estos archivos y los internos que partían de la raíz), más 2 menciones «(raíz)» en `docs/ERRORES.md` y 1 en `AGENT.md`.
**Verificación:** revisión de todos los enlaces de los `.md` del repo antes y después: ningún enlace roto nuevo (quedan 13 rotos de antes, contra 25). Sin cambios de código.

## 2026-11-15 — Nómina F6: mercancía que se lleva el empleado (P-012)

**Decisiones del dueño:** el precio es una opción de Ajustes (costo o venta, de fábrica costo); pide PIN; F7 (resumen en el Supervisor) espera a que se publique `fix/egress-realtime`.
**Cambios:** movimiento `MERCANCIA` en `utils/payrollModel.js` (`evaluateGoods`, `readGoodsValuation`, `goodsSummary`; resta del saldo y arrastra la deuda si se pasa). `registerGoods` en `services/payrollService.js` (stock + retiro de inventario sin tocar la gaveta + renglón, con vuelta atrás), y `voidEntry`/`recoverPayroll` devuelven el stock. Nueva tarjeta Ajustes › Negocio › Nómina y nueva pantalla `PayrollGoodsModal.jsx`; recibo con los productos. Clave `payroll_goods_valuation` en `LS_KEYS`. Detalle en CASO-005 § F6.
**Verificación:** Vitest `payrollGoods` (nuevo) y nómina completa 101/101; Playwright `nomina.e2e.spec.js` 3/3 con capturas revisadas. ESLint sin errores. No verificado: impresora térmica real (P-010).

## 2026-11-15 — Respaldos: se recupera del stash la parte de la caja de la migración del 06-11 (P-019)

**Contexto:** el dueño pidió preparar P-019. La migración `20261106_backup_identity_seed_and_monthly.sql` sigue **sin aplicar** y su parte de la caja solo existía en `git stash@{0}`.
**Cambios (traídos tal cual del stash; ninguno de los 4 archivos había cambiado desde el 08-11):** `utils/deviceIdentity.js` siembra la prueba de posesión con `claim_device_session` después de un vínculo comprobado, una vez por carga y sin romper el registro si falla; con el esquema actual la RPC responde `ALREADY_BOUND` y no guarda nada, así que es seguro publicarlo antes de la migración. `services/cloudBackupUpload.js`: si la caja no tiene identidad en la nube, intenta el relay de la Estación en vez de rendirse en silencio. `hooks/useAutoBackup.js`: el respaldo programado guarda su último resultado (`bodega_last_backup_attempt`) y registra los fallos, y el oyente de solicitudes de la Estación se vuelve a montar cuando llega la licencia (antes solo dependía de `deviceId` y nunca se montaba). No se trajo `useLicenseMonitoring.js` (resuelto en P-011) ni las 3 capturas e2e del stash. El stash se conserva.
**Migración revisada:** es la `claim_device_session` de `20261017` más la siembra (`coalesce`, nunca pisa una llave existente) y `has_permanent_backup_license` de `20261015` más la mensualidad con 5 días de gracia. Mismos permisos. Antes de aplicarla, comprobar en vivo que las dos funciones siguen iguales a esas versiones.
**Verificación:** 3 pruebas nuevas en `deviceIdentity` (siembra, una sola vez por carga, reintento si falla) y 2 en `cloudBackupUpload` (relay). Suite completa: 2446 pasan, 16 omitidas y 1 falla ya conocida (`licensePolicy` contra el worktree `pad-egress-realtime`). ESLint 0 errores. No verificado en una caja real ni contra la base.

## 2026-11-15 — Respaldos: aplicada en producción la migración del 06-11 (P-019)

**Qué:** con el permiso del dueño se aplicó `20261106_backup_identity_seed_and_monthly.sql` (Management API).
**Antes:** `claim_device_session` y `has_permanent_backup_license` en vivo eran idénticas a `20261017` y `20261015` (comparado el texto completo), así que no se pisó ningún cambio hecho a mano. 254 filas en `device_sessions`, ninguna con `possession_hash`; 11 permanentes activas y 2 mensualidades, ambas inactivas.
**Después:** `claim_device_session` siembra la llave (`coalesce`) y `has_permanent_backup_license` acepta la mensualidad con 5 días de gracia; las dos siguen como SECURITY DEFINER y con los mismos permisos. Las 11 permanentes activas siguen con derecho a respaldo.
**Falta:** publicar la app con `c116813` para que las cajas empiecen a sembrar la llave (hasta entonces nadie la guarda), ver en una caja real que `device_sessions.possession_hash` se llena, y liberar a mano las cajas que ya perdieron la sesión.

## 2026-11-15 — Versión 2.0.6 con aviso de novedades

**Contexto:** el dueño pidió publicar en `main` con el aviso de novedades y aprobó el texto.
**Cambios:** versión 2.0.6 en `package.json` y nota en `src/data/releaseNotes.js` (Pantalla nueva, Vender y cobrar más fácil, Nómina de tus empleados, IVA en tus tickets). Las cajas que vienen de 2.0.5 nunca guardaron `pda_last_seen_version` (el aviso con notas no estaba en `main`), así que el aviso nuevo se habría quedado callado: `versionDesdeNovedades` toma 2.0.5 como «lo último visto» si la caja ya aceptó los términos (`pda_terms_accepted`); una instalación nueva no ve el aviso. `LockScreen` mostraba «v2.0.5» escrito a mano; ahora lee `VITE_APP_VERSION`. Capturas del cobro (360/390/430) regeneradas por la revisión previa al push con la ventana de pago actual.
**Cómo se ve en la caja:** primero la barra verde vieja «Nueva versión disponible» (código de 2.0.5, no se puede cambiar); al reiniciar, y después de la pantalla de inicio, la ventana «¡Ya tienes lo nuevo!» una sola vez.
**Verificación:** `releaseNotes` 8/8 y `lockScreenBento`. En el navegador (servidor local): caja en uso sin versión vista → sale la ventana tras entrar; «Entendido» guarda 2.0.6 y no se repite; instalación nueva → no sale; la pantalla de inicio dice v2.0.6.
## 2026-11-14 — Egress F0: script de medición de egress y línea base

**Plan:** `docs/plans/2026-11-14-plan-fixeo-egress-realtime.md`, fase F0. Origen: el 11-nov Realtime gastó 388 MB (88 % del egress del día).
**Cambios:** `scripts/egress-report.mjs` (nuevo) consulta la API de administración de Supabase y muestra, por día, cuánto suben las cajas a `sync_documents` (separado por tamaño, como clasificar paquetes en chicos, medianos y grandes), los GET, las conexiones de Realtime y los docs vivos más pesados. Con `--check` sale con código 1 si se pasa un límite (base de la alarma de F6). La lógica pura vive en `scripts/egressReportCore.mjs`. El token se lee del `.env` antes que de la variable del sistema, porque en esta PC la variable tiene un token viejo que la API rechaza.
**Línea base:** `docs/reports/2026-11-14-baseline-egress-realtime.md`: 161–206 MB subidos por día, 341–450 subidas diarias de 300–500 KB (el audit log), POST de hasta 405 KB y 209–438 conexiones de Realtime por día.
**Verificación:** `tests/egressReportCore.test.js` 6/6; corrida real contra producción del 10 al 14-nov.

## 2026-11-14 — Egress F1 y F2: el audit log y las ventas de hoy se publican en pedazos chicos

**Plan:** `docs/plans/2026-11-14-plan-fixeo-egress-realtime.md`, fases F1 y F2 (un solo commit porque las dos tocan `useCloudSync.js`).
**Problema:** el 13-nov la caja subió 450 veces un audit log de ~407 KB (81 % de todo lo subido) y cada venta reescribía el último tramo de ventas del mes, que crece hasta 400 KB. Realtime reenvía cada subida entera a cada supervisor conectado: el 11-nov fueron 388 MB.
**F1 (audit log):** `src/utils/auditSyncFamily.js` (nuevo) parte la copia publicada en franjas de 2 horas (`abasto_audit_log_v1:2026-11-14T14`, como cajones por hora) y solo publica los últimos 7 días (decisión D1). Una acción nueva solo reescribe la franja en curso (≤ ~70 KB en la caja más activa). El push sale como mucho una vez por minuto con el valor más nuevo (D2): es una ventana fija, porque un debounce que se reinicia nunca publicaba con ventas seguidas. El supervisor reemplaza la franja entera (así un borrado del log se propaga) y recorta su copia a 7 días; la caja solo une y nunca pierde su historial fiscal. Una vez al día la caja borra de la nube el doc viejo de 407 KB y las franjas vencidas (la política de borrado ya estaba aplicada en producción). Al restaurar un respaldo también se publica por franjas.
**Cambio de diseño:** el plan decía «doc por día + tramos de 60 KB». Se cambió a franjas fijas porque con tramos el lector no puede saber qué se borró; se pasó de 4 h a 2 h porque con 4 h una franja llegaba a 141 KB.
**F2 (ventas):** las ventas de hoy (UTC) van en tramos propios de ≤ 100 KB y los tramos cerrados siguen de 400 KB. No se bajó todo a 80 KB como decía el plan: serían ~170 filas por mes y por caja, y el barrido de 90 s del supervisor baja los metadatos de todas en cada pasada. Al cambiar de día las ventas de ayer se reacomodan una vez y los tramos sobrantes se **borran** (no se tumban con `[]`, que en el lector vaciaría el mes entero).
**Compatibilidad:** un supervisor sin actualizar deja de recibir el audit log nuevo (rechaza las franjas por contrato) hasta que se actualice; ventas y lo demás siguen igual.
**Verificación:** `auditSyncFamily.test.js` 10/10, `cloudSyncAuditProjection.test.js` 6/6 (reescrita al contrato nuevo), `cloudSyncSalesOpenTail.test.js` 3/3, pruebas de tramos de ventas existentes 23/23 + 1 omitida; suites de sync/supervisor/monitor/backup 1026/1027 (la que falló era por finales de línea mezclados en una edición intermedia; corrida sola pasa 9/9). No verificado aún en navegador ni en producción.

## 2026-11-14 — Egress F5: fuera los canales de Realtime que nunca recibían nada

**Plan:** `docs/plans/2026-11-14-plan-fixeo-egress-realtime.md`, fase F5 (decisión D4).
**Problema:** tres canales de Realtime escuchaban tablas que no están en la publicación `supabase_realtime` (como tener un radio sintonizado en una emisora que no transmite): `licenses` en `useLicenseMonitoring.js` y `DevicesManager.jsx`, y `backup_requests` en `useAutoBackup.js`. Ocupaban conexiones sin recibir nada, y el respaldo pedido desde el supervisor esperaba al polling de 5 min aunque el código decía que Realtime era el camino principal.
**Cambios:** migración `supabase/migrations/20261114_realtime_backup_requests.sql` (agrega `backup_requests` a la publicación; idempotente; 43 filas en total, sin egress apreciable). `licenses` no se agrega a propósito, porque el heartbeat la actualiza cada 3 min y cada cambio sería egress: se quitaron sus dos canales. La licencia se verifica en cada heartbeat y al volver a la pestaña; la lista de equipos se refresca al volver a la pestaña.
**Hallazgo de seguridad (no corregido aquí):** `backup_requests` tiene políticas de lectura y borrado `USING (true)` para `anon`: cualquiera con la clave pública puede ver y borrar solicitudes de cualquier equipo. Queda propuesto aparte.
**Verificación:** `tests/realtimePublicationGuardrails.test.js` 3/3 (toda tabla escuchada en el código está en la publicación según los `.sql` del repo). **La migración no está aplicada en producción**: falta el visto bueno del dueño.

## 2026-11-14 — Egress F3 y F4: el supervisor recibe avisos, no documentos, y suelta Realtime con la pestaña oculta

**Plan:** `docs/plans/2026-11-14-plan-fixeo-egress-realtime.md`, fases F3 y F4 (un solo commit porque las dos tocan `useMonitorSync.js`).
**Problema:** Realtime reenviaba la fila completa de `sync_documents` (hasta ~400 KB) a cada pestaña o navegador del supervisor, en cada escritura, aunque la pestaña estuviera oculta. Es como mandar el paquete entero a cada casa en vez de una nota de «llegó tu paquete, pásalo a buscar cuando estés».
**F4:** migración `supabase/migrations/20261114_sync_document_events.sql`: tabla `sync_document_events` (una fila por doc con equipo, fecha y tamaño, ~150 B) que llena un trigger en cada escritura de `sync_documents`, con RLS igual a la del supervisor y agregada a la publicación. `useMonitorSync.js` escucha solo esos avisos, junta la ráfaga 2 s y baja por PostgREST solo los docs avisados (sin consulta de metadatos). Con la pestaña oculta no baja nada; baja una vez al volver (decisión D3). Si la tabla no existe, sigue en el modo anterior. `sync_documents` sigue en la publicación para los supervisores sin actualizar.
**F3:** una pestaña oculta más de 2 min suelta su conexión de Realtime (sin marcar error ni reintentar) y al volver hace pull incremental y abre canal nuevo. El panel de diagnóstico muestra el modo («Avisos» o «Filas completas») y las caídas del canal con su motivo.
**Cambios de diseño respecto al plan:** sin pestaña «líder» (riesgo de vistas que no refrescan) y sin despliegue en dos pasos (no hace falta, porque el supervisor nuevo deja de escuchar `sync_documents`).
**Pruebas:** `monitorSyncNotifyEvents.test.jsx` 6/6 (nueva: ráfaga → una descarga, fuera de contrato ignorado, oculta → nada hasta volver, suelta a los 2 min y se reconecta, modo anterior sin la tabla). `supervisorSyncEcho.test.jsx` sigue probando el modo de filas completas (su Supabase falso dice que la tabla de avisos no existe). Diagnóstico 22/22, guardias de publicación 4/4, suites de monitor 48/48.
**Pendiente:** aplicar la migración en producción **antes** de publicar la app (falta el visto bueno del dueño) y verificar en navegador.

## 2026-11-14 — Egress F6: alarma diaria en GitHub e informe semanal de Claude

**Plan:** `docs/plans/2026-11-14-plan-fixeo-egress-realtime.md`, fase F6 (decisión del dueño: dos avisos con papeles distintos).
**Alarma (`.github/workflows/egress-alarm.yml`, nuevo):** todos los días a las 11:00 UTC (7:00 en Venezuela) corre `scripts/egress-report.mjs --check --redact`. Si todo está bien no hace nada; si se pasa un límite, abre un issue con la etiqueta `egress-alarm` (GitHub manda el correo) o comenta el que ya esté abierto. Es como una alarma de humo: solo suena si hay humo.
**Límites:** subida diaria > 40 MB, POST > 150 KB, doc vivo > 450 KB, más de 150 conexiones de Realtime al día. El de doc se subió de 200 a 450 KB porque los tramos cerrados de ventas miden 400 KB por diseño y casi nunca se reescriben.
**Repo público:** el reporte del issue va con `--redact` (nuevo), sin identificadores de equipos.
**Informe semanal:** tarea programada de Claude «Informe semanal de egress (Supabase)», lunes 8:00, solo lectura. Compara la semana contra la línea base y las metas del plan.
**Falta (solo el dueño):** guardar el secreto `SUPABASE_ACCESS_TOKEN` en GitHub (Settings → Secrets and variables → Actions). GitHub solo ejecuta los horarios del workflow que está en `main`; hasta que llegue a `main`, corre solo a mano.
**Verificación:** `egressReportCore.test.js` 7/7; YAML válido; corrida local de `--check --redact` contra producción: sale con código 1 (todavía no hay nada publicado) y el reporte no tiene ningún `PDA-V2`. El workflow no se corrió en GitHub (falta el secreto).

## 2026-11-14 — fix(docs-check): el verificador aceptaba «Resuelto (mitigado)» en la ficha pero no en la tabla

**Problema:** `docs-check` avisaba «ERR-012: falta en la tabla resumen de ERRORES.md», pero la fila sí estaba. La regla de la tabla solo aceptaba una palabra sola en la columna de estado, y ERR-012 dice «Resuelto (mitigado)». La de la sección sí lo aceptaba porque lee solo la primera palabra. Además, como no veía la fila, tampoco comparaba su estado con el de la sección.
**Cambio:** `scripts/docs-check.mjs` acepta una nota entre paréntesis después del estado en la tabla y compara solo la primera palabra, igual que con la sección. Se conserva el «mitigado», que es honesto: el cajero todavía puede elegir «Todo en $» con centavos (el dueño decidió avisar, no bloquear).
**Verificación:** prueba nueva en `tests/docsCheck.test.js` (acepta la nota y sigue detectando un estado distinto aunque lleve nota): 21/21. `docs-check` sobre el repo ya no muestra ERR-012. El arreglo de ERR-012 sigue en pie: `tests/cobroSugerido.test.js` 11/11.

## 2026-11-15 — Egress: migraciones aplicadas en producción

**Qué:** con el visto bueno del dueño se aplicaron `supabase/migrations/20261114_realtime_backup_requests.sql` y `supabase/migrations/20261114_sync_document_events.sql` (Management API, `database/query`).
**Antes:** la publicación tenía `device_pairings`, `supervisor_commands` y `sync_documents`; 481 docs.
**Después:** se suman `backup_requests` y `sync_document_events`. 481 avisos (uno por doc), 0 desfasados, trigger `sync_documents_emit_event` activo, RLS activa, `authenticated` solo SELECT, `anon` sin permisos.
**Prueba del trigger:** un bloque `DO` movió 1 s la fecha del doc más reciente, leyó el aviso (coincidía) y lanzó un error a propósito para deshacer todo. La fecha real quedó igual. Como se deshizo, Realtime no repartió nada.
**Efecto hoy:** ninguno visible todavía. Las cajas y supervisores publicados no usan la tabla de avisos; el ahorro empieza al publicar la rama `fix/egress-realtime`.
**Dato al margen:** los avisos más pesados son `bodega_products_v1` viejos (hasta 583 KB, de julio y octubre) de equipos que ya no escriben. No generan egress mientras nadie los reescriba.

## 2026-11-15 — Plan definitivo de la versión en la nube (P-021)

**Contexto:** el dueño aclaró que la versión nueva debe dejar entrar a la cuenta desde cualquier equipo y trabajar ahí, como Fina Partner, y que debe seguir recibiendo los arreglos de Precios al Día actual.
**Cambios:** nuevo [docs/plans/2026-11-15-plan-definitivo-precios-al-dia-nube.md](docs/plans/2026-11-15-plan-definitivo-precios-al-dia-nube.md). Los planes de multicaja del 13-11 (nube) y del 14-11 (red local) quedan marcados como reemplazados. En `PENDIENTES.md`, P-013 pasa a Descartado y se agrega P-021. Solo documentación; no cambia código.
**Decisiones del dueño:** D1 nube; D2 seguir recibiendo arreglos de Precios al Día. D3–D9 quedan propuestas y por confirmar.
**Verificación:** `bun run docs:check` sin enlaces rotos; solo avisa de ERR-012, que falta en la tabla de `ERRORES.md` y no es de este cambio.
