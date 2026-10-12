# Precios al Día — comparativo de esquema Supabase

Generado: 2026-10-11 (consulta MCP de Supabase)

> Comparación de metadatos de esquema únicamente. No consulta filas de negocio ni incluye cuerpos de funciones o valores secretos. Los literales SQL de defaults y expresiones se omiten o se redactan en este reporte.

## Proyectos

| Entorno | Proyecto | Ref | PostgreSQL | Relaciones públicas | Rutinas públicas | Políticas RLS | Triggers | Extensiones instaladas (sin plpgsql) | Tablas Realtime | Migraciones registradas |
|---|---|---|---:|---:|---:|---:|---:|---:|---|---|
| Producción | preciosaldia rebranding | `sodgzkablshladvbtnes` | 17.6 | 14 | 15 | 28 | 1 | 4 | device_pairings, supervisor_commands, sync_documents | 001 device_own_row_rls |
| Staging | precios-al-dia-staging | `tdfcpwctvumbdjmifypd` | 17.6 | 4 | 3 | 6 | 1 | 4 | supervisor_commands, sync_documents | Ninguna registrada |

## Resumen ejecutivo

Staging no es un clon completo del esquema público de producción. Incluye las cuatro tablas relacionadas con el modo supervisor y pruebas; faltan diez relaciones públicas de producción. Las diferencias más relevantes están en `device_pairings`, `supervisor_commands` y `sync_documents`, además de las políticas staging-only de aislamiento E2E.

La comparación se hizo consultando catálogos de PostgreSQL por MCP en ambos proyectos. Los conteos/detalles de tablas, rutinas, políticas y extensiones se obtuvieron con herramientas de solo lectura; la consulta SQL MCP inspeccionó catálogos y no leyó datos de negocio.

## Diferencias estructurales verificadas

### Relaciones presentes solo en producción

- `account_devices`
- `backup_requests`
- `cloud_backups`
- `cloud_licenses`
- `customer_projects`
- `device_sessions`
- `licenses`
- `notifications`
- `product_images_catalog`
- `visits`

Staging contiene únicamente `device_pairings`, `supervisor_canary_allowlist`, `supervisor_commands` y `sync_documents`.

### `device_pairings`

- Producción tiene `token_hash` y `token_used_at`; staging no.
- Producción tiene índice único en `monitor_device_id`, más índices para monitor/primary auth y hash de token. Staging no muestra esos índices y sí un índice parcial por `last_seen_at`.
- Producción no fuerza RLS en esta tabla; staging tiene `FORCE ROW LEVEL SECURITY`.
- Staging añade cinco políticas de aislamiento para pruebas E2E, todas limitadas a prefijos `e2e-`: `staging_authenticated_pairing_read`, `staging_definer_pairing_access`, `staging_canary_allowlist_definer_read`, `staging_definer_command_access` y `staging_authenticated_sync_read`. No aparecen en producción.
- Ambas comparten columnas de asociación de dispositivos y auth, RLS activado y PK `id`.

### `supervisor_commands`

- Staging tiene una columna y restricción `schema_version` (NOT NULL, default 1, CHECK = 1); producción tiene la columna, pero no la restricción CHECK en el snapshot consultado.
- Staging fuerza RLS en esta tabla; producción no.
- Staging agrega políticas de acceso acotadas a IDs `e2e-`; ambas tienen lectura autenticada autorizada para el supervisor.
- Las columnas principales, restricciones de tipos de comando/estado, índices funcionales y PK coinciden.

### `sync_documents`

- Producción define `id` como `bigint` con secuencia; staging como `uuid` con `gen_random_uuid()`.
- Producción tiene ambas columnas JSONB `data` y `payload`; staging solo `data`.
- La clave única de producción es `(device_id, collection, doc_id)`; staging usa `(device_id, doc_id)`.
- Staging fuerza RLS y agrega una política de lectura autenticada para IDs `e2e-`; producción no fuerza RLS.
- Ambas tienen la restricción de `collection` para `store`/`local` y políticas de lectura/escritura de supervisor o dispositivo, con reglas que no son idénticas.

### Canario, Realtime y extensiones

- `supervisor_canary_allowlist` mantiene columnas y restricciones principales, tiene RLS forzado en ambos. El `purpose` default difiere: producción «M5 income canary», staging «M2 staging canary».
- Producción publica `device_pairings`, `supervisor_commands` y `sync_documents` en Realtime. Staging publica solo `supervisor_commands` y `sync_documents`.
- Coinciden las cuatro extensiones de aplicación instaladas: `pg_stat_statements` 1.11, `pgcrypto` 1.3, `supabase_vault` 0.3.1 y `uuid-ossp` 1.1. Se excluye `plpgsql`, que viene con PostgreSQL y aparece en ambos.
- Hay un trigger `supervisor_income_pairing_guard` en cada proyecto; la función de trigger también existe en ambos.

### Rutinas públicas

Producción expone 15 rutinas públicas en catálogos; staging expone 3. Las tres compartidas son `ack_supervisor_command`, `create_supervisor_command` y `enforce_supervisor_income_command`. Solo en producción aparecen `activate_demo_secure`, `auto_register_device`, `current_device_id`, `generate_pairing_token`, `get_license_status`, `heartbeat_device`, `is_own_device_row`, `lookup_customer_project`, `pair_monitor_device`, `report_pro_devices`, `unpair_monitor` y `verify_activation_code`. No se compararon cuerpos de funciones.

### Historial de migraciones

- Producción registra `001 device_own_row_rls`.
- Staging no reporta migraciones registradas mediante la herramienta MCP.
- El historial MCP vacío no demuestra por sí solo que el esquema staging esté vacío o que no haya habido DDL manual; el catálogo actual confirma cuatro relaciones públicas.

## Alcance y limitaciones

- Es una comparación de metadatos, no de filas, Auth/Storage administrados, secretos ni configuración de proveedores.
- La inspección detallada de catálogo por MCP recuperó todo el snapshot para producción, pero la respuesta detallada para staging llegó truncada. Para staging, la herramienta de listado detallado confirmó las cuatro tablas y columnas; la consulta de catálogo compacta confirmó rutinas, políticas, extensiones, trigger, relaciones, RLS, índices por nombre y Realtime. No se generó un diff línea por línea de cada expresión de política, default e índice entre ambos proyectos.
- El token local de Supabase Management API no fue aceptado por el comando `bun run schema:compare` (HTTP 401). El reporte se elaboró mediante la conexión MCP de Supabase, que sí tuvo acceso a ambos proyectos; el comando local no llegó a escribir su reporte estándar.
- No se aplicaron migraciones ni se modificó ningún proyecto. Se recomienda revisar manualmente las diferencias antes de decidir si staging debe alinearse con producción; varias ausencias y políticas E2E pueden ser intencionales.
