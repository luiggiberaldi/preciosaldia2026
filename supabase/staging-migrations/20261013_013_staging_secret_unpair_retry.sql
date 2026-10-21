-- STAGING ONLY — 013: secreto renovable y revocación idempotente
-- Intended project ref: tdfcpwctvumbdjmifypd
-- Do NOT run against production. APPLIED to staging (tdfcpwctvumbdjmifypd).
--
-- Complementa 012:
--   * una nueva vinculación invalida cualquier secreto anterior;
--   * unpair_monitor_with_secret es idempotente si se perdió la respuesta;
--   * revocar y cancelar órdenes pending es una sola transacción.

-- La RPC clásica sigue disponible para compatibilidad, pero cualquier nueva
-- vinculación borra el secreto anterior. La RPC con secreto lo vuelve a fijar
-- inmediatamente después, en la misma transacción envolvente.
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
    IF v_monitor_id IS NULL OR length(v_monitor_id) < 8 OR length(v_monitor_id) > 160
       OR (v_monitor_id NOT LIKE 'mon-%' AND v_monitor_id NOT LIKE 'e2e-%') THEN
        RETURN json_build_object('success', false, 'message', 'Identificador de monitor inválido.');
    END IF;
    IF EXISTS (SELECT 1 FROM public.device_pairings WHERE primary_device_id = v_monitor_id) THEN
        RETURN json_build_object('success', false, 'message', 'Este dispositivo ya es una caja.');
    END IF;
    IF p_token IS NULL OR length(trim(p_token)) < 16 OR length(trim(p_token)) > 64 THEN
        RETURN json_build_object('success', false, 'message', 'Código inválido.');
    END IF;
    SELECT * INTO v_pairing FROM public.device_pairings
    WHERE token_hash = encode(digest(upper(trim(p_token)), 'sha256'), 'hex')
      AND token_expires_at > now() AND token_used_at IS NULL AND revoked_at IS NULL
      AND primary_device_id LIKE 'e2e-%'
    FOR UPDATE;
    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'El código expiró o ya fue utilizado.');
    END IF;
    IF v_pairing.monitor_auth_id IS NOT NULL AND v_pairing.monitor_auth_id <> v_monitor THEN
        RETURN json_build_object('success', false, 'message', 'El vínculo ya está ocupado.');
    END IF;
    BEGIN
        UPDATE public.device_pairings
        SET monitor_device_id = v_monitor_id,
            monitor_auth_id = v_monitor,
            monitor_secret_hash = NULL,
            pairing_token = NULL,
            token_hash = NULL,
            token_used_at = now(),
            paired_at = now()
        WHERE id = v_pairing.id;
    EXCEPTION WHEN unique_violation THEN
        RETURN json_build_object('success', false, 'message', 'Este monitor ya está vinculado a otra caja.');
    END;
    RETURN json_build_object('success', true, 'primary_device_id', v_pairing.primary_device_id);
END;
$$;

-- La recuperación tras una respuesta perdida busca el vínculo ya creado con el
-- mismo monitor y secreto, sin permitir que el secreto viejo sobreviva a una
-- vinculación posterior (pair_monitor_device limpia su huella).
CREATE OR REPLACE FUNCTION public.pair_monitor_device_with_secret(
    p_token TEXT,
    p_monitor_device_id TEXT,
    p_secret TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_result JSON;
    v_monitor_id TEXT := trim(p_monitor_device_id);
    v_secret_hash TEXT;
    v_existing_device TEXT;
BEGIN
    IF auth.uid() IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Sesión no autenticada.');
    END IF;
    IF p_secret IS NULL OR length(p_secret) < 32 OR length(p_secret) > 256 THEN
        RETURN json_build_object('success', false, 'message', 'Secreto inválido.');
    END IF;
    v_secret_hash := encode(digest(p_secret, 'sha256'), 'hex');

    v_result := public.pair_monitor_device(p_token, p_monitor_device_id);
    IF (v_result->>'success')::boolean THEN
        UPDATE public.device_pairings
        SET monitor_secret_hash = v_secret_hash
        WHERE primary_device_id = v_result->>'primary_device_id'
          AND monitor_auth_id = auth.uid()
          AND monitor_device_id = v_monitor_id;
        RETURN v_result;
    END IF;

    -- Idempotencia solo para la misma sesión, monitor, secreto y vínculo activo.
    SELECT primary_device_id INTO v_existing_device
    FROM public.device_pairings
    WHERE monitor_device_id = v_monitor_id
      AND monitor_auth_id = auth.uid()
      AND revoked_at IS NULL
      AND monitor_secret_hash = v_secret_hash;
    IF FOUND THEN
        RETURN json_build_object('success', true, 'primary_device_id', v_existing_device);
    END IF;
    RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION public.unpair_monitor_with_secret(p_device_id TEXT, p_secret TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_device TEXT := trim(p_device_id);
    v_secret_hash TEXT;
    v_updated INTEGER;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;
    IF v_device IS NULL OR v_device NOT LIKE 'e2e-%' THEN
        RAISE EXCEPTION 'Identificador sintético de staging inválido';
    END IF;
    IF p_secret IS NULL OR length(p_secret) < 32 OR length(p_secret) > 256 THEN
        RAISE EXCEPTION 'No autorizado o vínculo inexistente';
    END IF;
    v_secret_hash := encode(digest(p_secret, 'sha256'), 'hex');

    -- La huella se conserva después de revocar para admitir reintentos cuando
    -- la respuesta anterior se perdió. Solo quien tenga el secreto puede repetir.
    IF EXISTS (
        SELECT 1 FROM public.device_pairings
        WHERE primary_device_id = v_device
          AND revoked_at IS NOT NULL
          AND monitor_secret_hash = v_secret_hash
    ) THEN
        RETURN true;
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
      AND revoked_at IS NULL
      AND monitor_secret_hash = v_secret_hash;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
        RAISE EXCEPTION 'No autorizado o vínculo inexistente';
    END IF;

    -- La revocación y cancelación de órdenes son atómicas como en migration 006.
    UPDATE public.supervisor_commands
    SET status = 'failed',
        error_message = 'REVOKED_BEFORE_ACK',
        updated_at = now()
    WHERE target_device_id = v_device
      AND status = 'pending';

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.pair_monitor_device(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pair_monitor_device(TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.unpair_monitor_with_secret(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.unpair_monitor_with_secret(TEXT, TEXT) TO authenticated;
