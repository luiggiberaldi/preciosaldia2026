# Plan por fases: flujos de artículos e inventario del Supervisor

> **Modo de ejecución para LLM Flash:** ejecutar una sola fase por interacción. Leer esta guía y solo los archivos de la fase actual. No anticipar fases, no inventar contratos ni modificar archivos fuera de la lista. Al terminar, reportar cambios, pruebas, resultado y bloqueos; esperar autorización para la siguiente fase.

## Objetivo y límites

Corregir edición remota de productos e inventario: proteger stock e historial, evitar conflictos perdidos, manejar unidades con conversión canónica, procesar lotes sin duplicación y mostrar estados reales de los comandos.

**Stack verificado en el repo:** JavaScript ESM, React, Supabase JS/PostgREST/Realtime, IndexedDB mediante localForage, PostgreSQL, Vitest, React Testing Library, Playwright y Vite. `package.json` declara `bun@1.1.0`, pero el checkout tiene `bun.lock` y `package-lock.json`; no instales paquetes ni regenere/modifiques ninguno de los lockfiles. Ejecuta los comandos de test ya indicados y no cambies el gestor durante esta tarea.

**No incluido:** desplegar, ejecutar SQL en producción, modificar datos productivos, hacer commit/push, reescribir migraciones aplicadas, añadir dependencias o ampliar funciones ajenas a estos flujos. Eso requiere una instrucción explícita separada.

## Reglas obligatorias para cada fase

1. Confirma branch y `git status`; nunca descartes, sobrescribas ni incluyas cambios previos del usuario. El plan y los cambios del checkout pueden ser de otros hilos.
2. Relee los archivos de la fase y busca los símbolos descritos; los números de línea de planes anteriores pueden estar obsoletos.
3. Antes de editar, resume en pocas líneas el comportamiento actual, archivos que cambiarán y criterio de éxito. Si el repo contradice este plan, hay archivo faltante o no se puede probar una premisa, **detente y pregunta; no adivines**.
4. Trabaja solo en la fase autorizada. No hagas refactors, “limpieza”, cambios de formato masivos ni tareas de fases futuras.
5. Añade/modifica primero pruebas enfocadas; corre la prueba pertinente y confirma que detecta el defecto. Luego implementa el cambio mínimo y vuelve a correrla.
6. No debilites pruebas, no ocultes errores, no añadas supresiones de lint/tipos para pasar. Revisa el diff final y comunica exactamente qué pasó y qué no se pudo comprobar.
7. No ejecutes migraciones remotas ni pruebas destructivas contra producción. No hagas commit/push/deploy.
8. Al cerrar una fase, entrega un handoff: archivos editados, comportamiento cambiado, comandos/resultados, riesgos/bloqueos y siguiente fase permitida. No continúes automáticamente.

## Criterios globales de aceptación

- Editar datos maestros no cambia stock ni movimientos; una revisión obsoleta se rechaza sin escribir.
- UI y caja interpretan las mismas unidades, factores y reglas de precisión.
- Caja recalcula desde cantidad/unidad originales y el producto local actual; no confía en un delta del Supervisor.
- Un lote se valida completo antes de mutar y no duplica movimientos tras reintentos, repetición de Realtime o reinicio.
- Error de validación/conflicto deja catálogo e historial intactos. Si una escritura parcial no puede revertirse o recuperarse con certeza, el resultado se marca como incierto, se bloquean nuevos movimientos afectados y se detiene el rollout: nunca afirmar “rechazado” ni permitir reenvío ciego.
- Fallo al publicar snapshots después de la aplicación local no se representa como fallo de aplicación. Se mantiene el mismo `commandId`, se reintenta sincronización y se informa `applied_with_warnings` solo si el contrato backend/UI lo soporta.
- Claim, cancelación, ACK y recuperación tienen transiciones inequívocas; dos supervisores siguen autorizados en cada RPC/trigger que valida identidad.
- `expired` se muestra derivado de `pending` + `expires_at`, salvo que se diseñe y migre explícitamente un estado persistido.
- Ningún despliegue/cambio productivo forma parte de estas fases.

---

## Fase 0 — Reconocimiento seguro (solo lectura)

**Objetivo:** confirmar que el plan sigue correspondiendo al checkout y conocer contratos reales antes de tocar código.

**Leer/buscar:** `package.json`, `src/services/supervisorProductCommand.js`, `src/services/supervisorContracts.js`, `src/services/supervisorInventoryCommand.js`, `src/services/supervisorInventoryBatchSender.js`, `src/services/supervisorCommandService.js`, `src/hooks/useRemoteCommands.js`, `src/services/supervisorControlService.js`, migraciones supervisor bajo `supabase/migrations/`, y sus tests.

**Acciones:** `git status --short`, rama actual, buscar implementación de `storageService.setItem`, `withLock`, `pushCloudSync` y los tests nombrados por fases. No modificar archivos.

**Salida/gate:** informar contrato de comando/estados actual, cuáles archivos están ya modificados y si los tests nombrados existen. Si hay trabajo previo que se solapa, no lo sobrescribir; solicitar decisión antes de continuar.

**Prompt de fase:** “Ejecuta solo la Fase 0 de [este plan](docs/plans/2026-10-15-plan-fix-flujos-supervisor.md). Solo lectura; no edites ni ejecutes SQL. Devuelve branch/status, rutas y símbolos confirmados, tests existentes y discrepancias/bloqueos.”

## Fase 1 — Proteger stock al editar un producto

**Archivos permitidos:** `src/components/Monitor/RemoteProductFormModal.jsx`, `src/services/supervisorProductCommand.js`, `tests/supervisorProductCommand.test.js` (y el test de componente solo si ya existe y hace falta).

**Cambio:** patch de edición con allowlist de campos maestros visibles. Excluir stock, stock inicial, lotes, timestamps incluidos por el formulario y datos de movimientos. La caja debe preservar stock del producto local incluso ante payload manipulado. Creación conserva el comportamiento de stock inicial.

**Pruebas:** patch adversarial con stock/stockInLotes/updatedAt viejos; verificar stock actual, movimientos y otros productos intactos. Ejecutar `npx vitest run tests/supervisorProductCommand.test.js --pool=forks --maxWorkers=1` y pruebas del componente si se añadieron.

**Gate:** no continuar si el test no falla antes del arreglo o si no se ha comprobado que creación mantiene stock inicial.

**Prompt:** “Ejecuta solo la Fase 1 del plan. Limita los cambios a los archivos permitidos. Añade la prueba adversarial, confirma que falla por la causa prevista, implementa la protección mínima y corre las pruebas listadas. No implementes control de versiones todavía.”

## Fase 2 — Rechazar ediciones basadas en una versión obsoleta

**Archivos permitidos:** `RemoteProductFormModal.jsx`, `supervisorProductCommand.js`, `supervisorContracts.js`, `tests/supervisorProductCommand.test.js`, `tests/supervisorCommands.test.js`.

**Cambio:** crear un helper puro y compartido que construya una revisión base como `JSON.stringify` de una tupla ordenada de los campos maestros editables. Normalizar `undefined` y `null` de forma consistente. Excluir stock, movimientos y campos no editables. El formulario envía esa revisión con la orden; la caja recalcula la misma tupla desde el producto local actual y exige igualdad exacta antes de aplicar el patch. Si no se puede generar/recalcular la revisión, rechazar y pedir recarga. No usar hora del cliente como control de concurrencia ni agregar dependencia hash/crypto.

**Pruebas:** misma revisión acepta; revisión distinta, ausente/inválida y fecha futura rechazan; cambio concurrente solo de stock se conserva y no se restaura desde el formulario.

**Comando:** `npx vitest run tests/supervisorProductCommand.test.js tests/supervisorCommands.test.js --pool=forks --maxWorkers=1`.

**Gate:** si los datos legacy no permiten formar una huella estable, detenerse y reportar la limitación antes de relajar el criterio.

**Prompt:** “Ejecuta solo la Fase 2 del plan. Primero comprueba cómo se serializa el producto. Implementa revisión optimista mínima compatible con legacy y sus pruebas. No cambies el diseño del formulario fuera de enviar la revisión base.”

## Fase 3 — Cargar factores de presentación al seleccionar producto

**Archivos permitidos:** `src/components/Monitor/SupervisorInventoryBatchPanel.jsx`, `src/components/Monitor/SupervisorInventoryBatchModal.jsx`, `src/services/supervisorInventoryDraft.js`, tests `supervisorInventoryBatchPanel.test.jsx` y `supervisorInventoryDraft.test.js`.

**Cambio:** selección carga el factor del producto. Unidades usa factor 1; volver a cajas/bultos restaura el factor configurado. Si se escribe en búsqueda, invalidar la selección anterior; no permitir añadir un producto que ya no corresponde al texto.

**Pruebas:** selección con factor 24, cambios unidad→caja/bulto, búsqueda parcial, selección nueva y producto sin factor.

**Comando:** `npx vitest run tests/supervisorInventoryBatchPanel.test.jsx tests/supervisorInventoryDraft.test.js --pool=forks --maxWorkers=1`.

**Gate:** comprobar comportamiento tanto en panel multiartículo como en modal individual; no introducir una segunda fuente de verdad del factor.

**Prompt:** “Ejecuta solo la Fase 3 del plan. Corrige selección/factor y búsqueda inválida en ambas interfaces. No añadas todavía unidades de granel ni cambies el contrato enviado a la caja.”

## Fase 4 — Conversiones de inventario a granel

**Archivos permitidos:** `supervisorContracts.js`, `src/services/supervisorInventoryCommand.js`, `src/services/supervisorInventoryDraft.js`, `src/components/Monitor/SupervisorInventoryBatchPanel.jsx`, `src/utils/granel.js` solo si falta un helper reutilizable y tests de inventario/granel.

**Antes de editar:** inspeccionar y reutilizar `isGranelProduct`, `isLiquidProduct`, `gramsToKg`, `mlToLiters`, `normalizeStockValue` y políticas actuales de `granel.js`. No dupliques ni contradigas esas reglas.

**Cambio:** permitir kg/g solo en granel sólido y lt/ml solo en granel líquido; unidades/cajas/bultos solo según presentación compatible. Mantener stock canónico kg/L o unidades; redondeo conforme a helper existente (máximo 3 decimales para granel; unidades contables enteras). Caja vuelve a calcular con producto actual.

**Pruebas:** `500 g → 0.5 kg`, `750 ml → 0.75 L`, `1.5 kg`, unidades incompatibles, producto no granel, fracciones contables y egreso insuficiente.

**Comando:** `npx vitest run tests/supervisorInventoryCommand.test.js tests/granelGuardrails.test.js tests/supervisorInventoryBatchPanel.test.jsx --pool=forks --maxWorkers=1`.

**Gate:** conversiones de ida y validación de unidad deben probarse independientemente; si no se puede inferir con certeza si el producto es sólido/líquido, rechazar y reportarlo, no adivinar.

**Prompt:** “Ejecuta solo la Fase 4 del plan. Reutiliza las funciones existentes de granel. Añade pruebas de conversión y unidades inválidas; no cambies todavía envío multiartículo ni SQL.”

## Fase 5 — Definir y validar el contrato JavaScript batch v2

**Archivos permitidos:** `src/services/supervisorContracts.js`, tests `supervisorCommands.test.js` y contrato inventario.

**Cambio:** definir payload con `batchVersion: 2` (no cambiar el `schemaVersion` global del comando, que puede tener otro alcance), una cabecera con dirección/motivo/referencia/categoría y `lines` acotado. Cada línea lleva producto, cantidad y unidad original, stock esperado y revisión cuando aplique. Factor/delta enviado no es autoritativo. Fijar en código/tests límites concretos para número máximo de líneas (elige un valor conservador y documenta el motivo), longitud de textos y rango numérico; no dejes límites como TODO. Consolidar líneas repetidas del mismo producto antes del envío. Mantener el validador v1 sin cambiar su semántica.

**Pruebas:** payload v1 sigue válido; v2 válido; array vacío/excesivo, campos faltantes, números no finitos/no positivos, unidades/motivos inválidos y schema desconocido se rechazan.

**Comando:** `npx vitest run tests/supervisorCommands.test.js tests/supervisorInventoryCommand.test.js --pool=forks --maxWorkers=1`.

**Gate:** no tocar SQL ni sender hasta que payload de ejemplo, límites y compatibilidad v1 queden escritos en tests.

**Prompt:** “Ejecuta solo la Fase 5. Define el contrato v2 en JavaScript y pruebas. Conserva sin cambios los payloads v1. No toques SQL, UI ni envío.”

## Fase 6 — Migración aditiva compatible de creación/validación

**Archivos permitidos:** una nueva migración con versión única bajo `supabase/migrations/` y `tests/supervisorSqlGuardrails.test.js`. Esta migración modifica solo la creación/validación de comandos; no cambia estados ni ACK.

**Previo obligatorio:** revisar patrón de versionado local y el ledger del entorno destino mediante acceso autorizado. Si no hay acceso al ledger, prepara SQL local con nombre único, pero no afirmes que está listo/aplicado en el destino. Nunca modificar una migración histórica.

**Cambio:** actualizar coherentemente RPC `create_supervisor_command` y trigger para aceptar payload v1 y `batchVersion: 2` durante rollout, validar límites del array y conservar autorización de `monitor_device_id` y `monitor_device_id_2`. Revisar grants y `search_path = public, extensions`; no conceder a `anon`. El trigger no conoce catálogo local: validar estructura/autorización allí; la caja valida factor/producto/stock.

**Pruebas:** guardrails inspeccionan RPC, trigger, allowlist, slots 1 y 2, roles, `search_path`, compatibilidad v1/v2 y límites. Revisar manualmente migración completa y `git diff`; tests estáticos no sustituyen ejecutar SQL en entorno local/staging autorizado.

**Gate:** no aplicar SQL remoto ni ejecutar contra producción. Si RPC/trigger existentes no pueden conservar ambas autorizaciones, parar y pedir revisión; no copiar funciones antiguas de un solo supervisor.

**Prompt:** “Ejecuta solo la Fase 6. Lee migraciones y ledger disponible; crea una migración aditiva nueva para creación/validación v1/v2, más guardrails. No cambies estados/ACK, no despliegues ni ejecutes SQL remoto. Si desconoces el ledger, indícalo y no inventes el estado del entorno.”

## Fase 7 — Máquina de estados, claim y cancelación

**Archivos permitidos:** `src/services/supervisorCommandService.js`, `src/hooks/useRemoteCommands.js`, `src/services/supervisorControlService.js`, una segunda migración nueva y única en `supabase/migrations/`, tests `supervisorCommands.test.js` y `supervisorControl.test.js`.

**Máquina de estados obligatoria:** `pending → received → applied | applied_with_warnings | rejected | failed`; `pending → cancelled`. Solo transiciones condicionales en backend pueden reclamar/cancelar. `received` es activo y recuperable por la misma caja/`commandId`; `cancelled`, `applied`, `applied_with_warnings`, `rejected` y `failed` son terminales e inmutables. `expired` se deriva únicamente cuando `status=pending && expires_at <= now`; un comando `received` no se expira automáticamente. Solo la caja autorizada puede reclamar/ACKear; Control solo puede cancelar con autorización válida. La migración de esta fase modifica estado/claim/ACK/cancelación, no vuelve a tocar la validación de payload de Fase 6 salvo que una prueba demuestre necesidad y se actualice el alcance antes de editar.

**Pruebas:** carreras claim-vs-cancel, ACK perdido y consulta posterior, cada estado terminal, expiración derivada, recuperación de `received` con mismo ID y autorización de ambos supervisores.

**Gate:** si el claim no es atómico o el backend no permite distinguir una orden ya reclamada, no implementar cancelación optimista en UI; parar. No aplicar SQL remoto.

**Prompt:** “Ejecuta solo la Fase 7. Lee el contrato v2 y la migración aprobada de Fase 6. Implementa la máquina de estados indicada, una migración nueva solo para estados/claim/ACK/cancelación y pruebas. No despliegues, no ejecutes SQL remoto y no cambies cálculo/UI fuera del estado.”

## Fase 8 — Cálculo batch puro en caja (sin persistencia)

**Archivos permitidos:** `src/services/supervisorInventoryCommand.js` y `tests/supervisorInventoryCommand.test.js`.

**Cambio:** crear cálculo puro que encuentre productos, valide todas las líneas contra estado/revisión/unidad actuales, calcule deltas y produzca catálogo e historial nuevos sin escribir. Si cualquier línea falla, no devuelve un plan aplicable parcial. IDs de movimientos deterministas por `commandId` + índice/ID de línea.

**Pruebas:** segunda línea conflictiva no produce ningún plan aplicable; éxito calcula stocks/movimientos completos; repetición produce IDs idénticos; líneas duplicadas siguen la política de Fase 5.

**Comando:** `npx vitest run tests/supervisorInventoryCommand.test.js --pool=forks --maxWorkers=1`.

**Gate:** ninguna llamada a storage ni red en la función pura.

**Prompt:** “Ejecuta solo la Fase 8. Implementa y prueba el cálculo puro de todas las líneas. No guardes datos, no publiques sync y no cambies el sender.”

## Fase 9 — Persistencia local y recuperación segura

**Archivos permitidos:** `src/services/supervisorInventoryCommand.js`, un helper local nuevo solo si es necesario, tests de transacción/recuperación.

**Antes de editar:** comprobar cómo `storageService.setItem` maneja errores: puede capturar errores y hacer fallback. No asumir que rechaza en fallo. Revisar `withLock` y almacenamiento disponible. Elegir persistencia que pueda detectar/verificar fallos.

**Cambio:** bajo `pos_write_lock`, validar el plan completo y usar una estrategia durable para los dos documentos: transacción IndexedDB si el storage existente la soporta; de lo contrario journal write-ahead recuperable. Journal incluye `commandId`, snapshots y estado. Fallo entre escrituras debe poder revertirse o recuperarse deterministicamente; si el resultado es incierto, bloquear nuevas operaciones de inventario afectadas y reportar estado recuperable, nunca `rejected`. Emitir eventos solo después del estado local consistente. No prometer ACID multi-documento sin prueba.

**Pruebas:** error de cada escritura, recarga con journal pendiente, recuperación repetida/idempotente, fallo al rollback y readers no observan un estado parcial (o política explícita de bloqueo/recovery). Simular cuota/IndexedDB donde los tests del repo permitan.

**Gate:** si no hay forma verificable de recuperación y los lectores pueden observar mezcla de documentos, detenerse y proponer diseño alternativo antes de conectar el sender.

**Prompt:** “Ejecuta solo la Fase 9. Primero prueba la semántica real del storage y lock. Implementa persistencia recuperable e idempotente más pruebas de fallos. Si la garantía no se puede demostrar, no continúes: informa el bloqueo.”

## Fase 10 — Enviar un único comando y reconciliar el mismo ID

**Archivos permitidos:** `src/services/supervisorInventoryBatchSender.js`, `src/components/Monitor/SupervisorInventoryBatchPanel.jsx`, `src/services/supervisorCommandService.js`, tests `supervisorInventoryBatchSender.test.js` y componente correspondiente.

**Cambio:** un envío multiartículo produce un comando batch v2 y un ACK global. Persistir/reutilizar el mismo `commandId` ante timeout; primero consultar estado, no crear otro comando. No mostrar líneas aplicadas hasta ACK global. Distinguir rechazado, pendiente/timeout, aplicado con advertencias y aplicado. No recomendar reenvío cuando estado sea incierto.

**Pruebas:** un solo `sendCommand`, un ACK, respuesta por línea derivada del ACK; timeout reconcilia mismo ID; rechazo deja todas pendientes; éxito cierra modal; estado incierto no duplica.

**Comando:** `npx vitest run tests/supervisorInventoryBatchSender.test.js tests/supervisorInventoryBatchPanel.test.jsx --pool=forks --maxWorkers=1`.

**Gate:** no habilitar v2 hasta que Fases 6–9 estén aprobadas en el entorno de desarrollo/staging.

**Prompt:** “Ejecuta solo la Fase 10. Cambia sender/UI para un comando y ACK global, con reconciliación del mismo ID. No cambies el receiver ni SQL fuera de los contratos ya aprobados.”

## Fase 11 — Reintento de publicación remota

**Archivos permitidos:** `src/services/supervisorInventoryCommand.js`, `src/hooks/useCloudSync.js` solo si imprescindible, pruebas de sync/inventario.

**Cambio:** verificar resultado real de publicar productos e historial. Como son documentos remotos separados, no llamarlos transacción remota. Fallo posterior al commit local queda warning recuperable, guarda qué clave falta y reintenta sin volver a aplicar el movimiento. ACK warning solo después de confirmar que el estado local sí quedó durable.

**Pruebas:** falla cada push en orden distinto, éxito de retry, reinicio con push pendiente y no duplicación. Asegurar que `applied_with_warnings` esté permitido en schema/RPC/UI antes de emitirlo.

**Gate:** si backend no acepta warning o la operación local no quedó durable, no emitir estado terminal falso; dejar pendiente y documentar reconciliación.

**Prompt:** “Ejecuta solo la Fase 11. Asegura retry idempotente de snapshots sin repetir mutación local. Prueba push parcial, reintento y reinicio. No afirmes atomicidad remota.”

## Fase 12 — Recuperación cuando Realtime se degrada

**Archivos permitidos:** `src/hooks/useRemoteCommands.js`, `src/services/supervisorCommandService.js`, `tests/supervisorLifecycle.test.js`, `tests/supervisorCommands.test.js`.

**Cambio:** fallback solo cuando canal no está `SUBSCRIBED`; no polling mientras Realtime sano. TTL actual del comando es 60 s: backoff con jitter y máximo menor que el tiempo restante (p. ej. primera consulta a 5 s), no 5 minutos. Consultar solo estados recuperables, ordenados por `issued_at`, límite 25, sin recuperaciones simultáneas. Limpiar timer en desmontaje, revocación y reconexión.

**Pruebas:** `CHANNEL_ERROR`, `TIMED_OUT`, `SUBSCRIBED`, carrera de timers, límite 25, sesión ausente, revocación y canal recuperado.

**Comando:** `npx vitest run tests/supervisorLifecycle.test.js tests/supervisorCommands.test.js --pool=forks --maxWorkers=1`.

**Prompt:** “Ejecuta solo la Fase 12. Añade fallback de recuperación condicionado a Realtime y al TTL de 60 s, con limpieza y tests fake-timer. No cambies otros sync hooks.”

## Fase 13 — Campos restantes del formulario de producto

**Archivos permitidos:** `RemoteProductFormModal.jsx`, `ProductFormQuick.jsx` solo si el contrato compartido lo exige, nuevo test de componente si no existe.

**Cambio:** auditar IVA, imagen, precios/costos COP, modalidad, granel, presentación y alerta. Patch por allowlist; excluir `ivaRate: undefined` y preservar campos no editables. Imagen: medir bytes del Blob antes de data URL; fijar límite visible. Solo usar URL si hay flujo Storage accesible y autorizado por la caja; si no, excluir imagen remota y conservar la actual.

**Pruebas:** crear incluye stock inicial; editar excluye stock/IVA oculto; código normalizado; base64 sobre límite bloqueada; cierre solo después de ACK.

**Comando:** `npx vitest run tests/supervisorRemoteProductForm.test.jsx tests/supervisorProductCommand.test.js --pool=forks --maxWorkers=1` (si se crea el test). Si no existe test de componente, añadirlo; no omitir comportamiento UI.

**Prompt:** “Ejecuta solo la Fase 13. Audita campos y cubre IVA/imagen con pruebas. No introduzcas Storage ni servicios externos; si imagen no tiene ruta segura existente, preserva la imagen y exclúyela del patch.”

## Fase 14 — Verificación integral y rollout preparado

**Archivos:** tests E2E existentes `tests/e2e/supervisor-product-actions.e2e.spec.js`; crear `tests/e2e/supervisor-inventory-actions.e2e.spec.js` solo si falta; referencia `docs/reports/2026-10-15-egress-baseline.md` solo si existe.

**Pruebas locales:**

```bash
npm run lint:supervisor
npx eslint tests/supervisor*.test.{js,jsx}
npm run typecheck
npx vitest run tests/supervisor*.test.{js,jsx} tests/granelGuardrails.test.js --pool=forks --maxWorkers=1
```

**E2E:** en staging aislado con datos sintéticos/dispositivo controlado:

```bash
SUPERVISOR_E2E_ENABLED=true SUPERVISOR_E2E_BASE_URL=<staging-controlado> npx playwright test tests/e2e/supervisor-product-actions.e2e.spec.js tests/e2e/supervisor-inventory-actions.e2e.spec.js
```

Cubrir producto, conflicto, stock preservado, unidades, lotes, egreso, rechazo sin mutación, timeout reconciliado con mismo ID, cancelación contra claim, reintento después de reinicio y permisos de ambos supervisores.

**Gate final:** no declares rollout listo si falla un check, falta staging/credencial/dato sintético, hay journal irrecuperable, no se prueba v1, o no se verificaron ambos slots. Preparar métricas/rollback y observar baseline 24 h antes de proponer rollout. Producción exige autorización explícita; este plan no la concede.

**Prompt:** “Ejecuta solo la Fase 14. Revisa cambios de todas las fases, corre exactamente los checks indicados y prueba E2E solo en staging autorizado. No despliegues, no ejecutes SQL remoto, no hagas commit. Devuelve un reporte de PASS/FAIL/BLOQUEADO con evidencia y riesgos.”

## Orden y dependencias

Fase 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11 → 12 → 13 → 14. Cada fase es una unidad separada y requiere autorización explícita antes de comenzar; terminar una fase no autoriza la siguiente. Si aparece dependencia nueva o el alcance exige editar otros archivos, documentarla y detenerse para actualizar este plan antes de continuar.

## Plantilla de handoff al terminar cada fase

```text
Fase completada:
Archivos cambiados:
Pruebas ejecutadas y resultado exacto:
Pruebas no ejecutadas/bloqueadas y motivo:
Comportamiento confirmado:
Riesgo o decisión pendiente:
Siguiente fase autorizada: ninguna (esperar confirmación)
```
