-- Control del Supervisor: auditoría ligera y cancelación segura.
-- Aplicar después de 20261015_supervisor_all_commands_production.sql.
-- Las lecturas del panel siguen limitadas a 25 filas; este RPC solo devuelve
-- contadores, no payloads ni catálogos.

BEGIN;

ALTER TABLE public.supervisor_commands
    ADD COLUMN IF NOT EXISTS applied_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS cancelled_by UUID,
    ADD COLUMN IF NOT EXISTS cancel_reason TEXT;

ALTER TABLE public.supervisor_commands
    DROP CONSTRAINT IF EXISTS supervisor_commands_status_check;

ALTER TABLE public.supervisor_commands
    ADD CONSTRAINT supervisor_commands_status_check
    CHECK (status IN ('pending', 'applied', 'applied_with_warnings', 'rejected', 'failed', 'cancelled'));

CREATE INDEX IF NOT EXISTS idx_supervisor_commands_control_page
    ON public.supervisor_commands (target_device_id, created_at DESC, command_id);

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
          AND (dp.owner_auth_id = v_actor OR dp.monitor_auth_id = v_actor)
    ) THEN
        RAISE EXCEPTION 'Monitor no autorizado para esa caja';
    END IF;

    SELECT jsonb_build_object(
        'total', count(*),
        'pending', count(*) FILTER (WHERE status = 'pending'),
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
    v_status TEXT;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'Sesión no autenticada'; END IF;

    SELECT sc.status INTO v_status
    FROM public.supervisor_commands sc
    JOIN public.device_pairings dp
      ON dp.primary_device_id = sc.target_device_id
     AND dp.revoked_at IS NULL
     AND (dp.owner_auth_id = v_actor OR dp.monitor_auth_id = v_actor)
    WHERE sc.command_id = trim(p_command_id)
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Comando no encontrado o no autorizado'; END IF;
    IF v_status <> 'pending' THEN
        RETURN json_build_object('command_id', p_command_id, 'status', v_status);
    END IF;

    UPDATE public.supervisor_commands
    SET status = 'cancelled',
        cancelled_at = now(),
        cancelled_by = v_actor,
        cancel_reason = left(coalesce(p_reason, 'Cancelado desde Control'), 240),
        updated_at = now()
    WHERE command_id = trim(p_command_id)
      AND status = 'pending';

    RETURN json_build_object('command_id', p_command_id, 'status', 'cancelled');
END;
$$;

-- Asegura que el ACK deje una marca temporal útil para la línea de tiempo.
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
    IF p_status NOT IN ('applied', 'applied_with_warnings', 'rejected', 'failed') THEN
        RAISE EXCEPTION 'Estado ACK inválido';
    END IF;

    SELECT sc.* INTO v_command
    FROM public.supervisor_commands sc
    JOIN public.device_pairings dp
      ON dp.primary_device_id = sc.target_device_id
     AND dp.owner_auth_id = v_actor
     AND dp.revoked_at IS NULL
    WHERE sc.command_id = p_command_id
    FOR UPDATE;

    IF NOT FOUND THEN RAISE EXCEPTION 'Comando no encontrado o caja no autorizada'; END IF;
    IF v_command.status <> 'pending' THEN
        RETURN json_build_object('command_id', p_command_id, 'status', v_command.status);
    END IF;

    IF v_command.expires_at <= now() THEN
        UPDATE public.supervisor_commands
        SET status = 'failed', error_message = 'Comando expirado antes del ACK', updated_at = now()
        WHERE command_id = p_command_id;
        RETURN json_build_object('command_id', p_command_id, 'status', 'failed');
    END IF;

    UPDATE public.supervisor_commands
    SET status = p_status,
        ack_payload = coalesce(p_ack_payload, '{}'::jsonb),
        error_message = p_error_message,
        applied_at = CASE WHEN p_status IN ('applied', 'applied_with_warnings') THEN now() ELSE applied_at END,
        updated_at = now()
    WHERE command_id = p_command_id;

    RETURN json_build_object('command_id', p_command_id, 'status', p_status);
END;
$$;

REVOKE ALL ON FUNCTION public.get_supervisor_command_control_counts(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_supervisor_command_control_counts(TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_supervisor_command(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_supervisor_command(TEXT, TEXT) TO authenticated;
REVOKE ALL ON FUNCTION public.ack_supervisor_command(TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ack_supervisor_command(TEXT, TEXT, JSONB, TEXT) TO authenticated;

COMMIT;
