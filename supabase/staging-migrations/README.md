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

8. **`20261014_011_staging_owner_proof_claim_only.sql` — aplicada en staging el 2026-10-14.** `generate_pairing_token` solo lo ejecuta el dueño registrado; nunca reclama ni asigna dueño. `claim_owner_device` es el único camino para fijar `owner_auth_id`. Respaldo previo: [scratch/staging-backup-before-011.sql](../../scratch/staging-backup-before-011.sql). Verificado: `anon` sin EXECUTE, `authenticated` con EXECUTE, 6 cajas intactas con dueño. Nueve casos de ataque en transacción revertida (tercero bloqueado, código malo/caducado/reusado rechazado, fuerza bruta bloquea, dueño genera token, reclamo sobre caja con dueño bloqueado) sin residuales. Efecto colateral: deja de crear la fila de la caja de forma implícita.

9. **`20261014_012_staging_register_device_pairing.sql` — aplicada en staging el 2026-10-14.** Añade `register_device_pairing(p_device_id)`: crea solo la fila de una caja `e2e-*` sin dueño, idempotente, sin tocar `owner_auth_id`. Solo `authenticated`. Necesaria porque 011 quitó la creación implícita. La app la llama en `PairingManager.jsx` solo en modo staging. Verificado: E2E de supervisor en staging 2/2 con los tests ajustados para registrar la caja antes del reclamo, sin residuales.

10. **`20261014_016_staging_backup_tables_owner_policy.sql` — aplicada en staging el 2026-10-14.** Políticas de dueño (`is_own_device_row`) para `cloud_backups` y `sync_documents`, y lectura propia de `device_sessions` para `authenticated`. Sustituye la política permisiva `staging_authenticated_sync_read` (`e2e-%`) de `sync_documents`. Verificado en transacción revertida: dueño A ve solo sus filas, no puede reasignarlas, dueño B no ve las de A. Staging sin residuales después.

11. **`20261014_017_staging_register_device_session.sql` — aplicada en staging el 2026-10-14.** RPC `register_device_session(p_device_id)` `SECURITY DEFINER`, solo `authenticated`. Rechaza `device_id` fuera de `e2e-*`, cajas inexistentes y reasignación a otro usuario. Verificado en transacción revertida (dueño registra, repetición idempotente, id no sintético rechazado, tercero rechazado). `useCloudBackup` la usa a través de [src/utils/deviceIdentity.js](../../src/utils/deviceIdentity.js).

### Registro de auditoría (2026-10-14)

| Paso | Resultado |
|---|---|
| Respaldo de definiciones antes de 011 | `scratch/staging-backup-before-011.sql` |
| Aplicar 011 (transacción) | HTTP 201 |
| Casos de ataque 011 | 9/9 comportamiento esperado |
| Aplicar 012 | HTTP 201 |
| `npm run test:supervisor:staging` | 2/2 pasan tras ajustar tests |
| `npx vitest run supervisor` | 18 archivos pasan, 7 de staging omitidos sin su flag |
| Filas residuales `e2e-*` | 0; total 6 cajas, todas con dueño |
| Producción (`sodgzkablshladvbtnes`) | no tocada |
| Canje del código (prueba inválida) | Una sesión anónima que no era la del dueño canjeó primero (orden incorrecto en el script). Dueño de `e2e-primary-device` quedo asignado a esa sesión anónima de staging. Aislamiento posterior OK: tercero no genera token (bloqueado) y no vuelve a reclamar (rechazado). Repetido después con orden correcto (dueño primero, tercero después) en caja `e2e-iso-*` nueva: dueño canjea OK, tercero rechazado, tercero no genera token, dueño genera token OK. Fila de prueba borrada con service role tras comprobar `e2e-*` y sin monitor; 0 residuales. Cubierto también por [tests/supervisorOwnerClaimOrderStaging.test.js](../../tests/supervisorOwnerClaimOrderStaging.test.js): pasa con `SUPERVISOR_STAGING_PAIRING_E2E=true` y se omite sin el flag. |
| Prueba de UI del botón de reclamo | OK: entrar como Administrador, Ajustes > Sistema > Generar código. Apareció el código con contador de 10 min, sin error. Confirmado en BD: hash activo, sin dueño, 0 intentos |

## Autorización explícita para pruebas en staging (2026-10-14)

El responsable del proyecto autorizó explícitamente, para este trabajo, lo siguiente **solo en el proyecto de staging `tdfcpwctvumbdjmifypd`**:

- Crear y eliminar filas de prueba con identificadores sintéticos `e2e-*` (incluida una caja `e2e-owner-b-test` para el segundo dueño).
- Iniciar sesiones anónimas de prueba y ejecutar el canje de código de reclamo entre dos dueños.
- Levantar el servidor local de Vite en modo `staging` y usar el navegador para la prueba.
- Añadir al arnés de staging de `src/hooks/useSecurity.jsx` un identificador sintético adicional, activo solo con `import.meta.env.DEV` y `VITE_SUPERVISOR_E2E_STAGING=true`.

No está autorizado: tocar el proyecto de producción (`sodgzkablshladvbtnes`), cerrar `anon` en producción, aplicar DDL nuevo en staging sin revisión, ni borrar datos fuera de los `e2e-*` creados por estas pruebas. Al terminar, las filas `e2e-*` de prueba se eliminan y se verifica que no quedan residuales.

12. **`20261014_018_staging_e2e_delete_unowned_synthetic.sql` — aplicada en staging el 2026-10-14.** RPC `e2e_delete_unowned_synthetic()`, solo `authenticated`. Borra únicamente cajas `e2e-bk-%`/`e2e-iso-%` sin `owner_auth_id`, `monitor_auth_id` ni `monitor_device_id`. Permite que las pruebas limpien las cajas que `register_device_pairing` deja sin dueño. Verificado: `anon` sin EXECUTE, `authenticated` con EXECUTE. La prueba de respaldos la llama al terminar; las pruebas de aislamiento de dueños aún no.

## Staging-only E2E harness RPCs (not in a file here)

The functions `e2e_set_pairing_link`, `e2e_set_canary_allowlist` and `e2e_cleanup_commands` were applied **directly to staging** (`tdfcpwctvumbdjmifypd`) so the Supervisor command harness no longer needs the Management API token. They are not stored as a migration file in this directory yet; add one before any reproducible rebuild of staging.

- Each one is `SECURITY DEFINER`, rejects any device ID outside `e2e-%`, is executable only by `authenticated` (not `anon` or `PUBLIC`), and checks `auth.uid()`.
- They must never exist in production. A read-only query on `sodgzkablshladvbtnes` for `e2e_%` functions returned no rows.
- Why staging only: they write pairings, the canary allowlist and command rows, and they depend on synthetic `e2e-*` fixtures that exist only in staging. Copying them to production would open writes to real customer devices.

## 2026-10-21: reaplicación completa a wapczmlwljkrjtfhmqko

La cadena de este directorio (más `supabase_supervisor_commands.sql` y `supabase_supervisor_canary_allowlist_staging.sql`) se aplicó íntegra al nuevo proyecto de staging `wapczmlwljkrjtfhmqko` el 2026-10-21, con fixtures E2E (`e2e-primary-device`, `e2e-monitor-device`, canary allowlist) y sign-ins anónimos habilitados. Verificado: 14 tablas, 30 RPCs en `pg_proc`, Realtime en `sync_documents`/`supervisor_commands`, id de `sync_documents` en BIGSERIAL.

Excepción deliberada: el trigger `enforce_supervisor_income_command` quedó en su **versión estricta** (la de `supabase_supervisor_canary_allowlist_staging.sql`), no en la permisiva de `20261014_020_staging_allow_product_commands_trigger.sql`. El contrato de pruebas (`tests/supervisorStagingCommands.test.js`) exige que egreso, productos y cierres fallen con "Solo ingreso y tasas remotas están habilitados"; `020` rompe esas aserciones. Habilitar comandos de producto/egreso es un cambio aparte, con aprobación y actualización de tests.

Pruebas contra este proyecto (2026-10-21): `npm run test:supervisor:staging` 2/2 y `supervisorStagingCommands.test.js` 1/1, ambos en verde con limpieza sin residuos.

El harness de comandos ya no usa la Management API (`SUPABASE_ACCESS_TOKEN`): el fixture/cleanup corre vía PostgREST con `SUPABASE_STAGING_SERVICE_KEY` (service key del proyecto). Los RPC de arnés mencionados arriba (`e2e_set_pairing_link`, `e2e_set_canary_allowlist`, `e2e_cleanup_commands`) **no** se recrearon en este proyecto porque el harness actual no los necesita.
