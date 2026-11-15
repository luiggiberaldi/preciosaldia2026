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
