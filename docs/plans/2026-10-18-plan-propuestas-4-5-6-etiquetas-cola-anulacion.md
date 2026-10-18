# Plan: etiquetas por producto, cola local con mando y arrepentimiento (Propuestas 4, 5 y 6)

**Fecha:** 2026-10-18
**Origen:** [Propuestas: confirmación de cambios y panel de Control](2026-10-18-plan-propuestas-control-supervisor.md) — solo las propuestas 4 (etiqueta de estado en cada producto), 5 (cola local con mando del usuario) y 6 (poder arrepentirse). Continúa después de [Propuestas 3 y 7](2026-10-18-plan-propuestas-3-7-control-verificacion.md), **ya implementadas** (panel Control tipo recibo con sellos "Recibido por la caja" → "Aplicado y verificado" → "No coincide — revisar", 506/506 pruebas de supervisor en verde el 2026-10-18), y de las propuestas 1 y 2 (tracker "confirma y sigue").
**Requiere migraciones SQL:** no obligatorio. Todo puede salir en cliente sobre `supervisor_commands`, el journal `published_pending` y los servicios existentes. (Opcional futuro: RPC `cancel_supervisor_commands` por lotes; el plan usa el RPC `cancel_supervisor_command` existente en bucle.)

> **Modo de ejecución para LLM:** fases encadenadas, test primero. El usuario puede autorizar una fase por interacción o el plan completo de una vez (como hizo con el plan 3-7). En cualquier caso: releer los archivos de cada fase, no anticipar contratos, y al terminar reportar cambios, pruebas, resultado y bloqueos.

## El plan en lenguaje llano

Al terminar, el supervisor tendrá:

1. **Cada producto avisa su estado sin abrir nada (propuesta 4).** En la tarjeta de cada artículo del catálogo remoto, una etiqueta clara: **"EN COLA"** (el cambio está en el navegador, todavía no se envió), **"ESPERANDO A LA CAJA"** (ya se envió, falta su confirmación) o **"APLICADO"** (la caja lo confirmó). De un vistazo se ve qué está pendiente.

2. **La cola local tiene mando (propuesta 5).** Un aviso abajo: **"N cambios en cola — Aún no se han enviado a la caja — SUBIR AL SISTEMA / DESCARTAR"**. Si no hay internet, los cambios esperan guardados y se suben solos cuando vuelve la conexión (el barrido automático de 30 s ya existe); el usuario además puede subirlos antes o descartarlos cuando quiera.

3. **Se puede arrepentir (propuesta 6).** Botón **"ANULAR TODOS"** cuando hay cambios esperando a la caja, y anular un cambio suelto (esto ya existe en el panel Control) con **aviso honesto** si el envío ya podría estar en camino: *"el cambio puede haber llegado ya a la caja; verifica su estado"*.

La regla que se conserva de todo lo anterior: **"un cambio = un aviso"**, nunca pantallas congeladas, y nunca un verde falso — lo que no se puede confirmar se dice con palabras.

## Objetivo y límites

- **Objetivo 1 (Propuesta 4):** badge de estado por producto en `SupervisorInventoryCatalog`, derivado del estado REAL (cola local, en vuelo, aplicado) — sin estados inventados ni duplicar lógica: reutilizar `stockOpStatus` (creído/pendiente) y el tracker.
- **Objetivo 2 (Propuesta 5):** superficie de la cola local ya existente: contador, banner "N cambios en cola", botones SUBIR AL SISTEMA (forzar el envío del journal) y DESCARTAR (con confirmación; nunca borrado silencioso de trabajo del usuario).
- **Objetivo 3 (Propuesta 6):** "ANULAR TODOS" (anulación en lote de los comandos `pending` propios, vía RPC existente en bucle) + el aviso honesto de "puede haber llegado ya a la caja" cuando la anulación llega tarde.
- **No incluido:** avisos de otros supervisores (propuesta 8 — siguiente plan), cambios al contrato `supervisor_commands` o sus RPCs, SQL remoto, despliegues, commits/push, dependencias nuevas ni lockfiles.

## Reglas obligatorias para cada fase

1. Confirmar branch y `git status`; no descartar ni sobrescribir cambios de otros hilos (el working tree ya tiene trabajo previo sin commitear: se respeta todo).
2. Releer los archivos de la fase; los números de línea pueden estar obsoletos.
3. Antes de editar, resumir comportamiento actual, archivos y criterio de éxito. Si el repo contradice este plan o falta un archivo, **detenerse y preguntar**.
4. Solo la fase autorizada; sin refactors ajenos.
5. Pruebas primero (que fallen por la causa prevista), luego el cambio mínimo, volver a correr.
6. No debilitar pruebas ni ocultar errores; revisar el diff final.
7. Sin SQL remoto, despliegues, commits ni push.
8. Handoff al cerrar cada fase si se ejecuta por interacción; no continuar automáticamente sin autorización.

## Criterios globales de aceptación

- Ningún producto muestra un badge que su estado real no respalde: "APLICADO" solo con confirmación de la caja (ACK terminal), "ESPERANDO A LA CAJA" solo con envío efectivo, "EN COLA" solo con registro local pendiente.
- La cola local es visible, contada y controlable: el banner refleja exactamente lo que hay en el journal (`published_pending` + tracker en vuelo), SUBIR envía lo pendiente y DESCARTAR pide confirmación y explica qué se pierde.
- "ANULAR TODOS" solo anula lo que la caja aún no tomó; lo que ya podría haber sido tomado se reporta como "no se pudo anular — verificar su estado" (nunca un "anulado" falso).
- El flujo "confirma y sigue" no se congela en ninguna acción: ningún botón espera la confirmación de la caja antes de cerrar.
- `bun run lint:supervisor`, `bun run typecheck`, `bun run test:supervisor`, `bun run test` y `bun run build` en verde.

---

## Fase 0 — Reconocimiento seguro (solo lectura)

**Objetivo:** confirmar contratos antes de tocar código.

**Leer/buscar:** `src/services/supervisorStockOps.js` (`stockOpStatus`, `beginStockAdjust`, `applyStockOpOutcome`, `isStockAdjustBlocked`, `believedStockOf`, `nextStockOpAfterInspection`), `src/components/Monitor/SupervisorInventoryCatalog.jsx` (estructura de la tarjeta de producto), `src/hooks/useCloudSync.js` y `src/hooks/useMonitorSync.js` (journal `published_pending`, flag de productos pendientes, barrido de 30 s, qué dispara el envío automático), `src/services/supervisorCommandTracker.js` (estados en vuelo), `src/services/supervisorControlService.js` (`cancelSupervisorCommand`, `getControlStatus`), tests `supervisorStockOps.test.js`, `supervisorInventoryDraft.test.js`, `supervisorSyncEcho.test.jsx`, `supervisorControl.test.js`.

**Salida/gate:** qué dato alimenta cada uno de los tres estados del badge (¿el journal tiene una función de conteo o hay que derivarla del estado en memoria?); cómo se fuerza hoy el envío del journal (¿existe una función exportada tipo `flushPendingPublications` o solo el temporizador?); firma exacta de `cancelSupervisorCommand` y qué hace cuando la caja ya tomó el comando (¿el RPC devuelve un error distinguible?). Si falta alguna pieza, ajustar el alcance de las fases en vez de inventar APIs.

**Prompt de fase:** "Ejecuta solo la Fase 0 de [este plan](docs/plans/2026-10-18-plan-propuestas-4-5-6-etiquetas-cola-anulacion.md). Solo lectura; no edites. Devuelve branch/status, cómo se derivan los estados del badge, cómo se dispara/fuerza el envío de la cola local y el comportamiento real de la anulación."

## Fase 1 — Etiqueta de estado en cada producto (propuesta 4, test primero)

**Archivos permitidos:** `src/components/Monitor/SupervisorInventoryCatalog.jsx` (badge en la tarjeta; si el archivo se complica, un `src/components/Monitor/ProductStateBadge.jsx` nuevo), `src/services/supervisorStockOps.js` (solo si hace falta exponer un derivador puro `productQueueState(...)`), tests nuevos `tests/supervisorProductBadges.test.jsx`.

**Cambio:** en la tarjeta de cada producto del catálogo remoto, un badge con exactamente uno de estos estados, derivado sin duplicar lógica:

- **"EN COLA"** — hay cambio local sin enviar (entrada en el journal `pending`/`published_pending` o edición local no publicada).
- **"ESPERANDO A LA CAJA"** — el comando fue enviado y está `pending`/`received`/en vuelo (tracker o `stockOpStatus`).
- **"APLICADO"** — la caja confirmó (ACK terminal `applied`/`applied_with_warnings`); el badge se retira a los pocos segundos o queda como histórico tenue (decidir por el estilo visual existente; nunca tapar la ficha del producto).
- Sin badge cuando no hay actividad reciente sobre ese producto (un "APLICADO" eterno en todos los productos sería ruido).

Derivación en un módulo puro (`productQueueState({ productId, journalEntries, trackedCommands, stockOps })`) con tests unitarios; el componente solo lo pinta. Colores coherentes con los sellos del panel Control (info/amarillo/verde).

**Pruebas:** producto con cambio sin enviar → "EN COLA"; con comando en vuelo → "ESPERANDO A LA CAJA"; con ACK terminal reciente → "APLICADO"; sin actividad → sin badge; si un producto tiene cola Y envío, gana el estado más avanzado pendiente (EN COLA nunca desaparece si aún hay algo sin subir). Nunca dos badges contradictorios a la vez.

**Comando:** `npx vitest run tests/supervisorProductBadges.test.jsx --pool=forks --maxWorkers=1`.

**Gate:** el test falla antes de implementar y pasa después; ningún badge puede decir "APLICADO" sin ACK terminal.

**Prompt:** "Ejecuta solo la Fase 1 del plan. Implementa los badges de estado por producto con su derivador puro y pruebas (test primero). No toques aún la cola local ni la anulación."

## Fase 2 — La cola local a la vista: banner y contador (propuesta 5)

**Archivos permitidos:** `src/views/OwnerMonitorView.jsx` (banner; o componente nuevo `src/components/Monitor/LocalQueueBanner.jsx`), `src/hooks/useCloudSync.js` o el servicio del journal (solo exponer conteo/estado si no existe), tests nuevos `tests/supervisorLocalQueueBanner.test.jsx`.

**Cambio:** aviso fijo abajo cuando hay cambios sin subir, al estilo de Donde Juancho: **"N cambios en cola — Aún no se han enviado a la caja"** con los botones **SUBIR AL SISTEMA** y **DESCARTAR** (los botones con lógica en la Fase 3; en esta fase se muestran y quedan enganchados a la acción mínima existente). El contador sale del journal real (`published_pending` + tracker en vuelo), no de un estado aparte. Si no hay conexión, el texto lo dice: "Se subirán solos cuando vuelva la conexión" (modo automático de 30 s ya existente).

**Pruebas:** 0 pendientes → sin banner; 3 pendientes → "3 cambios en cola"; con conexión → texto normal; sin conexión → texto honesto de reintento automático; el contador baja cuando el tracker resuelve un comando.

**Comando:** `npx vitest run tests/supervisorLocalQueueBanner.test.jsx tests/supervisorSyncEcho.test.jsx --pool=forks --maxWorkers=1`.

**Gate:** el número del banner coincide siempre con lo que hay de verdad en la cola (misma fuente), y el banner no tapa controles críticos en móvil (ver `supervisorResponsive.test.js` como referencia de layout).

**Prompt:** "Ejecuta solo la Fase 2 del plan. Saca la cola local a la vista con el banner, su contador honesto y el texto de reintento automático. Sin acciones nuevas todavía."

## Fase 3 — SUBIR AL SISTEMA y DESCARTAR (el mando del usuario)

**Archivos permitidos:** los de la Fase 2 + `src/hooks/useCloudSync.js` (exponer `flushPendingPublications()` / `discardPendingPublications()` si no existen; si ya existen, solo cablear), `src/components/ConfirmModal.jsx` (reutilizar, no tocar si no hace falta), tests `tests/supervisorLocalQueueBanner.test.jsx` (ampliar).

**Cambio:**

- **SUBIR AL SISTEMA:** fuerza el envío inmediato del journal sin esperar al barrido de 30 s ("confirma y sigue": el botón no se queda esperando a la caja; el aviso del tracker se encarga del resultado).
- **DESCARTAR:** confirmación explícita (`ConfirmModal`) que explica qué se pierde ("Se descartarán N cambios que nunca llegaron a la caja"); al confirmar, se limpia la cola local y queda un registro honesto (toast + entrada en diagnósticos si existe el patrón). Nunca descartar sin confirmación, nunca descartar lo que YA se envió (eso es territorio de la anulación, propuesta 6).

**Pruebas:** SUBIR llama al envío del journal y el banner se vacía tras el resultado; DESCARTAR sin confirmación no borra nada; con confirmación limpia solo lo pendiente (lo enviado se conserva); en ambos casos ningún flujo queda congelado (sin `await` de ACK en el handler).

**Comando:** `npx vitest run tests/supervisorLocalQueueBanner.test.jsx tests/supervisorInventoryBatchSender.test.js --pool=forks --maxWorkers=1`.

**Gate:** descartar es imposible sin confirmación visible; subir jamás duplica comandos (el guard de payloadKey/deduplicación existente se respeta).

**Prompt:** "Ejecuta solo la Fase 3 del plan. Cablea SUBIR AL SISTEMA y DESCARTAR con confirmación, sin congelar la interfaz y sin duplicar envíos."

## Fase 4 — Poder arrepentirse: ANULAR TODOS + aviso honesto (propuesta 6)

**Archivos permitidos:** `src/views/OwnerMonitorView.jsx` o el banner de la Fase 2 (botón ANULAR TODOS), `src/hooks/useSupervisorControl.js` (`cancelAll` sobre sus `pending` propios), `src/components/Monitor/SupervisorControlPanel.jsx` (mensaje honesto en la ficha cuando la anulación llega tarde), tests nuevos `tests/supervisorCancelAll.test.js` (y ampliar `tests/supervisorControlPanel.test.jsx`).

**Cambio:**

- **ANULAR TODOS** (en el banner, visible solo con cambios en espera de la caja): recorre los comandos `pending` propios y llama al RPC `cancel_supervisor_command` existente por cada uno; confirma antes; al terminar, aviso con el resultado real: "N anulados · M no se pudieron anular (la caja puede haberlos tomado)".
- **Aviso honesto de arrepentimiento:** cuando la anulación falla o el comando pasa a estado tomado (`received`/terminal) mientras se anulaba, el mensaje dice literalmente *"el cambio puede haber llegado ya a la caja; verifica su estado"* — con enlace al comando en Control. Nunca "anulado" sin confirmación del RPC.
- La anulación suelta del panel Control ya existe; solo se le añade el mismo mensaje honesto cuando la caja ya tomó el comando (hoy devuelve error seco).

**Pruebas:** con 3 pendientes y RPC exitoso → "3 anulados"; con 1 que la caja ya tomó → "2 anulados · 1 no se pudo anular — el cambio puede haber llegado ya a la caja"; sin pendientes → el botón no aparece; cancelación individual tardía muestra el mismo aviso honesto. Ninguna promesa falsa: el estado del comando en la lista siempre refleja lo que el RPC devolvió.

**Comando:** `npx vitest run tests/supervisorCancelAll.test.js tests/supervisorControlPanel.test.js tests/supervisorControl.test.js --pool=forks --maxWorkers=1`.

**Gate:** ningún camino reporta "anulado" sin confirmación del RPC; el caso "ya tomado" siempre termina en el aviso honesto.

**Prompt:** "Ejecuta solo la Fase 4 del plan. Implementa ANULAR TODOS con resultado real por comando y el aviso honesto de 'puede haber llegado ya a la caja'."

## Fase 5 — Verificación completa

**Archivos permitidos:** solo corrección de defectos, en los archivos ya tocados.

**Comandos y resultado esperado:**

1. `bun run lint:supervisor` — 0 errores.
2. `bun run typecheck` — 0 errores.
3. `bun run test:supervisor` — todo pasa.
4. `bun run test` — regresión general en verde.
5. `bun run build` — compila.

**Gate final:** recorrer los criterios globales y confirmar cada uno con una prueba o registro concreto; reportar como limitación lo no cubierto (p. ej. si DESCARTAR no puede distinguir lo enviado de lo pendiente sin tocar el journal, decirlo en vez de ocultarlo).

**Prompt:** "Ejecuta solo la Fase 5 del plan: verificación completa con los comandos listados, corrección mínima de defectos y reporte honesto."

---

## Anexo técnico (base verificada el 2026-10-18)

- **Estados por producto (propuesta 4):** `src/services/supervisorStockOps.js` modela el "stock creído" mientras espera (`stockOpStatus`, `beginStockAdjust`, `applyStockOpOutcome`, `isStockAdjustBlocked`, `believedStockOf`, `nextStockOpAfterInspection`); el receptor reconcilia cada `commandId` solo (efecto de reconciliación en `OwnerMonitorView`, `inspectSupervisorCommandState` cada 5 s, `recordReconciliation`). El badge debe leer ESTOS estados, no crear un modelo paralelo.
- **Cola local (propuesta 5):** el journal con `published_pending` y el barrido automático de 30 s ya existen en `useCloudSync`/`useMonitorSync`; lo que falta es la superficie de usuario (contador + subir ahora + descartar), tal como anota el anexo del plan original. La deduplicación por `payloadKey` y el registro previo (recuperación de cortes) se conservan intactos.
- **Anulación (propuesta 6):** `supervisor_commands.status` admite `cancelled` y existe el RPC `cancel_supervisor_command` (usado por `cancelSupervisorCommand` en `supervisorControlService.js` y por el panel Control). El límite honesto está documentado en el plan original: anular solo es seguro **antes** de que la caja tome el cambio; después hay que usar un cambio contrario (devolver stock). El aviso de la propuesta 6 es literalmente eso.
- **Sellos (propuesta 7, ya implementada):** `supervisorCommandVerification.js` (evaluador puro por tipo de comando), `supervisorCommandDiagnostics.recordVerification` (registro tipo reconciliación), `supervisorCommandReceipt.js` (fichas-recibo) y el panel `SupervisorControlPanel.jsx` con 4 contadores + 5 filtros + sellos ("Recibido por la caja" → "Aplicado y verificado" → "No coincide — revisar"). Las fases de este plan NO tocan esa semántica; solo la reutilizan para los badges.
- **Regla "un cambio = un aviso":** `supervisorCommandTracker.js` (`trackSupervisorCommand`, `buildCommandNotice`, `setCommandVerification`). Los nuevos controles (subir/descartar/anular todos) no generan un toast por comando, sino UN aviso resumen de la acción.
- **Formato visual de referencia:** Donde Juancho (`MonitorCambiosTab.jsx`, `monitorCommandDetails.js`, `constants/commandStatus.js`, `supervisorStockProjection.js`) y las capturas de la conversación del 2026-10-18.
- **Qué no se toca:** contrato `supervisor_commands` y sus RPCs, TTL/claim/ACK, el journal `published_pending` (solo se expone), la semántica de reintentos del sender de lote, y la propuesta 8 (siguiente plan: avisos de equipo con `actor_auth_id` en Realtime).
