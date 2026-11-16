-- Plan de egress Realtime, F4 — 2026-11-14.
--
-- Realtime reenviaba la fila COMPLETA de `sync_documents` (hasta ~400 KB) a cada
-- supervisor conectado en cada escritura: 388 MB el 11-nov-2026. Esta migración
-- crea un canal de AVISOS livianos: `sync_document_events` guarda una fila por
-- documento (equipo, doc_id, fecha, tamaño; ~150 bytes) que un trigger actualiza
-- en cada escritura de `sync_documents`. El supervisor nuevo escucha SOLO esta
-- tabla y descarga por PostgREST, agrupando las ráfagas, únicamente los docs que
-- cambiaron y solo con la pestaña visible.
--
-- `sync_documents` SIGUE en la publicación a propósito: los supervisores sin
-- actualizar la escuchan y no deben quedar ciegos. Realtime solo cobra a quien
-- está suscrito, así que el ahorro llega en cuanto cada supervisor se actualiza.
-- Quitarla de la publicación es un paso aparte, cuando no quede ninguno viejo.
--
-- Idempotente: se puede correr más de una vez.

CREATE TABLE IF NOT EXISTS public.sync_document_events (
    device_id   text        NOT NULL,
    collection  text        NOT NULL,
    doc_id      text        NOT NULL,
    updated_at  timestamptz NOT NULL,
    -- Tamaño almacenado del `data` (pg_column_size: comprimido, barato de medir).
    -- Sirve a la alarma diaria para saber QUÉ doc creció (F6).
    bytes       integer     NOT NULL DEFAULT 0,
    PRIMARY KEY (device_id, collection, doc_id)
);

COMMENT ON TABLE public.sync_document_events IS
    'Aviso liviano por documento de sync_documents (egress F4). Lo escribe solo el trigger sync_documents_emit_event; el supervisor lo escucha por Realtime.';

ALTER TABLE public.sync_document_events ENABLE ROW LEVEL SECURITY;

-- Nadie escribe directo: solo el trigger (SECURITY DEFINER).
REVOKE ALL ON TABLE public.sync_document_events FROM anon;
REVOKE ALL ON TABLE public.sync_document_events FROM authenticated;
GRANT SELECT ON TABLE public.sync_document_events TO authenticated;

-- Misma lectura que `sync_documents` para el supervisor (sesión Auth del dueño
-- o del monitor vinculado, vínculo no revocado).
DROP POLICY IF EXISTS "sync_document_events_supervisor_read" ON public.sync_document_events;
CREATE POLICY "sync_document_events_supervisor_read"
    ON public.sync_document_events
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.device_pairings dp
            WHERE dp.primary_device_id = sync_document_events.device_id
              AND dp.revoked_at IS NULL
              AND dp.monitor_auth_id IS NOT NULL
              AND (dp.owner_auth_id = auth.uid() OR dp.monitor_auth_id = auth.uid())
        )
    );

CREATE OR REPLACE FUNCTION public.sync_documents_emit_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    INSERT INTO public.sync_document_events (device_id, collection, doc_id, updated_at, bytes)
    VALUES (
        NEW.device_id,
        NEW.collection,
        NEW.doc_id,
        COALESCE(NEW.updated_at, now()),
        COALESCE(pg_column_size(NEW.data), 0)
    )
    ON CONFLICT (device_id, collection, doc_id) DO UPDATE
        SET updated_at = EXCLUDED.updated_at,
            bytes = EXCLUDED.bytes;
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.sync_documents_emit_event() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_documents_emit_event() FROM anon;
REVOKE ALL ON FUNCTION public.sync_documents_emit_event() FROM authenticated;

DROP TRIGGER IF EXISTS sync_documents_emit_event ON public.sync_documents;
CREATE TRIGGER sync_documents_emit_event
    AFTER INSERT OR UPDATE OF data, updated_at ON public.sync_documents
    FOR EACH ROW
    EXECUTE FUNCTION public.sync_documents_emit_event();

-- Sin trigger de DELETE a propósito: con RLS, Realtime no filtra los eventos
-- DELETE y mandaría la clave (equipo + doc_id) a todos los suscriptores. El
-- supervisor ignora los borrados igual (no hay tumbas por DELETE).

-- Relleno inicial con los documentos existentes.
INSERT INTO public.sync_document_events (device_id, collection, doc_id, updated_at, bytes)
SELECT device_id, collection, doc_id, COALESCE(updated_at, now()), COALESCE(pg_column_size(data), 0)
FROM public.sync_documents
ON CONFLICT (device_id, collection, doc_id) DO NOTHING;

DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename = 'sync_document_events'
    ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.sync_document_events;
    END IF;
END $$;
