# Supervisor Device Session and Unpair Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the primary device's Supervisor session provable by the backend so authorized unpairing works in production and staging without weakening authorization.

**Architecture:** Reuse the existing `ensureDeviceSessionRegistered` identity helper, prefer a backend RPC when an environment has revoked direct table writes, and retain the existing direct-table path as a compatibility fallback for the production migration already deployed. Register the session before pairing status checks and immediately before unpairing; the existing `unpair_monitor` authorization remains the source of truth.

**Tech Stack:** React, Supabase Auth/PostgREST, PostgreSQL migrations, Vitest, ESLint, TypeScript check, Vite.

---

### Task 1: Add failing regression coverage for session registration and unpair wiring

**Files:**
- Modify: `tests/deviceIdentity.test.js`
- Modify: `tests/supervisorLifecycle.test.js`

**Step 1: Write the failing test**

Cover the RPC-first path, the compatibility fallback when the RPC is unavailable, and the requirement that `PairingManager` imports and invokes the identity registration before calling `unpair_monitor`.

**Step 2: Run tests to verify they fail**

Run: `bunx vitest run tests/deviceIdentity.test.js tests/supervisorLifecycle.test.js --maxWorkers=1`

Expected: FAIL because the helper does not call `register_device_session` and `PairingManager` does not register the primary session.

### Task 2: Implement backend-compatible device session registration

**Files:**
- Modify: `src/utils/deviceIdentity.js`

**Step 1: Implement the minimal behavior**

Attempt `register_device_session(p_device_id)` first. Accept a successful `{ success: true }` response as registration. If the RPC is not installed, fall back to the existing direct insert/reclaim flow. Return structured errors for authentication, conflict, RLS, and network failures without throwing.

**Step 2: Run focused tests**

Run: `bunx vitest run tests/deviceIdentity.test.js --maxWorkers=1`

Expected: PASS.

### Task 3: Register the primary session in the pairing lifecycle

**Files:**
- Modify: `src/components/Settings/PairingManager.jsx`

**Step 1: Wire registration**

After `ensureSupervisorSession()` succeeds in the initial pairing check and in `handleUnpairConfirm`, call `ensureDeviceSessionRegistered(deviceId)`. Abort the remote action with a clear error if registration fails, then re-read server state as the existing code already does.

**Step 2: Run lifecycle tests and lint**

Run: `bunx vitest run tests/supervisorLifecycle.test.js --maxWorkers=1` and `bun run lint:supervisor`

Expected: PASS with no lint errors.

### Task 4: Add idempotent SQL for the RPC in production and staging

**Files:**
- Create: `supabase/migrations/20261015_supervisor_device_session_registration.sql`
- Create: `supabase/staging-migrations/20261015_001_staging_device_session_registration.sql`

**Step 1: Add production migration**

Create an authenticated, `SECURITY DEFINER`, idempotent RPC that inserts or refreshes the current user's `device_sessions` row, rejects ownership conflicts, revokes public/anon execution, and grants execution only to authenticated/service_role.

**Step 2: Add staging migration**

Create the staging-only equivalent that preserves the `e2e-%` restriction and the staging fail-closed policy; it must be safe to rerun and must not be used against the production project.

**Step 3: Add SQL contract assertions**

Extend the identity tests to assert the key grants, conflict guard, and environment-specific device validation are present.

### Task 5: Verify the Supervisor release gate

**Files:**
- No additional source files.

**Step 1: Run focused tests**

Run: `bunx vitest run tests/deviceIdentity.test.js tests/supervisorLifecycle.test.js --maxWorkers=1`

**Step 2: Run project checks**

Run: `bun run typecheck`, `bun run lint:supervisor`, `bun run test:supervisor -- --maxWorkers=1`, and `bun run build`.

Expected: the new P0 tests pass; any pre-existing environment-flag failures are reported separately and not hidden.

**Step 3: Commit the atomic fix**

Run: `git add src/utils/deviceIdentity.js src/components/Settings/PairingManager.jsx tests/deviceIdentity.test.js tests/supervisorLifecycle.test.js supabase/migrations/20261015_supervisor_device_session_registration.sql supabase/staging-migrations/20261015_001_staging_device_session_registration.sql docs/plans/2026-10-14-supervisor-device-session-unpair.md && git commit -m "fix: register supervisor device session before unpair"`

