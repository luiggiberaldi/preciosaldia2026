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

3. `20261013_004_staging_multi_locale_monitor.sql` — **applied to staging on 2026-10-13.** Drops the unique index on `device_pairings.monitor_device_id` so one supervisor phone can be linked to several boxes (locales) at once, and adds a partial index for active links. Each box still has one row (`UNIQUE primary_device_id`); `unpair_monitor` revokes only the named box. Verified: a rolled-back test linked one phone to two boxes. The app's locale selector is not implemented yet, so production stays untouched.

4. `20261013_006_staging_revoke_cancels_pending_commands.sql` — **applied to staging on 2026-10-13** after a backup (`scratch/staging-backup-before-006.md`). Makes `unpair_monitor` cancel the box's `pending` supervisor commands in the same transaction as the revocation (Fase 2). Verified in a rolled-back transaction: a pending command became `failed` and the pairing was revoked; no test rows remain.

5. `20261013_008_staging_read_revoked_command_outcomes.sql` — **applied to staging on 2026-10-13** after explicit approval. Adds a read-only SELECT policy so the owner and monitor of an `e2e-*` box can read orders cancelled by revocation (`status='failed'`, revocation message). Verified in a rolled-back transaction: monitor 1 row, owner 1 row, stranger 0 rows. No write permissions added.

6. `20261013_009_staging_stable_revoked_error_code.sql` — **applied to staging on 2026-10-13.** Replaces the Spanish revocation sentence with the stable code `REVOKED_BEFORE_ACK` in `unpair_monitor` and in the 008 read policy. Same SQL as the applied migration `staging_009_stable_revoked_error_code`.

7. `20261013_007_staging_owner_claim_code.sql` — registered as applied on **2026-10-13**, but its SQL was found missing from staging on **2026-10-14**. See entry 7b for the corrective reapplication and current verification.

7b. **Reaplicada el 2026-10-14.** El SQL de 007 no estaba realmente aplicado aunque figuraba en `supabase_migrations`: faltaban `create_owner_claim_code`, `claim_owner_device` y las columnas `claim_*`, y `generate_pairing_token` seguía con la brecha de reclamo. Se reaplicó en una transacción tras respaldo previo ([scratch/staging-backup-before-007-reapply.md](../../scratch/staging-backup-before-007-reapply.md)). Verificado después: funciones y columnas presentes, `anon` sin EXECUTE, 6 filas originales intactas. Casos con sesiones simuladas en transacciones revertidas: tercero bloqueado, dueño genera token, caja sin dueño bloqueada, código malo rechazado, reuso rechazado. Sin residuales. Después, E2E reales: reclamo de dueño 1/1, pairing clásico 1/1, desvinculación con secreto 1/1 y aislamiento entre dueños 1/1. Todos sin filas residuales. La UI del código de reclamo está en `PairingManager.jsx`; los E2E reclaman dueño antes de generar token.

## Staging-only E2E harness RPCs (not in a file here)

The functions `e2e_set_pairing_link`, `e2e_set_canary_allowlist` and `e2e_cleanup_commands` were applied **directly to staging** (`tdfcpwctvumbdjmifypd`) so the Supervisor command harness no longer needs the Management API token. They are not stored as a migration file in this directory yet; add one before any reproducible rebuild of staging.

- Each one is `SECURITY DEFINER`, rejects any device ID outside `e2e-%`, is executable only by `authenticated` (not `anon` or `PUBLIC`), and checks `auth.uid()`.
- They must never exist in production. A read-only query on `sodgzkablshladvbtnes` for `e2e_%` functions returned no rows.
- Why staging only: they write pairings, the canary allowlist and command rows, and they depend on synthetic `e2e-*` fixtures that exist only in staging. Copying them to production would open writes to real customer devices.
