-- Ventas remotas desde el Supervisor: supervisor.sale.create
-- (plan 2026-10-29, F1). El monitor arma y cobra una venta de CONTADO; la caja
-- principal la re-precia con su catálogo y la registra con su pipeline normal.
--
-- Mismas tres puertas que 20261026, más un validador de forma compartido:
--   0. is_valid_supervisor_sale_payload(jsonb) — espejo de
--      validateRemoteSalePayload (src/services/supervisorSaleCommand.js).
--   1. CHECK supervisor_commands_command_type_check (+ supervisor.sale.create).
--   2. RPC create_supervisor_command (allowlist + payload + TTL de 2 minutos).
--   3. Trigger enforce_supervisor_income_command (payload + pairing).
-- Paridad sellada por tests/supervisorSaleCommandsSql.test.js.
--
-- El servidor solo valida FORMA (G8). Precio, turno abierto, métodos activos,
-- pago completo y existencia los decide la caja al aplicar (ACK 'rejected' con
-- motivo real): el servidor no conoce el catálogo ni la caja.
--
-- TTL 2 minutos: una venta que la caja no toma en ese lapso caduca y el
-- monitor la cancela; una vez tomada ('received') ya no caduca.
--
-- Idempotente: CREATE OR REPLACE + DROP CONSTRAINT IF EXISTS + DROP/CREATE TRIGGER.
-- ORDEN DE ROLLOUT: aplicar ANTES de desplegar el monitor con el flag activo.
-- Una caja vieja responde 'failed' «Tipo de comando no soportado» sin aplicar nada.

BEGIN;

-- Número JSON o NULL (nunca lanza): permite comparar sin depender del orden
-- de evaluación de OR, que PostgreSQL no garantiza.
CREATE OR REPLACE FUNCTION public.supervisor_json_number(p_value JSONB)
RETURNS NUMERIC
LANGUAGE sql
IMMUTABLE
SET search_path = public, extensions
AS $$
    SELECT CASE WHEN jsonb_typeof(p_value) = 'number' THEN (p_value #>> '{}')::numeric END;
$$;

REVOKE ALL ON FUNCTION public.supervisor_json_number(jsonb) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.is_valid_supervisor_sale_payload(p_payload JSONB)
RETURNS BOOLEAN
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, extensions
AS $$
DECLARE
    v_item JSONB;
    v_payment JSONB;
    v_num NUMERIC;
BEGIN
    IF jsonb_typeof(p_payload) IS DISTINCT FROM 'object' THEN RETURN FALSE; END IF;
    IF coalesce(p_payload->>'v', '') <> '1' THEN RETURN FALSE; END IF;
    IF coalesce(p_payload->>'saleId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' THEN
        RETURN FALSE;
    END IF;

    IF trim(coalesce(p_payload->'seller'->>'name', '')) = '' THEN RETURN FALSE; END IF;
    IF length(p_payload->'seller'->>'name') > 60 THEN RETURN FALSE; END IF;

    -- Ítems: 1 a 100, sin ventas libres, cantidad (0, 100000], precio [0, 1000000].
    IF jsonb_typeof(p_payload->'items') IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;
    IF jsonb_array_length(p_payload->'items') NOT BETWEEN 1 AND 100 THEN RETURN FALSE; END IF;
    FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload->'items') LOOP
        IF jsonb_typeof(v_item) IS DISTINCT FROM 'object' THEN RETURN FALSE; END IF;
        IF coalesce(v_item->>'productId', '') = '' OR length(v_item->>'productId') > 128 THEN RETURN FALSE; END IF;
        IF left(v_item->>'productId', 7) = 'custom_' THEN RETURN FALSE; END IF;
        IF coalesce(v_item->>'mode', '') NOT IN ('package', 'unit') THEN RETURN FALSE; END IF;
        v_num := public.supervisor_json_number(v_item->'qty');
        IF v_num IS NULL OR v_num <= 0 OR v_num > 100000 THEN RETURN FALSE; END IF;
        v_num := public.supervisor_json_number(v_item->'priceUsdSeen');
        IF v_num IS NULL OR v_num < 0 OR v_num > 1000000 THEN RETURN FALSE; END IF;
    END LOOP;

    -- Pagos: 1 a 10, solo contado, moneda conocida y montos no negativos.
    IF jsonb_typeof(p_payload->'payments') IS DISTINCT FROM 'array' THEN RETURN FALSE; END IF;
    IF jsonb_array_length(p_payload->'payments') NOT BETWEEN 1 AND 10 THEN RETURN FALSE; END IF;
    FOR v_payment IN SELECT value FROM jsonb_array_elements(p_payload->'payments') LOOP
        IF jsonb_typeof(v_payment) IS DISTINCT FROM 'object' THEN RETURN FALSE; END IF;
        IF coalesce(v_payment->>'methodId', '') = '' THEN RETURN FALSE; END IF;
        IF (v_payment->>'methodId') IN ('saldo_favor', 'cashea', 'fiado') THEN RETURN FALSE; END IF;
        IF coalesce(v_payment->>'currency', '') NOT IN ('USD', 'BS', 'COP') THEN RETURN FALSE; END IF;
        v_num := public.supervisor_json_number(v_payment->'amountUsd');
        IF v_num IS NULL OR v_num < 0 OR v_num > 1000000 THEN RETURN FALSE; END IF;
        v_num := public.supervisor_json_number(v_payment->'amountBs');
        IF v_num IS NULL OR v_num < 0 THEN RETURN FALSE; END IF;
        v_num := public.supervisor_json_number(v_payment->'amountCop');
        IF v_num IS NULL OR v_num < 0 THEN RETURN FALSE; END IF;
    END LOOP;

    v_num := public.supervisor_json_number(p_payload->'totalsSeen'->'totalUsd');
    IF v_num IS NULL OR v_num <= 0.01 OR v_num > 1000000 THEN RETURN FALSE; END IF;
    RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.is_valid_supervisor_sale_payload(jsonb) FROM PUBLIC, anon, authenticated;


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
        'supervisor.inventory.batch.adjust',
        'supervisor.supplier.create',
        'supervisor.supplier.update',
        'supervisor.supplier.delete',
        'supervisor.invoice.create',
        'supervisor.invoice.update',
        'supervisor.invoice.delete',
        'supervisor.sale.create'
    ));

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
    v_max_ttl INTERVAL := interval '60 seconds';
    v_duration INTERVAL;
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
        'supervisor.inventory.batch.adjust',
        'supervisor.supplier.create',
        'supervisor.supplier.update',
        'supervisor.supplier.delete',
        'supervisor.invoice.create',
        'supervisor.invoice.update',
        'supervisor.invoice.delete',
        'supervisor.sale.create'
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
    ELSIF p_command_type = 'supervisor.supplier.create' THEN
        IF jsonb_typeof(p_payload->'supplier') <> 'object'
           OR coalesce(p_payload->'supplier'->>'id', '') = ''
           OR coalesce(p_payload->'supplier'->>'name', '') = '' THEN
            RAISE EXCEPTION 'Payload de proveedor inválido';
        END IF;
    ELSIF p_command_type = 'supervisor.supplier.update' THEN
        IF coalesce(p_payload->>'supplierId', '') = ''
           OR jsonb_typeof(p_payload->'patch') <> 'object' THEN
            RAISE EXCEPTION 'Patch de proveedor inválido';
        END IF;
    ELSIF p_command_type = 'supervisor.supplier.delete' THEN
        IF coalesce(p_payload->>'supplierId', '') = '' THEN
            RAISE EXCEPTION 'Proveedor inválido';
        END IF;
    ELSIF p_command_type = 'supervisor.invoice.create' THEN
        IF jsonb_typeof(p_payload->'invoice') <> 'object'
           OR coalesce(p_payload->'invoice'->>'id', '') = ''
           OR coalesce(p_payload->'invoice'->>'supplierId', '') = ''
           OR coalesce(p_payload->'invoice'->>'amountUsd', '') !~ '^[0-9]+([.][0-9]+)?$'
           OR (p_payload->'invoice'->>'amountUsd')::numeric <= 0 THEN
            RAISE EXCEPTION 'Payload de factura inválido';
        END IF;
    ELSIF p_command_type = 'supervisor.invoice.update' THEN
        IF coalesce(p_payload->>'invoiceId', '') = ''
           OR jsonb_typeof(p_payload->'patch') <> 'object'
           OR (p_payload->'patch' ? 'amountUsd' AND (
                coalesce(p_payload->'patch'->>'amountUsd', '') !~ '^[0-9]+([.][0-9]+)?$'
                OR (p_payload->'patch'->>'amountUsd')::numeric <= 0)) THEN
            RAISE EXCEPTION 'Patch de factura inválido';
        END IF;
    ELSIF p_command_type = 'supervisor.invoice.delete' THEN
        IF coalesce(p_payload->>'invoiceId', '') = '' THEN
            RAISE EXCEPTION 'Factura inválida';
        END IF;
    ELSIF p_command_type = 'supervisor.sale.create' THEN
        IF NOT public.is_valid_supervisor_sale_payload(p_payload) THEN
            RAISE EXCEPTION 'Payload de venta remota inválido';
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

    -- Duración máxima por tipo: catálogo/inventario/usuarios admiten 5 min.
    IF p_command_type IN (
        'supervisor.inventory.batch.adjust',
        'supervisor.product.create',
        'supervisor.product.update',
        'supervisor.product.delete',
        'supervisor.user.create',
        'supervisor.user.pin.change',
        'supervisor.user.update',
        'supervisor.user.delete',
        'supervisor.supplier.create',
        'supervisor.supplier.update',
        'supervisor.supplier.delete',
        'supervisor.invoice.create',
        'supervisor.invoice.update',
        'supervisor.invoice.delete'
    ) THEN
        v_max_ttl := interval '5 minutes';
    ELSIF p_command_type = 'supervisor.sale.create' THEN
        -- Venta remota: si la caja no la toma en 2 minutos, el monitor la cancela.
        v_max_ttl := interval '2 minutes';
    END IF;

    -- La hora del dispositivo no importa: solo la DURACIÓN pedida (migración
    -- 20261020). La ventana real se arma con now() del servidor.
    v_duration := p_expires_at - p_issued_at;
    IF v_duration IS NULL OR v_duration <= interval '0' THEN
        RAISE EXCEPTION 'Ventana temporal inválida';
    END IF;
    IF v_duration > LEAST(v_max_ttl, interval '10 minutes') THEN
        v_duration := LEAST(v_max_ttl, interval '10 minutes');
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
    ) VALUES (trim(p_command_id), trim(p_target_device_id), v_actor, p_command_type, p_payload,
              now(), now() + v_duration);
    RETURN json_build_object('command_id', trim(p_command_id), 'status', 'pending', 'created_at', now());
END;
$$;

REVOKE ALL ON FUNCTION public.create_supervisor_command(text, text, text, jsonb, timestamptz, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.create_supervisor_command(text, text, text, jsonb, timestamptz, timestamptz) TO authenticated;

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
    ELSIF NEW.command_type = 'supervisor.supplier.create' THEN
        IF jsonb_typeof(NEW.payload->'supplier') <> 'object'
           OR coalesce(NEW.payload->'supplier'->>'id', '') = ''
           OR coalesce(NEW.payload->'supplier'->>'name', '') = '' THEN
            RAISE EXCEPTION 'Payload de proveedor inválido';
        END IF;
    ELSIF NEW.command_type = 'supervisor.supplier.update' THEN
        IF coalesce(NEW.payload->>'supplierId', '') = ''
           OR jsonb_typeof(NEW.payload->'patch') <> 'object' THEN
            RAISE EXCEPTION 'Patch de proveedor inválido';
        END IF;
    ELSIF NEW.command_type = 'supervisor.supplier.delete' THEN
        IF coalesce(NEW.payload->>'supplierId', '') = '' THEN
            RAISE EXCEPTION 'Proveedor inválido';
        END IF;
    ELSIF NEW.command_type = 'supervisor.invoice.create' THEN
        IF jsonb_typeof(NEW.payload->'invoice') <> 'object'
           OR coalesce(NEW.payload->'invoice'->>'id', '') = ''
           OR coalesce(NEW.payload->'invoice'->>'supplierId', '') = ''
           OR coalesce(NEW.payload->'invoice'->>'amountUsd', '') !~ '^[0-9]+([.][0-9]+)?$'
           OR (NEW.payload->'invoice'->>'amountUsd')::numeric <= 0 THEN
            RAISE EXCEPTION 'Payload de factura inválido';
        END IF;
    ELSIF NEW.command_type = 'supervisor.invoice.update' THEN
        IF coalesce(NEW.payload->>'invoiceId', '') = ''
           OR jsonb_typeof(NEW.payload->'patch') <> 'object'
           OR (NEW.payload->'patch' ? 'amountUsd' AND (
                coalesce(NEW.payload->'patch'->>'amountUsd', '') !~ '^[0-9]+([.][0-9]+)?$'
                OR (NEW.payload->'patch'->>'amountUsd')::numeric <= 0)) THEN
            RAISE EXCEPTION 'Patch de factura inválido';
        END IF;
    ELSIF NEW.command_type = 'supervisor.invoice.delete' THEN
        IF coalesce(NEW.payload->>'invoiceId', '') = '' THEN
            RAISE EXCEPTION 'Factura inválida';
        END IF;
    ELSIF NEW.command_type IN ('supervisor.shift.close', 'supervisor.shift.reopen') THEN
        IF coalesce(NEW.payload->>'shiftId', '') = ''
           OR coalesce(NEW.payload->>'cierreId', '') = ''
           OR length(NEW.payload->>'shiftId') > 128
           OR length(NEW.payload->>'cierreId') > 128 THEN
            RAISE EXCEPTION 'Turno o cierre inválido';
        END IF;
    ELSIF NEW.command_type = 'supervisor.sale.create' THEN
        IF NOT public.is_valid_supervisor_sale_payload(NEW.payload) THEN
            RAISE EXCEPTION 'Payload de venta remota inválido';
        END IF;
    ELSIF NEW.command_type LIKE 'supervisor.user.%' THEN
        -- Bloqueo deliberado (ver 20261022): requiere flujo de credencial segura.
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

-- Verificación (una vez aplicada):
--   SELECT pg_get_constraintdef(oid) FROM pg_constraint
--    WHERE conname = 'supervisor_commands_command_type_check';  -- 18 tipos, incluye supervisor.sale.create
--   SELECT public.is_valid_supervisor_sale_payload('{"v":1}'::jsonb);  -- false
--   scripts/verificar-migraciones-produccion.sql (secciones 7 y 8) sin FALTA.
