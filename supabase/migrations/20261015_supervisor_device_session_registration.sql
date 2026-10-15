-- Registro server-side de la identidad del dispositivo principal.
-- Aplicar solo en el proyecto de producción:
-- sodgzkablshladvbtnes.supabase.co

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
            'message', 'Se requiere una sesión activa.'
        );
    END IF;

    IF v_device IS NULL OR length(v_device) < 8 OR length(v_device) > 160 THEN
        RETURN json_build_object(
            'success', false,
            'code', 'INVALID_DEVICE_ID',
            'message', 'Identificador de dispositivo inválido.'
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
GRANT EXECUTE ON FUNCTION public.register_device_session(text) TO authenticated, service_role;

COMMIT;
