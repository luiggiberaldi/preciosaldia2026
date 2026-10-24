-- Migración aditiva (2026-10-23): expectedStock negativo en inventario.
-- Los productos en saldo negativo (allow_negative_stock y desfase histórico de
-- bultos/unidades) no eran ajustables remotamente: el contrato del servidor
-- rechazaba expectedStock < 0 con 'Payload de ajuste por lote inválido' aunque
-- el contrato cliente (INVENTORY_MAX_EXPECTED_STOCK) y la caja ya lo admiten.
-- expectedStock describe la BASE real de la caja, no un objetivo: se acota
-- simétricamente ±10_000_000 (misma cota que src/services/supervisorContracts.js).
-- Solo se relaja esa cota; el resto de la validación (unidades, factores,
-- líneas duplicadas, base consistente) queda idéntico. La RPC
-- create_supervisor_command y el trigger enforce_supervisor_income_command
-- delegan en esta función, así que ambos caminos se abren juntos.
-- Reversión: restaurar en esta misma función las dos cotas previas
--   (regex '^[0-9]+([.][0-9]+)?$' + `< 0` en v1, y `v_stock < 0` en v2).

BEGIN;

CREATE OR REPLACE FUNCTION public.is_valid_supervisor_inventory_batch_payload(p_payload jsonb)
RETURNS boolean
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
    v_previous_stock numeric;
    v_unit text;
    v_max_quantity numeric;
BEGIN
    IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN
        RETURN false;
    END IF;

    -- Sin batchVersion se conserva el contrato plano v1 tal cual.
    IF NOT (p_payload ? 'batchVersion') THEN
        IF coalesce(p_payload->>'direction', '') NOT IN ('ingreso', 'egreso')
           OR (p_payload->>'direction' = 'egreso'
               AND coalesce(p_payload->>'reasonCategory', '') NOT IN ('merma', 'danio', 'vencimiento', 'autoconsumo', 'devolucion', 'ajuste'))
           OR coalesce(p_payload->>'productId', '') = ''
           OR coalesce(p_payload->>'inputUnit', '') NOT IN ('unidades', 'cajas', 'bultos')
           OR coalesce(p_payload->>'quantityInput', '') !~ '^[0-9]+([.][0-9]+)?$'
           OR coalesce((p_payload->>'quantityInput')::numeric, -1) <= 0
           OR coalesce(p_payload->>'unitsPerPackage', '') !~ '^[0-9]+([.][0-9]+)?$'
           OR coalesce((p_payload->>'unitsPerPackage')::numeric, -1) <= 0
           -- expectedStock puede ser negativo (saldo negativo legítimo): se
           -- admite signo y se acota simétricamente como el contrato cliente.
           OR coalesce(p_payload->>'expectedStock', '') !~ '^-?[0-9]+([.][0-9]+)?$'
           OR coalesce((p_payload->>'expectedStock')::numeric, 0) NOT BETWEEN -10000000 AND 10000000
           OR length(trim(coalesce(p_payload->>'reason', ''))) = 0
           OR length(p_payload->>'reason') > 240 THEN
            RETURN false;
        END IF;
        RETURN true;
    END IF;

    IF EXISTS (
        SELECT 1 FROM jsonb_object_keys(p_payload) AS keys(key)
        WHERE key NOT IN ('batchVersion', 'direction', 'reason', 'reasonCategory', 'lotReference', 'lines')
    ) THEN
        RETURN false;
    END IF;

    IF p_payload->'batchVersion' IS DISTINCT FROM '2'::jsonb
       OR coalesce(p_payload->>'direction', '') NOT IN ('ingreso', 'egreso')
       OR jsonb_typeof(p_payload->'reason') IS DISTINCT FROM 'string'
       OR length(trim(p_payload->>'reason')) = 0
       OR length(p_payload->>'reason') > 240
       OR (p_payload ? 'lotReference'
           AND p_payload->'lotReference' <> 'null'::jsonb
           AND (jsonb_typeof(p_payload->'lotReference') <> 'string'
                OR length(trim(p_payload->>'lotReference')) = 0
                OR length(p_payload->>'lotReference') > 128))
       OR (p_payload->>'direction' = 'egreso'
           AND coalesce(p_payload->>'reasonCategory', '') NOT IN ('merma', 'danio', 'vencimiento', 'autoconsumo', 'devolucion', 'ajuste'))
       OR (p_payload->>'direction' = 'ingreso'
           AND p_payload ? 'reasonCategory'
           AND coalesce(p_payload->>'reasonCategory', '') NOT IN ('merma', 'danio', 'vencimiento', 'autoconsumo', 'devolucion', 'ajuste'))
       OR jsonb_typeof(p_payload->'lines') IS DISTINCT FROM 'array' THEN
        RETURN false;
    END IF;
    IF jsonb_array_length(p_payload->'lines') < 1 OR jsonb_array_length(p_payload->'lines') > 50 THEN
        RETURN false;
    END IF;

    FOR v_line, v_idx IN
        SELECT value, ordinality
        FROM jsonb_array_elements(p_payload->'lines') WITH ORDINALITY
    LOOP
        IF jsonb_typeof(v_line) IS DISTINCT FROM 'object' THEN
            RETURN false;
        END IF;
        IF EXISTS (
            SELECT 1 FROM jsonb_object_keys(v_line) AS keys(key)
            WHERE key NOT IN ('productId', 'inputUnit', 'quantityInput', 'expectedStock', 'lineId', 'baseRevision', 'unitsPerPackage')
        ) THEN
            RETURN false;
        END IF;
        IF (v_line ? 'unitsPerPackage' AND v_line->'unitsPerPackage' <> 'null'::jsonb
            AND v_line->>'inputUnit' NOT IN ('cajas', 'bultos'))
           OR jsonb_typeof(v_line->'productId') IS DISTINCT FROM 'string'
           OR length(trim(v_line->>'productId')) = 0
           OR length(v_line->>'productId') > 128
           OR jsonb_typeof(v_line->'inputUnit') IS DISTINCT FROM 'string'
           OR v_line->>'inputUnit' NOT IN ('unidades', 'cajas', 'bultos', 'kg', 'lt', 'g', 'ml')
           OR jsonb_typeof(v_line->'quantityInput') IS DISTINCT FROM 'number'
           OR jsonb_typeof(v_line->'expectedStock') IS DISTINCT FROM 'number'
           OR (v_line ? 'lineId' AND v_line->'lineId' <> 'null'::jsonb
               AND (jsonb_typeof(v_line->'lineId') IS DISTINCT FROM 'string'
                    OR length(trim(v_line->>'lineId')) = 0
                    OR length(v_line->>'lineId') > 128))
           OR (v_line ? 'baseRevision' AND v_line->'baseRevision' <> 'null'::jsonb
               AND (jsonb_typeof(v_line->'baseRevision') IS DISTINCT FROM 'string'
                    OR length(trim(v_line->>'baseRevision')) = 0
                    OR length(v_line->>'baseRevision') > 2048)) THEN
            RETURN false;
        END IF;

        v_qty := (v_line->>'quantityInput')::numeric;
        v_stock := (v_line->>'expectedStock')::numeric;
        v_unit := v_line->>'inputUnit';
        v_max_quantity := CASE v_unit
            WHEN 'unidades' THEN 100000
            WHEN 'cajas' THEN 10000
            WHEN 'bultos' THEN 10000
            WHEN 'kg' THEN 5000
            WHEN 'lt' THEN 5000
            WHEN 'g' THEN 5000000
            WHEN 'ml' THEN 5000000
        END;
        -- expectedStock negativo es una base legítima (saldo negativo); misma
        -- cota simétrica que INVENTORY_MAX_EXPECTED_STOCK en el contrato cliente.
        IF v_qty <= 0 OR v_qty > v_max_quantity OR v_stock < -10000000 OR v_stock > 10000000 THEN
            RETURN false;
        END IF;

        IF v_line ? 'unitsPerPackage' THEN
            IF jsonb_typeof(v_line->'unitsPerPackage') IS DISTINCT FROM 'number' THEN
                RETURN false;
            END IF;
            v_factor := (v_line->>'unitsPerPackage')::numeric;
            IF v_factor < 1 OR v_factor > 10000 OR trunc(v_factor) <> v_factor THEN
                RETURN false;
            END IF;
        END IF;

        -- Rechaza productos/unidades repetidos y exige una misma base de stock
        -- si un producto aparece expresado en más de una unidad.
        IF EXISTS (
            SELECT 1
            FROM jsonb_array_elements(p_payload->'lines') WITH ORDINALITY prior(value, ordinality)
            WHERE prior.ordinality < v_idx
              AND prior.value->>'productId' = v_line->>'productId'
              AND prior.value->>'inputUnit' = v_unit
        ) THEN
            RETURN false;
        END IF;

        SELECT prior.value INTO v_previous
        FROM jsonb_array_elements(p_payload->'lines') WITH ORDINALITY prior(value, ordinality)
        WHERE prior.ordinality < v_idx
          AND prior.value->>'productId' = v_line->>'productId'
        ORDER BY prior.ordinality DESC
        LIMIT 1;
        IF v_previous IS NOT NULL THEN
            v_previous_stock := (v_previous->>'expectedStock')::numeric;
            IF v_previous_stock <> v_stock
               OR v_previous->'baseRevision' IS DISTINCT FROM v_line->'baseRevision' THEN
                RETURN false;
            END IF;
        END IF;
    END LOOP;

    RETURN true;
EXCEPTION
    WHEN numeric_value_out_of_range OR invalid_text_representation THEN
        RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.is_valid_supervisor_inventory_batch_payload(jsonb) FROM PUBLIC, anon, authenticated;

COMMIT;
