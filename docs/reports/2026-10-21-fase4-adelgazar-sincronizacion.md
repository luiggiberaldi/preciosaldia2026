# Handoff — Fase 4: adelgazar la sincronización de ventas (2026-10-21)

**Plan:** [`docs/plans/2026-10-20-plan-fix-incidente-senales-y-codigo-vinculacion.md`](../plans/2026-10-20-plan-fix-incidente-senales-y-codigo-vinculacion.md)
**Prompt ejecutado:** "Ejecuta solo la Fase 4 del plan. Parte bodega_sales_v1 por periodos con merge en el lector y compatibilidad con documentos legacy. No cambies la semántica de watermark ni el pull inicial."
**Restricción de la sesión:** sin consultas a la nube (todo el cierre es evidencia local).

---

## Comportamiento implementado

La familia `bodega_sales_v1` deja de publicarse como documento monolítico y se parte por periodos, con compatibilidad total hacia atrás:

| Regla | Contrato |
|---|---|
| Periodo de una venta | `YYYY-MM` de su `timestamp`/`fecha`; sin fecha válida → `recent` |
| Nombres de doc | `bodega_sales_v1:<YYYY-MM>`, shards `#2`, `#3`… por presupuesto de bytes (400 KB de empaquetado, cota dura 500 KB) |
| Orden canónico | (fecha, id): un append al final del mes reescribe solo el último shard |
| Merge del lector | doc **legacy**: unión, lo local gana por id; `[]` limpia todo. Doc **de periodo**: unión, lo entrante gana por id (las mutaciones tipo `ANULADA` viajan en el periodo); `[]` limpia SOLO ese periodo |
| Legacy `bodega_sales_v1` | sigue legible para siempre; ya **no se reescribe** (migración perezosa al escribir) |
| Escritura incremental | hash por documento: solo se reescribe el periodo/shard tocado, nunca el historial |
| Watermark y pull inicial | **sin cambios** (exigido por el prompt) |

El lector (monitor y pull inicial) mergea los docs de la familia en la clave `bodega_sales_v1` que consume el resto de la app, de modo que ningún consumidor nota la partición.

## Archivos

| Archivo | Cambio |
|---|---|
| `src/hooks/useCloudSync.js` | `buildSalesSyncPlan`, `getSalesSyncPeriodOf`, `mergeSalesSyncDoc`, constantes `SALES_SYNC_*`, fan-out de publicación por periodo con hash por doc, tracking de docs publicados (`pda_sales_sync_docs_v1`) para tumbstones de vaciado total |
| `src/hooks/useMonitorSync.js` | merge de la familia en el lector; pull incremental metadatos-primero SIN filtro `doc_id` en el SQL (el payload se pide solo por ids explícitos permitidos; SEC-002 se conserva en forma equivalente, sin `.like`) |
| `tests/supervisorLifecycle.test.js` | guardrail SEC-002 actualizada a la forma equivalente (ahora también encierra la regla de familia) |
| `tests/cloudSyncSalesPeriods.test.js` | **nuevo**: 15 pruebas (periodo, shards, merge, legacy, tombstones, escritura incremental) |
| `tests/cloudSyncSalesPeriodsRealData.test.js` | **nuevo**: gate de medición con el backup local real (se salta solo si el backup no existe) |
| `supabase/migrations/20261021_sales_period_docs_index.sql` | **solo archivo** (regla 7): índice único `(device_id, collection, doc_id)` + índice de apoyo `(device_id, doc_id)`, y limpieza opcional comentada del monolito legacy |

## Comandos y resultados

| Comando | Resultado |
|---|---|
| `npx vitest run tests/cloudSyncSalesPeriods.test.js` | 15/15 ✅ |
| `npx vitest run tests/cloudSyncSalesPeriodsRealData.test.js` | 1/1 ✅ (evidencia abajo) |
| `npx vitest run tests/supervisorSyncEcho.test.js` | 23/23 ✅ (eco caja→monitor reparado en la causa) |
| `npx vitest run supervisor` | 52 archivos / 613 pruebas ✅ |
| `npx vitest run` (completa) | 150 archivos / 1646 pruebas ✅ (10 skip) |
| `npx tsc --noEmit -p tsconfig.json` | ✅ |
| `npx eslint src/hooks/useCloudSync.js src/hooks/useMonitorSync.js` | ✅ 0 errores |

**Flake conocido, no relacionado:** `supervisorAckTelemetry` (prueba de latencia del ACK) falló una vez aislada dentro de la suite completa por inanición de CPU; aislada pasa 3/3 con p95 de 2.5 ms contra presupuesto de 60 ms, y la suite completa pasó íntegra al repetirla. Mismo patrón que el flake de `backupCompleteRetired`.

## Evidencia de medición antes/después (gate de la fase)

Sobre el backup local real de producción (`backups/supabase/backup_…2026-10-19….json`, 193 filas de `sync_documents`, 20 dispositivos con ventas), **antes** había 7 documentos monolíticos de ventas por encima de 500 KB (600.8–651.1 KB). Después de particionar:

```
PDA-V2-9DB64… 431 ventas | monolítico 600.8KB → 4 docs [2026-10: 6.9KB, 2026-08: 389.3KB, 2026-08#2: 64.7KB, 2026-07: 140.0KB]
PDA-V2-F53FC… 465 ventas | monolítico 642.3KB → 2 docs [2026-10: 389.4KB, 2026-10#2: 252.9KB]
PDA-V2-AD516… 496 ventas | monolítico 651.0KB → 2 docs [2026-10: 389.4KB, 2026-10#2: 261.6KB]
PDA-V2-D6F45… 457 ventas | monolítico 634.5KB → 2 docs [2026-10: 389.4KB, 2026-10#2: 245.1KB]
PDA-V2-6ED14… 452 ventas | monolítico 631.0KB → 2 docs [2026-10: 389.4KB, 2026-10#2: 241.6KB]
PDA-V2-F3286… 449 ventas | monolítico 628.8KB → 2 docs [2026-10: 389.4KB, 2026-10#2: 239.4KB]
PDA-V2-D1326… 456 ventas | monolítico 633.8KB → 2 docs [2026-10: 389.4KB, 2026-10#2: 244.4KB]
(resto de dispositivos: 0.2–445.0KB → 0–3 docs, ninguno cerca del tope)
```

- **Máximo por documento después de particionar: 389.4 KB** (< cota dura de 500 KB) en los 20 dispositivos reales.
- Round-trip verificado por el gate: la partición no pierde ni duplica ventas (ids exactos) y el merge del lector reconstruye exactamente el historial real.

## Migraciones: escritas vs aplicadas

| Migración | Estado |
|---|---|
| `20261020_supervisor_command_server_clock.sql` | **Aplicada y verificada en producción** (2026-10-20, fuera de este plan) |
| `20261021_sales_period_docs_index.sql` | **Escrita, NO aplicada.** Requiere aprobación explícita aparte (regla 7). Incluye, comentada, una limpieza opcional del monolito legacy > 500 KB cuya ejecución queda a decisión del dueño de los datos |

## Pendientes y riesgos (honestos)

1. **Gate en nube sin cerrar:** el plan pide verificar ausencia de `57014` en la ventana de prueba de Supabase. La sesión fue explícitamente sin consultas a la nube, así que ese gate queda **pendiente de una ventana de observación** posterior (aplicar la migración + dejar correr la migración perezosa de escritura).
2. **`bodega_products_v1` sigue > 500 KB** (máx. 1.29 MB en 20 docs del backup): el recorte de campos redundantes (imágenes) estaba en la *descripción* de la fase pero **no** en el prompt autorizado ("parte bodega_sales_v1 por periodos…"), y la regla 4 prohíbe alcance colateral. Mientras exista, el criterio global "ningún documento supera ~500 KB" no se cumple para esa familia. Es el sub-item restante de la Fase 4.
3. **Compatibilidad legacy en ambos sentios:** un dispositivo viejo que siga publicando el monolito lo sobreescribe entero (eso es correcto: es su snapshot); el lector mergea sin conflicto porque lo local gana en el doc legacy y lo entrante gana en los periodos. Sin observación de campo todavía con la app corriendo en las dos formas a la vez.
4. **Riesgo de shards:** con ventas de fechas desordenadas extremas el plan puede reescribir varios shards del mismo periodo; el test de escritura incremental cubre el caso normal (append al final del mes).

## Estado de fases del plan (evidencia en árbol, verificada por inspección esta sesión)

| Fase | Estado |
|---|---|
| 0 Reconocimiento | Ejecutada en sesión previa (no reverificada aquí) |
| 1 Código sin esperar el maletín | Implementada (`publishSnapshotInBackground` en `supervisorPairingService.js`) |
| 2 Sin errores invisibles | Implementada (`tests/supervisorOutcomeNotices.test.jsx`) |
| 3 Salud + desfase de reloj | Implementada (`SystemHealthPanel.jsx`, `systemHealthService.js`, `tests/systemHealth.test.jsx`) |
| **4 Adelgazar sincronización** | **Cerrada esta sesión** salvo el gate en nube (ver pendiente 1) y el sub-item de productos (ver pendiente 2) |
| 5 Contrato único de payload | En curso/parcial: `supervisorContracts.js` ya define el contrato v2 (v1/v2, límites); **sin verificar** el test de paridad golden SQL↔JS que exige su gate |
| 6 Identidad + `device_pairings` | No ejecutada |

## Incógnita de identidad (para el handoff final del plan)

`PDA-V2-D6F45E08E50D0996048FC4F10640776F` vs `PDA-V2-F5D31FEFD7FC6C7DBE6632438C6D760A`: **sigue sin respuesta**. El plan establece que la resuelve el usuario (¿misma caja física o dos dispositivos?) y que la Fase 6 previene la recurrencia. Sin consultas a la nube esta sesión no hay más evidencia local que aportar.

## Siguiente fase permitida

Fase 5 (contrato único de payload + códigos de error estables), o bien el sub-item restante de la Fase 4 (`bodega_products_v1`), a elección del dueño. Nada se aplica en producción sin aprobación explícita.
