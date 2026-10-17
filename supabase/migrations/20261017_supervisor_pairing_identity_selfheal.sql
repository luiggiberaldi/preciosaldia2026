-- Fix sincronización caja ↔ Supervisor: autorizar a la caja por identidad de
-- dispositivo (is_own_device_row), no por la sesión Auth guardada en
-- owner_auth_id.
--
-- Problema verificado en producción (2026-10-17, caja PDA-V2-2B42… con monitor
-- PDA-V2-9DB6…): cuando la sesión anónima de la caja se regenera (borrado de
-- datos, cambio de origen, SEC-008), la fila de device_pairings conserva el
-- owner_auth_id viejo — generate_pairing_token hace
-- coalesce(owner_auth_id, v_owner) y nunca lo refresca. Ese único desfase
-- rompe TODA la sincronización en ambos sentidos, en silencio:
--   1. device_pairings_authenticated_read no devuelve la fila a la caja →
--      useCloudSync pausa el sync ("Sync no activo") y los cambios locales
--      nunca se publican (solo sobrevive el push bootstrap del QR con
--      allowBeforePairing).
--   2. supervisor_commands_authorized_read no le muestra sus órdenes → ni
--      Realtime ni la recuperación las ven.
--   3. claim/ack_supervisor_command exigen dp.owner_auth_id = auth.uid() →
--      la caja no puede reclamar ni confirmar; la orden expira sin aplicarse.
--   4. unpair_monitor exige lo mismo → el botón "Desactivar Modo Supervisor"
--      de la caja deja de funcionar.
--
-- Fix: además de dueño/monitor por auth.uid(), se autoriza a la caja por
-- is_own_device_row() — la identidad que SÍ se auto-repara vía device_sessions
-- (register/claim con prueba de posesión). generate_pairing_token re-liga
-- owner_auth_id cuando es la propia caja la que pide el token.
--
-- Idempotente. No toca ventas, productos, backups ni datos de negocio.

BEGIN;

-- 1) La caja puede leer su propia fila de pairing (aunque su sesión cambió).
DROP POLICY IF EXISTS "device_pairings_authenticated_read" ON public.device_pairings;
CREATE POLICY "device_pairings_authenticated_read"
    ON public.device_pairings
    FOR SELECT
    TO authenticated
    USING (
        auth.uid() = owner_auth_id
        OR auth.uid() = monitor_auth_id
        OR auth.uid() = monitor_auth_id_2
        OR public.is_own_device_row(primary_device_id)
    );

-- 2) La caja puede leer las órdenes que le apuntan (Realtime + recuperación).
DROP POLICY IF EXISTS "supervisor_commands_authorized_read" ON public.supervisor_commands;
CREATE POLICY "supervisor_commands_authorized_read"
    ON public.supervisor_commands
    FOR SELECT
    TO authenticated
    USING (
        public.is_own_device_row(supervisor_commands.target_device_id)
        OR EXISTS (
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

-- 3) La caja reclama sus órdenes por identidad de dispositivo. El lock
--    serializa este UPDATE frente a cancel_supervisor_command; la semántica de
--    estados (pending → received, expiración derivada, terminales fijos) no
--    cambia.
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

REVOKE ALL ON FUNCTION public.claim_supervisor_command(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_supervisor_command(TEXT, TEXT) TO authenticated;

-- 4) El ACK usa la misma autorización que el claim: quien reclama, confirma.
--    ACKs repetidos tras pérdida de respuesta devuelven el terminal original
--    sin sobrescribirlo; una orden received puede terminar aunque su TTL haya
--    pasado.
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

REVOKE ALL ON FUNCTION public.ack_supervisor_command(TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ack_supervisor_command(TEXT, TEXT, JSONB, TEXT) TO authenticated;

-- 5) La caja puede desvincular a su supervisor ("Desactivar Modo Supervisor")
--    aunque su sesión haya cambiado. La semántica de slots (1 y 2) no cambia.
CREATE OR REPLACE FUNCTION public.unpair_monitor(p_device_id text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_device text := trim(p_device_id);
    v_pairing public.device_pairings%ROWTYPE;
    v_owner boolean := false;
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;

    SELECT * INTO v_pairing
    FROM public.device_pairings
    WHERE primary_device_id = v_device
       OR monitor_device_id = v_device
       OR monitor_device_id_2 = v_device
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No autorizado o vínculo inexistente';
    END IF;

    -- La caja dueña se reconoce por identidad de dispositivo (is_own_device_row),
    -- no solo por la sesión guardada en owner_auth_id (puede estar desfasada).
    v_owner := (v_pairing.owner_auth_id = v_actor
                OR public.is_own_device_row(v_pairing.primary_device_id))
           AND v_device = v_pairing.primary_device_id;

    IF v_owner THEN
        UPDATE public.device_pairings
        SET monitor_device_id = NULL,
            monitor_auth_id = NULL,
            paired_at = NULL,
            monitor_device_id_2 = NULL,
            monitor_auth_id_2 = NULL,
            paired_at_2 = NULL,
            pairing_token = NULL,
            token_hash = NULL,
            token_expires_at = NULL,
            token_used_at = NULL,
            revoked_at = now()
        WHERE id = v_pairing.id;
    ELSIF v_pairing.monitor_auth_id = v_actor
       AND (v_device = v_pairing.primary_device_id OR v_device = v_pairing.monitor_device_id) THEN
        UPDATE public.device_pairings
        SET monitor_device_id = NULL,
            monitor_auth_id = NULL,
            paired_at = NULL,
            pairing_token = NULL,
            token_hash = NULL,
            token_expires_at = NULL,
            token_used_at = NULL,
            revoked_at = CASE WHEN monitor_device_id_2 IS NULL THEN now() ELSE NULL END
        WHERE id = v_pairing.id;
    ELSIF v_pairing.monitor_auth_id_2 = v_actor
       AND (v_device = v_pairing.primary_device_id OR v_device = v_pairing.monitor_device_id_2) THEN
        UPDATE public.device_pairings
        SET monitor_device_id_2 = NULL,
            monitor_auth_id_2 = NULL,
            paired_at_2 = NULL,
            pairing_token = NULL,
            token_hash = NULL,
            token_expires_at = NULL,
            token_used_at = NULL,
            revoked_at = CASE WHEN monitor_device_id IS NULL THEN now() ELSE NULL END
        WHERE id = v_pairing.id;
    ELSE
        RAISE EXCEPTION 'No autorizado o vínculo inexistente';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.unpair_monitor(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.unpair_monitor(text) TO authenticated, service_role;

-- 6) Al generar un nuevo token, la caja re-liga owner_auth_id a su sesión
--    actual. Sin esto, una fila con dueño viejo queda congelada para siempre
--    (el coalesce jamás la refresca) y el mismo bug vuelve tras cada
--    regeneración de sesión. Se conserva el coalesce para llamadas que no
--    demuestran posesión del dispositivo.
CREATE OR REPLACE FUNCTION public.generate_pairing_token(p_device_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_token text;
    v_hash text;
    v_owner uuid := auth.uid();
    v_device_id text := NULLIF(trim(p_device_id), '');
    v_pairing public.device_pairings%ROWTYPE;
    v_active_count integer := 0;
    v_has_pairing boolean := false;
BEGIN
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;

    IF v_device_id IS NULL OR length(v_device_id) < 8 OR length(v_device_id) > 160 THEN
        RAISE EXCEPTION 'Identificador de dispositivo inválido';
    END IF;

    SELECT * INTO v_pairing
    FROM public.device_pairings
    WHERE primary_device_id = v_device_id
    FOR UPDATE;
    v_has_pairing := FOUND;

    IF v_has_pairing THEN
        v_active_count :=
            CASE WHEN v_pairing.revoked_at IS NULL
                       AND v_pairing.monitor_device_id IS NOT NULL
                       AND v_pairing.monitor_auth_id IS NOT NULL THEN 1 ELSE 0 END
            + CASE WHEN v_pairing.revoked_at IS NULL
                       AND v_pairing.monitor_device_id_2 IS NOT NULL
                       AND v_pairing.monitor_auth_id_2 IS NOT NULL THEN 1 ELSE 0 END;

        IF v_active_count >= 2 THEN
            RAISE EXCEPTION 'Esta caja ya tiene el máximo de 2 supervisores vinculados. Desvincula uno desde Ajustes.';
        END IF;
    END IF;

    v_token := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 24));
    v_hash := encode(digest(v_token, 'sha256'), 'hex');

    IF v_has_pairing THEN
        UPDATE public.device_pairings
        SET pairing_token = NULL,
            token_hash = v_hash,
            token_expires_at = now() + interval '30 minutes',
            token_used_at = NULL,
            revoked_at = NULL,
            owner_auth_id = CASE
                WHEN public.is_own_device_row(v_device_id) THEN v_owner
                ELSE coalesce(owner_auth_id, v_owner)
            END
        WHERE id = v_pairing.id;
    ELSE
        INSERT INTO public.device_pairings (
            primary_device_id,
            owner_auth_id,
            token_hash,
            token_expires_at,
            created_at
        )
        VALUES (v_device_id, v_owner, v_hash, now() + interval '30 minutes', now());
    END IF;

    RETURN v_token;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_pairing_token(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_pairing_token(text) TO authenticated, service_role;

COMMIT;
