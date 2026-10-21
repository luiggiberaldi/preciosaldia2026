-- STAGING ONLY — 018: vinculación simple del supervisor (sin claim-code)
-- Intended project ref: tdfcpwctvumbdjmifypd
-- Estado: BORRADOR. NO APLICADO. No ejecutar en producción.
--
-- Modelo:
--   * La caja con licencia permanente activa genera el token y envía el enlace
--     al WhatsApp del dueño. No se usa owner_auth_id como requisito.
--   * Token de un solo uso, guardado como SHA-256, válido 15 minutos.
--   * Las RPC solo las ejecutan sesiones autenticadas (no anon).
--   * unpair_monitor valida a quien llama: la caja (is_own_device_row) o el
--     monitor (monitor_auth_id = auth.uid()).
--   * Al desvincular se limpian monitor_device_id, monitor_auth_id y paired_at.
--     Así un revoked_at nunca reactiva un vínculo viejo.
--   * create_owner_claim_code y claim_owner_device NO se borran; quedan sin uso.
--
-- Conserva: columnas, índices y funciones *_with_secret ya aplicadas en staging.

BEGIN;

ALTER TABLE public.device_pairings
    ADD COLUMN IF NOT EXISTS token_hash         text,
    ADD COLUMN IF NOT EXISTS token_expires_at   timestamptz,
    ADD COLUMN IF NOT EXISTS token_used_at      timestamptz,
    ADD COLUMN IF NOT EXISTS revoked_at         timestamptz,
    ADD COLUMN IF NOT EXISTS monitor_auth_id    uuid,
    ADD COLUMN IF NOT EXISTS monitor_secret_hash text;

CREATE OR REPLACE FUNCTION public.generate_pairing_token(p_device_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_token  text;
    v_device text := trim(p_device_id);
    v_row    public.device_pairings%ROWTYPE;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Se requiere sesión activa para emitir un enlace de supervisor';
    END IF;

    IF v_device IS NULL OR length(v_device) < 8 OR length(v_device) > 160 THEN
        RAISE EXCEPTION 'Identificador de dispositivo inválido';
    END IF;

    IF NOT public.is_active_permanent_device(v_device) THEN
        RAISE EXCEPTION 'Se requiere licencia permanente activa para emitir acceso de supervisor';
    END IF;

    SELECT * INTO v_row
    FROM public.device_pairings
    WHERE primary_device_id = v_device
    FOR UPDATE;

    IF FOUND AND v_row.monitor_device_id IS NOT NULL AND v_row.revoked_at IS NULL THEN
        RAISE EXCEPTION 'Esta caja ya tiene un supervisor conectado. Desvincula el celular actual antes de generar un nuevo enlace.';
    END IF;

    v_token := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 24));

    IF FOUND THEN
        UPDATE public.device_pairings
        SET pairing_token     = NULL,
            token_hash        = encode(digest(v_token, 'sha256'), 'hex'),
            token_expires_at  = now() + interval '15 minutes',
            token_used_at     = NULL,
            revoked_at        = NULL,
            monitor_device_id = NULL,
            monitor_auth_id   = NULL,
            paired_at         = NULL
        WHERE id = v_row.id;
    ELSE
        INSERT INTO public.device_pairings (primary_device_id, token_hash, token_expires_at)
        VALUES (v_device, encode(digest(v_token, 'sha256'), 'hex'), now() + interval '15 minutes');
    END IF;

    RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.pair_monitor_device(p_token text, p_monitor_device_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_pairing     public.device_pairings%ROWTYPE;
    v_monitor_id  text := trim(p_monitor_device_id);
    v_monitor_uid uuid := auth.uid();
BEGIN
    IF v_monitor_uid IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Se requiere sesión activa para vincular el supervisor.');
    END IF;

    IF v_monitor_id IS NULL OR length(v_monitor_id) < 8 OR length(v_monitor_id) > 160 THEN
        RETURN json_build_object('success', false, 'message', 'Identificador de monitor inválido.');
    END IF;

    IF p_token IS NULL OR length(trim(p_token)) < 16 OR length(trim(p_token)) > 64 THEN
        RETURN json_build_object('success', false, 'message', 'Código de enlace inválido.');
    END IF;

    SELECT * INTO v_pairing
    FROM public.device_pairings
    WHERE token_hash = encode(digest(upper(trim(p_token)), 'sha256'), 'hex')
      AND token_expires_at > now()
      AND token_used_at IS NULL
      AND revoked_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'El enlace ha expirado o ya fue utilizado. Pide uno nuevo desde la caja.');
    END IF;

    IF NOT public.is_active_permanent_device(v_pairing.primary_device_id) THEN
        RETURN json_build_object('success', false, 'message', 'La caja no cuenta con licencia permanente activa.');
    END IF;

    UPDATE public.device_pairings
    SET monitor_device_id = v_monitor_id,
        monitor_auth_id   = v_monitor_uid,
        pairing_token     = NULL,
        token_hash        = NULL,
        token_used_at    = now(),
        paired_at         = now()
    WHERE id = v_pairing.id;

    RETURN json_build_object('success', true, 'primary_device_id', v_pairing.primary_device_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.unpair_monitor(p_device_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_device text := trim(p_device_id);
    v_caller uuid := auth.uid();
    v_row    public.device_pairings%ROWTYPE;
BEGIN
    IF v_caller IS NULL THEN
        RAISE EXCEPTION 'Se requiere sesión activa para desvincular el supervisor';
    END IF;

    IF v_device IS NULL OR length(v_device) < 8 THEN
        RAISE EXCEPTION 'Identificador de dispositivo inválido';
    END IF;

    SELECT * INTO v_row
    FROM public.device_pairings
    WHERE primary_device_id = v_device OR monitor_device_id = v_device
    LIMIT 1
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN false;
    END IF;

    IF NOT (
        public.is_own_device_row(v_row.primary_device_id)
        OR (v_row.monitor_auth_id IS NOT NULL AND v_row.monitor_auth_id = v_caller)
    ) THEN
        RAISE EXCEPTION 'No autorizado para desvincular este supervisor';
    END IF;

    UPDATE public.device_pairings
    SET monitor_device_id = NULL,
        monitor_auth_id   = NULL,
        paired_at         = NULL,
        token_hash        = NULL,
        token_expires_at  = NULL,
        token_used_at     = NULL,
        revoked_at        = now()
    WHERE id = v_row.id;

    RETURN true;
END;
$$;

-- Predicado de licencia (ya existe en staging desde 017; se recrea por si falta).
CREATE OR REPLACE FUNCTION public.is_active_permanent_device(p_device_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.cloud_licenses l
        WHERE l.device_id = p_device_id
          AND l.license_type = 'permanent'
          AND l.is_active IS TRUE
    );
$$;

REVOKE ALL ON FUNCTION public.is_active_permanent_device(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_pairing_token(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pair_monitor_device(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unpair_monitor(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_pairing_token(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pair_monitor_device(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unpair_monitor(text) TO authenticated, service_role;

COMMIT;
