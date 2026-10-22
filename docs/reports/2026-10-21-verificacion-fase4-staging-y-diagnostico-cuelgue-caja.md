# Verificación Fase 4 contra staging wapczm + diagnóstico del "cuelgue" de la caja

Fecha: 2026-10-21 · Rama: `main` (preciosaldia-supervisor-production-alignment)

Contexto: se pidió (1) probar la Fase 4 contra staging wapczm y (2) confirmar si
es real el reporte de un usuario: *«al hacer cambios desde el supervisor la caja
se cuelga un poco»*.

**Veredicto: el cuelgue es real y medible.** No es percepción: un solo comando del
supervisor ejecuta 53–246 ms de serialización/clonado en el hilo principal (en una
máquina RÁPIDA de desarrollo; ×3–10 en una caja gama baja), sube 1.3–2 MB a la
nube, y **retiene `pos_write_lock` durante todo ese tiempo incluida la subida** —
el mismo lock que `processSaleTransaction` necesita para cobrar. El «Cobrar» del
cajero se encola detrás del comando del supervisor.

---

## 1. Fase 4 contra staging REAL (wapczmlwljkrjtfhmqko)

Test nuevo: [tests/cloudSyncSalesPeriodsStaging.test.js](../../tests/cloudSyncSalesPeriodsStaging.test.js)
(gated por `SUPERVISOR_STAGING_E2E=true`, device `e2e-test-fase4-*`, limpieza por
prefijo; corre la ruta real `pushCloudSync → upsertSyncDocument` con transporte
fetch contra PostgREST). **4/4 en verde contra la base real:**

| Escenario | Resultado |
|---|---|
| Publicación de la familia por periodos (977 ventas, 3 periodos + `recent`, mes grande en shards) | ✅ 5 docs; el merge del lector conserva las 977 ventas |
| Escritura incremental (1 venta nueva) | ✅ reescribe SOLO `bodega_sales_v1:2026-08#2` (1 shard) |
| Vaciado total | ✅ tumbas `[]` en todos los docs publicados; el lector queda en 0 |
| Limpieza por `device_id` | ✅ 0 filas residuales |

Hallazgos de staging:
- El índice único `(device_id, collection, doc_id)` **existe en wapczm**: el
  `upsert ... on_conflict` funciona y hace merge en la misma fila (probado con
  curl antes del test). La migración `20261021_sales_period_docs_index.sql`
  sigue siendo necesaria como salvaguarda idempotente para producción.
- `data` es `jsonb`: Postgrees reordena claves al releer. El hash incremental por
  documento debe calcularse sobre el estado LOCAL (como hace la caja), no sobre
  copias releídas del servidor — el test lo sella así.

## 2. Cuánto cuesta UN comando del supervisor en la caja (datos reales)

Test nuevo: [tests/supervisorCommandJank.perf.test.js](../../tests/supervisorCommandJank.perf.test.js).
Ejecuta el código REAL (`applySupervisorInventoryBatchTransaction`,
`applySupervisorProductCommand`, `pushCloudSync`) sobre el backup de producción
del 2026-10-19 — el doc de productos más grande del parque: **2434 productos ≈
1.32 MB** + su historial **496 ventas ≈ 666 KB**. Solo se sustituyen el storage
(shim que clona como IndexedDB/localforage) y el transporte (JSON.stringify del
documento, como supabase-js). Tiempos de esta máquina de desarrollo:

| Comando del supervisor | Hilo principal | Serializaciones | Clones | Subida |
|---|---|---|---|---|
| Edit de producto (1 campo) | **53 ms** | 3 stringify (2.6 M chars) | 3 | **1 doc / 1.32 MB** |
| Lote de inventario (20 líneas) | **246 ms** | 530 stringify (**17.3 M chars**) | 12 | 3 docs / **2.00 MB** |
| Push de ventas — monolito legacy | — | 1 doc / 0.67 MB / 11 ms | | |
| Push de ventas — Fase 4 completa (force) | — | 2 docs / 0.67 MB / 24 ms | | |
| Push de ventas — Fase 4 + 1 venta nueva | — | **1 doc / 268 KB / 19 ms** | | |

(Ejecución en frío el primer comando dobla esos tiempos: 152 ms / 544 ms. En una
caja gama baja multiplicar por ~3–10.)

## 3. Por qué se cuelga la caja (causa)

1. **`pos_write_lock` retenido durante la red.** `applyProductCommand` y
   `applyInventoryBatchCommand` (`useRemoteCommands`) ejecutan TODO bajo
   `withLock('pos_write_lock')`, incluido el `await pushCloudSync(...)` y el
   `retryInventoryPublish`. `processSaleTransaction` (`checkoutProcessor.js:300`)
   usa el MISMO lock. Consecuencia: mientras un comando del supervisor sube
   1.3–2 MB, la siguiente venta del cajero espera el lock (en un enlace lento,
   segundos). Eso es exactamente «se cuelga un poco».
2. **CPU del hilo principal por comando.** El journal write-ahead guarda
   snapshots `before`/`after` de AMBOS documentos (≈ 4 MB de objeto) y
   `writeVerified` confirma cada escritura con dos `JSON.stringify` del valor
   completo; la sombra y IndexedDB clonan el catálogo entero por escritura;
   `quickHash` + el transporte vuelven a serializar 1.3 MB. Total: 17.3 M chars
   serializados en un lote de 20 líneas.
3. **El catálogo se sube completo por cada cambio.** Un edit de un campo publica
   1.32 MB porque `bodega_products_v1` sigue siendo monolítico (pendiente
   conocido de la Fase 4).
4. **Re-render del listado** (`app_storage_update` sobre 2434 productos) — no
   medido en Node, pero se suma en la caja.

## 4. Qué cubre Fase 4 y qué no

Cubre (medido):
- Ventas: escritura incremental real — una venta nueva reescribe su shard
  (~268 KB) en vez del historial completo (666 KB y creciente linealmente);
  ningún documento pasa de ~400 KB; el vaciado es quirúrgico (tumbas por doc).

No cubre:
- `bodega_products_v1` monolítico (1.32 MB por comando) — es el mayor costo.
- El journal write-ahead y `writeVerified` (duplican y re-serializan ambos docs).
- El lock retenido durante la subida (la causa #1 del cuelgue).

Oportunidad detectada: `publishInventoryDocs` empuja ventas con
`forceUnconditional=true`, lo que desactiva el hash por documento y reescribe
todos los periodos en cada lote (0.67 MB). Con `force=false` solo se reescribirían
los periodos tocados; el hash por doc ya se guarda solo tras upsert confirmado.

## 5. Recomendaciones (prioridad)

1. Sacar la red del lock: aplicar + persistir local bajo `pos_write_lock`, y
   publicar DESPUÉS de soltarlo (el ACK de inventario ya es «early»; el publish
   puede salir del lock igual que el retry periódico).
2. Adelgazar `bodega_products_v1` (shards por categoría/alfa, misma semántica
   que la familia de ventas) — es lo que más pesa y lo que siempre se reescribe.
3. `writeVerified` con hash comparado en vez de doble `JSON.stringify` del valor.
4. `force=false` en `publishInventoryDocs` para la familia de ventas.

## 6. Red vs CPU medido con la telemetría de ACK (staging wapczm)

Antes de tocar código se midió cuánto del cuelgue es red y cuánto CPU, usando la
**telemetría de ACK real** (`markAckTelemetry`/`finishAckTelemetry`, logs
`[AckLatency]`, buffer `supervisor_ack_telemetry_v1`) con el mismo cableado de
`useRemoteCommands`, sobre los datos reales del backup. Test:
[tests/supervisorAckTelemetryStaging.perf.test.js](../../tests/supervisorAckTelemetryStaging.perf.test.js)
(gated `SUPERVISOR_STAGING_E2E=true`, device `e2e-test-ackperf-*`). Metodología:
misma ejecución dos veces — transporte instantáneo (= CPU + persistencia local)
y HTTP real a wapczm (= CPU + red); la diferencia es la red. Lo que hoy corre
bajo `pos_write_lock` es la columna `lockMs`.

| Comando | localMs (CPU+local) | publishMs (subida) | ackMs | **lockMs** | **red** |
|---|---|---|---|---|---|
| Edit de producto — CPU | 63–71 | 24–48 | 0 | **87–119** | — |
| Edit de producto — staging (1.32 MB subidos) | 100–120 | **2338–5703** | 182–351 | **2438–5822** | **2319–5735 ms = 95–99 %** |
| Lote 20 líneas — CPU | 289–887 | 54–63 | 0 | **346–951** | — |
| Lote 20 líneas — staging (2.00 MB subidos) | 230–342 | **1303–1432** | 226–390 | **2123–2198** | **1247–1777 ms = 57–84 %** |

**Respuesta: el cuelgue es MAYORITARIAMENTE red** (57–99 % según comando y
momento del enlace), con CPU de 0.1–1.0 s en máquina rápida. La variación entre
corridas (2.3 vs 5.7 s para subir el mismo 1.32 MB) es el enlace real: en horas
pico de la caja, la ventana bajo lock crece igual. Conclusión para el plan: las
Fases 1–2 (sacar la red del lock) eliminan la parte dominante; las Fases 3–4
(bajar CPU) son el piso para hardware gama baja, donde el CPU ×3–10 puede
acercarse a la red.

### 6.1 Antes/después tras implementar las Fases 1–2 (mismo test, mismo día)

Con el fix (solo la fase local bajo `pos_write_lock`; ACK y publicación fuera),
re-cableando el mismo test a la nueva secuencia (staging wapczm):

| Comando | lock ANTES (retenía red) | **lock HOY** | Red (fuera del lock) |
|---|---|---|---|
| Edit de producto (1.32 MB subidos) | 3682 ms | **262 ms** | 3420 ms + ack 131 ms |
| Lote de inventario 20 líneas (2.00 MB) | 1938 ms | **285 ms** | 1548 ms + ack 203 ms |

El «Cobrar» del cajero dejó de esperar la red de un comando del supervisor: el
lock baja de 2–3.7 s a ~0.26–0.29 s (hoy 100 % CPU + persistencia local). Las
pruebas de carrera de `tests/cloudPublishQueue.test.js` sellan que (a) el lock
queda libre durante la publicación, (b) la publicación lleva el estado fresco
(una venta concurrente no se pierde), (c) un fallo de publicación no revierte
estado local, y (d) el journal de un comando jamás se borra con el de otro.

**Cómo medirlo en la caja física (no intrusivo):** el mismo flujo imprime logs
`[AckLatency] … ACK tras X ms … la publicación cloud terminó en Y ms` en la
consola del POS (Electron: devtools) y persiste hasta 200 entradas con `marks`
y `metrics` en la clave IndexedDB `supervisor_ack_telemetry_v1`. Basta con que
el supervisor dispare un edit de producto y un lote de inventario sobre la caja
emparejada y exportar esa clave (o copiar los logs) — `localDurableMs` es el
trabajo local y `publishLatencyMs − localDurableMs` la ventana de red, que es
justo lo que hoy retiene `pos_write_lock`.

## 7. Cómo reproducir

```bash
# Fase 4 contra staging wapczm (nunca imprimir keys)
SERVICE_KEY=$(grep -m1 '^SUPABASE_STAGING_SERVICE_KEY=' ../preciosaldia-supervisor-staging/.env | cut -d= -f2-)
STAGING_URL=$(grep -m1 '^VITE_SUPABASE_STAGING_URL=' ../preciosaldia-supervisor-staging/.env | cut -d= -f2-)
SUPABASE_STAGING_SERVICE_KEY="$SERVICE_KEY" SUPABASE_STAGING_URL="$STAGING_URL" \
  SUPERVISOR_STAGING_E2E=true npx vitest run tests/cloudSyncSalesPeriodsStaging.test.js

# Medición del costo en la caja (requiere backups/supabase/…2026-10-19….json)
npx vitest run tests/supervisorCommandJank.perf.test.js

# Red vs CPU con la telemetría de ACK real (mismas env de staging)
SUPABASE_STAGING_SERVICE_KEY="$SERVICE_KEY" SUPABASE_STAGING_URL="$STAGING_URL" \
  SUPERVISOR_STAGING_E2E=true npx vitest run tests/supervisorAckTelemetryStaging.perf.test.js
```

Nota de trampa detectada al construir el fixture: padding con `note` de largo
fijo estabiliza el `JSON.stringify` del registro y el `while` de relleno nunca
termina (costó 2 corridas colgadas de vitest). El helper ahora crece estricto.
