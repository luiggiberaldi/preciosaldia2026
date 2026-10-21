-- STAGING ONLY — 011: owner proof para generate_pairing_token (solo reclamo por código de la caja)
-- Intended project ref: tdfcpwctvumbdjmifypd
-- Estado: BORRADOR. NO APLICADO. Requiere aprobación explícita.
-- Do NOT run against production.
--
-- Modelo:
--   * generate_pairing_token solo lo ejecuta el dueño registrado (owner_auth_id = auth.uid()).
--     Nunca asigna dueño, ni siquiera si la caja no tiene dueño (falla).
--   * La caja genera un código de reclamo de un solo uso con create_owner_claim_code.
--     Solo se guarda su SHA-256; expira en 10 minutos; tras 5 fallos se bloquea.
--   * claim_owner_device es el ÚNICO camino para fijar owner_auth_id. Uso único.
--   * El guardia e2e-% se mantiene (solo staging).
--
-- Supuesto no verificado: la caja tiene una sesión anónima propia para llamar a
-- create_owner_claim_code. Confirmar en el flujo de arranque del POS antes de aplicar.

BEGIN;

ALTER TABLE public.device_pairings
    ADD COLUMN IF NOT EXISTS claim_code_hash text,
    ADD COLUMN IF NOT EXISTS claim_code_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS claim_failed_attempts integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.create_owner_claim_code(p_device_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_code text;
    v_device text := trim(p_device_id);
    v_updated integer;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;

    IF v_device IS NULL OR v_device NOT LIKE 'e2e-%' THEN
        RAISE EXCEPTION 'Identificador sintético de staging inválido';
    END IF;

    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

    -- Solo una caja SIN dueño puede emitir un código nuevo.
    UPDATE public.device_pairings
    SET claim_code_hash = encode(digest(v_code, 'sha256'), 'hex'),
        claim_code_expires_at = now() + interval '10 minutes',
        claim_failed_attempts = 0
    WHERE primary_device_id = v_device
      AND owner_auth_id IS NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
        RAISE EXCEPTION 'Caja no registrada o ya tiene dueño';
    END IF;

    RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_owner_device(p_device_id text, p_code text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_owner uuid := auth.uid();
    v_device text := trim(p_device_id);
    v_row public.device_pairings%ROWTYPE;
BEGIN
    IF v_owner IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Sesión no autenticada.');
    END IF;

    SELECT * INTO v_row
    FROM public.device_pairings
    WHERE primary_device_id = v_device
    FOR UPDATE;

    IF NOT FOUND OR v_row.claim_code_hash IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'No hay un código de reclamo activo para esta caja.');
    END IF;

    IF v_row.claim_failed_attempts >= 5 THEN
        RETURN json_build_object('success', false, 'message', 'Demasiados intentos. Genera un código nuevo en la caja.');
    END IF;

    IF v_row.claim_code_expires_at <= now() THEN
        RETURN json_build_object('success', false, 'message', 'El código expiró. Genera uno nuevo en la caja.');
    END IF;

    IF v_row.claim_code_hash <> encode(digest(upper(trim(p_code)), 'sha256'), 'hex') THEN
        UPDATE public.device_pairings
        SET claim_failed_attempts = claim_failed_attempts + 1
        WHERE id = v_row.id;
        RETURN json_build_object('success', false, 'message', 'Código incorrecto.');
    END IF;

    IF v_row.owner_auth_id IS NOT NULL AND v_row.owner_auth_id <> v_owner THEN
        RETURN json_build_object('success', false, 'message', 'Esta caja ya tiene un dueño registrado.');
    END IF;

    -- Uso único: se borra el hash al canjear.
    UPDATE public.device_pairings
    SET owner_auth_id = v_owner,
        claim_code_hash = NULL,
        claim_code_expires_at = NULL,
        claim_failed_attempts = 0
    WHERE id = v_row.id;

    RETURN json_build_object('success', true, 'primary_device_id', v_device);
END;
$$;

-- generate_pairing_token: SOLO el dueño registrado. Nunca reclama ni asigna dueño.
CREATE OR REPLACE FUNCTION public.generate_pairing_token(p_device_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_token TEXT;
    v_owner UUID := auth.uid();
    v_device TEXT := trim(p_device_id);
    v_updated INTEGER;
BEGIN
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;

    IF v_device IS NULL OR v_device NOT LIKE 'e2e-%' THEN
        RAISE EXCEPTION 'Identificador sintético de staging inválido';
    END IF;

    v_token := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 24));

    UPDATE public.device_pairings
    SET pairing_token = NULL,
        token_hash = encode(digest(v_token, 'sha256'), 'hex'),
        token_expires_at = now() + interval '5 minutes',
        token_used_at = NULL,
        monitor_device_id = NULL,
        monitor_auth_id = NULL,
        paired_at = NULL,
        revoked_at = NULL
    WHERE primary_device_id = v_device
      AND owner_auth_id = v_owner;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
        RAISE EXCEPTION 'No autorizado para esta caja';
    END IF;

    RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.create_owner_claim_code(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_owner_device(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_pairing_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_owner_claim_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_owner_device(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_pairing_token(text) TO authenticated;

COMMIT;
