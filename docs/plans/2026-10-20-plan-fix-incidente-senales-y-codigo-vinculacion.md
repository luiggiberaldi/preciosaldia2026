# Plan de fixeo: incidente señales perdidas + código de vinculación expirado (2026-10-20)

> **Modo de ejecución:** una sola fase por interacción. Leer esta guía y solo los archivos de la fase actual. No anticipar fases, no inventar contratos ni modificar archivos fuera de la lista. Al terminar, reportar cambios, pruebas, resultado y bloqueos; esperar autorización para la siguiente fase.

## Contexto del incidente (evidencia)

El 2026-10-20 el Supervisor envió ~15 comandos entre 11:43 y 12:31 UTC y **ninguno llegó**: todos murieron con HTTP 400 "Ventana temporal inválida" (P0001) — la fila jamás se creó y la caja veía `count: 0`. En paralelo, la nube amaneció llena de `canceling statement due to statement timeout` (57014) sobre `sync_documents` (500/504), más `register_device_session` y `heartbeat_device` en 500, y el modal "Vincular supervisor" expiraba a los 30 s con "La operación tardó demasiado". Hubo además un rechazo puntual "Payload de ajuste por lote inválido" y confusión de identidad entre dos device IDs (`PDA-V2-D6F45E08E50D0996048FC4F10640776F` vs `PDA-V2-F5D31FEFD7FC6C7DBE6632438C6D760A`).

**Ya aplicado (fuera de este plan):** `supabase/migrations/20261020_supervisor_command_server_clock.sql` — la ventana temporal de `create_supervisor_command` se construye con `now()` del servidor y solo valida la duración pedida. La hora del dispositivo dejó de influir en el create (aplicada y verificada en producción el 2026-10-20).

**Lección central:** la app *sabía* que fallaba y el usuario vio "como si no enviara nada". Dos problemas estructurales quedan: (a) los fallos del servidor son invisibles en la UI, (b) el flujo de emisión del código de vinculación depende de una sincronización pesada dentro de un presupuesto de 30 s.

**Stack verificado en el repo:** JavaScript ESM, React, Supabase JS/PostgREST/Realtime, PostgreSQL (RPCs Supervisor), Vitest, React Testing Library, Vite. No instales paquetes ni toques lockfiles.

**No incluido:** desplegar apps, ejecutar SQL en producción sin aprobación explícita, commit/push, migrar storage a otra tecnología, cambios en la lógica de precios/ventas del POS.

## Por qué esto y no más

| Fase | Cambio | Impacto | Riesgo | Por qué ahora |
|---|---|---|---|---|
| 1 | Código de vinculación sin esperar la subida pesada | Alto | Bajo | Arregla de inmediato el error visible del incidente ("La operación tardó demasiado") |
| 2 | Ningún error del servidor en silencio | Alto | Bajo | La falla real del incidente fue invisible; sin esto, el próximo error vuelve a esconderse |
| 3 | Pantalla de Salud + desfase de reloj | Medio | Muy bajo | Este incidente se diagnosticó con logs copiados a mano; 10 s de pantalla lo habrían revelado |
| 4 | Adelgazar documentos de sincronización (4.5 MB) | Alto | Medio | La causa de los statement timeout que hoy degradan toda la nube |
| 5 | Contrato único de payload + códigos de error | Medio | Medio | Elimina la clase "Payload inválido" por desfase cliente/servidor y los mapeos por regex |
| 6 | Identidad visible + limpieza de `device_pairings` | Medio | Bajo | La confusión de IDs enturbió todo el diagnóstico |

**Fuente de verdad del contrato de lote:** `public.is_valid_supervisor_inventory_batch_payload` en `supabase/migrations/20261016_supervisor_inventory_batch_v2.sql` (acepta v1 plano sin `batchVersion` y v2 con `lines[]`). Cualquier paridad cliente debe copiar esa regla, no inventar otra.

**Fuera de alcance (backlog):** outbox persistente del sender, transporte alternativo, métricas remotas, migración de la base a otro esquema de documentos. **Recordatorio (pedido por el dueño tras la Fase 2):** unificar `supervisorCommandTracker` y `supervisorCommandDiagnostics` en un solo almacén de eventos de comando con suscripción, para eliminar la dependencia del tracker hacia el diagnóstico.

## Reglas obligatorias para cada fase

1. Confirma branch y `git status`; nunca descartes ni incluyas cambios previos de otros hilos (este checkout ya trae trabajo del 2026-10-14 en curso).
2. Relee los archivos de la fase antes de editar; los números de línea de este plan pueden haberse movido.
3. Antes de editar, resume el comportamiento actual, archivos que cambiarán y criterio de éxito. Si el repo contradice este plan, **detente y pregunta; no adivines**.
4. Trabaja solo en la fase autorizada. Nada de refactors ni "limpieza" colateral.
5. Añade primero la prueba que detecta el defecto, confirma que falla por la causa prevista, implementa el cambio mínimo y vuelve a correrla.
6. No debilites pruebas ni añadas supresiones de lint para pasar. Revisa el diff final.
7. **Ningún SQL se ejecuta en producción desde este plan.** Las migraciones solo se escriben como archivos; su aplicación requiere aprobación explícita aparte (como se hizo con `20261020_supervisor_command_server_clock.sql`).
8. Al cerrar una fase: handoff con archivos editados, comportamiento, comandos/resultados, riesgos y siguiente fase permitida.

## Criterios globales de aceptación

- **Ningún fallo del servidor invisible:** todo `ok: false` de `sendSupervisorCommand` y todo ACK `failed`/`rejected` termina en UI con el texto/código real del servidor.
- **El código de vinculación se emite en < 5 s** incluso con la base cargada; la sincronización pesada jamás bloquea su emisión.
- **Ningún documento de `sync_documents` supera ~500 KB** tras la Fase 4; los `statement timeout` desaparecen de los logs de Supabase.
- **Un solo contrato de payload:** la validación del cliente y `is_valid_supervisor_inventory_batch_payload` están unificadas por un test de paridad; los errores se mapean por código estable, no por regex sobre textos.
- **El desfase de reloj es visible en Ajustes** sin abrir consola.
- Suite del Supervisor (`bun run test:supervisor`) y `bunx eslint` en verde al cerrar cada fase.

---

## Fase 0 — Reconocimiento seguro (solo lectura)

**Objetivo:** confirmar el estado base y cerrar las dos incógnitas heredadas.

**Leer/buscar:** `src/services/supervisorPairingService.js` (`createPairingToken`, `watchPairing`), `src/components/security/QuickSupervisorPairingModal.jsx` (`handleGenerate`, `Promise.race` de 30 s), `src/hooks/useCloudSync.js` (`forceSyncAllPOSData`, `pushCloudSync`, `withSyncRetry`, `SYNC_KEYS`, `HEAVY_KEYS`), `src/services/supervisorCommandDiagnostics.js`, `tests/supervisorPairing.test.js`, `tests/QuickSupervisorPairingModal.test.jsx`.

**Acciones:** `git status --short`, rama actual, correr los tests nombrados y confirmar verdes. Verificar en la nube (solo SELECT) el estado de `device_pairings` para los IDs del incidente. No modificar nada.

**Incógnitas que este plan NO cierra (reportar como gate):**
- Prueba de humo pendiente: una señal real de punta a punta tras la migración del reloj (si falla con otro error, ese es el próximo objetivo).
- `PDA-V2-D6F45E08E50D0996048FC4F10640776F` vs `PDA-V2-F5D31FEFD7FC6C7DBE6632438C6D760A`: ¿misma caja física o dos dispositivos? La Fase 6 lo previene; la respuesta del usuario lo resuelve.

**Salida/gate:** estado base, tests verdes, discrepancias, respuesta (o ausencia) de las incógnitas.

**Prompt:** "Ejecuta solo la Fase 0 de [este plan](docs/plans/2026-10-20-plan-fix-incidente-senales-y-codigo-vinculacion.md). Solo lectura; devuelve branch/status, tests base, estado de pairings y discrepancias."

## Fase 1 — El código de vinculación sin esperar el maletón

**Archivos permitidos:** `src/services/supervisorPairingService.js`, `src/components/security/QuickSupervisorPairingModal.jsx`, `tests/supervisorPairing.test.js`, `tests/QuickSupervisorPairingModal.test.jsx`.

**Cambio:** en `createPairingToken`, reordenar la cadena: (1) `ensureSession`, (2) `registerDeviceSession`, (3) RPC `generate_pairing_token` → devolver token **inmediatamente**; y (4) `syncBeforeIssue` (`forceSyncAllPOSData(..., allowBeforePairing=true)`) dispararlo **después** en segundo plano (`void syncBeforeIssue(...).catch(log)`), con reintento simple si falla. La justificación del snapshot pre-pairing ("el supervisor necesita los datos al escanear") se mantiene: el humano tarda más en escanear el QR de lo que tarda la subida en background. El `Promise.race` de 30 s del modal ya no debe alcanzar el caso normal; mantenerlo como red de seguridad y, si vence, mostrar el progreso real del paso que se quedó (ver Fase 2).

**Pruebas:** (a) el token se resuelve aunque `syncBeforeIssue` cuelgue (promesa que nunca termina) — el resultado incluye el token sin esperarla; (b) `syncBeforeIssue` se dispara igualmente (una sola vez) y su rechazo no rompe el flujo; (c) si `generate_pairing_token` falla (p. ej. "ya tiene un supervisor vinculado"), el error del servidor llega a la UI sin pasar por el timeout; (d) reintentar el botón "Intentar de nuevo" no dispara duplicados de `syncBeforeIssue` en ráfaga.

**Comando:** `bunx vitest run tests/supervisorPairing.test.js tests/QuickSupervisorPairingModal.test.jsx`.

**Gate:** si hoy `syncBeforeIssue` se ejecuta antes del RPC y la prueba (a) no detecta el bloqueo, detenerse.

**Prompt:** "Ejecuta solo la Fase 1 del plan. El código de vinculación se emite primero y la sincronización pesada corre después en background. No cambies el contrato del token ni el resto del modal."

## Fase 2 — Ningún error del servidor en silencio

**Archivos permitidos:** `src/views/OwnerMonitorView.jsx`, `src/components/Monitor/SupervisorInventoryBatchPanel.jsx`, `src/components/Monitor/SupervisorInventoryBatchModal.jsx`, `src/components/Monitor/RemoteProductFormModal.jsx`, `src/hooks/useSupervisorControl.js`, `src/services/supervisorCommandDiagnostics.js`, `src/components/Monitor/` (panel de diagnóstico existente), tests asociados.

**Cambio:** regla única: **toda** respuesta `ok: false` de `sendSupervisorCommand` y **todo** ACK `failed`/`rejected`/`cancelled` muestra un aviso con el `error`/`error_message` real del servidor (hoy algunos call-sites lo tragan o lo resumen genérico). Reusar `supervisorCommandDiagnostics.js` y su panel de diagnóstico ya existentes para exponer "último comando enviado: <tipo> → <estado> (<error>)" en la vista del Supervisor. Sin regex sobre textos: mostrar el texto crudo que llega. Log estructurado (`supervisorLog`) con `commandId`, `status`, `error` en cada fallo.

**Pruebas:** (a) un create que resuelve `{ ok: false, error: 'Ventana temporal inválida' }` produce aviso visible con ese texto exacto; (b) un ACK `failed` con `error_message` se muestra igualmente; (c) el estado "último comando" refleja el resultado aunque el usuario cierre y abra el panel; (d) ningún camino de error queda sin aviso (test que recorre los call-sites por mock).

**Comando:** `bunx vitest run tests/supervisorOutcomeNotices.test.jsx tests/supervisorCommandDiagnostics.test.js tests/supervisorCommandDiagnosticsPanel.test.jsx` (+ tests de los componentes tocados).

**Gate:** no continuar si existe algún `catch` que devuelva éxito o neutralice el error sin aviso.

**Prompt:** "Ejecuta solo la Fase 2 del plan. Que todo error del servidor sea visible en UI con su texto real, reusando el diagnóstico existente. No cambies la semántica de envío ni los estados del comando."

## Fase 3 — Pantalla de Salud del sistema + desfase de reloj

**Archivos permitidos:** `src/components/Settings/tabs/SettingsTabSistema.jsx` (o componente nuevo `src/components/Settings/` acotado), servicio nuevo mínimo de salud, tests nuevos.

**Cambio:** sección "Salud del sistema" en Ajustes con: (1) último comando Supervisor y su resultado (Fase 2), (2) última sincronización exitosa (`cloud_sync_ts` / hashes de `pushCloudSync`), (3) **desfase de reloj local vs servidor**: una petición REST ligera (p. ej. `HEAD`/`GET` al endpoint REST del proyecto) y comparar el header `Date` de la respuesta con `Date.now()` — sin RPC nueva ni migración. Mostrar semáforo: verde (<30 s), amarillo (30 s–2 min), rojo (>2 min: "sincroniza la hora de este equipo"). Botón "Revisar ahora".

**Pruebas:** (a) desfase simulado de 5 min muestra el estado rojo con el texto de acción; (b) sin red, la pantalla degrada a "sin datos" sin romperse; (c) el cálculo usa UTC y tolera la latencia de la petición (mediana de 2-3 lecturas).

**Comando:** `bunx vitest run <tests nuevos de salud>`.

**Gate:** no crear RPC ni tocar la base; todo cabe en una petición HTTP existente.

**Prompt:** "Ejecuta solo la Fase 3 del plan. Pantalla de Salud con desfase de reloj calculado del header Date, sin tocar la base."

## Fase 4 — Adelgazar la sincronización (documentos gigantes)

**Archivos permitidos:** `src/hooks/useCloudSync.js`, `src/hooks/useMonitorSync.js` (solo lectura de claves), `src/utils/storageService.js` si aplica, `supabase/migrations/` (un único archivo nuevo para índices/limpieza si hace falta), tests (`tests/cloudSyncEmptySnapshot.test.js` y nuevos).

**Cambio:** partir el documento monolítico `bodega_sales_v1` (4.5 MB) en documentos por periodo (`bodega_sales_v1:<YYYY-MM>` para los últimos N meses + `bodega_sales_v1:recent`), con merge en el lector (monitor y pull inicial) para presentar el historial completo como hoy. `bodega_products_v1` (1.4 MB): recortar campos redundantes antes de publicar (imágenes ya viven en Storage; no duplicar binarios/base64 en el doc). Revisar `HEAVY_KEYS`/debounce para que ningún upsert reescriba blobs completos en cada cambio. Migración SQL (solo archivo): índice `(device_id, collection, doc_id)` si falta y verificación de que el upsert `on_conflict` sigue siendo atómico.

**Pruebas:** (a) un mes con 10k ventas produce documentos < 500 KB; (b) el lector mergea periodos sin perder ventas (test de round-trip con datos reales muestrales); (c) la escritura incremental solo reescribe el periodo tocado; (d) compatibilidad: un documento viejo monolítico sigue leyéndose (migración perezosa al escribir).

**Comando:** `bunx vitest run tests/cloudSyncEmptySnapshot.test.js <tests nuevos de sync>` (+ suite del Supervisor completa como regresión).

**Gate:** medir antes/después: tamaño de los documentos y, en la nube, ausencia de `57014` en la ventana de prueba. Sin esa evidencia, la fase no se cierra.

**Prompt:** "Ejecuta solo la Fase 4 del plan. Parte bodega_sales_v1 por periodos con merge en el lector y compatibilidad con documentos legacy. No cambies la semántica de watermark ni el pull inicial."

## Fase 5 — Contrato único de payload + códigos de error estables

**Archivos permitidos:** `src/services/supervisorContracts.js`, `src/services/supervisorInventoryBatchSender.js`, `src/services/supervisorInventoryDraft.js`, `supabase/migrations/` (un único archivo nuevo), tests (`tests/supervisorInventoryBatchSender.test.js`, `tests/supervisorInventoryDraft.test.js`, `tests/supervisorSqlGuardrails.test.js` y test nuevo de paridad).

**Cambio:** dos piezas:
1. **Paridad de contrato:** módulo JS que replica exactamente las reglas de `public.is_valid_supervisor_inventory_batch_payload` (v1 plana y v2 `lines[]`), usado por el sender **antes** de enviar; test de paridad con casos golden compartidos (válidos e inválidos) entre el SQL y el JS.
2. **Códigos de error estables:** la RPC (migración, solo archivo) acompaña cada `RAISE` con un código predecible (p. ej. `USING ERRCODE` propio o sufijo `[WINDOW_INVALID]`, `[MONITOR_NOT_AUTHORIZED]`, `[PAYLOAD_INVALID]`, `[COMMAND_ID_REUSED]`); el cliente mapea código → mensaje de UI y **elimina los regex sobre textos** en `getPairingErrorMessage` y similares (mantener los textos actuales como fallback para versiones viejas del servidor).

**Pruebas:** (a) un lote con línea mal formada se rechaza en el cliente con mensaje claro, sin llamada al servidor; (b) los golden cases de paridad SQL↔JS pasan en ambos lados; (c) el mapeo código→mensaje funciona con códigos nuevos y cae al texto crudo con servidores viejos; (d) ningún test existente de sender se rompe.

**Comando:** `bunx vitest run tests/supervisorInventoryBatchSender.test.js tests/supervisorInventoryDraft.test.js tests/supervisorSqlGuardrails.test.js <test de paridad>`.

**Gate:** el test de paridad debe fallar si alguien cambia el SQL sin el JS (o viceversa). Sin ese candado, la fase no cierra.

**Prompt:** "Ejecuta solo la Fase 5 del plan. Paridad de contrato de lote con test golden y códigos de error estables con fallback a texto."

## Fase 6 — Identidad visible + limpieza de `device_pairings`

**Archivos permitidos:** `src/components/security/QuickSupervisorPairingModal.jsx`, `src/components/Settings/tabs/SettingsTabSistema.jsx`, `src/hooks/useSecurity.jsx` (solo lectura de identidad), `src/utils/deviceIdentity.js`, `supabase/migrations/` (un único archivo nuevo de limpieza), tests asociados.

**Cambio:** (1) mostrar el **ID completo** del dispositivo en el modal de vinculación y en Ajustes (hoy se trunca en logs y la confusión `D6F45E…` vs `F5D3…` costó horas de diagnóstico); (2) aviso explícito si el ID con el que la app consulta no coincide con el `primary_device_id` del vínculo que intenta usar (el toast `pairing_no_legible` ya existe como semilla); (3) migración (solo archivo): restricción de formato `primary_device_id ~ '^PDA(-V2)?-[0-9A-F]{8,64}$'` con exclusión para los IDs globales conocidos, y retiro documentado de filas basura (`'test'`, duplicadas) — **nada se borra sin confirmación explícita del dueño de los datos**.

**Pruebas:** (a) el modal muestra el ID completo y permite copiarlo; (b) el desfase de identidad dispara el aviso con ambos IDs a la vista; (c) la restricción de formato rechaza IDs basura nuevos sin romper los legítimos (test sobre el SQL con fixtures).

**Comando:** `bunx vitest run tests/QuickSupervisorPairingModal.test.jsx tests/supervisorPairing.test.js <tests de identidad>`.

**Gate:** la limpieza de filas queda como script separado y **no** se ejecuta dentro de la migración automática; requiere aprobación explícita.

**Prompt:** "Ejecuta solo la Fase 6 del plan. IDs completos en UI, aviso de desfase de identidad y migración de candados para device_pairings (sin borrar datos)."

---

## Criterios de aceptación final del plan

- Reproducir las tres fallas del incidente en QA queda imposible o explícito: (1) señal con reloj desfasado → llega (ya resuelto por la migración del reloj); (2) generación de código con base cargada → código en < 5 s; (3) lote mal formado → rechazo en el cliente con mensaje claro.
- Ningún error del servidor termina sin aviso visible en UI (verificado por test que recorre los call-sites).
- Los logs de Supabase de la ventana de prueba no contienen `57014` ni 500/504 de `sync_documents`; tamaño de documentos < 500 KB.
- `bun run test:supervisor` (51 archivos) y `bunx eslint` en verde tras cada fase; `bun run typecheck` en verde si la fase toca JS/JSX.
- Handoff final: estado de cada fase, migraciones escritas vs aplicadas (nada se aplica sin aprobación), evidencia de medición de la Fase 4 y respuesta a la incógnita de identidad.
