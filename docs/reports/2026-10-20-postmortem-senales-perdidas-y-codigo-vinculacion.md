# Postmortem: señales Supervisor perdidas y código de vinculación expirado

**Fecha:** 2026-10-20
**Rama:** `preview/all-changes-oct14`
**Proyecto Supabase afectado:** `sodgzkablshladvbtnes` (producción)
**Ventana del incidente:** ~11:38 – 12:43 UTC (según logs de Supabase)
**Severidad:** Alta (el canal Supervisor → Caja estuvo completamente inoperativo; sin pérdida ni corrupción de datos)
**Estado:** Mitigado — migración del reloj aplicada y verificada; acción correctiva completa en plan abierto

## Resumen ejecutivo

Tres fallas independientes se combinaron en un mismo síntoma ("envío señales y no llegan nada"):

1. **El servidor rechazaba el 100 % de los comandos** del Supervisor con `400 "Ventana temporal inválida"` porque validaba la hora absoluta del reloj del cliente. Ninguna orden llegó a crearse.
2. **La base estaba saturada** por documentos de sincronización gigantes (`bodega_sales_v1` = 4.5 MB en una fila), lo que llenó los logs de `statement timeout` y tumbó el flujo de generación del código de vinculación (su presupuesto de 30 s se agotaba subiendo datos antes de emitir el código).
3. **Los errores eran invisibles en la UI**: la app sabía que fallaba y el usuario veía "como si no enviara nada", lo que disparó el tiempo de detección.

Mitigación aplicada en la sesión: la ventana temporal de `create_supervisor_command` se construye ahora con `now()` del servidor ([20261020_supervisor_command_server_clock.sql](../../supabase/migrations/20261020_supervisor_command_server_clock.sql), aplicada y verificada en producción). La acción correctiva de las demás fallas está en [2026-10-20-plan-fix-incidente-senales-y-codigo-vinculacion.md](../plans/2026-10-20-plan-fix-incidente-senales-y-codigo-vinculacion.md).

## Cronología (UTC)

| Hora | Evento | Fuente |
|---|---|---|
| 11:38:54 | `invalid column for filter target_device_id` (Realtime, aislado) | log postgres |
| 11:43:12 | Primer `create_supervisor_command` rechazado: `400 / P0001 "Ventana temporal inválida"` | edge + postgres |
| 11:44 – 12:21 | Tormenta de `canceling statement due to statement timeout` (57014); `sync_documents` devuelve 500/504 | logs postgres/edge |
| 11:46:48, 12:11:38 | `connection to client lost` (08006) | log postgres |
| 12:04:13 | Un lote desde el PDA Android rechazado: `400 "Payload de ajuste por lote inválido"` | edge + postgres |
| 12:05:29 | Último comando exitoso del día (a la caja `PDA-V2-D6F45E…776F`, aplicado) | tabla `supervisor_commands` |
| 12:09:39 | `GET sync_documents` (ventas de `PDA-V2-F5D3…760A`) → 500 | log edge |
| 12:12:19 | `register_device_session` → 500 y `heartbeat_device` → 500 | log edge |
| 12:18:29 | `GET sync_documents` de la caja Android → 504 | log edge |
| 12:26:48 | Nuevo vínculo creado: `PDA-V2-F5D3…760A` ↔ supervisor `PDA-V2-4B70…4469` | tabla `device_pairings` |
| 12:28 – 12:31 | Últimos 6 rechazos seguidos de `create_supervisor_command` (mismo error) | logs edge/postgres |
| 12:43:35 | El usuario desvincula; se revoca el vínculo de `PDA-V2-D6F45E…776F` (no el de F5D3) | tabla `device_pairings` |
| ~12:45 – 13:30 | Diagnóstico read-only con logs + Management API; migración del reloj escrita, testeada, aplicada y verificada | sesión de fixeo |

## Síntomas reportados

- *"Estoy enviado señales y no llegan, es como si no estuviera enviando nada."*
- *"Lo desconecté y ahora al pedir código tarda cargando y sale este error"* → modal "No pudimos completar la vinculación / La operación tardó demasiado".
- Consola del dispositivo: `[SupervisorReceiver] Listener detenido: vínculo revocado`, `[CloudSync] Sincronización pausada hasta completar el pairing`, `Consulta de órdenes pendientes {targetDeviceId: 'PDA-V2-D…776F', count: 0}`.

## Causas raíz

### RC-1 — El servidor exigía la hora del cliente (crítico)

`create_supervisor_command` rechazaba la ventana si `p_issued_at` caía fuera de `now() ± 2 min` o si `p_expires_at <= now()`. Un emisor con reloj desfasado (o con una ventana mayor al tope del tipo) perdía **todos** sus comandos en el mismo error. Evidencia:

- 16 llamadas rechazadas entre 11:43 y 12:31 con `400 / "Ventana temporal inválida"` (17 llamadas 400 en total al RPC, contando el rechazo de payload). La RPC responde en ~100 ms: rechazo determinista, no de red.
- `supervisor_commands`: **cero filas** con destino `PDA-V2-F5D3…760A` en toda su historia; el actor `725ed93c…` (supervisor Windows) **cero comandos creados jamás**.
- La RPC viva (verificada en `pg_proc`) era la versión extendida por tipo; las ventanas del cliente cabían en los topes, por lo que el rechazo apuntaba a los timestamps absolutos.

### RC-2 — Documentos de sincronización gigantes (crítico)

`sync_documents` acumula documentos monolíticos (`bodega_sales_v1` = **4 518 769 bytes** en una fila; `bodega_products_v1` ≈ 1.4 MB con varias copias por dispositivo). Cada push reescribe el blob completo y las consultas agotan el `statement_timeout` de Postgres (57014) → 500/504 en cascada. El flujo `createPairingToken` sube **cinco documentos pesados** (`forceSyncAllPOSData`) **antes** de pedir el código, con reintentos internos: la cadena no cabe en los 30 s del modal y expira con "La operación tardó demasiado". También tumbó `register_device_session` y `heartbeat_device` (500).

### RC-3 — Los errores del servidor no llegaban a la UI (detección)

`sendSupervisorCommand` devolvía `ok: false` con el error real ("Ventana temporal inválida"), pero la superficie visible no lo mostró de forma reconocible. El usuario interpretó "no envía nada" cuando la app sí sabía que fallaba. Este factor multiplicó la duración del incidente.

## Factores contribuyentes

- **Confusión de identidad:** dos device IDs vivos (`PDA-V2-D6F45E…776F`, la caja del log que procesó 37 comandos, y `PDA-V2-F5D3…760A`, vinculada al supervisor desde 12:26 y con 0 comandos). El "lo desconecté" revocó la primera mientras el usuario creía trabajar con la segunda.
- **Contrato de payload duplicado:** un `supervisor.inventory.batch.adjust` rechazado por `is_valid_supervisor_inventory_batch_payload` ("Payload de ajuste por lote inválido") — el cliente envió un formato que la validación del servidor no acepta. Caso único, misma clase de problema que el plan corrige con paridad testeada.
- **Filas basura en `device_pairings`** (`'test'`, `GLOBAL_LICENSE_PRICE`, `GLOBAL_COMPARE_PRICE` como `primary_device_id`) que entorpece cualquier lectura de estado.
- **Error aislado de Realtime** (`invalid column for filter target_device_id`) que deja esa suscripción sin entrega en vivo (el barrido de 15 s la cubre).

## Impacto

- **17 órdenes rechazadas** (16 por ventana temporal, 1 por payload), ninguna creada: sin efectos parciales ni duplicados en la caja (el fallo fue limpio, en la validación previa al INSERT).
- **Códigos de vinculación:** múltiples intentos fallidos durante toda la ventana; emparejamiento manualmente recuperado a las 12:26.
- **Sincronización degradada** para los dispositivos activos en la ventana (push con error y reintento).
- **Costo de diagnóstico alto:** exportación manual de logs + acceso de gestión para leer tablas; con la pantalla de Salud prevista en el plan habría sido de minutos.

## Mitigación aplicada (esta sesión)

1. **Diagnóstico 100 % de lectura:** logs de Supabase exportados por el usuario + consultas SELECT vía Management API (token del `.env`, nunca expuesto).
2. **Migración [20261020_supervisor_command_server_clock.sql](../../supabase/migrations/20261020_supervisor_command_server_clock.sql):** la ventana se construye con `now()` del servidor; solo se valida la duración pedida (inmune a desfases, ambos extremos salen del mismo reloj) y se recorta al tope del tipo. Misma firma → los clientes desplegados se arreglan sin actualizar la app. Reversible con su bloque DOWN.
3. **Verificación:** cuerpo vivo de `pg_proc` idéntico a la definición de la migración; guardrails SQL 19/19 (3 pruebas nuevas en [supervisorSqlGuardrails.test.js](../../tests/supervisorSqlGuardrails.test.js)); suite Supervisor 592/592 (51 archivos); ESLint y `tsc --noEmit` en verde.

## Acción correctiva pendiente

Plan completo: [2026-10-20-plan-fix-incidente-senales-y-codigo-vinculacion.md](../plans/2026-10-20-plan-fix-incidente-senales-y-codigo-vinculacion.md)

| Fase | Corrige | Estado |
|---|---|---|
| 1 | Código de vinculación sin esperar la subida pesada | ✅ Cerrada (2026-10-24) — `createPairingToken` emite el token tras el RPC y el snapshot pesado corre después en background con reintento ([supervisorPairingService.js](../../src/services/supervisorPairingService.js) `publishSnapshotInBackground`; sellado en [supervisorPairing.test.js](../../tests/supervisorPairing.test.js) y [supervisorLifecycle.test.js](../../tests/supervisorLifecycle.test.js)) |
| 2 | Ningún error del servidor en silencio | ✅ Cerrada (2026-10-24) — toda respuesta `ok:false` y todo ACK terminal triste muestra el texto crudo del servidor, con «último comando → estado (error)» en el diagnóstico ([supervisorCommandDiagnostics.js](../../src/services/supervisorCommandDiagnostics.js); regla y call-sites sellados en [supervisorOutcomeNotices.test.jsx](../../tests/supervisorOutcomeNotices.test.jsx)) |
| 3 | Pantalla de Salud + desfase de reloj | ✅ Cerrada (2026-10-24) — sección «Salud del sistema» en Ajustes con semáforo de desfase (verde <30 s, ámbar 30 s–2 min, rojo >2 min con acción) sobre 3 lecturas medianas, sin RPC nuevas ([SystemHealthPanel.jsx](../../src/components/Settings/SystemHealthPanel.jsx), [systemHealthService.js](../../src/services/systemHealthService.js); [systemHealth.test.jsx](../../tests/systemHealth.test.jsx)) |
| 4 | Adelgazar documentos (4.5 MB → por periodos) | Pendiente |
| 5 | Contrato único de payload + códigos de error | Pendiente |
| 6 | Identidad visible + candados en `device_pairings` | Pendiente |

**Gates abiertos:** (a) prueba de humo con una señal real de punta a punta tras la mitigación; (b) confirmar si `PDA-V2-D6F45E…776F` y `PDA-V2-F5D3…760A` son la misma caja física o dos dispositivos.

## Lecciones aprendidas

1. **La hora del cliente no debe ser autoridad.** Un servidor debe derivar sus tiempos de `now()` y, en todo caso, aceptar solo *duraciones* del cliente (la diferencia entre dos marcas del mismo reloj es inmune a desfases).
2. **Un error tragado por la UI es el fallo real.** El rechazo del servidor era correcto y visible en logs; invisible en pantalla, convirtió un bug de minutos en un incidente de horas.
3. **Los documentos monolíticos son una bomba de latencia en toda la superficie.** Un blob de 4.5 MB no solo frena la sincronización: tumba pairing, heartbeat y registro de identidad porque compiten por las mismas consultas.
4. **La emisión de credenciales/códigos no debe depender de cargas pesadas.** Lo urgente primero (el código), lo pesado después (el snapshot), en background.
5. **Los contratos duplicados cliente/servidor se rompen en silencio.** Sin un test de paridad compartido, cualquier divergencia de formato aparece en producción como un rechazo críptico.
6. **Sin salud visible (reloj, último comando, última sync), el diagnóstico depende de copiar logs a mano.** Una pantalla de 5 líneas habría acortado este incidente a minutos.

## Apéndice: evidencia

Rechazos del create (patrón repetido 16 veces):

```text
POST | 400 | /rest/v1/rpc/create_supervisor_command   (edge, auth 725ed93c…, Chrome/140 Windows)
P0001 | "Ventana temporal inválida"                    (postgres)

(16 rechazos de ventana + 1 "Payload de ajuste por lote inválido" = 17 llamadas 400 al RPC)
```

Saturación de la base:

```text
57014 | canceling statement due to statement timeout   (postgres, 44 ocurrencias)
POST | 500/504 | /rest/v1/sync_documents               (edge, auth 050cec0b… / 6fc06a02…)
POST | 500 | /rest/v1/rpc/register_device_session      (edge, 12:12:19)
POST | 500 | /rest/v1/rpc/heartbeat_device             (edge, 12:12:19)
```

Estado de vínculos y comandos (consultas SELECT, 2026-10-20 ~12:5x UTC):

```text
device_pairings:  PDA-V2-F5D3…760A → monitor PDA-V2-4B70…4469 (auth 725ed93c…),
                  paired_at 12:26:48, revoked_at NULL
device_pairings:  PDA-V2-D6F45E…776F → monitor NULL, revoked_at 12:43:35
supervisor_commands: destino PDA-V2-D6F45E…776F → 37 (todas 'applied', última 12:05:29)
supervisor_commands: destino PDA-V2-F5D3…760A → 0 (nunca existió ninguna)
supervisor_commands: actor 725ed93c… → 0 filas
sync_documents: bodega_sales_v1 = 4 518 769 bytes; bodega_products_v1 ≈ 1 414 000 bytes
```
