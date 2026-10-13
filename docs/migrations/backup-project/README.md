# Manifiestos de respaldo — proyecto Supabase dedicado

**Borrador local, no aplicado.** [001-business-backup-manifest.sql](001-business-backup-manifest.sql) está dirigido exclusivamente al proyecto Supabase dedicado a respaldos, no al POS ni a Estación. Este cambio no crea recursos remotos ni habilita cargas.

## Límites de confianza

La Estación debe comprobar una licencia Lite activa en el backend operacional y autorizar el dispositivo antes de aceptar cada respaldo. Esta base remota solo garantiza asignación explícita, aislamiento, integridad de metadatos e idempotencia; no puede probar el estado de licencia. No habilitar uploads hasta implementar/verificar esa validación server-to-server.

El proyecto guarda un UUID opaco `business_id`, asignaciones y metadatos mínimos; nunca nombres de negocio, licencia, email, teléfono ni payload JSON. `SUPABASE_SERVICE_ROLE_KEY` solo vive en el servidor. RLS queda activado sin políticas para `anon`/`authenticated`; las escrituras son RPCs `SECURITY DEFINER` accesibles solo a `service_role`. El POS llama a Estación, no a Storage/RPC directamente.

## Negocio y dispositivos

- `backup_businesses` crea un identificador tenant estable. Generarlo/resolverlo en el servidor; no usar nombre, email o licencia como identificador. Se conserva entre rotaciones de licencia y cambios de nombre.
- `backup_device_assignments` une negocio, producto y device ID. V1 acepta exclusivamente `bodega` (Lite), fail-closed para Pro. El ID se normaliza en SQL a mayúsculas sin espacios y debe tener 8–64 caracteres.
- Solo puede existir una asignación activa por producto/dispositivo. Repetir la asignación al mismo negocio devuelve la fila existente; conflicto con otro negocio falla y requiere revisión humana. No reasignar automáticamente.
- Revocar conserva el historial; reasignar crea otra asignación. Archivar negocio requiere cero dispositivos activos. Los manifiestos quedan ligados a la asignación histórica exacta.
- Antes de cualquier backfill de `account_devices`, determinar qué campo es la identidad estable y cómo cotejar licencia y estado. Preparar reporte de candidatos/conflictos; dejar ambiguos sin asignar.

## Manifiesto y flujo

`backup_manifests` identifica una operación por UUID, asignación, tamaño, SHA-256 de los bytes comprimidos y versión de esquema. Su única ruta aceptada es `<business UUID>/<operation UUID>.json.gz`, generada por SQL, no por el cliente. Payload máximo en esta v1: 50 MiB. Validar JSON/compresión con schema estricto antes de escribir.

1. Estación valida secreto, origen/abuso, licencia Lite actual, asignación, tamaño y formato; calcula SHA-256 de los bytes reales.
2. Estación crea/conserva UUID de operación y llama `begin_backup_operation`. Reintento con los mismos metadatos retorna la misma operación; cambiar asignación/hash/tamaño/schema falla (`operation_id_payload_conflict`). Solo `uploading` puede continuar.
3. Subir al bucket privado por la ruta devuelta. Verificar bytes, tamaño y hash leyendo el objeto almacenado; no fiarse del hash declarado por el POS.
4. Llamar `finalize_backup_upload`. Serializa por negocio, verifica asignación aún activa, marca `verified` y señala los anteriores a los tres más recientes como `cleanup_pending`. Nunca borrar antes de verificar el nuevo objeto.
5. Borrar objetos pendientes en Storage y llamar `complete_backup_cleanup` solo tras confirmar borrado. Si falla, dejar cola reintentable y reportar estado no terminal.
6. Errores terminales de carga/verificación se marcan con `fail_backup_operation` y un código cerrado. Mismo intento fallido requiere UUID nuevo para repararlo.

Estados: `uploading` → `verified` → `cleanup_pending` → `deleted`; carga inválida puede pasar a `failed`. `deleted` conserva tombstone. La retención deja como disponibles los tres `verified` más recientes; limpieza pendiente nunca se oculta.

## Aplicación y pruebas pendientes

Antes de ejecutar la migración se requiere: confirmar acceso y ref del proyecto dedicado, comprobar bucket privado/policies y límites, revisar el DDL en Postgres de prueba, resolver migración de backups existentes, ventana/backup y autorización del propietario. Después, revisar RLS/grants y probar llamadas anónimas/autenticadas/service-role.

Staging debe cubrir aislamiento entre A/B, Lite vs Pro, IDs duplicados, revocación durante upload, operación idempotente con mismos/distintos datos, cargas concurrentes, interrupción en cada paso, hash incorrecto y fallo/reintento de limpieza. Desplegar el servidor de Estación de manera separada y mantener apagado el cliente hasta pasar esas pruebas. La migración no define todavía rutas HTTP, política de Storage, validación del payload ni chequeo de licencia; no declarar el sistema listo para producción.
