# Migración a producción — Modo Supervisor (plan, sin aplicar)

**Fecha:** 13 de octubre de 2026
**Producción:** `sodgzkablshladvbtnes` · **Staging:** `tdfcpwctvumbdjmifypd`
**Estado:** plan. No se ha aplicado SQL en producción.

## 1. Estado actual de producción (solo lectura)

- `device_pairings`: 19 filas. 3 vínculos activos, 4 revocadas, **13 sin dueño** (`owner_auth_id IS NULL`).
- Órdenes `supervisor_commands` pending: 0.
- Faltan en producción: `pair_monitor_device_with_secret`, `unpair_monitor_with_secret`, `e2e_delete_pairing` y la columna `monitor_secret_hash`.
- `generate_pairing_token` en producción **reclama cualquier caja sin dueño o revocada** (hueco de seguridad confirmado).

## 2. Diferencias de esquema (producción → lo que hace falta)

| Objeto | Producción | Requerido |
|---|---|---|
| `device_pairings.monitor_secret_hash` | no existe | añadir (nullable, aditiva) |
| `pair_monitor_device_with_secret` | no existe | añadir |
| `unpair_monitor_with_secret` | no existe | añadir |
| `e2e_delete_pairing` | no existe | **no añadir a producción** (solo staging) |
| `generate_pairing_token` | reclama cajas sin dueño | owner-proof (borrador) |
| `pair_monitor_device` | sin validación de ID de monitor | validación del borrador `monitor_id_formats` |

## 3. Bloqueos que impiden aplicar staging tal cual

1. **Las versiones de staging 013 solo funcionan con datos sintéticos.** `pair_monitor_device` y `unpair_monitor_with_secret` filtran por `e2e-%`. En producción bloquearían todas las cajas reales. Hay que reescribirlas sin ese filtro antes de producción.
2. **Dos borradores reemplazan `pair_monitor_device`.** Staging 013 y `20261012_prod_monitor_id_formats` cambian la misma función con validaciones distintas. Deben fusionarse en una sola versión.
3. **El owner-proof deja sin token a las 13 cajas sin dueño** hasta que exista un bootstrap de dueño (`20261013_prod_pairing_owner_bootstrap`). Hay que decidir el orden o aceptar ese corte.
4. **El cap de 2 monitores (`device_monitors_cap`) cambia el modelo de un monitor por caja.** No es necesario para este cambio; sacarlo del alcance de esta migración.

## 4. Orden propuesto (solo tras aprobación)

1. **Respaldo verificado.** Ejecutar `scripts/backupSupabaseProject.mjs` con `SUPABASE_ACCESS_TOKEN` del entorno. Verificar que el `.sql` y el `.json` existen y tienen filas. Guardar también `pg_get_functiondef` de las funciones que se van a reemplazar.
2. **Versión de producción fusionada** de `pair_monitor_device`, `pair_monitor_device_with_secret` y `unpair_monitor_with_secret`, sin filtros `e2e-%`. Ensayo en staging con dos identidades.
3. **Owner-proof** de `generate_pairing_token`, decidiendo antes el bootstrap de las 13 cajas sin dueño.
4. Aplicar en una sola transacción, en este orden: columna, funciones con secreto, owner-proof.
5. Verificación posterior (sección 5).

## 5. Verificación posterior y reversión

- Verificación: funciones con `has_function_privilege` (anon no ejecuta; authenticated sí), filas activas sin cambios (3), órdenes pending sin cambios (0), y un ensayo real de vinculación/desvinculación con una caja de prueba creada para ese fin.
- Reversión: restaurar las definiciones guardadas en el paso 1 con `CREATE OR REPLACE`. Quitar `monitor_secret_hash` solo si no contiene datos que se necesiten.
- Compatibilidad: la app ya cae a la RPC clásica si falta la nueva (`isMissingSecretPairingRpc`), así que una versión de app anterior sigue funcionando.

## 6. Puertas de aprobación

- No se aplica nada sin: respaldo verificado, ensayo en staging con éxito y aprobación explícita del dueño del proyecto.
- Producción tiene clientes reales (3 vínculos activos): la ventana de aplicación debe pedirse por separado.
