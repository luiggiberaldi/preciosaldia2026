-- STAGING ONLY — monitor identity fix (003)
-- Intended project ref: tdfcpwctvumbdjmifypd
-- Do NOT run against production.

BEGIN;

-- A monitor ID is unique only among ACTIVE pairings. Revoked rows keep history.
DROP INDEX IF EXISTS public.device_pairings_monitor_device_id_key;
CREATE UNIQUE INDEX device_pairings_monitor_device_id_key
    ON public.device_pairings (monitor_device_id)
    WHERE revoked_at IS NULL AND monitor_device_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.pair_monitor_device(p_token TEXT, p_monitor_device_id TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_monitor UUID := auth.uid();
    v_monitor_id TEXT := trim(p_monitor_device_id);
    v_pairing public.device_pairings%ROWTYPE;
BEGIN
    IF v_monitor IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Sesión no autenticada.');
    END IF;

    -- Monitor IDs are random per profile (mon-…) or synthetic E2E (e2e-…).
    IF v_monitor_id IS NULL
       OR length(v_monitor_id) < 8
       OR length(v_monitor_id) > 160
       OR (v_monitor_id NOT LIKE 'mon-%' AND v_monitor_id NOT LIKE 'e2e-%') THEN
        RETURN json_build_object('success', false, 'message', 'Identificador de monitor inválido.');
    END IF;

    -- A device cannot be both the box (primary) and a monitor.
    IF EXISTS (SELECT 1 FROM public.device_pairings WHERE primary_device_id = v_monitor_id) THEN
        RETURN json_build_object('success', false, 'message', 'Este dispositivo ya es una caja.');
    END IF;

    IF p_token IS NULL OR length(trim(p_token)) < 16 OR length(trim(p_token)) > 64 THEN
        RETURN json_build_object('success', false, 'message', 'Código inválido.');
    END IF;

    SELECT *
    INTO v_pairing
    FROM public.device_pairings
    WHERE token_hash = encode(digest(upper(trim(p_token)), 'sha256'), 'hex')
      AND token_expires_at > now()
      AND token_used_at IS NULL
      AND revoked_at IS NULL
      AND primary_device_id LIKE 'e2e-%'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'El código expiró o ya fue utilizado.');
    END IF;

    IF v_pairing.monitor_auth_id IS NOT NULL
       AND v_pairing.monitor_auth_id <> v_monitor THEN
        RETURN json_build_object('success', false, 'message', 'El vínculo ya está ocupado.');
    END IF;

    BEGIN
        UPDATE public.device_pairings
        SET monitor_device_id = v_monitor_id,
            monitor_auth_id = v_monitor,
            pairing_token = NULL,
            token_hash = NULL,
            token_used_at = now(),
            paired_at = now()
        WHERE id = v_pairing.id;
    EXCEPTION WHEN unique_violation THEN
        RETURN json_build_object('success', false, 'message', 'Este monitor ya está vinculado a otra caja.');
    END;

    RETURN json_build_object(
        'success', true,
        'primary_device_id', v_pairing.primary_device_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.pair_monitor_device(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pair_monitor_device(TEXT, TEXT) TO authenticated;

COMMIT;
