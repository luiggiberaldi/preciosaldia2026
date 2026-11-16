# Plan de fixeo: egress de Realtime (Supabase)

Fecha: 14-11-2026 · Rama: `feat/inicio-estilo-farmacia` (abrir rama propia `fix/egress-realtime` antes de F1)
Proyecto Supabase: `sodgzkablshladvbtnes`
Antecedentes: [REPORTE-CAUSA-RAIZ-EGRESS-Y-SOLUCION.md](../reports/REPORTE-CAUSA-RAIZ-EGRESS-Y-SOLUCION.md) (egress de PostgREST, oct-2026) y
[2026-10-15-plan-optimizacion-egress.md](2026-10-15-plan-optimizacion-egress.md). Ese trabajo atacó PostgREST; **este plan ataca Realtime**, que hoy es el 88 % del egress en los días pico.

**Documento ejecutable.** Cada fase es un commit aparte, se prueba sola y se puede revertir sin tocar las demás.

---

## §0. Diagnóstico medido (14-11-2026)

### Qué pasó el 11 nov

| Servicio | 11 nov | Comentario |
|---|---|---|
| Realtime | **388,6 MB (88 %)** | ≈ 2,2 × lo subido ese día: cada fila llegó a ~2 clientes |
| PostgREST | 52,6 MB (11,9 %) | 519 GET a `sync_documents` (reconexiones del supervisor) |
| Auth + Storage | < 1 MB | sin importancia |

- Lo que suben los POS a `sync_documents` es **estable**: 161 MB (10 nov), 176 MB (11), 168 MB (12), 206 MB (13), 174 MB (14); entre 730 y 920 POST/día.
- Realtime cobra **cada entrega a cada suscriptor**. Los días con barras bajas no hubo supervisor escuchando todo el día; el 11 nov hubo dos navegadores en Valencia (Chrome 140 y Chrome 157), con 254 conexiones de websocket y reconexiones frecuentes.
- La publicación `supabase_realtime` solo tiene `sync_documents` (15.269 updates acumulados), `supervisor_commands` y `device_pairings`. Las dos últimas son livianas.

### Qué ocupa el volumen (POST a `sync_documents` del 13 nov, por tamaño)

| Tamaño del POST | Cantidad | Bytes | % | Qué es |
|---|---|---|---|---|
| 300–500 KB | 450 | 167,3 MB | **81 %** | `abasto_audit_log_v1` (407 KB de JSON) reescrito completo, más algún tramo de ventas casi lleno |
| 70–300 KB | 127 | 24,4 MB | 12 % | tramo abierto de ventas `bodega_sales_v1:AAAA-MM#N` |
| 20–70 KB | 327 | 13,9 MB | 7 % | buckets `bodega_products_v1:bXX` |
| < 20 KB | 12 | 0,1 MB | 0 % | resto |

### Causas en el código

1. **Audit log entero en cada acción.** `projectSyncPayload` ([useCloudSync.js:772](../../src/hooks/useCloudSync.js)) publica las últimas 1.200 entradas (~407 KB de JSON) cada vez que cambia el log. Un cobro dispara varios `logEvent`; el debounce de 3 s los junta en **un push de 407 KB por venta**.
2. **Tramo abierto de ventas de hasta 400 KB.** `SALES_SYNC_PACK_BUDGET_BYTES = 400_000` ([useCloudSync.js:101](../../src/hooks/useCloudSync.js)): cada venta reescribe el último tramo del mes, que crece hasta 400 KB (promedio ~200 KB por venta). Una venta pesa ~1,6 KB de JSON.
3. **Realtime manda la fila completa.** El canal del supervisor ([useMonitorSync.js:372](../../src/hooks/useMonitorSync.js)) escucha `postgres_changes` sobre `sync_documents`: cada escritura llega con todo `data` a cada pestaña o navegador conectado, **aunque la pestaña esté oculta**, y sin agrupar ráfagas.
4. **Varias conexiones por supervisor.** Dos navegadores y reconexiones frecuentes duplican las entregas, y cada reconexión dispara un pull (los 519 GET).
5. **Suscripciones muertas.** `licenses` ([useLicenseMonitoring.js:162](../../src/hooks/useLicenseMonitoring.js), [DevicesManager.jsx:45](../../src/components/Settings/DevicesManager.jsx)) y `backup_requests` ([useAutoBackup.js:313](../../src/hooks/useAutoBackup.js)) **no están en la publicación**: esos canales nunca reciben nada. El respaldo remoto funciona solo por el polling de 5 min, aunque el código dice que Realtime es «el camino primario».

Lo que **ya está bien y no se toca**: el cobro y la anulación no republican productos (`skipSyncPush`, plan de stock-delta); el barrido conectado está a 90 s y se pausa con la pestaña oculta; las reconexiones hacen pull incremental (`full: false`).

### Meta

| Métrica | Hoy (11 nov) | Meta tras F1–F3 | Meta tras F4–F5 |
|---|---|---|---|
| Subida diaria a `sync_documents` | ~176 MB | **< 25 MB** | < 25 MB |
| Realtime con 2 supervisores conectados todo el día | ~389 MB | **< 50 MB** | **< 10 MB** |
| PostgREST del supervisor | ~53 MB | ~53 MB | < 30 MB |

---

## §1. Decisiones del dueño (el plan toma la opción conservadora)

| ID | Pregunta | Decisión tomada | Si se elige lo contrario |
|---|---|---|---|
| D1 | ¿Cuánto audit log ve el supervisor? | **Los últimos 7 días**, partidos por día. El historial completo sigue en el equipo y en los respaldos. | Ver 30 días: más filas en la nube y más carga inicial, pero el costo por acción no cambia. |
| D2 | ¿Qué retraso aceptable tiene el audit log en el supervisor? | **Hasta 60 s** (debounce propio). Las ventas y el stock siguen en ~3 s. | Dejarlo en 3 s: F1 ahorra un poco menos (más pushes del tramo del día). |
| D3 | ¿El supervisor sigue en vivo con la pestaña oculta? | **No.** Oculto solo marca «hay cambios» y descarga al volver a la pestaña. Los avisos de comandos siguen llegando. | Mantenerlo en vivo oculto: F4 ahorra menos. |
| D4 | `licenses` y `backup_requests` en Realtime | **`backup_requests` sí** se agrega a la publicación (filas chicas y raras). **`licenses` no** (el heartbeat la actualiza seguido); se quitan sus canales y queda el polling. | Agregar `licenses`: cada heartbeat se volvería egress de Realtime. |

---

## Resumen de fases

| Fase | Qué | Ahorro estimado | Riesgo | Depende de |
|---|---|---|---|---|
| F0 | Script de medición repetible | — (permite medir) | Nulo | — |
| F1 | Audit log por día + debounce de 60 s | **~75–80 % de lo subido** | Medio | F0 |
| F2 | Tramo abierto de ventas más chico | ~10 % | Bajo | F0 |
| F3 | Un solo canal por navegador + menos reconexiones | ÷2 en días con varias pestañas | Bajo | — |
| F4 | Realtime solo avisa; los datos van por PostgREST, agrupados y solo con la pestaña visible | Realtime ≈ 0; PostgREST ≈ lo necesario | Medio-alto | F1, F2 |
| F5 | Limpiar suscripciones muertas (D4) | — (correctitud) | Bajo | — |
| F6 | Alerta diaria de egress | — (prevención) | Nulo | F0 |

Orden recomendado: **F0 → F1 → F2 → F5 → F3 → F4 → F6**. F1 sola ya baja el pico del 11 nov de ~389 MB a menos de 80 MB.

---

## F0 — Script de medición repetible

**Para qué:** que cada fase se valide con números reales y no con estimaciones.

1. Nuevo `scripts/egress-report.mjs` (Node, sin dependencias). Lee `SUPABASE_ACCESS_TOKEN` del `.env` (nunca lo imprime) y consulta la Management API:
   - `GET /v1/projects/{ref}/analytics/endpoints/logs` (el endpoint `logs.all` ya no existe) con estas consultas, por día:
     - POST a `/rest/v1/sync_documents`: cantidad y bytes (`log_attributes['request.headers.content_length']`), agrupados por rango de tamaño (<20 KB, 20–70, 70–300, 300–500, >500).
     - GET a `/rest/v1/sync_documents`: cantidad.
     - Conexiones a `/realtime/%` por ciudad y user agent.
   - `POST /v1/projects/{ref}/database/query`: los 15 `doc_id` más pesados (`octet_length(data::text)`) y las tablas de `supabase_realtime`.
   - Respetar el `ThrottlerException`: una consulta a la vez, con 2 s entre consultas.
2. Salida: tabla en consola y `docs/reports/egress/AAAA-MM-DD.json` (agregar `docs/reports/egress/` a `.gitignore` si no se quiere versionar).
3. Correr una vez y guardar la **línea base** en `docs/reports/2026-11-14-baseline-egress-realtime.md`.

**Hecho cuando:** `node scripts/egress-report.mjs --from 2026-11-10 --to 2026-11-14` reproduce las tablas del §0.

---

## F1 — Audit log partido por franjas de 2 horas (la causa del 81 %) ✅ HECHO

**Problema:** el audit log se sube entero (~407 KB) en cada venta.

> **Cambio de diseño al implementar (14-11-2026):** en vez de «doc por día + tramos por tamaño» se usan **franjas fijas de 2 h** (`abasto_audit_log_v1:AAAA-MM-DDTHH`, HH par, UTC). Cada doc es la franja completa y **reemplaza** la suya en el supervisor (como las compras por mes), así un borrado del log se propaga sin la ambigüedad de los tramos `#N`. Con 4 h una caja muy activa llegaba a 141 KB por franja; con 2 h queda en ≤ ~70 KB. El «debounce de 60 s» es en realidad una **ventana fija** de 60 s: con ventas seguidas un debounce que se reinicia nunca llegaba a publicar.
> Lo implementado está en `src/utils/auditSyncFamily.js` y `pushAuditFamilySync` (`useCloudSync.js`). Los pasos de abajo son el diseño original, que se conserva como referencia.

**Diseño original:** el mismo patrón que la familia de ventas, pero por día y con retención (D1).
- Doc por día: `abasto_audit_log_v1:AAAA-MM-DD`. Si un día pasa de **60 KB**, se parte en tramos `#2`, `#3`… (mismo empaquetado que las ventas).
- Solo se publican los días de la ventana de 7 días (D1) cuyo hash cambió. En la operación normal **solo cambia el tramo de hoy**: ~30 KB promedio por push en lugar de 407 KB.
- Debounce propio de 60 s para `abasto_audit_log_v1` (D2), fuera de `HEAVY_KEYS`.
- El doc viejo `abasto_audit_log_v1` (sin sufijo) se **retira** una sola vez por equipo, igual que `retireLegacySalesDoc` (borrado confirmado, reintento a 24 h). La política de borrado ya existe y **está aplicada en producción** (`device_delete_own_sync_doc`, verificado el 14-11-2026).
- Los días que salen de la ventana de 7 días se borran de la nube (mismo mecanismo de retiro, por lotes y como mucho una vez al día).

**Pasos:**
1. `src/hooks/useCloudSync.js`:
   - Extraer del empaquetado de ventas una función genérica `buildPeriodShardPlan(records, { periodOf, compare, budgetBytes, baseKey })` y usarla en `buildSalesSyncPlan` **sin cambiar su salida** (las pruebas actuales de shards deben seguir pasando igual).
   - `AUDIT_SYNC_BASE_KEY`, `AUDIT_SYNC_WINDOW_DAYS = 7`, `AUDIT_SYNC_PACK_BUDGET_BYTES = 60_000`, `isAuditSyncDocId(docId)`.
   - `pushAuditFamilySync(value, …)`: filtra a la ventana, arma el plan, publica solo los tramos con hash distinto, retira el legacy y los días vencidos. Conectarla en `pushCloudSync` como se hace con ventas y productos.
   - `_debouncePush`: 60 s para el audit log.
   - `projectSyncPayload` deja de recortar a 1.200 (la ventana de días la reemplaza). `AUDIT_SYNC_MAX_ENTRIES` se queda solo como tope de seguridad por tramo.
2. Lector: `mergeAuditSyncDoc(localLog, docId, payload)` con la misma semántica que `mergeSalesSyncDoc`: unión por `id`, lo entrante gana, `[]` limpia **solo ese día**, y el doc legacy se une sin pisar. Mantener el orden «más reciente primero» después del merge.
   - Cablearlo en `useMonitorSync.js` (donde hoy se decide `isSalesFamily` / `isProductsFamily`, ~línea 176) y en el filtro del pull incremental (~línea 500).
   - `supervisorContracts.js:62`: validar también los docs `abasto_audit_log_v1:*`.
3. Confirmar que las entradas del audit log tienen `id` estable. Si no lo tienen, generar uno determinista al publicar (por ejemplo `ts + cat + action + hash corto de desc`) y documentarlo.
4. `useCloudBackup` (inyección al restaurar respaldos): publicar el audit log por días, no el doc entero (lo mismo que se hizo con las ventas en oct).
5. Pruebas nuevas:
   - `tests/cloudSyncAuditFamily.test.js`: un evento nuevo solo republica el tramo de hoy; un día de 200 KB sale en 4 tramos ≤ 60 KB; los días fuera de la ventana no se publican; el legacy se retira una vez; `[]` limpia solo su día.
   - Ajustar `tests/cloudSyncAuditProjection.test.js` al nuevo contrato.
   - `tests/monitorSyncAuditMerge.test.js`: el supervisor arma el log de 7 días a partir de tramos que llegan desordenados.
6. Verificación en navegador: POS + supervisor locales; registrar 10 ventas y confirmar en el visor de auditoría del supervisor que aparecen (máximo 60 s de retraso) y que el payload de cada POST del audit log es < 60 KB (pestaña Network).

**Hecho cuando:** las pruebas pasan y, con F0, un día normal muestra **0 POST de 300–500 KB** del audit log y la subida diaria baja de ~170 MB a < 40 MB.

---

## F2 — Tramo abierto de ventas más chico ✅ HECHO

> **Cambio de diseño al implementar (14-11-2026):** no se bajó todo a 80 KB. Serían ~170 filas por mes y por caja (285 ventas/día de ~1,6 KB), y el barrido de 90 s del supervisor baja los metadatos de todas las filas en cada pasada: lo ahorrado en Realtime se perdería en PostgREST. En su lugar, **solo las ventas de hoy (UTC)** van en tramos propios de ≤ 100 KB; los tramos cerrados siguen en 400 KB. Al cambiar de día las ventas de ayer se reacomodan una vez y los tramos sobrantes se **borran** (no `[]`, que vaciaría el mes en el lector). `SALES_SYNC_OPEN_PACK_BUDGET_BYTES` y `deleteStaleSalesShards` en `useCloudSync.js`.


**Problema:** cada venta reescribe el último tramo del mes, que llega a 400 KB.

1. `SALES_SYNC_PACK_BUDGET_BYTES`: de 400_000 a **80_000** (~50 ventas por tramo). Una venta pasa a subir ~40 KB promedio en lugar de ~200 KB.
2. Efecto único al desplegar: el mes en curso se reparte de nuevo (pasa de ~16 a ~75 tramos) y se republica **una vez** (~6 MB por equipo activo). Hacerlo en horario sin ventas o aceptarlo como costo único.
   - Los ids de tramo son posicionales (`#N`). Con un presupuesto menor salen **más** tramos, así que todos los ids viejos se sobrescriben y no quedan tramos fantasma. Agregar una prueba que lo garantice.
3. Revisar que el pull del supervisor no tenga `.limit()` que corte con más filas (hoy hay 481 filas en total; con esto serían ~60 más por equipo y por mes). La consulta de metadatos (`collection, doc_id, updated_at`) es liviana.
4. Considerar índice si el plan de consulta lo pide: `sync_documents (device_id, doc_id)` ya cubre el upsert; verificar con `EXPLAIN` antes de crear nada (Task 8 del plan de oct).
5. Pruebas: ajustar `tests/*salesSync*` al nuevo presupuesto; nueva prueba de «la venta 51 abre tramo nuevo y solo publica ese tramo».

**Hecho cuando:** con F0, los POST de 70–300 KB desaparecen casi del todo y los de ventas quedan en < 80 KB.

---

## F3 — Un solo canal por navegador y menos reconexiones ✅ HECHO (con otro enfoque)

> **Cambio de diseño al implementar (14-11-2026):** en vez de una pestaña «líder» con `navigator.locks` (con riesgo de que las otras pestañas dejen de refrescar sus vistas, porque los avisos `app_storage_update` no cruzan pestañas), **una pestaña oculta más de 2 minutos suelta su conexión de Realtime** y al volver se reconecta con un pull incremental. Ataca lo mismo: pestañas abiertas que reciben todo sin que nadie mire. El motivo de cada caída del canal queda en el panel de diagnóstico («Caídas del canal»), para entender las 254 reconexiones del 11-nov. El aviso de «supervisor abierto en otro equipo» no se hizo (queda pendiente).


**Problema:** dos pestañas o navegadores = el doble de entregas, y cada reconexión hace un pull.

1. **Líder por navegador:** con `navigator.locks.request('pda-monitor-realtime', …)` (o `BroadcastChannel` como respaldo), solo una pestaña abre el canal de `sync_documents`. Las demás reciben los cambios aplicados por el evento `app_storage_update`, que ya existe, y por el almacenamiento compartido (localforage). Si la pestaña líder se cierra, otra toma el lock.
2. **Aviso de sesión duplicada:** si `device_sessions` / `heartbeat_device` muestra el mismo supervisor activo en otro navegador, mostrar un aviso discreto («Este supervisor está abierto en otro equipo; ciérralo para ahorrar datos»). No bloquear.
3. **Reconexiones:** registrar en `recordDiagnostics` el motivo de cada cierre del canal (`CLOSED` / `CHANNEL_ERROR` / `TIMED_OUT`) y revisar con `realtime_logs` del 11 nov por qué hubo 254 conexiones. Si la causa es el `SUBSCRIBE_TIMEOUT_MS` o el token que vence, ajustarlo ahí mismo.
4. Pruebas: `tests/monitorRealtimeLeader.test.js` (dos «pestañas» simuladas → un solo `channel()`; al soltar el lock, la otra se suscribe).

**Hecho cuando:** con dos pestañas del supervisor abiertas, el panel de Supabase muestra **una** conexión de Realtime por navegador, y las conexiones diarias por supervisor bajan de cientos a decenas.

---

## F4 — Realtime solo avisa; los datos viajan por PostgREST (cambio de fondo) ✅ CÓDIGO HECHO · migración sin aplicar

> **Cambio de diseño al implementar (14-11-2026):** no hace falta el despliegue en dos pasos. El supervisor nuevo **deja de escuchar** `sync_documents` y escucha solo `sync_document_events`; Realtime solo cobra a quien está suscrito, así que el ahorro llega en cuanto cada supervisor se actualiza, mientras los viejos siguen funcionando igual. Quitar `sync_documents` de la publicación queda como paso opcional, cuando no quede ningún supervisor viejo. Si la tabla de avisos no existe (migración sin aplicar), el supervisor detecta el error y sigue en el modo anterior. El trigger no avisa borrados (con RLS, Realtime no filtra los DELETE y repartiría la clave a todos).
> **Orden de despliegue:** primero aplicar `supabase/migrations/20261114_sync_document_events.sql`, después publicar la app.


**Problema:** Realtime manda la fila completa a cada cliente, en cada escritura, aunque la pestaña esté oculta y aunque llegue otra versión 2 s después.

**Diseño:**
- Nueva tabla liviana `public.sync_document_events (device_id text, doc_id text, collection text, updated_at timestamptz, bytes int, primary key (device_id, doc_id))`. La llena un trigger `AFTER INSERT OR UPDATE OR DELETE` sobre `sync_documents` (upsert de una fila por doc; ~150 bytes).
- RLS de lectura igual a la de `sync_documents` (el mismo par POS ↔ supervisor puede ver).
- La publicación `supabase_realtime` **pasa a tener `sync_document_events` y deja de tener `sync_documents`**.
- El supervisor escucha `sync_document_events` filtrado por `device_id`. Cada aviso agrega el `doc_id` a un conjunto «pendiente». Un temporizador de **2 s** junta la ráfaga y descarga solo esos `doc_id` con el pull incremental que ya existe (`select collection, doc_id, data, updated_at … in (doc_ids)`).
- Con la pestaña oculta (D3) no se descarga nada: se acumulan los `doc_id` y se descargan al volver. Los comandos (`supervisor_commands`) no cambian.
- Con esto **desaparece el problema del 413** (evento sin cuerpo con docs > 1 MB) y el pull de respaldo `pull-413` deja de ser necesario.

**Pasos:**
1. Migración `supabase/migrations/2026111X_sync_document_events.sql`: tabla, índice, RLS, trigger y cambio de publicación. Guardrails en `tests/supervisorSqlGuardrails.test.js` (la tabla nueva tiene RLS; `sync_documents` ya no está en la publicación).
2. **Despliegue en dos pasos, para no dejar supervisores ciegos:**
   1. Migración que **agrega** `sync_document_events` a la publicación sin quitar `sync_documents`. Desplegar la app nueva, que escucha avisos.
   2. Cuando todos los supervisores tengan la versión nueva (ver `x_client_info` / versión en `device_sessions`), segunda migración que **quita** `sync_documents` de la publicación.
3. `useMonitorSync.js`: nuevo canal de avisos; cola `pendingDocIdsRef` con agrupado de 2 s; respeto de `document.visibilityState`; el canal viejo se mantiene detrás de un flag solo durante el paso 2.1.
4. Pruebas: `tests/monitorSyncEvents.test.js` (10 avisos del mismo doc en 2 s → 1 descarga; pestaña oculta → 0 descargas, al volver → 1; aviso de DELETE → tumba local).
5. Verificación en navegador con POS + supervisor locales: 20 ventas seguidas → el supervisor descarga a lo sumo 1 vez por doc cada 2 s; con la pestaña oculta, 0 descargas.

**Hecho cuando:** con F0, Realtime < 10 MB/día con supervisores conectados todo el día, y el egress de PostgREST del supervisor no supera lo que antes mandaba Realtime.

---

## F5 — Suscripciones muertas (D4)

1. Migración: `alter publication supabase_realtime add table public.backup_requests;` (confirmar antes que RLS impide ver solicitudes de otros equipos). Guardrail en `supervisorSqlGuardrails.test.js`.
2. `useLicenseMonitoring.js` y `DevicesManager.jsx`: quitar el canal de `licenses` (nunca recibió eventos) y dejar el refresco por polling o por foco de pantalla. Comentario que explique por qué `licenses` no va en Realtime.
3. Prueba: el POS recibe una `backup_request` en tiempo real en local (con la publicación aplicada) y el polling sigue de respaldo.

**Hecho cuando:** pedir un respaldo desde el supervisor lo dispara en segundos (no en 5 min) y no quedan `.channel()` sobre tablas fuera de la publicación. Agregar una prueba que compare la lista de tablas escuchadas en el código con la publicación.

---

## F6 — Alerta diaria de egress ✅ HECHO (falta el secreto en GitHub y llevar el workflow a `main`)

Decisión del dueño (14-11-2026): **dos avisos con papeles distintos**, que usan el mismo script de F0.

| Aviso | Dónde corre | Cuándo | Qué hace |
|---|---|---|---|
| **Alarma** | GitHub Actions (`.github/workflows/egress-alarm.yml`) | Todos los días, 11:00 UTC (7:00 Venezuela), aunque la PC esté apagada | **Solo si algo se pasa del límite** abre un *issue* `egress-alarm` en el repo (GitHub manda el correo). Si ya hay uno abierto, le agrega un comentario en lugar de abrir otro. Si todo está bien, no hace nada. |
| **Informe** | Tarea programada de Claude en esta PC | Lunes 8:00 | Corre el script con los últimos 7 días y explica la tendencia, qué doc creció y si cada fase sigue cumpliendo su meta. |

Límites de la alarma (`scripts/egress-report.mjs --check`, sale con código 1 si alguno se cumple):
- subida diaria a `sync_documents` > 40 MB;
- algún POST a `sync_documents` > 150 KB;
- algún doc vivo (actualizado en 7 días) de `sync_documents` > 450 KB (por encima del tramo cerrado de ventas de 400 KB, que casi nunca se reescribe; por debajo del límite de ~1 MB de Realtime);
- más de 150 conexiones de Realtime en el día (señal de reconexiones o pestañas duplicadas).

Nota: la API de logs no da el egress de Realtime en MB. Se vigilan sus dos factores: lo que se sube y cuántas conexiones lo reciben. La cifra exacta sigue estando en el panel de uso de Supabase.

Requisito manual (solo el dueño puede hacerlo): guardar el token como secreto del repo, `SUPABASE_ACCESS_TOKEN`, en GitHub → Settings → Secrets and variables → Actions. Si algún día se rota el token, hay que cambiarlo en el `.env` y en ese secreto.

**Hecho cuando:** el workflow corre a mano (`workflow_dispatch`) en verde, `--check` con límites bajados a propósito sale con código 1, y la tarea de Claude aparece en la lista de tareas programadas.

---

## Riesgos y cómo se cubren

| Riesgo | Mitigación |
|---|---|
| Supervisor con versión vieja deja de recibir ventas al quitar `sync_documents` de la publicación (F4) | Despliegue en dos pasos; el barrido de 90 s y la recuperación siguen trayendo los datos aunque no haya Realtime. |
| Audit log incompleto en el supervisor durante la migración a días (F1) | El lector une legacy + días; el legacy se borra solo después de publicar los días. |
| Republicación única del mes de ventas al bajar el presupuesto (F2) | ~6 MB por equipo, una vez; desplegar fuera del horario de ventas. |
| Entradas del audit log sin `id` (F1) | Paso 3 de F1: id determinista al publicar. |
| Throttling de la API de logs al medir (F0) | Una consulta a la vez, con espera. |

## Cómo verificar el plan completo

Correr `node scripts/egress-report.mjs` 3 días después de desplegar F1–F3 y 3 días después de F4, y comparar con la línea base de F0 contra la tabla de metas del §0.
