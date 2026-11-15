# Línea base de egress (F0) — 14-11-2026

Generado con `node scripts/egress-report.mjs --from 2026-11-10 --to 2026-11-14` antes de aplicar F1. Plan: [2026-11-14-plan-fixeo-egress-realtime.md](../plans/2026-11-14-plan-fixeo-egress-realtime.md).

## Subidas a `sync_documents` por día

| Día | POST | Subido | POST más grande | < 20 KB | 20-70 KB | 70-150 KB | 150-300 KB | 300-500 KB | > 500 KB | GET | Conexiones Realtime |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-10 | 726 | 161.0 MB | 403 KB | 9 (99 KB) | 239 (10.3 MB) | 57 (6.0 MB) | 76 (17.0 MB) | 345 (127.6 MB) | 0 (0 B) | 5 | 209 |
| 2026-11-11 | 834 | 175.7 MB | 405 KB | 21 (134 KB) | 281 (11.7 MB) | 74 (8.4 MB) | 89 (19.1 MB) | 369 (136.4 MB) | 0 (0 B) | 519 | 438 |
| 2026-11-12 | 746 | 168.2 MB | 402 KB | 10 (113 KB) | 238 (10.1 MB) | 40 (4.4 MB) | 117 (26.3 MB) | 341 (127.4 MB) | 0 (0 B) | 67 | 250 |
| 2026-11-13 | 916 | 205.7 MB | 401 KB | 12 (120 KB) | 327 (13.9 MB) | 43 (4.7 MB) | 84 (19.7 MB) | 450 (167.3 MB) | 0 (0 B) | 59 | 313 |
| 2026-11-14 | 780 | 173.8 MB | 405 KB | 15 (149 KB) | 264 (11.2 MB) | 51 (5.2 MB) | 76 (16.9 MB) | 374 (140.3 MB) | 0 (0 B) | 9 | 372 |

## Documentos más pesados hoy

| doc_id | Equipo | Tamaño | Actualizado |
|---|---|---|---|
| bodega_products_v1 | equipo-01… | 1.4 MB | 2026-10-16 19:57:58.535+00 |
| bodega_products_v1 | equipo-02… | 1.4 MB | 2026-10-18 03:20:16.88+00 |
| bodega_products_v1 | equipo-03… | 1.4 MB | 2026-10-19 08:37:43.746+00 |
| bodega_products_v1 | equipo-04… | 1.4 MB | 2026-10-24 13:39:10.848+00 |
| bodega_products_v1 | equipo-05… | 1.4 MB | 2026-10-23 02:52:10.442+00 |
| bodega_products_v1 | equipo-11… | 1.4 MB | 2026-10-26 11:41:34.686+00 |
| bodega_products_v1 | equipo-09… | 1.4 MB | 2026-10-25 00:09:06.212+00 |
| bodega_products_v1 | equipo-06… | 1.3 MB | 2026-10-18 15:13:53.753+00 |
| bodega_sales_v1 | equipo-06… | 722 KB | 2026-10-18 15:13:43.635+00 |
| bodega_sales_v1 | equipo-01… | 713 KB | 2026-10-16 19:57:58.536+00 |
| bodega_sales_v1 | equipo-02… | 709 KB | 2026-10-18 03:20:16.88+00 |
| bodega_sales_v1 | equipo-03… | 709 KB | 2026-10-19 08:37:44.024+00 |
| bodega_sales_v1 | equipo-08… | 674 KB | 2026-10-16 00:10:40.184+00 |
| bodega_products_v1 | equipo-10… | 578 KB | 2026-07-12 20:52:16.937+00 |
| bodega_sales_v1 | equipo-07… | 499 KB | 2026-08-09 16:40:16.495+00 |

Tablas en `supabase_realtime`: `device_pairings`, `supervisor_commands`, `sync_documents`

## ⚠️ Límites superados

- 2026-11-10: subida a sync_documents 161.0 MB (límite 40.0 MB)
- 2026-11-10: un POST a sync_documents pesó 403 KB (límite 150 KB)
- 2026-11-10: 209 conexiones de Realtime (límite 150)
- 2026-11-11: subida a sync_documents 175.7 MB (límite 40.0 MB)
- 2026-11-11: un POST a sync_documents pesó 405 KB (límite 150 KB)
- 2026-11-11: 438 conexiones de Realtime (límite 150)
- 2026-11-12: subida a sync_documents 168.2 MB (límite 40.0 MB)
- 2026-11-12: un POST a sync_documents pesó 402 KB (límite 150 KB)
- 2026-11-12: 250 conexiones de Realtime (límite 150)
- 2026-11-13: subida a sync_documents 205.7 MB (límite 40.0 MB)
- 2026-11-13: un POST a sync_documents pesó 401 KB (límite 150 KB)
- 2026-11-13: 313 conexiones de Realtime (límite 150)
- 2026-11-14: subida a sync_documents 173.8 MB (límite 40.0 MB)
- 2026-11-14: un POST a sync_documents pesó 405 KB (límite 150 KB)
- 2026-11-14: 372 conexiones de Realtime (límite 150)
- doc bodega_products_v1 (equipo-01…) pesa 1.4 MB (límite 200 KB)
- doc bodega_products_v1 (equipo-02…) pesa 1.4 MB (límite 200 KB)
- doc bodega_products_v1 (equipo-03…) pesa 1.4 MB (límite 200 KB)
- doc bodega_products_v1 (equipo-04…) pesa 1.4 MB (límite 200 KB)
- doc bodega_products_v1 (equipo-05…) pesa 1.4 MB (límite 200 KB)
- doc bodega_products_v1 (equipo-11…) pesa 1.4 MB (límite 200 KB)
- doc bodega_products_v1 (equipo-09…) pesa 1.4 MB (límite 200 KB)
- doc bodega_products_v1 (equipo-06…) pesa 1.3 MB (límite 200 KB)
- doc bodega_sales_v1 (equipo-06…) pesa 722 KB (límite 200 KB)
- doc bodega_sales_v1 (equipo-01…) pesa 713 KB (límite 200 KB)
- doc bodega_sales_v1 (equipo-02…) pesa 709 KB (límite 200 KB)
- doc bodega_sales_v1 (equipo-03…) pesa 709 KB (límite 200 KB)
- doc bodega_sales_v1 (equipo-08…) pesa 674 KB (límite 200 KB)
- doc bodega_products_v1 (equipo-10…) pesa 578 KB (límite 200 KB)
- doc bodega_sales_v1 (equipo-07…) pesa 499 KB (límite 200 KB)
