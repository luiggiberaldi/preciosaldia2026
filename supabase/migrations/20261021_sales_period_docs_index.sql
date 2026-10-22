-- Fase 4 (plan 2026-10-20): adelgazar la sincronización de ventas.
-- bodega_sales_v1 deja de publicarse como documento monolítico y se parte en
-- documentos por periodo:
--   bodega_sales_v1:<YYYY-MM>   (+ shards #N cuando el mes es enorme)
--   bodega_sales_v1:recent      (ventas sin fecha válida)
-- El doc legacy `bodega_sales_v1` queda como histórico legible y NO se
-- reescribe (migración perezosa al escribir).
--
-- ⚠️ ESTE ARCHIVO NO SE EJECUTA EN PRODUCCIÓN POR ESTE PLAN. Su aplicación
-- requiere aprobación explícita aparte, con backup previo y verificación
-- posterior (regla 7 del plan; igual que 20261020_supervisor_command_server_clock.sql).

-- 1) Índice (device_id, collection, doc_id) si falta.
--    El upsert del cliente usa onConflict: 'device_id,collection,doc_id', así
--    que debe existir una restricción/índice UNIQUE sobre esas tres columnas.
--    Verificación previa recomendada antes de aplicar:
--      SELECT indexname, indexdef FROM pg_indexes
--      WHERE schemaname = 'public' AND tablename = 'sync_documents';
CREATE UNIQUE INDEX IF NOT EXISTS sync_documents_device_collection_doc_uk
    ON public.sync_documents (device_id, collection, doc_id);

-- 2) Índice de apoyo para la lectura de la familia por prefijo
--    (doc_id LIKE 'bodega_sales_v1:%') que usan el monitor y el pull inicial.
CREATE INDEX IF NOT EXISTS sync_documents_device_doc_idx
    ON public.sync_documents (device_id, doc_id);

-- 3) Verificación de atomicidad del upsert (no cambia nada; solo evidencia):
--    upsert con on_conflict sobre la única de (device_id, collection, doc_id)
--    es atómico por fila (INSERT ... ON CONFLICT DO UPDATE). Con la familia
--    por periodos cada upsert toca UN documento (periodo/shard), no el blob
--    completo, por lo que un statement timeout deja de ser catastrófico.

-- 4) Limpieza OPCIONAL del monolito legacy (NO ejecutar sin aprobación):
--    tras confirmar que todos los dispositivos publican por periodos, el doc
--    legacy congelado puede reducirse para que ninguna fila supere el tope.
--    Dejar la decisión y la ventana al dueño de los datos:
-- UPDATE public.sync_documents
--    SET data = jsonb_build_object('schemaVersion', 1, 'payload', '[]'::jsonb, 'updatedAt', now()::text)
--  WHERE doc_id = 'bodega_sales_v1'
--    AND (pg_column_size(data) > 500000);
