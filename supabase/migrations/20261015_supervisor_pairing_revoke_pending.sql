-- Permite cancelar un código pendiente desde la caja sin tocar un vínculo activo.
-- El token nunca se devuelve ni se escribe en auditoría.

BEGIN;

CREATE OR REPLACE FUNCTION public.revoke_pairing_token(p_device_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_device text := trim(p_device_id);
    v_caller uuid := auth.uid();
    v_updated integer;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Se requiere sesión activa para cancelar el código de vinculación';
    END IF;

    IF v_device IS NULL OR length(v_device) < 8 OR length(v_device) > 160 THEN
        RAISE EXCEPTION 'Identificador de dispositivo inválido';
    END IF;

    IF NOT public.is_own_device_row(v_device) THEN
        RAISE EXCEPTION 'No autorizado para cancelar este código de vinculación';
    END IF;

    UPDATE public.device_pairings
    SET pairing_token    = NULL,
        token_hash       = NULL,
        token_expires_at = NULL,
        token_used_at    = NULL,
        revoked_at       = now()
    WHERE primary_device_id = v_device
      AND monitor_device_id IS NULL
      AND token_used_at IS NULL
      AND revoked_at IS NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    RETURN v_updated > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.revoke_pairing_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.revoke_pairing_token(text) TO authenticated, service_role;

COMMIT;
