-- ════════════════════════════════════════════════════════════════════════════
-- Caja negra de órdenes del supervisor (2026-11-19, caso Bodega mani)
--
-- Problema: cuando create_supervisor_command rechaza una orden, la transacción
-- se deshace y NO queda rastro en supervisor_commands. Desde la caja parece que
-- «no llegó nada», y el error solo decía «Payload … inválido» sin decir qué.
-- Bodega mani acumuló 263 rechazos en 24 h sin que nadie lo viera.
--
-- Qué agrega:
--   1. explain_supervisor_inventory_batch_payload(jsonb): misma regla que
--      is_valid_supervisor_inventory_batch_payload, pero devuelve EL MOTIVO
--      («línea 1: campo no permitido: productName») o NULL si es válido.
--   2. supervisor_command_failures: un renglón por error distinto (huella), con
--      contador de repeticiones, primer y último intento y el último payload.
--   3. report_supervisor_command_failure(...): el monitor lo llama al recibir un
--      rechazo. Nunca falla hacia el cliente. Límite de 200 errores distintos
--      por actor y día; payload recortado a 16 KB; limpieza de lo de +30 días.
--   4. supervisor_command_problems: vista para el informe interno que une los
--      rechazos con las órdenes que la caja marcó como fallidas y las que
--      vencieron sin que la caja las tomara.
--
-- Seguridad: la tabla y la vista no se exponen a anon ni a authenticated; solo
-- la RPC (SECURITY DEFINER) escribe. Herramienta interna, sin pantalla: la lectura es del service_role
-- y de la API de administración (informe).
-- No toca create_supervisor_command ni ninguna regla de validación existente.
-- Idempotente: se puede correr dos veces.
-- ════════════════════════════════════════════════════════════════════════════

-- 1 ── Motivo exacto de un ajuste por lote inválido ──────────────────────────
CREATE OR REPLACE FUNCTION public.explain_supervisor_inventory_batch_payload(p_payload jsonb)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE
    v_line jsonb;
    v_previous jsonb;
    v_idx bigint;
    v_qty numeric;
    v_stock numeric;
    v_factor numeric;
    v_unit text;
    v_max_quantity numeric;
    v_bad_key text;
    v_allowed_line_keys text[] := ARRAY['productId', 'inputUnit', 'quantityInput', 'expectedStock', 'lineId', 'baseRevision', 'unitsPerPackage'];
    v_categories text[] := ARRAY['merma', 'danio', 'vencimiento', 'autoconsumo', 'devolucion', 'ajuste'];
BEGIN
    IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
        RETURN 'el payload no es un objeto';
    END IF;

    IF NOT (p_payload ? 'batchVersion') THEN
        IF coalesce(p_payload->>'direction', '') NOT IN ('ingreso', 'egreso') THEN RETURN 'v1: direction debe ser ingreso o egreso'; END IF;
        IF p_payload->>'direction' = 'egreso' AND NOT (coalesce(p_payload->>'reasonCategory', '') = ANY (v_categories)) THEN
            RETURN 'v1: egreso sin reasonCategory válida';
        END IF;
        IF coalesce(p_payload->>'productId', '') = '' THEN RETURN 'v1: falta productId'; END IF;
        IF coalesce(p_payload->>'inputUnit', '') NOT IN ('unidades', 'cajas', 'bultos') THEN RETURN 'v1: inputUnit no permitida: ' || coalesce(p_payload->>'inputUnit', '(vacía)'); END IF;
        IF coalesce(p_payload->>'quantityInput', '') !~ '^[0-9]+([.][0-9]+)?$' OR (p_payload->>'quantityInput')::numeric <= 0 THEN RETURN 'v1: quantityInput debe ser un número mayor que 0'; END IF;
        IF coalesce(p_payload->>'unitsPerPackage', '') !~ '^[0-9]+([.][0-9]+)?$' OR (p_payload->>'unitsPerPackage')::numeric <= 0 THEN RETURN 'v1: unitsPerPackage debe ser un número mayor que 0'; END IF;
        IF coalesce(p_payload->>'expectedStock', '') !~ '^-?[0-9]+([.][0-9]+)?$' OR (p_payload->>'expectedStock')::numeric NOT BETWEEN -10000000 AND 10000000 THEN RETURN 'v1: expectedStock inválido'; END IF;
        IF length(trim(coalesce(p_payload->>'reason', ''))) = 0 OR length(p_payload->>'reason') > 240 THEN RETURN 'v1: reason vacía o de más de 240 caracteres'; END IF;
        RETURN NULL;
    END IF;

    SELECT key INTO v_bad_key FROM jsonb_object_keys(p_payload) AS keys(key)
    WHERE key NOT IN ('batchVersion', 'direction', 'reason', 'reasonCategory', 'lotReference', 'lines')
    LIMIT 1;
    IF v_bad_key IS NOT NULL THEN RETURN 'campo no permitido en el lote: ' || v_bad_key; END IF;

    IF p_payload->'batchVersion' IS DISTINCT FROM '2'::jsonb THEN RETURN 'batchVersion debe ser 2'; END IF;
    IF coalesce(p_payload->>'direction', '') NOT IN ('ingreso', 'egreso') THEN RETURN 'direction debe ser ingreso o egreso'; END IF;
    IF jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string' OR length(trim(p_payload->>'reason')) = 0 OR length(p_payload->>'reason') > 240 THEN
        RETURN 'reason vacía o de más de 240 caracteres';
    END IF;
    IF p_payload ? 'lotReference' AND p_payload->'lotReference' <> 'null'::jsonb
       AND (jsonb_typeof(p_payload->'lotReference') <> 'string' OR length(trim(p_payload->>'lotReference')) = 0 OR length(p_payload->>'lotReference') > 128) THEN
        RETURN 'lotReference inválida';
    END IF;
    IF p_payload->>'direction' = 'egreso' AND NOT (coalesce(p_payload->>'reasonCategory', '') = ANY (v_categories)) THEN
        RETURN 'egreso sin reasonCategory válida';
    END IF;
    IF p_payload->>'direction' = 'ingreso' AND p_payload ? 'reasonCategory' AND NOT (coalesce(p_payload->>'reasonCategory', '') = ANY (v_categories)) THEN
        RETURN 'reasonCategory no permitida: ' || coalesce(p_payload->>'reasonCategory', '(null)');
    END IF;
    IF jsonb_typeof(p_payload->'lines') IS DISTINCT FROM 'array' THEN RETURN 'lines debe ser una lista'; END IF;
    IF jsonb_array_length(p_payload->'lines') < 1 OR jsonb_array_length(p_payload->'lines') > 50 THEN
        RETURN 'el lote debe tener entre 1 y 50 líneas (tiene ' || jsonb_array_length(p_payload->'lines') || ')';
    END IF;

    FOR v_line, v_idx IN SELECT value, ordinality FROM jsonb_array_elements(p_payload->'lines') WITH ORDINALITY LOOP
        IF jsonb_typeof(v_line) IS DISTINCT FROM 'object' THEN RETURN 'línea ' || v_idx || ': no es un objeto'; END IF;

        SELECT key INTO v_bad_key FROM jsonb_object_keys(v_line) AS keys(key)
        WHERE NOT (key = ANY (v_allowed_line_keys)) LIMIT 1;
        IF v_bad_key IS NOT NULL THEN RETURN 'línea ' || v_idx || ': campo no permitido: ' || v_bad_key; END IF;

        IF v_line ? 'unitsPerPackage' AND v_line->'unitsPerPackage' <> 'null'::jsonb AND v_line->>'inputUnit' NOT IN ('cajas', 'bultos') THEN
            RETURN 'línea ' || v_idx || ': unitsPerPackage solo se admite con cajas o bultos';
        END IF;
        IF jsonb_typeof(v_line->'productId') IS DISTINCT FROM 'string' OR length(trim(v_line->>'productId')) = 0 OR length(v_line->>'productId') > 128 THEN
            RETURN 'línea ' || v_idx || ': productId vacío, no es texto o es muy largo';
        END IF;
        IF jsonb_typeof(v_line->'inputUnit') IS DISTINCT FROM 'string' OR v_line->>'inputUnit' NOT IN ('unidades', 'cajas', 'bultos', 'kg', 'lt', 'g', 'ml') THEN
            RETURN 'línea ' || v_idx || ': inputUnit no permitida: ' || coalesce(v_line->>'inputUnit', '(vacía)');
        END IF;
        IF jsonb_typeof(v_line->'quantityInput') IS DISTINCT FROM 'number' THEN
            RETURN 'línea ' || v_idx || ': quantityInput debe ser número (llegó ' || coalesce(jsonb_typeof(v_line->'quantityInput'), 'nada') || ')';
        END IF;
        IF jsonb_typeof(v_line->'expectedStock') IS DISTINCT FROM 'number' THEN
            RETURN 'línea ' || v_idx || ': expectedStock debe ser número (llegó ' || coalesce(jsonb_typeof(v_line->'expectedStock'), 'nada') || ')';
        END IF;
        IF v_line ? 'lineId' AND v_line->'lineId' <> 'null'::jsonb
           AND (jsonb_typeof(v_line->'lineId') IS DISTINCT FROM 'string' OR length(trim(v_line->>'lineId')) = 0 OR length(v_line->>'lineId') > 128) THEN
            RETURN 'línea ' || v_idx || ': lineId inválido';
        END IF;
        IF v_line ? 'baseRevision' AND v_line->'baseRevision' <> 'null'::jsonb
           AND (jsonb_typeof(v_line->'baseRevision') IS DISTINCT FROM 'string' OR length(trim(v_line->>'baseRevision')) = 0 OR length(v_line->>'baseRevision') > 2048) THEN
            RETURN 'línea ' || v_idx || ': baseRevision inválida';
        END IF;

        v_qty := (v_line->>'quantityInput')::numeric;
        v_stock := (v_line->>'expectedStock')::numeric;
        v_unit := v_line->>'inputUnit';
        v_max_quantity := CASE v_unit
            WHEN 'unidades' THEN 100000 WHEN 'cajas' THEN 10000 WHEN 'bultos' THEN 10000
            WHEN 'kg' THEN 5000 WHEN 'lt' THEN 5000 WHEN 'g' THEN 5000000 WHEN 'ml' THEN 5000000 END;
        IF v_qty <= 0 OR v_qty > v_max_quantity THEN
            RETURN 'línea ' || v_idx || ': quantityInput ' || v_qty || ' fuera de rango (0, ' || v_max_quantity || '] para ' || v_unit;
        END IF;
        IF v_stock < -10000000 OR v_stock > 10000000 THEN RETURN 'línea ' || v_idx || ': expectedStock fuera de rango'; END IF;

        IF v_line ? 'unitsPerPackage' THEN
            IF jsonb_typeof(v_line->'unitsPerPackage') IS DISTINCT FROM 'number' THEN RETURN 'línea ' || v_idx || ': unitsPerPackage debe ser número'; END IF;
            v_factor := (v_line->>'unitsPerPackage')::numeric;
            IF v_factor < 1 OR v_factor > 10000 OR trunc(v_factor) <> v_factor THEN
                RETURN 'línea ' || v_idx || ': unitsPerPackage debe ser entero entre 1 y 10000';
            END IF;
        END IF;

        IF EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_payload->'lines') WITH ORDINALITY prior(value, ordinality)
            WHERE prior.ordinality < v_idx AND prior.value->>'productId' = v_line->>'productId' AND prior.value->>'inputUnit' = v_unit
        ) THEN
            RETURN 'línea ' || v_idx || ': producto y unidad repetidos en el lote';
        END IF;

        SELECT prior.value INTO v_previous
        FROM jsonb_array_elements(p_payload->'lines') WITH ORDINALITY prior(value, ordinality)
        WHERE prior.ordinality < v_idx AND prior.value->>'productId' = v_line->>'productId'
        ORDER BY prior.ordinality DESC LIMIT 1;
        IF v_previous IS NOT NULL
           AND ((v_previous->>'expectedStock')::numeric <> v_stock OR v_previous->'baseRevision' IS DISTINCT FROM v_line->'baseRevision') THEN
            RETURN 'línea ' || v_idx || ': el mismo producto trae otro expectedStock o baseRevision';
        END IF;
        v_previous := NULL;
    END LOOP;

    RETURN NULL;
EXCEPTION
    WHEN numeric_value_out_of_range OR invalid_text_representation THEN
        RETURN 'un número del lote no se pudo leer';
END;
$$;

REVOKE ALL ON FUNCTION public.explain_supervisor_inventory_batch_payload(jsonb) FROM PUBLIC, anon, authenticated;

-- 2 ── La caja negra ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.supervisor_command_failures (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    fingerprint text NOT NULL UNIQUE,
    actor_auth_id uuid NOT NULL,
    monitor_device_id text,
    target_device_id text,
    command_type text,
    stage text NOT NULL,
    error_message text NOT NULL,
    error_detail text,
    last_command_id text,
    last_payload jsonb,
    app_version text,
    occurrences integer NOT NULL DEFAULT 1,
    first_seen_at timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS supervisor_command_failures_last_seen_idx
    ON public.supervisor_command_failures (last_seen_at DESC);
CREATE INDEX IF NOT EXISTS supervisor_command_failures_target_idx
    ON public.supervisor_command_failures (target_device_id, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS supervisor_command_failures_actor_first_idx
    ON public.supervisor_command_failures (actor_auth_id, first_seen_at DESC);

ALTER TABLE public.supervisor_command_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.supervisor_command_failures FROM PUBLIC, anon, authenticated;

-- 3 ── Registrar un rechazo (lo llama el monitor) ────────────────────────────
CREATE OR REPLACE FUNCTION public.report_supervisor_command_failure(
    p_target_device_id text,
    p_monitor_device_id text,
    p_command_type text,
    p_stage text,
    p_error_message text,
    p_command_id text DEFAULT NULL,
    p_payload jsonb DEFAULT NULL,
    p_app_version text DEFAULT NULL
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_stage text := left(coalesce(nullif(trim(p_stage), ''), 'desconocido'), 40);
    v_error text := left(coalesce(nullif(trim(p_error_message), ''), '(sin mensaje)'), 500);
    v_type text := left(nullif(trim(p_command_type), ''), 80);
    v_target text := left(nullif(trim(p_target_device_id), ''), 128);
    v_detail text;
    v_payload jsonb := p_payload;
    v_fingerprint text;
    v_id bigint;
BEGIN
    IF v_actor IS NULL THEN
        RETURN json_build_object('ok', false, 'reason', 'sin sesión');
    END IF;

    -- Freno al abuso: como mucho 200 errores DISTINTOS nuevos por actor y día.
    -- Repetir uno ya conocido solo suma al contador.
    IF (SELECT count(*) FROM public.supervisor_command_failures
        WHERE actor_auth_id = v_actor AND first_seen_at > now() - interval '1 day') >= 200
       AND NOT EXISTS (SELECT 1 FROM public.supervisor_command_failures
                       WHERE actor_auth_id = v_actor AND target_device_id IS NOT DISTINCT FROM v_target
                         AND command_type IS NOT DISTINCT FROM v_type AND error_message = v_error) THEN
        RETURN json_build_object('ok', false, 'reason', 'límite diario');
    END IF;

    IF v_payload IS NOT NULL AND length(v_payload::text) > 16384 THEN
        v_payload := jsonb_build_object('_recortado', true, '_bytes', length(p_payload::text),
                                        '_inicio', left(p_payload::text, 2000));
    END IF;

    IF v_type = 'supervisor.inventory.batch.adjust' AND p_payload IS NOT NULL THEN
        v_detail := public.explain_supervisor_inventory_batch_payload(p_payload);
    END IF;

    v_fingerprint := md5(concat_ws('|', v_actor::text, v_target, v_type, v_stage, v_error, v_detail));

    INSERT INTO public.supervisor_command_failures AS f (
        fingerprint, actor_auth_id, monitor_device_id, target_device_id, command_type, stage,
        error_message, error_detail, last_command_id, last_payload, app_version
    ) VALUES (
        v_fingerprint, v_actor, left(nullif(trim(p_monitor_device_id), ''), 128), v_target, v_type, v_stage,
        v_error, v_detail, left(nullif(trim(p_command_id), ''), 128), v_payload, left(nullif(trim(p_app_version), ''), 40)
    )
    ON CONFLICT (fingerprint) DO UPDATE SET
        occurrences = f.occurrences + 1,
        last_seen_at = now(),
        last_command_id = coalesce(excluded.last_command_id, f.last_command_id),
        last_payload = coalesce(excluded.last_payload, f.last_payload),
        app_version = coalesce(excluded.app_version, f.app_version),
        monitor_device_id = coalesce(excluded.monitor_device_id, f.monitor_device_id)
    RETURNING id INTO v_id;

    -- Limpieza perezosa: lo que no se repite hace 30 días se borra (~1 de cada 50 llamadas).
    IF random() < 0.02 THEN
        DELETE FROM public.supervisor_command_failures WHERE last_seen_at < now() - interval '30 days';
    END IF;

    RETURN json_build_object('ok', true, 'id', v_id, 'detail', v_detail);
EXCEPTION WHEN OTHERS THEN
    -- La caja negra jamás rompe el flujo del monitor.
    RETURN json_build_object('ok', false, 'reason', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.report_supervisor_command_failure(text, text, text, text, text, text, jsonb, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.report_supervisor_command_failure(text, text, text, text, text, text, jsonb, text) TO authenticated;

-- 4 ── Vista de problemas (informe interno) ──────────────────────────────────
CREATE OR REPLACE VIEW public.supervisor_command_problems
WITH (security_invoker = true) AS
SELECT
    'rechazada_por_nube'::text AS kind,
    f.target_device_id,
    f.monitor_device_id,
    f.command_type,
    f.error_message,
    f.error_detail,
    f.occurrences,
    f.first_seen_at,
    f.last_seen_at,
    f.last_command_id AS command_id,
    f.app_version
FROM public.supervisor_command_failures f
UNION ALL
SELECT
    CASE WHEN c.status = 'pending' THEN 'vencida_sin_tomar' ELSE 'fallida_en_caja' END,
    c.target_device_id,
    NULL,
    c.command_type,
    coalesce(c.error_message, CASE WHEN c.status = 'pending' THEN 'La caja no tomó la orden antes de que venciera' ELSE c.status END),
    left(c.ack_payload::text, 500),
    1,
    c.issued_at,
    coalesce(c.updated_at, c.issued_at),
    c.command_id,
    NULL
FROM public.supervisor_commands c
WHERE c.issued_at > now() - interval '30 days'
  AND (c.status IN ('failed', 'rejected', 'expired')
       OR (c.status = 'pending' AND c.expires_at < now()));

REVOKE ALL ON TABLE public.supervisor_command_problems FROM PUBLIC, anon, authenticated;
