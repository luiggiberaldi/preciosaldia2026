-- STAGING ONLY — 012: registrar una caja sin dueño antes del reclamo (solo e2e-*)
-- Intended project ref: tdfcpwctvumbdjmifypd
-- Estado: BORRADOR. NO APLICADO. Requiere aprobación explícita.
-- Do NOT run against production.
--
-- Motivo: la 011 eliminó la creación implícita de la fila en generate_pairing_token.
-- create_owner_claim_code solo actualiza filas existentes, así que una caja de
-- prueba nueva no puede reclamarse. Esta función crea SOLO la fila de la caja,
-- sin dueño, y nunca asigna owner_auth_id. El reclamo sigue siendo el único
-- camino para fijar dueño (claim_owner_device).
--
-- Guardia e2e-% y auth.uid() obligatorio. Sin EXECUTE para anon ni PUBLIC.

BEGIN;

CREATE OR REPLACE FUNCTION public.register_device_pairing(p_device_id text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_device text := trim(p_device_id);
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;

    IF v_device IS NULL OR v_device NOT LIKE 'e2e-%' THEN
        RAISE EXCEPTION 'Identificador sintético de staging inválido';
    END IF;

    -- Idempotente: si la caja ya existe, no se toca nada (ni dueño ni token).
    INSERT INTO public.device_pairings (primary_device_id, created_at)
    VALUES (v_device, now())
    ON CONFLICT (primary_device_id) DO NOTHING;

    RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.register_device_pairing(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.register_device_pairing(text) TO authenticated;

COMMIT;
