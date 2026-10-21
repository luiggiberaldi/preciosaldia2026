-- PRODUCTION DRAFT — up to 2 active monitors per box
-- Target: sodgzkablshladvbtnes (Precios al Día production).
-- Status: NOT APPLIED. Requires a verified backup, staging rehearsal, and explicit approval.
-- Design draft only; not validated against a live database.
--
-- Purpose: allow at most two active phones (monitors) per box. Revoked rows keep history.
-- Current model: one monitor per box in device_pairings (monitor_auth_id / monitor_device_id).
-- This draft adds a separate table; it does not change device_pairings or the pairing RPCs.
--
-- Cap enforcement: a BEFORE INSERT trigger counts active monitors for the box under an
-- advisory lock, so two simultaneous pairings cannot both pass the count.
--
-- Grant-neutral: new table only. No existing row or function is changed.

BEGIN;

CREATE TABLE IF NOT EXISTS public.device_monitors (
    id                bigserial PRIMARY KEY,
    primary_device_id text NOT NULL,
    monitor_auth_id   uuid NOT NULL,
    monitor_device_id text NOT NULL,
    paired_at         timestamptz NOT NULL DEFAULT now(),
    revoked_at        timestamptz
);

-- One active row per (box, monitor account).
CREATE UNIQUE INDEX IF NOT EXISTS device_monitors_active_unique
    ON public.device_monitors (primary_device_id, monitor_auth_id)
    WHERE revoked_at IS NULL;

ALTER TABLE public.device_monitors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_monitors FORCE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.device_monitors FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.enforce_monitor_cap()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
    v_active integer;
BEGIN
    IF NEW.revoked_at IS NOT NULL THEN
        RETURN NEW;
    END IF;

    -- Serialize pairings per box so the count below is reliable.
    PERFORM pg_advisory_xact_lock(hashtext(NEW.primary_device_id));

    SELECT count(*) INTO v_active
    FROM public.device_monitors
    WHERE primary_device_id = NEW.primary_device_id
      AND revoked_at IS NULL
      AND monitor_auth_id <> NEW.monitor_auth_id;

    IF v_active >= 2 THEN
        RAISE EXCEPTION 'Caja llena: máximo 2 celulares conectados';
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS device_monitors_cap ON public.device_monitors;
CREATE TRIGGER device_monitors_cap
    BEFORE INSERT OR UPDATE OF revoked_at ON public.device_monitors
    FOR EACH ROW
    EXECUTE FUNCTION public.enforce_monitor_cap();

COMMIT;
