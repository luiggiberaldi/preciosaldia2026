# Módulo: Supervisor (el dueño, de forma remota)

> Revisado 2026-11-13 leyendo `src/config/supervisorPolicy.js`, `src/services/supervisorContracts.js` y `src/hooks/useRemoteCommands.js`. Es el módulo más grande y este documento es solo el mapa; el detalle está en los planes y postmortems de `docs/plans/` y `docs/reports/`. No verificado con clics en pantalla.

## La idea

El celular del dueño es como un **control remoto** de la caja: ve ventas, inventario y caja, y puede mandar órdenes. La caja decide si las obedece.

## Cómo se conectan

- Se **vinculan** dos dispositivos (caja y celular del dueño), como ligar dos radios al mismo canal. Hay un código de vinculación que expira.
- El celular ve los datos que la caja sube a Supabase (`sync_documents`), en la pantalla del dueño (`OwnerMonitorView.jsx`, `useMonitorSync`).

## Órdenes que puede mandar

Definidas en `SUPERVISOR_COMMAND_TYPES` (`supervisorContracts.js`): cambiar la tasa; crear, editar y borrar productos; crear, editar y borrar usuarios; cerrar y reabrir turno; ajustar inventario por lote; gestionar proveedores y facturas; crear y anular ventas; registrar compras de mercancía.

El **PIN** y los **pagos a proveedores** no viajan por este canal.

## Cómo la caja valida una orden

`validateSupervisorCommand` rechaza: tipo no permitido, id inválido, caja o celular no autorizados y ventana de tiempo inválida. La ventana de tiempo se calcula con el **reloj del servidor**, no con el del equipo ([ERR-005](../../ERRORES.md)). Cada orden termina en un estado final (por ejemplo `applied`) y deja constancia.

## Cola local del celular

Si la caja parece desconectada, el cambio queda «EN COLA» en el celular (`supervisorCommandQueue.js`) y se reintenta cada 30 s. La cola **se detiene en el primer fallo** para no saltarse órdenes; por eso una entrada que la nube rechace siempre bloquea todo lo de detrás (caso Bodega mani, 2026-11-19: la cola agregaba `productName`, un campo que la nube no admite). Desde 2.0.7 la cola guarda y repara solo los campos del contrato. Desde 2.0.8, si la nube rechaza una entrada de forma cierta (`rejected`, `invalid`, `unauthorized`), la entrada queda **bloqueada** (`blockedAt`): el barrido de 30 s deja de reenviarla y el aviso de la cola dice cuál es y por qué. Solo «SUBIR AL SISTEMA» la reintenta, y «DESCARTAR» la quita. Los fallos de red nunca bloquean.

## Caja negra: por qué falló una orden

Una orden rechazada por la nube **no deja fila** en `supervisor_commands` (la transacción se deshace). Desde el 2026-11-19 el celular la anota con `report_supervisor_command_failure` en `supervisor_command_failures` (`supervisorCommandFailureReport.js`): un renglón por error distinto, con contador, primer y último intento, versión del monitor, el último payload y el **motivo exacto** que calcula el servidor (`explain_supervisor_inventory_batch_payload`, p. ej. «línea 1: campo no permitido: productName»). La vista `supervisor_command_problems` une tres casos: rechazadas por la nube, fallidas al aplicarse en la caja y vencidas sin que la caja las tomara.

Es una herramienta **interna** (equipo y Claude), sin pantalla para el usuario. Para revisarla: `node scripts/supervisor-failures-report.mjs --hours 24` (o `--device PDA-V2-…`). Hay alarma diaria en GitHub (`.github/workflows/supervisor-failures-alarm.yml`). Migración: `supabase/migrations/20261119_supervisor_command_failures.sql`.

## Interruptores (se apagan sin publicar código)

En `src/config/supervisorPolicy.js`, variables `VITE_SUPERVISOR_REMOTE_*_ENABLED`. Por defecto **encendidas**: mutaciones, productos, ingresos, tasa, egresos y proveedores. Por defecto **apagadas**: ventas remotas (`..._SALES_ENABLED`) y TTL extendido (`..._EXTENDED_TTL_ENABLED`) hasta su despliegue.

## Datos y costos

Los datos viajan por `sync_documents`; un día con demasiada salida de datos (egress) ya ocurrió ([ERR-006](../../ERRORES.md)). Por eso los documentos grandes se dividen en piezas más pequeñas (ver `docs/plans/2026-10-21-plan-adelgazar-bodega-products-por-shards.md`) y hay un presupuesto de sincronización (`src/utils/syncDocBudget.js`).

## Seguridad de las tablas compartidas

Desde el 2026-11-15 (P-018) cada caja solo lee y marca **sus** solicitudes de respaldo (`backup_requests`), y la tabla `licenses` ya no se puede leer con la clave pública: las cajas consultan su licencia con los RPC `get_license_status` y `verify_activation_code`. La regla es la misma de `sync_documents`: `is_own_device_row(device_id)`. Ver `supabase/migrations/20261115_*.sql`.

## Archivos principales

`src/config/supervisorPolicy.js`, `src/services/supervisor*.js`, `src/hooks/useRemoteCommands.js`, `src/hooks/useMonitorSync.js`, `src/views/OwnerMonitorView.jsx`, `src/components/Monitor/`, `supabase/migrations/`.
