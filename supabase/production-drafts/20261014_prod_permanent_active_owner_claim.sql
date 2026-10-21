-- PRODUCTION DRAFT — global owner claim for active permanent licenses
-- Target: sodgzkablshladvbtnes. NOT APPLIED.
-- Requires: verified production backup, staging rehearsal, explicit approval.
-- Beta limitation: any authenticated session knowing an eligible device ID can
-- request a claim code. This is intentionally a limited beta gate, not strong
-- cryptographic proof that the caller physically possesses the device.
--
-- Behavior:
--   * Only cloud_licenses rows with license_type='permanent' and is_active=true
--     are eligible, checked at claim-code issue, claim redemption, token issue,
--     and token consumption. The eligible license row is locked through each RPC.
--   * A pending pairing row is created only for a currently eligible device.
--   * Existing owner_auth_id is never overwritten by claim.
--   * An active monitor link is never reset to issue a replacement token.
--   * Unknown, inactive, and non-permanent devices are rejected.
--   * pair_monitor_device preserves its signature and existing basic token flow,
--     adding only active permanent-license and monitor-ID validation.

BEGIN;

ALTER TABLE public.device_pairings
    ADD COLUMN IF NOT EXISTS claim_code_hash text,
    ADD COLUMN IF NOT EXISTS claim_code_expires_at timestamptz,
    ADD COLUMN IF NOT EXISTS claim_failed_attempts integer NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public.create_owner_claim_code(p_device_id text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_device text := trim(p_device_id);
    v_code text;
    v_row public.device_pairings%ROWTYPE;
    v_license_device text;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesión no autenticada'; END IF;
    IF v_device IS NULL OR length(v_device) < 8 OR length(v_device) > 160
       OR v_device !~ '^PDA-(V2-)?[0-9A-Fa-f]{8,64}$' THEN
        RAISE EXCEPTION 'Identificador de dispositivo inválido';
    END IF;
    SELECT device_id INTO v_license_device FROM public.cloud_licenses
    WHERE device_id = v_device AND lower(trim(license_type)) = 'permanent' AND is_active IS TRUE
    ORDER BY id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Se requiere licencia permanente activa'; END IF;

    INSERT INTO public.device_pairings(primary_device_id, created_at)
    VALUES (v_device, now()) ON CONFLICT (primary_device_id) DO NOTHING;
    SELECT * INTO v_row FROM public.device_pairings
    WHERE primary_device_id = v_device FOR UPDATE;

    IF v_row.owner_auth_id IS NOT NULL THEN RAISE EXCEPTION 'La caja ya tiene dueño registrado'; END IF;
    IF v_row.revoked_at IS NULL AND (v_row.monitor_auth_id IS NOT NULL OR v_row.monitor_device_id IS NOT NULL) THEN
        RAISE EXCEPTION 'No se emite reclamo mientras exista un monitor activo';
    END IF;
    IF v_row.claim_code_hash IS NOT NULL AND v_row.claim_code_expires_at > now() THEN
        RAISE EXCEPTION 'Ya existe un código de reclamo vigente';
    END IF;

    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    UPDATE public.device_pairings
    SET claim_code_hash = encode(digest(v_code, 'sha256'), 'hex'),
        claim_code_expires_at = now() + interval '10 minutes', claim_failed_attempts = 0,
        pairing_token = NULL, token_hash = NULL, token_expires_at = NULL, token_used_at = NULL
    WHERE id = v_row.id AND owner_auth_id IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'No se pudo reservar el código de reclamo'; END IF;
    RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.claim_owner_device(p_device_id text, p_code text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_owner uuid := auth.uid();
    v_device text := trim(p_device_id);
    v_row public.device_pairings%ROWTYPE;
    v_license_device text;
BEGIN
    IF v_owner IS NULL THEN RETURN json_build_object('success', false, 'message', 'Sesión no autenticada.'); END IF;
    IF v_device IS NULL OR length(v_device) < 8 OR length(v_device) > 160
       OR v_device !~ '^PDA-(V2-)?[0-9A-Fa-f]{8,64}$' THEN
        RETURN json_build_object('success', false, 'message', 'Identificador de dispositivo inválido.');
    END IF;
    SELECT device_id INTO v_license_device FROM public.cloud_licenses
    WHERE device_id = v_device AND lower(trim(license_type)) = 'permanent' AND is_active IS TRUE
    ORDER BY id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RETURN json_build_object('success', false, 'message', 'Se requiere licencia permanente activa.'); END IF;

    SELECT * INTO v_row FROM public.device_pairings
    WHERE primary_device_id = v_device FOR UPDATE;
    IF NOT FOUND OR v_row.claim_code_hash IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'No hay código de reclamo activo.');
    END IF;
    IF v_row.owner_auth_id IS NOT NULL THEN
        RETURN json_build_object('success', false, 'message', 'La caja ya tiene dueño registrado.');
    END IF;
    IF v_row.revoked_at IS NULL AND (v_row.monitor_auth_id IS NOT NULL OR v_row.monitor_device_id IS NOT NULL) THEN
        RETURN json_build_object('success', false, 'message', 'La caja ya tiene monitor activo.');
    END IF;
    IF v_row.claim_failed_attempts >= 5 OR v_row.claim_code_expires_at <= now() THEN
        RETURN json_build_object('success', false, 'message', 'Código expirado o bloqueado.');
    END IF;
    IF p_code IS NULL OR p_code !~ '^[0-9A-Fa-f]{12}$'
       OR v_row.claim_code_hash <> encode(digest(upper(trim(p_code)), 'sha256'), 'hex') THEN
        UPDATE public.device_pairings SET claim_failed_attempts = claim_failed_attempts + 1 WHERE id = v_row.id;
        RETURN json_build_object('success', false, 'message', 'Código incorrecto.');
    END IF;

    UPDATE public.device_pairings
    SET owner_auth_id = v_owner, claim_code_hash = NULL,
        claim_code_expires_at = NULL, claim_failed_attempts = 0
    WHERE id = v_row.id AND owner_auth_id IS NULL;
    RETURN json_build_object('success', true, 'primary_device_id', v_device);
END;
$$;

CREATE OR REPLACE FUNCTION public.generate_pairing_token(p_device_id text)
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_token text;
    v_owner uuid := auth.uid();
    v_device text := trim(p_device_id);
    v_row public.device_pairings%ROWTYPE;
    v_license_device text;
BEGIN
    IF v_owner IS NULL THEN RAISE EXCEPTION 'Sesión no autenticada'; END IF;
    IF v_device IS NULL OR length(v_device) < 8 OR length(v_device) > 160
       OR v_device !~ '^PDA-(V2-)?[0-9A-Fa-f]{8,64}$' THEN
        RAISE EXCEPTION 'Identificador de dispositivo inválido';
    END IF;
    SELECT device_id INTO v_license_device FROM public.cloud_licenses
    WHERE device_id = v_device AND lower(trim(license_type)) = 'permanent' AND is_active IS TRUE
    ORDER BY id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'Se requiere licencia permanente activa'; END IF;

    SELECT * INTO v_row FROM public.device_pairings
    WHERE primary_device_id = v_device FOR UPDATE;
    IF NOT FOUND OR v_row.owner_auth_id IS NULL OR v_row.owner_auth_id <> v_owner THEN
        RAISE EXCEPTION 'No autorizado; la caja debe ser reclamada por su dueño';
    END IF;
    IF v_row.revoked_at IS NULL AND (v_row.monitor_auth_id IS NOT NULL OR v_row.monitor_device_id IS NOT NULL) THEN
        RAISE EXCEPTION 'Ya existe un monitor activo; no se modifica el vínculo';
    END IF;

    v_token := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 24));
    UPDATE public.device_pairings
    SET pairing_token = NULL, token_hash = encode(digest(v_token, 'sha256'), 'hex'),
        token_expires_at = now() + interval '5 minutes', token_used_at = NULL,
        monitor_device_id = CASE WHEN v_row.revoked_at IS NOT NULL THEN NULL ELSE v_row.monitor_device_id END,
        monitor_auth_id = CASE WHEN v_row.revoked_at IS NOT NULL THEN NULL ELSE v_row.monitor_auth_id END,
        paired_at = CASE WHEN v_row.revoked_at IS NOT NULL THEN NULL ELSE v_row.paired_at END,
        revoked_at = CASE WHEN v_row.revoked_at IS NOT NULL THEN NULL ELSE v_row.revoked_at END
    WHERE id = v_row.id AND owner_auth_id = v_owner;
    RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.pair_monitor_device(p_token text, p_monitor_device_id text)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions AS $$
DECLARE
    v_monitor uuid := auth.uid();
    v_pairing public.device_pairings%ROWTYPE;
    v_license_device text;
    v_device text;
    v_monitor_id text := trim(p_monitor_device_id);
BEGIN
    IF v_monitor IS NULL THEN RETURN json_build_object('success', false, 'message', 'Sesión no autenticada.'); END IF;
    IF v_monitor_id IS NULL OR length(v_monitor_id) < 8 OR length(v_monitor_id) > 160
       OR NOT (v_monitor_id ~ '^PDA-(V2-)?[0-9A-Fa-f]{8,64}$' OR v_monitor_id ~ '^mon-[0-9A-Za-z-]{8,156}$') THEN
        RETURN json_build_object('success', false, 'message', 'Identificador de monitor inválido.');
    END IF;
    IF p_token IS NULL OR length(trim(p_token)) < 16 OR length(trim(p_token)) > 64 THEN
        RETURN json_build_object('success', false, 'message', 'Código inválido.');
    END IF;
    -- Respeta el mismo orden de locks que generate_pairing_token: licencia y luego pairing.
    SELECT primary_device_id INTO v_device FROM public.device_pairings
    WHERE token_hash = encode(digest(upper(trim(p_token)), 'sha256'), 'hex')
      AND token_expires_at > now() AND token_used_at IS NULL AND revoked_at IS NULL;
    IF NOT FOUND THEN RETURN json_build_object('success', false, 'message', 'El código expiró o ya fue utilizado.'); END IF;
    SELECT device_id INTO v_license_device FROM public.cloud_licenses
    WHERE device_id = v_device AND lower(trim(license_type)) = 'permanent' AND is_active IS TRUE
    ORDER BY id LIMIT 1 FOR UPDATE;
    IF NOT FOUND THEN RETURN json_build_object('success', false, 'message', 'Se requiere licencia permanente activa.'); END IF;
    SELECT * INTO v_pairing FROM public.device_pairings
    WHERE primary_device_id = v_device
      AND token_hash = encode(digest(upper(trim(p_token)), 'sha256'), 'hex')
      AND token_expires_at > now() AND token_used_at IS NULL AND revoked_at IS NULL
    FOR UPDATE;
    IF NOT FOUND THEN RETURN json_build_object('success', false, 'message', 'El código expiró o ya fue utilizado.'); END IF;
    IF v_pairing.owner_auth_id IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'La caja debe reclamar dueño antes de vincular un monitor.');
    END IF;
    IF v_pairing.revoked_at IS NULL AND (v_pairing.monitor_auth_id IS NOT NULL OR v_pairing.monitor_device_id IS NOT NULL) THEN
        RETURN json_build_object('success', false, 'message', 'Ya existe un monitor activo.');
    END IF;
    IF v_pairing.monitor_auth_id IS NOT NULL AND v_pairing.monitor_auth_id <> v_monitor THEN
        RETURN json_build_object('success', false, 'message', 'El vínculo ya está ocupado.');
    END IF;
    UPDATE public.device_pairings
    SET monitor_device_id = v_monitor_id, monitor_auth_id = v_monitor,
        pairing_token = NULL, token_hash = NULL, token_used_at = now(), paired_at = now()
    WHERE id = v_pairing.id;
    RETURN json_build_object('success', true, 'primary_device_id', v_pairing.primary_device_id);
END;
$$;

REVOKE ALL ON FUNCTION public.create_owner_claim_code(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_owner_device(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.generate_pairing_token(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pair_monitor_device(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_owner_claim_code(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.claim_owner_device(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.generate_pairing_token(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pair_monitor_device(text, text) TO authenticated, service_role;

COMMIT;
