-- ─────────────────────────────────────────────────────────────────────────────
-- DELETE propio del dispositivo sobre sync_documents (retiro del doc legacy de
-- ventas).
--
-- Contexto: la familia `bodega_sales_v1` se publica partida en shards
-- (`bodega_sales_v1:<YYYY-MM>[#N]`), pero la fila legacy `bodega_sales_v1` con
-- el historial completo quedaba como peso muerto tras la migración perezosa —
-- medida en producción el 2026-10-24: 5.29 MB / 3.345 ventas, sobre el límite
-- de ~1 MB de Realtime (eventos 413) y el techo de 500 KB de syncDocBudget.
-- El cliente la retira una sola vez por dispositivo tras publicar los shards
-- que cubren el historial (verificado: 3.345/3.345 ids en los shards, 0
-- faltantes). Se BORRA la fila; no se escribe `[]`, que cualquier lector
-- interpretaría como «vaciar todas las ventas».
--
-- Las policies existentes solo daban SELECT/UPDATE/INSERT a las filas propias
-- (`is_own_device_row`); esta agrega DELETE con el mismo criterio (una fila de
-- sync_documents solo es visible para su dispositivo y sus monitores pareados,
-- así que borrarla no puede afectar a terceros). Idempotente.
-- ─────────────────────────────────────────────────────────────────────────────

DROP POLICY IF EXISTS "device_delete_own_sync_doc" ON public.sync_documents;
CREATE POLICY "device_delete_own_sync_doc" ON public.sync_documents
    FOR DELETE
    USING (is_own_device_row(device_id));

-- Verificación:
--   SELECT policyname, cmd FROM pg_policies
--    WHERE tablename = 'sync_documents' AND policyname = 'device_delete_own_sync_doc';
-- Debe devolver una fila con cmd = 'DELETE'.
