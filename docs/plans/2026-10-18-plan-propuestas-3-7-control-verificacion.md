# Plan: panel "Control" tipo recibo y sello "Aplicado y verificado" (Propuestas 3 y 7)

**Fecha:** 2026-10-18
**Origen:** [Propuestas: confirmación de cambios y panel de Control](2026-10-18-plan-propuestas-control-supervisor.md) — solo las propuestas 3 (panel Control con detalle de recibo) y 7 (sello de confirmación real). Continúa después de [Propuestas 1 y 2](2026-10-18-plan-propuestas-1-2-confirmar-y-resultado.md), ya implementadas: el tracker de resultados (`supervisorCommandTracker`) y el patrón "confirma y seguir" en las 8 rutas de envío.
**Requiere migraciones SQL:** no. Todo es cliente sobre `supervisor_commands`, `sync_documents` y los servicios existentes. (Opcional futuro: columna `applied_at`; hoy se deriva de `updated_at`.)

> **Modo de ejecución para LLM:** una sola fase por interacción. Revisar esta guía y los archivos de la fase actual. No anticipar fases ni inventar contratos. Al terminar, reportar cambios, pruebas, resultado y bloqueos; esperar autorización para la siguiente fase.

## El plan en lenguaje llano

Al terminar, el supervisor tendrá:

1. **Un panel "Control" como el de Donde Juancho:** cuatro contadores grandes (Sin subir · En espera de la caja · Aplicados por la caja · Anulados/cancelados), filtros (Todos / Pendientes / Aplicados / Anulados / Rechazados) y **una ficha por cada cambio, como un recibo**: qué producto, qué se pidió ("AJUSTE DE STOCK (+8)"), el detalle ("Stock: +8 unidades"), quién lo pidió, la hora de envío, la hora de aplicación, la fecha y el sello final.

2. **Dos sellos de confirmación, honestos:**
   - **"Recibido por la caja"** — la caja recibió y aplicó la orden (respuesta rápida).
   - **"Aplicado y verificado"** — además se comprobó que el cambio quedó reflejado en el inventario o datos que la caja devuelve (el "eco"). El sello del panel es siempre el segundo cuando hay tiempo de verificar.
   - Y si el eco **no** coincide con lo pedido, sello rojo **"No coincide — revisar"** en vez de una falsa tranquilidad.

La regla de Donde Juancho que guía todo: **"la igualdad de stock no basta"** — aplicado significa probado.

## Objetivo y límites

- **Objetivo 1 (Propuesta 3):** panel Control con 4 contadores, filtros y fichas tipo recibo por comando (qué, quién, cuándo se pidió, cuándo se aplicó, sello).
- **Objetivo 2 (Propuesta 7):** sello de dos niveles "Recibido por la caja" → "Aplicado y verificado", con detección de discrepancia ("No coincide — revisar") basada en el eco real (`sync_documents` que la caja publica).
- **No incluido:** etiquetas por producto en el catálogo (propuesta 4), cola local con mando (5), anulación mejorada (6 — la anulación básica ya existe), avisos de otros supervisores (8). Desplegar, ejecutar SQL, commit/push, dependencias nuevas o lockfiles tampoco.

## Reglas obligatorias para cada fase

1. Confirmar branch y `git status`; no descartar ni sobrescribir cambios de otros hilos (el working tree ya tiene trabajo previo sin commitear: se respetan todos esos archivos).
2. Releer los archivos de la fase; los números de línea pueden estar obsoletos.
3. Antes de editar, resumir comportamiento actual, archivos y criterio de éxito. Si el repo contradice este plan o falta un archivo, **detenerse y preguntar**.
4. Solo la fase autorizada; sin refactors ajenos.
5. Pruebas primero (que fallen por la causa prevista), luego el cambio mínimo, volver a correr.
6. No debilitar pruebas ni ocultar errores; revisar el diff final.
7. Sin SQL remoto, despliegues, commits ni push.
8. Handoff al cerrar cada fase; no continuar automáticamente.

## Criterios globales de aceptación

- El panel muestra 4 contadores coherentes con los estados reales de `supervisor_commands` (incluido lo local en vuelo vía tracker) y 5 filtros que nunca pierden ni duplican comandos.
- Cada ficha es un recibo completo: producto/cambio, tipo legible, detalle del movimiento, actor, hora de envío (`issued_at`/`created_at`), hora de aplicación (`updated_at` en estado terminal), fecha y sello.
- Todo comando aplicado pasa por los dos sellos: "Recibido por la caja" primero y "Aplicado y verificado" cuando el eco lo confirma; si el eco contradice el resultado, "No coincide — revisar" (nunca un verde falso).
- La verificación no se limita al stock: al menos inventario (stockAfter del ACK vs eco), productos (creado/actualizado/borrado presente/ausente en el eco) y tasa (modo de tasa activo en el eco).
- El panel sigue siendo utilizable sin conexión (muestra lo cacheado con "Sin conexión" honesto) y no rompe el flujo "confirma y seguir" ya implementado.
- `bun run lint:supervisor`, `bun run typecheck`, `bun run test:supervisor`, `bun run test` y `bun run build` en verde.

---

## Fase 0 — Reconocimiento seguro (solo lectura)

**Objetivo:** confirmar contratos antes de tocar código.

**Leer/buscar:** `src/components/Monitor/SupervisorControlPanel.jsx` completo, `src/services/supervisorControlService.js` (estados, filtros, `getCommandTitle`/`getCommandDetails`, RPC de conteos y `cancel_supervisor_command`), `src/hooks/useSupervisorControl.js`, forma del snapshot en `sync_documents` (`src/hooks/useCloudSync.js`, `src/hooks/useMonitorSync.js`, `isNewerSyncDocument`), `src/services/supervisorCommandDiagnostics.js` (`recordReconciliation`), `src/services/supervisorCommandTracker.js`, tests `supervisorControl.test.js`, `supervisorSyncEcho.test.jsx`, `supervisorCommandDiagnostics.test.js`.

**Salida/gate:** forma exacta del eco (qué campos del snapshot contienen productos/stock/usuarios/tasa), cómo se deriva `updated_at` en estado terminal, qué devuelve el RPC de conteos (¿incluye `local_pending`/`expired`?), y estado actual del panel. Si el eco no contiene un campo necesario para verificar un tipo de cambio, decirlo y ajustar el alcance de la Fase 2 en vez de inventar datos.

**Prompt de fase:** "Ejecuta solo la Fase 0 de [este plan](docs/plans/2026-10-18-plan-propuestas-3-7-control-verificacion.md). Solo lectura; no edites. Devuelve branch/status, forma del eco, campos verificables por tipo de comando y contratos del panel actual."

## Fase 1 — Núcleo: evaluador de verificación (propuesta 7, test primero)

**Archivos permitidos:** nuevo `src/services/supervisorCommandVerification.js`, nuevo `tests/supervisorCommandVerification.test.js`. Nada más.

**Cambio:** módulo puro (sin React) que decide el sello de un comando a partir del ACK y del eco:

- API: `evaluateCommandVerification({ command, ack, snapshot })` → `{ level: 'received' | 'verified' | 'mismatch', checkedAt, detail }`.
  - `received` — aún sin eco posterior al comando (recién aplicado).
  - `verified` — el eco confirma el efecto pedido. Reglas por tipo:
    - `supervisor.inventory.batch.adjust` / ajustes de stock: el stock del producto en el eco **igual al `stockAfter` del ACK** (para todas las líneas; con tolerancia numérica 1e-9). "La igualdad de stock no basta": si el ACK no trae `stockAfter`, `verified` solo si el eco trae traza/movimiento del comando; si no hay traza, `mismatch` suave a `received` + `detail` explicando que falta la cifra para verificar.
    - `supervisor.product.create` / `update` / `delete`: el producto existe/ausente en el eco y sus campos editados coinciden con el `patch`.
    - `supervisor.rate.set`: el modo de tasa activo en el eco coincide con `rateMode`.
    - `supervisor.user.*`: el usuario existe/ausente/coincide en el eco.
    - `supervisor.shift.*`: comprobación mínima (estado del turno en el eco); si el eco no trae turnos, `received` con `detail` honesto (sin verificar) — **nunca inventar "verificado"**.
  - `mismatch` — el eco es posterior al comando pero el efecto pedido no se ve (o se ve otra cosa): sello rojo "No coincide — revisar" con el detalle de la diferencia.
- `getVerificationMeta(level)` → etiqueta y tono para la UI (`Recibido por la caja`, `Aplicado y verificado`, `No coincide — revisar`).
- Umbral de espera: `VERIFICATION_GRACE_MS` (p. ej. 15 s tras el ACK antes de esperar el eco); antes de eso, `received` sin alarmar.

**Pruebas:** tabla por tipo de comando con eco correcto → `verified`; eco desalineado → `mismatch` con detalle; sin eco todavía → `received`; stockAfter ausente → nunca `verified` sin traza (regla "la igualdad de stock no basta"); tolerancia decimal; snapshot incompleto → `received` con detalle, jamás `verified`.

**Comando:** `npx vitest run tests/supervisorCommandVerification.test.js --pool=forks --maxWorkers=1`.

**Gate:** el test debe fallar antes de implementar y pasar después; ningún caso puede producir `verified` sin comprobación real.

**Prompt:** "Ejecuta solo la Fase 1 del plan. Crea el evaluador de verificación con sus pruebas (test primero), cubriendo todos los tipos de comando, mismatch y la regla de 'la igualdad de stock no basta'. No toques aún el panel."

## Fase 2 — Cableado: el eco marca el sello (propuesta 7 en vivo)

**Archivos permitidos:** `src/hooks/useMonitorSync.js` o `src/views/OwnerMonitorView.jsx` (el lugar del eco ya existente), `src/services/supervisorCommandDiagnostics.js` (registro de verificación), `src/services/supervisorCommandTracker.js` (exponer nivel en su estado, sin duplicar avisos), tests `supervisorSyncEcho.test.jsx` o uno nuevo `tests/supervisorVerificationWiring.test.jsx`.

**Cambio:** cuando el monitor aplica un eco (`sync_documents`) posterior al comando, evaluar `evaluateCommandVerification` para los comandos recientes (aplicados en los últimos N minutos o en vuelo) y registrar el nivel (`recordVerification`, análogo a `recordReconciliation`). El tracker refleja el nivel en su estado para que los avisos y badges muestren el sello sin lanzar un segundo toast de éxito (la regla "un cambio = un aviso" se conserva: el sello es estado, no un aviso nuevo; solo un `mismatch` merece un aviso rojo aparte, porque es una alerta, no un resultado).

**Pruebas:** eco correcto tras ACK → nivel `verified` registrado; eco desalineado → `mismatch` + aviso rojo único; eco sin comando reciente → sin registros espurios; recarga de página pierde el sello (es derivado) sin romper el panel.

**Comando:** `npx vitest run tests/supervisorSyncEcho.test.jsx tests/supervisorCommandVerification.test.js --pool=forks --maxWorkers=1` (y el wiring nuevo si se crea).

**Gate:** ningún camino produce dos toasts para el mismo comando; el `mismatch` siempre avisa.

**Prompt:** "Ejecuta solo la Fase 2 del plan. Conecta el eco existente con el evaluador y registra los sellos; solo un mismatch dispara aviso. No cambies el panel todavía."

## Fase 3 — Fichas tipo recibo (núcleo de la propuesta 3)

**Archivos permitidos:** `src/services/supervisorControlService.js` (o nuevo `src/services/supervisorCommandReceipt.js`), tests `supervisorControl.test.js` y/o nuevo `tests/supervisorCommandReceipt.test.js`.

**Cambio:** transformar cada fila de `supervisor_commands` en una **ficha-recibo** legible (inspirada en `monitorCommandDetails.js` de Donde Juancho, adaptada a los datos reales de PreciosAlDía):

- `getCommandReceipt(command)` → `{ title, typeLabel, detailLines, actorLabel, sentAt, appliedAt, dateLabel, seal, verification }`:
  - `title`: nombre del producto/usuario afectado (del payload o del eco) o descripción llana.
  - `typeLabel`: tipo legible con el delta, p. ej. "AJUSTE DE STOCK (+8)", "CAMBIO DE TASA", "BAJA DE PRODUCTO" (ampliar `COMMAND_TYPE_LABELS` con el delta del payload; reutilizar `describeSupervisorCommand` del tracker como referencia de estilo).
  - `detailLines`: chips p. ej. "Stock: +8 unidades", "Motivo: …", "Modo: bcv".
  - `actorLabel`: "Por: Supervisor" (hoy `actor_auth_id`; sin resolver nombres sin contrato existente).
  - `sentAt`/`appliedAt`/`dateLabel`: `issued_at`/`created_at`, `updated_at` terminal, "APLICADO EN CAJA EL 18/10/2026" (formato `dd/mm/aaaa`).
  - `seal`: sello final visible ("Aplicado por la caja") + `verification` del evaluador de la Fase 1-2.
- Timestamps derivados: si el estado no es terminal, `appliedAt` es `null` y el sello es el de espera.

**Pruebas:** para cada tipo de comando, la ficha tiene título, delta cuando aplica, chips, timestamps y sello; formato de fecha/hora es-VE; comando no terminal sin `appliedAt`; comando sin eco con `verification: 'received'`.

**Comando:** `npx vitest run tests/supervisorControl.test.js tests/supervisorCommandReceipt.test.js --pool=forks --maxWorkers=1` (los que existan).

**Gate:** ninguna ficha inventa datos que el payload/eco no tengan (usar "—" o el detalle honesto).

**Prompt:** "Ejecuta solo la Fase 3 del plan. Construye las fichas-recibo con sus pruebas sobre los datos reales de supervisor_commands. No rediseñes el panel todavía."

## Fase 4 — Rediseño del panel Control (propuesta 3 completa)

**Archivos permitidos:** `src/components/Monitor/SupervisorControlPanel.jsx`, `src/hooks/useSupervisorControl.js` (conteos), `src/views/OwnerMonitorView.jsx` (solo el montaje del panel si hace falta), `tests/supervisorControl.test.jsx` (nuevo de componente si se necesita) y los tests de la Fase 3.

**Cambio:** aplicar el diseño de Donde Juancho sobre el motor existente:

- **Cuatro contadores grandes:** *Sin subir (en navegador)* = tracker en vuelo + `local_pending` · *En espera de la caja* = `pending`/`received` · *Aplicados por la caja* = `applied` + `applied_with_warnings` · *Anulados/cancelados* = `cancelled` (+ `expired` con nota). Los conteos del RPC ya existen; mapearlos a estas cuatro tarjetas (ampliar el RPC solo si falta `expired`/`local_pending` — **en cliente**, sin SQL: derivar del listado + tracker).
- **Filtros:** Todos (n) / Pendientes (n) / Aplicados (n) / Anulados (n) / Rechazados (n) — reorganizando `CONTROL_FILTERS` a estos cinco (las advertencias quedan como badge dentro de "Aplicados"); los conteos de cada filtro vienen del listado/RPC.
- **Fichas-recibo** de la Fase 3: una por comando, con sello de la propuesta 7 ("Recibido por la caja" → "Aplicado y verificado" → "No coincide — revisar") y el resumen "Enviado: 07:04 · Aplicado a las 07:04", "Por: Supervisor", "APLICADO EN CAJA EL 18/10/2026".
- **Conservar** el detalle técnico actual (`ack_payload`, `error_message`) detrás de un "Ver detalle técnico" plegable — es auditable sin ensuciar la ficha.
- Estados vacíos honestos ("Todavía no hay cambios registrados"), y si el RPC de conteos falla, el fallback local actual sigue funcionando (sin pantallas rotas).

**Pruebas (componente):** render con comandos de muestra → contadores correctos, filtros funcionan (cada comando aparece en su filtro y solo en los que le tocan), ficha muestra recibo completo y sello; `mismatch` pinta la ficha en rojo; plegar/desplegar detalle técnico; sin comandos → estado vacío.

**Comando:** `npx vitest run tests/supervisorControl.test.js tests/supervisorCommandReceipt.test.js tests/supervisorOutcomeNotices.test.jsx --pool=forks --maxWorkers=1` y el test de componente nuevo.

**Gate:** los contadores cuadran con el total del listado; ningún filtro oculta comandos que su contador promete.

**Prompt:** "Ejecuta solo la Fase 4 del plan. Rediseña el panel con los 4 contadores, 5 filtros y las fichas-recibo con sellos; conserva el detalle técnico plegable y el fallback sin RPC."

## Fase 5 — Verificación completa

**Archivos permitidos:** solo corrección de defectos, en los archivos ya tocados.

**Comandos y resultado esperado:**

1. `bun run lint:supervisor` — 0 errores.
2. `bun run typecheck` — 0 errores.
3. `bun run test:supervisor` — todo pasa.
4. `bun run test:supervisor-echo` y `bun run test` — regresión general en verde.
5. `bun run build` — compila.

**Gate final:** recorrer los criterios globales y confirmar cada uno con una prueba o registro concreto; reportar como limitación lo no cubierto (p. ej. verificación de turnos si el eco no la permite).

**Prompt:** "Ejecuta solo la Fase 5 del plan: verificación completa con los comandos listados, corrección mínima de defectos y reporte honesto."

---

## Anexo técnico (base verificada el 2026-10-18)

- **Panel actual:** `SupervisorControlPanel.jsx` (lista + modal de detalle con `error_message` y `ack_payload` crudo), `useSupervisorControl.js` (poll 45 s + `postgres_changes` sobre `supervisor_commands`, cancel/retry — retry ya trackeado por la propuesta 1-2), `supervisorControlService.js` (`CONTROL_STATUS` con `local_pending`/`received`/`expired`/`conflict`, `CONTROL_FILTERS` (6 hoy), `COMMAND_TYPE_LABELS`, `getControlStatusMeta`, `matchesControlFilter`, `getCommandTitle`, `getCommandDetails`, `fetchSupervisorControlCommands/Counts/Detail`, `cancelSupervisorCommand` vía RPC `cancel_supervisor_command`).
- **Estados terminales:** `applied`, `applied_with_warnings`, `rejected`, `failed`, `cancelled`; `expired` derivado de `pending` + `expires_at`; `received` = reclamado por la caja (Fase 7 del receptor, "received nunca expira").
- **Eco/verificación:** la caja publica `sync_documents` por dispositivo; el monitor los aplica en `useMonitorSync` (`enqueueDocApplication`, watermark `isNewerSyncDocument`). El ACK global trae `ack_payload` (p. ej. `stockAfter` en ajustes de inventario). La regla "la igualdad de stock no basta" se materializa en `evaluateCommandVerification` (Fase 1): coincidencia de stock es requisito mínimo y, sin `stockAfter` ni traza, jamás se emite `verified`.
- **Tracker (propuestas 1-2, ya implementadas):** `src/services/supervisorCommandTracker.js` — `trackSupervisorCommand`, `subscribeSupervisorCommandTracker`, `getTrackedSupervisorCommands`, `isCommandOutcomeOwned`, `buildCommandNotice`, `describeSupervisorCommand`; regla "un cambio = un aviso" (el sello de la propuesta 7 es estado, no un toast nuevo).
- **Timestamps:** `issued_at`/`created_at` (envío), `updated_at` (última transición; se usa como hora de aplicación cuando el estado es terminal). Sin migración; si en el futuro se añade `applied_at`, la ficha lo preferirá.
- **Formato visual de referencia:** Donde Juancho `MonitorCambiosTab.jsx` + `monitorCommandDetails.js` (fichas tipo recibo, contadores, filtros, sello "Aplicado por la caja"); capturas del panel adjuntadas en la conversación del 2026-10-18.
- **Qué no se toca:** contrato `supervisor_commands` y sus RPCs, TTL/claim/ACK, el journal `published_pending`, la semántica de reintentos del sender de lote, y las propuestas 4, 5, 6 y 8 (siguientes planes).
