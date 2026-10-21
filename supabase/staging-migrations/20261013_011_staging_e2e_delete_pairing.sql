-- STAGING ONLY — 011: borrado de filas de prueba del E2E de vinculación
-- Intended project ref: tdfcpwctvumbdjmifypd
-- Do NOT run against production. NOT APPLIED YET.
--
-- Por qué: el cliente autenticado no puede escribir device_pairings. Sin esta
-- RPC, cada ejecución del E2E deja una fila e2e-box-* en staging.
--
-- Reglas:
--   * Solo IDs sintéticos e2e-% (nunca cajas reales).
--   * Solo filas cuyo dueño es la sesión que llama.
--   * Sin ninguna vinculación activa: si hay monitor activo, no borra.
--   * Solo authenticated; nada para anon ni PUBLIC.

CREATE OR REPLACE FUNCTION public.e2e_delete_pairing(p_device_id TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
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
      AND monitor_auth_id IS NULL;

    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    RETURN v_deleted > 0;
END;
$$;

REVOKE ALL ON FUNCTION public.e2e_delete_pairing(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.e2e_delete_pairing(TEXT) TO authenticated;
