-- STAGING ONLY — multi-locale supervisor phone (004)
-- Intended project ref: tdfcpwctvumbdjmifypd
-- Do NOT run against production.
--
-- Why: one supervisor phone must be able to watch several boxes (locales)
-- without re-pairing. The old unique index on monitor_device_id allowed only
-- one active box per phone. Each box still has exactly one row
-- (UNIQUE primary_device_id), and unpair_monitor only revokes the row of the
-- box it names, so dropping the monitor-wide uniqueness is safe.

BEGIN;

DROP INDEX IF EXISTS public.device_pairings_monitor_device_id_key;

-- Keep fast lookups of a phone's active locales.
CREATE INDEX IF NOT EXISTS device_pairings_monitor_device_active_idx
    ON public.device_pairings (monitor_device_id)
    WHERE revoked_at IS NULL;

COMMIT;
