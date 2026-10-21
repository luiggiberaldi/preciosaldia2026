-- STAGING ONLY (tdfcpwctvumbdjmifypd). Nunca ejecutar contra producción (sodgzkablshladvbtnes).
-- Migración 016: dueño autenticado para cloud_backups y sync_documents.
--
-- Modelo de identidad:
--   * public.device_sessions(device_id, user_id) registra qué usuario posee cada dispositivo.
--   * public.is_own_device_row(device_id) comprueba device_sessions.user_id = auth.uid().
--   * Las políticas usan solo esa función; no confían en un device_id del cliente sin validar.
--
-- Cambios:
--   * device_sessions: authenticated solo puede LEER sus propias filas (SELECT). No INSERT/UPDATE/DELETE.
--   * cloud_backups: SELECT/INSERT/UPDATE/DELETE para authenticated, solo filas propias.
--   * sync_documents: se elimina staging_authenticated_sync_read (e2e-%, permisiva) y se sustituye
--     por SELECT/INSERT/UPDATE/DELETE para authenticated, solo filas propias.
--   * anon no recibe nada nuevo. Los privilegios anon de producción NO se replican aquí.
--
-- Verificado antes de escribir este archivo (transacción revertida, RAISE deliberado):
--   dueño A ve solo su fila, no puede reasignarla a otra caja, dueño B no ve las de A (cloud_backups
--   y sync_documents con la política original quitada dentro de la transacción).

BEGIN;

GRANT SELECT ON TABLE public.device_sessions TO authenticated;
DROP POLICY IF EXISTS device_sessions_owner_select ON public.device_sessions;
CREATE POLICY device_sessions_owner_select
    ON public.device_sessions
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cloud_backups TO authenticated;
DROP POLICY IF EXISTS cloud_backups_owner_all ON public.cloud_backups;
CREATE POLICY cloud_backups_owner_all
    ON public.cloud_backups
    FOR ALL
    TO authenticated
    USING (public.is_own_device_row(device_id))
    WITH CHECK (public.is_own_device_row(device_id));

-- Sustituye la política permisiva de staging (e2e-%) por la de dueño.
DROP POLICY IF EXISTS staging_authenticated_sync_read ON public.sync_documents;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.sync_documents TO authenticated;
DROP POLICY IF EXISTS sync_documents_owner_all ON public.sync_documents;
CREATE POLICY sync_documents_owner_all
    ON public.sync_documents
    FOR ALL
    TO authenticated
    USING (public.is_own_device_row(device_id))
    WITH CHECK (public.is_own_device_row(device_id));

COMMIT;
