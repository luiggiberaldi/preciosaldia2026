# Plan: "Confirma y sigue" y "El resultado siempre se avisa" (Propuestas 1 y 2)

**Fecha:** 2026-10-18
**Origen:** [Propuestas: confirmación de cambios y panel de Control](2026-10-18-plan-propuestas-control-supervisor.md) — solo las propuestas 1 y 2. Las propuestas 3–8 (panel Control, etiquetas, cola local, anulación, sello verificado, avisos de equipo) quedan para planes posteriores.
**Requiere migraciones SQL:** no. Todo es cliente (React/servicios) sobre el contrato existente de `supervisor_commands`.

> **Modo de ejecución para LLM:** ejecutar una sola fase por interacción. Revisar esta guía y los archivos de la fase actual. No anticipar fases, no inventar contratos ni modificar archivos fuera de la lista. Al terminar, reportar cambios, pruebas, resultado y bloqueos; esperar autorización para la siguiente fase.

## El plan en lenguaje llano

Al terminar, el supervisor verá esto:

1. **Al pulsar Aceptar / Eliminar / Guardar, el modal se cierra al instante** y aparece "Cambio enviado a la caja ✈️ — esperando confirmación". Nunca una pantalla congelada.
2. **Todo cambio termina en un aviso final:** verde "✅ La caja aplicó tu cambio" (siempre que sea éxito), rojo con el motivo en palabras si falló, o amarillo "Sigue esperando a la caja" si no hubo respuesta.
3. **Un cambio = un aviso.** Ni silencio ni duplicados.
4. **Si la orden ni siquiera pudo enviarse** (sin conexión, sin autorización), el modal **permanece abierto** con el error a la vista: ahí no se cerró nada porque nada se envió.

## Objetivo y límites

- **Objetivo 1 (Propuesta 1):** ningún modal del supervisor espera la confirmación de la caja para cerrarse; se cierra cuando la orden queda registrada.
- **Objetivo 2 (Propuesta 2):** todo comando enviado termina en un aviso visible de éxito, error con motivo, o "sigue esperando" — para **cualquier tipo de cambio** (productos, tasa, usuarios, turnos, inventario).
- **No incluido:** panel Control (propuesta 3), etiquetas por producto (4), cola local con mando (5), anulación (6), sello "aplicado y verificado" (7), avisos de otros supervisores (8). Desplegar, ejecutar SQL, hacer commit/push, añadir dependencias o modificar lockfiles tampoco.

**Stack verificado en el repo:** JavaScript ESM, React 19, Supabase JS/PostgREST/Realtime, Vitest + React Testing Library, Playwright, Vite, Tailwind. `package.json` declara `bun@1.1.0`; ejecutar los comandos indicados y no cambiar de gestor.

## Reglas obligatorias para cada fase

1. Confirmar branch y `git status`; nunca descartar ni sobrescribir cambios previos de otros hilos.
2. Releer los archivos de la fase; los números de línea de este plan pueden estar obsoletos.
3. Antes de editar, resumir en pocas líneas el comportamiento actual, archivos a cambiar y criterio de éxito. Si el repo contradice este plan o falta un archivo, **detenerse y preguntar; no adivinar**.
4. Solo la fase autorizada; sin refactors ni "limpieza" ajena.
5. Primero pruebas enfocadas que fallen por la causa prevista; luego el cambio mínimo; volver a correr.
6. No debilitar pruebas ni ocultar errores; revisar el diff final y comunicar qué se comprobó y qué no.
7. Sin migraciones remotas, despliegues, commits ni push.
8. Al cerrar cada fase: handoff con archivos editados, comportamiento cambiado, comandos/resultados y siguiente fase.

## Criterios globales de aceptación

- Ningún modal del supervisor hace `await` de la confirmación de la caja; se cierra al quedar la orden registrada.
- Todo comando enviado produce **exactamente un** aviso final: `applied` → verde (siempre), `applied_with_warnings` → ámbar con reservas, `rejected`/`failed` → rojo con motivo en palabras, `cancelled` → ámbar, sin confirmación → ámbar "Sigue esperando a la caja".
- El aviso de éxito nombra el cambio (qué producto/qué ajuste), no un genérico.
- Fallo de **envío** (la orden no se registró): modal abierto + error visible; el formulario no se pierde. Fallo de **aplicación** (la caja la rechazó): el modal ya está cerrado y el error llega como aviso.
- Los tipos sin espera de ACK también quedan cubiertos: el resultado se sigue por separado para que ningún cambio quede sin aviso.
- Pruebas del supervisor siguen pasando; las que afirmen el contrato viejo se actualizan al nuevo sin debilitar aserciones (y se explica por qué cambian).

---

## Fase 0 — Reconocimiento seguro (solo lectura)

**Objetivo:** confirmar contratos reales antes de tocar código.

**Leer/buscar:** `src/services/supervisorCommandService.js` (`sendSupervisorCommand`, `shouldAwaitSupervisorAck`, `waitForCommandAck`, `SUPERVISOR_TERMINAL_COMMAND_STATUSES`), los 6 sitios que esperan `ackPromise` (ver anexo), `src/components/Toast.jsx`, `src/services/supervisorStockMessages.js`, `src/services/supervisorCommandDiagnostics.js`, tests `supervisorCommands.test.js`, `supervisorAckLatency.perf.test.jsx`, `supervisorInventoryBatchSender.test.js`, `supervisorInventoryBatchPanel.test.jsx`, `supervisorSyncEcho.test.jsx`, `supervisorRemoteCommandsRecovery.test.jsx`.

**Acciones:** `git status --short`; listar los tipos que `shouldAwaitSupervisorAck` incluye hoy (los excluidos serán los que más se pierden sin aviso de resultado); anotar cómo cada modal muestra hoy el resultado (éxito/error/timeout).

**Salida/gate:** informar la lista exacta de tipos con/sin `ackPromise`, los 6 sitios confirmados y si los tests nombrados existen. Sin discrepancias sin resolver, no continuar.

**Prompt de fase:** "Ejecuta solo la Fase 0 de [este plan](docs/plans/2026-10-18-plan-propuestas-1-2-confirmar-y-resultado.md). Solo lectura; no edites. Devuelve branch/status, sitios de espera de ACK confirmados, tipos con/sin espera y tests existentes."

## Fase 1 — Núcleo: registro de cambios en vuelo y su resultado

**Archivos permitidos:** nuevo `src/services/supervisorCommandTracker.js`, nuevo `tests/supervisorCommandTracker.test.js`. Nada más.

**Cambio:** módulo único (sin dependencias de React) que registra cada comando enviado y garantiza el aviso final:

- API: `trackSupervisorCommand({ commandId, type, payload, sentAt })` → registra el comando en vuelo y **siempre** termina notificando por `showToast` de `src/components/Toast.jsx` exactamente una vez por `commandId` (guardar los `commandId` ya notificados para deduplicar).
- El seguimiento usa `awaitSupervisorCommandAck(commandId, …)` del propio `supervisorCommandService`, incluso cuando el envío no exija ACK (`ackPromise` puede ser `null`): el objetivo es que **ningún** cambio quede sin resultado, sea cual sea el tipo.
- Estados que debe distinguir: en vuelo → `applied` (verde), `applied_with_warnings` (ámbar, incluir reservas del `ack_payload`), `rejected`/`failed` (rojo, motivo en palabras desde `error_message`), `cancelled` (ámbar), `timeout` (ámbar "Sigue esperando a la caja" — NO es un cierre definitivo: si el ACK llega después, se avisa igualmente y manda el resultado real).
- Los mensajes se redactan en lenguaje llano y nombran el cambio (reutilizar `src/services/supervisorStockMessages.js` como referencia de estilo; ampliar ahí solo si hace falta, sin duplicar catálogos).
- También expone el estado en vuelo de cada comando (lista ligera) para que las fases siguientes lo muestren en badges; sin React, sin suscripciones globales nuevas.

**Pruebas (`tests/supervisorCommandTracker.test.js`):** por cada estado terminal, exactamente un aviso con el tipo (success/error/warning) y mensaje esperados; `timeout` avisa "sigue esperando" y si más tarde llega `applied`, se avisa el éxito (dedupe solo entre avisos finales del mismo comando, no entre "esperando" y "aplicado"); dos resultados para el mismo `commandId` → un solo aviso final; tipo sin `ackPromise` → también recibe su aviso final.

**Comando:** `npx vitest run tests/supervisorCommandTracker.test.js --pool=forks --maxWorkers=1`.

**Gate:** el test debe fallar antes de implementar y pasar después; no continuar si la deduplicación no está probada.

**Prompt:** "Ejecuta solo la Fase 1 del plan. Crea el tracker con sus pruebas (test primero), cubriendo todos los estados terminales, timeout no definitivo y deduplicación. No toques aún ningún modal."

## Fase 2 — Modales no bloqueantes ("confirma y seguir")

**Archivos permitidos:** `src/views/OwnerMonitorView.jsx`, `src/components/Monitor/RemoteProductFormModal.jsx`, `src/components/Monitor/SupervisorRateModal.jsx`, `src/components/Monitor/RemoteUsersManager.jsx`, `src/components/Monitor/SupervisorInventoryBatchModal.jsx`, `src/components/Monitor/SupervisorInventoryBatchPanel.jsx`, `src/services/supervisorInventoryBatchSender.js` (solo si hace falta desacoplar la espera de la UI), y los tests de componente afectados (`tests/supervisorInventoryBatchPanel.test.jsx`, `tests/ownerMonitorStockOpsWiring.test.jsx`, `tests/supervisorSyncEcho.test.jsx`, `tests/supervisorAckLatency.perf.test.jsx`, `tests/supervisorRemoteCommandsRecovery.test.jsx` y los que cada modal ya tenga).

**Cambio, por flujo (uno por uno, en este orden):**

1. **Crear/editar producto** (`RemoteProductFormModal`): al recibir `result.ok`, registrar con `trackSupervisorCommand`, mostrar "Cambio enviado a la caja ✈️ — esperando confirmación" (toast `info`), cerrar el modal y soltar el `await` del ACK. Si `result.ok` es falso: el modal sigue **abierto** con el error (`result.error`) y el formulario intacto.
2. **Eliminar producto** (`OwnerMonitorView.handleConfirmDeleteProductRemote`): mismo patrón; hoy hace `await result.ackPromise` y solo cierra si el ACK fue ok — ahora cierra al registrarse la orden y deja el resultado al tracker.
3. **Tasa** (`SupervisorRateModal`), **usuarios** (`RemoteUsersManager`): igual.
4. **Inventario por lote** (`SupervisorInventoryBatchModal`, `SupervisorInventoryBatchPanel`): la semántica interna de reintentos y `TIMEOUT_ACK` de `supervisorInventoryBatchSender` **no cambia**; solo se desacopla la espera de la interfaz: el modal se cierra al confirmarse el envío y el desenlace (aplicado/con reservas/fallido) lo notifica el tracker. Los avisos internos actuales del sender (p. ej. `BATCH_CONFIRMED`) se unifican al catálogo del tracker para no duplicar toasts.

Comportamiento común: el botón queda en estado "enviando" **solo hasta que la orden se registre**, no hasta que la caja confirme; el modal nunca se cierra si la orden no se registró.

**Pruebas:** por cada flujo, prueba de componente que resuelva el envío **sin** resolver `ackPromise` y afirme (a) el modal se cierra, (b) aparece el toast "esperando confirmación", (c) el formulario se limpió; y una prueba de envío fallido que afirme el modal **sigue abierto** con el error. Actualizar los tests que hoy esperan el ACK dentro del modal (p. ej. `supervisorInventoryBatchPanel.test.jsx` resuelve `ackPromise` en el flujo): cambiarlos al nuevo contrato **explicando el cambio**, sin borrar cobertura (el resultado ahora se afirma vía tracker/toast).

**Comando:** `npx vitest run tests/supervisorInventoryBatchPanel.test.jsx tests/ownerMonitorStockOpsWiring.test.jsx tests/supervisorSyncEcho.test.jsx --pool=forks --maxWorkers=1` y los tests de modal añadidos.

**Gate:** no continuar si algún modal aún espera el ACK para cerrar, o si un envío fallido llega a cerrar el modal.

**Prompt:** "Ejecuta solo la Fase 2 del plan, empezando por crear/editar producto. Migrar cada flujo a 'confirma y seguir' con sus pruebas (modal cierra sin ACK; envío fallido no cierra). No cambies la semántica de reintentos del sender de lote."

## Fase 3 — Aviso final siempre visible (Propuesta 2 completa)

**Archivos permitidos:** `src/services/supervisorCommandTracker.js`, `src/views/OwnerMonitorView.jsx`, los componentes de la Fase 2 (solo su superficie de avisos), `src/services/supervisorStockMessages.js` (ampliación de mensajes), `tests/supervisorCommandTracker.test.js`, y un test nuevo `tests/supervisorOutcomeNotices.test.jsx`.

**Cambio:**

- **Éxito siempre:** toast verde "✅ La caja aplicó tu cambio — …" nombrando el cambio (producto, ajuste, tasa, usuario). Se muestra aunque el supervisor haya navegado a otra pestaña: el tracker vive por encima de los modales.
- **Error con motivo:** rojo con el `error_message` traducido a palabras simples ("la caja rechazó el cambio porque el producto ya existe"); si el motivo viene críptico, mensaje genérico honesto + el detalle tal cual.
- **Sin confirmación:** ámbar "Sigue esperando a la caja — el cambio puede seguir en camino" (tras el timeout del ACK), con referencia al comando para poder rastrearlo. Si el ACK llega después del timeout, el aviso final real manda.
- **Reservas:** ámbar "Se aplicó con reservas" con lo que advirtió la caja (`ack_payload.warnings`).
- Sin silencio: recorrer cada tipo de comando y garantizar que todo camino termina en aviso (prueba de "sin silencio").

**Pruebas (`tests/supervisorOutcomeNotices.test.jsx`):** para cada tipo de comando del catálogo y cada desenlace, un único toast con tipo y mensaje esperados; prueba global "sin silencio": ningún desenlace (incluido `timeout` posteriormente resuelto) termina sin aviso; prueba de deduplicación con Realtime + polling simultáneos (un solo aviso final).

**Comando:** `npx vitest run tests/supervisorCommandTracker.test.js tests/supervisorOutcomeNotices.test.jsx --pool=forks --maxWorkers=1`.

**Gate:** no aceptar si algún desenlace queda sin aviso o si hay desenlaces con más de un aviso final.

**Prompt:** "Ejecuta solo la Fase 3 del plan. Completa los avisos finales (éxito siempre, error con motivo, 'sigue esperando', reservas) con la prueba de 'sin silencio' y deduplicación."

## Fase 4 — Verificación completa

**Archivos permitidos:** solo corrección de defectos encontrados, en los archivos ya tocados.

**Comandos y resultado esperado:**

1. `bun run lint:supervisor` — sin errores.
2. `bun run typecheck` — sin errores.
3. `bun run test:supervisor` — todo pasa.
4. `npx vitest run tests/supervisorAckLatency.perf.test.jsx --pool=forks --maxWorkers=1` — sin regresión; la latencia **percibida** debe mejorar (el modal ya no espera), documentar medición antes/después.
5. `bun run test:supervisor-echo` y `bun run test` — todo pasa (regresión general).
6. `bun run build` — compila.

**Gate final:** recorrer manualmente los criterios globales de aceptación y confirmar cada uno con una prueba o registro concreto. Reportar cualquier criterio no cubierto como limitación, no como éxito.

**Prompt:** "Ejecuta solo la Fase 4 del plan: verificación completa con los comandos listados, corrección mínima de defectos y reporte honesto de lo verificado y lo pendiente."

---

## Anexo técnico (contratos verificados el 2026-10-18)

- **Envío:** `sendSupervisorCommand` (`src/services/supervisorCommandService.js`) devuelve `{ ok, status: 'sent' | 'pending' | …, commandId, ackPromise }`. `ackPromise` = `waitForCommandAck(commandId, SUPERVISOR_ACK_TIMEOUT_MS)` → Realtime (`postgres_changes` UPDATE sobre `supervisor_commands` filtrado por `command_id`) + polling de respaldo con backoff + lectura inicial; resuelve `{ ok, status, ack, error }` en estado terminal o `{ ok:false, status:'timeout', error:'La caja no confirmó la orden a tiempo' }`.
- **Estados terminales:** `applied`, `applied_with_warnings`, `rejected`, `failed`, `cancelled` (`SUPERVISOR_TERMINAL_COMMAND_STATUSES`); `timeout` es resolución local, no un estado persistido.
- **Avisos:** `showToast(mensaje, tipo, duración)` global + `useToast()` en `src/components/Toast.jsx` (tipos `success|error|warning|info`; el contenedor retiene los últimos 5 toasts).
- **Sitios que hoy esperan el ACK dentro del flujo del modal** (alcance de la Fase 2):
  1. `src/views/OwnerMonitorView.jsx` (~línea 721) — `handleConfirmDeleteProductRemote`.
  2. `src/components/Monitor/RemoteProductFormModal.jsx` (~línea 390) — crear/editar producto.
  3. `src/components/Monitor/SupervisorRateModal.jsx` (~línea 69) — tasa.
  4. `src/components/Monitor/RemoteUsersManager.jsx` (~línea 109) — usuarios.
  5. `src/components/Monitor/SupervisorInventoryBatchModal.jsx` (~línea 187) — lote individual.
  6. `src/components/Monitor/SupervisorInventoryBatchPanel.jsx` (~línea 346) — panel de lote (vía `src/services/supervisorInventoryBatchSender.js`, que espera el ACK internamente con reintentos y `TIMEOUT_ACK`).
- **Realtime:** `useMonitorSync` se suscribe solo a `sync_documents` y `device_pairings` (no a `supervisor_commands`); el vehículo del resultado es el ACK por comando. `useSupervisorControl` mantiene el conteo del panel (poll 45 s + `postgres_changes`) — base de la futura propuesta 3.
- **Mensajes de referencia:** `src/services/supervisorStockMessages.js` (catálogo llano de estados de stock) y `src/services/supervisorCommandDiagnostics.js` (etiquetas de estado del panel).
- **Qué no se toca:** `shouldAwaitSupervisorAck`, TTL y estados de `supervisor_commands`, el journal `published_pending`, la semántica de reintentos del sender de lote, y cualquier migración SQL (estas dos propuestas no la necesitan).
