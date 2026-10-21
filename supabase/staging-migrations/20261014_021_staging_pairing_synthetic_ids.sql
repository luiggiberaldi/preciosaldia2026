-- Staging-only. Project tdfcpwctvumbdjmifypd. NO aplicar en producción.
-- Objetivo: que el E2E de pairing use IDs sintéticos e2e-* en TODO el flujo.
-- create_owner_claim_code exige PDA-*; register/e2e_delete exigen e2e-*.
-- Se acepta e2e-* sintético en create_owner_claim_code (solo staging, nunca en prod).
-- Sin cambios de datos: esta migración solo reemplaza funciones.

CREATE OR REPLACE FUNCTION public.create_owner_claim_code(p_device_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE v_code text; v_device text := trim(p_device_id); v_updated integer;
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesión no autenticada'; END IF;
    -- Staging: además de PDA-*, acepta identificadores sintéticos e2e-*.
    IF v_device IS NULL
       OR length(v_device) < 8
       OR length(v_device) > 160
       OR (v_device !~ '^PDA-(V2-)?[0-9A-Fa-f]{8,64}$' AND v_device NOT LIKE 'e2e-%')
    THEN
        RAISE EXCEPTION 'Identificador de caja inválido';
    END IF;
    IF NOT public.is_active_permanent_device(v_device) THEN
        RAISE EXCEPTION 'La caja no tiene licencia permanente activa';
    END IF;
    INSERT INTO public.device_pairings (primary_device_id) VALUES (v_device) ON CONFLICT (primary_device_id) DO NOTHING;
    v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12));
    UPDATE public.device_pairings
       SET claim_code_hash = encode(digest(v_code, 'sha256'), 'hex'),
           claim_code_expires_at = now() + interval '10 minutes',
           claim_failed_attempts = 0
     WHERE primary_device_id = v_device AND owner_auth_id IS NULL;
    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN RAISE EXCEPTION 'La caja ya tiene dueño'; END IF;
    RETURN v_code;
END;
$function$;
