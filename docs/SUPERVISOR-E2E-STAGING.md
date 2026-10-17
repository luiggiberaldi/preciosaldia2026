# E2E del supervisor contra staging

Este runbook explica cómo correr los E2E del supervisor sin escribir en producción.

## Proyectos

| Entorno | Proyecto Supabase | Uso |
|---|---|---|
| Producción | `sodgzkablshladvbtnes` | Operación real. Nunca para E2E. |
| Staging | `tdfcpwctvumbdjmifypd` | E2E y pruebas sintéticas. |

Fuente: [reporte de staging](reports/2026-10-14-supervisor-produccion-staging-completo.md).

## Qué cambia en modo staging

Con `VITE_SUPERVISOR_E2E_STAGING=true`:

- [src/config/supabaseCloud.js](../src/config/supabaseCloud.js) usa `VITE_SUPABASE_STAGING_URL` (o el valor por defecto de staging) y `VITE_SUPABASE_STAGING_KEY`.
- [vite.config.js](../vite.config.js) vacía en el bundle `VITE_SUPABASE_URL`, `VITE_SUPABASE_CLOUD_URL`, `VITE_SUPABASE_CLOUD_KEY` y `VITE_SUPABASE_ANON_KEY`.
- Un build con `--mode production` **falla** si esta variable está activa. Es un guard para que el bundle de producción nunca salga sin backend ni con staging por accidente.

La variable **no** va en `.env`. Se define solo en el comando del E2E.

## Requisitos

- `VITE_SUPABASE_STAGING_KEY` en `.env` (anon key del proyecto de staging). No la pegues en chats ni en commits.
- La migración del supervisor aplicada en staging. Verifícala antes de correr las pruebas.
- Una caja de prueba con `device_id` sintético (prefijo `e2e-test-`). Nunca el ID de una caja real.

## Comandos

Dev server local apuntando a staging (en una terminal aparte):

```bash
VITE_SUPERVISOR_E2E_STAGING=true bun run dev -- --host 127.0.0.1 --port 4173
```

E2E de productos (escribe productos sintéticos en la caja de prueba):

```bash
VITE_SUPERVISOR_E2E_STAGING=true \
SUPERVISOR_E2E_ENABLED=true \
SUPERVISOR_E2E_BASE_URL=http://127.0.0.1:4173 \
npx playwright test tests/e2e/supervisor-product-actions.e2e.spec.js
```

E2E de recuperación de inventario:

```bash
VITE_SUPERVISOR_E2E_STAGING=true \
SUPERVISOR_E2E_ENABLED=true \
SUPERVISOR_E2E_BASE_URL=http://127.0.0.1:4173 \
npm run test:e2e:inventario-recovery
```

## Gates de seguridad

Los specs se saltan si no se cumple esto (ver [supervisor-product-actions.e2e.spec.js](../tests/e2e/supervisor-product-actions.e2e.spec.js)):

- `SUPERVISOR_E2E_ENABLED=true`.
- `SUPERVISOR_E2E_BASE_URL` debe contener `staging`, `localhost` o `127.0.0.1`. Un Preview de Vercel solo pasa con `SUPERVISOR_E2E_ALLOW_VERCEL_PREVIEW=true`.

Si un E2E aparece como `skipped`, no cuenta como PASS.

## Limpieza

Al terminar, borra las filas sintéticas de la caja de prueba en staging (`device_sessions`, `supervisor_commands`, `supervisor_control_audit`) filtrando por el `device_id` de prueba.

## Checklist antes de correr

1. `SUPERVISOR_E2E_BASE_URL` apunta a localhost o staging.
2. La URL de Supabase efectiva es `tdfcpwctvumbdjmifypd`.
3. El `device_id` tiene prefijo `e2e-test-`.
4. No hay ninguna variable `VITE_SUPERVISOR_E2E_STAGING` en el shell cuando hagas un build de producción.

## Estado

- Vitest y lint del supervisor: pasan localmente.
- E2E contra staging: **pendiente**. Falta URL y confirmación de la migración en staging.
