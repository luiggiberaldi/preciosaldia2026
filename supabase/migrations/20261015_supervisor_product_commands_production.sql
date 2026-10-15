-- MIGRACIÓN DE PRODUCCIÓN — CREAR Y EDITAR PRODUCTOS DESDE SUPERVISOR
--
-- La RPC create_supervisor_command ya reconoce los comandos de producto, pero
-- el trigger heredado solo permitía tasas e ingresos/egresos por lote.
-- Esta migración alinea ese trigger con la política actual del frontend:
--   - habilita supervisor.product.create
--   - habilita supervisor.product.update
--   - mantiene bloqueados usuarios, turnos y eliminación de productos
--
-- Aplicar solo en el proyecto de producción:
-- sodgzkablshladvbtnes.supabase.co
--
-- ROLLBACK: restaurar el trigger con solo supervisor.rate.set y
-- supervisor.inventory.batch.adjust, y volver a desactivar la bandera de
-- productos en el frontend.

BEGIN;

DROP TRIGGER IF EXISTS supervisor_income_pairing_guard
    ON public.supervisor_commands;

CREATE OR REPLACE FUNCTION public.enforce_supervisor_income_command()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
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
    ELSIF NEW.command_type = 'supervisor.product.create' THEN
        IF jsonb_typeof(NEW.payload->'product') <> 'object'
           OR coalesce(NEW.payload->'product'->>'id', '') = ''
           OR coalesce(NEW.payload->'product'->>'name', '') = '' THEN
            RAISE EXCEPTION 'Payload de producto inválido';
        END IF;
    ELSIF NEW.command_type = 'supervisor.product.update' THEN
        IF coalesce(NEW.payload->>'productId', '') = ''
           OR jsonb_typeof(NEW.payload->'patch') <> 'object' THEN
            RAISE EXCEPTION 'Patch de producto inválido';
        END IF;
    ELSIF NEW.command_type = 'supervisor.inventory.batch.adjust' THEN
        IF coalesce(NEW.payload->>'direction', '') NOT IN ('ingreso', 'egreso')
           OR (
                NEW.payload->>'direction' = 'egreso'
                AND coalesce(NEW.payload->>'reasonCategory', '') NOT IN (
                    'merma', 'danio', 'vencimiento', 'autoconsumo', 'devolucion', 'ajuste'
                )
           ) THEN
            RAISE EXCEPTION 'Payload de ajuste por lote inválido';
        END IF;
    ELSE
        RAISE EXCEPTION 'Este tipo de orden Supervisor no está habilitado';
    END IF;

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
$$;

CREATE TRIGGER supervisor_income_pairing_guard
    BEFORE INSERT ON public.supervisor_commands
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_supervisor_income_command();

REVOKE ALL ON FUNCTION public.enforce_supervisor_income_command() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_supervisor_income_command() TO authenticated;

COMMIT;
