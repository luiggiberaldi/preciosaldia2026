-- STAGING ONLY (tdfcpwctvumbdjmifypd.supabase.co).
-- Nunca ejecutar contra producción (sodgzkablshladvbtnes.supabase.co).
-- Registra la sesión de la caja sin abrir INSERT directo sobre device_sessions.

BEGIN;

CREATE OR REPLACE FUNCTION public.register_device_session(p_device_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_owner uuid := auth.uid();
    v_device text := NULLIF(trim(p_device_id), '');
    v_existing uuid;
BEGIN
    IF v_owner IS NULL THEN
        RETURN json_build_object(
            'success', false,
            'code', 'UNAUTHENTICATED',
            'message', 'Sesión no autenticada.'
        );
    END IF;

    IF v_device IS NULL OR v_device NOT LIKE 'e2e-%' THEN
        RETURN json_build_object(
            'success', false,
            'code', 'INVALID_STAGING_DEVICE_ID',
            'message', 'Identificador sintético de staging inválido.'
        );
    END IF;

    SELECT user_id
      INTO v_existing
      FROM public.device_sessions
     WHERE device_id = v_device;

    IF FOUND AND v_existing <> v_owner THEN
        RETURN json_build_object(
            'success', false,
            'code', 'DEVICE_SESSION_CONFLICT',
            'message', 'Esta caja ya está vinculada a otra sesión.'
        );
    END IF;

    INSERT INTO public.device_sessions (device_id, user_id, first_seen, last_seen)
    VALUES (v_device, v_owner, now(), now())
    ON CONFLICT (device_id) DO UPDATE
        SET last_seen = now()
        WHERE public.device_sessions.user_id = v_owner;

    RETURN json_build_object(
        'success', true,
        'device_id', v_device
    );
END;
$$;

REVOKE ALL ON FUNCTION public.register_device_session(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_device_session(text) TO authenticated;

COMMIT;
