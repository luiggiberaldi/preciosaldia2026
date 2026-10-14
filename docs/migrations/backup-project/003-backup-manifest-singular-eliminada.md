# Respaldo de estructura — `public.backup_manifest` (singular)

Eliminada el 2026-10-14 del proyecto de respaldos `qlujyvauumzfpdefdkyl`.

Motivo: tabla duplicada, sin filas (0), sin claves foráneas entrantes ni salientes, sin uso en los repos POS ni Estación Maestra.

## Columnas

| Columna | Tipo | Nulo | Default |
|---|---|---|---|
| id | uuid | NO | gen_random_uuid() |
| business_id | text | NO | — |
| device_id | text | NO | — |
| operation_id | uuid | NO | — |
| storage_path | text | NO | — |
| size_bytes | bigint | NO | — |
| sha256 | text | NO | — |
| schema_version | text | NO | — |
| status | text | NO | 'uploading' |
| created_at | timestamptz | NO | now() |

## Índices

- `backup_manifest_pkey` — UNIQUE (id)
- `backup_manifest_business_id_operation_id_key` — UNIQUE (business_id, operation_id)
- `backup_manifest_business_created_idx` — (business_id, created_at DESC)

## Restauración (si fuera necesaria)

Recrear con las columnas e índices de arriba. Sin datos que recuperar.
