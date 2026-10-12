-- STAGING ONLY — Precios al Día schema alignment (part 1/2)
-- Intended project ref: tdfcpwctvumbdjmifypd
-- Local draft only: DO NOT run against production.
-- No customer rows, auth users, secrets, or production data are copied.
-- Review README.md in this directory before any future application.
--
-- This is intentionally additive and aborts rather than discarding an
-- unexpected non-empty sync_documents table. Staging currently reports zero
-- rows there. It does not create permissive RLS policies for new tables.

BEGIN;

DO $$
BEGIN
    IF to_regclass('public.sync_documents') IS NULL THEN
        RAISE EXCEPTION 'Expected staging table public.sync_documents is missing; inspect target before proceeding';
    END IF;

    IF EXISTS (SELECT 1 FROM public.sync_documents LIMIT 1) THEN
        RAISE EXCEPTION 'sync_documents is not empty; this draft will not replace its primary key or constraints';
    END IF;
END
$$;

-- Shape copied from read-only production catalog inspection, not production data.
-- Preserve staging RLS and its e2e-only SELECT policy. Drop only the known
-- staging UUID PK after the empty-table guard above, then restore production
-- BIGSERIAL/unique-key shape. Realtime publication membership is unchanged.
ALTER TABLE public.sync_documents
    DROP CONSTRAINT IF EXISTS sync_documents_pkey;

CREATE SEQUENCE IF NOT EXISTS public.sync_documents_id_seq AS BIGINT;

ALTER TABLE public.sync_documents
    ALTER COLUMN id DROP DEFAULT,
    ALTER COLUMN id TYPE BIGINT USING id::text::bigint,
    ALTER COLUMN id SET DEFAULT nextval('public.sync_documents_id_seq'::regclass),
    ALTER COLUMN data SET DEFAULT '{}'::jsonb;

ALTER SEQUENCE public.sync_documents_id_seq OWNED BY public.sync_documents.id;
SELECT setval(
    'public.sync_documents_id_seq'::regclass,
    GREATEST(coalesce((SELECT max(id) FROM public.sync_documents), 0), 1),
    EXISTS (SELECT 1 FROM public.sync_documents)
);
ALTER TABLE public.sync_documents ADD CONSTRAINT sync_documents_pkey PRIMARY KEY (id);

ALTER TABLE public.sync_documents
    ADD COLUMN IF NOT EXISTS payload JSONB NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.sync_documents
    DROP CONSTRAINT IF EXISTS sync_documents_device_id_doc_id_key;
ALTER TABLE public.sync_documents
    DROP CONSTRAINT IF EXISTS sync_documents_device_id_collection_doc_id_key;
ALTER TABLE public.sync_documents
    ADD CONSTRAINT sync_documents_device_id_collection_doc_id_key
        UNIQUE (device_id, collection, doc_id);
CREATE INDEX IF NOT EXISTS idx_sync_documents_device_id
    ON public.sync_documents (device_id);
ALTER TABLE public.sync_documents REPLICA IDENTITY DEFAULT;

-- Application support tables present in production. These are empty schema
-- definitions only; no rows are seeded. Enable and FORCE RLS so creating the
-- tables does not grant client access. Add narrowly scoped policies only if a
-- separate E2E requirement is reviewed and approved.
CREATE TABLE IF NOT EXISTS public.account_devices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL,
    device_id TEXT NOT NULL,
    device_alias TEXT DEFAULT 'Dispositivo',
    last_seen TIMESTAMPTZ DEFAULT now(),
    created_at TIMESTAMPTZ DEFAULT now(),
    CONSTRAINT account_devices_email_device_id_key UNIQUE (email, device_id)
);
ALTER TABLE public.account_devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.account_devices FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.backup_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TIMESTAMPTZ DEFAULT now(),
    completed_at TIMESTAMPTZ,
    error TEXT
);
ALTER TABLE public.backup_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backup_requests FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.cloud_backups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    device_id TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    backup_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    email TEXT UNIQUE
);
CREATE INDEX IF NOT EXISTS idx_cloud_backups_email ON public.cloud_backups (email);
ALTER TABLE public.cloud_backups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_backups FORCE ROW LEVEL SECURITY;

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
CREATE INDEX IF NOT EXISTS idx_cloud_licenses_device_id ON public.cloud_licenses (device_id);
ALTER TABLE public.cloud_licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cloud_licenses FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.customer_projects (
    license_code TEXT PRIMARY KEY,
    account_email TEXT,
    business_name TEXT,
    phone TEXT,
    supabase_url TEXT NOT NULL UNIQUE,
    supabase_anon_key TEXT NOT NULL,
    product_id TEXT NOT NULL DEFAULT 'pro',
    status TEXT NOT NULL DEFAULT 'active',
    last_keepalive TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    max_devices INTEGER NOT NULL DEFAULT 6,
    revoked_device_ids TEXT[] NOT NULL DEFAULT '{}',
    device_count INTEGER NOT NULL DEFAULT 0,
    devices_info JSONB NOT NULL DEFAULT '[]'::jsonb
);
ALTER TABLE public.customer_projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customer_projects FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.device_sessions (
    device_id TEXT PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.device_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_sessions FORCE ROW LEVEL SECURITY;

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
ALTER TABLE public.licenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.licenses FORCE ROW LEVEL SECURITY;

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
CREATE INDEX IF NOT EXISTS notifications_created_at_idx ON public.notifications (created_at DESC);
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications FORCE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.product_images_catalog (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    image_url TEXT NOT NULL,
    tags TEXT[] DEFAULT '{}',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);
ALTER TABLE public.product_images_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_images_catalog FORCE ROW LEVEL SECURITY;

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
CREATE INDEX IF NOT EXISTS visits_created_at_idx ON public.visits (created_at DESC);
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.visits FORCE ROW LEVEL SECURITY;

-- RLS alone does not protect a table if default privileges grant table access.
-- Explicitly revoke client/public privileges on the application tables added
-- by this draft. service_role retains its platform-managed access.
REVOKE ALL ON TABLE
    public.account_devices,
    public.backup_requests,
    public.cloud_backups,
    public.cloud_licenses,
    public.customer_projects,
    public.device_sessions,
    public.licenses,
    public.notifications,
    public.product_images_catalog,
    public.visits
FROM PUBLIC, anon, authenticated;

-- RLS is already enabled on these staging tables; force it to match the
-- existing staging security posture documented by catalog inspection.
ALTER TABLE public.device_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.device_pairings FORCE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_commands ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_commands FORCE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_canary_allowlist ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.supervisor_canary_allowlist FORCE ROW LEVEL SECURITY;

-- Deliberately do not copy production grants, policies, rows, auth settings,
-- functions, or secrets. E2E fixture/policy configuration remains a separate,
-- reviewed staging-only step.

COMMIT;
