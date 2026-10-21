-- STAGING ONLY — 012: desvincular desde el celular con secreto local
-- Intended project ref: tdfcpwctvumbdjmifypd
-- Do NOT run against production. NOT APPLIED YET.
--
-- Por qué: si el celular pierde su sesión anónima, unpair_monitor no lo reconoce
-- y el vínculo queda huérfano. El celular genera un secreto al vincular y lo
-- envía en claro una sola vez; el servidor guarda solo su SHA-256. Para
-- desvincular, el celular presenta el secreto además de su sesión.
--
-- No cambia la firma de pair_monitor_device ni de unpair_monitor (la caja y el
-- E2E siguen llamándolas igual). Añade funciones nuevas.
--
-- Reglas:
--   * Solo IDs sintéticos e2e-% en staging.
--   * El hash del secreto NO es legible por authenticated (columna oculta).
--   * Sin secreto correcto, no revoca nada.
--   * Solo authenticated; nada para anon ni PUBLIC.

ALTER TABLE public.device_pairings
    ADD COLUMN IF NOT EXISTS monitor_secret_hash text;

-- Un secreto en claro debe tener al menos 32 caracteres.
CREATE OR REPLACE FUNCTION public.pair_monitor_device_with_secret(
    p_token TEXT,
    p_monitor_device_id TEXT,
    p_secret TEXT
)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_result JSON;
    v_monitor_device TEXT := trim(p_monitor_device_id);
BEGIN
    IF p_secret IS NULL OR length(p_secret) < 32 OR length(p_secret) > 256 THEN
        RETURN json_build_object('success', false, 'message', 'Secreto inválido.');
    END IF;

    v_result := public.pair_monitor_device(p_token, p_monitor_device_id);

    IF (v_result->>'success')::boolean THEN
        UPDATE public.device_pairings
        SET monitor_secret_hash = encode(digest(p_secret, 'sha256'), 'hex')
        WHERE primary_device_id = v_result->>'primary_device_id'
          AND monitor_auth_id = auth.uid()
          AND monitor_device_id = v_monitor_device;
    END IF;

    RETURN v_result;
END;
$$;

-- Desvincula si el secreto coincide con el guardado para ese vínculo activo.
CREATE OR REPLACE FUNCTION public.unpair_monitor_with_secret(
    p_device_id TEXT,
    p_secret TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_device TEXT := trim(p_device_id);
    v_updated INTEGER;
BEGIN
    IF v_device IS NULL OR v_device NOT LIKE 'e2e-%' THEN
        RAISE EXCEPTION 'Identificador sintético de staging inválido';
    END IF;

    IF p_secret IS NULL OR length(p_secret) < 32 OR length(p_secret) > 256 THEN
        RAISE EXCEPTION 'No autorizado o vínculo inexistente';
    END IF;

    UPDATE public.device_pairings
    SET monitor_device_id = NULL,
        monitor_auth_id = NULL,
        monitor_secret_hash = NULL,
        pairing_token = NULL,
        token_hash = NULL,
        token_expires_at = NULL,
        token_used_at = NULL,
        paired_at = NULL,
        revoked_at = now()
    WHERE primary_device_id = v_device
      AND revoked_at IS NULL
      AND monitor_secret_hash = encode(digest(p_secret, 'sha256'), 'hex');

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated = 0 THEN
        RAISE EXCEPTION 'No autorizado o vínculo inexistente';
    END IF;

    RETURN true;
END;
$$;

-- El hash del secreto no debe ser legible por clientes: quitar la columna del
-- SELECT de authenticated. Los campos que la app lee se conceden de nuevo.
REVOKE SELECT ON TABLE public.device_pairings FROM authenticated;
GRANT SELECT (
    id, primary_device_id, owner_auth_id, monitor_device_id, monitor_auth_id,
    pairing_token, token_hash, token_expires_at, token_used_at, paired_at,
    revoked_at, created_at, last_seen_at
) ON TABLE public.device_pairings TO authenticated;

REVOKE ALL ON FUNCTION public.pair_monitor_device_with_secret(TEXT, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unpair_monitor_with_secret(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.pair_monitor_device_with_secret(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unpair_monitor_with_secret(TEXT, TEXT) TO authenticated;
