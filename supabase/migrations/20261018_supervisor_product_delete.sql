-- Habilita la baja de productos desde el Supervisor (supervisor.product.delete).
--
-- Era el único comando de catálogo que el trigger seguía rechazando con
-- 'Tipo de orden Supervisor no permitido', aunque la RPC
-- create_supervisor_command (allowlist + validación), el CHECK constraint
-- supervisor_commands_command_type_check y el cliente ya lo permitían.
-- La validación de payload es la MISMA que la RPC: productId no vacío.
-- No cambia estados, claim ni ACK; solo amplía la superficie del trigger.

BEGIN;

-- El CHECK constraint se reafirma con la lista canónica de tipos (ya incluye la
-- baja): ninguna restricción rezagada puede rechazar la fila después del trigger.
ALTER TABLE public.supervisor_commands
    DROP CONSTRAINT IF EXISTS supervisor_commands_command_type_check;

ALTER TABLE public.supervisor_commands
    ADD CONSTRAINT supervisor_commands_command_type_check
    CHECK (command_type IN (
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
    ));

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
    ELSIF NEW.command_type = 'supervisor.product.delete' THEN
        IF coalesce(NEW.payload->>'productId', '') = '' THEN
            RAISE EXCEPTION 'Producto inválido';
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
