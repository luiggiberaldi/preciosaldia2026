# Plan: adelgazar `bodega_products_v1` por shards (Fase 5)

> **Estado (2026-10-21): SOLO DISEÑO — sin código.** Entregable de la Fase 5 de
> `docs/plans/2026-10-21-plan-fix-cuelgue-caja-comandos-supervisor.md`, que
> exige este documento (partición, contrato del lector, migración y riesgos)
> *antes* de tocar código. Decisión de partición tomada aquí: **por `id`, con
> buckets fijos por hash — no por categoría** (ver §2).

---

## 1. Por qué (medido, no intuición)

Mido con `tests/supervisorCommandJank.perf.test.js` sobre el backup real (2026-10-19, 2434 productos ≈ 1.32 MB):

- Un **edit de producto** serializa y sube el catálogo **COMPLETO**: `[PERF] edit de producto → 3 stringify (2.6 M chars), 3 clones; sube 1 doc / 1.32 MB`.
- Un **lote de inventario de 20 líneas** (tras las Fases 3–4) sube `3 docs / 2.00 MB`: el monolito de productos de 1.32 MB intacto + la familia de ventas ya incremental.
- Del desglose del gate de la Fase 4 (11.3 M chars por lote), **~5.3 M son transporte + hashing** y la mayor parte es el monolito de productos (`quickHash` de 1.32 M chars + `JSON.stringify` del upsert de 1.32 M chars por publicación, otra vez si hay retry).

Con shards por bucket: un cambio de producto toca **un doc de ~40 KB** (1.32 MB / 32 buckets) en vez de 1.32 MB — ~30× menos serialización y subida por cambio. Ese es el piso de CPU/transporte que las Fases 3–4 dejaron fuera de alcance.

## 2. Decisión de partición: por `id` (hash a buckets fijos), NO por categoría

- **Categoría descartada**: es un campo mutable (`EDITABLE_PRODUCT_FIELDS` incluye `category`); un producto cambiaría de doc al editarse y la asignación dejaría de ser derivable por el lector.
- **`id` es inmutable y estable** → bucket derivable en cualquier dispositivo sin estado compartido.
- **32 buckets fijos** (no dependen del tamaño del catálogo → nunca hay que reparticionar):
  - `bucketOf(id) = fnv1a32(String(id)) & 31` (fnv1a32 = hash estable de 32 bits, ~10 líneas, mismo algoritmo en escritor y lector; se exporta desde `useCloudSync` como `productBucketOf`, junto a `isProductsSyncDocId`/`parseProductsSyncDocId`).
  - Doc id: `bodega_products_v1:b<2 hex>` (`:b00` … `:b1f`).
- **Un doc = una franja completa del bucket.** El payload de un doc de bucket es el arreglo COMPLETO de productos cuyo `bucketOf(id)` da ese bucket, en orden canónico `String(id)` asc.
- **Sin split `#N` intra-bucket.** A diferencia de las ventas (donde los shards por bytes son seguros porque no hay borrados), partir un bucket rompe la propagación de borrados (ver §3). Capacidad: 500 KB/doc ÷ ~550 B/producto ≈ 9000 productos por bucket × 32 ≈ **288k productos** de techo; el parque actual usa ~40 KB por bucket (12× de margen). El escritor valida el tope y falla con un error claro si un bucket lo supera (gate, no sorpresa en producción).
- Crecimiento futuro (>288k productos o buckets obesos por productos gigantes): **re-bucketización** 32 → 64 → 128 con bump de generación de familia (§6), no `#N`.

## 3. La diferencia semántica clave con la familia de ventas (leer antes de implementar)

El patrón de la familia de ventas NO se copia literalmente, porque los datos son de otra naturaleza:

| | Ventas (ya implementado) | Productos (este plan) |
|---|---|---|
| Naturaleza | registros **inmutables** (las mutaciones viajan como reemplazo del registro) | entidades **mutables y borrables** (precio, stock, delete) |
| Merge del lector | **unión por id** (legacy: local gana; periodo: entrante gana) | **reemplazo de franja** por bucket |
| Borrados | no existen (anulación = mutación) | `delete` de producto debe propagarse |
| Escritores concurrentes | caja que cobra | caja que cobra **y** checkout descuenta stock en cada venta |

Por eso: **un doc de bucket es la autoridad de SU franja de ids**. Aplicarlo = sustituir en el catálogo local exactamente los ids con `bucketOf(id) === bucket` por el payload entrante. Así un producto borrado desaparece del lector (el doc del bucket se reescribió sin él), y dos dispositivos que editan productos de buckets distintos nunca se pisan (hoy el doc completo es last-write-wins: la colisión se reduce 32×).

El legacy `bodega_products_v1` mantiene la semántica de ventas: **unión con "lo local gana"** (es histórico congelado); `[]` limpia TODO (semántica F3 de vaciado publicable).

## 4. Escritor (push)

`useCloudSync` gana el espejo exacto del patrón de ventas:

- `buildProductsSyncPlan(products)` → `[{ docId, bucket, records, bytes }]` (bucket fijo, orden por id, un doc por bucket).
- `pushProductsFamilySync(value, { stampDeviceId, hashKey, currentHash })`:
  - hash por doc (`LAST_PUSH_HASH_PREFIX + docId`) → **solo reescribe los buckets cuyo contenido cambió**;
  - tracking de docs publicados (`pda_products_sync_docs_v1`, espejo de `SALES_SYNC_TRACKING_KEY`) para poder tumbearlos en un vaciado total (la mecánica de tumbas vive inline en `pushSalesFamilySync` hoy, `const tombstones = [...new Set([BASE, ...readSalesSyncTrackedIds()])]` — se extrae y comparte);
  - **el legacy NO se reescribe** (migración perezosa, igual que en ventas);
  - `[]` → tumbas del legacy + todos los buckets tracked (misma mecánica del bloque de tumbas de `pushSalesFamilySync`).
- `pushCloudSync('bodega_products_v1', ...)` se vuelve family-aware **interna**mente (como pasó con ventas): ningún llamador cambia de API.

Llamadores que se benefician sin tocarse: `cloudPublishQueue.publishKeyNow('bodega_products_v1')` (su dedup por JSON completo sigue siendo correcto — evita vuelos redundantes), `pushLocalSync`/`_debouncePush`, `forceSyncAllPOSData`.

Llamadores que sí cambian:

- `publishInventoryDocs` (Fase 3): hoy `force=true` para productos "por ser monolítico"; con buckets, cada doc tiene hash y la familia se publica incremental como ventas — la justificación del `force` desaparece y ambos documentos publican con `force=false`.
- `resetPOSDataToEmpty` / `EMPTY_SNAPSHOT_KEYS`: el vaciado total debe tumbear los buckets tracked además del legacy (la mecánica de tumbas ya existe para ventas).

**La escritura local NO cambia**: `ProductContext`, `catalogLock` (RMW + merge 3-way bajo `pos_write_lock`), `checkoutProcessor`, `voidSaleProcessor` y el journal de inventario siguen sobre la clave local única `bodega_products_v1`. El sharding es solo el layout de documentos de la nube — igual que `bodega_sales_v1` local siguió siendo una sola clave. Esto es lo que mantiene el riesgo acotado.

## 5. Lector (contrato)

### `_applyFromCloud` (pull de la caja) y `useMonitorSync` (monitor)

Mismo patrón que `isSalesFamily`:

- **Filtro de docs**: en `useMonitorSync` (el `.select('collection, doc_id, updated_at')` + allowlist de `SUPERVISOR_SYNC_KEYS`/familia) se agrega `isProductsSyncDocId(doc.doc_id)`; el pull inicial baja los docs de la familia por `.in('doc_id', targetDocIds)` igual que hoy.
- **contractKey**: los docs de la familia se validan contra la clave base — `const contractKey = isProductsFamily ? 'bodega_products_v1' : docId` — pasando por `validateSupervisorSyncDocument` (`SYNC_VALIDATORS['bodega_products_v1']: Array.isArray`) y `STORE_SCHEMAS`. El contrato con el supervisor NO cambia: sigue conociendo `bodega_products_v1`, no los buckets.
- **Watermark** por docId (`getSyncMetadataKey(docId)` + `isNewerSyncDocument`) — mecanismo intacto; los buckets no tocados no se re-aplican.
- **Merge**: `mergeProductsSyncDoc(local, docId, payload)`:
  - doc legacy → unión, lo local gana; `[]` limpia todo;
  - doc de bucket → **reemplazo de franja**: `local.filter(p => bucketOf(p.id) !== bucket).concat(payload)`; `[]` limpia SOLO esa franja (tombstone del bucket);
  - espejo de validación de `mergeSalesSyncDoc`: `payload` no-arreglo → no-op.
- **Escritura**: siempre en la clave local única `bodega_products_v1` (`writeKey`), con `app_storage_update` para que React refresque — idéntico al flujo de ventas.
- **Hash bookkeeping**: `LAST_PUSH_HASH_PREFIX + docId` por bucket con el hash de SU payload + el hash de la clave base con el arreglo fusionado (patrón exacto de `_applyFromCloud` para la familia de ventas) — impide que el push periódico re-suba lo que acabamos de bajar.

## 6. Migración del doc legacy de 1.32 MB

- **M1 — perezosa, sin ventana de dual-write**: en cuanto el escritor publica buckets, el legacy se congela (no se reescribe más que para tumbas de vaciado). Un lector siempre ve *legacy (todo, congelado) + buckets (lo cambiado, fresco)* = estado completo y correcto desde el primer momento. No hay punto en el que un lector pierda productos: el legacy nunca se adelgaza ni se borra en esta fase.
- **M2 — retiro del legacy (decisión aparte, NO en la primera implementación)**: cuando la evidencia de tracking muestre que los 32 buckets fueron publicados, se publica un doc marcador `bodega_products_v1:gen2`; los lectores que lo conocen **ignoran el legacy** (la autoridad pasa a ser solo los buckets). Riesgo documentado: un monitor con la app vieja seguiría aplicando el legacy congelado (incompleto pero no corrupto) — el marker solo se publica tras actualizar el parque de monitores.
- **Pull inicial**: una vez baja el legacy completo (igual que hoy), los re-pulls son por watermark y solo traen buckets tocados.

## 7. Riesgos y mitigaciones

| Riesgo | Mitigación |
|---|---|
| Un merge unión no propaga borrados de productos | contrato de **reemplazo de franja** por bucket (§3) + prueba de borrado explícita |
| Partir buckets en `#N` rompe la derivabilidad de franjas (un borrado no sabría qué ids le faltan a su shard) | **prohibido por diseño**: un doc = una franja; el crecimiento es re-bucketización con bump de generación |
| Un bucket supera 500 KB (productos gigantes con `lots`/`movimientos`) | validación del escritor con error claro (gate) + techo medido de ~288k productos; monitoreo del tamaño por doc |
| Dos POS escriben el mismo bucket | LWW por bucket (hoy es LWW por doc completo = 32× peor); refinamiento futuro: LWW por `updatedAt` de producto dentro del merge |
| Un hash por doc salta un bucket que cambió en la nube | el hash se invalida al aplicar docs remotos (ya ocurre: `_applyFromCloud` actualiza `LAST_PUSH_HASH_PREFIX`) |
| El checkout descuenta stock en cada venta → publica buckets tras cada cobro | ~2-3 buckets × 40 KB vs 1.32 MB completos; el plan adyacente `docs/plans/2026-10-21-plan-stock-delta-en-doc-de-venta.md` elimina la publicación por cobro viajando el delta con la venta |
| Eco optimista del monitor / `classifyProductPublishResult` (`skipped` = pendiente) | semántica intacta: la familia publica por hash; `skipped` sigue significando "sin cambios = ya publicado" |
| Backups/exports (`backupArchive`, `backupRestoreService`, export de `SettingsModal`) | leen la clave local única → **sin cambios** |
| Docs de >500 KB rechazados por Supabase/413 (hay un test `monitorSyncOversize413`) | 32 docs de ~40 KB eliminan el caso en el parque actual |
| Monitores viejos durante M2 | el marker `:gen2` solo se publica tras actualizar el parque (§6) |

## 8. Pruebas y gates (para la implementación futura)

1. `productBucketOf` estable para las mismas entradas (mismo producto → siempre el mismo doc, en cualquier dispositivo).
2. `buildProductsSyncPlan`: round-trip sin pérdidas ni duplicados, un doc por bucket, tope por doc, orden canónico.
3. `mergeProductsSyncDoc`: reemplazo de franja; **el borrado propaga**; `[]` limpia solo el bucket; legacy unión local-gana; `[]` legacy limpia todo.
4. **Fail-first del push incremental**: un cambio de un producto reescribe solo SU bucket (hoy reescribe el doc completo).
5. Carreras: publicación coalescida de productos + venta concurrente (las pruebas de `cloudPublishQueue.test.js` siguen tal cual) y el e2e `supervisor-inventory-recovery` sin cambios de aserción.
6. **Gate de medición**: `[PERF] edit de producto` sube ~40 KB (vs 1.32 MB) y los chars del lote bajan de 11.3 M a ~5–6 M; si no mejora, se revierte (misma regla que la Fase 4).

## 9. Archivos a tocar y orden de ejecución

1. **Helpers puros + tests** (nada de I/O): `productBucketOf`, `isProductsSyncDocId`, `buildProductsSyncPlan`, `mergeProductsSyncDoc` en `src/hooks/useCloudSync.js` + `tests/cloudSyncProductsShards.test.js` (espejo de `tests/cloudSyncSalesPeriods.test.js`).
2. **Push family-aware** + fail-first (4) + tumbas/tracking.
3. **Lector**: `_applyFromCloud` + `useMonitorSync` (filtro, contractKey, merge, hash bookkeeping).
4. **Llamadores**: `publishInventoryDocs` (fin del `force` de productos), `resetPOSDataToEmpty` (tumbas de buckets).
5. **Medición + e2e** (gate 6) y solo después considerar M2 (`:gen2`).

Cada paso es desplegable y reversible por revert del diff (sin migraciones de base: los docs viven en `sync_documents` con el mismo contrato).
