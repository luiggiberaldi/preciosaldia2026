# Plan de fixeo: resiliencia de envío Supervisor → Caja (internet lento e intermitente)

> **Modo de ejecución:** una sola fase por interacción. Leer esta guía y solo los archivos de la fase actual. No anticipar fases, no inventar contratos ni modificar archivos fuera de la lista. Al terminar, reportar cambios, pruebas, resultado y bloqueos; esperar autorización para la siguiente fase.

## Objetivo y límites

Que una orden del Supervisor sobreviva cortes de red de 1–5 minutos y que un error de transporte **nunca** pierda ni duplique una orden. Hoy: el TTL de toda orden es 60 s (`SUPERVISOR_COMMAND_TTL_MS`), un fallo de red en el INSERT no se reintenta, y `CHANNEL_ERROR` en la espera del ACK resuelve `failed` inmediatamente aunque la caja haya trabajado bien.

**Stack verificado en el repo:** JavaScript ESM, React, Supabase JS/PostgREST/Realtime, PostgreSQL (RPCs `create/claim/ack_supervisor_command`), Vitest, React Testing Library, Vite. No instales paquetes ni toques lockfiles.

**No incluido:** desplegar, ejecutar SQL en producción, commit/push, outbox persistente del sender (backlog), transporte alternativo (WebSockets propios, colas externas), cambios en `useMonitorSync` ni en el pipeline de sincronización de datos (solo comandos).

## Por qué esto y no más

| Fase | Cambio | Impacto | Riesgo | Por qué ahora |
|---|---|---|---|---|
| 1 | Reintentos idempotentes del create (R1) | Alto | Bajo | Un corte de 2 s hoy pierde el envío; el `command_id` PK ya hace el reintento seguro |
| 2 | Sesión + pairing en paralelo (R5) | Bajo | Muy bajo | −1 round-trip por envío; quick win |
| 3 | ACK degradado a polling (R4) | Medio | Bajo | Elimina falsos "timeout" cuando el canal del supervisor cae |
| 4 | Reconciliación al recuperar red (R3) | Medio | Bajo | Recuperación en ~1 s en vez de esperar el backoff de hasta 20 s |
| 5 | TTL por tipo + migración (R2) | Alto | Medio | El cuello real para internet intermitente; exige migración y orden de rollout |

**Fuera de alcance (backlog):** outbox persistente generalizado en el sender, UI de "conexión inestable" avanzada, métricas remotas de latencia.

## Reglas obligatorias para cada fase

1. Confirma branch y `git status`; nunca descartes ni incluyas cambios previos de otros hilos.
2. Relee los archivos de la fase antes de editar; los números de línea de este plan pueden haberse movido.
3. Antes de editar, resume el comportamiento actual, archivos que cambiarán y criterio de éxito. Si el repo contradice este plan, **detente y pregunta; no adivines**.
4. Trabaja solo en la fase autorizada. Nada de refactors ni "limpieza" colateral.
5. Añade primero la prueba que detecta el defecto, confirma que falla por la causa prevista, implementa el cambio mínimo y vuelve a correrla.
6. No debilites pruebas ni añadas supresiones de lint para pasar. Revisa el diff final.
7. **Ningún SQL se ejecuta en producción desde este plan.** La migración de la Fase 5 solo se escribe como archivo; su aplicación requiere aprobación explícita aparte.
8. Al cerrar una fase: handoff con archivos editados, comportamiento, comandos/resultados, riesgos y siguiente fase permitida.

## Criterios globales de aceptación

- **Nunca dos comandos por una intención:** todo reintento reutiliza el mismo `commandId`; la RPC `create_supervisor_command` ya es idempotente por payload idéntico y rechaza reutilización con payload distinto.
- **Un error de red jamás es una conclusión cierta:** solo los estados terminales del servidor (`applied`, `applied_with_warnings`, `rejected`, `failed`, `cancelled`) son definitivos; todo lo demás es `timeout`/`uncertain` y reconciliable.
- **Compatibilidad descendente segura:** un receiver sin actualizar rechaza explícitamente órdenes con duración TTL > 60 s (`rejected` con "Comando expirado o TTL inválido"); nunca las aplica parcialmente. El TTL extendido solo se emite con la migración aplicada y el flag habilitado.
- La validación de autoridad no se relaja: pairing/RLS/triggers del servidor siguen mandando; las cachés y reintentos del cliente solo afectan UX.
- Comandos de prueba: `npx vitest run <tests de la fase> --pool=forks --maxWorkers=1` y `npm run lint:supervisor` en verde.

---

## Fase 0 — Reconocimiento seguro (solo lectura)

**Objetivo:** confirmar que el plan corresponde al checkout actual.

**Leer/buscar:** `src/services/supervisorCommandService.js` (`sendSupervisorCommand`, `waitForCommandAck`, `SUPERVISOR_COMMAND_TTL_MS`), `src/services/supervisorContracts.js` (`COMMAND_TTL_MS`, `validateSupervisorCommand`), `src/hooks/useRemoteCommands.js` (`ackCommand`, `getRecoveryDelayMs`, `scheduleRecovery`), `src/config/supervisorPolicy.js`, `supabase_supervisor_commands.sql` (validación `p_expires_at - p_issued_at > interval '60 seconds'`), `supabase/migrations/20261016_supervisor_inventory_batch_v2.sql`, `tests/supervisorCommands.test.js`, `tests/supervisorRemoteCommandsRecovery.test.jsx`.

**Acciones:** `git status --short`, rama actual, verificar que los tests nombrados existen y pasan hoy. No modificar nada.

**Salida/gate:** reportar el estado base (tests en verde), discrepancias y si hay trabajo previo solapado.

**Prompt:** "Ejecuta solo la Fase 0 de [este plan](docs/plans/2026-10-17-plan-fix-resiliencia-envio-supervisor.md). Solo lectura; devuelve branch/status, símbolos confirmados, tests base y discrepancias."

## Fase 1 — Reintentos idempotentes del create (R1)

**Archivos permitidos:** `src/services/supervisorCommandService.js`, `tests/supervisorCommands.test.js`.

**Cambio:** envolver el RPC `create_supervisor_command` de `sendSupervisorCommand` en un reintento acotado (3 intentos, backoff 1 s → 2 s con jitter) **solo ante errores de transporte** (sin `status` HTTP, `status >= 500`, `fetch failed`, abortos de red). Nunca reintentar errores de validación/autoría (400/401/403/404/422, "Ventana temporal inválida", "Monitor no autorizado", "command_id ya utilizado con otro payload"). El `commandId`, `issuedAt` y `expiresAt` se construyen **una sola vez** antes del primer intento y viajan idénticos en cada reintento (la RPC devuelve la fila existente si el payload coincide). Presupuesto total de reintentos ≤ ~10 s para quedar dentro del TTL de 60 s. Reutilizar la clasificación de errores reintentables ya existente (`isRetryableAckError` en `useRemoteCommands.js`): exportarla desde allí o duplicar un helper mínimo en el servicio — sin crear imports circulares (`useRemoteCommands` ya importa de `supervisorCommandService`).

**Pruebas:** (a) primer intento falla con `fetch failed`, segundo crea la orden con **el mismo** `p_command_id` y el resultado es `ok`; (b) error 4xx no reintenta y propaga el mensaje; (c) reintento con respuesta perdida tras crear (la RPC devuelve la fila existente) no cambia el resultado; (d) agotar intentos → `status: 'failed'` con `uncertain` implícito para el batch (sin afirmar rechazo).

**Comando:** `npx vitest run tests/supervisorCommands.test.js --pool=forks --maxWorkers=1`.

**Gate:** si la prueba no detecta la ausencia de reintentos antes del cambio, detenerse.

**Prompt:** "Ejecuta solo la Fase 1 del plan. Implementa reintentos idempotentes del create con el mismo commandId y sus pruebas. No cambies TTL ni la espera del ACK."

## Fase 2 — Sesión + pairing en paralelo (R5)

**Archivos permitidos:** `src/services/supervisorCommandService.js`, `tests/supervisorCommands.test.js`.

**Cambio:** en `sendSupervisorCommand`, lanzar `ensureSupervisorSession()` y `readPairingRow(...)` en paralelo (`Promise.all`) para ahorrar un round-trip. **Mitigación obligatoria:** si la lectura del pairing falla o viene vacía, repetirla una vez **después** de que la sesión esté asegurada (token fresco) antes de declarar `unauthorized`; la autoridad real sigue siendo el trigger/RLS del servidor en el INSERT.

**Pruebas:** ambas consultas se emiten solapadas (promesas diferidas); sesión expirada + pairing legítimo → con reintento tras `ensure` el envío procede; pairing sin vínculo → sigue `unauthorized` sin reintento infinito.

**Comando:** `npx vitest run tests/supervisorCommands.test.js --pool=forks --maxWorkers=1`.

**Gate:** no continuar si el caso de sesión expirada no queda cubierto.

**Prompt:** "Ejecuta solo la Fase 2 del plan. Paraleliza sesión+pairing con reintento de pairing tras asegurar sesión. No toques reintentos del create ni TTL."

## Fase 3 — La espera del ACK degrada a polling (R4)

**Archivos permitidos:** `src/services/supervisorCommandService.js`, `src/hooks/useRemoteCommands.js` (solo si hace falta reubicar `getRecoveryDelayMs` para evitar imports circulares), `tests/supervisorCommands.test.js`.

**Cambio:** en `waitForCommandAck`, ante `CHANNEL_ERROR`/`TIMED_OUT` del canal de ACK **no resolver `failed`**. En su lugar, degradar a lecturas periódicas de `readSupervisorCommandAck` con el mismo backoff+jitter del receptor (mover `getRecoveryDelayMs` y sus constantes a `supervisorCommandService.js` y re-exportar desde `useRemoteCommands.js` para no crear ciclo de imports), hasta el límite `SUPERVISOR_ACK_TIMEOUT_MS` (mantener 10 s; no ampliarlo en esta fase). Al vencer, una lectura final: si hay estado terminal se resuelve con él; si no, `timeout` (que el batch sender ya trata como `uncertain` + reconciliación). Se conserva la lectura inmediata anti-carrera (ACK que llega entre INSERT y suscripción).

**Pruebas:** (a) `CHANNEL_ERROR` + ACK terminal que aparece en la primera lectura → resuelve `ok`, no `failed`; (b) canal caído y sin ACK → sigue resolviendo `timeout` (nunca `rejected`/`failed`); (c) ACK por Realtime con canal sano → sin cambios; (d) el canal se limpia en todos los caminos (sin timers huérfanos).

**Comando:** `npx vitest run tests/supervisorCommands.test.js tests/supervisorAckBeforePublish.test.jsx --pool=forks --maxWorkers=1`.

**Gate:** correr también `tests/supervisorInventoryBatchSender.test.js` para confirmar que la semántica `timeout`/`uncertain` del batch no cambió.

**Prompt:** "Ejecuta solo la Fase 3 del plan. Degrada la espera ACK a polling ante caída de canal, con el backoff compartido. No cambies el timeout global ni el contrato del batch."

## Fase 4 — Reconciliación inmediata al recuperar red (R3)

**Archivos permitidos:** `src/hooks/useRemoteCommands.js`, `tests/supervisorRemoteCommandsRecovery.test.jsx` (y test nuevo solo si hace falta).

**Cambio:** en el receptor de la caja, escuchar `window` `online` y `visibilitychange` (visible): si el canal no está `SUBSCRIBED`, no hay recuperación en vuelo ni timer pendiente, ejecutar `loadPendingCommands()` de inmediato y resetear `recoveryAttempt`. Respetar el semáforo `recoveryInFlight` y limpiar listeners en el cleanup del efecto. **Lado sender fuera de alcance** (se documenta como posible continuación).

**Pruebas:** (a) evento `online` dispara la consulta inmediata con canal degradado; (b) `online` con canal `SUBSCRIBED` no consulta; (c) doble evento en ráfaga no duplica consultas (semáforo); (d) tras desmontar, los listeners quedan removidos.

**Comando:** `npx vitest run tests/supervisorRemoteCommandsRecovery.test.jsx --pool=forks --maxWorkers=1`.

**Gate:** no aumentar la frecuencia del polling periódico; este cambio solo adelanta el barrido a los eventos de reconexión.

**Prompt:** "Ejecuta solo la Fase 4 del plan. Añade reconciliación inmediata en online/visibilitychange con semáforo y cleanup. No cambies los delays del backoff."

## Fase 5 — TTL por tipo de comando + migración (R2)

**Archivos permitidos:** `src/services/supervisorCommandService.js`, `src/services/supervisorContracts.js`, `src/config/supervisorPolicy.js`, `supabase/migrations/` (un único archivo nuevo), `tests/supervisorCommands.test.js`, `tests/supervisorInventoryBatchSender.test.js`.

**Cambio:**

1. **Cliente:** TTL por tipo — `supervisor.inventory.batch.adjust`, `supervisor.product.*`, `supervisor.user.*` → **5 min**; `supervisor.shift.close`, `supervisor.shift.reopen`, `supervisor.rate.set` → **60 s** (sensibles al tiempo). La duración máxima aceptada por `validateSupervisorCommand` (receiver) sube al nuevo tope por tipo; la validación de "no expirado" (`now > expiresAt`) no cambia. El emisor usa el TTL extendido **solo si** el flag `SUPERVISOR_EXTENDED_TTL_ENABLED` está activo en `supervisorPolicy.js` (default `false` hasta confirmar la migración aplicada en producción); con flag apagado se emite 60 s exactamente como hoy.
2. **SQL (solo escribir el archivo, NO ejecutar):** nueva migración que relaja en `create_supervisor_command` la duración máxima (`p_expires_at - p_issued_at > interval '60 seconds'` → tope por tipo o global de 10 min como cota de seguridad) sin tocar la validación de `issued_at` ±2 min ni el resto del contrato. La migración es aditiva/reemplazo `CREATE OR REPLACE` de la función; reversión = volver a crear la función anterior (copiar el cuerpo actual en el `DOWN` o en comentario).

**Compatibilidad y orden de rollout (obligatorio):** (1) aplicar la migración en producción con aprobación explícita aparte; (2) desplegar el cliente actualizado en caja y monitores; (3) habilitar el flag. Un receiver sin actualizar rechaza una orden con TTL > 60 s con `rejected` explícito — fallo seguro, no silencioso — pero evitamos ese estado con el orden anterior. La caja que recupera órdenes vencidas (`expires_at.gt.now`) funciona sin cambios con cualquier TTL.

**Pruebas:** (a) sin flag, `expiresAt - issuedAt === 60_000` para todos los tipos; (b) con flag, batch/producto/usuario duran 5 min y shift/rate siguen en 60 s; (c) `validateSupervisorCommand` acepta la nueva duración y sigue rechazando excesos (>10 min) y expirados; (d) el payload enviado por `sendSupervisorInventoryBatch` mantiene `expectedStock` por línea (la mitigación ante aplicación tardía no cambia); (e) el validador del receiver con datos "legacy" (duración 60 s) sigue aceptando.

**Comando:** `npx vitest run tests/supervisorCommands.test.js tests/supervisorInventoryBatchSender.test.js --pool=forks --maxWorkers=1`.

**Gate:** no activar el flag ni enviar TTL extendido como parte de esta fase. Reportar el hash/estado de la migración como **pendiente de aplicación en producción**.

**Prompt:** "Ejecuta solo la Fase 5 del plan. TTL por tipo detrás de flag apagado por defecto + migración SQL solo como archivo. No ejecutes SQL ni actives el flag."

---

## Criterios de aceptación final del plan

- Con red intermitente simulada (intento fallto + recuperación), una orden de lote termina aplicada **una sola vez** o explícitamente incierta/reconciliable — nunca duplicada ni "rechazada" por fallo de transporte.
- El test de latencia existente (`tests/supervisorAckLatency.perf.test.jsx`) sigue pasando; reportar los números wall-clock de antes/después por fase como evidencia.
- `npm run lint:supervisor` en verde tras cada fase.
- Handoff final: qué fases quedan, estado de la migración de la Fase 5 (escrita / aplicada / flag) y recomendación de rollout.
