-- Compatibilidad de producción para desvincular el Supervisor desde la caja
-- o desde el celular vinculado. No modifica ventas, productos ni backups.

BEGIN;

-- Generación idempotente del QR: reutiliza la fila existente de la caja y
-- evita el error técnico 23505 por primary_device_id duplicado.
CREATE OR REPLACE FUNCTION public.generate_pairing_token(p_device_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_token text;
    v_hash text;
    v_owner uuid := auth.uid();
    v_device_id text := NULLIF(trim(p_device_id), '');
BEGIN
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;

    IF v_device_id IS NULL OR length(v_device_id) < 8 OR length(v_device_id) > 160 THEN
        RAISE EXCEPTION 'Identificador de dispositivo inválido';
    END IF;

    v_token := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 24));
    v_hash := encode(digest(v_token, 'sha256'), 'hex');

    INSERT INTO public.device_pairings (
        primary_device_id,
        owner_auth_id,
        token_hash,
        token_expires_at,
        created_at
    )
    VALUES (v_device_id, v_owner, v_hash, now() + interval '5 minutes', now())
    ON CONFLICT (primary_device_id) DO UPDATE
    SET pairing_token = NULL,
        token_hash = EXCLUDED.token_hash,
        token_expires_at = EXCLUDED.token_expires_at,
        token_used_at = NULL,
        monitor_device_id = NULL,
        monitor_auth_id = NULL,
        paired_at = NULL,
        revoked_at = NULL,
        owner_auth_id = EXCLUDED.owner_auth_id;

    RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_pairing_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_pairing_token(text) TO authenticated, service_role;

-- Un celular solo puede estar vinculado a una caja. Al volver a escanear un
-- QR, se limpia su vínculo anterior y se reutiliza sin duplicar la clave.
CREATE OR REPLACE FUNCTION public.pair_monitor_device(p_token text, p_monitor_device_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_monitor uuid := auth.uid();
    v_monitor_id text := NULLIF(trim(p_monitor_device_id), '');
    v_pairing public.device_pairings%ROWTYPE;
BEGIN
    IF v_monitor IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Sesión no autenticada.');
    END IF;

    IF p_token IS NULL OR length(trim(p_token)) < 16 OR length(trim(p_token)) > 64 THEN
        RETURN json_build_object('success', false, 'message', 'Código inválido.');
    END IF;

    IF v_monitor_id IS NULL OR length(v_monitor_id) < 8 OR length(v_monitor_id) > 160 THEN
        RETURN json_build_object('success', false, 'message', 'Identificador del celular inválido.');
    END IF;

    SELECT *
    INTO v_pairing
    FROM public.device_pairings
    WHERE token_hash = encode(digest(upper(trim(p_token)), 'sha256'), 'hex')
      AND token_expires_at > now()
      AND token_used_at IS NULL
      AND revoked_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'El código expiró o ya fue utilizado.');
    END IF;

    IF v_pairing.monitor_auth_id IS NOT NULL
       AND v_pairing.monitor_auth_id <> v_monitor THEN
        RETURN json_build_object('success', false, 'message', 'El vínculo ya está ocupado.');
    END IF;

    UPDATE public.device_pairings
    SET monitor_device_id = NULL,
        monitor_auth_id = NULL,
        token_used_at = NULL,
        paired_at = NULL,
        revoked_at = now()
    WHERE monitor_device_id = v_monitor_id
      AND id <> v_pairing.id;

    UPDATE public.device_pairings
    SET monitor_device_id = v_monitor_id,
        monitor_auth_id = v_monitor,
        pairing_token = NULL,
        token_hash = NULL,
        token_used_at = now(),
        paired_at = now()
    WHERE id = v_pairing.id;

    RETURN json_build_object(
        'success', true,
        'primary_device_id', v_pairing.primary_device_id
    );
END;
$$;

REVOKE ALL ON FUNCTION public.pair_monitor_device(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pair_monitor_device(text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.unpair_monitor(p_device_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor uuid := auth.uid();
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;

    UPDATE public.device_pairings
    SET monitor_device_id = NULL,
        monitor_auth_id = NULL,
        pairing_token = NULL,
        token_hash = NULL,
        token_expires_at = NULL,
        token_used_at = NULL,
        paired_at = NULL,
        revoked_at = now()
    WHERE (primary_device_id = trim(p_device_id)
           OR monitor_device_id = trim(p_device_id))
      AND (owner_auth_id = v_actor OR monitor_auth_id = v_actor)
      AND revoked_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No autorizado o vínculo inexistente';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.unpair_monitor(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unpair_monitor(text) TO authenticated, service_role;

COMMIT;
