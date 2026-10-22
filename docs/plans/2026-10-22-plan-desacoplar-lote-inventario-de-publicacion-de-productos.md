# Plan: desacoplar el lote de inventario del supervisor de la publicación de productos

> **Estado (2026-10-22): IMPLEMENTADO (Opción A) y verificado** — evidencia
> medida en §8, hallazgo de implementación en §10. Fase aparte (§6.6) del plan
> de stock delta (`docs/plans/2026-10-21-plan-stock-delta-en-doc-de-venta.md`),
> que la dejó pendiente porque "su flujo de journal/recuperación asume la
> publicación de ambos docs. Desacoplarlo exige re-plantear `pendingKeys`".
> Este documento es ese re-planteamiento: separar **lo que se recupera**
> (journal local) de **lo que se debe publicar** (`pendingKeys`), sin tocar el
> contrato con el supervisor ni la semántica del ACK temprano.

---

## 1. Por qué (medido, no intuición)

Medido con `tests/supervisorCommandJank.perf.test.js` sobre el backup real
(2026-10-19: 2434 productos ≈ 1.32 MB, 496 movimientos ≈ 666 KB), lote de 20
líneas (reporte `docs/reports/2026-10-21-fase3-fase4-jank-lote-inventario.md`):

- **Subida: 3 docs / 2.00 MB por lote** — el monolito de productos de 1.32 MB
  **intacto** (el lote solo cambió `stock` de unas pocas líneas) + la familia
  de ventas ya incremental (~0.67 MB, Fase 3).
- Serialización: 530 stringify / **11.3 M chars** (−35% tras las Fases 3–4).
  Del desglose: ~5.3 M son transporte + hashing en `useCloudSync` (la mayor
  parte el monolito: `quickHash` de 1.32 M chars + `JSON.stringify` del upsert
  de 1.32 M chars por publicación) y ~2 M la verificación por lectura de vuelta.
- **Doble publicación del catálogo**: además del `publishInventoryDocs` explícito
  (`force: true` en productos), la escritura local del paso 4 de la transacción
  dispara el auto-enqueue del interceptor de `storageService.setItem`
  (`queueCloudSync(key, value)` salvo `skipSyncPush`), que vuelve a subir el
  monolito en el debounce de ~3 s. Hoy el dedup por hash lo mitiga solo cuando
  el contenido no cambió — pero el lote SÍ cambió stock, así que el hash cambia.

La redundancia ya es semántica, no solo de costo: desde el stock delta, el
monitor deriva `stockVisible = baseline + Σ efectos` y los movimientos del lote
(`AJUSTE_ENTRADA`/`AJUSTE_SALIDA`) ya viajan en la familia de ventas con
`stockBefore`/`stockAfter`/`unitsDelta` — se pliegan como efectos 1:1 (gate 3
del plan de delta, sellado en `tests/stockDeltaReconciliation.test.js` y
`tests/supervisorSyncEcho.test.jsx`). **Publicar el catálogo completo por un
cambio de stock puro no aporta nada que el lector no derive ya.**

## 2. El lote es stock-puro (verificado en el código, con gate de defensa)

`calculateSupervisorInventoryBatchAdjustment` devuelve
`product: { ...product, stock: stockAfter }`: lo único que cambia en el catálogo
es `stock`. `lots`/`stockInLotes` no se tocan (`lotReference` es un string
resumen dentro del movimiento, no una mutación de lotes). Por eso el desacople
es correcto **para este comando**.

**Gate de defensa** (no confiar en el "hoy no lo toca"): el plan de la
transacción debe poder certificar que `updatedProducts` solo difiere del
catálogo actual en el campo `stock` de los productos tocados. Si un comando
futuro modifica lotes, precios o cualquier otro campo, **debe volver a publicar
el catálogo** — decisión en el call-site (misma filosofía que `skipSyncPush`:
el que sabe la naturaleza del cambio decide), nunca un diff frágil de "¿cambió
solo stock?".

**Implementado como test**, no como diff en runtime:
`tests/supervisorInventoryCommand.test.js` → "gate de defensa del desacople"
certifica que `updatedProducts` solo difiere del catálogo en el campo `stock` de
los productos tocados. Si un comando futuro toca lotes/precios, el gate falla y
obliga a la decisión explícita del call-site.

## 3. El desacople: separar "recuperar" de "publicar"

Hoy los dos planos comparten el mismo vocabulario (`INVENTORY_DOC_KEYS` =
`['bodega_products_v1', 'bodega_sales_v1']`) y el journal mezcla ambos papeles:
sus `docs` (snapshots before/after) son la fuente de recuperación LOCAL **y** la
lista de claves que deben publicarse (`pendingKeys`). El desacople los separa:

| | Journal (local) | `pendingKeys` (nube) |
|---|---|---|
| Pregunta que responde | "¿cómo queda el estado local si muero a mitad?" | "¿qué le debo todavía a la nube?" |
| Alcance nuevo | **ambos docs, igual que hoy** | **solo la familia de ventas** |
| Quién lo consume | `recoverSupervisorInventoryJournal` (roll-forward/rollback) | `retryInventoryPublish` (barrido de 30 s + cierre de lote) |

### 3.1 `pendingKeys` — contrato nuevo

1. **Constantes separadas** en `supervisorInventoryCommand.js`:
   `INVENTORY_LOCAL_KEYS` (ambas, para `isValidInventoryJournal` y las
   escrituras verificadas del paso 4) e `INVENTORY_PUBLISH_KEYS`
   (`['bodega_sales_v1']`, lo que se debe publicar).
2. **`deferPublish`** deja `pendingKeys: [...INVENTORY_PUBLISH_KEYS]` (hoy:
   `[...INVENTORY_DOC_KEYS]`).
3. **`publishInventoryDocs`** ya recibe `keys` como parámetro y filtra — solo
   cambian los llamadores: el lote publica únicamente `bodega_sales_v1`
   (familia, `force: false`, incremental por hash). La entrada de productos y
   su `force: true` quedan **solo** para los journals que aún la deban (§4).
4. **`retryInventoryPublish`** no cambia de forma: publica lo que diga
   `journal.pendingKeys`. El fallback cuando `pendingKeys` falta
   (`INVENTORY_DOC_KEYS`) se mantiene **a propósito** para journals legacy.
5. **Cerrar el leak del auto-enqueue**: la escritura local de `bodega_products_v1`
   en el paso 4 pasa por `skipSyncPush: true` (la costura ya existente de
   checkout/void, `storageService.setItem(key, value, { skipSyncPush: true })`).
   Sin esto el interceptor vuelve a publicar el monolito ~3 s después y el
   desacople no entrega nada medible. `writeVerified` debe poder propagar la
   opción (hoy llama `storage.setItem(key, value)` sin opciones).
6. **Decisión sobre la escritura local de `bodega_sales_v1`**: dos posturas
   válidas. (a) Dejar su auto-enqueue como red de seguridad — el movimiento
   viaja incluso si el journal se pierde; el dedup por hash hace el doble viaje
   barato. (b) `skipSyncPush` también y que la publicación sea exclusivamente
   del journal. **Recomendada (a)** por ahora: es la única red que cubre
   "journal corrupto + barrido caído", y su costo real (hash por periodo
   tocado) se mide en el gate antes de decidir recortarla.

### 3.2 Journal — qué NO cambia en esta fase (y qué sería fase aparte)

**Opción A (esta fase): journal intacto.** Sigue siendo2 docs con snapshots
`before`/`after` (strings `j1:`). `isValidInventoryJournal` no cambia: un
journal corrupto nunca autoriza escrituras fuera de las dos claves conocidas.
El journal es una garantía LOCAL y su tamaño no afecta la nube; dejarlo quieto
mantiene el riesgo en cero y hace el desacople revertible con un diff pequeño.

**Opción B (fase aparte, decisión aparte): journal delta v2.** El journal
guardaría solo los deltas ya calculados por el plan: por producto
`{productId, stockBefore, stockAfter}` (unos bytes por línea) y los `id` de los
movimientos agregados; roll-forward aplica deltas y agrega movimientos
(idempotente por id), rollback los invierte. Beneficio: elimina ~2.6 M chars de
snapshots de productos + ~1.3 M de ventas por lote (~40% del total medido). Dos
adiciones que la hacen atractiva más allá del tamaño:

- **Cierra un hueco preexistente del diseño actual**: un journal 'pending'
  se recupera restaurando los snapshots **completos**; si la caja vendió entre
  el corte y el siguiente lote, el roll-forward pisaría esas ventas (sus
  registros y su stock). Un journal delta solo toca sus propios ids y sus
  propios deltas: compone con las ventas en lugar de borrarlas.
- Requiere `isValidInventoryJournal` v2 + lectura dual (los snapshots `j1:` ya
  se auto-describen; misma técnica, sin bump de versión). El redondeo granel
  (3 decimales) en la re-aplicación de deltas exige su propio gate.

## 4. Migración perezosa de journals en vuelo (sin bump de versión)

Un journal `'published_pending'` escrito por la versión anterior trae
`pendingKeys` con ambas claves → `retryInventoryPublish` publica ambas (es lo
que ese lote debía; correcto). Un journal nuevo trae solo la familia de ventas.
El fallback sin `pendingKeys` sigue publicando ambas (legacy). **No hay ventana
de migración ni migración de datos**: cada journal se liquida con la semántica
con la que se escribió. El estado remoto de productos queda como "último cambio
estructural o último re-baseline" — coherente con el modelo de efectos, cuyo
re-baseline de arranque/auto-backup (`forceSyncAllPOSData`) ya existe.

## 5. Casos borde

| Caso | Resolución |
|---|---|
| La publicación de la familia falla | igual que hoy: journal `'published_pending'` con `pendingKeys` reducidos a las claves fallidas, barrido de 30 s reintenta; el ACK ya salió (Fase 11) |
| Falle SOLO la escritura local de productos | sin cambios: `writeVerified` lanza, journal `'pending'`, recuperación roll-forward/rollback con los snapshots (el journal local sigue cubriendo ambos docs) |
| Journal legacy con productos en `pendingKeys` | se publica lo que dice (§4); al liquidarse, no queda nada pendiente |
| El auto-enqueue del interceptor | cerrado con `skipSyncPush` en la escritura de productos (§3.1.5); sin él, el gate de medición falla — ese es justamente su fail-first |
| Lote futuro que toque lotes/precios | el gate de defensa del §2 lo detecta; el call-site debe publicar catálogo (decisión explícita) |
| Efectos acumulándose sobre un `stockAsOf` viejo | el re-baseline de arranque/auto-backup lo absorbe (§3 del plan de delta); monitorear el tamaño de la ventana de efectos |
| Vaciar datos (`resetPOSDataToEmpty`) | intacto: las tumbas de la familia de ventas siguen funcionando (su hash cambia; no depende de `force`) y las tumbas del doc de productos también |
| Multi-caja | intacto: cada `device_id` tiene su propia familia; la derivación es por stream de un dispositivo |
| Comando de PRODUCTO estructural | intacto: `applyProductCommand` + `publishKeyNow` + `pda_product_publish_pending_v1` no se tocan (otro mecanismo, otro contrato) |

## 6. Alternativas descartadas

- **Publicar productos con `force: false`** (dejar que el hash lo saltee): sigue
  siendo publicación por lote apenas el stock cambia — el hash cambia siempre.
  Es el territorio del plan de shards (Fase 5), complementario: shards achican
  el cambio estructural; este plan elimina el viaje del cambio de stock puro.
- **Quitar solo `publishInventoryDocs` sin tocar el interceptor**: el
  auto-enqueue vuelve a subir el monolito en el debounce — desacople ficticio
  (el gate de medición lo delataría, pero conviene no construirlo).
- **Journal delta v2 desde el inicio**: mayor ahorro, pero mezcla dos riesgos en
  un solo paso y re-abre `isValidInventoryJournal` (el guard que protege de
  journals corruptos). Se deja como fase medida (§3.2, Opción B).
- **Re-derivar el stock local en la recuperación en vez de snapshots**: exige
  reconstruir estado de terceros; el journal delta (Opción B) cubre el mismo
  terreno con menos supuestos.

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| El monitor queda sin ver el stock si la publicación falla | sin regresión: hoy el lote tampoco confirma publicación (ACK temprano + journal + barrido); el riesgo es idéntico al actual |
| Journals viejos malinterpretados | `pendingKeys` manda; el fallback legacy publica ambas claves (§4) |
| El desacople "funciona" pero el auto-enqueue sigue publicando | fail-first del §8.1: el gate mide bytes de catálogo y falla si suben |
| Un lote futuro cambia algo no-stock | gate de defensa del §2 + decisión explícita en el call-site |
| `writeVerified` con opciones rompe la detección de escrituras tragadas | la opción solo llega al interceptor de sync; la lectura de vuelta y `sameStoredValue` no cambian (pruebas existentes las siguen sellando) |
| Los tests que fijan el contrato actual se rompen | son el fail-first esperado y se actualizan en el mismo paso (lista en §8.2) |
| Journal delta (Opción B) con redondeo granel | gate propio de re-aplicación de deltas a 3 decimales; fuera de esta fase |

## 8. Pruebas y gates (resultados medidos, 2026-10-22)

1. ✅ **Fail-first de medición** (`tests/supervisorCommandJank.perf.test.js`,
   lote de 20 líneas sobre el backup real 2026-10-19): **antes 3 docs /
   2.00 MB** (1.32 MB de catálogo intacto + la familia) → **ahora 2 docs /
   0.68 MB con 0 docs / 0 bytes de catálogo** (serialización 11.3 M → 9.4 M
   chars). El gate cierra los DOS caminos de publicación: la del journal
   (`pendingKeys`) y la del auto-enqueue del interceptor (el shim espeja
   `storageService.setItem` y drena el debounce por el `pushCloudSync` real y
   medido). **Fail-first demostrado**: quitando `skipSyncPush` de la escritura
   de productos el gate se pone rojo (`expected [...] to not include
   'bodega_products_v1'`) y vuelve a verde al restaurarlo. Control positivo
   dentro del propio test: la escritura legacy del catálogo (sin `skipSyncPush`)
   sí sube 1 doc — el detector no está ciego (y "edit de producto" sigue
   publicando el catálogo completo, 1.32 MB).
2. ✅ **Contratos de journal actualizados** (fail-first esperado):
   `tests/supervisorInventoryCommand.test.js` ("reinicio con push pendiente" →
   solo `bodega_sales_v1` en `pushes` y `pendingKeys`; `pendingPublish.keys` →
   `['bodega_sales_v1']`; eventos de Fase 11 → solo `publish:bodega_sales_v1`;
   el fallback al snapshot se mantiene sellado vía un journal legacy) y
   `tests/cloudSyncSalesPeriods.test.js` (fixture `pendingPublishJournal` ahora
   con `pendingKeys` de la familia por defecto, y "Productos es monolítico:
   siempre se publica completo" → "el lote no publica productos").
3. ✅ **Compatibilidad legacy**: journal `'published_pending'` con
   `pendingKeys: ['bodega_products_v1', 'bodega_sales_v1']` → el retry publica
   ambas y reduce `pendingKeys` a las fallidas (tests nuevos en ambos archivos);
   journal sin `pendingKeys` → fallback a ambas (código intacto).
4. ✅ **Lo que NO se movió** (regresión, sin cambios de aserción): roll-forward
   y rollback con snapshots, detección de escrituras tragadas, ownership del
   journal (`tests/cloudPublishQueue.test.js` pasa sin tocarlo, incluido su
   journal legacy con `pendingKeys: ['bodega_products_v1']`), parcial con
   `pendingKeys` reducidos a la clave fallida, y el e2e
   `supervisor-inventory-recovery` (**2/2 sin tocar aserciones**).
5. ✅ **Red de seguridad del §3.1.6**: seam sellada (la escritura local de
   ventas sigue sin `skipSyncPush`, la de productos sí) + su dedup por hash
   evita el segundo viaje cuando el journal ya publicó
   (`cloudSyncSalesPeriods` (f): 0 upserts) + el drenaje del gate del §8.1 no
   agrega un solo doc. Batería: `supervisorInventoryCommand` 41/41,
   `cloudSyncSalesPeriods` 21/21, `supervisorSyncEcho` 5/5 (ver §10), e2e
   `stock-delta-flow` 1/1.
6. ⏳ **E2e de navegador** (hermano del e2e `stock-delta-flow`): pendiente y
   opcional — la derivación baseline + efectos del monitor ya queda sellada
   end-to-end con pipeline real (sender → claim → transacción → publicación →
   merge del monitor) en `tests/supervisorSyncEcho.test.jsx` (§10).

## 9. Impacto por archivo y orden de ejecución

1. ✅ `src/services/supervisorInventoryCommand.js` — `INVENTORY_LOCAL_KEYS` vs
   `INVENTORY_PUBLISH_KEYS`; `deferPublish` con `pendingKeys` de la familia;
   `publishInventoryDocs` llamado solo con la familia (la entrada de productos
   con `force: true` queda solo para journals legacy); `writeVerified`
   propagando `skipSyncPush` a la escritura local de productos del paso 4 (la
   recuperación se deja "sin cambios" según §5: camino raro de crash, re-baseline
   aceptable).
2. ✅ `src/utils/storageService.js` — **sin cambios** (`skipSyncPush` ya existe,
   Fase 1 del stock delta); solo se usa.
3. ✅ `src/hooks/useRemoteCommands.js` — **sin cambios** (`retryInventoryPublish`
   ya filtra por `pendingKeys`; el marker `pda_product_publish_pending_v1` es
   del flujo de producto y no se toca; los comentarios existentes ya distinguen
   los dos mecanismos).
4. ✅ Tests: `supervisorInventoryCommand.test.js` (expectativas del §8.2 +
   journal legacy + seam `skipSyncPush` + gate de defensa del §2),
   `cloudSyncSalesPeriods.test.js` (fixture + expectativa + legacy + red de
   seguridad), `supervisorCommandJank.perf.test.js` (gate del §8.1 con drenaje
   del auto-enqueue y control positivo), `supervisorSyncEcho.test.jsx` (baseline
   del catálogo en los 3 tests de eco, ver §10),
   `cloudPublishQueue.test.js` (sin cambios, pasa tal cual).
5. Opción B (fase aparte): journal delta v2 + `isValidInventoryJournal`
   dual + el gate de hueco de recuperación (§3.2).

## 10. Nota de implementación: el eco al monitor necesita su baseline

Los tres tests de eco de `tests/supervisorSyncEcho.test.jsx` ("termina en el
stock del MONITOR", "no-op aplicado" y "el barrido lo repone") quedaron rojos
tras el desacople, y no por un bug del código: modelaban el eco como el eco DEL
DOC DE PRODUCTOS — bajo el contrato viejo el lote re-publicaba el catálogo con
el stock nuevo y el monitor lo aplicaba literal. Sin re-publicación el monitor
solo puede DERIVAR el stock (baseline + efectos)… y el harness nunca le entregaba
un baseline: sin doc de productos no hay `pda_products_stock_baseline_v1` y la
derivación no pliega nada (queda el 22 sembrado).

En producción el baseline siempre existe (el doc de productos del pull inicial
 del monitor y del arranque/vinculación de la caja, §4). El fix actualiza los
tests para sembrarlo (`seedMonitorCatalogBaseline`, mismo patrón que el test
"plan de stock delta" del mismo archivo) y los tres quedan en verde derivando
**30 = 22 + 8** a través del pipeline real completo (sender → claim →
transacción con journal → publicación de la familia → merge del monitor → fold).
El contrato que sellaban ("el movimiento pedido por el monitor termina en el
stock del monitor") se conserva y ahora prueba además el modelo de efectos
end-to-end.

Fallas preexistentes de la rama, ajenas a este cambio (visibles en la batería
completa y reproducibles sin este diff):
`tests/dashboardCashControls.test.jsx` (2), `tests/lockScreenBento.test.jsx` (3,
UI de LockScreen reescrita por otro trabajo) y
`tests/supervisorProductPublish.test.jsx` (1; ese test mockea por completo `supervisorInventoryCommand`).

Cada paso es desplegable y reversible por revert del diff: no hay migración de
base ni de formato remoto (el journal sigue siendo v1 con lectura dual y los
docs de la nube no cambian de contrato).
