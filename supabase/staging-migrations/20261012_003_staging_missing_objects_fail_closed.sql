-- STAGING ONLY — additive, fail-closed migration (tdfcpwctvumbdjmifypd).
-- Do NOT run against production (sodgzkablshladvbtnes).
-- Creates only objects missing in staging, copied from the production catalog
-- as read-only definitions. No rows, auth users, secrets or grants are copied.
-- Every new table: RLS enabled AND forced, all client roles revoked, no policies.
-- Existing staging objects (device_pairings, supervisor_commands,
-- supervisor_canary_allowlist, sync_documents, ack/create/enforce functions)
-- are not altered here. The staging e2e-% policies are left untouched.

BEGIN;

CREATE TABLE IF NOT EXISTS public.account_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    device_id TEXT NOT NULL,
    device_alias TEXT DEFAULT 'Dispositivo',
    last_seen TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT account_devices_email_device_id_key UNIQUE (email, device_id)
);

CREATE TABLE IF NOT EXISTS public.backup_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,
    error TEXT
);

CREATE TABLE IF NOT EXISTS public.cloud_backups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    backup_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    email TEXT UNIQUE
);

CREATE TABLE IF NOT EXISTS public.cloud_licenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    device_id TEXT NOT NULL,
    license_type TEXT NOT NULL DEFAULT 'trial',
    days_remaining INTEGER DEFAULT 15,
    business_name TEXT,
    phone TEXT,
    is_active BOOLEAN DEFAULT true,
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.customer_projects (
    license_code TEXT PRIMARY KEY,
    account_email TEXT,
    business_name TEXT,
    phone TEXT,
    supabase_url TEXT NOT NULL,
    supabase_anon_key TEXT NOT NULL,
    product_id TEXT NOT NULL DEFAULT 'pro',
    status TEXT NOT NULL DEFAULT 'active',
    last_keepalive TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    max_devices INTEGER NOT NULL DEFAULT 6,
    revoked_device_ids TEXT[] NOT NULL DEFAULT '{}',
    device_count INTEGER NOT NULL DEFAULT 0,
    devices_info JSONB NOT NULL DEFAULT '[]'::jsonb,
    CONSTRAINT uq_customer_projects_supabase_url UNIQUE (supabase_url)
);

CREATE TABLE IF NOT EXISTS public.device_sessions (
    device_id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.licenses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT,
    product_id TEXT,
    type TEXT NOT NULL DEFAULT 'trial',
    code TEXT NOT NULL UNIQUE,
    is_active BOOLEAN DEFAULT true,
    expires_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    body TEXT,
    ref_id TEXT,
    product_id TEXT,
    read_at TIMESTAMPTZ,
    CONSTRAINT notifications_type_ref_id_key UNIQUE (type, ref_id)
);

CREATE TABLE IF NOT EXISTS public.product_images_catalog (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    image_url TEXT NOT NULL,
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

CREATE TABLE IF NOT EXISTS public.visits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    path TEXT,
    ip TEXT,
    user_agent TEXT,
    referer TEXT,
    country TEXT,
    city TEXT,
    screen TEXT,
    lang TEXT,
    tz TEXT
);

-- Fail closed: enable + force RLS, revoke every client-role privilege.
-- service_role keeps platform-managed access; no policies are added.
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY[
        'account_devices','backup_requests','cloud_backups','cloud_licenses',
        'customer_projects','device_sessions','licenses','notifications',
        'product_images_catalog','visits'
    ] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC, anon, authenticated', t);
    END LOOP;
END
$$;

-- Functions copied verbatim from production definitions (read-only inspection).
-- NOTE: no EXECUTE grants are changed here. PostgreSQL grants EXECUTE to PUBLIC
-- by default, so anon/authenticated can call the SECURITY DEFINER writers below
-- (auto_register_device, heartbeat_device, report_pro_devices, activate_demo_secure).
-- Restricting them is a separate, reviewed step (see report).

CREATE OR REPLACE FUNCTION public.current_device_id()
 RETURNS text
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
    header_device text;
    registered    text;
begin
    begin
        header_device := nullif(current_setting('request.headers', true)::json->>'x-device-id', '');
    exception when others then
        header_device := null;
    end;

    if header_device is null then
        return null;
    end if;

    select device_id into registered
    from public.device_sessions
    where device_id = header_device;

    if found then
        return registered;
    end if;

    return null;
end;
$function$;

CREATE OR REPLACE FUNCTION public.is_own_device_row(target_device_id text)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    select exists (
        select 1
        from public.device_sessions ds
        where ds.device_id = target_device_id
          and ds.user_id = auth.uid()
    );
$function$;

CREATE OR REPLACE FUNCTION public.heartbeat_device(p_device_id text, p_product_id text, p_client_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
BEGIN
    UPDATE public.licenses
    SET updated_at = NOW()
    WHERE device_id = p_device_id AND product_id = p_product_id;

    UPDATE public.cloud_licenses
    SET updated_at = NOW(),
        business_name = CASE WHEN business_name IS NULL OR business_name = 'Nuevo Dispositivo' OR business_name = '' THEN COALESCE(NULLIF(p_client_name, ''), business_name) ELSE business_name END
    WHERE device_id = p_device_id;

    UPDATE public.account_devices
    SET last_seen = NOW(),
        device_alias = CASE WHEN device_alias IS NULL OR device_alias = 'Dispositivo' OR device_alias = '' THEN COALESCE(NULLIF(p_client_name, ''), device_alias) ELSE device_alias END
    WHERE device_id = p_device_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.get_license_status(p_device_id text)
 RETURNS TABLE(type text, is_active boolean, expires_at timestamp with time zone, created_at timestamp with time zone)
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT type, is_active, expires_at, created_at
      FROM public.licenses
     WHERE device_id  = p_device_id
       AND product_id = 'bodega'
     LIMIT 1;
$function$;

CREATE OR REPLACE FUNCTION public.verify_activation_code(p_device_id text, p_code text)
 RETURNS boolean
 LANGUAGE sql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
    SELECT EXISTS (
        SELECT 1 FROM public.cloud_licenses
        WHERE device_id = p_device_id
          AND is_active = true
          AND (
            license_type = 'permanent'
            OR (license_type = 'days' AND days_remaining > 0)
          )
    );
$function$;

CREATE OR REPLACE FUNCTION public.lookup_customer_project(p_code text)
 RETURNS TABLE(supabase_url text, supabase_anon_key text, max_devices integer, revoked_device_ids text[])
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$ select cp.supabase_url, cp.supabase_anon_key, cp.max_devices, cp.revoked_device_ids from public.customer_projects cp where cp.license_code = p_code and cp.status = 'active' $function$;

CREATE OR REPLACE FUNCTION public.report_pro_devices(p_code text, p_devices jsonb)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
begin
  update public.customer_projects
  set devices_info = p_devices,
      device_count = jsonb_array_length(p_devices),
      last_keepalive = now()
  where license_code = p_code and status = 'active';
end;
$function$;

CREATE OR REPLACE FUNCTION public.auto_register_device(p_device_id text, p_product_id text, p_client_name text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
AS $function$
DECLARE
    v_lic_exists BOOLEAN;
    v_cl_exists BOOLEAN;
    v_dev_exists BOOLEAN;
    v_email TEXT;
BEGIN
    v_email := LOWER(p_device_id) || '@pda.local';

    SELECT EXISTS (
        SELECT 1 FROM public.licenses
        WHERE device_id = p_device_id AND product_id = p_product_id
    ) INTO v_lic_exists;

    IF NOT v_lic_exists THEN
        INSERT INTO public.licenses (device_id, product_id, type, code, is_active, expires_at, created_at, updated_at)
        VALUES (p_device_id, p_product_id, 'registered', 'SIN-LICENCIA-' || p_device_id, false, NULL, NOW(), NOW());
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.cloud_licenses
        WHERE device_id = p_device_id
    ) INTO v_cl_exists;

    IF NOT v_cl_exists THEN
        INSERT INTO public.cloud_licenses (device_id, email, license_type, business_name, is_active, created_at, updated_at)
        VALUES (p_device_id, v_email, 'registered', COALESCE(NULLIF(p_client_name, ''), 'Nuevo Dispositivo'), false, NOW(), NOW());
    END IF;

    SELECT EXISTS (
        SELECT 1 FROM public.account_devices
        WHERE device_id = p_device_id
    ) INTO v_dev_exists;

    IF NOT v_dev_exists THEN
        INSERT INTO public.account_devices (email, device_id, device_alias, last_seen, created_at)
        VALUES (v_email, p_device_id, COALESCE(NULLIF(p_client_name, ''), 'Dispositivo'), NOW(), NOW());
    END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.activate_demo_secure(p_device_id text, p_product_id text)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_id        UUID;
    v_type      TEXT;
    v_is_active BOOLEAN;
BEGIN
    SELECT id, type, is_active
      INTO v_id, v_type, v_is_active
      FROM public.licenses
     WHERE device_id  = p_device_id
       AND product_id = p_product_id;

    IF v_id IS NULL THEN
        INSERT INTO public.licenses (device_id, product_id, type, code, is_active, expires_at)
        VALUES (p_device_id, p_product_id, 'demo3',
                'DEMO-' || upper(substring(md5(random()::text) from 1 for 10)),
                true, NOW() + INTERVAL '3 days');
        RETURN true;
    END IF;

    IF v_type = 'registered' THEN
        UPDATE public.licenses
           SET type       = 'demo3',
               is_active  = true,
               expires_at = NOW() + INTERVAL '3 days',
               updated_at = NOW()
         WHERE id = v_id;
        RETURN true;
    END IF;

    RETURN false;
END;
$function$;

-- generate_pairing_token / pair_monitor_device / unpair_monitor are NOT defined
-- here: migration 20261011_002 owns them (E2E-restricted, REVOKE/GRANT applied).

-- Not included: supervisor_income_pairing_guard trigger and the
-- ack/create/enforce supervisor functions. These already exist in staging
-- with the same names and signatures; altering them is a separate reviewed step.

COMMIT;
