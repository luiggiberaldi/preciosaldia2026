-- STAGING ONLY — 009: código estable para órdenes canceladas por revocación
-- Intended project ref: tdfcpwctvumbdjmifypd
-- Do NOT run against production.
-- Applied to staging on 2026-10-13 (migration name: staging_009_stable_revoked_error_code).
--
-- Por qué: 006 y 008 comparaban una frase en español (error_message). Cualquier
-- cambio de redacción rompía la lectura. Ahora se usa el código REVOKED_BEFORE_ACK.
--
-- Qué hace:
--   * unpair_monitor (misma lógica que 006) escribe error_message = 'REVOKED_BEFORE_ACK'.
--   * La política staging_read_revoked_command_outcome (008) se recrea comparando ese código.
-- No cambia permisos: sigue sin acceso para anon/PUBLIC; la política sigue siendo SELECT.

CREATE OR REPLACE FUNCTION public.unpair_monitor(p_device_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_device TEXT := trim(p_device_id);
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;

    IF p_device_id IS NULL OR v_device NOT LIKE 'e2e-%' THEN
        RAISE EXCEPTION 'Identificador sintético de staging inválido';
    END IF;

    UPDATE public.device_pairings
    SET monitor_device_id = NULL,
        pairing_token = NULL,
        token_hash = NULL,
        token_expires_at = NULL,
        token_used_at = NULL,
        paired_at = NULL,
        revoked_at = now()
    WHERE primary_device_id = v_device
      AND monitor_auth_id = v_actor
      AND revoked_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No autorizado o vínculo inexistente';
    END IF;

    UPDATE public.supervisor_commands
    SET status = 'failed',
        error_message = 'REVOKED_BEFORE_ACK',
        updated_at = now()
    WHERE target_device_id = v_device
      AND status = 'pending';
END;
$$;

REVOKE ALL ON FUNCTION public.unpair_monitor(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unpair_monitor(TEXT) TO authenticated;

DROP POLICY IF EXISTS staging_read_revoked_command_outcome ON public.supervisor_commands;
CREATE POLICY staging_read_revoked_command_outcome
    ON public.supervisor_commands
    FOR SELECT
    TO authenticated
    USING (
        target_device_id LIKE 'e2e-%'
        AND status = 'failed'
        AND error_message = 'REVOKED_BEFORE_ACK'
        AND EXISTS (
            SELECT 1
            FROM public.device_pairings dp
            WHERE dp.primary_device_id = supervisor_commands.target_device_id
              AND (dp.owner_auth_id = auth.uid() OR dp.monitor_auth_id = auth.uid())
        )
    );
