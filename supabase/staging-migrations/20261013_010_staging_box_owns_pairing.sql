-- STAGING ONLY — 010: la caja es la dueña de su vinculación (sin dueño presente)
-- Intended project ref: tdfcpwctvumbdjmifypd
-- Do NOT run against production. NOT APPLIED YET.
--
-- Modelo aprobado:
--   * La caja genera el QR con generate_pairing_token. Si la caja aún no tiene
--     dueño registrado, la sesión que genera el token queda como dueña.
--   * El encargado escanea el QR con su celular; no necesita al dueño presente.
--   * Una caja con dueño solo puede generar tokens desde su misma sesión
--     anónima. Un tercero no puede reclamarla ni generar tokens para ella.
--   * Se conservan las funciones create_owner_claim_code y claim_owner_device
--     de la 007 sin usarlas en el flujo diario. No se borran datos.
--
-- Mantiene el guardia e2e-% de staging y no concede nada a anon ni PUBLIC.

CREATE OR REPLACE FUNCTION public.generate_pairing_token(p_device_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_token TEXT;
    v_hash TEXT;
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
    v_hash := encode(digest(v_token, 'sha256'), 'hex');

    -- Caja sin dueño: esta sesión la reclama. Caja con dueño: solo ese dueño.
    UPDATE public.device_pairings
    SET pairing_token = NULL,
        token_hash = v_hash,
        token_expires_at = now() + interval '5 minutes',
        token_used_at = NULL,
        monitor_device_id = NULL,
        monitor_auth_id = NULL,
        paired_at = NULL,
        revoked_at = NULL,
        owner_auth_id = v_owner
    WHERE primary_device_id = v_device
      AND (owner_auth_id IS NULL OR owner_auth_id = v_owner);

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated = 0 THEN
        IF EXISTS (SELECT 1 FROM public.device_pairings WHERE primary_device_id = v_device) THEN
            RAISE EXCEPTION 'No autorizado para esta caja';
        END IF;
        INSERT INTO public.device_pairings (
            primary_device_id, owner_auth_id, token_hash, token_expires_at, created_at
        ) VALUES (
            v_device, v_owner, v_hash, now() + interval '5 minutes', now()
        );
    END IF;

    RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_pairing_token(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_pairing_token(TEXT) TO authenticated;
