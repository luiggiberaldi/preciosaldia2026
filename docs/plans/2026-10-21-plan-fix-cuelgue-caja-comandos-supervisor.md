# Plan de fixeo: la caja se cuelga al aplicar comandos del Supervisor

> **Modo de ejecución:** una sola fase por interacción. Leer esta guía y solo los archivos de la fase actual. No anticipar fases, no inventar contratos ni modificar archivos fuera de la lista. Al terminar, reportar cambios, pruebas, resultado y bloqueos; esperar autorización para la siguiente fase.
>
> **Estado (2026-10-21):** Fases 0–4 IMPLEMENTADAS y verificadas (lock de 2–3.7 s a ~0.26–0.29 s medido con la telemetría de ACK contra staging; 10/10 pruebas de `tests/cloudPublishQueue.test.js`; Fases 3–4 con fail-first y gate de medición: serialización por lote 17.3 M → 11.3 M chars y 383 → 357 ms). Decisión tomada en la Fase 1: sin rollback local en fallo de publicación (quedó `applied_with_warnings` + pendiente + barrido). Desviación medida en la Fase 4: los snapshots van como strings JSON con marca `j1:` SIN comprimir (comprimir medido PEOR: 877 ms vs 357 ms, el plomerío gzip+base64 cuesta ~7× el stringify que ahorra) y sin bump de versión (la marca se auto-describe; los valores en claro siguen siendo válidos). Pendiente: Fase 5 (solo esquema).

## Objetivo y límites

Que un comando del Supervisor (edit de producto, lote de inventario, etc.) **nunca** bloquee la operación del cajero: ni el «Cobrar» ni el render. Hoy, cada comando retiene `pos_write_lock` durante toda la red (subida de 1.3–2 MB) y ejecuta 53–544 ms de serialización/clonado en el hilo principal (medido con datos reales del backup 2026-10-19; ×3–10 en una caja gama baja). Diagnóstico y mediciones: [reporte 2026-10-21](../reports/2026-10-21-verificacion-fase4-staging-y-diagnostico-cuelgue-caja.md).

**Causa raíz doble:**
1. **Red dentro del lock.** `applyProductCommand` / `applyInventoryBatchCommand` (`src/hooks/useRemoteCommands.js`) ejecutan `await pushCloudSync(...)` y `await ackCommand(...)` dentro de `withLock('pos_write_lock')`; `processSaleTransaction` (`src/utils/checkoutProcessor.js:300`) usa el **mismo lock** → la venta del cajero espera la subida completa.
2. **Sobrecosto de serialización.** El journal write-ahead guarda `before`/`after` de AMBOS documentos (~4 MB de objeto), `writeVerified` confirma con dos `JSON.stringify` del valor completo, la sombra + IndexedDB clonan el catálogo entero por escritura, y `bodega_products_v1` (1.32 MB) se serializa y sube entero por cada cambio de un campo.

**Stack verificado en el repo:** JavaScript ESM, React, Supabase JS/PostgREST/Realtime, PostgreSQL (RPCs de comandos), localforage/IndexedDB, Vitest, React Testing Library, Vite. No instales paquetes ni toques lockfiles.

**No incluido:** desplegar, ejecutar SQL en producción, commit/push, adelgazar `bodega_products_v1` por shards (es el Fase 5 de sincronización, se enlista como fase final solo con esquema), cambiar la semántica de ACK temprano del inventario (Fase 11), ni tocar `useMonitorSync` salvo lo que exija la fase expresa.

**Por qué la red está hoy dentro del lock — no es descuido:** el push de productos publica un SNAPSHOT RMW (Cierre FIX-VENTAS-STOCK-SUPERVISOR §4). Si se publica un snapshot obsoleto tras soltar el lock, el last-write-wins de `sync_documents` borraría la venta que el cajero hizo en la ventana. Cualquier fix que saque la red del lock DEBE preservar «lo publicado es el estado fresco al momento de publicar». Este plan lo garantiza con un publicador coalescido que relee el valor al publicar.

## Por qué esto y no más

| Fase | Cambio | Impacto | Riesgo | Por qué ahora |
|---|---|---|---|---|
| 1 | Publicación de productos fuera del lock (publicador coalescido) | Muy alto | Medio | Desbloquea el «Cobrar»: es EL cuelgue reportado |
| 2 | Inventario: publish + ACK + retry fuera del lock | Muy alto | Medio | Mismo cuelgue para lotes; el journal ya hace el estado recuperable |
| 3 | `forceUnconditional=false` en la publicación de la familia de ventas | Medio | Bajo | El hash por doc ya existe; hoy `force=true` lo anula y reescribe todos los periodos |
| 4 | Journal comprimido + `writeVerified` sobre strings | Alto | Bajo | −8 MB de objetos clonados/serializados por lote; solo cambia el formato del journal |
| 5 | (Esquema) `bodega_products_v1` por shards | Muy alto | Alto | El doc monolítico de 1.32 MB es el costo de fondo; proyecto aparte |

**Fuera de alcance (backlog):** re-render del listado de 2434 productos con `startTransition`/throttle de `app_storage_update`, métricas remotas de latencia de lock, compresión del transporte.

**Baseline medido (2026-10-21, staging wapczm con la telemetría de ACK real):** el cuelgue es **57–99 % red** — edit de producto: lockMs 2.4–5.8 s (de los cuales 2.3–5.7 s de red subiendo 1.32 MB) vs 0.09–0.12 s en solo CPU; lote de 20 líneas: lockMs 2.1–2.2 s (1.2–1.8 s de red subiendo 2.00 MB) vs 0.35–0.95 s en solo CPU. Esto confirma el orden de fases: primero la red fuera del lock (1–2), después el CPU (3–4) que es lo que pesará en hardware gama baja. Detalle en [reporte §6](../reports/2026-10-21-verificacion-fase4-staging-y-diagnostico-cuelgue-caja.md).

## Reglas obligatorias para cada fase

1. Confirma branch y `git status`; nunca descartes ni incluyas cambios previos de otros hilos.
2. Relee los archivos de la fase antes de editar; los números de línea de este plan pueden haberse movido.
3. Antes de editar, resume el comportamiento actual, archivos que cambiarán y criterio de éxito. Si el repo contradice este plan, **detente y pregunta; no adivines**.
4. Trabaja solo en la fase autorizada. Nada de refactors ni "limpieza" colateral.
5. Añade primero la prueba que detecta el defecto, confirma que falla por la causa prevista, implementa el cambio mínimo y vuelve a correrla.
6. No debilites pruebas ni añadas supresiones de lint para pasar. Revisa el diff final.
7. Toda prueba de carrera debe usar promesas diferidas (controles explícitos de resolución), no `setTimeout` a ciegas.
8. Al cerrar una fase: handoff con archivos editados, comportamiento, comandos/resultados, riesgos y siguiente fase permitida.

## Criterios globales de aceptación

- **El cajero nunca espera la red:** durante la publicación cloud de un comando, existe una ventana en la que `withLock('pos_write_lock')` está libre y una sección crítica concurrente ENTRA antes de que el push resuelva (prueba de carrera obligatoria por fase).
- **Nunca se publica un snapshot obsoleto:** si el cajero escribe (venta) entre el apply y el publish del comando, el documento publicado incluye esa escritura; nada se pierde ni se revierte (prueba de carrera obligatoria).
- **Un fallo de publicación nunca revierte estado local ya confirmado** (semántica Fase 11): queda `pending` + `applied_with_warnings` y el barrido periódico re-publica. El ACK al supervisor nunca miente sobre lo aplicado localmente.
- **Recuperación intacta:** `recoverSupervisorInventoryJournal` resuelve journals v1 y v2; `tests/supervisorInventoryCommand.test.js` y `tests/e2e/supervisor-inventory-recovery.e2e.spec.js` en verde sin cambios de aserción.
- **Medición (gate cuantitativo):** `tests/supervisorAckTelemetryStaging.perf.test.js` es el verificador antes/después: tras las Fases 1–2, el `lockMs` de cada comando debe caer a ≈ la columna CPU (0.1–1 s en máquina rápida) y la ventana de red (`publishMs`) debe quedar FUERA del lock — hoy es 57–99 % del `lockMs` (baseline 2026-10-21). Complementar `tests/supervisorCommandJank.perf.test.js` con "ms bajo `pos_write_lock`" por comando (imprimir la métrica; presupuesto laxo solo para patologías).
- Comandos de prueba: `npx vitest run <tests de la fase> --pool=forks --maxWorkers=1` y `npm run lint:supervisor` en verde.

---

## Fase 0 — Reconocimiento y línea base (solo lectura)

**Objetivo:** confirmar que el plan corresponde al checkout actual y congelar la línea base medible.

**Leer/buscar:** `src/hooks/useRemoteCommands.js` (`applyProductCommand`, `applyInventoryBatchCommand`, `ackCommand`, `retryInventoryPublish`, `markProductPublishPending`, `clearProductPublishPending`, `classifyProductPublishResult`), `src/services/supervisorInventoryCommand.js` (`applySupervisorInventoryBatchTransaction`, `publishInventoryDocs`, `retryInventoryPublish`, `writeVerified`, `clearJournalVerified`, `recoverSupervisorInventoryJournal`, `isValidInventoryJournal`), `src/hooks/useCloudSync.js` (`pushCloudSync`, `queueCloudSync`, `_debouncePush`, `quickHash`, `upsertSyncDocument`), `src/utils/storageService.js` (`setItem`, `getItem`), `src/utils/checkoutProcessor.js:300`, `src/utils/withLock.js`, `src/utils/compression.js` (`compressString`, `isCompressionSupported`), `tests/supervisorCommandJank.perf.test.js`, `tests/supervisorInventoryCommand.test.js`, `tests/supervisorRemoteCommandsRecovery.test.jsx`.

**Acciones:** `git status --short`, rama actual, correr `npx vitest run tests/supervisorCommandJank.perf.test.js` y anotar las métricas `[PERF]` como línea base; opcionalmente repetir la medición red-vs-CPU con `tests/supervisorAckTelemetryStaging.perf.test.js` contra staging (`SUPERVISOR_STAGING_E2E=true`) — ya ejecutada el 2026-10-21: el cuelgue es 57–99 % red bajo `pos_write_lock` (ver [reporte §6](../reports/2026-10-21-verificacion-fase4-staging-y-diagnostico-cuelgue-caja.md)). No modificar nada.

**Salida/gate:** reportar estado base, símbolos confirmados con sus líneas reales, discrepancias con el plan y si hay trabajo previo solapado.

**Prompt:** "Ejecuta solo la Fase 0 de [este plan](docs/plans/2026-10-21-plan-fix-cuelgue-caja-comandos-supervisor.md). Solo lectura; devuelve branch/status, símbolos confirmados, métricas base del perf y discrepancias."

## Fase 1 — Publicación de productos fuera del lock (publicador coalescido)

**Archivos permitidos:** `src/hooks/useCloudSync.js` (o módulo nuevo `src/services/cloudPublishQueue.js`), `src/hooks/useRemoteCommands.js`, `tests/supervisorRemoteCommandsRecovery.test.jsx` (o test nuevo `tests/cloudPublishQueue.test.js`).

**Cambio:**
1. **Publicador single-flight por clave con relectura.** Al dispararse, **relee el valor fresco** de `storageService.getItem(key)` y llama `pushCloudSync(key, valorFresco, force)`; un segundo disparo durante el vuelo no apila otra subida de 1.3 MB (single-flight; si hace falta, marca pendiente y el barrido existente lo re-publica — no hace falta un dirty-flag propio). Reutilizar el patrón de `_debouncePush` (HEAVY_KEYS 3 s) en lugar de crear otro temporizador suelto. **La relectura es la pieza de seguridad, no la coalescencia:** sin ella, el snapshot bajo lock se vuelve obsoleto y el last-write-wins pisa la venta concurrente del cajero; por eso es OBLIGATORIA.
2. **`applyProductCommand`:** el lock queda para `getItem → applySupervisorProductCommand → setItem → dispatch app_storage_update → markAckTelemetry('local_applied')`. La publicación (`queuePublish('bodega_products_v1')`) y el ACK (`ackCommand`) salen del lock. El resultado del comando se resuelve como hoy tras el publish (confirm-after-publish se conserva; solo cambia QUIÉN espera: el supervisor, no el cajero).
3. **Semántica de fallo (cambio de producto, deliberado):** se elimina el rollback a `currentProducts` cuando el push falla — fuera del lock, un rollback por snapshot pisaría la venta concurrente del cajero. En su lugar: mantener el estado local, `markProductPublishPending(commandId)` y responder `applied_with_warnings`; el barrido periódico (el que ya llama `retryInventoryPublish`/pending) re-publica. Documentar el cambio en el handoff.

**Pruebas:** (a) carrera de lock: push diferido + `withLock('pos_write_lock')` concurrente que ENTRA antes de resolver el push; (b) carrera de snapshot: venta que cambia `bodega_products_v1` entre apply y publish → el documento publicado incluye la venta (coalescer relee); (c) coalescencia: dos comandos en ráfaga → un solo push con el estado final; (d) fallo de push → estado local intacto + pending + `applied_with_warnings`, y el re-push posterior confirma y limpia pending; (e) ACK sigue llegando después del publish confirmado.

**Comando:** `npx vitest run tests/cloudPublishQueue.test.js tests/supervisorRemoteCommandsRecovery.test.jsx --pool=forks --maxWorkers=1`.

**Gate:** sin las pruebas de carrera (a) y (b) en verde, la fase no se acepta.

**Prompt:** "Ejecuta solo la Fase 1 del plan. Implementa el publicador coalescido con relectura y saca publish+ACK de productos fuera de `pos_write_lock`, con las 5 pruebas indicadas. No cambies la semántica de inventario."

## Fase 2 — Inventario: publish + ACK + retry fuera del lock

**Archivos permitidos:** `src/services/supervisorInventoryCommand.js`, `src/hooks/useRemoteCommands.js`, `tests/supervisorInventoryCommand.test.js`, `tests/e2e/supervisor-inventory-recovery.e2e.spec.js`.

**Cambio:**
1. Dividir `applySupervisorInventoryBatchTransaction` en **fase local** (pasos 1–5: recover, plan, journal write-ahead, escrituras verificadas, `onLocalApplied`) y **fase de publicación** (pasos 6–7: `publishInventoryDocs` + transición del journal a `published_pending`/`clearJournalVerified`). El caller (`applyInventoryBatchCommand`) ejecuta la fase local dentro del lock y la publicación **después de soltarlo** (con el coalescedor de la Fase 1 para `bodega_products_v1` y directo para la familia de ventas).
2. `ackCommand` (hoy dentro de `onLocalApplied`, bajo lock) → después del lock. `rememberAppliedCommand`/`appliedCommands.accept` son locales y pueden quedarse donde estén.
3. `retryInventoryPublish` del final del comando → fuera del lock (igual que el barrido periódico de `useRemoteCommands:737`).
4. **Orden de cierre:** un error en la fase de publicación no toca el journal salvo pasarlo a `published_pending` con `pendingKeys` (ya implementado; conservarlo).

**Pruebas:** (a) carrera de lock y (b) de snapshot como en Fase 1 pero para el lote; (c) recuperación: matar entre fase local y publish → `recoverSupervisorInventoryJournal` + `retryInventoryPublish` dejan el estado aplicado y publicado exactamente una vez; (d) `applied_with_warnings` + `pendingPublish` cuando la red falla, sin revertir el movimiento; (e) los e2e de recuperación siguen en verde sin tocar aserciones.

**Comando:** `npx vitest run tests/supervisorInventoryCommand.test.js --pool=forks --maxWorkers=1` y `npm run test:e2e:inventario-recovery`.

**Gate:** si `tests/e2e/supervisor-inventory-recovery.e2e.spec.js` exige cambios de aserción, detenerse y reportar.

**Prompt:** "Ejecuta solo la Fase 2 del plan. Divide la transacción de inventario en fase local (bajo lock) y publicación (fuera), con ACK y retry fuera del lock, y sus pruebas."

## Fase 3 — `forceUnconditional=false` en la publicación de la familia de ventas

**Archivos permitidos:** `src/services/supervisorInventoryCommand.js` (`publishInventoryDocs`), `tests/supervisorInventoryCommand.test.js`, `tests/cloudSyncSalesPeriods.test.js`.

**Cambio:** `publishInventoryDocs` llama `pushSync(doc.key, doc.value, true)` (force). Con la Fase 4 de sincronización, `pushCloudSync` de la familia de ventas ya saltea por hash los periodos intactos; `force=true` lo anula y reescribe ~0.67 MB por lote. Cambiar a `false` para `bodega_sales_v1`; **mantener `true` para `bodega_products_v1`** (monolítico, sin hash por partes). Seguridad: el hash por doc solo se guarda tras upsert confirmado, así que un retry no-confirmado vuelve a publicar igualmente. El vaciado total (`[]`) ya publica tumbas aunque el hash coincida: verificar que no depende de `force`.

**Pruebas:** (a) lote que solo agrega movimientos al periodo corriente → solo se reescribe ese periodo/shard (medir doc_ids del upsert); (b) lote con mutación en un periodo viejo → solo ese periodo; (c) fallo de red seguido de retry → el periodo fallido termina publicado (el hash no se guardó); (d) vaciado total publica tumbas con `force=false`.

**Comando:** `npx vitest run tests/supervisorInventoryCommand.test.js tests/cloudSyncSalesPeriods.test.js --pool=forks --maxWorkers=1`.

**Gate:** la prueba (a) debe fallar antes del cambio (hoy se reescribe todo con force). — ✅ CUMPLIDO: (a) y (b) fallaron antes del cambio exactamente en la aserción de "solo el periodo tocado" (se reescribían todos los periodos con force); tras el cambio 19/19 en verde en `tests/cloudSyncSalesPeriods.test.js`.

**Prompt:** "Ejecuta solo la Fase 3 del plan. Publica la familia de ventas sin force para aprovechar el hash por periodo, con las 4 pruebas."

## Fase 4 — Journal comprimido + `writeVerified` sobre strings

**Archivos permitidos:** `src/services/supervisorInventoryCommand.js`, `src/utils/compression.js` (solo si `compressString` necesita export extra), `tests/supervisorInventoryCommand.test.js`.

**Cambio:**
1. El journal guarda `before`/`after` como **strings comprimidos** (`compressString(JSON.stringify(valor))` — el repo ya lo usa para backups cloud). Clonar un string en IndexedDB es mucho más barato que clonar el grafo de objetos de ~4 MB.
2. `writeVerified` compara el string esperado contra el releído (igualdad de strings) en vez de dos `JSON.stringify` de objetos; para valores no comprimidos conserva el comportamiento actual.
3. **Compatibilidad:** `isValidInventoryJournal` acepta versión 1 (objetos) y 2 (strings comprimidos); `recoverSupervisorInventoryJournal` resuelve ambos. Un journal v1 escrito por la app anterior debe poder recuperarse tras el update (prueba específica).
4. Los docs `bodega_products_v1`/`bodega_sales_v1` siguen escribiéndose como objetos (son el estado real); solo el journal se comprime.

**Pruebas:** (a) round-trip journal v2 + recuperación roll-forward y rollback; (b) journal v1 legible y resoluble; (c) comparación de escritura detecta corrupción igual que hoy (simular `setItem` que traga el error); (d) medición en `tests/supervisorCommandJank.perf.test.js`: los `[PERF]` del lote bajan de ~17.3 M chars serializados a < ~7 M y de 12 clones a ≤ 6 (imprimir antes/después).

**Comando:** `npx vitest run tests/supervisorInventoryCommand.test.js tests/supervisorCommandJank.perf.test.js --pool=forks --maxWorkers=1`.

**Gate:** si la medición (d) no mejora, revertir el formato del journal y reportar; no se acepta complejidad sin ganancia medida. — ✅ CUMPLIDO (mejora medida): lote 20 líneas sobre el backup real: 17.3 M → **11.3 M chars (−35%)** y 383 → **357 ms**; 13 clones (sin cambio de conteo: los read-back de `writeVerified` están sellados por pruebas de seguridad). Variante comprimida PROBADA y REVERTIDA por el propio gate: 877 ms bloqueantes (2.3× peor). Los targets orientativos <7 M / ≤6 clones no son alcanzables dentro de `supervisorInventoryCommand.js`: quedan 5.3 M chars de transporte+hash (viven en `useCloudSync`) y 2 M de verificación de lectura de vuelta (seguridad exigida por pruebas). Desviación del diseño: snapshots `j1:` sin comprimir + marca auto-descriptiva en vez de `compressString` + versión 2; la lectura dual cubre igual los journals v1 (valores en claro).

**Prompt:** "Ejecuta solo la Fase 4 del plan. Comprime los snapshots del journal y barata `writeVerified`, conservando compat con journals v1, con medición antes/después."

## Fase 5 — (Esquema) `bodega_products_v1` por shards

**Solo diseño; no implementar en este plan.** Esbozo: misma semántica que la familia de ventas (docs `bodega_products_v1:<bucket>` + merge en el lector + legacy legible + tumbas), pero con RMW del ProductContext/`catalogLock` sobre el bucket tocado y journal por buckets. Requiere decisión de partición (por `id`/categoría), contrato del lector en `useMonitorSync`, y plan de migración del doc legacy de 1.32 MB. Entregar como `docs/plans/` aparte con su propio análisis de razgos antes de tocar código.

> ✅ ENTREGADO (2026-10-21) como plan aparte: `docs/plans/2026-10-21-plan-adelgazar-bodega-products-por-shards.md`. Decisiones selladas: partición por `id` (32 buckets fijos por hash, NO por categoría — mutable); **un doc = una franja completa** con reemplazo de franja en el lector (los productos se BORRAN, a diferencia de las ventas: un merge unión no propaga borrados) y sin `#N` intra-bucket; migración perezosa sin dual-write + retiro del legacy por marcador `:gen2` como fase aparte; techo medido ~288k productos con gate de tope por doc. Pruebas/gates y orden de ejecución en §8–§9 del documento.

**Prompt:** "Redacta el plan aparte para adelgazar `bodega_products_v1` por shards siguiendo el patrón de la familia de ventas, con partición propuesta, contrato del lector, migración y riesgos. Sin implementar."

---

## Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Publicar un snapshot obsoleto revierte ventas del cajero en la nube | Publicador coalescido con relectura al publicar + prueba de carrera (b) en cada fase |
| Doble publicación (comando + `_debouncePush`) con estados distintos | single-flight por clave + coalescencia; el último estado gana y siempre se publica el fresco |
| El monitor vea `applied` antes de que el dato esté en la nube | ya ocurre hoy con ACK temprano (Fase 11); este plan conserva confirm-after-publish para productos y solo libera el lock |
| Journal v1 huérfano tras el update (Fase 4) | lectura dual v1/v2 + prueba específica de recuperación v1 |
| Cambio de semántica: sin rollback local en fallo de push | decisión deliberada y documentada; `applied_with_warnings` + pending + barrido (idéntico al inventario de Fase 11) |
| Regresión de rendimiento no medida | el perf test es gate: métrica nueva "ms bajo lock" + impresión de serializaciones/clones |

## Orden de ejecución y dependencias

- Fase 1 → Fase 2 (compartan el coalescedor) → Fase 3 y Fase 4 independientes entre sí → Fase 5 solo como documento.
- Cada fase es desplegable por sí sola y reversible por revert del diff (sin migraciones de base en ninguna; el journal es local a la caja).
- Criterio de parada global: con las Fases 1–2 en verde, el «Cobrar» del cajero no espera la red de un comando; con 3–4, el jank de CPU del lote baja a menos de la mitad (medido).
