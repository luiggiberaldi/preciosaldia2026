-- Staging-only. Project tdfcpwctvumbdjmifypd. NO aplicar en producción.
-- cloud_licenses tiene UNIQUE(email): el email sintético fijo chocaba entre corridas.
-- Se usa un email por dispositivo y se elimina la fila huérfana e2e-flow-box.

CREATE OR REPLACE FUNCTION public.e2e_seed_synthetic_license(p_device_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_device text := trim(p_device_id);
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesión no autenticada'; END IF;
    IF v_device IS NULL OR v_device NOT LIKE 'e2e-%' OR length(v_device) > 80 THEN
        RAISE EXCEPTION 'Identificador sintético de staging inválido';
    END IF;
    INSERT INTO public.cloud_licenses (email, device_id, license_type, is_active, business_name)
    VALUES ('e2e-' || v_device || '@example.invalid', v_device, 'permanent', true, 'E2E Sintetico');
    RETURN true;
END;
$function$;

CREATE OR REPLACE FUNCTION public.e2e_delete_synthetic_license(p_device_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_device text := trim(p_device_id);
BEGIN
    IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Sesión no autenticada'; END IF;
    IF v_device IS NULL OR v_device NOT LIKE 'e2e-%' THEN
        RAISE EXCEPTION 'Identificador sintético de staging inválido';
    END IF;
    DELETE FROM public.cloud_licenses
    WHERE device_id = v_device
      AND email = 'e2e-' || v_device || '@example.invalid';
    RETURN true;
END;
$function$;

-- Limpieza de la fila sintética huérfana de corridas anteriores (solo e2e-flow-box).
DELETE FROM public.cloud_licenses
WHERE device_id = 'e2e-flow-box'
  AND email = 'e2e-synthetic@example.invalid';
