-- STAGING ONLY — 007: código de reclamo del primer dueño (posesión física)
-- Intended project ref: tdfcpwctvumbdjmifypd
-- Do NOT run against production.
-- Applied to staging on 2026-10-13 after backup (scratch/staging-backup-before-007.md).
--
-- Modelo:
--   * La caja genera un código de reclamo de un solo uso, que solo muestra en
--     su pantalla. Se guarda solo su SHA-256 (claim_code_hash) y expira.
--   * El dueño lo canjea desde su cuenta con claim_owner_device(p_code). El
--     servidor valida hash, expiración y uso único, y solo entonces fija
--     owner_auth_id. Un dueño ya registrado no se puede reemplazar.
--   * generate_pairing_token ya NO reclama dueño: solo el dueño registrado
--     puede generar tokens de vinculación, incluso tras revocar.
--   * Límite de intentos fallidos por caja para frenar fuerza bruta.
--
-- Mantiene el guardia e2e-% de staging y no concede nada a anon ni PUBLIC.

ALTER TABLE public.device_pairings
    ADD COLUMN IF NOT EXISTS claim_code_hash text,
    ADD COLUMN IF NOT EXISTS claim_code_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS claim_failed_attempts integer NOT NULL DEFAULT 0;

-- La caja (vía RPC autenticada del dispositivo) genera el código de reclamo.
CREATE OR REPLACE FUNCTION public.create_owner_claim_code(p_device_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_code TEXT;
    v_device TEXT := trim(p_device_id);
    v_updated INTEGER;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;

    IF v_device IS NULL OR v_device NOT LIKE 'e2e-%' THEN
        RAISE EXCEPTION 'Identificador sintético de staging inválido';
    END IF;

    -- Sin dueño no hay reclamo previo; con dueño, nadie reclama de nuevo.
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

    UPDATE public.device_pairings
    SET claim_code_hash = encode(digest(v_code, 'sha256'), 'hex'),
        claim_code_expires_at = now() + interval '10 minutes',
        claim_failed_attempts = 0
    WHERE primary_device_id = v_device
      AND owner_auth_id IS NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
        -- Fila existente con dueño: no se puede emitir un reclamo nuevo.
        IF EXISTS (SELECT 1 FROM public.device_pairings WHERE primary_device_id = v_device) THEN
            RAISE EXCEPTION 'La caja ya tiene dueño registrado';
        END IF;
        INSERT INTO public.device_pairings (
            primary_device_id, claim_code_hash, claim_code_expires_at, created_at
        ) VALUES (
            v_device,
            encode(digest(v_code, 'sha256'), 'hex'),
            now() + interval '10 minutes',
            now()
        );
    END IF;

    RETURN v_code;
END;
$$;

-- El dueño canjea el código de la caja; fija owner_auth_id una sola vez.
CREATE OR REPLACE FUNCTION public.claim_owner_device(p_device_id TEXT, p_code TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_owner UUID := auth.uid();
    v_device TEXT := trim(p_device_id);
    v_row public.device_pairings%ROWTYPE;
BEGIN
    IF v_owner IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Sesión no autenticada.');
    END IF;

    IF v_device IS NULL OR v_device NOT LIKE 'e2e-%' THEN
        RETURN json_build_object('success', false, 'message', 'Identificador sintético de staging inválido.');
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

    -- Uso único: borrar el hash al canjear.
    UPDATE public.device_pairings
    SET owner_auth_id = v_owner,
        claim_code_hash = NULL,
        claim_code_expires_at = NULL,
        claim_failed_attempts = 0
    WHERE id = v_row.id;

    RETURN json_build_object('success', true, 'primary_device_id', v_device);
END;
$$;

-- generate_pairing_token: ya no reclama dueño. Solo el dueño registrado puede
-- generar un token de vinculación, incluso si el vínculo fue revocado.
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

REVOKE ALL ON FUNCTION public.create_owner_claim_code(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.claim_owner_device(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.generate_pairing_token(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_owner_claim_code(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_owner_device(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_pairing_token(TEXT) TO authenticated;
