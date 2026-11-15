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

## Interruptores (se apagan sin publicar código)

En `src/config/supervisorPolicy.js`, variables `VITE_SUPERVISOR_REMOTE_*_ENABLED`. Por defecto **encendidas**: mutaciones, productos, ingresos, tasa, egresos y proveedores. Por defecto **apagadas**: ventas remotas (`..._SALES_ENABLED`) y TTL extendido (`..._EXTENDED_TTL_ENABLED`) hasta su despliegue.

## Datos y costos

Los datos viajan por `sync_documents`; un día con demasiada salida de datos (egress) ya ocurrió ([ERR-006](../../ERRORES.md)). Por eso los documentos grandes se dividen en piezas más pequeñas (ver `docs/plans/2026-10-21-plan-adelgazar-bodega-products-por-shards.md`) y hay un presupuesto de sincronización (`src/utils/syncDocBudget.js`).

## Seguridad de las tablas compartidas

Desde el 2026-11-15 (P-018) cada caja solo lee y marca **sus** solicitudes de respaldo (`backup_requests`), y la tabla `licenses` ya no se puede leer con la clave pública: las cajas consultan su licencia con los RPC `get_license_status` y `verify_activation_code`. La regla es la misma de `sync_documents`: `is_own_device_row(device_id)`. Ver `supabase/migrations/20261115_*.sql`.

## Archivos principales

`src/config/supervisorPolicy.js`, `src/services/supervisor*.js`, `src/hooks/useRemoteCommands.js`, `src/hooks/useMonitorSync.js`, `src/views/OwnerMonitorView.jsx`, `src/components/Monitor/`, `supabase/migrations/`.
