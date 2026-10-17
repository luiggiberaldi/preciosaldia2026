-- Migración de producción: máquina de estados, RLS del segundo supervisor y ACK terminal.
-- El proyecto sodgzkablshladvbtnes ya registra 20261016054119 (inventory_batch_v2).
-- No aplicar la migración inventory_batch_v2 otra vez.
-- Esta migración no vuelve a validar payloads ni cambia el RPC de creación.

BEGIN;

ALTER TABLE public.supervisor_commands
    DROP CONSTRAINT IF EXISTS supervisor_commands_status_check;

ALTER TABLE public.supervisor_commands
    ADD CONSTRAINT supervisor_commands_status_check
    CHECK (status IN (
        'pending', 'received', 'applied', 'applied_with_warnings',
        'rejected', 'failed', 'cancelled'
    ));

-- La política de device_pairings se evalúa al consultar desde la política de
-- comandos; incluir el segundo slot aquí hace visible solo su propio pairing.
DROP POLICY IF EXISTS "device_pairings_authenticated_read" ON public.device_pairings;
CREATE POLICY "device_pairings_authenticated_read"
    ON public.device_pairings
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = owner_auth_id
        OR auth.uid() = monitor_auth_id
        OR auth.uid() = monitor_auth_id_2
    );

-- Mantiene lectura de Control para el dueño y ambos slots supervisores.
-- El filtro evita que IDs de caja/revocados hereden acceso por coincidencia.
DROP POLICY IF EXISTS "supervisor_commands_authorized_read" ON public.supervisor_commands;
CREATE POLICY "supervisor_commands_authorized_read"
    ON public.supervisor_commands
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1
            FROM public.device_pairings dp
            WHERE dp.primary_device_id = supervisor_commands.target_device_id
              AND dp.revoked_at IS NULL
              AND (
                  dp.owner_auth_id = auth.uid()
                  OR (dp.monitor_device_id IS NOT NULL
                      AND dp.monitor_device_id <> dp.primary_device_id
                      AND dp.monitor_auth_id = auth.uid())
                  OR (dp.monitor_device_id_2 IS NOT NULL
                      AND dp.monitor_device_id_2 <> dp.primary_device_id
                      AND dp.monitor_auth_id_2 = auth.uid())
              )
        )
    );

-- La caja reclama antes de ejecutar. El lock serializa este UPDATE frente a
-- cancel_supervisor_command. Repetir el mismo ID cuando ya está received es
-- recuperación idempotente; los terminales nunca vuelven a abrirse.
CREATE OR REPLACE FUNCTION public.claim_supervisor_command(
    p_command_id TEXT,
    p_target_device_id TEXT
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_command public.supervisor_commands%ROWTYPE;
    v_updated INTEGER;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'Sesión no autenticada'; END IF;

    SELECT sc.* INTO v_command
    FROM public.supervisor_commands sc
    JOIN public.device_pairings dp
      ON dp.primary_device_id = sc.target_device_id
     AND dp.owner_auth_id = v_actor
     AND dp.revoked_at IS NULL
    WHERE sc.command_id = trim(p_command_id)
      AND sc.target_device_id = trim(p_target_device_id)
      AND public.is_own_device_row(sc.target_device_id)
    FOR UPDATE OF sc;

    IF NOT FOUND THEN RAISE EXCEPTION 'Comando no encontrado o caja no autorizada'; END IF;

    IF v_command.status = 'pending' THEN
        -- Expiración derivada: no se persiste otro estado ni se altera la fila.
        IF v_command.expires_at <= now() THEN
            RETURN json_build_object(
                'command_id', v_command.command_id,
                'status', 'pending',
                'claimed', false,
                'expired', true
            );
        END IF;

        UPDATE public.supervisor_commands
        SET status = 'received', updated_at = now()
        WHERE command_id = v_command.command_id
          AND target_device_id = trim(p_target_device_id)
          AND status = 'pending'
          AND expires_at > now();
        GET DIAGNOSTICS v_updated = ROW_COUNT;

        IF v_updated = 1 THEN
            RETURN json_build_object(
                'command_id', v_command.command_id,
                'status', 'received',
                'claimed', true,
                'expired', false
            );
        END IF;

        -- La fila está bloqueada; esta defensa evita afirmar claim si cambió
        -- el contrato de aislamiento o una actualización condicional no aplicó.
        SELECT sc.* INTO v_command
        FROM public.supervisor_commands sc
        WHERE sc.command_id = trim(p_command_id);
    END IF;

    IF v_command.status = 'received' THEN
        RETURN json_build_object(
            'command_id', v_command.command_id,
            'status', 'received',
            'claimed', true,
            'expired', false
        );
    END IF;

    RETURN json_build_object(
        'command_id', v_command.command_id,
        'status', v_command.status,
        'claimed', false,
        'expired', false
    );
END;
$$;

-- La caja solo puede confirmar una orden reclamada y no expirada al reclamar.
-- ACKs repetidos tras pérdida de respuesta devuelven el terminal original sin
-- sobrescribirlo; una orden received puede terminar aunque su TTL haya pasado.
CREATE OR REPLACE FUNCTION public.ack_supervisor_command(
    p_command_id TEXT,
    p_status TEXT,
    p_ack_payload JSONB DEFAULT '{}'::jsonb,
    p_error_message TEXT DEFAULT NULL
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_command public.supervisor_commands%ROWTYPE;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'Sesión no autenticada'; END IF;
    IF p_status IS NULL OR p_status NOT IN ('applied', 'applied_with_warnings', 'rejected', 'failed') THEN
        RAISE EXCEPTION 'Estado ACK inválido';
    END IF;

    SELECT sc.* INTO v_command
    FROM public.supervisor_commands sc
    JOIN public.device_pairings dp
      ON dp.primary_device_id = sc.target_device_id
     AND dp.owner_auth_id = v_actor
     AND dp.revoked_at IS NULL
    WHERE sc.command_id = trim(p_command_id)
      AND public.is_own_device_row(sc.target_device_id)
    FOR UPDATE OF sc;

    IF NOT FOUND THEN RAISE EXCEPTION 'Comando no encontrado o caja no autorizada'; END IF;

    IF v_command.status IN ('applied', 'applied_with_warnings', 'rejected', 'failed', 'cancelled') THEN
        RETURN json_build_object('command_id', v_command.command_id, 'status', v_command.status);
    END IF;
    IF v_command.status <> 'received' THEN
        RETURN json_build_object('command_id', v_command.command_id, 'status', v_command.status);
    END IF;

    UPDATE public.supervisor_commands
    SET status = p_status,
        ack_payload = coalesce(p_ack_payload, '{}'::jsonb),
        error_message = p_error_message,
        applied_at = CASE WHEN p_status IN ('applied', 'applied_with_warnings') THEN now() ELSE applied_at END,
        updated_at = now()
    WHERE command_id = v_command.command_id
      AND status = 'received';

    RETURN json_build_object('command_id', v_command.command_id, 'status', p_status);
END;
$$;

-- Un único slot de supervisor tiene permiso para cancelar, junto al dueño.
-- La fila queda bloqueada durante la decisión: solo pending puede cancelarse.
CREATE OR REPLACE FUNCTION public.cancel_supervisor_command(
    p_command_id TEXT,
    p_reason TEXT DEFAULT 'Cancelado desde Control'
) RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_command public.supervisor_commands%ROWTYPE;
    v_updated INTEGER;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'Sesión no autenticada'; END IF;

    SELECT sc.* INTO v_command
    FROM public.supervisor_commands sc
    JOIN public.device_pairings dp
      ON dp.primary_device_id = sc.target_device_id
     AND dp.revoked_at IS NULL
     AND (
         dp.owner_auth_id = v_actor
         OR (dp.monitor_device_id IS NOT NULL
             AND dp.monitor_device_id <> dp.primary_device_id
             AND dp.monitor_device_id <> sc.target_device_id
             AND dp.monitor_auth_id = v_actor)
         OR (dp.monitor_device_id_2 IS NOT NULL
             AND dp.monitor_device_id_2 <> dp.primary_device_id
             AND dp.monitor_device_id_2 <> sc.target_device_id
             AND dp.monitor_auth_id_2 = v_actor)
     )
    WHERE sc.command_id = trim(p_command_id)
    FOR UPDATE OF sc;

    IF NOT FOUND THEN RAISE EXCEPTION 'Comando no encontrado o no autorizado'; END IF;
    IF v_command.status <> 'pending' THEN
        RETURN json_build_object('command_id', v_command.command_id, 'status', v_command.status);
    END IF;

    UPDATE public.supervisor_commands
    SET status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = v_actor,
        cancel_reason = left(coalesce(p_reason, 'Cancelado desde Control'), 240),
        updated_at = now()
    WHERE command_id = v_command.command_id
      AND status = 'pending';
    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated = 1 THEN
        RETURN json_build_object('command_id', v_command.command_id, 'status', 'cancelled');
    END IF;

    SELECT sc.* INTO v_command
    FROM public.supervisor_commands sc
    WHERE sc.command_id = trim(p_command_id);
    RETURN json_build_object('command_id', p_command_id, 'status', v_command.status);
END;
$$;

-- Mantiene la métrica de órdenes activas coherente con el nuevo estado.
CREATE OR REPLACE FUNCTION public.get_supervisor_command_control_counts(
    p_target_device_id TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor UUID := auth.uid();
    v_result JSONB;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'Sesión no autenticada'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.device_pairings dp
        WHERE dp.primary_device_id = trim(p_target_device_id)
          AND dp.revoked_at IS NULL
          AND (dp.owner_auth_id = v_actor OR dp.monitor_auth_id = v_actor OR dp.monitor_auth_id_2 = v_actor)
    ) THEN
        RAISE EXCEPTION 'Monitor no autorizado para esa caja';
    END IF;

    SELECT jsonb_build_object(
        'total', count(*),
        'pending', count(*) FILTER (WHERE status IN ('pending', 'received')),
        'received', count(*) FILTER (WHERE status = 'received'),
        'applied', count(*) FILTER (WHERE status = 'applied'),
        'applied_with_warnings', count(*) FILTER (WHERE status = 'applied_with_warnings'),
        'rejected', count(*) FILTER (WHERE status = 'rejected'),
        'failed', count(*) FILTER (WHERE status = 'failed'),
        'cancelled', count(*) FILTER (WHERE status = 'cancelled')
    ) INTO v_result
    FROM public.supervisor_commands
    WHERE target_device_id = trim(p_target_device_id);

    RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_supervisor_command(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_supervisor_command(TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.ack_supervisor_command(TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ack_supervisor_command(TEXT, TEXT, JSONB, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_supervisor_command(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_supervisor_command(TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.get_supervisor_command_control_counts(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_supervisor_command_control_counts(TEXT) TO authenticated;

COMMIT;
