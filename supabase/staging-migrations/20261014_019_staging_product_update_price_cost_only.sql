-- STAGING ONLY — 019: permite CRUD completo de producto desde el monitor
--      (todos los campos excepto id, synced_at, created_at, updated_at, _deleted)
-- Intended project ref: tdfcpwctvumbdjmifypd
-- Estado: APLICADO en Staging el 2026-10-14.
-- Do NOT run against production without review.
--
-- Solo cambia la rama supervisor.product.update. El resto de la función queda igual.
-- Los productos viven en bodega_products_v1 (JSON en la caja), no en una tabla.

BEGIN;

CREATE OR REPLACE FUNCTION public.create_supervisor_command(
    p_command_id       text,
    p_target_device_id text,
    p_command_type     text,
    p_payload          jsonb,
    p_issued_at        timestamptz,
    p_expires_at       timestamptz
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
    v_actor UUID := auth.uid();
    v_existing public.supervisor_commands%ROWTYPE;
    v_patch_key TEXT;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;

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

    IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
        RAISE EXCEPTION 'Payload inválido';
    END IF;

    IF p_command_type = 'supervisor.rate.set' THEN
        IF p_payload->>'rateMode' NOT IN ('bcv', 'euro', 'usdt', 'manual')
           OR (p_payload->>'rateMode' = 'manual' AND (
                (p_payload->>'customRate') IS NULL
                OR NOT ((p_payload->>'customRate') ~ '^[0-9]+([.][0-9]+)?$')
                OR (p_payload->>'customRate')::numeric <= 0
           )) THEN
            RAISE EXCEPTION 'Payload de tasa inválido';
        END IF;
    ELSIF p_command_type = 'supervisor.product.create' THEN
        IF jsonb_typeof(p_payload->'product') <> 'object'
           OR coalesce(p_payload->'product'->>'id', '') = ''
           OR coalesce(p_payload->'product'->>'name', '') = '' THEN
            RAISE EXCEPTION 'Payload de producto inválido';
        END IF;
    ELSIF p_command_type = 'supervisor.product.update' THEN
        IF coalesce(p_payload->>'productId', '') = ''
           OR jsonb_typeof(p_payload->'patch') <> 'object'
           OR p_payload->'patch' = '{}'::jsonb THEN
            RAISE EXCEPTION 'Patch de producto inválido';
        END IF;

        -- Claves prohibidas: identidad y metadatos de sincronización.
        FOR v_patch_key IN SELECT jsonb_object_keys(p_payload->'patch') LOOP
            IF v_patch_key IN ('id', 'synced_at', 'created_at', 'updated_at', '_deleted') THEN
                RAISE EXCEPTION 'Campo de producto no permitido remotamente: %', v_patch_key;
            END IF;
        END LOOP;

        -- price, cost y stock: número >= 0 (null o texto se rechazan).
        IF EXISTS (
            SELECT 1 FROM jsonb_each(p_payload->'patch') AS e(k, v)
            WHERE e.k IN ('price', 'cost', 'stock')
              AND (jsonb_typeof(e.v) <> 'number' OR (e.v)::text::numeric < 0)
        ) THEN
            RAISE EXCEPTION 'Precio, costo o stock inválido';
        END IF;

        -- name, si viene, no puede ser vacío.
        IF jsonb_exists(p_payload->'patch', 'name')
           AND (jsonb_typeof(p_payload->'patch'->'name') <> 'string'
                OR length(trim(p_payload->'patch'->>'name')) = 0) THEN
            RAISE EXCEPTION 'Nombre de producto inválido';
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
        IF p_payload->>'direction' NOT IN ('ingreso', 'egreso')
           OR (p_payload->>'direction' = 'egreso'
               AND p_payload->>'reasonCategory' NOT IN ('merma', 'danio', 'vencimiento', 'autoconsumo', 'devolucion', 'ajuste'))
           OR coalesce(p_payload->>'productId', '') = ''
           OR p_payload->>'inputUnit' NOT IN ('unidades', 'cajas', 'bultos')
           OR (p_payload->>'quantityInput') IS NULL
           OR NOT ((p_payload->>'quantityInput') ~ '^[0-9]+([.][0-9]+)?$')
           OR (p_payload->>'quantityInput')::numeric <= 0
           OR (p_payload->>'unitsPerPackage') IS NULL
           OR NOT ((p_payload->>'unitsPerPackage') ~ '^[0-9]+([.][0-9]+)?$')
           OR (p_payload->>'unitsPerPackage')::numeric <= 0
           OR (p_payload->>'expectedStock') IS NULL
           OR NOT ((p_payload->>'expectedStock') ~ '^[0-9]+([.][0-9]+)?$')
           OR (p_payload->>'expectedStock')::numeric < 0
           OR length(trim(coalesce(p_payload->>'reason', ''))) = 0
           OR length(p_payload->>'reason') > 240 THEN
            RAISE EXCEPTION 'Payload de ingreso por lote inválido';
        END IF;
    END IF;

    IF p_issued_at < now() - interval '2 minutes'
       OR p_issued_at > now() + interval '2 minutes'
       OR p_expires_at <= p_issued_at
       OR p_expires_at > now() + interval '90 seconds' THEN
        RAISE EXCEPTION 'Ventana temporal inválida';
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.device_pairings dp
        WHERE dp.primary_device_id = trim(p_target_device_id)
          AND dp.revoked_at IS NULL
          AND dp.monitor_auth_id = v_actor
    ) THEN
        RAISE EXCEPTION 'Monitor no autorizado para esa caja';
    END IF;

    SELECT *
    INTO v_existing
    FROM public.supervisor_commands
    WHERE command_id = trim(p_command_id)
    FOR UPDATE;

    IF FOUND THEN
        IF v_existing.actor_auth_id <> v_actor
           OR v_existing.target_device_id <> trim(p_target_device_id)
           OR v_existing.command_type <> p_command_type
           OR v_existing.payload <> p_payload THEN
            RAISE EXCEPTION 'command_id ya utilizado con otro payload';
        END IF;

        RETURN json_build_object(
            'command_id', v_existing.command_id,
            'status', v_existing.status,
            'created_at', v_existing.created_at
        );
    END IF;

    INSERT INTO public.supervisor_commands (
        command_id,
        target_device_id,
        actor_auth_id,
        command_type,
        payload,
        issued_at,
        expires_at
    ) VALUES (
        trim(p_command_id),
        trim(p_target_device_id),
        v_actor,
        p_command_type,
        p_payload,
        p_issued_at,
        p_expires_at
    );

    RETURN json_build_object(
        'command_id', trim(p_command_id),
        'status', 'pending',
        'created_at', now()
    );
END;
$function$;

REVOKE ALL ON FUNCTION public.create_supervisor_command(text, text, text, jsonb, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_supervisor_command(text, text, text, jsonb, timestamptz, timestamptz) TO authenticated, service_role;

COMMIT;
