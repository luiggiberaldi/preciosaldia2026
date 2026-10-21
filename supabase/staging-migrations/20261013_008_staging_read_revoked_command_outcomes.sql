-- STAGING ONLY — 008: lectura de órdenes canceladas tras revocar
-- Intended project ref: tdfcpwctvumbdjmifypd
-- Do NOT run against production.
--
-- Por qué: la política supervisor_commands_authorized_read exige vínculo
-- activo (revoked_at IS NULL). Tras revocar, dueño y monitor no pueden leer
-- el resultado de la orden cancelada, así que el E2E no puede confirmarlo.
--
-- Qué añade: una política SELECT adicional, solo para órdenes ya canceladas
-- por revocación, y solo a dueño o monitor de esa caja. No añade escritura
-- ni reactiva nada. Mantiene e2e-% de staging.

CREATE POLICY staging_read_revoked_command_outcome
    ON public.supervisor_commands
    FOR SELECT
    TO authenticated
    USING (
        target_device_id LIKE 'e2e-%'
        AND status = 'failed'
        AND error_message = 'REVOKED_BEFORE_ACK'
        AND EXISTS (
            SELECT 1
            FROM public.device_pairings dp
            WHERE dp.primary_device_id = supervisor_commands.target_device_id
              AND (dp.owner_auth_id = auth.uid() OR dp.monitor_auth_id = auth.uid())
        )
    );
