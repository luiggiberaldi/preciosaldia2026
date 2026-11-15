-- Plan de egress Realtime, F5 (decisión D4) — 2026-11-14.
--
-- `useAutoBackup` escucha `backup_requests` por Realtime como «camino primario»,
-- pero la tabla nunca estuvo en la publicación `supabase_realtime`: el canal no
-- recibía nada y los respaldos pedidos desde el supervisor esperaban al polling
-- de 5 minutos. La tabla es chica (43 filas en total, 0 en los últimos 7 días
-- al 14-nov-2026), así que agregarla no genera egress apreciable.
--
-- `licenses` NO se agrega a propósito: el heartbeat la actualiza cada pocos
-- minutos y cada actualización se volvería egress de Realtime. Sus canales se
-- quitaron del código; el estado se verifica con el heartbeat y al volver a la
-- pestaña.
--
-- Idempotente: se puede correr más de una vez.

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'backup_requests'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.backup_requests;
    END IF;
END $$;
