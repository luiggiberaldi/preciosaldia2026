-- MIGRACIÓN DE PRODUCCIÓN — HABILITAR TODAS LAS ÓRDENES DEL SUPERVISOR
--
-- Corrige el trigger heredado que todavía rechazaba productos con el mensaje
-- "Solo tasas e ingresos/egresos por lote están habilitados". También alinea
-- la RPC para que usuarios y turnos no vuelvan a ser rechazados después del
-- trigger. Los PIN llegan como hashes PBKDF2, nunca en texto plano.
--
-- Aplicar únicamente en:
--   https://sodgzkablshladvbtnes.supabase.co

BEGIN;

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
        IF coalesce(p_payload->>'rateMode', '') NOT IN ('bcv', 'euro', 'usdt', 'manual')
           OR (
                p_payload->>'rateMode' = 'manual'
                AND (
                    NULLIF(trim(p_payload->>'customRate'), '') IS NULL
                    OR (p_payload->>'customRate') !~ '^[0-9]+([.][0-9]+)?$'
                    OR (p_payload->>'customRate')::numeric <= 0
                )
           ) THEN
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
           OR jsonb_typeof(p_payload->'patch') <> 'object' THEN
            RAISE EXCEPTION 'Patch de producto inválido';
        END IF;
    ELSIF p_command_type = 'supervisor.product.delete' THEN
        IF coalesce(p_payload->>'productId', '') = '' THEN
            RAISE EXCEPTION 'Producto inválido';
        END IF;
    ELSIF p_command_type = 'supervisor.user.create' THEN
        IF coalesce(trim(p_payload->>'nombre'), '') = ''
           OR p_payload->>'rol' NOT IN ('CAJERO', 'ADMIN')
           OR coalesce(p_payload->>'pinHash', '') !~ '^pbkdf2\$[0-9]+\$[^$]+\$[^$]+$' THEN
            RAISE EXCEPTION 'Payload de usuario inválido';
        END IF;
    ELSIF p_command_type = 'supervisor.user.pin.change' THEN
        IF jsonb_typeof(p_payload->'userId') <> 'number'
           OR coalesce(p_payload->>'pinHash', '') !~ '^pbkdf2\$[0-9]+\$[^$]+\$[^$]+$' THEN
            RAISE EXCEPTION 'Payload de PIN inválido';
        END IF;
    ELSIF p_command_type = 'supervisor.user.update' THEN
        IF jsonb_typeof(p_payload->'userId') <> 'number'
           OR jsonb_typeof(p_payload->'patch') <> 'object' THEN
            RAISE EXCEPTION 'Patch de usuario inválido';
        END IF;
    ELSIF p_command_type IN ('supervisor.user.delete') THEN
        IF jsonb_typeof(p_payload->'userId') <> 'number' THEN
            RAISE EXCEPTION 'Usuario inválido';
        END IF;
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
           OR coalesce(p_payload->>'quantityInput', '') !~ '^[0-9]+([.][0-9]+)?$'
           OR coalesce((p_payload->>'quantityInput')::numeric, -1) <= 0
           OR coalesce(p_payload->>'unitsPerPackage', '') !~ '^[0-9]+([.][0-9]+)?$'
           OR coalesce((p_payload->>'unitsPerPackage')::numeric, -1) <= 0
           OR coalesce(p_payload->>'expectedStock', '') !~ '^[0-9]+([.][0-9]+)?$'
           OR coalesce((p_payload->>'expectedStock')::numeric, -1) < 0
           OR length(trim(coalesce(p_payload->>'reason', ''))) = 0
           OR length(p_payload->>'reason') > 240 THEN
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
        SELECT 1
        FROM public.device_pairings dp
        WHERE dp.primary_device_id = trim(p_target_device_id)
          AND dp.revoked_at IS NULL
          AND dp.monitor_auth_id = v_actor
    ) THEN
        RAISE EXCEPTION 'Monitor no autorizado para esa caja';
    END IF;

    SELECT * INTO v_existing
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
        command_id, target_device_id, actor_auth_id, command_type, payload, issued_at, expires_at
    ) VALUES (
        trim(p_command_id), trim(p_target_device_id), v_actor, p_command_type, p_payload, p_issued_at, p_expires_at
    );

    RETURN json_build_object(
        'command_id', trim(p_command_id),
        'status', 'pending',
        'created_at', now()
    );
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
           OR (NEW.payload->>'rateMode' = 'manual'
               AND (NULLIF(trim(NEW.payload->>'customRate'), '') IS NULL
                    OR NEW.payload->>'customRate' !~ '^[0-9]+([.][0-9]+)?$'
                    OR (NEW.payload->>'customRate')::numeric <= 0)) THEN
            RAISE EXCEPTION 'Payload de tasa inválido';
        END IF;
    ELSIF NEW.command_type = 'supervisor.product.create' THEN
        IF jsonb_typeof(NEW.payload->'product') <> 'object'
           OR coalesce(NEW.payload->'product'->>'id', '') = ''
           OR coalesce(NEW.payload->'product'->>'name', '') = '' THEN
            RAISE EXCEPTION 'Payload de producto inválido';
        END IF;
    ELSIF NEW.command_type = 'supervisor.product.update' THEN
        IF coalesce(NEW.payload->>'productId', '') = '' OR jsonb_typeof(NEW.payload->'patch') <> 'object' THEN
            RAISE EXCEPTION 'Patch de producto inválido';
        END IF;
    ELSIF NEW.command_type = 'supervisor.product.delete' THEN
        IF coalesce(NEW.payload->>'productId', '') = '' THEN RAISE EXCEPTION 'Producto inválido'; END IF;
    ELSIF NEW.command_type = 'supervisor.user.create' THEN
        IF coalesce(trim(NEW.payload->>'nombre'), '') = ''
           OR NEW.payload->>'rol' NOT IN ('CAJERO', 'ADMIN')
           OR coalesce(NEW.payload->>'pinHash', '') !~ '^pbkdf2\$[0-9]+\$[^$]+\$[^$]+$' THEN
            RAISE EXCEPTION 'Payload de usuario inválido';
        END IF;
    ELSIF NEW.command_type = 'supervisor.user.pin.change' THEN
        IF jsonb_typeof(NEW.payload->'userId') <> 'number'
           OR coalesce(NEW.payload->>'pinHash', '') !~ '^pbkdf2\$[0-9]+\$[^$]+\$[^$]+$' THEN
            RAISE EXCEPTION 'Payload de PIN inválido';
        END IF;
    ELSIF NEW.command_type = 'supervisor.user.update' THEN
        IF jsonb_typeof(NEW.payload->'userId') <> 'number' OR jsonb_typeof(NEW.payload->'patch') <> 'object' THEN
            RAISE EXCEPTION 'Patch de usuario inválido';
        END IF;
    ELSIF NEW.command_type = 'supervisor.user.delete' THEN
        IF jsonb_typeof(NEW.payload->'userId') <> 'number' THEN RAISE EXCEPTION 'Usuario inválido'; END IF;
    ELSIF NEW.command_type IN ('supervisor.shift.close', 'supervisor.shift.reopen') THEN
        IF coalesce(NEW.payload->>'shiftId', '') = '' OR coalesce(NEW.payload->>'cierreId', '') = '' THEN
            RAISE EXCEPTION 'Turno o cierre inválido';
        END IF;
    ELSIF NEW.command_type = 'supervisor.inventory.batch.adjust' THEN
        IF NEW.payload->>'direction' NOT IN ('ingreso', 'egreso')
           OR (NEW.payload->>'direction' = 'egreso'
               AND NEW.payload->>'reasonCategory' NOT IN ('merma', 'danio', 'vencimiento', 'autoconsumo', 'devolucion', 'ajuste')) THEN
            RAISE EXCEPTION 'Payload de ajuste por lote inválido';
        END IF;
    ELSE
        RAISE EXCEPTION 'Tipo de orden Supervisor no permitido';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.device_pairings dp
        WHERE dp.primary_device_id = trim(NEW.target_device_id)
          AND dp.monitor_device_id IS NOT NULL
          AND dp.monitor_device_id <> dp.primary_device_id
          AND dp.monitor_device_id <> trim(NEW.target_device_id)
          AND dp.monitor_auth_id = NEW.actor_auth_id
          AND dp.revoked_at IS NULL
    ) THEN
        RAISE EXCEPTION 'Monitor no vinculado o no autorizado para esa caja';
    END IF;

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
