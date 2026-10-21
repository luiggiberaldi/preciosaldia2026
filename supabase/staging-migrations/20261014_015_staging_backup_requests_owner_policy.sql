-- APLICADA EN STAGING el 2026-10-14 (historial: staging_015_backup_requests_owner_policy).
-- Respaldo previo: scratch/staging-backup-before-015.md
-- STAGING ONLY (tdfcpwctvumbdjmifypd). Nunca ejecutar contra producción (sodgzkablshladvbtnes).
--
-- Objetivo: que la app de escritorio (useAutoBackup) lea y actualice solo las
-- solicitudes de respaldo de SUS dispositivos, con sesión authenticated.
--
-- Modelo de acceso:
--   * La relación dispositivo -> dueño vive en public.device_pairings
--     (primary_device_id, owner_auth_id), fijada solo por claim_owner_device.
--   * authenticated no tiene SELECT sobre device_pairings; la pertenencia se comprueba
--     con public.owns_backup_device(device_id), SECURITY DEFINER y devuelve solo boolean.
--   * anon no recibe nada. PUBLIC sigue revocado.
--   * No se conceden INSERT ni DELETE: las solicitudes las crea el backend/servicio.
--   * Columnas actualizables: solo status, completed_at, error (las que usa la app).
--
-- Verificado en staging antes de aplicar (transacción revertida, con RAISE deliberado):
--   owner_auth_id es uuid; backup_requests.device_id es text; dueño A ve 1 fila y actualiza la suya,
--   no actualiza la del dueño B, no puede reasignar device_id; dueño B no ve filas de A; anon 42501.
-- Pendiente: prueba end-to-end con sesiones reales de la app (dos cuentas).

BEGIN;

-- authenticated no tiene SELECT sobre device_pairings, así que la política no puede
-- consultar esa tabla directamente. Esta función acotada devuelve solo true/false.
CREATE OR REPLACE FUNCTION public.owns_backup_device(p_device_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.device_pairings dp
        WHERE dp.primary_device_id = p_device_id
          AND dp.owner_auth_id = auth.uid()
    );
$$;

REVOKE ALL ON FUNCTION public.owns_backup_device(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owns_backup_device(text) TO authenticated;

-- Lectura: solo solicitudes de dispositivos cuyo dueño es el usuario autenticado.
DROP POLICY IF EXISTS backup_requests_owner_select ON public.backup_requests;
CREATE POLICY backup_requests_owner_select
    ON public.backup_requests
    FOR SELECT
    TO authenticated
    USING (public.owns_backup_device(device_id));

-- Actualización: solo para el dueño, y solo para cambiar estado y motivo.
-- El WITH CHECK repite la pertenencia para impedir reasignar device_id.
DROP POLICY IF EXISTS backup_requests_owner_update ON public.backup_requests;
CREATE POLICY backup_requests_owner_update
    ON public.backup_requests
    FOR UPDATE
    TO authenticated
    USING (public.owns_backup_device(device_id))
    WITH CHECK (public.owns_backup_device(device_id));

-- Restringe columnas actualizables a las que usa la app.
REVOKE UPDATE ON TABLE public.backup_requests FROM authenticated;
GRANT UPDATE (status, completed_at, error) ON TABLE public.backup_requests TO authenticated;

-- Lectura: solo las columnas que consulta useAutoBackup.
REVOKE SELECT ON TABLE public.backup_requests FROM authenticated;
GRANT SELECT (id, device_id, status, created_at, completed_at, error) ON TABLE public.backup_requests TO authenticated;

COMMIT;

