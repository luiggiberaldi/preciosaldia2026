-- STAGING ONLY — 006: revocar el vínculo cancela las órdenes pendientes (Fase 2)
-- Intended project ref: tdfcpwctvumbdjmifypd
-- Do NOT run against production. NOT APPLIED YET: requires a private staging
-- backup and explicit approval before execution.
--
-- Why: unpair_monitor (002) marca el vínculo como revocado, pero deja las
-- órdenes en status 'pending'. Aunque el receptor de la caja revalida la
-- autorización antes de aplicar, una orden emitida antes de la revocación
-- seguía en estado 'pending' y podía reclamarse después. Aquí la revocación
-- y la cancelación ocurren en la misma transacción.
--
-- Mantiene el guardia e2e-% de 002 y el acceso restringido a authenticated.

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

    -- Cancelar en la misma transacción: ninguna orden emitida antes de la
    -- revocación puede aplicarse después.
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
