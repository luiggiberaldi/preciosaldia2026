# Auditoría: entrega de comandos del Supervisor a la Caja — ¿llegan siempre? ¿pueden mentir?

**Fecha:** 2026-10-22
**Pregunta que responde:** cuando el Supervisor envía un cambio (producto, tasa, lote de inventario, turno), ¿llega y se aplica correctamente en TODOS los casos? Y si algo falla, ¿puede el sistema decir «aplicado» cuando no lo está (falso positivo)?
**Alcance:** `supervisorCommandService`, `useRemoteCommands`, `supervisorProductCommand`, `supervisorInventoryCommand`, `supervisorUserCommand`, `supervisorCommandTracker`, `cloudPublishQueue`, `useCloudSync`, `storageService` y las RPC de `supervisor_commands` (migraciones 20261016/20261017/20261020).
**Método:** trazado de punta a punta del ciclo de vida de un comando, lectura de las RPC en SQL, y **dos pruebas sonda ejecutadas** (archivo temporal, ya eliminado) que reprodujeron los dos huecos más duros contra el código real.

---

## Veredicto en una línea

**La máquina de estados en la nube no puede dar falsos positivos** (terminal fijo, claim atómico con reloj del servidor, expiración derivada), **pero hay DOS huecos reales en la capa local de la caja**: uno puede confirmar «aplicado» con un cambio que nunca se guardó (falso positivo), y otro dice «falló» con un cambio que sí quedó aplicado (falso negativo). Hay además un hueco de recuperación tras corte de proceso que puede pisar ventas del cajero. Los tres tienen arreglo acotado.

---

## Cómo funciona hoy el ciclo (resumen del trazado)

1. **Crear:** `create_supervisor_command` (RPC) es **idempotente por `command_id`** y usa el **reloj del servidor** para la ventana: los reintentos de transporte reutilizan el mismo id, así que un comando jamás se duplica ni se pierde por un corte de red ([supervisorCommandService.js:424-460](../../src/services/supervisorCommandService.js#L424)).
2. **Reclamar:** `claim_supervisor_command` (RPC) hace el paso `pending → received` con un `UPDATE` condicional atómico. La expiración es **derivada** (no se persiste) y `received` **nunca expira** (migración [20261017_supervisor_pairing_identity_selfheal.sql:73-138](../../supabase/migrations/20261017_supervisor_pairing_identity_selfheal.sql#L73)).
3. **Aplicar:** el receptor (`useRemoteCommands`) valida, aplica bajo `pos_write_lock`, guarda un **registro local de «ya aplicado»** (`supervisor_applied_commands_v1`) y recién entonces confirma.
4. **Confirmar:** `ack_supervisor_command` (RPC) solo acepta `received → terminal`; **los terminales son inmutables** (un segundo ACK devuelve el original sin sobrescribir) (migración citada :160-207).
5. **Esperar en el monitor:** Realtime + degradación a sondeo con backoff + lectura final al timeout; **el timeout NO cierra el ciclo**: el tracker reconcilia cada 15 s hasta 15 min y solo declara «vencido» cuando el servidor lo deriva ([supervisorCommandTracker.js:255-277](../../src/services/supervisorCommandTracker.js#L255)).
6. **Red de seguridad de publicación:** si la nube no confirma la subida, el cambio local **no se revierte** (deliberado, Fase 11) y queda una marca de re-publicación que el barrido de 30 s resuelve ([useRemoteCommands.js:260-276](../../src/hooks/useRemoteCommands.js#L260)).

### Lo que quedó auditado y SÍ es sólido (sin hallazgos)

- **Nunca hay dos comandos por un reintento**: la RPC de create es idempotente por id y el sender persiste/reutiliza el `commandId` (Fase 10).
- **Nunca un ACK se sobrescribe**: terminales fijos en SQL; ACK repetido devuelve el original.
- **Nunca se declara fallo por un corte de red en la espera del ACK**: el canal caído degrada a sondeo, y al timeout hay lectura final.
- **Nunca dos cajas procesan la mismo comando**: claim atómico en servidor + lock local por comando + guard en memoria.
- **El corte de red durante la publicación no da falso positivo**: el producto queda `applied_with_warnings` + marca de pendiente + barrido (cubierto por `tests/supervisorProductPublish.test.jsx` y `tests/cloudPublishQueue.test.js`).
- **Un lote de inventario no se aplica dos veces**: la guarda de `expectedStock`/`baseRevision` lo impide; el journal write-ahead + escrituras verificadas cubren el corte a mitad de transacción (cubierto por `tests/supervisorInventoryCommand.test.js` y el e2e de recuperación).
- **El eco optimista del monitor es solo presentación** y se revierte solo si la caja rechaza.

---

## Hallazgos

### H1 — FALSO POSITIVO confirmado: escrituras locales sin verificar (producto, turno, usuario)

**Severidad: MEDIA-BAJA** (requiere que el almacenamiento trague la escritura) — pero es exactamente la clase de mentira que se pidió eliminar: el monitor ve «✅ La caja aplicó tu cambio» con un cambio que **no existe**.

**Cadena del fallo** (reproducida con prueba sonda ejecutada contra el receptor real):

1. `storageService.setItem` **traga errores**: si ni IndexedDB ni localStorage aceptan el valor, solo loguea, encola reintento y **retorna con éxito** ([storageService.js:138-172](../../src/utils/storageService.js#L138)). Su propio comentario lo advierte: «no se puede asumir que rechace en fallo».
2. El comando de producto escribe con `storageService.setItem` **sin comprobar la escritura** ([useRemoteCommands.js:235-238](../../src/hooks/useRemoteCommands.js#L235)).
3. `publishKeyNow` **re-lee** el valor fresco (que quedó viejo), lo publica sin problema, la clasificación dice «publicado» y el comando se recuerda y confirma **`applied`**.

**Evidencia:** la sonda (catálogo que no cambia + escritura tragada) cerró con `rememberedCommand = { status: 'applied' }` mientras `bodega_products_v1` seguía con el precio viejo.

**Contraste:** el camino del lote de inventario **sí** se defiende con `writeVerified` (relectura obligatoria tras cada escritura, «detección de escrituras tragadas») — el mismo archivo lo documenta ([supervisorInventoryCommand.js:168-172](../../src/services/supervisorInventoryCommand.js#L168)). La defensa existe, solo no se usó en los otros modos.

**Corrección recomendada:** exportar `writeVerified` (o una variante genérica) y usarla en las escrituras de `applyProductCommand`, `applyShiftCommand` y `applyUserCommand`. Si la relectura no confirma → error → ACK `failed` (falso negativo honesto, jamás falso positivo). **Esfuerzo: pequeño.**

### H2 — FALSO NEGATIVO confirmado: la reaplicación tras un corte responde «failed» con el cambio ya aplicado

**Severidad: MEDIA** — el monitor dice «❌ No se pudo aplicar el cambio… El producto cambió mientras lo editabas» cuando **sí se aplicó**. Eso empuja al operador a reintentar sobre un estado que no conoce.

**Cadena del fallo** (reproducida con prueba sonda):

1. En productos, el orden es: escribir local → **publicar en la nube** (viaje de ~1.3 MB con reintentos) → guardar el registro de «aplicado» → ACK ([useRemoteCommands.js:231-280](../../src/hooks/useRemoteCommands.js#L231)). La ventana de corte incluye toda la publicación.
2. Si la caja se corta (batería, cierre forzado) en esa ventana, la fila queda `received` en la nube y sin registro local de «aplicado».
3. Al reiniciar, el barrido recupera filas `received` y el RPC de claim **autoriza re-reclamarlas** (`received → claimed: true`, migración 20261017 :121-127).
4. El receptor re-ejecuta el comando, pero las **guardas de concurrencia** lo rechazan: `create` → «El producto ya existe en la caja»; `update` → «El producto cambió mientras lo editabas» (la revisión compara contra el estado YA editado) ([supervisorProductCommand.js:200-240](../../src/services/supervisorProductCommand.js#L200)).
5. El `catch` general lo registra y confirma como **`failed`** ([useRemoteCommands.js:637-653](../../src/hooks/useRemoteCommands.js#L637)).

**Evidencia:** la sonda entregó la fila `received` sobre un catálogo ya editado y cerró con `{ status: 'failed' }` y mensaje «El producto cambió mientras lo editabas».

**Efecto colateral:** en el lote de inventario la misma reaplicación muere en la guarda de `expectedStock` («El stock cambió antes de aplicar») — ahí **no** hay doble ajuste (bien), pero el ACK también miente con `failed`.

**Corrección recomendada (dos piezas):**
- **Productos:** guardar el registro de «aplicado» **inmediatamente después de la escritura local durable y antes de publicar** (el estado local es la verdad; la publicación es otra fase con su propia marca de pendiente). Así una reaplicación encuentra el registro y solo re-confirma, como ya hace el resto del flujo.
- **Inventario:** antes de planificar, detectar «ya aplicado» por los ids estables de movimiento (`supervisor-${commandId}-${lineId}` ya existen en `bodega_sales_v1`): si están, responder `applied` sin tocar nada. Además hace innecesario fiarse solo de `expectedStock`.
- (Opcional, más profundo) que la reaplicación de `update` acepte como válido el caso «la revisión actual ya refleja el patch» en vez de fallar.

**Esfuerzo: medio.**

### H3 — Recuperación del journal del lote no corre al arranque (y puede pisar ventas del cajero)

**Severidad: MEDIA-ALTA en el escenario de corte** (baja probabilidad, alto impacto: pérdida de una venta).

- `recoverSupervisorInventoryJournal` **solo se invoca al inicio de un lote nuevo** ([supervisorInventoryCommand.js:384](../../src/services/supervisorInventoryCommand.js#L384)); **nada la llama al arranque de la caja** (verificado por búsqueda global; el e2e la invoca a mano tras el reload, [supervisor-inventory-recovery.e2e.spec.js:159](../../tests/e2e/supervisor-inventory-recovery.e2e.spec.js#L159)). Lo prometido en el release 2.0.4 («al reiniciar se termina el movimiento») hoy es cierto solo si se llama explícitamente.
- Peor: la recuperación roll-forward/rollback **escribe los snapshots del journal a ciegas** sobre el estado actual ([supervisorInventoryCommand.js:343-360](../../src/services/supervisorInventoryCommand.js#L343)). Si el cajero vendió algo entre el corte y la recuperación, esas ventas se **pisan** con el snapshot del momento del lote.

**Escenario completo:** corte entre la escritura de productos y la de ventas → caja reinicia con stock avanzado pero sin el movimiento → el cajero vende 2 unidades → días después llega otro lote → la recuperación escribe el snapshot «after» y **borra la venta del cajero** (local y, al publicarse, también en la nube).

**Corrección recomendada:**
1. Ejecutar `recoverSupervisorInventoryJournal` al arranque del receptor (`initialize` de `useRemoteCommands`) y al recuperar red/visibilidad.
2. Hacer la recuperación **a prueba de escrituras intermedias**: si el valor actual no coincide ni con `before` ni con `after`, no pisar — fusionar por id de movimiento (los movimientos del lote tienen id estable) o escalar a error visible «se requiere intervención».

**Esfuerzo: pequeño-medio.** Es el hallazgo con mayor impacto operativo.

### H4 — «Se aplicó con reservas» no explica la reserva (calidad del aviso, sin mentira)

`applied_with_warnings` llega como aviso ámbar correcto («⚠️ Se aplicó con reservas»), pero el payload del ACK no incluye `warnings`, así que el detalle queda vacío ([supervisorCommandTracker.js:117-125](../../src/services/supervisorCommandTracker.js#L117)). El operador no sabe que «la reserva» es «falta confirmar la publicación a la nube». **Corrección:** adjuntar `warnings: ['Publicación a la nube pendiente; el barrido la resolverá']` en el ACK de producto/lote. **Esfuerzo: mínimo.**

### H5 — `supervisor.rate.set` es disparo-y-olvido (deliberado, sin mentira)

La tasa no espera ACK (`shouldAwaitSupervisorAck` la excluye) y el monitor nunca se entera de si falló. No es falso positivo (nunca se afirma éxito), pero tampoco hay telemetría de fallo. **Corrección opcional:** registrar el desenlace en el diagnóstico (`supervisorCommandDiagnostics`) aunque no haya toast. **Esfuerzo: mínimo.**

### H6 — Ventana de idempotencia local acotada (nota menor)

El registro de «aplicados» se limita a 1000 entradas con desalojo FIFO, mientras que las filas `received` en la nube nunca expiran teóricamente. Un comando extremadamente viejo podría reaplicarse tras el desalojo (la guarda de `expectedStock`/revisión lo convertiría en `failed`, ver H2). Riesgo despreciable; se menciona por completitud.

---

## Cobertura de pruebas hoy vs. huecos

| Garantía | Prueba que la cubre |
|---|---|
| Publicación fallida ≠ rollback; pendiente + barrido | `tests/supervisorProductPublish.test.jsx`, `tests/cloudPublishQueue.test.js` |
| Journal write-ahead, recuperación idempotente, escrituras tragadas (inventario) | `tests/supervisorInventoryCommand.test.js` |
| Corte real + reload + recuperación | `tests/e2e/supervisor-inventory-recovery.e2e.spec.js` |
| Eco end-to-end, no-op al reintentar, barrido de 30 s | `tests/supervisorSyncEcho.test.jsx` |
| Create idempotente, claim, ACK repetido (SQL) | `tests/supervisorSqlGuardrails.test.js` |
| **H1: escritura tragada en producto → `applied` falso** | **sin cobertura** |
| **H2: reaplicación tras corte → `failed` falso** | **sin cobertura** |
| **H3: recuperación al arranque / no pisar ventas** | **sin cobertura** (el e2e la llama a mano) |

---

## Orden de arreglo propuesto

1. **H3** (mayor impacto: puede perder ventas) — recuperación al arranque + no pisar escrituras intermedias.
2. **H1** (el falso positivo literal) — `writeVerified` en producto/turno/usuario.
3. **H2** (el falso negativo que confunde al operador) — registro de «aplicado» antes de publicar + deduplicación por id de movimiento.
4. **H4/H5** — avisos más honestos y telemetría de la tasa.

Con H1–H3 cerrados, la única forma de que el sistema mienta quedaría en el propio servidor (SQL), que ya está blindado por diseño. Cada arreglo es reversible por commit y trae sus pruebas de regresión (las sondas de este reporte pueden convertirse en pruebas nombradas).

---

*Auditoría ejecutada sobre la rama `main` (release 2.0.4). Las pruebas sonda se ejecutaron y eliminaron; reproducen el comportamiento real del receptor con el mismo arnés de `tests/supervisorProductPublish.test.jsx`.*

---

## Estado tras el arreglo (2026-10-22)

**H1, H2 y H3 CORREGIDOS**, con pruebas de regresión nombradas:

- **H1** → `src/utils/verifiedWrite.js` (escritura con relectura) aplicado a producto, turno y usuario: una escritura tragada ahora responde `failed` con «La escritura de … no se confirmó» (regresión: `tests/supervisorCommandFalsePositives.test.jsx`).
- **H2** → el registro de «aplicado» se escribe ANTES de la publicación (y la marca de re-publicación se coloca antes del viaje), un fallo de publicación nunca degrada a `failed`, y la reaplicación tras corte es un no-op aplicado por detección de estado ya aplicado (producto: revisión idempotente; inventario: movimientos por `commandId`).
- **H3** → el journal se recupera AL ARRANQUE del receptor y en cada barrido, y la recuperación fusiona por id de movimiento en vez de pisar: conserva las ventas intermedias del cajero, respeta productos creados/borrados después, y ante evidencia ambigua (stock movido sin movimientos en el historial) ESCALA con error `recoverable` «se requiere intervención» sin escribir nada (regresión: `tests/supervisorInventoryCommand.test.js`, bloque «H2/H3»).

**Verificación:** suite completa 159 archivos / 1734 pruebas en verde, `tsc` y ESLint sin errores.

Residual conocido (aceptado y documentado): si el corte ocurre en la ventana de milisegundos entre la escritura local y su registro Y además hay ventas intermedias antes de la recuperación, la reaplicación de `create` puede recrear un producto borrado después, y la fusión ambigua del lote escala a intervención manual en vez de adivinar.
