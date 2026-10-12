-- STAGING ONLY — Precios al Día Supervisor pairing auth (part 2/2)
-- Intended project ref: tdfcpwctvumbdjmifypd
-- Local draft only: DO NOT run against production.
-- Uses only schema and synthetic e2e-* identifiers; it inserts no rows.
-- Review README.md in this directory before any future application.

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.device_pairings') IS NULL THEN
        RAISE EXCEPTION 'Expected staging table public.device_pairings is missing; apply reviewed schema draft 001 first';
    END IF;

    IF EXISTS (
        SELECT monitor_device_id
        FROM public.device_pairings
        WHERE monitor_device_id IS NOT NULL
        GROUP BY monitor_device_id
        HAVING count(*) > 1
    ) THEN
        RAISE EXCEPTION 'Duplicate monitor_device_id values exist; resolve staging conflicts before adding the production unique constraint';
    END IF;
END
$$;

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

ALTER TABLE public.device_pairings
    ADD COLUMN IF NOT EXISTS token_hash TEXT,
    ADD COLUMN IF NOT EXISTS token_used_at TIMESTAMPTZ;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM public.device_pairings
        WHERE primary_device_id NOT LIKE 'e2e-%'
    ) THEN
        RAISE EXCEPTION 'Non-synthetic pairing IDs are present; this E2E-only migration refuses to grant them RPC access';
    END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS device_pairings_monitor_device_id_key
    ON public.device_pairings (monitor_device_id);
CREATE INDEX IF NOT EXISTS idx_device_pairings_owner_auth
    ON public.device_pairings (owner_auth_id);
CREATE INDEX IF NOT EXISTS idx_device_pairings_monitor_auth
    ON public.device_pairings (monitor_auth_id);
CREATE INDEX IF NOT EXISTS idx_device_pairings_token_hash
    ON public.device_pairings (token_hash)
    WHERE token_hash IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_device_pairings_monitor
    ON public.device_pairings (monitor_device_id, primary_device_id);

ALTER TABLE public.device_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_pairings FORCE ROW LEVEL SECURITY;

-- Pairing token is single-use, hashed at rest, short-lived, and restricted to
-- synthetic staging identifiers even for a SECURITY DEFINER execution.
CREATE OR REPLACE FUNCTION public.generate_pairing_token(p_device_id TEXT)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_token TEXT;
    v_hash TEXT;
    v_owner UUID := auth.uid();
    v_updated INTEGER;
BEGIN
    IF v_owner IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;

    IF p_device_id IS NULL
       OR length(trim(p_device_id)) < 8
       OR length(trim(p_device_id)) > 160
       OR trim(p_device_id) NOT LIKE 'e2e-%' THEN
        RAISE EXCEPTION 'Identificador sintético de staging inválido';
    END IF;

    v_token := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 24));
    v_hash := encode(digest(v_token, 'sha256'), 'hex');

    UPDATE public.device_pairings
    SET pairing_token = NULL,
        token_hash = v_hash,
        token_expires_at = now() + interval '5 minutes',
        token_used_at = NULL,
        monitor_device_id = NULL,
        monitor_auth_id = NULL,
        paired_at = NULL,
        revoked_at = NULL,
        owner_auth_id = v_owner
    WHERE primary_device_id = trim(p_device_id)
      AND (
          owner_auth_id IS NULL
          OR owner_auth_id = v_owner
          OR revoked_at IS NOT NULL
      );

    GET DIAGNOSTICS v_updated = ROW_COUNT;

    IF v_updated = 0 THEN
        INSERT INTO public.device_pairings (
            primary_device_id,
            owner_auth_id,
            token_hash,
            token_expires_at,
            created_at
        ) VALUES (
            trim(p_device_id),
            v_owner,
            v_hash,
            now() + interval '5 minutes',
            now()
        );
    END IF;

    RETURN v_token;
END;
$$;

CREATE OR REPLACE FUNCTION public.pair_monitor_device(p_token TEXT, p_monitor_device_id TEXT)
RETURNS JSON
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_monitor UUID := auth.uid();
    v_pairing public.device_pairings%ROWTYPE;
BEGIN
    IF v_monitor IS NULL THEN
        RETURN json_build_object('success', false, 'message', 'Sesión no autenticada.');
    END IF;

    IF p_monitor_device_id IS NULL
       OR length(trim(p_monitor_device_id)) < 8
       OR length(trim(p_monitor_device_id)) > 160
       OR trim(p_monitor_device_id) NOT LIKE 'e2e-%' THEN
        RETURN json_build_object('success', false, 'message', 'Identificador sintético de staging inválido.');
    END IF;

    IF p_token IS NULL OR length(trim(p_token)) < 16 OR length(trim(p_token)) > 64 THEN
        RETURN json_build_object('success', false, 'message', 'Código inválido.');
    END IF;

    SELECT *
    INTO v_pairing
    FROM public.device_pairings
    WHERE token_hash = encode(digest(upper(trim(p_token)), 'sha256'), 'hex')
      AND token_expires_at > now()
      AND token_used_at IS NULL
      AND revoked_at IS NULL
      AND primary_device_id LIKE 'e2e-%'
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN json_build_object('success', false, 'message', 'El código expiró o ya fue utilizado.');
    END IF;

    IF v_pairing.monitor_auth_id IS NOT NULL
       AND v_pairing.monitor_auth_id <> v_monitor THEN
        RETURN json_build_object('success', false, 'message', 'El vínculo ya está ocupado.');
    END IF;

    UPDATE public.device_pairings
    SET monitor_device_id = trim(p_monitor_device_id),
        monitor_auth_id = v_monitor,
        pairing_token = NULL,
        token_hash = NULL,
        token_used_at = now(),
        paired_at = now()
    WHERE id = v_pairing.id;

    RETURN json_build_object(
        'success', true,
        'primary_device_id', v_pairing.primary_device_id
    );
END;
$$;

-- Keep the monitor identity on the revoked row so that the same session can
-- verify a lost response. Only this active monitor can revoke this pairing.
CREATE OR REPLACE FUNCTION public.unpair_monitor(p_device_id TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
    v_actor UUID := auth.uid();
BEGIN
    IF v_actor IS NULL THEN
        RAISE EXCEPTION 'Sesión no autenticada';
    END IF;

    IF p_device_id IS NULL OR trim(p_device_id) NOT LIKE 'e2e-%' THEN
        RAISE EXCEPTION 'Identificador sintético de staging inválido';
    END IF;

    UPDATE public.device_pairings
    SET monitor_device_id = NULL,
        pairing_token = NULL,
        token_hash = NULL,
        token_expires_at = NULL,
        token_used_at = NULL,
        paired_at = NULL,
        revoked_at = now()
    WHERE primary_device_id = trim(p_device_id)
      AND monitor_auth_id = v_actor
      AND revoked_at IS NULL;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'No autorizado o vínculo inexistente';
    END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.generate_pairing_token(TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.pair_monitor_device(TEXT, TEXT) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.unpair_monitor(TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.generate_pairing_token(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.pair_monitor_device(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.unpair_monitor(TEXT) TO authenticated;

-- Preserve staging-only row filters, and fail closed for authenticated reads
-- if their known E2E policies are absent. Do not widen these to production.
DROP POLICY IF EXISTS staging_authenticated_pairing_read ON public.device_pairings;
CREATE POLICY staging_authenticated_pairing_read
    ON public.device_pairings
    FOR SELECT
    TO authenticated
    USING (primary_device_id LIKE 'e2e-%');

DROP POLICY IF EXISTS staging_definer_pairing_access ON public.device_pairings;
CREATE POLICY staging_definer_pairing_access
    ON public.device_pairings
    FOR ALL
    TO postgres
    USING (primary_device_id LIKE 'e2e-%')
    WITH CHECK (primary_device_id LIKE 'e2e-%');

-- No direct table writes are granted here; RPCs are the only client write path.
REVOKE ALL ON TABLE public.device_pairings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.device_pairings TO authenticated;

COMMIT;
