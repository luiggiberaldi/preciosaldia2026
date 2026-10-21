-- STAGING ONLY — 014: limpieza E2E de vínculos revocados
-- Intended project ref: tdfcpwctvumbdjmifypd
-- Do NOT run against production. APPLIED to staging (tdfcpwctvumbdjmifypd).
--
-- e2e_delete_pairing solo borraba filas sin monitor_auth_id. Tras una
-- desvinculación esa columna conserva el valor, así que las filas de prueba
-- revocadas quedaban en staging. Ahora también borra las revocadas del propio
-- dueño. Sigue limitada al prefijo sintético e2e- y al dueño autenticado.

CREATE OR REPLACE FUNCTION public.e2e_delete_pairing(p_device_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor UUID := auth.uid();
    v_device TEXT := trim(p_device_id);
    v_deleted INTEGER;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;

    IF v_device IS NULL OR v_device NOT LIKE 'e2e-%' THEN
        RAISE EXCEPTION 'Identificador sintético de staging inválido';
    END IF;

    DELETE FROM public.device_pairings
    WHERE primary_device_id = v_device
      AND owner_auth_id = v_actor
      AND (monitor_auth_id IS NULL OR revoked_at IS NOT NULL);

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted > 0;
END;
$function$;
