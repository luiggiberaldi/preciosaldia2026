# Plan: avisos de equipo (Propuesta 8)

**Fecha:** 2026-10-18
**Origen:** [Propuestas: confirmación de cambios y panel de Control](2026-10-18-plan-propuestas-control-supervisor.md) — solo la propuesta 8 ("Avisos de equipo"): *cuando otro supervisor hace un cambio, aviso "Otro supervisor actualizó el inventario", para que el equipo sepa que el negocio cambió mientras miraba a otro lado*. Continúa después de [Propuestas 1 y 2](2026-10-18-plan-propuestas-1-2-confirmar-y-resultado.md) (tracker de resultados, ya implementado) y es **independiente** de las propuestas 3–7 ([plan](2026-10-18-plan-propuestas-3-7-control-verificacion.md)): solo comparten el tracker de avisos y el panel Control como superficie de lectura.
**Requiere migraciones SQL:** no. `supervisor_commands.actor_auth_id` ya existe (con índice), así que "quién hizo el cambio" ya viaja en cada comando.

> **Modo de ejecución para LLM:** una sola fase por interacción. Revisar esta guía y los archivos de la fase actual. No anticipar fases ni inventar contratos. Al terminar, reportar cambios, pruebas, resultado y bloqueos; esperar autorización para la siguiente fase.

## El plan en lenguaje llano

Cuando **otro** supervisor hace un cambio (crea un producto, ajusta stock, cambia la tasa, agrega un usuario…), al equipo le llega un aviso breve: **"Otro supervisor actualizó el inventario"**, con el detalle del cambio ("Detodito Grande: stock 10 → 15") y cuándo pasó. Así el equipo sabe que el negocio cambió mientras miraba a otro lado.

Reglas de caballero del aviso:

1. **Los cambios propios no avisan dos veces.** El tracker "un cambio = un aviso" (propuestas 1–2) ya anuncia el resultado de MIS cambios; el aviso de equipo es solo para actores distintos del mío.
2. **Un cambio = un aviso.** Si el resultado del mismo comando ya se anunció (por cualquier camino), el aviso de equipo no se duplica. Se deduplica por `commandId`.
3. **Ráfagas agrupadas.** Si llegan varios cambios juntos (otro supervisor trabajó mientras nosotros no mirábamos), aviso agrupado: "3 cambios de otro supervisor mientras no estabas", no tres toasts seguidos.
4. **Nunca alarmista.** El tono es informativo (info/ámbar), no de error: que otro compañero trabaje es normal, no un problema.

## Objetivo y límites

- **Objetivo 1:** detectar los comandos de `supervisor_commands` emitidos por **otro actor** (`actor_auth_id` distinto del mío) hacia la caja que tengo emparejada, aunque la pestaña Control esté cerrada.
- **Objetivo 2:** mostrar el aviso con detalle legible (qué cambió, quién, cuándo), reutilizando el catálogo de etiquetas del panel Control (`supervisorControlService`) y `describeSupervisorCommand` del tracker.
- **Objetivo 3:** agrupar ráfagas y deduplicar por `commandId` para respetar la regla "un cambio = un aviso".
- **No incluido:** avisar al cajero (caja → supervisor es el alcance; la otra dirección queda para una propuesta futura), panel nuevo, cambios al contrato de `supervisor_commands` ni a sus RPCs, resolución del nombre humano del actor (si el catálogo de usuarios no permite mapear `actor_auth_id` → nombre, el aviso dice "Otro supervisor" y basta), SQL remoto, despliegues, commits/push, dependencias nuevas o lockfiles.

## Reglas obligatorias para cada fase

1. Confirmar branch y `git status`; no descartar ni sobrescribir cambios de otros hilos (el working tree ya tiene trabajo previo sin commitear: se respeta todos esos archivos).
2. Releer los archivos de la fase; los números de línea pueden estar obsoletos.
3. Antes de editar, resumir comportamiento actual, archivos y criterio de éxito. Si el repo contradice este plan o falta un archivo, **detenerse y preguntar**.
4. Solo la fase autorizada; sin refactors ajenos.
5. Pruebas primero (que fallen por la causa prevista), luego el cambio mínimo, volver a correr.
6. No debilitar pruebas ni ocultar errores; revisar el diff final.
7. Sin SQL remoto, despliegues, commits ni push.
8. Handoff al cerrar cada fase; no continuar automáticamente.

## Criterios globales de aceptación

- Un comando insertado por otro actor (distinto `actor_auth_id`) para mi caja emparejada produce **exactamente un** aviso, con etiqueta legible del tipo de cambio y detalle del movimiento.
- Mis propios cambios **nunca** generan aviso de equipo (aunque sigan dando su toast de resultado del tracker).
- Un mismo `commandId` jamás se anuncia dos veces, aunque llegue por Realtime y además aparezca en un barrido/poll posterior.
- Una ráfaga de N cambios en corto tiempo produce un aviso agrupado, no N toasts.
- La escucha funciona con la pestaña Control cerrada; con el monitor sin emparejar o sin sesión, no hay escucha ni errores en consola.
- Sin duplicación con el tracker de resultados ni con el panel de diagnóstico (`supervisorCommandDiagnostics`).
- `bun run lint:supervisor`, `bun run typecheck`, `bun run test:supervisor`, `bun run test` y `bun run build` en verde.

---

## Fase 0 — Reconocimiento seguro (solo lectura) · **EJECUTADA 2026-10-18**

**Objetivo:** confirmar contratos antes de tocar código.

**Leer/buscar:** `supabase_supervisor_commands.sql` y migraciones recientes (`actor_auth_id`, quién lo fija en `create_supervisor_command`: ¿`auth.uid()` del emisor o el device id?), `src/hooks/useSupervisorControl.js` (dónde vive la suscripción Realtime y su gating por `viewTab`), `src/services/supervisorControlService.js` (`COMMAND_TYPE_LABELS`, `getCommandTitle`/`getCommandDetails`), `src/services/supervisorCommandTracker.js` (`buildCommandNotice`, `describeSupervisorCommand`, `isCommandOutcomeOwned`, `subscribeSupervisorCommandTracker`), `src/components/Toast.jsx` (`showToast`), `src/views/OwnerMonitorView.jsx` (dónde se monta el monitor y su identidad vía `ensureSupervisorSession()`), tests `supervisorControlPanel.test.jsx`, `supervisorOutcomeNotices.test.jsx`, `supervisorCommands.test.js`, `supervisorLifecycle.test.js`.

**Salida/gate:** (a) qué valor vive exactamente en `actor_auth_id` y cuál es MI valor comparable en el monitor (`session.user.id` de `ensureSupervisorSession()` u otro); (b) si la suscripción de `supervisor_commands` puede vivir fuera del gating `viewTab === 'control'` sin duplicar el canal del panel; (c) qué eventos ve Realtime cuando otro supervisor inserta un comando (INSERT con status inicial) y qué transiciones UPDATE valen la pena observar. Si `actor_auth_id` no permite distinguir "yo" de "otro" con la identidad disponible en el monitor, **detenerse y reportar** en vez de inventar comparaciones.

**Prompt de fase:** "Ejecuta solo la Fase 0 de [este plan](docs/plans/2026-10-18-plan-propuesta-8-avisos-equipo.md). Solo lectura; no edites. Devuelve branch/status, el significado exacto de `actor_auth_id`, la identidad comparable del monitor, y cómo/de dónde se suscribe hoy `supervisor_commands`."

### Resultado de la Fase 0 (ejecutada 2026-10-18 — contrato confirmado, NO re-investigar)

**Branch:** `preview/all-changes-oct14` (trabajo previo sin commitear respetado; la fase no hizo ediciones).

- **(a) `actor_auth_id` es el `auth.uid()` de la sesión del supervisor EMISOR** (no un device id). En `supabase_supervisor_commands.sql`: `v_actor UUID := auth.uid()` (rechaza sesión nula) e INSERT con `actor_auth_id = v_actor`; el RPC solo acepta el comando si ese uid coincide con `monitor_auth_id`/`monitor_auth_id_2` del pairing de la caja destino, y un `command_id` ajeno no puede reescribirse. El ACK va al revés: `ack_supervisor_command` exige `owner_auth_id = v_actor` (lo firma la caja).
- **Identidad comparable del monitor:** `session.user.id` de `ensureSupervisorSession()` (sesión anónima por dispositivo = el `monitor_auth_id`/`_2` de mi slot). La comparación es directa — `row.actor_auth_id !== session.user.id` — con el mismo idiom que `isPairingRevocationConfirmed` y los triggers canary.
- **(b) La escucha puede vivir fuera del gating `viewTab === 'control'` SIN duplicar canal:** el único canal es `supervisor-control:${targetDeviceId}` de `useSupervisorControl` (hoy muere con la pestaña); basta dar al efecto del canal su gate propio (`Boolean(targetDeviceId)`) y dejar la carga de lista/conteos tras `enabled`. Un segundo canal para la misma tabla queda descartado.
- **(c) Eventos:** el **INSERT** (fila completa con `status = 'pending'`, `actor_auth_id`, `command_type`, `payload`) es el que dispara el aviso; los **UPDATE** (`applied`, `applied_with_warnings`, `rejected`, `failed`, `cancelled`, `expired`) son territorio del tracker. DELETE es irrelevante.
- **Decisión tomada (Fase 1):** el aviso se emite en el INSERT (la acción ocurre en el momento); un UPDATE con final triste (`cancelled`/`failed`/`rejected`/`expired`) **nunca** anuncia "actualizó el inventario" — y el catch-up solo cuenta actividad real (`pending`/`received`/`applied`/`applied_with_warnings`): cancelar solo existe desde `pending`, así que un comando cancelado nunca tocó el negocio.
- **Veredicto del gate:** PASA — "yo" y "otro" son distinguibles con la identidad disponible.

**Tres trampas heredadas (las fases 1–4 deben respetarlas):**

1. **Sesión compartida:** dos dispositivos con la misma sesión anónima comparten uid y no se avisarían entre ellos (ya contemplado como riesgo 3).
2. **Trampa de nombres:** `useRemoteCommands` llama `monitorDeviceId` a `row.actor_auth_id` — es un auth uid; jamás compararlo con `pda_device_id`.
3. **Enum de `status`:** lo desplegado (migraciones: incluye `cancelled`, `expired`, `applied_with_warnings`) es más amplio que el CHECK del SQL raíz — no hardcodear estados.

**No investigado (fuera del alcance de la Fase 0):** mapeo de `actor_auth_id` a nombre humano (el aviso sigue diciendo "Otro supervisor"), y nada se consultó en el Supabase en vivo — todo el veredicto proviene del repo (SQL remoto prohibido por las reglas del plan).

---

## Fase 1 — Núcleo: clasificador de avisos de equipo (test primero) · **EJECUTADA 2026-10-18**

**Archivos permitidos:** nuevo `src/services/supervisorTeamNotices.js`, nuevo `tests/supervisorTeamNotices.test.js`. Nada más.

**Cambio:** módulo puro (sin React, sin red) que decide si un comando observado merece aviso y cómo se ve:

- API: `classifyTeamNotice({ command, myActorId, seenCommandIds })` → `null` (silencio) o `{ commandId, kind: 'single' | 'group', title, detail, actorLabel, at }`.
  - Silencio cuando: `actor_auth_id` falta, coincide con `myActorId` (cambio propio), o el `commandId` ya está en `seenCommandIds` (dedupe).
  - Título base **"Otro supervisor actualizó el inventario"** para tipos de inventario; para otros tipos, etiqueta legible del catálogo del panel (`COMMAND_TYPE_LABELS`/`describeSupervisorCommand`): producto, tasa, usuario, turno. Sin inventar nombres humanos: `actorLabel` es "Otro supervisor" — la Fase 0 confirmó que no hay contrato para mapear `actor_auth_id` → nombre humano (ver Resultado de la Fase 0).
- API: `groupTeamNotices(notices, { windowMs })` → colapsa ráfagas dentro de la ventana en un solo aviso `{ kind: 'group', title: 'N cambios de otro supervisor mientras no estabas', detail }`.
- API: `formatTeamNotice(notice)` → `{ message, tone }` para `showToast` (`tone: 'info'`; el tono de error queda reservado para fallos reales, no para actividad de compañeros).

**Pruebas:** comando propio → `null`; de otro actor → aviso con detalle; mismo `commandId` dos veces → un solo aviso; `actor_auth_id` ausente → `null`; ráfaga de 3 en la ventana → un aviso agrupado con detalle resumido; cada tipo de comando produce etiqueta legible; nunca `tone: 'error'` por actividad válida.

**Comando:** `npx vitest run tests/supervisorTeamNotices.test.js --pool=forks --maxWorkers=1`.

**Gate:** el test debe fallar antes de implementar y pasar después; ningún caso produce aviso para cambios propios ni duplicado por `commandId`.

**Prompt:** "Ejecuta solo la Fase 1 del plan. Crea el clasificador de avisos de equipo con sus pruebas (test primero), cubriendo cambios propios, dedupe por commandId, agrupación de ráfagas y etiquetas legibles. No toques aún la UI ni los hooks."

## Fase 2 — Cableado: escucha de comandos de otros actores + toast · **EJECUTADA 2026-10-18**

**Archivos permitidos:** `src/hooks/useSupervisorControl.js` o nuevo `src/hooks/useSupervisorTeamNotices.js`, `src/views/OwnerMonitorView.jsx` (montaje), `src/services/supervisorCommandTracker.js` (solo lectura de su estado para dedupe, sin tocar su semántica), tests nuevos `tests/supervisorTeamNoticesWiring.test.jsx` o extensión de `tests/supervisorControlPanel.test.jsx`.

**Cambio:** el monitor escucha `supervisor_commands` (INSERT/UPDATE, `target_device_id` de su caja emparejada) **aunque la pestaña Control esté cerrada** — la escucha vive en su propio hook ligero o se desacopla del gating del panel sin crear un segundo canal Realtime para la misma tabla (canal `supervisor-control:${targetDeviceId}` de `useSupervisorControl`; ver Resultado de la Fase 0: gate propio `Boolean(targetDeviceId)` para el canal). Cada evento pasa por `classifyTeamNotice` (con `myActorId` de `ensureSupervisorSession()`) y el resultado se emite vía `showToast`/`formatTeamNotice`, registrando el `commandId` como visto. El resultado de MIS comandos sigue anunciando SOLO el tracker (regla "un cambio = un aviso").

**Pruebas (jsdom, mocks de Supabase/Toast como en los tests existentes):** INSERT de otro actor con la pestaña Control cerrada → un toast con el mensaje esperado; INSERT propio → cero toasts de equipo; UPDATE del mismo comando → sin segundo toast; sin sesión/pareja → cero escuchas y cero errores; el canal no se duplica al abrir/cerrar la pestaña Control.

**Comando:** `npx vitest run tests/supervisorTeamNoticesWiring.test.jsx tests/supervisorControlPanel.test.jsx --pool=forks --maxWorkers=1`.

**Gate:** la prueba de "un solo toast por commandId" pasa con el cableado real; `useMonitorSync` sigue sin escuchar `supervisor_commands` (su contrato, cubierto por `supervisorLifecycle`, no cambia).

**Prompt:** "Ejecuta solo la Fase 2 del plan. Cablea la escucha de comandos de otros actores al toast, sin duplicar el canal Realtime ni los avisos del tracker, con pruebas de cableado."

## Fase 3 — Agrupación en vivo y catch-up acotado ("mientras no estabas") · **EJECUTADA 2026-10-18**

**Archivos permitidos:** los de la Fase 2 + `src/services/supervisorCommandService.js` (solo lectura de `fetchSupervisorCommandsForRecovery`/consulta existente; sin tocar TTL ni claim), tests de la Fase 2.

**Cambio:** (a) las ráfagas en vivo se agrupan con `groupTeamNotices` (una ventana corta, p. ej. 10 s: los eventos que llegan juntos se colapsan en un aviso con contador); (b) al reconectar o volver a primer plano, un catch-up **acotado** consulta los comandos de mi caja emitidos por otros actores desde el último aviso visto (o un tope de minutos si no hay marca) y emite UN aviso agrupado si hubo actividad ("3 cambios de otro supervisor mientras no estabas"), nunca un despliegue histórico. Los `commandId` vistos se guardan con tope de tamaño (los más recientes) en localStorage, con la clave `pda_team_notice_seen_v1`.

**Pruebas:** ráfaga de 3 eventos → 1 toast agrupado; catch-up con 0 cambios → silencio; catch-up con 2 cambios → 1 aviso agrupado; el tope de memoria no crece sin límite; reconexión repetida no repite el mismo catch-up.

**Comando:** `npx vitest run tests/supervisorTeamNoticesWiring.test.jsx --pool=forks --maxWorkers=1`.

**Gate:** ninguna combinación produce más de un aviso por `commandId` ni aviso por actividad propia; el catch-up nunca consulta sin marca de tiempo/par.

**Prompt:** "Ejecuta solo la Fase 3 del plan. Implementa agrupación de ráfagas y el catch-up acotado 'mientras no estabas', con sus pruebas."

## Fase 4 — Verificación completa · **EJECUTADA 2026-10-18**

**Archivos permitidos:** ninguna edición funcional; solo corrección de lo que fallen los gates.

**Cambio (solo si algo falla):** corregir la causa, sin debilitar pruebas.

**Comando:** `bun run lint:supervisor && bun run typecheck && bun run test:supervisor && bun run test && bun run build` (con `set -o pipefail` si se filtra la salida).

**Gate:** todo en verde; revisar el diff final completo. Reporte honesto: qué quedó implementado, qué pruebas corrieron y qué no (p. ej. dogfood con dos supervisores reales requiere dispositivos físicos: se reporta como pendiente de verificación manual con los pasos exactos).

**Prompt:** "Ejecuta solo la Fase 4 del plan: corre todos los gates, corrige causas de fallo sin tocar pruebas y entrega el reporte final honesto con los pasos de verificación manual con dos supervisores."

---

## Anexo técnico

| Pieza | Base existente | Qué falta |
|---|---|---|
| Quién hizo el cambio | `supervisor_commands.actor_auth_id UUID NOT NULL` + índice `(actor_auth_id, created_at DESC)`; `create_supervisor_command` rechaza reemplazar el actor de un comando ajeno (SQL ya desplegado) | ✅ **Resuelto (Fase 0):** `actor_auth_id = auth.uid()` del emisor; comparable = `session.user.id` de `ensureSupervisorSession()`. Nombres humanos sin contrato → `actorLabel: 'Otro supervisor'` |
| Escucha en vivo | `useSupervisorControl` ya se suscribe a `postgres_changes` de `supervisor_commands` (filtro `target_device_id`) con poll de respaldo (~45 s) | ✅ **Resuelto (Fase 0):** viable sin duplicar canal — gate del canal = `Boolean(targetDeviceId)`; lista/conteos siguen tras `enabled` (`viewTab === 'control'`) |
| Etiquetas legibles | `supervisorControlService` (`COMMAND_TYPE_LABELS`, `getCommandTitle`/`getCommandDetails`) y `describeSupervisorCommand` del tracker | Reutilizar tal cual; no crear un segundo catálogo de textos |
| "Un cambio = un aviso" | `supervisorCommandTracker` (propuestas 1–2) con `buildCommandNotice`, `isCommandOutcomeOwned`, `subscribeSupervisorCommandTracker` | Dedupe por `commandId` entre el tracker y el aviso de equipo (solo lectura del tracker; su semántica no cambia) |
| Toast | `showToast` (`src/components/Toast.jsx`) | `tone: 'info'` para actividad de equipo; error solo para fallos reales |
| Dos supervisores por caja | `device_pairings.monitor_device_id` / `monitor_device_id_2` (máx. 2, migración `20261015_999_supervisor_pairing_two_devices.sql`) | El "otro" se define por `actor_auth_id`, no por slot de dispositivo (un mismo actor puede tener dos dispositivos) |
| Identidad de la caja emparejada | `useMonitorSync` / `supervisorPairingState` ya resuelven el `target_device_id` del monitor | Reutilizar esa resolución en la escucha de avisos |

**Lo que NO se toca:** el contrato de `supervisor_commands` y sus RPCs (TTL, claim/lease, ACK, `published_pending`), la semántica de reintentos del sender de lote, el journal de la caja, `useMonitorSync` (que sigue sin escuchar `supervisor_commands`, por contrato de su test de ciclo de vida), y el tracker de resultados (solo se consulta).

**Riesgos y límites:** (1) Realtime puede estar degradado — el poll de respaldo del panel cubre el hueco, pero un aviso puede llegar tarde; el texto no promete tiempo real. (2) Con la app del supervisor cerrada no hay avisos: el catch-up acotado solo cubre lo visto al volver a abrir (sin historial ilimitado). (3) Si dos supervisores comparten sesión (mismo `actor_auth_id`), el aviso de equipo no distingue entre ellos — decisión honesta de Fase 0: reportarlo en vez de adivinar. (4) El rendimiento depende de no crear canales Realtime extra por pestaña abierta/cerrada. (5) Trampa de nombres heredada: `useRemoteCommands` llama `monitorDeviceId` a `row.actor_auth_id` — es un auth uid; jamás compararlo con `pda_device_id` (Fase 2). (6) El enum de `status` desplegado incluye `cancelled`/`expired` más allá del CHECK del SQL raíz — no hardcodear estados (Fase 1).
