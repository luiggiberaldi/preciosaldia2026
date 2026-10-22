# Fases 3–4 del fix de cuelgue de caja: publicación incremental de ventas + journal de strings

**Fecha:** 2026-10-21 · **Plan:** `docs/plans/2026-10-21-plan-fix-cuelgue-caja-comandos-supervisor.md`
**Objetivo de las fases:** bajar el piso de CPU del lote de inventario en la caja (menos serialización y menos clonado por lote en hardware gama baja).

---

## Fase 3 — `forceUnconditional=false` para la familia de ventas

**Cambio** ([supervisorInventoryCommand.js](../../src/services/supervisorInventoryCommand.js), `publishInventoryDocs`): la familia de ventas se publica con `force=false` para que `pushCloudSync` saltee por hash los periodos/shards intactos y solo reescriba el tocado. `bodega_products_v1` se mantiene `force=true` (doc monolítico, sin hash por partes). Seguridad sin cambios: el hash por doc solo se guarda tras upsert confirmado, así que un fallo parcial se reintegra en el siguiente intento.

**Fail-first documentado** (4 pruebas nuevas en [cloudSyncSalesPeriods.test.js](../../tests/cloudSyncSalesPeriods.test.js), bloque "(e) el lote de inventario publica la familia de ventas incrementalmente", contra el `pushCloudSync` real con transporte mockeado, vía `retryInventoryPublish` — exactamente como la caja publica tras un corte):

| Prueba | Antes del cambio | Después |
|---|---|---|
| (a) lote agrega movimientos al periodo corriente → solo ese periodo | ❌ fallaba (se reescribía también `2026-07`) | ✅ |
| (b) mutación en periodo viejo → solo ese periodo | ❌ fallaba (se reescribía también `2026-08`) | ✅ |
| (c) fallo de red + retry con el mismo commandId → el periodo fallido queda publicado | ✅ (sello) | ✅ |
| (d) vaciado total publica tumbas de todos los periodos publicados | ✅ (sello) | ✅ |

Resultado: 19/19 en `tests/cloudSyncSalesPeriods.test.js`.

## Fase 4 — Snapshots del journal como strings + `writeVerified` sin serializar dos veces

**Cambio:**
1. Los snapshots `before`/`after` del journal viajan como **un string con marca `j1:`** (JSON) en vez de grafos de objetos: clonar un string es memcpy, no recorrido de 2434 objetos, y se compara directo (===).
2. `writeVerified` compara el journal por **igualdad profunda** (`compare: 'deep'`) sin `JSON.stringify`, y para los docs reutiliza la serialización `after` ya calculada para el pack (`expectedJson`) — cada documento se serializa una sola vez por lote.
3. **Lectura dual**: los valores no-string (journals v1 escritos por la app anterior, o construidos a mano) se usan tal cual; los strings sin marca `j1:` se rechazan de forma segura (error `recoverable`, journal intacto, nunca escribe basura). No hay bump de versión: la marca se auto-describe en el propio valor y `isValidInventoryJournal` sigue aceptando la misma forma.
4. Los docs `bodega_products_v1`/`bodega_sales_v1` se siguen escribiendo como objetos (son el estado real).

**Desviación medida del plan (decisión del gate, no un recorte):** el plan proponía `compressString` (gzip+base64) para los snapshots. Se implementó, se midió y **se revirtió**: contra el backup real, comprimir el journal costó **877 ms bloqueantes vs 357 ms** de la variante sin comprimir (y 383 ms de la línea base) — el plomerío `CompressionStream`+`Response.blob`+`FileReader` (~34 ms por cada 0.3 M chars en este entorno, ~7× el stringify que ahorra) domina cualquier ganancia de clonado. El propio gate del plan ("si la medición no mejora, revertir; no se acepta complejidad sin ganancia medida") mandaba rechazarla.

**Pruebas nuevas** ([supervisorInventoryCommand.test.js](../../tests/supervisorInventoryCommand.test.js)): round-trip del journal de strings con roll-forward completo (verifica además el formato marcado), snapshot ilegible → error `recoverable` con journal intacto y sin escritura basura, y el fallback del reintento de publicación al snapshot comprimido/marcado si el storage quedó vacío. La compatibilidad v1 ya la sellan las pruebas existentes de journal manual con valores en claro ("recarga con journal pendiente") y la detección de escrituras tragadas queda sellada igual que antes.

## Medición (gate) — `tests/supervisorCommandJank.perf.test.js`, lote de 20 líneas sobre el backup real 2026-10-19

| Métrica | Línea base (Fases 0–2) | Variante comprimida (revertida) | **Final (strings `j1:`)** |
|---|---|---|---|
| Serialización | 530 stringify · **17.3 M chars** | 532 stringify · 12.9 M chars | 530 stringify · **11.3 M chars (−35%)** |
| Tiempo bloqueante | 383 ms | 877 ms ❌ | **357 ms** ✅ |
| Clones | 13 | 13 | 13 |
| Subida a la nube | 3 docs / 2.00 MB | 3 docs / 2.00 MB | 3 docs / 2.00 MB (intacto) |

**Transparencia sobre los targets del plan** (< 7 M chars, ≤ 6 clones, "jank a menos de la mitad"): no se alcanzaron y no son alcanzables dentro del alcance de estas fases. Del desglose medido quedan fuera de `supervisorInventoryCommand.js`: ~5.3 M chars de transporte + hashing por doc (viven en `useCloudSync`, incluye la subida del monolito de productos de 1.32 MB que es el objeto de la Fase 5) y ~2 M de la verificación por lectura de vuelta de los docs (seguridad exigida por pruebas: detecta `setItem` que traga errores). El conteo de clones no baja porque cada escritura verificada sigue leyendo de vuelta — por diseño. El jank de CPU bajó 7%, no a la mitad: el piso restante es el transporte/hashing, que es exactamente lo que ataca la Fase 5 (shards de productos).

## Verificación completa

- `npx eslint` sobre los 3 archivos tocados: limpio.
- 6 suites afectadas: **136/136** (`supervisorCommandDiagnostics`, `supervisorRemoteProductForm`, `cloudSyncSalesPeriods`, `supervisorInventoryBatchPanel`, `supervisorInventoryDraft`, `supervisorInventoryCommand`).
- E2E navegador (`npm run test:e2e:inventario-recovery`): **2/2** — el journal con formato nuevo sobrevive un corte de proceso real (escritura colgada + reload) y el roll-forward completa el lote sin duplicar movimientos; la publicación pendiente no se revierte.
- `tests/supervisorCommandJank.perf.test.js`: 3/3 con el gate medido arriba.
- `tests/compression.test.js`: 4/4 (nota: falla solo con `VITEST_VERBOSE=1` por recursión preexistente en `tests/setup.js`, ajena a este cambio).

## Qué queda

- **Fase 5 (solo esquema)**: `bodega_products_v1` por shards — es lo que desbloquea el piso restante de CPU/transporte (el doc de productos se serializa y sube completo por cada comando).
