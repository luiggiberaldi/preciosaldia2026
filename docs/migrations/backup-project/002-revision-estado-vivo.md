# Revisión del estado vivo — proyecto de respaldos (`qlujyvauumzfpdefdkyl`)

Fecha: 2026-10-14. Solo lectura. **No se ha aplicado ningún cambio.**

## Estado verificado

| Objeto | Estado | Observación |
|---|---|---|
| Bucket `business-backups` | Existe, privado, 50 MB, solo gzip | Correcto según la propuesta |
| `backup_businesses` | Existe, RLS activo, sin grants a anon/authenticated | Correcto |
| `backup_device_assignments` | Existe, RLS activo, 2 asignaciones `bodega` activas | Correcto |
| `backup_manifests` | Existe, RLS activo, 2 filas | Esquema distinto al del archivo 001 (`schema_version` smallint, sin `cleanup_pending` documentado) |
| `backup_manifest` (singular) | Existe, vacía, RLS activo | **Residuo sin explicación en el repo** |
| `storage.objects` | 0 objetos | No se ha subido ningún respaldo |
| Políticas RLS en `public`/`storage` | Ninguna | Coherente con RLS sin políticas |

## Decisiones que necesito

1. **Tabla `backup_manifest` (singular):** ¿se elimina o se conserva? Está vacía, pero su nombre es casi idéntico al de `backup_manifests`. Mi recomendación es eliminarla tras confirmar que no la usa código alguno.
2. **Esquema de `backup_manifests`:** el archivo 001 y la base viva no coinciden. Antes de subir nada hay que decidir cuál manda y dejar una sola migración.
3. **Asignaciones existentes:** las 2 asignaciones activas (`bodega`) deben confirmarse contra licencias reales antes de usarlas.
4. **Migración 001:** falta el paso de subida real y la validación de licencia en servidor, por lo que no hay que aplicarla todavía.

## Próximo paso propuesto

- Confirmar en código si `backup_manifest` (singular) se usa.
- Reconciliar el esquema de `backup_manifests` con el archivo 001.
- Solo después, probar la subida en staging desde Estación.
