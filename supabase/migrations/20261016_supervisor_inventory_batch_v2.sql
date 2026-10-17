-- Migración aditiva: validación compatible v1/v2 para comandos de inventario.
-- No cambia estados, claim ni ACK.

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
           OR coalesce(p_payload->>'expectedStock', '') !~ '^[0-9]+([.][0-9]+)?$'
           OR coalesce((p_payload->>'expectedStock')::numeric, -1) < 0
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
        IF v_qty <= 0 OR v_qty > v_max_quantity OR v_stock < 0 OR v_stock > 10000000 THEN
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

CREATE OR REPLACE FUNCTION public.create_supervisor_command(
    p_command_id       TEXT,
    p_target_device_id TEXT,
    p_command_type     TEXT,
    p_payload          JSONB,
    p_issued_at        TIMESTAMPTZ,
    p_expires_at       TIMESTAMPTZ
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_existing public.supervisor_commands%ROWTYPE;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'Sesión no autenticada'; END IF;
    IF p_command_id IS NULL OR length(trim(p_command_id)) < 8 OR length(trim(p_command_id)) > 128 THEN
        RAISE EXCEPTION 'command_id inválido';
    END IF;
    IF p_command_type IS NULL OR p_command_type NOT IN (
        'supervisor.rate.set',
        'supervisor.product.create',
        'supervisor.product.update',
        'supervisor.product.delete',
        'supervisor.user.create',
        'supervisor.user.pin.change',
        'supervisor.user.update',
        'supervisor.user.delete',
        'supervisor.shift.close',
        'supervisor.shift.reopen',
        'supervisor.inventory.batch.adjust'
    ) THEN
        RAISE EXCEPTION 'Tipo de comando no permitido';
    END IF;
    IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'Payload inválido'; END IF;

    IF p_command_type = 'supervisor.rate.set' THEN
        IF coalesce(p_payload->>'rateMode', '') NOT IN ('bcv', 'euro', 'usdt', 'manual')
           OR (p_payload->>'rateMode' = 'manual' AND (
                NULLIF(trim(p_payload->>'customRate'), '') IS NULL
                OR (p_payload->>'customRate') !~ '^[0-9]+([.][0-9]+)?$'
                OR (p_payload->>'customRate')::numeric <= 0)) THEN
            RAISE EXCEPTION 'Payload de tasa inválido';
        END IF;
    ELSIF p_command_type = 'supervisor.product.create' THEN
        IF jsonb_typeof(p_payload->'product') <> 'object'
           OR coalesce(p_payload->'product'->>'id', '') = ''
           OR coalesce(p_payload->'product'->>'name', '') = '' THEN RAISE EXCEPTION 'Payload de producto inválido'; END IF;
    ELSIF p_command_type = 'supervisor.product.update' THEN
        IF coalesce(p_payload->>'productId', '') = ''
           OR jsonb_typeof(p_payload->'patch') <> 'object' THEN
            RAISE EXCEPTION 'Patch de producto inválido';
        END IF;
    ELSIF p_command_type = 'supervisor.product.delete' THEN
        IF coalesce(p_payload->>'productId', '') = '' THEN
            RAISE EXCEPTION 'Producto inválido';
        END IF;
    ELSIF p_command_type LIKE 'supervisor.user.%' THEN
        RAISE EXCEPTION 'Gestión remota de usuarios requiere un flujo de credencial segura';
    ELSIF p_command_type IN ('supervisor.shift.close', 'supervisor.shift.reopen') THEN
        IF coalesce(p_payload->>'shiftId', '') = ''
           OR coalesce(p_payload->>'cierreId', '') = ''
           OR length(p_payload->>'shiftId') > 128
           OR length(p_payload->>'cierreId') > 128 THEN
            RAISE EXCEPTION 'Turno o cierre inválido';
        END IF;
    ELSIF p_command_type = 'supervisor.inventory.batch.adjust' THEN
        IF NOT public.is_valid_supervisor_inventory_batch_payload(p_payload) THEN
            RAISE EXCEPTION 'Payload de ajuste por lote inválido';
        END IF;
    END IF;

    IF p_issued_at < now() - interval '2 minutes'
       OR p_issued_at > now() + interval '2 minutes'
       OR p_expires_at <= p_issued_at
       OR p_expires_at - p_issued_at > interval '60 seconds'
       OR p_expires_at <= now() THEN
        RAISE EXCEPTION 'Ventana temporal inválida';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.device_pairings dp
        WHERE dp.primary_device_id = trim(p_target_device_id) AND dp.revoked_at IS NULL
          AND ((dp.monitor_device_id IS NOT NULL AND dp.monitor_device_id <> dp.primary_device_id
                AND dp.monitor_device_id <> trim(p_target_device_id) AND dp.monitor_auth_id = v_actor)
            OR (dp.monitor_device_id_2 IS NOT NULL AND dp.monitor_device_id_2 <> dp.primary_device_id
                AND dp.monitor_device_id_2 <> trim(p_target_device_id) AND dp.monitor_auth_id_2 = v_actor))
    ) THEN RAISE EXCEPTION 'Monitor no autorizado para esa caja'; END IF;

    SELECT * INTO v_existing FROM public.supervisor_commands
    WHERE command_id = trim(p_command_id) FOR UPDATE;
    IF FOUND THEN
        IF v_existing.actor_auth_id <> v_actor OR v_existing.target_device_id <> trim(p_target_device_id)
           OR v_existing.command_type <> p_command_type OR v_existing.payload <> p_payload THEN
            RAISE EXCEPTION 'command_id ya utilizado con otro payload';
        END IF;
        RETURN json_build_object('command_id', v_existing.command_id, 'status', v_existing.status,
                                 'created_at', v_existing.created_at);
    END IF;

    INSERT INTO public.supervisor_commands (
        command_id, target_device_id, actor_auth_id, command_type, payload, issued_at, expires_at
    ) VALUES (trim(p_command_id), trim(p_target_device_id), v_actor, p_command_type, p_payload, p_issued_at, p_expires_at);
    RETURN json_build_object('command_id', trim(p_command_id), 'status', 'pending', 'created_at', now());
END;
$$;

DROP TRIGGER IF EXISTS supervisor_income_pairing_guard ON public.supervisor_commands;

CREATE OR REPLACE FUNCTION public.enforce_supervisor_income_command()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF NEW.command_type = 'supervisor.rate.set' THEN
        IF coalesce(NEW.payload->>'rateMode', '') NOT IN ('bcv', 'euro', 'usdt', 'manual')
           OR (NEW.payload->>'rateMode' = 'manual' AND (
                NULLIF(trim(NEW.payload->>'customRate'), '') IS NULL
                OR NEW.payload->>'customRate' !~ '^[0-9]+([.][0-9]+)?$'
                OR (NEW.payload->>'customRate')::numeric <= 0)) THEN RAISE EXCEPTION 'Payload de tasa inválido'; END IF;
    ELSIF NEW.command_type = 'supervisor.product.create' THEN
        IF jsonb_typeof(NEW.payload->'product') <> 'object' OR coalesce(NEW.payload->'product'->>'id', '') = ''
           OR coalesce(NEW.payload->'product'->>'name', '') = '' THEN RAISE EXCEPTION 'Payload de producto inválido'; END IF;
    ELSIF NEW.command_type = 'supervisor.product.update' THEN
        IF coalesce(NEW.payload->>'productId', '') = '' OR jsonb_typeof(NEW.payload->'patch') <> 'object' THEN
            RAISE EXCEPTION 'Patch de producto inválido';
        END IF;
    ELSIF NEW.command_type = 'supervisor.inventory.batch.adjust' THEN
        IF NOT public.is_valid_supervisor_inventory_batch_payload(NEW.payload) THEN
            RAISE EXCEPTION 'Payload de ajuste por lote inválido';
        END IF;
    ELSE
        RAISE EXCEPTION 'Tipo de orden Supervisor no permitido';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.device_pairings dp
        WHERE dp.primary_device_id = trim(NEW.target_device_id) AND dp.revoked_at IS NULL
          AND ((dp.monitor_device_id IS NOT NULL AND dp.monitor_device_id <> dp.primary_device_id
                AND dp.monitor_device_id <> trim(NEW.target_device_id) AND dp.monitor_auth_id = NEW.actor_auth_id)
            OR (dp.monitor_device_id_2 IS NOT NULL AND dp.monitor_device_id_2 <> dp.primary_device_id
                AND dp.monitor_device_id_2 <> trim(NEW.target_device_id) AND dp.monitor_auth_id_2 = NEW.actor_auth_id))
    ) THEN RAISE EXCEPTION 'Monitor no vinculado o no autorizado para esa caja'; END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER supervisor_income_pairing_guard
    BEFORE INSERT ON public.supervisor_commands
    FOR EACH ROW EXECUTE FUNCTION public.enforce_supervisor_income_command();

REVOKE ALL ON FUNCTION public.create_supervisor_command(text, text, text, jsonb, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.enforce_supervisor_income_command() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_supervisor_command(text, text, text, jsonb, timestamptz, timestamptz) TO authenticated;

COMMIT;
