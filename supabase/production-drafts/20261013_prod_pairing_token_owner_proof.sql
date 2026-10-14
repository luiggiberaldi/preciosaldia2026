-- PRODUCTION DRAFT — server-side owner proof for generate_pairing_token
-- Target: sodgzkablshladvbtnes (Precios al Día production).
-- Status: NOT APPLIED. Requires a verified backup, staging rehearsal, and explicit approval.
-- Not validated against a live database in this change; treat as a design draft.
--
-- Problem in the current definition (supabase_supervisor_auth_recovery.sql):
--   1. The UPDATE claims any row where owner_auth_id IS NULL, so the first
--      authenticated caller to request a token for a known box ID becomes its owner.
--   2. Rows with revoked_at IS NOT NULL are also taken over by any caller.
--   3. If no row exists, the function INSERTs one for any device ID.
--   Box IDs are guessable PDA fingerprints, so these paths allow hijacking.
--
-- Modelo (igual que staging 20261013_007):
--   * La caja genera un código de reclamo de un solo uso (solo en su pantalla).
--     Se guarda su SHA-256 en claim_code_hash y expira en 10 minutos.
--   * El dueño lo canjea con claim_owner_device(p_device_id, p_code). Solo
--     entonces se fija owner_auth_id. Uso único; tras 5 fallos se bloquea.
--   * generate_pairing_token no reclama dueño: solo el dueño registrado puede
--     generar tokens de vinculación, incluso tras revocar.
--   * Acepta IDs reales de producción: PDA-... (sin guardia e2e-%).
--
-- Requiere: columnas claim_* en device_pairings (ver ALTER abajo).
-- Grant-neutral para objetos existentes; las funciones nuevas quedan sin
-- EXECUTE para anon y PUBLIC.

BEGIN;

ALTER TABLE public.device_pairings
    ADD COLUMN IF NOT EXISTS claim_code_hash text,
    ADD COLUMN IF NOT EXISTS claim_code_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS claim_failed_attempts integer NOT NULL DEFAULT 0;

-- La caja genera el código de reclamo (solo en su pantalla; guarda solo el hash).
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

    IF v_device IS NULL
       OR length(v_device) < 8
       OR length(v_device) > 160
       OR v_device !~ '^PDA-(V2-)?[0-9A-Fa-f]{8,64}$' THEN
        RAISE EXCEPTION 'Identificador de caja inválido';
    END IF;

    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

    -- Solo cajas sin dueño pueden emitir un código nuevo.
    UPDATE public.device_pairings
    SET claim_code_hash = encode(digest(v_code, 'sha256'), 'hex'),
        claim_code_expires_at = now() + interval '10 minutes',
        claim_failed_attempts = 0
    WHERE primary_device_id = v_device
      AND owner_auth_id IS NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    -- Sin fila previa no se crea nada: la caja debe estar registrada.
    IF v_updated = 0 THEN
        RAISE EXCEPTION 'Caja no registrada o ya tiene dueño';
    END IF;

    RETURN v_code;
END;
$$;

-- El dueño canjea el código; fija owner_auth_id una sola vez.
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

-- generate_pairing_token: solo el dueño registrado (incluso tras revocar).
CREATE OR REPLACE FUNCTION public.generate_pairing_token(p_device_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_token text;
    v_owner uuid := auth.uid();
    v_device text := trim(p_device_id);
    v_updated integer;
BEGIN
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;

    IF v_device IS NULL
       OR length(v_device) < 8
       OR length(v_device) > 160
       OR v_device !~ '^PDA-(V2-)?[0-9A-Fa-f]{8,64}$' THEN
        RAISE EXCEPTION 'Identificador de caja inválido';
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
