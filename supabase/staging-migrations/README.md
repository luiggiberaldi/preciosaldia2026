# Staging-only migration drafts — Precios al Día

These SQL files are **local drafts for `precios-al-dia-staging` only** (`tdfcpwctvumbdjmifypd`). They are intentionally outside `supabase/migrations/`: the repository has no `supabase/config.toml`, its existing migration history is not a safe baseline for both remotes, and the existing `001_device_own_row_rls.sql` assumes tables that are missing from the staging database. Putting these drafts in the default migration chain could make a later `db push` target production unintentionally.

They are a **partial staging E2E schema alignment**, not a full application clone. For example, `useAutoBackup` writes `backup_requests` and `useCloudBackup` reads/writes `cloud_backups`; this draft creates those tables fail-closed but does not add their application policies, matching functions, Auth settings, or fixtures. Do not switch the full E2E app to this schema and assume those flows work until their policies and remaining RPCs have been separately designed and tested.

## Files and order

1. `20261011_001_staging_public_schema.sql` — adds production-shaped public tables missing from staging, aligns `sync_documents`, and leaves all new tables fail-closed under RLS.
2. `20261011_002_staging_supervisor_pairing_auth.sql` — adds the missing hashed-token columns/index, creates pairing/revocation RPCs, and grants only the authenticated access required by Supervisor E2E. It preserves the staging `e2e-*` boundary.

## Critical limits

- **Not applied.** These files have not been sent to either Supabase project. No backup, seed rows, customer records, auth users, Storage objects, or secrets are included.
- Before any later manual execution, verify the linked/selected project in Supabase Dashboard and CLI is exactly `tdfcpwctvumbdjmifypd`. The database itself does not reliably expose its project ref to a generic SQL script, so the target check must happen in the operator workflow.
- Both drafts begin a transaction. Migration 001 aborts if `sync_documents` contains any rows before replacing its UUID primary-key column with the production BIGSERIAL shape. Do not remove that guard to force the migration through. For the inspected zero-row state, the conversion is transactional and attaches a fresh sequence to the BIGINT ID.
- Migration 002 aborts if existing monitor IDs are duplicated. Neither migration deletes records or copies production data. Pairing RPCs reject device identifiers outside `e2e-*`; these drafts are not suitable for serving real staging accounts.
- These drafts match the **public table shapes and the Supervisor pairing path**, not the complete production runtime. Production-only RPCs outside pairing/Supervisor, application-specific policies/grants, Auth provider settings, Storage, and non-public schemas are deliberately not copied. New non-Supervisor tables remain inaccessible to `anon` and `authenticated` until each needed staging policy is designed and reviewed.
- This is not yet a full clone or a ready-to-run Supabase CLI migration chain. After review, create/repair a versioned baseline, test locally, take a private staging backup, and obtain explicit approval before applying any DDL remotely. Never run these drafts against production.
- Do not use `supabase db reset --linked` or the `DROP ... CASCADE` comment in `supabase_supervisor_staging.sql` as rollback.

## Verification needed before a future application

1. Recheck project health and refs; inspect the current migration history and exact table/column/constraint state.
2. Take and verify a private backup of staging.
3. Test these drafts against a local Postgres/Supabase instance representing the inspected staging structure, including the zero-row guard, RLS, RPC authorization, and rollback behavior.
4. Review the SQL diff and then apply only after separate approval. Re-query schema and policies, run the opt-in E2E suite with the explicit staging URL/key, and confirm production remained unchanged.

## Staging-only E2E harness RPCs (not in a file here)

The functions `e2e_set_pairing_link`, `e2e_set_canary_allowlist` and `e2e_cleanup_commands` were applied **directly to staging** (`tdfcpwctvumbdjmifypd`) so the Supervisor command harness no longer needs the Management API token. They are not stored as a migration file in this directory yet; add one before any reproducible rebuild of staging.

- Each one is `SECURITY DEFINER`, rejects any device ID outside `e2e-%`, is executable only by `authenticated` (not `anon` or `PUBLIC`), and checks `auth.uid()`.
- They must never exist in production. A read-only query on `sodgzkablshladvbtnes` for `e2e_%` functions returned no rows.
- Why staging only: they write pairings, the canary allowlist and command rows, and they depend on synthetic `e2e-*` fixtures that exist only in staging. Copying them to production would open writes to real customer devices.
