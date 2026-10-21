# Modo Supervisor — estado, staging vs producción y pendientes

**Fecha:** 13 de octubre de 2026
**Complementa:** [2026-10-13-supervisor-readiness-local.md](2026-10-13-supervisor-readiness-local.md), [2026-10-11-preciosaldia-staging-alignment-plan.md](2026-10-11-preciosaldia-staging-alignment-plan.md), [2026-10-11-roadmap-modo-supervisor.md](2026-10-11-roadmap-modo-supervisor.md) y [staging-migrations/README.md](../../supabase/staging-migrations/README.md).

## 1. Proyectos

| | Producción | Staging |
|---|---|---|
| Nombre | preciosaldia rebranding | precios-al-dia-staging |
| Ref | `sodgzkablshladvbtnes` | `tdfcpwctvumbdjmifypd` |
| Uso | Clientes reales | Pruebas E2E con datos sintéticos `e2e-*` |
| Escrituras de esta sesión | Ninguna | Sí (ver sección 3) |

## 2. Diferencias de esquema observadas

Fotografía de solo lectura del 11 de octubre; no es un dump completo.

| Objeto | Producción | Staging |
|---|---|---|
| Tablas públicas | 14 | 4 (`device_pairings`, `sync_documents`, `supervisor_commands`, `supervisor_canary_allowlist`) más las añadidas después |
| Rutinas públicas | 15 | 3 más las añadidas después |
| Políticas RLS | 28 | 6 más las E2E `e2e-*` |
| Índices | 36 | 10 más los añadidos |
| Realtime | 3 tablas | 2 tablas |
| Historial de migraciones | 1 | 0 |

Diferencias que impiden tratar staging como clon:

- `sync_documents`: producción usa `id bigint` con `payload` y unicidad `(device_id, collection, doc_id)`. Staging tenía `id uuid` y unicidad `(device_id, doc_id)`. Lo corrige la migración `20261011_001`, que aborta si hay filas.
- `device_pairings`: en staging faltaban `token_hash` y `token_used_at`. La migración `20261011_002` los añade.
- Producción tiene `generate_pairing_token`, `pair_monitor_device` y `unpair_monitor`. Staging las recibió por la migración `002`.
- Producción tiene además rutinas de licencias y dispositivos que staging no replica. Es un subconjunto a propósito.
- Las políticas de producción no se copian a staging; el aislamiento de staging se mantiene con `e2e-*`.
- No existe `supabase/config.toml`, así que el historial de migraciones no es una base reproducible para ambos remotos.

## 3. Lo hecho

### Staging
- Migraciones `20261011_001` y `20261011_002`, `20261012_003` (objetos faltantes en modo fail-closed) y `20261013_004` (varias cajas por un mismo teléfono; aplicada el 13/10).
- Funciones `e2e_set_pairing_link`, `e2e_set_canary_allowlist` y `e2e_cleanup_commands` aplicadas directamente. Son `SECURITY DEFINER`, solo aceptan `e2e-%` y solo `authenticated`. **No están guardadas como archivo de migración.**
- Filas `e2e-*` de prueba y un usuario anónimo de prueba creados durante las verificaciones. **Siguen en staging.**

### Producción
- Solo lectura. No se aplicó SQL. Borradores sin aplicar en `supabase/production-drafts/`: `20261012_prod_monitor_id_formats.sql`, `20261013_prod_device_monitors_cap.sql`, `20261013_prod_pairing_owner_bootstrap.sql` y `20261013_prod_pairing_token_owner_proof.sql`.

### Código local
- Fuente única de configuración del backend en [supabaseTarget.js](../../src/config/supabaseTarget.js). En modo staging falla cerrado si faltan la URL o la clave de staging, o si la URL no es el proyecto de staging.
- [supabaseCloud.js](../../src/config/supabaseCloud.js) y [supabaseClient.js](../../src/core/supabaseClient.js) usan esa fuente.
- [useSecurity.jsx](../../src/hooks/useSecurity.jsx), [useLicenseMonitoring.js](../../src/hooks/useLicenseMonitoring.js) y [DevicesManager.jsx](../../src/components/Settings/DevicesManager.jsx) comprueban el backend con `hasSupabaseBackend`.
- Pruebas nuevas en [supabaseTarget.test.js](../../tests/supabaseTarget.test.js).
- Receptor de órdenes: revalida que la orden siga `pending`, que coincida caja/monitor y que el pairing no esté revocado antes de aplicar. Persiste el resultado antes del ACK terminal.

### Verificado
- Lint de los 7 archivos tocados: 0 errores (55 advertencias preexistentes).
- Typecheck del proyecto: pasa.
- Pruebas de fuente única, seguridad, heartbeat y licencias: 37 pasan, 8 se omiten.
- Build en modo staging con variables de staging: pasa.

## 4. Lo que falta

### Bloqueante: bundle de staging
- **El bundle de staging todavía contiene la URL de producción** (9 referencias). Vienen de lecturas directas de `import.meta.env.VITE_SUPABASE_URL` y del fallback de producción en `supabaseTarget.js`.
- El build pasa también sin variables de staging. El guardia se evalúa al cargar la app, no al compilar. No está comprobado en navegador que la app falle cerrado.

### Seguridad del backend
- Autorización server-side real del dueño al generar el token de pairing. Un formato de ID no prueba la propiedad de la caja.
- Cierre atómico de órdenes al revocar: revocar o expirar comandos pendientes en la misma transacción server-side.
- Advisors de Supabase en staging: 10 tablas nuevas sin policies (intencional); `heartbeat_device` y `auto_register_device` con `search_path` mutable y ejecutables por `anon`/`authenticated`; RPC `SECURITY DEFINER` para roles cliente. Revisar contra uso real antes de cambiar permisos.
- Advisor de rendimiento: policy `supervisor_commands_authorized_read` evalúa Auth por fila.

### Migraciones y reproducibilidad
- Versionar `e2e_set_pairing_link`, `e2e_set_canary_allowlist` y `e2e_cleanup_commands` como archivo de migración.
- Crear una línea base reproducible antes de usar `supabase db push`.
- Completar la comparación con funciones, triggers, Auth, Storage y extensiones.

### Pruebas
- E2E remotos contra staging: no ejecutados; requieren aprobación explícita porque escriben fixtures.
- Verificación en navegador del arranque fallido sin variables de staging: pendiente.

### Limpieza de staging
- Borrar las 9 filas `e2e-*` y el usuario anónimo de prueba. Pendiente de confirmación.

### Producción
- Aplicar borradores solo tras revisión y aprobación explícita.
- Verificar que no existan funciones `e2e_%` (la nota de staging indica que no hay).
- Habilitar Anonymous Auth en producción solo si se decide.
- No se han activado comandos remotos de producto, usuario, turno ni egreso. Egreso y tasa siguen bloqueados.

## 5. Resueltas el 13/10 y pendientes

Resuelto:

1. **Bundle de staging sin URL de producción.** `vite.config.js` define `VITE_SUPABASE_URL`, `VITE_SUPABASE_CLOUD_URL`, `VITE_SUPABASE_CLOUD_KEY` y `VITE_SUPABASE_ANON_KEY` como vacíos cuando `VITE_SUPERVISOR_E2E_STAGING=true`. `.env` no se tocó. Build verificado: 0 referencias a `sodgzkablshladvbtnes` en el bundle de staging.
2. **Filas `e2e-*` en staging.** Borradas `sync_documents` (5) y `supervisor_canary_allowlist` (1). Verificado en 0.
3. **Funciones E2E versionadas** en [20261013_005_staging_e2e_helpers.sql](../../supabase/staging-migrations/20261013_005_staging_e2e_helpers.sql). El ACL de staging confirma que solo `authenticated`, `postgres` y `service_role` tienen EXECUTE.

Pendiente:

- **Usuario anónimo de prueba:** no borrado. Staging tiene 192 usuarios anónimos y no hay forma segura de identificar cuál es el de prueba. Requiere el ID exacto.
- **Build de la app:** la importación `matchesSearch` duplicada en `OwnerMonitorView.jsx` (líneas 17 y 34) bloqueaba el build; se quitó la línea 34. Confirmar con el autor del cambio que no hay otra edición en curso.
- **Verificación en navegador** del arranque fallido sin variables de staging: pendiente.
