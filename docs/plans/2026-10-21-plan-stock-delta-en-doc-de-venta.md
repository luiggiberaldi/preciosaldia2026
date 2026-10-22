# Plan: el delta de stock viaja dentro del doc de la venta

> **Estado (2026-10-21): FASE 1 IMPLEMENTADA y verificada.** Complemento al
> plan de shards (`docs/plans/2026-10-21-plan-adelgazar-bodega-products-por-shards.md`):
> ese plan achica la publicación estructural del catálogo; este elimina la
> publicación del catálogo por cada COBRO, haciendo que el movimiento de stock
> viaje con la venta — que ya se publica igualmente.
>
> Fase 1 entregada: pasos 1–2 del orden de ejecución (§8) MÁS el cableado de
> lectores (paso 3) que se subió aquí porque suprimir la publicación sin él
> dejaba el stock del monitor congelado — la fase tenía que ser desplegable por
> sí sola. **Paso 4 cerrado (2026-10-22): medición de flujo real + e2e de
> navegador, ambos en verde** (ver §8.4). Pendiente: solo el desacople del lote
> supervisor (fase aparte, §6.6). Gate fail-first demostrado: sin el flag el
> test del cobro falla (`expected undefined to deeply equal { skipSyncPush: true }`)
> y el gate de medición registra 3 upserts de catálogo.

---

## 1. Por qué (medido en el código)

Hoy, **cada cobro publica el catálogo completo** sin que nadie lo pida:

- `checkoutProcessor` descuenta stock y escribe `bodega_products_v1` (bajo `pos_write_lock`).
- `storageService.setItem` **auto-encola** el push de cualquier clave de sync (`queueCloudSync(key, value)`, interceptor L132) → `_debouncePush` con debounce de 3000 ms para claves pesadas.
- `pushCloudSync` serializa y sube el doc entero: `quickHash` de 1.32 M chars + `JSON.stringify` del upsert de 1.32 M chars + 1.32 MB de subida. En hora pico eso es un doc completo cada ráfaga de ~3 s, más el monitor re-aplicando y re-renderizando el catálogo entero por cada evento.

La venta ya viaja a la nube por su cuenta (familia de ventas por periodos, incremental). El stock que la venta movió **ya está calculado en la caja en el momento del cobro** (`totalDeducted`, `newStock`, con redondeo granel y clamp de negativos), pero hoy no se persiste en ningún lado (solo se loguea el caso de stock negativo en `negativeItems`). Mover ese delta al registro de venta hace que un cobro publique **cero bytes de catálogo**.

Con los shards de productos (plan aparte) el costo por cobro baja a ~2–3 buckets (~120 KB), pero sigue siendo publicación por cobro; este plan la elimina. Los dos diseños son **complementarios**: shards para cambios estructurales, delta para stock.

## 2. El modelo elegido: log de efectos embebido + baseline `stockAsOf`

**Un registro de venta (o de ajuste) lleva sus efectos de stock; el doc de productos lleva la marca de hasta cuándo su `stock` ya los incluye.**

- El registro de venta gana `stockEffects: [{ productId, delta, stockBefore, stockAfter, at }]`:
  - `delta = stockAfter − stockBefore` **real aplicado** (después del clamp a 0 y del redondeo granel — NO la cantidad pedida: si había 2 y se pidieron 5 con clamp, delta = −2);
  - `at` = instante del cambio (reloj local del dispositivo, el mismo dominio que el `timestamp` de la venta que define su periodo).
- La **anulación** muta el registro como hoy (`status: 'ANULADA'` viaja como reemplazo del registro, convención existente) y **agrega los efectos inversos** al log del registro: `[{ productId, delta: +X, at: <momento de la anulación> }]`. El registro reemplazado llega con su log completo.
- Los **lotes del supervisor** ya viajan en la familia de ventas como movimientos `AJUSTE_*` con `unitsDelta`/`stockBefore`/`stockAfter` → se embeben como efectos idénticos (delta real), sin contrato nuevo.
- El doc de productos (monolito hoy, `:bNN` con shards) se publica con **`stockAsOf`** = instante del estado de stock que refleja.

**Fórmula del lector (monitor y pull de la caja):**

```
stockVisible(product) = product.stock                          // baseline del catálogo
                      + Σ efectos de la familia de ventas      // solo los con at > stockAsOf
                        cuyo productId === product.id
```

Reconciliar es **re-derivable desde cero en cualquier momento** (recalcular la suma sobre la lista local de ventas ya fusionada): idempotente (cada registro cuenta una vez — la unión de la familia ya deduplica por id), insensible al orden (es una suma), y auto-sanador (un doc perdido o re-entregado no rompe nada; si falta un registro, el error es exactamente su delta y desaparece cuando llega).

## 3. Supresión del push de catálogo por stock puro

- Los call-sites que **solo** cambian stock (`checkoutProcessor`, `voidSaleProcessor`) escriben el catálogo local exactamente igual (es el estado del POS) pero **sin encolar el push de productos**: variante explícita del interceptor (p. ej. `storageService.setItem(key, value, { skipSyncPush: true })` o un `runWithoutPush` hermano de `runWithoutEco`). Decisión en el call-site, no un diff frágil de "¿cambió solo stock?".
- Los cambios **estructurales** (alta, baja, edición, import, precios, lotes) siguen publicando el catálogo normalmente (el plan de shards los achica a su bucket).
- **Re-baseline de seguridad**: la publicación del catálogo en arranque/vinculación (`forceSyncAllPOSData`, que ya existe) re-baselinea `stockAsOf` con el stock vivo, absorbiendo cualquier efecto mal-clasificado por un salto de reloj. Periodicidad recomendada: al arranque (ya ocurre) + el auto-backup diario; no se necesita nada más.

## 4. Casos borde resueltos por el modelo

| Caso | Resolución |
|---|---|
| Anulación de una venta **anterior** al baseline | su efecto original ya está en el baseline (no cuenta); el efecto inverso tiene `at > stockAsOf` y sí aplica → neto correcto (+X) |
| Venta posterior al baseline luego anulada | −X y +X ambos > `stockAsOf` → neto 0 ✓ |
| Clamp a 0 / stock negativo (`allow_negative_stock`) | el delta es el **cambio real** (`stockAfter − stockBefore`), no la cantidad pedida |
| Granel (3 decimales) y modo `_mode: 'unit'` (qty ÷ `unitsPerPackage`) | el delta lo calcula la caja, que es la única que conoce el estado y la conversión en el momento; el lector nunca re-deriva cantidades |
| Lotes (`lots`, `stockInLotes`) | el checkout **no toca lotes** (verificado en `checkoutProcessor`); solo se mueve `stock`. La vista de lotes del monitor se re-baselinea con cada publicación estructural del catálogo — **limitación aceptada y documentada** |
| Salto de reloj hacia atrás | un efecto podría mal-clasificarse respecto a `stockAsOf`; se corrige solo en el próximo re-baseline (arranque/auto-backup) y queda logueado |
| Multi-caja | cada `device_id` tiene su propia familia de docs (el monitor lee `.eq('device_id', pairedDeviceId)`): la derivación es por stream de un dispositivo, un solo reloj |
| Vaciar datos (`resetPOSDataToEmpty`) / eco de sync | intactos: los efectos viajan dentro de la familia de ventas, ya protegida por `isSyncingFromCloud` |
| Movimientos supervisor en lote | ya traen `stockBefore`/`stockAfter` → efectos 1:1 (§2) |

## 5. Alternativas descartadas

- **LWW por `stockAfter` (el registro más nuevo gana):** sensible al orden de llegada y a mezclas de reloj; no re-derivable sin reglas de precedencia. La suma de deltas no necesita nada de eso.
- **Derivar el delta en el lector desde `items[].qty`:** imposible reproducir clamp, redondeo granel y conversión `_mode: 'unit'` sin el estado del producto en el momento del cobro → por eso el delta lo embebe la caja.
- **Doc de movimientos de stock separado:** un doc más por cobro (más writes, más ecos, más watermark) para viajar en el mismo viaje que la venta.
- **Debounce más largo / coalescer el catálogo:** reduce pero no elimina; en hora pico el doc completo vuelve en cuanto hay ventas sostenidas.

## 6. Impacto por archivo (para la implementación)

1. ✅ `src/utils/checkoutProcessor.js` — `stockEffects` embebido en el registro de venta (delta real post-clamp, con `stockBefore`/`stockAfter`/`at`) + productos con `skipSyncPush`.
2. ✅ `src/utils/voidSaleProcessor.js` — efectos inversos al mutar a `ANULADA` (log append-only en el registro reemplazado) + `skipSyncPush`.
3. ✅ `src/utils/storageService.js` — opción `skipSyncPush` en `setItem` (sin cambiar el default).
4. ✅ `src/hooks/useCloudSync.js` — `stockAsOf` sellado en el envelope del catálogo (con `capturedAt` = instante de captura del valor, no el del upsert) + `collectStockEffectsDeltas`/`reconcileStockFromEffects` puros.
5. ✅ `src/hooks/useCloudSync.js` (`_applyFromCloud`, rama de productos) y `src/hooks/useMonitorSync.js` (baseline `pda_products_stock_baseline_v1` + re-derivación al aplicar ventas o catálogo).
6. **Fase aparte (no en esta entrega):** el lote de inventario del supervisor (`supervisorInventoryCommand`) publica productos pese a ser un cambio de stock puro; sus movimientos ya viajan con `stockBefore`/`stockAfter` y el lector ya los pliega como efectos, pero su flujo de journal/recuperación asume la publicación de ambos docs. Desacoplarlo exige re-plantear `pendingKeys` — se deja como segunda fase con su propio análisis.

## 7. Pruebas y gates

1. **Fail-first:** hoy un cobro encola el push de `bodega_products_v1`; tras el cambio, un cobro publica solo su venta (0 docs de catálogo) y una edición estructural sí publica.
2. Reconciliación pura: venta → stock derivado; anulada → restaurado; venta pre-baseline + anulación post-baseline → neto +X; idempotente ante re-entrega y desorden; clamp a 0 con delta real; granel a 3 decimales.
3. Los movimientos de lote supervisor se pliegan igual (1:1 con `stockAfter`).
4. e2e existentes (`supervisor-inventory-recovery`, `auditoria-flujos`, checkout) sin cambios de aserción — el estado local no cambió.
5. **Gate de medición:** en `tests/supervisorCommandJank.perf.test.js` o un hermano, un ciclo de N cobros publica `0 bytes` de catálogo y ~N docs de periodo (los de la venta, ya inevitables); si el flujo real de punta a punta no mejora, se revierte (misma regla que las Fases 3–4).

## 8. Orden de ejecución

1. ✅ Helpers puros + tests de reconciliación (`tests/stockDeltaReconciliation.test.js`, matriz del §7.2).
2. ✅ `skipSyncPush` en `storageService` + call-sites de checkout/void (`tests/storageServiceSkipSyncPush.test.js` + gate en `tests/granelSaleVoidE2E.test.js`, fail-first demostrado).
3. ✅ Sellado de `stockAsOf` + reconciliación en los lectores (prueba end-to-end del monitor en `tests/supervisorSyncEcho.test.jsx`: baseline + efectos + re-entrega idempotente).
4. ✅ Medición de flujo real + e2e de navegador (cerrado 2026-10-22):
   - **Gate de medición** — `tests/stockDeltaCheckout.perf.test.js` sobre el
     catálogo real (2434 productos, 1.32 MB): 3 cobros → **0 docs / 0 bytes de
     catálogo** (catálogo local intacto: 1.321.626 chars) y la familia de ventas
     publica 3 docs / 8.253 bytes. Control positivo: una escritura legacy del
     catálogo publica 1 doc / 1.321.866 bytes — el detector no está ciego.
     Fail-first demostrado: sin `skipSyncPush` en el call-site, el gate falla
     con 3 upserts de catálogo (uno por cobro).
   - **E2e de navegador** — `tests/e2e/stock-delta-flow.e2e.spec.js`
     (`npm run test:e2e:stock-delta`): cobro → `stockEffects` embebidos en la
     venta y catálogo sin republicar; anulación → efectos inversos en el
     registro reemplazado; tras recargar, la derivación del monitor
     (`baseline + Σ efectos`) cuadra con el stock local. IndexedDB real, no
     storage falso.
   - **Regresión**: 76 unitarios relacionados (reconciliación, `skipSyncPush`,
     granel/anulación, eco de sync, cartera, motor financiero) + los e2e
     `auditoria-flujos` (16 flujos) y `supervisor-inventory-recovery` verdes.
   - **Hallazgos preexistentes corregidos en el camino** (ambos de commits del
     12-oct, ajenos a este plan): (a) la cartera del cliente convertía Bs→USD
     con el BCV crudo en vez de `effectiveRate` — F3: un abono de Bs 120 de un
     fiado de $3 a 40 Bs/$ acreditaba $0,14 y dejaba $2,86 de deuda; ahora los
     flujos de cartera usan `effectiveRate` y los de proveedores conservan el
     BCV real (decisión de `a3562ba`); (b) el e2e F6 buscaba el botón
     «Descargar PDF» que `2e05448` renombró a «PDF de ventas y caja» — solo el
     selector, sin tocar aserciones.
5. (Fase aparte) desacoplar el lote supervisor de la publicación de productos.

Cada paso es desplegable y reversible por revert del diff; no hay migraciones de base ni de formato de doc remoto (los campos nuevos son aditivos y los lectores viejos los ignoran).
