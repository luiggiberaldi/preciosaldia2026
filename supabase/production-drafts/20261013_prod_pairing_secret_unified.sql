-- PRODUCTION DRAFT — secreto por caja y desvinculación idempotente (unificado)
-- Target: sodgzkablshladvbtnes (Precios al Día production).
-- Status: NOT APPLIED. Requires a verified backup, staging rehearsal with
-- production-format fixtures (mon-<uuid>, PDA-...), and explicit approval.
--
-- Diferencias frente a staging 013:
--   * Sin filtro 'e2e-%': acepta IDs reales de producción (PDA-... y mon-...).
--   * generate_pairing_token NO se toca aquí; el owner-proof va en su propio borrador.
--   * Sin e2e_delete_pairing (solo staging).
--
-- Grant-neutral: CREATE OR REPLACE conserva dueño y EXECUTE para authenticated.

BEGIN;

ALTER TABLE public.device_pairings ADD COLUMN IF NOT EXISTS monitor_secret_hash text;

-- Una nueva vinculación invalida cualquier huella de secreto anterior.
CREATE OR REPLACE FUNCTION public.pair_monitor_device(p_token text, p_monitor_device_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_monitor uuid := auth.uid();
    v_monitor_id text := trim(p_monitor_device_id);
    v_pairing public.device_pairings%ROWTYPE;
BEGIN
    IF v_monitor IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Sesión no autenticada.');
    END IF;

    IF v_monitor_id IS NULL
       OR length(v_monitor_id) < 8
       OR length(v_monitor_id) > 160
       OR NOT (
            v_monitor_id ~ '^PDA-(V2-)?[0-9A-Fa-f]{8,64}$'
         OR v_monitor_id ~ '^mon-[0-9A-Za-z-]{8,156}$'
       ) THEN
        RETURN json_build_object('success', false, 'message', 'Identificador de monitor inválido.');
    END IF;

    IF p_token IS NULL OR length(trim(p_token)) < 16 OR length(trim(p_token)) > 64 THEN
        RETURN json_build_object('success', false, 'message', 'Código inválido.');
    END IF;

    SELECT * INTO v_pairing
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
    SET monitor_device_id = v_monitor_id,
        monitor_auth_id = v_monitor,
        monitor_secret_hash = NULL,
        pairing_token = NULL,
        token_hash = NULL,
        token_used_at = now(),
        paired_at = now()
    WHERE id = v_pairing.id;

    RETURN json_build_object('success', true, 'primary_device_id', v_pairing.primary_device_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.pair_monitor_device_with_secret(
    p_token text,
    p_monitor_device_id text,
    p_secret text
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_result json;
    v_monitor_id text := trim(p_monitor_device_id);
    v_secret_hash text;
    v_existing_device text;
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

    -- Recuperación tras respuesta perdida: misma sesión, monitor, secreto y vínculo activo.
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
$function$;

CREATE OR REPLACE FUNCTION public.unpair_monitor_with_secret(p_device_id text, p_secret text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor uuid := auth.uid();
    v_device text := trim(p_device_id);
    v_secret_hash text;
    v_updated integer;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;
    IF v_device IS NULL OR length(v_device) < 8 OR length(v_device) > 160 THEN
        RAISE EXCEPTION 'Identificador de caja inválido';
    END IF;
    IF p_secret IS NULL OR length(p_secret) < 32 OR length(p_secret) > 256 THEN
        RAISE EXCEPTION 'No autorizado o vínculo inexistente';
    END IF;
    v_secret_hash := encode(digest(p_secret, 'sha256'), 'hex');

    -- Idempotente: la huella se conserva tras revocar para reintentos.
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

    -- Revocación y cancelación de órdenes en la misma transacción.
    UPDATE public.supervisor_commands
    SET status = 'failed',
        error_message = 'REVOKED_BEFORE_ACK',
        updated_at = now()
    WHERE target_device_id = v_device
      AND status = 'pending';

    RETURN true;
END;
$function$;

REVOKE ALL ON FUNCTION public.pair_monitor_device_with_secret(text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.pair_monitor_device_with_secret(text, text, text) TO authenticated;
REVOKE ALL ON FUNCTION public.unpair_monitor_with_secret(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unpair_monitor_with_secret(text, text) TO authenticated;

COMMIT;
