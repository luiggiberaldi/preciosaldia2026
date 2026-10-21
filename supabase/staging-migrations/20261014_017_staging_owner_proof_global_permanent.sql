-- STAGING ONLY — 017: owner proof global para licencias permanentes activas
-- Intended project ref: tdfcpwctvumbdjmifypd
-- Estado: BORRADOR ENSAYADO EN STAGING. NO APLICADO EN PRODUCCIÓN.
-- Do NOT run against production. Versión de producción pendiente de revisión.
--
-- Alcance (según docs/plans/2026-10-14-produccion-owner-proof-revision.md):
--   * Elegible = licencia cloud_licenses.license_type = 'permanent' AND is_active = true.
--   * Sin licencia elegible: ninguna función crea ni modifica filas.
--   * create_owner_claim_code crea la fila faltante de una caja elegible
--     (Bodega mani, MILY BEAUTY STORE) y emite código de reclamo.
--   * claim_owner_device es el ÚNICO camino para fijar owner_auth_id. Uso único.
--     Nunca reasigna un dueño existente.
--   * generate_pairing_token solo lo ejecuta el dueño registrado. NO reinicia
--     monitor_device_id, monitor_auth_id ni paired_at (preserva el monitor
--     activo de "prueba"). Sí regenera token y limpia token_used_at.
--   * Sin filtro e2e-% (IDs reales PDA-...). Guardia de formato PDA-.
--
-- Supuesto a confirmar antes de producción: la caja tiene sesión anónima propia
-- para llamar a create_owner_claim_code y generate_pairing_token.

BEGIN;

ALTER TABLE public.device_pairings
    ADD COLUMN IF NOT EXISTS claim_code_hash text,
    ADD COLUMN IF NOT EXISTS claim_code_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS claim_failed_attempts integer NOT NULL DEFAULT 0;

-- Predicado de elegibilidad compartido.
CREATE OR REPLACE FUNCTION public.is_active_permanent_device(p_device_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.cloud_licenses l
        WHERE l.device_id = p_device_id
          AND l.license_type = 'permanent'
          AND l.is_active IS TRUE
    );
$$;

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

    IF NOT public.is_active_permanent_device(v_device) THEN
        RAISE EXCEPTION 'La caja no tiene licencia permanente activa';
    END IF;

    -- Crear la fila faltante (idempotente). Nunca toca owner_auth_id existente.
    INSERT INTO public.device_pairings (primary_device_id)
    VALUES (v_device)
    ON CONFLICT (primary_device_id) DO NOTHING;

    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));

    UPDATE public.device_pairings
    SET claim_code_hash = encode(digest(v_code, 'sha256'), 'hex'),
        claim_code_expires_at = now() + interval '10 minutes',
        claim_failed_attempts = 0
    WHERE primary_device_id = v_device
      AND owner_auth_id IS NULL;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
        RAISE EXCEPTION 'La caja ya tiene dueño';
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

    IF NOT public.is_active_permanent_device(v_device) THEN
        RETURN json_build_object('success', false, 'message', 'La caja no tiene licencia permanente activa.');
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

    -- Uso único: se borra el hash al canjear. No cambia un dueño ya igual.
    UPDATE public.device_pairings
    SET owner_auth_id = v_owner,
        claim_code_hash = NULL,
        claim_code_expires_at = NULL,
        claim_failed_attempts = 0
    WHERE id = v_row.id;

    RETURN json_build_object('success', true, 'primary_device_id', v_device);
END;
$$;

-- generate_pairing_token: solo el dueño registrado, con licencia permanente activa.
-- Preserva monitor_device_id, monitor_auth_id y paired_at (no resetea el vínculo).
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

    IF NOT public.is_active_permanent_device(v_device) THEN
        RAISE EXCEPTION 'La caja no tiene licencia permanente activa';
    END IF;

    v_token := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 24));

    UPDATE public.device_pairings
    SET pairing_token = NULL,
        token_hash = encode(digest(v_token, 'sha256'), 'hex'),
        token_expires_at = now() + interval '5 minutes',
        token_used_at = NULL,
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

REVOKE ALL ON FUNCTION public.is_active_permanent_device(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_owner_claim_code(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_owner_device(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_pairing_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_owner_claim_code(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_owner_device(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.generate_pairing_token(text) TO authenticated;

COMMIT;
