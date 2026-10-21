-- STAGING ONLY (tdfcpwctvumbdjmifypd). Nunca ejecutar contra producción (sodgzkablshladvbtnes).
-- Migración 017: registro de device_sessions desde la caja, vía RPC.
--
-- Motivo: device_sessions solo permite SELECT a authenticated (migración 016).
-- La caja no puede insertar directamente; esta función escribe la fila en nombre
-- del usuario autenticado.
--
-- Reglas:
--   * Solo sesiones autenticadas (auth.uid() no nulo).
--   * Solo device_id sintéticos e2e-% en staging.
--   * La caja debe existir en device_pairings (la fila la crea register_device_pairing / 012).
--   * Si el device_id ya tiene dueño distinto en device_sessions, se rechaza (no se reasigna).
--   * Idempotente para el mismo dueño.

BEGIN;

CREATE OR REPLACE FUNCTION public.register_device_session(p_device_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_owner uuid := auth.uid();
    v_device text := trim(p_device_id);
    v_existing uuid;
BEGIN
    IF v_owner IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Sesión no autenticada.');
    END IF;

    IF v_device IS NULL OR v_device NOT LIKE 'e2e-%' THEN
        RETURN json_build_object('success', false, 'message', 'Identificador sintético de staging inválido.');
    END IF;

    IF NOT EXISTS (SELECT 1 FROM public.device_pairings WHERE primary_device_id = v_device) THEN
        RETURN json_build_object('success', false, 'message', 'Caja no registrada.');
    END IF;

    SELECT user_id INTO v_existing
    FROM public.device_sessions
    WHERE device_id = v_device;

    IF FOUND AND v_existing <> v_owner THEN
        RETURN json_build_object('success', false, 'message', 'Esta caja ya está vinculada a otra sesión.');
    END IF;

    INSERT INTO public.device_sessions (device_id, user_id, first_seen, last_seen)
    VALUES (v_device, v_owner, now(), now())
    ON CONFLICT (device_id) DO UPDATE
        SET last_seen = now()
        WHERE public.device_sessions.user_id = v_owner;

    RETURN json_build_object('success', true, 'device_id', v_device);
END;
$$;

REVOKE ALL ON FUNCTION public.register_device_session(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_device_session(text) TO authenticated;

COMMIT;
