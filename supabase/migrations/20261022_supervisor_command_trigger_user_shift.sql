-- Delta del checklist de migraciones pendientes de producción (ítem 2).
--
-- El trigger supervisor_income_pairing_guard vigente en producción es el de
-- 20261018_supervisor_product_delete.sql: valida tasa, producto (create/update/
-- delete) y lote, y rechaza todo lo demás con un genérico. Eso deja dos huecos:
--
--   1. supervisor.shift.close / supervisor.shift.reopen quedan rechazados por
--      el trigger aunque el resto de la cadena los soporta (CHECK constraint,
--      RPC create_supervisor_command con validación de shiftId/cierreId, y el
--      receptor de useRemoteCommands). Feature-ready salvo esta puerta.
--
--   2. supervisor.user.* cae en el ELSE genérico sin explicar el motivo. El
--      bloqueo de gestión remota de usuarios es DELIBERADO y se mantiene:
--      20261016_supervisor_inventory_batch_v2 (registrada en producción) la
--      rechaza en la RPC con «Gestión remota de usuarios requiere un flujo de
--      credencial segura». Este delta solo hace que el trigger coincida con
--      esa decisión y la explique con el mismo mensaje, en vez del genérico.
--
--      NOTA: si algún día se habilita la gestión remota de usuarios, primero
--      hay que diseñar el flujo de credencial segura y actualizar la RPC; no
--      basta con quitar la rama del trigger.
--
-- El cuerpo copia literalmente las validaciones de 20261018 (tasa, producto,
-- lote, guardia de pairing de dos supervisores) y agrega las ramas faltantes.
-- Idempotente: CREATE OR REPLACE + DROP TRIGGER IF EXISTS + CREATE TRIGGER.

BEGIN;

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
    ELSIF NEW.command_type IN ('supervisor.shift.close', 'supervisor.shift.reopen') THEN
        IF coalesce(NEW.payload->>'shiftId', '') = ''
           OR coalesce(NEW.payload->>'cierreId', '') = ''
           OR length(NEW.payload->>'shiftId') > 128
           OR length(NEW.payload->>'cierreId') > 128 THEN
            RAISE EXCEPTION 'Turno o cierre inválido';
        END IF;
    ELSIF NEW.command_type LIKE 'supervisor.user.%' THEN
        -- Bloqueo deliberado (mismo mensaje y motivo que la RPC de
        -- 20261016_supervisor_inventory_batch_v2): ver el encabezado.
        RAISE EXCEPTION 'Gestión remota de usuarios requiere un flujo de credencial segura';
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

REVOKE ALL ON FUNCTION public.enforce_supervisor_income_command() FROM PUBLIC, anon, authenticated;

COMMIT;
