-- Reloj del dispositivo fuera de la ecuación — create_supervisor_command
-- (continuación de Fase 5: supabase/migrations/20261017_supervisor_command_ttl_extended.sql)
--
-- PROBLEMA (2026-10-20, incidente en producción): la RPC comparaba p_issued_at
-- contra now() +/- 2 minutos y exigía p_expires_at > now(). Un dispositivo con
-- el reloj desfasado (o un build con ventana mayor al tope del tipo) enviaba
-- TODOS sus comandos al mismo error 'Ventana temporal inválida' (400) y ninguna
-- orden llegaba a crearse: la caja no veía nada ("como si no se enviara").
--
-- CAMBIO ÚNICO: la hora absoluta del cliente deja de importarse.
--   * p_expires_at - p_issued_at se interpreta como DURACIÓN PEDIDA. Ambos
--     valores salen del MISMO reloj del cliente, así que su diferencia es
--     confiable aunque ese reloj esté desfasado.
--   * La ventana real se construye aquí con now(): issued_at = now(),
--     expires_at = now() + duración.
--   * Duración <= 0 → 'Ventana temporal inválida' (único rechazo temporal).
--   * Duración mayor al tope del tipo → se recorta al tope (v_max_ttl, y en
--     todo caso 10 minutos). Un build con ventana exagerada deja de morir: el
--     comando se crea con el TTL máximo permitido para su tipo.
-- NO se toca: la firma (los clientes ya desplegados se arreglan solos al
-- aplicar esta migración, sin desplegar app), el allowlist de tipos, la
-- validación de payloads, la autorización por pairing, la idempotencia por
-- command_id ni los permisos.
--
-- NOTA DE SEGURIDAD: se retira la comprobación de frescura absoluta de
-- p_issued_at (now() +/- 2 min). No aportaba contra replay: una petición
-- capturada era reenviable dentro de esa misma ventana. La idempotencia por
-- command_id, la autorización por pairing (auth.uid()) y el TTL corto acotan el
-- riesgo. Es una bodega, no un banco.
--
-- ORDEN DE ROLLOUT:
--   1. Aplicar esta migración en producción. Arregla de inmediato a los
--      emisores ya desplegados (misma firma de parámetros).
--   2. Nada más. Los receivers no cambian: siguen leyendo issued_at/expires_at.
--
-- ESTADO: APLICADO en producción (sodgzkablshladvbtnes) el 2026-10-20.
-- Verificado: el cuerpo vivo de pg_proc coincide con esta definición.

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

    -- Duración máxima por tipo (Fase 5): los sensibles al tiempo conservan 60 s;
    -- catálogo/inventario/usuarios admiten 5 min para sobrevivir cortes de red.
    IF p_command_type IN (
        'supervisor.inventory.batch.adjust',
        'supervisor.product.create',
        'supervisor.product.update',
        'supervisor.product.delete',
        'supervisor.user.create',
        'supervisor.user.pin.change',
        'supervisor.user.update',
        'supervisor.user.delete'
    ) THEN
        v_max_ttl := interval '5 minutes';
    END IF;

    -- La hora del dispositivo no importa: solo la DURACIÓN pedida (diferencia
    -- entre dos marcas del mismo reloj, inmune a desfases). La ventana real se
    -- arma con now() del servidor y se recorta al tope del tipo.
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

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- DOWN (reversión): copia literal de la función vigente antes de este cambio
-- (ventana por tipo con validación de reloj del cliente). Para revertir,
-- ejecutar el contenido de este bloque tal cual.
/*
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

    IF p_command_type IN (
        'supervisor.inventory.batch.adjust',
        'supervisor.product.create',
        'supervisor.product.update',
        'supervisor.product.delete',
        'supervisor.user.create',
        'supervisor.user.pin.change',
        'supervisor.user.update',
        'supervisor.user.delete'
    ) THEN
        v_max_ttl := interval '5 minutes';
    END IF;

    IF p_issued_at < now() - interval '2 minutes'
       OR p_issued_at > now() + interval '2 minutes'
       OR p_expires_at <= p_issued_at
       OR p_expires_at - p_issued_at > v_max_ttl
       OR p_expires_at - p_issued_at > interval '10 minutes'
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
*/
