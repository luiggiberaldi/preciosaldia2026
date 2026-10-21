-- STAGING ONLY (tdfcpwctvumbdjmifypd). Nunca ejecutar contra producción (sodgzkablshladvbtnes).
-- Migración 018: limpieza de cajas sintéticas sin dueño creadas por las pruebas de staging.
--
-- Problema: register_device_pairing crea cajas e2e-* sin dueño y ninguna RPC de cliente
-- puede borrarlas (e2e_delete_pairing solo actúa sobre cajas con owner_auth_id = auth.uid()).
--
-- Esta función:
--   * solo es ejecutable por authenticated (no anon ni PUBLIC);
--   * solo borra cajas con prefijo e2e-bk- o e2e-iso-;
--   * solo borra cajas sin owner_auth_id, sin monitor_auth_id y sin monitor_device_id;
--   * solo borra las del propio creador (created_by = auth.uid()) si existe ese campo;
--     como device_pairings no lo guarda, se limita a cajas sin dueño y sin monitor.
--
-- Nunca borra e2e-primary-device ni cajas con dueño, monitor o secreto.

BEGIN;

CREATE OR REPLACE FUNCTION public.e2e_delete_unowned_synthetic()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
    v_actor UUID := auth.uid();
    v_deleted INTEGER;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;

    DELETE FROM public.device_pairings
    WHERE (primary_device_id LIKE 'e2e-bk-%' OR primary_device_id LIKE 'e2e-iso-%')
      AND owner_auth_id IS NULL
      AND monitor_auth_id IS NULL
      AND monitor_device_id IS NULL;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted;
END;
$function$;

REVOKE ALL ON FUNCTION public.e2e_delete_unowned_synthetic() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.e2e_delete_unowned_synthetic() FROM anon;
GRANT EXECUTE ON FUNCTION public.e2e_delete_unowned_synthetic() TO authenticated;

COMMIT;
