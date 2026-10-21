-- STAGING ONLY — 020: el trigger de supervisor_commands deja pasar productos,
--      egreso por lote y turnos. La validación detallada de cada payload vive en
--      create_supervisor_command (019). Sigue exigiendo monitor vinculado.
-- Intended project ref: tdfcpwctvumbdjmifypd
-- Do NOT run against production.

CREATE OR REPLACE FUNCTION public.enforce_supervisor_income_command()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
    -- Permitir tasas, productos (crear, editar, borrar), inventario por lote (ingreso y egreso) y turnos
    IF NEW.command_type = 'supervisor.rate.set' THEN
        IF coalesce(NEW.payload->>'rateMode', '') NOT IN ('bcv', 'euro', 'usdt', 'manual')
           OR (
                NEW.payload->>'rateMode' = 'manual'
                AND (
                    NULLIF(trim(NEW.payload->>'customRate'), '') IS NULL
                    OR (NEW.payload->>'customRate') !~ '^[0-9]+([.][0-9]+)?$'
                    OR (NEW.payload->>'customRate')::numeric <= 0
                )
           ) THEN
            RAISE EXCEPTION 'Payload de tasa inválido';
        END IF;
    ELSIF NEW.command_type IN ('supervisor.product.create', 'supervisor.product.update', 'supervisor.product.delete') THEN
        -- Permitir comandos de producto (la validación detallada vive en create_supervisor_command)
        NULL;
    ELSIF NEW.command_type = 'supervisor.inventory.batch.adjust' THEN
        -- Permitir tanto ingreso como egreso
        NULL;
    ELSIF NEW.command_type IN ('supervisor.shift.close', 'supervisor.shift.reopen') THEN
        NULL;
    ELSE
        RAISE EXCEPTION 'Comando no permitido remotamente';
    END IF;

    -- Validar que el monitor esté vinculado activamente a la caja
    IF NOT EXISTS (
        SELECT 1
        FROM public.device_pairings dp
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
$function$;
