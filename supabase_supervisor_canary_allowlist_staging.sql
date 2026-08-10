-- STAGING E2E — ALLOWLIST DEL CANARY DEL SUPERVISOR
-- Proyecto: tdfcpwctvumbdjmifypd
-- Solo contiene los dispositivos sintéticos e2e-*.
-- No ejecutar en producción.
-- ROLLBACK: DROP TRIGGER IF EXISTS supervisor_canary_income_guard ON public.supervisor_commands;
-- DROP FUNCTION IF EXISTS public.enforce_supervisor_canary_command();
-- DROP TABLE IF EXISTS public.supervisor_canary_allowlist;

BEGIN;

CREATE TABLE IF NOT EXISTS public.supervisor_canary_allowlist (
    primary_device_id TEXT PRIMARY KEY,
    monitor_device_id TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'M2 staging canary',
    enabled BOOLEAN NOT NULL DEFAULT false,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT supervisor_canary_allowlist_primary_id_check
        CHECK (length(trim(primary_device_id)) BETWEEN 8 AND 128),
    CONSTRAINT supervisor_canary_allowlist_monitor_id_check
        CHECK (length(trim(monitor_device_id)) BETWEEN 8 AND 128),
    CONSTRAINT supervisor_canary_allowlist_purpose_check
        CHECK (length(trim(purpose)) BETWEEN 1 AND 160),
    CONSTRAINT supervisor_canary_allowlist_expiry_check
        CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_supervisor_canary_allowlist_active
    ON public.supervisor_canary_allowlist (enabled, expires_at);

ALTER TABLE public.supervisor_canary_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_canary_allowlist FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.supervisor_canary_allowlist FROM PUBLIC, anon, authenticated;

DROP POLICY IF EXISTS staging_canary_allowlist_definer_read
    ON public.supervisor_canary_allowlist;
CREATE POLICY staging_canary_allowlist_definer_read
    ON public.supervisor_canary_allowlist
    FOR SELECT
    TO postgres
    USING (primary_device_id LIKE 'e2e-%');

CREATE OR REPLACE FUNCTION public.enforce_supervisor_canary_command()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    -- Staging conserva los casos M4 de egreso rechazado; el guardarraíl
    -- canary se aplica específicamente al ingreso remoto.
    IF NEW.command_type = 'supervisor.inventory.batch.adjust'
       AND coalesce(NEW.payload->>'direction', '') = 'ingreso'
       AND NOT EXISTS (
            SELECT 1
            FROM public.supervisor_canary_allowlist ca
            JOIN public.device_pairings dp
              ON dp.primary_device_id = ca.primary_device_id
             AND dp.monitor_device_id = ca.monitor_device_id
             AND dp.monitor_auth_id = NEW.actor_auth_id
             AND dp.revoked_at IS NULL
            WHERE ca.primary_device_id = trim(NEW.target_device_id)
              AND ca.enabled = true
              AND ca.expires_at > now()
       ) THEN
        RAISE EXCEPTION 'Dispositivo fuera de la allowlist del canary';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS supervisor_canary_income_guard
    ON public.supervisor_commands;
CREATE TRIGGER supervisor_canary_income_guard
    BEFORE INSERT ON public.supervisor_commands
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_supervisor_canary_command();

REVOKE ALL ON FUNCTION public.enforce_supervisor_canary_command() FROM PUBLIC, anon, authenticated;

INSERT INTO public.supervisor_canary_allowlist (
    primary_device_id,
    monitor_device_id,
    purpose,
    enabled,
    expires_at
) VALUES (
    'e2e-primary-device',
    'e2e-monitor-device',
    'M2 staging synthetic canary',
    true,
    now() + interval '30 days'
)
ON CONFLICT (primary_device_id) DO UPDATE SET
    monitor_device_id = EXCLUDED.monitor_device_id,
    purpose = EXCLUDED.purpose,
    enabled = EXCLUDED.enabled,
    expires_at = EXCLUDED.expires_at,
    updated_at = now();

COMMIT;
