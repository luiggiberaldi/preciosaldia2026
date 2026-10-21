# Plan: alinear staging de Precios al Día con producción sin copiar datos

**Fecha de inspección:** 11 de octubre de 2026
**Objetivo:** que `precios-al-dia-staging` reproduzca el esquema necesario para validar la aplicación, pero conserve políticas de aislamiento de pruebas y use únicamente fixtures sintéticos.
**Alcance de este documento:** plan y observación de solo lectura. No se ejecutó DDL/DML, no se copiaron datos y no se cambió configuración en Supabase.

## Proyectos verificados

- **Producción:** `preciosaldia rebranding`, ref `sodgzkablshladvbtnes`, `ACTIVE_HEALTHY`, Postgres 17.6.1, región `us-east-1`.
- **Staging:** `precios-al-dia-staging`, ref `tdfcpwctvumbdjmifypd`, `ACTIVE_HEALTHY`, Postgres 17.6.1, región `ca-central-1`.
- Son proyectos separados, no una rama de desarrollo de producción.

## Diagnóstico observado (consultas de solo lectura)

| Objeto/estado | Producción | Staging |
|---|---:|---:|
| Tablas públicas base | 14 | 4 |
| Rutinas públicas | 15 | 3 |
| Políticas RLS públicas | 28 | 6 |
| Índices públicos | 36 | 10 |
| Tablas en `supabase_realtime` | 3 | 2 |
| Historial de migraciones reportado | 1 (`001`) | 0 |
| Filas en las tablas públicas inspeccionadas | Hay datos | 0 en las cuatro tablas reportadas |

Las cuatro tablas públicas de staging son `device_pairings`, `sync_documents`, `supervisor_commands` y `supervisor_canary_allowlist`. Producción también tiene tablas de licencias, respaldos, dispositivos, proyectos de clientes, visitas, notificaciones y catálogo que staging no muestra.

Diferencias de estructura que bloquean tratarlo como clon:

- `sync_documents`: producción usa `id bigint`, contiene `payload` y su unicidad es `(device_id, collection, doc_id)`; staging usa `id uuid`, no muestra `payload` y su unicidad es `(device_id, doc_id)`.
- `device_pairings`: staging no muestra `token_hash` ni `token_used_at`, presentes en el SQL de recuperación de producción.
- Producción tiene las RPC de pairing `generate_pairing_token`, `pair_monitor_device` y `unpair_monitor`; no aparecen en staging. En staging sí aparecen las RPC de comandos, pero faltan otras rutinas de producción relacionadas con licencias y dispositivos.
- Staging solo registra las políticas E2E `e2e-*`; producción tiene 28 políticas con alcance y propósitos diferentes. No se deben copiar a ciegas las políticas o grants productivos.
- La publicación Realtime y los índices tampoco coinciden completamente.
- La configuración local contiene `supabase/migrations/001_device_own_row_rls.sql`, pero no encontramos `supabase/config.toml`; la historia remota reportada (producción 1 / staging 0) no constituye por sí sola una cadena completa de migraciones reproducible.

Los números son una fotografía de las consultas de esta fecha, no un dump integral de todos los esquemas de Supabase. Antes de certificar equivalencia se deben incluir funciones/triggers y objetos personalizados de `auth`, `storage`, otras extensiones y ajustes de Auth/Realtime que use la app.

## Estrategia recomendada

**Clon de esquema, no clon de datos.** Mantener producción intacta; no importar filas, usuarios de Auth, backups, secretos ni objetos de Storage. Para staging, usar solo el esquema requerido, permisos de prueba deliberados y fixtures `e2e-*`. No convertir el aislamiento de staging en políticas productivas ni permitir que el frontend de pruebas use el proyecto de producción.

Como hay un esquema inicial personalizado, diferencias materiales entre ambos proyectos y staging ya tiene objetos propios, **no usar `db reset --linked`, `DROP ... CASCADE`, ni aplicar dumps directamente**. Primero construir una migración aditiva revisada y probarla localmente; si resultara imprescindible reemplazar objetos incompatibles, detenerse y solicitar aprobación explícita para una reconstrucción destructiva del staging.

## Procedimiento por etapas

### 0. Gate de acceso y alcance

1. Confirmar en el Dashboard que las dos refs y estados siguen siendo los esperados y que staging está `ACTIVE_HEALTHY` antes de cada acción remota.
2. Confirmar que `VITE_SUPABASE_STAGING_URL` apunta a `tdfcpwctvumbdjmifypd` y que solo las pruebas E2E opt-in usan esa configuración. No mostrar ni guardar valores de claves en logs, informes o commits.
3. Mantener la barrera de producción: toda consulta de comparación dirigida al proyecto productivo debe ser `SELECT`; toda futura aplicación de DDL/DML se dirige y verifica por ref explícita de staging.
4. Tomar un backup/export del **staging** antes de modificarlo. El export debe quedar privado y no incluir datos de producción.

**Abortar** si el destino/ref no es inequívoco, staging no está saludable, el backup falla, o el plan propuesto incluye datos reales/secretos.

### 1. Capturar el estado completo sin datos

1. Obtener snapshots **schema-only** de producción y staging (tablas, columnas, tipos/defaults, PK/FK/unique/check, índices, funciones/RPC, triggers, policies, grants, secuencias y membresía Realtime); sin `--data-only`, seed ni usuarios.
2. No usar el dump productivo como script de ejecución directa. Revisarlo como entrada de comparación; filtrar y adaptar a migraciones versionadas y al modelo de aislamiento E2E.
3. Inventariar aparte ajustes de Auth (incluido Anonymous si se necesita), Storage, secrets/nombres de variables, extensiones instaladas, buckets y objetos gestionados que `public` no cubre. Nunca exportar valores secretos.
4. Guardar baseline/diff sanitizados bajo control de cambios; revisar manualmente cada `DROP`, `REVOKE`, `GRANT`, cambio RLS y cambio de publicación.

### 2. Fijar el contrato de la aplicación

Acordar qué necesita la build E2E. Para un staging completo de aplicación, incluir las tablas de producción requeridas; para pruebas solo de Supervisor, documentar explícitamente que es un subconjunto y no llamarlo clon completo.

Como mínimo, resolver antes de escribir la migración:

- `sync_documents`: migrar staging al contrato productivo (tipo `id`, `payload`, unicidad y defaults) preservando únicamente filas `e2e-*`; comprobar si existe alguna fila incompatible antes del cambio.
- `device_pairings`: añadir el esquema de autorización requerido, incluidos `token_hash` y `token_used_at`, índices y constraint(s), preservando la política acotada a E2E.
- Crear las RPC de pairing/auth requeridas, incluida la versión actual de `unpair_monitor`, junto con permisos `authenticated`, `SECURITY DEFINER` y `search_path` validados. Mantener anónimos sin acceso directo.
- Incluir tablas/rutinas restantes que use la aplicación, y reproducir índices, triggers, restricciones, grants y publicación Realtime requeridos.
- Mantener en staging las políticas E2E que limiten lectura/escritura a IDs `e2e-*`. No copiar una política permisiva de producción sin revisar usuario/rol, operación y efecto.
- Revisar con especial cuidado el SQL existente de staging: contiene un rollback con `DROP TABLE ... CASCADE` y carga fixtures por `INSERT ... ON CONFLICT`; no tratarlo como migración inocua o reversible sin diseñar la reversión exacta.

### 3. Preparar y ensayar localmente

1. Establecer baseline versionado de forma explícita antes de usar `supabase db push`; la historia actual no basta para asumir que la CLI sabe qué existe en cada remoto.
2. Crear migraciones pequeñas y ordenadas, con precondiciones, invariantes, política staging y rollback revisados. No agregar la configuración o baseline a producción automáticamente.
3. Ensayar la cadena completa sobre Postgres local compatible, aplicarla desde una base vacía y sobre una copia sintética del esquema actual de staging.
4. Probar políticas con roles `anon`, `authenticated` (monitor/caja separados) y `service_role`; verificar aislamiento de caja A/B, acceso denegado fuera de `e2e-*`, pairing y revocación, ACK y rechazo de comandos prohibidos.
5. Confirmar que la configuración de prueba falla de forma segura si no está presente la URL/key de staging; nunca usar fallback a producción.

### 4. Aplicar exclusivamente a staging (requiere aprobación operativa)

1. Revisar el diff final y backup; hacer una pausa si hay objetos desconocidos o filas no sintéticas.
2. Aplicar migraciones versionadas con el destino fijado explícitamente a `tdfcpwctvumbdjmifypd`; nunca ejecutar `reset --linked`.
3. Insertar solo los fixtures deterministas `e2e-*` que requieran las pruebas; no copiar filas de producción.
4. No habilitar comandos remotos de producto, usuario, turno o egreso solo porque existan sus tablas/RPC. Los flags y validaciones del backend deben permanecer en el estado acordado y restrictivo.

### 5. Verificar y cerrar

Repetir snapshots de solo lectura y comparar firmas estructurales: objetos/columnas, tipos/defaults, constraints, índices, funciones y argumentos, triggers, políticas, permisos, RLS enabled/forced, extensiones instaladas y tablas Realtime. Criterios para declarar **clon de esquema apto para la app**:

- todas las tablas/funciones requeridas por la build están presentes y compatibles;
- diffs restantes están documentados (región/versión de patch, límites E2E, ajustes de plataforma, extensiones disponibles);
- staging conserva las restricciones `e2e-*`, ningún rol cliente accede a datos reales, y las rutas prohibidas son rechazadas por backend;
- los conteos de datos son solo de fixtures sintéticos y no hay usuarios/objetos reales copiados;
- pasan pruebas SQL guardrails y E2E con la variable explícita de staging;
- producción no recibió escrituras ni cambios.

Si alguna comparación estructural falla, **no ejecutar pruebas funcionales ni usar staging como clon**; informar la diferencia y corregir por una migración revisada.

## Rollback y límites

- Preferir rollback transaccional de la migración aplicada si el SQL y el estado lo permiten, o una migración inversa específica, después de comprobar que solo hay fixtures sintéticos.
- No ejecutar el comentario `DROP TABLE ... CASCADE` del script existente como rollback general: eliminaría objetos/dependencias, no restaura el esquema anterior.
- Si hay pérdida/cambio no previsto, detener escritores E2E y restaurar el backup del staging siguiendo procedimiento revisado. No restaurar ni escribir en producción.
- Una restauración completa, reset remoto o borrado de datos de staging requiere autorización explícita aparte.

## Estado de ejecución

- Inspección remota de solo lectura hecha: ambos proyectos saludables en la consulta más reciente; staging **no** es clon de producción hoy.
- No se generó ni aplicó migración, no se creó backup, no se copiaron datos, no se habilitó Anonymous Auth y no se ejecutaron pruebas E2E remotas.
- Próximo gate: revisar este alcance, crear el baseline schema-only controlado y aprobar expresamente las escrituras necesarias únicamente en staging.

## Referencias oficiales

- [Supabase CLI: db dump](https://supabase.com/docs/reference/cli/supabase-db-dump) — dump remoto sin datos por defecto.
- [Supabase CLI: db pull](https://supabase.com/docs/reference/cli/supabase-db-pull) — captura schema remoto en migración; requiere revisión.
- [Workflow local de Supabase](https://supabase.com/docs/guides/local-development/cli-workflows) — baseline, migraciones versionadas y advertencias de `db reset --linked`.
