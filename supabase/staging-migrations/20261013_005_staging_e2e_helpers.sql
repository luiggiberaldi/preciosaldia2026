-- STAGING ONLY — helpers E2E del modo supervisor (005)
-- Intended project ref: tdfcpwctvumbdjmifypd
-- Do NOT run against production.
--
-- Why: estas tres funciones se aplicaron a mano en staging para los E2E
-- remotos. Este archivo deja constancia versionada de su definición exacta,
-- para que staging se pueda reconstruir. Son SECURITY DEFINER, solo aceptan
-- identificadores sintéticos `e2e-%` y exigen sesión autenticada.
-- Ningún rol `anon` ni `PUBLIC` tiene EXECUTE sobre ellas.

BEGIN;

CREATE OR REPLACE FUNCTION public.e2e_cleanup_commands(p_command_prefix text, p_device_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;
    IF p_device_id IS NULL OR trim(p_device_id) NOT LIKE 'e2e-%' THEN
        RAISE EXCEPTION 'Identificador sintético de staging inválido';
    END IF;
    IF p_command_prefix IS NULL OR length(trim(p_command_prefix)) < 8 OR trim(p_command_prefix) NOT LIKE 'm2-e2e-%' THEN
        RAISE EXCEPTION 'Prefijo de limpieza inválido';
    END IF;
    DELETE FROM public.supervisor_commands
    WHERE target_device_id = trim(p_device_id)
      AND command_id LIKE trim(p_command_prefix) || '%';
END;
$function$;

CREATE OR REPLACE FUNCTION public.e2e_set_canary_allowlist(p_device_id text, p_enabled boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;
    IF p_device_id IS NULL OR trim(p_device_id) NOT LIKE 'e2e-%' THEN
        RAISE EXCEPTION 'Identificador sintético de staging inválido';
    END IF;
    UPDATE public.supervisor_canary_allowlist
    SET enabled = p_enabled, updated_at = now()
    WHERE primary_device_id = trim(p_device_id);
END;
$function$;

CREATE OR REPLACE FUNCTION public.e2e_set_pairing_link(p_device_id text, p_owner_auth_id uuid, p_monitor_auth_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;
    IF p_device_id IS NULL OR trim(p_device_id) NOT LIKE 'e2e-%' THEN
        RAISE EXCEPTION 'Identificador sintético de staging inválido';
    END IF;
    UPDATE public.device_pairings
    SET owner_auth_id = p_owner_auth_id,
        monitor_auth_id = p_monitor_auth_id,
        monitor_device_id = CASE WHEN p_monitor_auth_id IS NULL THEN NULL ELSE 'e2e-monitor-device' END,
        revoked_at = NULL,
        paired_at = now()
    WHERE primary_device_id = trim(p_device_id);
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Pairing e2e inexistente';
    END IF;
END;
$function$;

-- Solo authenticated puede ejecutarlas; anon y PUBLIC no.
REVOKE ALL ON FUNCTION public.e2e_cleanup_commands(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.e2e_set_canary_allowlist(text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.e2e_set_pairing_link(text, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.e2e_cleanup_commands(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.e2e_set_canary_allowlist(text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.e2e_set_pairing_link(text, uuid, uuid) TO authenticated;

COMMIT;
