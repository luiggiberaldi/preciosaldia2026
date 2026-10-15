-- Permite hasta dos celulares supervisores por caja.
-- Mantiene el primer supervisor en las columnas existentes para conservar
-- compatibilidad y agrega un segundo slot explícito.

BEGIN;

ALTER TABLE public.device_pairings
    ADD COLUMN IF NOT EXISTS monitor_device_id_2 text,
    ADD COLUMN IF NOT EXISTS monitor_auth_id_2 uuid,
    ADD COLUMN IF NOT EXISTS paired_at_2 timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS device_pairings_monitor_device_id_2_key
    ON public.device_pairings (monitor_device_id_2)
    WHERE monitor_device_id_2 IS NOT NULL;

CREATE INDEX IF NOT EXISTS device_pairings_monitor_2_idx
    ON public.device_pairings (monitor_device_id_2, primary_device_id)
    WHERE monitor_device_id_2 IS NOT NULL;

-- Genera un token mientras haya un cupo disponible. No limpia supervisores
-- existentes y no fuerza una nueva fila por caja.
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
            owner_auth_id = coalesce(owner_auth_id, v_owner)
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

-- Consume un token en el primer slot libre. Un celular solo puede estar
-- vinculado a una caja; al volver a escanear se revoca su vínculo anterior.
CREATE OR REPLACE FUNCTION public.pair_monitor_device(p_token text, p_monitor_device_id text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_monitor uuid := auth.uid();
    v_monitor_id text := NULLIF(trim(p_monitor_device_id), '');
    v_pairing public.device_pairings%ROWTYPE;
    v_active_count integer := 0;
BEGIN
    IF v_monitor IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Sesión no autenticada.');
    END IF;

    IF p_token IS NULL OR length(trim(p_token)) < 16 OR length(trim(p_token)) > 64 THEN
        RETURN json_build_object('success', false, 'message', 'Código inválido.');
    END IF;

    IF v_monitor_id IS NULL OR length(v_monitor_id) < 8 OR length(v_monitor_id) > 160 THEN
        RETURN json_build_object('success', false, 'message', 'Identificador del celular inválido.');
    END IF;

    SELECT * INTO v_pairing
    FROM public.device_pairings
    WHERE token_hash = encode(digest(upper(trim(p_token)), 'sha256'), 'hex')
      AND token_expires_at > now()
      AND token_used_at IS NULL
      AND revoked_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'El código expiró o ya fue utilizado.');
    END IF;

    IF v_monitor_id = v_pairing.primary_device_id THEN
        RETURN json_build_object('success', false, 'message', 'La caja no puede vincularse como su propio supervisor.');
    END IF;

    v_active_count :=
        CASE WHEN v_pairing.monitor_device_id IS NOT NULL
                   AND v_pairing.monitor_auth_id IS NOT NULL THEN 1 ELSE 0 END
        + CASE WHEN v_pairing.monitor_device_id_2 IS NOT NULL
                   AND v_pairing.monitor_auth_id_2 IS NOT NULL THEN 1 ELSE 0 END;

    IF v_active_count >= 2 THEN
        RETURN json_build_object('success', false, 'message', 'Esta caja ya tiene el máximo de 2 supervisores vinculados.');
    END IF;

    IF v_pairing.monitor_device_id = v_monitor_id
       OR v_pairing.monitor_device_id_2 = v_monitor_id THEN
        RETURN json_build_object('success', false, 'message', 'Este celular ya está vinculado a la caja.');
    END IF;

    UPDATE public.device_pairings
    SET monitor_device_id = CASE WHEN monitor_device_id = v_monitor_id THEN NULL ELSE monitor_device_id END,
        monitor_auth_id = CASE WHEN monitor_device_id = v_monitor_id THEN NULL ELSE monitor_auth_id END,
        paired_at = CASE WHEN monitor_device_id = v_monitor_id THEN NULL ELSE paired_at END,
        monitor_device_id_2 = CASE WHEN monitor_device_id_2 = v_monitor_id THEN NULL ELSE monitor_device_id_2 END,
        monitor_auth_id_2 = CASE WHEN monitor_device_id_2 = v_monitor_id THEN NULL ELSE monitor_auth_id_2 END,
        paired_at_2 = CASE WHEN monitor_device_id_2 = v_monitor_id THEN NULL ELSE paired_at_2 END,
        revoked_at = CASE WHEN monitor_device_id = v_monitor_id OR monitor_device_id_2 = v_monitor_id THEN now() ELSE revoked_at END
    WHERE (monitor_device_id = v_monitor_id OR monitor_device_id_2 = v_monitor_id)
      AND primary_device_id <> v_pairing.primary_device_id;

    IF v_pairing.monitor_device_id IS NULL OR v_pairing.monitor_auth_id IS NULL THEN
        UPDATE public.device_pairings
        SET monitor_device_id = v_monitor_id,
            monitor_auth_id = v_monitor,
            paired_at = now(),
            pairing_token = NULL,
            token_hash = NULL,
            token_used_at = now(),
            revoked_at = NULL
        WHERE id = v_pairing.id;
    ELSE
        UPDATE public.device_pairings
        SET monitor_device_id_2 = v_monitor_id,
            monitor_auth_id_2 = v_monitor,
            paired_at_2 = now(),
            pairing_token = NULL,
            token_hash = NULL,
            token_used_at = now(),
            revoked_at = NULL
        WHERE id = v_pairing.id;
    END IF;

    RETURN json_build_object(
        'success', true,
        'primary_device_id', v_pairing.primary_device_id,
        'paired_count', v_active_count + 1,
        'max_paired', 2
    );
END;
$$;

-- Desde la caja (owner + primary_device_id) se desvinculan todos. Desde un
-- monitor se desvincula solamente su propio slot.
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

    v_owner := v_pairing.owner_auth_id = v_actor AND v_device = v_pairing.primary_device_id;

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

REVOKE ALL ON FUNCTION public.generate_pairing_token(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.pair_monitor_device(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.unpair_monitor(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_pairing_token(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pair_monitor_device(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.unpair_monitor(text) TO authenticated, service_role;

-- Ambos supervisores deben poder leer el snapshot de la caja.
DROP POLICY IF EXISTS "device_read_own_backup" ON public.cloud_backups;
CREATE POLICY "device_read_own_backup"
    ON public.cloud_backups
    FOR SELECT TO anon, authenticated
    USING (
        public.is_own_device_row(device_id)
        OR EXISTS (
            SELECT 1 FROM public.device_pairings dp
            WHERE dp.primary_device_id = cloud_backups.device_id
              AND (dp.monitor_device_id = public.current_device_id()
                   OR dp.monitor_device_id_2 = public.current_device_id())
              AND dp.revoked_at IS NULL
        )
    );

DROP POLICY IF EXISTS "device_read_own_sync_doc" ON public.sync_documents;
CREATE POLICY "device_read_own_sync_doc"
    ON public.sync_documents
    FOR SELECT TO anon, authenticated
    USING (
        public.is_own_device_row(device_id)
        OR EXISTS (
            SELECT 1 FROM public.device_pairings dp
            WHERE dp.primary_device_id = sync_documents.device_id
              AND (dp.monitor_device_id = public.current_device_id()
                   OR dp.monitor_device_id_2 = public.current_device_id())
              AND dp.revoked_at IS NULL
        )
    );

-- El trigger de comandos conserva la allowlist actual y autoriza ambos slots.
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
                OR (NEW.payload->>'customRate') !~ '^[0-9]+([.][0-9]+)?$'
                OR (NEW.payload->>'customRate')::numeric <= 0
           )) THEN
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
           OR (NEW.payload->>'direction' = 'egreso'
               AND coalesce(NEW.payload->>'reasonCategory', '') NOT IN ('merma', 'danio', 'vencimiento', 'autoconsumo', 'devolucion', 'ajuste')) THEN
            RAISE EXCEPTION 'Payload de ajuste por lote inválido';
        END IF;
    ELSE
        RAISE EXCEPTION 'Este tipo de orden Supervisor no está habilitado';
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM public.device_pairings dp
        WHERE dp.primary_device_id = trim(NEW.target_device_id)
          AND dp.revoked_at IS NULL
          AND (
              (dp.monitor_device_id IS NOT NULL AND dp.monitor_device_id <> dp.primary_device_id
               AND dp.monitor_device_id <> trim(NEW.target_device_id)
               AND dp.monitor_auth_id = NEW.actor_auth_id)
              OR
              (dp.monitor_device_id_2 IS NOT NULL AND dp.monitor_device_id_2 <> dp.primary_device_id
               AND dp.monitor_device_id_2 <> trim(NEW.target_device_id)
               AND dp.monitor_auth_id_2 = NEW.actor_auth_id)
          )
    ) THEN
        RAISE EXCEPTION 'Monitor no vinculado o no autorizado para esa caja';
    END IF;

    RETURN NEW;
END;
$$;

CREATE TRIGGER supervisor_income_pairing_guard
    BEFORE INSERT ON public.supervisor_commands
    FOR EACH ROW EXECUTE FUNCTION public.enforce_supervisor_income_command();

REVOKE ALL ON FUNCTION public.enforce_supervisor_income_command() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enforce_supervisor_income_command() TO authenticated;

-- El segundo supervisor también puede consultar y anular órdenes desde Control.
CREATE OR REPLACE FUNCTION public.get_supervisor_command_control_counts(
    p_target_device_id text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_result jsonb;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'Sesión no autenticada'; END IF;
    IF NOT EXISTS (
        SELECT 1 FROM public.device_pairings dp
        WHERE dp.primary_device_id = trim(p_target_device_id)
          AND dp.revoked_at IS NULL
          AND (
              dp.owner_auth_id = v_actor
              OR dp.monitor_auth_id = v_actor
              OR dp.monitor_auth_id_2 = v_actor
          )
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
    p_command_id text,
    p_reason text DEFAULT 'Cancelado desde Control'
) RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor uuid := auth.uid();
    v_status text;
BEGIN
    IF v_actor IS NULL THEN RAISE EXCEPTION 'Sesión no autenticada'; END IF;

    SELECT sc.status INTO v_status
    FROM public.supervisor_commands sc
    JOIN public.device_pairings dp
      ON dp.primary_device_id = sc.target_device_id
     AND dp.revoked_at IS NULL
     AND (
         dp.owner_auth_id = v_actor
         OR dp.monitor_auth_id = v_actor
         OR dp.monitor_auth_id_2 = v_actor
     )
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

REVOKE ALL ON FUNCTION public.get_supervisor_command_control_counts(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_supervisor_command_control_counts(text) TO authenticated;
REVOKE ALL ON FUNCTION public.cancel_supervisor_command(text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_supervisor_command(text, text) TO authenticated;

COMMIT;
