# FIX — Las ventas de la caja no descontaban stock en el Supervisor

**Fecha:** 2026-10-18 · **Estado:** corregido y verificado (tests/lint/typecheck/build) · **Verificación en dispositivos físicos:** pendiente del usuario

---

## 1. Síntoma

Con ~2.434 productos en el catálogo, una venta en la caja (p. ej. `PRUEBA` 110 → 105, `MAYONESA KRAFT 445GR` 7 → 0) **no se reflejaba en el dispositivo Supervisor**: seguía mostrando 110 u / 7 u mientras la caja ya mostraba 105 / 0. Reiniciar, recargar, borrar los datos de la app y volver a emparejar **no lo solucionaba**: el valor viejo no estaba en el dispositivo, vivía en la fila `sync_documents` de la nube y cada reemparejo lo volvía a bajar.

Firma del bug: **los ajustes hechos DESDE el supervisor sí llegaban a la caja, pero las ventas de la caja NO llegaban al supervisor** (asimetría de un solo sentido).

---

## 2. Causa — tres fallas apiladas

Se necesitaban las tres para explicar el síntoma; arreglar una sola no bastaba.

### C1 — El push de la caja se saltaba como "Sin cambios" (hash truncado)

`quickHash` (en [useCloudSync.js](../src/hooks/useCloudSync.js) y su gemelo en [useAutoBackup.js](../src/hooks/useAutoBackup.js)) solo recorría **los primeros 5.000 caracteres** del JSON + su largo. Con miles de productos, `stock: 110 → 105` queda muy pasado ese límite y, al no cambiar el largo del JSON, el hash resultaba **idéntico**: `pushCloudSync` descartaba el push como `"Sin cambios"` y la venta jamás se publicaba.

Por eso la asimetría: los comandos del supervisor se publican con `forceUnconditional` (saltan el hash), pero las ventas —el único camino regido por hash— no.

**Solución:** `quickHash` recorre el valor COMPLETO, con comentario que prohíbe volver a cortarlo. Prueba rojo-verde: [tests/cloudSyncDeepChangePush.test.js](../tests/cloudSyncDeepChangePush.test.js).

### C2 — El evento Realtime de >1 MB llegaba vacío y se tragaba sin respaldo

`bodega_products_v1` roza el límite `max_record_bytes` (~1 MB) de Supabase Realtime. Cuando lo supera, el evento llega con el **registro vacío** y `payload.errors: ['Error 413: Payload Too Large']`. El handler descartaba todo evento sin cuerpo, y el pull de recuperación (cada 5 min) solo corría con el canal **caído** — pero el canal se veía "conectado", así que el cambio se perdía aunque hubiera llegado a la nube.

**Solución:** patrón **FS1** del plan de Donde Juancho (`PLAN_FIXES_PROPAGACION_SUPERVISOR.md`): *nunca descartar un evento sin cuerpo → pull de respaldo con throttle*. Implementado como `isOversizeRealtimePayload()` en [supervisorSyncService.js](../src/services/supervisorSyncService.js) + un pull de respaldo por ráfaga (≤ 3 s, `OVERSIZE_PULL_THROTTLE_MS`) en [useMonitorSync.js](../src/hooks/useMonitorSync.js). Prueba end-to-end: [tests/monitorSyncOversize413.test.jsx](../tests/monitorSyncOversize413.test.jsx).

### C3 — El "stock creído" de un ajuste previo tapaba el descuento

El supervisor mantiene una op de stock por producto: `targetStock` "creído" (aplicado en la caja aún sin sincronizar). La op solo se retiraba si el eco coincidía **exacto** con el objetivo; si una venta dejaba el objetivo viejo (creído 115 vs real 110), la op quedaba en `applied` para siempre y **enmascaraba** el descuento en la fila.

**Solución:** `sinceWatermark` al iniciar el ajuste + el caso `superseded` en `planStockOpReconciliation` ([supervisorStockOps.js](../src/services/supervisorStockOps.js)): un eco **más nuevo** que la op y con stock distinto del objetivo retira el objetivo de inmediato y la fila vuelve al stock sincronizado (que trae el descuento). Wiring en [OwnerMonitorView.jsx](../src/views/OwnerMonitorView.jsx); pruebas en [tests/supervisorStockOps.test.js](../tests/supervisorStockOps.test.js) y [tests/ownerMonitorStockOpsWiring.test.jsx](../tests/ownerMonitorStockOpsWiring.test.jsx).

---

## 3. Verificación

- Cada bug con su prueba **rojo-verde** (falla antes del fix, pasa después).
- 72 tests en 8 suites verdes; ESLint 0; `tsc` 0; `ELECTRON_BUILD=true vite build` OK.
- **Auto-reparación:** con el hash arreglado, el primer push después del rebuild detecta el desfase y **re-publica el catálogo completo** sin tocar nada más; el supervisor descuenta en ≤ 3 s (o ≤ 3 s + throttle del pull de respaldo si el evento vuelve vacío).
- **Pendiente (manual):** venta de prueba en la caja sobre los dispositivos reales. Si se usaba la PWA en el navegador, cerrar todas las pestañas o Ctrl+Shift+R (el service worker cachea la versión vieja).

---

## 4. Concurrencia: venta del mismo artículo mientras el supervisor lo edita

**Sí hay salvaguardas.** El diseño es *rechazo limpio + reconciliación* (control optimista), nunca actualización perdida:

1. **Serialización en la caja.** Ventas ([checkoutProcessor.js](../src/utils/checkoutProcessor.js)), anulaciones ([voidSaleProcessor.js](../src/utils/voidSaleProcessor.js)) y comandos del supervisor ([useRemoteCommands.js](../src/hooks/useRemoteCommands.js)) escriben los documentos de inventario bajo el **mismo candado** `pos_write_lock`. Una venta y un comando nunca intercalan su lectura-modificación-escritura: o va primero la venta o va primero el comando.

2. **Edición de campos del producto (precio, nombre, imagen…) con venta simultánea → conviven los dos efectos.** `applySupervisorProductCommand` ([supervisorProductCommand.js](../src/services/supervisorProductCommand.js)) **preserva estrictamente** `stock`, `stockInLotes`, `lots`, `movements` e `initialStock` del estado ACTUAL de la caja y solo aplica `EDITABLE_PRODUCT_FIELDS`. El descuento de la venta sobrevive siempre; la edición se aplica encima. Como `buildProductRevision` excluye `stock`, una venta **no** invalida una edición de precio.

3. **Ajuste de stock del supervisor con venta simultánea → gana la venta, el ajuste se rechaza.** El comando lleva `expectedStock` (la base sobre la que se calculó el movimiento) y la caja exige **igualdad exacta** antes de aplicar (`calculateSupervisorInventoryBatchAdjustment/Plan`): si una venta ya descontó, lanza `"El stock cambió antes de aplicar: esperado X, actual Y"` y el lote entero cae (todo-o-nada). La venta nunca se pierde; la op del supervisor pasa a `failed` y la fila vuelve al stock sincronizado, que ya incluye el descuento. **No hay re-aplicación automática del ajuste**: debe reintentarse sobre el nuevo stock, a propósito (un egreso no debe recalcularse en silencio contra otra base).

4. **Dos ediciones concurrentes sobre los mismos campos → la segunda se rechaza.** Control optimista determinista por `baseRevision` (sin fallback de timestamp): `"El producto cambió mientras lo editabas; vuelve a cargarlo"`.

5. **Si ambos ya se aplicaron** (la venta fue después del ajuste del supervisor): el caso `superseded` de `planStockOpReconciliation` retira el objetivo creído en cuanto llega un eco más nuevo con otro stock — esta era la C3 de arriba.

6. **Corte a mitad de aplicación.** Journal write-ahead (`bodega_supervisor_inventory_journal_v1`) con recuperación determinista roll-forward/rollback (`recoverSupervisorInventoryJournal`), escrituras verificadas por relectura, y bloqueo `recoverable` (nunca `rejected`) de nuevas ops de inventario mientras haya incertidumbre.

7. **Comandos que llegan tarde.** TTL extendido ([20261017_supervisor_command_ttl_extended.sql](../supabase/migrations/20261017_supervisor_command_ttl_extended.sql)); los expirados resuelven `ORDER_EXPIRED` y la op pasa a `failed` sin tocar el stock.

**Ventana residual conocida:** entre que el supervisor compone su base y la caja aplica, una venta puede hacer que el ajuste se rechace (caso 3). Es seguro pero manual: hay que reintentar el ajuste sobre el nuevo stock.

**Hueco detectado (2026-10-18, auditoría «supervisor y cajero sobre el mismo artículo»):** las mutaciones locales del catálogo desde `ProductContext` (`adjustStock`, `setDirectStock` y el guardado del estado) escriben `bodega_products_v1` **sin** `pos_write_lock`, mientras que la aplicación de comandos del supervisor sí lo usa. Si el cajero toca el mismo artículo mientras un comando del supervisor se está aplicando, el último en escribir puede pisar al otro (*lost update*): el ajuste del supervisor puede quedar pulado pese al ACK, o perderse la edición local. Ventana de milisegundos, pero real; el sello «No coincide — revisar» (propuesta 7) y la reconciliación `superseded` lo delatan, pero el cambio ya se perdió.

**CERRADO (2026-10-18):** los escritos locales del catálogo ya pasan por `pos_write_lock`, con dos capas en [catalogLock.js](../src/utils/catalogLock.js) y [ProductContext.jsx](../src/context/ProductContext.jsx):

1. **Serialización:** el auto-save del catálogo, `adjustStock`, `setDirectStock` y el borrado confirmado (VUL-003) escriben dentro de `withLock('pos_write_lock')`, el mismo candado que ventas y comandos. `adjustStock`/`setDirectStock` además son read-modify-write sobre el catálogo **fresco** de storage (antes escribían el array de estado, que podía ser viejo).
2. **Merge 3-way por campo:** el auto-save ya no «pinta por encima» de storage. Compara el estado local contra el último snapshot sincronizado (`persistedRef`) y solo escribe los campos que el cajero tocó; el resto se toma del remoto fresco. Una venta u orden del supervisor aplicada en la ventana del debounce (1 s) sobrevive al guardado del cajero, y viceversa. El refresco de estado por eventos remotos usa el mismo merge, así una orden en vuelo no barre una edición local sin persistir.

**Prueba rojo-verde:** [productContextCatalogRace.test.jsx](../tests/productContextCatalogRace.test.jsx) reproduce la carrera (edición del cajero en vuelo + orden del supervisor aplicada en la ventana del debounce). Fallaba antes del cierre (el nombre del cajero se perdía en silencio) y pasa ahora: ambos cambios sobreviven. Segunda prueba: el ajuste rápido de stock no revierte la orden del supervisor.

**Escritores uniformados (2026-10-18):** además de `ProductContext`, los escritores directos del catálogo pasan por `catalogLock` — guardado/creación/edición/borrado y migración de imágenes en [ProductsView.jsx](../src/views/ProductsView.jsx) (`persistCatalogLocked`), tamaños de empaque en [StockBatchModal.jsx](../src/components/Products/StockBatchModal.jsx) y ajuste masivo de precios + undo en [BulkPriceAdjustModal.jsx](../src/components/Products/BulkPriceAdjustModal.jsx) (`mutateCatalogLocked`: el patch se aplica sobre precios **frescos**, así una venta u orden concurrente sobrevive). Semántica fijada en [catalogLock.test.js](../tests/catalogLock.test.js) (9 pruebas).

**Límites conocidos:** (a) si cajero y supervisor editan el **mismo campo**, gana el cajero (último escritor) — detectarlo requeriría revisión por campo como el `baseRevision` del supervisor; (b) quedan fuera del candado por diseño tres escritores no transaccionales: la recuperación de emergencia de [ErrorBoundary.jsx](../src/components/ErrorBoundary.jsx) (vaciar datos corruptos), el inyector de datos de pruebas ([deterministicInjector.js](../src/testing/deterministicInjector.js)) y la restauración de backups (reemplazo total intencional).

---

## 5. Origen del patrón FS1

La auditoría del POS de Donde Juancho (`PLAN_FIXES_PROPAGACION_SUPERVISOR.md`, su causa del 413 + su fix FS1 de "pull de respaldo por evento sin cuerpo") documentaba exactamente esta falla y su solución; se adoptó ese patrón tal cual en C2.
