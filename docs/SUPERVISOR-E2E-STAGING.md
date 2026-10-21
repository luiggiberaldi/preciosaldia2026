# E2E del supervisor contra staging

Este runbook explica cómo correr los E2E del supervisor sin escribir en producción.

## Proyectos

| Entorno | Proyecto Supabase | Uso |
|---|---|---|
| Producción | `sodgzkablshladvbtnes` | Operación real. Nunca para E2E. |
| Staging | `wapczmlwljkrjtfhmqko` | E2E y pruebas sintéticas. Proyecto activo desde 2026-10-21. |
| Staging (retirado) | `tdfcpwctvumbdjmifypd` | Solo histórico. No usar. |

## Qué cambia en modo staging

Con `VITE_SUPERVISOR_E2E_STAGING=true`:

- [src/config/supabaseCloud.js](../src/config/supabaseCloud.js) usa `VITE_SUPABASE_STAGING_URL` y `VITE_SUPABASE_STAGING_KEY`.
- [vite.config.js](../vite.config.js) vacía en el bundle las variables de producción (`VITE_SUPABASE_URL`, `VITE_SUPABASE_CLOUD_URL`, `VITE_SUPABASE_CLOUD_KEY`, `VITE_SUPABASE_ANON_KEY`).
- Un build con `--mode production` **falla** si esta variable está activa: el bundle de producción nunca sale sin backend ni con staging por accidente.

En este clon la variable vive en `.env.local` (el clon es dedicado a staging). Si copias este flujo a otro checkout, defínela solo en el comando del E2E.

## Requisitos

- `VITE_SUPABASE_STAGING_KEY` en `.env`: anon key de `wapczmlwljkrjtfhmqko`. No la pegues en chats ni en commits.
- `SUPABASE_STAGING_SERVICE_KEY` en `.env`: service key del mismo proyecto. La usa **solo** el harness de `tests/supervisorStagingCommands.test.js` (fixture/cleanup vía PostgREST) porque el PAT de `SUPABASE_ACCESS_TOKEN` pertenece a otra cuenta y no ve este proyecto.
- Sign-ins anónimos habilitados en el proyecto (Auth → Sign-ins / Providers). Los tests crean identidades anónimas.
- Schema de staging aplicado en `wapczmlwljkrjtfhmqko` (cadena `supabase/staging-migrations/` + scripts raíz `supabase_supervisor_commands.sql` y `supabase_supervisor_canary_allowlist_staging.sql`, con fixtures E2E). Verificado el 2026-10-21: 14 tablas, 30 RPCs, Realtime en `sync_documents` y `supervisor_commands`.

## Comandos

Dev server local apuntando a staging (en una terminal aparte):

```bash
VITE_SUPERVISOR_E2E_STAGING=true bun run dev -- --host 127.0.0.1 --port 4173
```

E2E de pairing y desvinculación con secreto (2/2):

```bash
npm run test:supervisor:staging
```

E2E del ciclo de comandos (ACK, NACK, timeout, replay, bloqueos):

```bash
SUPERVISOR_STAGING_COMMANDS_E2E=true npx vitest run tests/supervisorStagingCommands.test.js
```

## Gates de seguridad

- Los tests de pairing se saltan sin `SUPERVISOR_STAGING_PAIRING_E2E=true`; el de comandos, sin `SUPERVISOR_STAGING_COMMANDS_E2E=true`. Un test `skipped` no cuenta como PASS.
- `device_id` sintéticos con prefijo `e2e-`. Nunca el ID de una caja real.
- Los scripts SQL de esta cadena nunca se ejecutan contra `sodgzkablshladvbtnes`.

## Limpieza

Los propios tests limpian sus filas (`e2e_delete_pairing`, `e2e_delete_synthetic_license`, borrado de `supervisor_commands` por prefijo). Si algo queda, filtra por el `device_id` de prueba en `device_sessions`, `supervisor_commands`, `device_pairings` y `cloud_licenses`.

## Estado (2026-10-21)

- Schema aplicado en `wapczmlwljkrjtfhmqko` y fixtures E2E presentes (`e2e-primary-device`, `e2e-monitor-device`, canary allowlist).
- `npm run test:supervisor:staging`: **2/2 pasan**.
- `supervisorStagingCommands.test.js`: **1/1 pasa** (ciclo completo).
- Sign-ins anónimos: habilitados en el proyecto.
- **Trigger de comandos: versión estricta activa** ("Solo ingreso y tasas remotas están habilitados"): egreso, productos y cierres quedan bloqueados en backend, que es lo que exige el contrato de pruebas. El archivo `20261014_020_staging_allow_product_commands_trigger.sql` (permisivo) **no** está reflejado en la base; habilitarlo requiere actualizar primero las aserciones del test y aprobar el cambio.
- `021` exige licencia permanente para el reclamo de dueño; los tests siembran una licencia sintética con `e2e_seed_synthetic_license` (`022`) y la borran al terminar.
