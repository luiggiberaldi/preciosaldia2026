-- PRODUCCIÓN — ALLOWLIST DEL CANARY DE INGRESO DEL SUPERVISOR
--
-- Objetivo:
-- - mantener el ingreso remoto bloqueado por defecto;
-- - permitirlo únicamente para un primary/monitor explícitamente autorizados;
-- - rechazar cualquier otro comando productivo desde la RPC o un INSERT interno.
--
-- Este script NO autoriza ningún dispositivo. La tabla queda vacía hasta que
-- se inserte manualmente el par de dispositivos canary elegido.
-- No habilita el flag del frontend ni modifica stock.
--
-- Autorización posterior, solo para el dispositivo elegido:
-- INSERT INTO public.supervisor_canary_allowlist
--     (primary_device_id, monitor_device_id, purpose, enabled, expires_at)
-- VALUES
--     ('ID-CAJA-CANARY', 'ID-MONITOR-CANARY', 'M5 income canary', true, now() + interval '24 hours')
-- ON CONFLICT (primary_device_id) DO UPDATE SET
--     monitor_device_id = EXCLUDED.monitor_device_id,
--     purpose = EXCLUDED.purpose,
--     enabled = EXCLUDED.enabled,
--     expires_at = EXCLUDED.expires_at,
--     updated_at = now();
--
-- ROLLBACK:
-- 1) apagar VITE_SUPERVISOR_REMOTE_INCOME_ENABLED;
-- 2) confirmar 0 comandos pending;
-- 3) DROP TRIGGER IF EXISTS supervisor_canary_income_guard ON public.supervisor_commands;
-- 4) DROP FUNCTION IF EXISTS public.enforce_supervisor_canary_command();
-- 5) DROP TABLE IF EXISTS public.supervisor_canary_allowlist;

BEGIN;

CREATE TABLE IF NOT EXISTS public.supervisor_canary_allowlist (
    primary_device_id TEXT PRIMARY KEY,
    monitor_device_id TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'M5 income canary',
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

DROP POLICY IF EXISTS supervisor_canary_allowlist_definer_read
    ON public.supervisor_canary_allowlist;
CREATE POLICY supervisor_canary_allowlist_definer_read
    ON public.supervisor_canary_allowlist
    FOR SELECT
    TO postgres
    USING (true);

CREATE OR REPLACE FUNCTION public.enforce_supervisor_canary_command()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
    IF NEW.command_type <> 'supervisor.inventory.batch.adjust'
       OR coalesce(NEW.payload->>'direction', '') <> 'ingreso' THEN
        RAISE EXCEPTION 'Comando productivo no permitido durante el canary';
    END IF;

    IF NOT EXISTS (
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

COMMIT;
