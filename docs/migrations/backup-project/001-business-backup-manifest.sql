-- 001-business-backup-manifest.sql
-- LOCAL DRAFT. Apply only to the dedicated backup Supabase project, after
-- access, target ref, bucket policy and migration plan are explicitly approved.
-- Station must independently verify active Lite entitlement before each upload.

begin;

create table if not exists public.backup_businesses (
  business_id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  check (archived_at is null or archived_at >= created_at)
);

create table if not exists public.backup_device_assignments (
  assignment_id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.backup_businesses(business_id) on delete restrict,
  product_id text not null check (product_id = 'bodega'),
  device_id text not null check (device_id = upper(device_id) and char_length(device_id) between 8 and 64),
  assigned_at timestamptz not null default now(),
  revoked_at timestamptz,
  check (revoked_at is null or revoked_at >= assigned_at),
  unique (assignment_id, business_id, product_id, device_id)
);

create unique index if not exists backup_device_one_active_assignment
  on public.backup_device_assignments (product_id, device_id) where revoked_at is null;
create index if not exists backup_assignments_business_history
  on public.backup_device_assignments (business_id, assigned_at desc);

create table if not exists public.backup_manifests (
  manifest_id uuid primary key default gen_random_uuid(),
  assignment_id uuid not null,
  business_id uuid not null,
  product_id text not null check (product_id = 'bodega'),
  device_id text not null,
  operation_id uuid not null,
  storage_path text not null,
  status text not null default 'uploading'
    check (status in ('uploading', 'verified', 'cleanup_pending', 'deleted', 'failed')),
  size_bytes bigint not null check (size_bytes between 1 and 52428800),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  schema_version smallint not null check (schema_version between 1 and 100),
  created_at timestamptz not null default now(),
  verified_at timestamptz,
  cleanup_completed_at timestamptz,
  error_code text check (error_code is null or error_code in (
    'object_upload_failed', 'verification_failed', 'assignment_revoked',
    'schema_invalid', 'quota_exceeded', 'storage_unavailable'
  )),
  foreign key (assignment_id, business_id, product_id, device_id)
    references public.backup_device_assignments(assignment_id, business_id, product_id, device_id)
    on delete restrict,
  unique (business_id, operation_id),
  unique (storage_path),
  check (storage_path = business_id::text || '/' || operation_id::text || '.json.gz'),
  check (
    (status in ('uploading', 'failed') and verified_at is null and cleanup_completed_at is null)
    or (status in ('verified', 'cleanup_pending') and verified_at is not null and cleanup_completed_at is null)
    or (status = 'deleted' and verified_at is not null and cleanup_completed_at is not null)
  ),
  check ((status = 'failed') = (error_code is not null))
);

create index if not exists backup_manifests_retention
  on public.backup_manifests (business_id, verified_at desc, created_at desc, manifest_id desc)
  where status = 'verified';
create index if not exists backup_manifests_cleanup
  on public.backup_manifests (business_id, created_at) where status = 'cleanup_pending';
create index if not exists backup_manifests_assignment
  on public.backup_manifests (assignment_id, created_at desc);

alter table public.backup_businesses enable row level security;
alter table public.backup_device_assignments enable row level security;
alter table public.backup_manifests enable row level security;
revoke all on public.backup_businesses, public.backup_device_assignments, public.backup_manifests
  from public, anon, authenticated, service_role;
grant select on public.backup_businesses, public.backup_device_assignments, public.backup_manifests
  to service_role;

create or replace function public.create_backup_business(p_business_id uuid)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
begin
  if p_business_id is null then
    raise exception using errcode = '22023', message = 'business_id_required';
  end if;
  insert into public.backup_businesses(business_id) values (p_business_id)
    on conflict (business_id) do nothing;
  return p_business_id;
end;
$fn$;

create or replace function public.assign_backup_device(p_business_id uuid, p_product_id text, p_device_id text)
returns uuid language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_device_id text;
  v_assignment_id uuid;
  v_owner uuid;
begin
  if p_product_id is distinct from 'bodega' then
    raise exception using errcode = '22023', message = 'product_not_enabled';
  end if;
  v_device_id := upper(regexp_replace(btrim(coalesce(p_device_id, '')), '[[:space:]]+', '', 'g'));
  if char_length(v_device_id) not between 8 and 64 then
    raise exception using errcode = '22023', message = 'device_id_invalid';
  end if;

  -- Serializes assignment against archive and concurrent duplicate requests.
  perform 1 from public.backup_businesses b
    where b.business_id = p_business_id and b.archived_at is null for update;
  if not found then
    raise exception using errcode = '23503', message = 'business_not_found_or_archived';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_product_id || ':' || v_device_id, 1));

  select a.assignment_id, a.business_id into v_assignment_id, v_owner
    from public.backup_device_assignments a
    where a.product_id = p_product_id and a.device_id = v_device_id and a.revoked_at is null
    for update;
  if found then
    if v_owner = p_business_id then return v_assignment_id; end if;
    raise exception using errcode = '23505', message = 'device_already_assigned';
  end if;
  insert into public.backup_device_assignments(business_id, product_id, device_id)
    values (p_business_id, p_product_id, v_device_id) returning assignment_id into v_assignment_id;
  return v_assignment_id;
end;
$fn$;

create or replace function public.revoke_backup_device_assignment(p_assignment_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
begin
  update public.backup_device_assignments set revoked_at = coalesce(revoked_at, now())
    where assignment_id = p_assignment_id;
end;
$fn$;

create or replace function public.archive_backup_business(p_business_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
begin
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_business_id::text, 0));
  perform 1 from public.backup_businesses b where b.business_id = p_business_id for update;
  if not found then raise exception using errcode = '23503', message = 'business_not_found'; end if;
  if exists (select 1 from public.backup_device_assignments a
    where a.business_id = p_business_id and a.revoked_at is null) then
    raise exception using errcode = '23514', message = 'business_has_active_devices';
  end if;
  update public.backup_businesses set archived_at = coalesce(archived_at, now())
    where business_id = p_business_id;
end;
$fn$;

create or replace function public.begin_backup_operation(
  p_assignment_id uuid, p_operation_id uuid, p_size_bytes bigint, p_sha256 text, p_schema_version smallint
)
returns table (manifest_id uuid, business_id uuid, storage_path text, status text)
language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_assignment public.backup_device_assignments%rowtype;
  v_manifest public.backup_manifests%rowtype;
  v_path text;
begin
  if p_operation_id is null or p_size_bytes is null or p_size_bytes not between 1 and 52428800
    or p_sha256 is null or p_sha256 !~ '^[0-9a-f]{64}$'
    or p_schema_version is null or p_schema_version not between 1 and 100 then
    raise exception using errcode = '22023', message = 'backup_metadata_invalid';
  end if;
  select a.* into v_assignment from public.backup_device_assignments a
    join public.backup_businesses b using (business_id)
    where a.assignment_id = p_assignment_id and a.product_id = 'bodega'
      and a.revoked_at is null and b.archived_at is null for update of a;
  if not found then raise exception using errcode = '23503', message = 'active_assignment_not_found'; end if;

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_assignment.business_id::text, 0));
  v_path := v_assignment.business_id::text || '/' || p_operation_id::text || '.json.gz';
  insert into public.backup_manifests(assignment_id, business_id, product_id, device_id,
    operation_id, storage_path, status, size_bytes, sha256, schema_version)
  values (v_assignment.assignment_id, v_assignment.business_id, v_assignment.product_id,
    v_assignment.device_id, p_operation_id, v_path, 'uploading', p_size_bytes, p_sha256, p_schema_version)
  on conflict (business_id, operation_id) do nothing returning * into v_manifest;
  if not found then
    select m.* into v_manifest from public.backup_manifests m
      where m.business_id = v_assignment.business_id and m.operation_id = p_operation_id for update;
    if v_manifest.assignment_id <> v_assignment.assignment_id or v_manifest.device_id <> v_assignment.device_id
      or v_manifest.size_bytes <> p_size_bytes or v_manifest.sha256 <> p_sha256
      or v_manifest.schema_version <> p_schema_version then
      raise exception using errcode = '22023', message = 'operation_id_payload_conflict';
    end if;
  end if;
  return query select v_manifest.manifest_id, v_manifest.business_id, v_manifest.storage_path, v_manifest.status;
end;
$fn$;

create or replace function public.finalize_backup_upload(
  p_manifest_id uuid, p_verified_size_bytes bigint, p_verified_sha256 text
)
returns table (manifest_id uuid, storage_path text)
language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_business_id uuid;
  v_assignment_id uuid;
  v_manifest public.backup_manifests%rowtype;
begin
  select m.business_id, m.assignment_id into v_business_id, v_assignment_id
    from public.backup_manifests m where m.manifest_id = p_manifest_id;
  if not found then raise exception using errcode = '23503', message = 'manifest_not_found'; end if;
  -- Match begin's assignment -> business lock order and serialize revocation.
  perform 1 from public.backup_device_assignments a where a.assignment_id = v_assignment_id for update;
  if not found then raise exception using errcode = '23503', message = 'assignment_not_found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_business_id::text, 0));
  select m.* into v_manifest from public.backup_manifests m where m.manifest_id = p_manifest_id for update;

  if v_manifest.status = 'uploading' then
    if v_manifest.size_bytes is distinct from p_verified_size_bytes
      or v_manifest.sha256 is distinct from p_verified_sha256 then
      raise exception using errcode = '22023', message = 'verified_object_mismatch';
    end if;
    if not exists (select 1 from public.backup_device_assignments a
      join public.backup_businesses b using (business_id)
      where a.assignment_id = v_manifest.assignment_id and a.business_id = v_manifest.business_id
        and a.product_id = v_manifest.product_id and a.device_id = v_manifest.device_id
        and a.revoked_at is null and b.archived_at is null) then
      raise exception using errcode = '23514', message = 'assignment_revoked_during_upload';
    end if;
    update public.backup_manifests set status = 'verified', verified_at = now(), error_code = null
      where backup_manifests.manifest_id = p_manifest_id;
    with ranked as (
      select m.manifest_id, row_number() over (order by m.verified_at desc, m.created_at desc, m.manifest_id desc) as n
      from public.backup_manifests m
      where m.business_id = v_business_id and m.product_id = 'bodega' and m.status = 'verified'
    )
    update public.backup_manifests m set status = 'cleanup_pending'
      from ranked r where m.manifest_id = r.manifest_id and r.n > 3;
  elsif v_manifest.status in ('verified', 'cleanup_pending', 'deleted') then
    if v_manifest.size_bytes is distinct from p_verified_size_bytes
      or v_manifest.sha256 is distinct from p_verified_sha256 then
      raise exception using errcode = '22023', message = 'verified_object_mismatch';
    end if;
  else
    raise exception using errcode = '23514', message = 'backup_operation_not_finalizable';
  end if;
  return query select m.manifest_id, m.storage_path from public.backup_manifests m
    where m.business_id = v_business_id and m.status = 'cleanup_pending'
    order by m.created_at, m.manifest_id;
end;
$fn$;

create or replace function public.complete_backup_cleanup(p_manifest_id uuid)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
declare v_business_id uuid; v_status text;
begin
  select m.business_id into v_business_id from public.backup_manifests m where m.manifest_id = p_manifest_id;
  if not found then raise exception using errcode = '23503', message = 'manifest_not_found'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_business_id::text, 0));
  select m.status into v_status from public.backup_manifests m where m.manifest_id = p_manifest_id for update;
  update public.backup_manifests set status = 'deleted', cleanup_completed_at = coalesce(cleanup_completed_at, now())
    where manifest_id = p_manifest_id and status = 'cleanup_pending';
  if not found and v_status <> 'deleted' then
    raise exception using errcode = '23514', message = 'manifest_not_pending_cleanup';
  end if;
end;
$fn$;

create or replace function public.fail_backup_operation(p_manifest_id uuid, p_error_code text)
returns void language plpgsql security definer
set search_path = pg_catalog, public
as $fn$
begin
  if p_error_code is null or p_error_code not in ('object_upload_failed', 'verification_failed',
    'assignment_revoked', 'schema_invalid', 'quota_exceeded', 'storage_unavailable') then
    raise exception using errcode = '22023', message = 'error_code_invalid';
  end if;
  update public.backup_manifests set status = 'failed', error_code = p_error_code
    where manifest_id = p_manifest_id and status = 'uploading';
  if not found and not exists (select 1 from public.backup_manifests m
    where m.manifest_id = p_manifest_id and m.status = 'failed' and m.error_code = p_error_code) then
    raise exception using errcode = '23514', message = 'manifest_not_uploading';
  end if;
end;
$fn$;

revoke all on function public.create_backup_business(uuid) from public, anon, authenticated;
revoke all on function public.assign_backup_device(uuid, text, text) from public, anon, authenticated;
revoke all on function public.revoke_backup_device_assignment(uuid) from public, anon, authenticated;
revoke all on function public.archive_backup_business(uuid) from public, anon, authenticated;
revoke all on function public.begin_backup_operation(uuid, uuid, bigint, text, smallint) from public, anon, authenticated;
revoke all on function public.finalize_backup_upload(uuid, bigint, text) from public, anon, authenticated;
revoke all on function public.complete_backup_cleanup(uuid) from public, anon, authenticated;
revoke all on function public.fail_backup_operation(uuid, text) from public, anon, authenticated;
grant execute on function public.create_backup_business(uuid) to service_role;
grant execute on function public.assign_backup_device(uuid, text, text) to service_role;
grant execute on function public.revoke_backup_device_assignment(uuid) to service_role;
grant execute on function public.archive_backup_business(uuid) to service_role;
grant execute on function public.begin_backup_operation(uuid, uuid, bigint, text, smallint) to service_role;
grant execute on function public.finalize_backup_upload(uuid, bigint, text) to service_role;
grant execute on function public.complete_backup_cleanup(uuid) to service_role;
grant execute on function public.fail_backup_operation(uuid, text) to service_role;

commit;
