# Reporte completo: Supervisor, producción y staging

**Fecha:** 2026-10-14  
**Rama:** `preview/all-changes-oct14`  
**Carpeta productiva:** `C:\Users\luigg\Desktop\sistemas generales\precios al dia final\preciosaldia-supervisor-production-alignment`  
**Carpeta staging:** `C:\Users\luigg\Desktop\sistemas generales\precios al dia final\preciosaldia-supervisor-staging`

## Resumen ejecutivo

La raíz de producción quedó separada de los artefactos exclusivos de staging y vuelve a utilizar la configuración productiva local al no tener `.env.local` ni `.env.staging.local`.

El modo Supervisor también recibió el arreglo P0 para la desvinculación: la caja registra su sesión de dispositivo antes de consultar o ejecutar `unpair_monitor`. La implementación usa una RPC segura cuando el ambiente bloquea escrituras directas y conserva compatibilidad con esquemas antiguos.

No se ejecutó ninguna migración directamente contra Supabase ni se hizo deployment externo. Las migraciones deben aplicarse manualmente en el proyecto correcto y verificarse después.

## Ambientes

| Ambiente | Proyecto Supabase | Ubicación de artefactos | Uso |
|---|---|---|---|
| Producción | `sodgzkablshladvbtnes` | `supabase/migrations` | Build y despliegue productivo |
| Staging | `tdfcpwctvumbdjmifypd` | carpeta staging separada | E2E, pruebas sintéticas y validación previa |

El código compartido conserva el selector de ambiente en `src/config/supabaseTarget.js` y `src/config/supabaseCloud.js`, pero la raíz productiva ya no tiene activados los archivos locales de staging.

## Diagnóstico del error de desvinculación

El navegador reportaba:

```text
POST /rest/v1/rpc/unpair_monitor 400
P0001: No autorizado para desvincular este supervisor
```

La causa no estaba en la interfaz del commit `5a59056b417d76e17509fda64fa955a674103606`. La RPC productiva autoriza a la caja mediante `is_own_device_row(primary_device_id)`, que depende de una fila válida en `device_sessions`. La caja creaba la sesión anónima de Supabase, pero no registraba la relación entre `device_id` y `auth.uid()` antes de llamar a `unpair_monitor`.

## Corrección implementada

### Frontend

`src/utils/deviceIdentity.js` ahora:

1. Comprueba que exista una sesión autenticada.
2. Intenta `register_device_session(p_device_id)`.
3. Rechaza conflictos de dueño con un error estructurado.
4. Usa el registro directo existente como compatibilidad si la RPC aún no está instalada.

`src/components/Settings/PairingManager.jsx` registra la identidad:

- al verificar el estado inicial del pairing;
- inmediatamente antes de ejecutar `unpair_monitor`.

La autorización final sigue estando en PostgreSQL; el frontend no puede forzar una desvinculación autorizada.

### Migraciones

Producción:

- [20261015_supervisor_device_session_registration.sql](../../supabase/migrations/20261015_supervisor_device_session_registration.sql)

Staging:

- Se conserva en la carpeta staging separada, dentro de `from-production-alignment-20261014/supabase/staging-migrations/20261015_001_staging_device_session_registration.sql`.
- Mantiene la validación sintética `e2e-%`.
- No exige que exista un pairing previo, para permitir el primer vínculo de una caja.

## Separación de staging

Los siguientes artefactos fueron movidos desde la raíz productiva a:

`C:\Users\luigg\Desktop\sistemas generales\precios al dia final\preciosaldia-supervisor-staging\from-production-alignment-20261014`

### Configuración

- `.env.local`
- `.env.staging.local`

### Migraciones y SQL

- `supabase/staging-migrations/`
- `supabase_supervisor_canary_allowlist_staging.sql`
- `supabase_supervisor_staging.sql`
- `supabase_supervisor_containment.sql`

### Pruebas y helpers

- `tests/supervisorOwnerClaimStaging.test.js`
- `tests/supervisorOwnerIsolationStaging.test.js`
- `tests/supervisorPairingStaging.test.js`
- `tests/supervisorSecretUnpairStaging.test.js`
- `tests/supervisorStagingCommands.test.js`
- `tests/helpers/stagingAnonymousSessions.js`

### Documentación staging

- `docs/plans/2026-10-11-preciosaldia-staging-alignment-plan.md`

### Test mixto separado

`supervisorCanaryAllowlist.test.js` comprobaba producción y staging en el mismo archivo. La copia completa fue preservada en la carpeta staging y la versión productiva quedó únicamente con las comprobaciones de producción.

También se eliminó de la raíz productiva el script `test:supervisor:staging`, porque sus archivos ya no viven en esa carpeta.

## Archivos principales modificados

- [PairingManager.jsx](../../src/components/Settings/PairingManager.jsx)
- [deviceIdentity.js](../../src/utils/deviceIdentity.js)
- [deviceIdentity.test.js](../../tests/deviceIdentity.test.js)
- [supervisorLifecycle.test.js](../../tests/supervisorLifecycle.test.js)
- [supervisorCanaryAllowlist.test.js](../../tests/supervisorCanaryAllowlist.test.js)
- [package.json](../../package.json)

El resto de cambios previos del propietario se conservaron; no se hizo `reset`, `checkout` destructivo ni limpieza de cambios ajenos.

## Verificaciones realizadas

| Comprobación | Resultado |
|---|---|
| `bun run test:supervisor -- --maxWorkers=1` | 14 archivos, 83 pruebas pasan |
| `bun run typecheck` | Pasa |
| `bun run build` | Pasa |

## Corrección posterior: sincronización y desvinculación simple

Después de la revisión se detectó que la versión endurecida de `unpair_monitor` solo permitía al celular del supervisor. Eso dejaba inutilizado el botón “Desactivar Modo Supervisor” en la caja principal y producía `P0001: No autorizado para desvincular este supervisor`.

El flujo vuelve al comportamiento sencillo de `c508b3360ff26919f001e167a4a806632bf04809`:

- la caja dueña puede desvincular su celular;
- el celular vinculado también puede desvincularse;
- ambos usan la sesión Auth existente;
- no se exige un registro adicional de `device_sessions` para esta acción;
- la limpieza de la vinculación sigue ocurriendo en una sola RPC.

La corrección está en:

- [supabase_supervisor_auth_recovery.sql](../../supabase_supervisor_auth_recovery.sql)
- [20261015_supervisor_unpair_owner_compatibility.sql](../../supabase/migrations/20261015_supervisor_unpair_owner_compatibility.sql)
- [PairingManager.jsx](../../src/components/Settings/PairingManager.jsx)

La migración nueva todavía debe ejecutarse manualmente en el proyecto Supabase de producción. No se ejecutó ningún cambio remoto desde esta sesión.

## Corrección posterior: generación repetida del código QR

Producción también estaba usando una versión de `generate_pairing_token` que intentaba insertar una segunda fila cuando ya existía `primary_device_id`. Eso producía el error `409 / 23505`.

La misma migración fue ampliada para que la generación sea idempotente: reutiliza la fila de la misma caja sin pasos extra de “dueño” y sin crear una segunda fila. Debe ejecutarse nuevamente el archivo actualizado de migración antes de probar el botón QR.

También se corrigió el segundo paso del vínculo. Si el celular ya estaba asociado a otra caja, la RPC limpia ese vínculo anterior y lo reutiliza para la nueva caja, evitando `device_pairings_monitor_device_id_key`.
| `bun run lint:supervisor` | 0 errores, 178 advertencias heredadas |
| `bunx eslint src/utils/deviceIdentity.js` | Pasa |
| `git diff --check` | Pasa |

El build aún muestra advertencias conocidas: chunk principal mayor de 500 kB y chunk vacío de Groq. No bloquean la compilación.

## Pendientes antes de producción

1. Aplicar `20261015_supervisor_device_session_registration.sql` solamente en producción.
2. Aplicar la migración staging solamente en `tdfcpwctvumbdjmifypd`.
3. Verificar que la función exista y tenga permisos para `authenticated`.
4. Probar en staging: vincular, consultar, desvincular y volver a vincular.
5. Probar en producción con una caja y un monitor reales.
6. Confirmar que el build productivo de Vercel use variables de producción y no las variables locales de staging.
7. Revisar y confirmar los cambios pendientes antes de crear el commit de release.

## Estado Git

Los cambios están en el working tree y todavía no se creó un commit nuevo. La referencia Supervisor solicitada anteriormente continúa siendo `5a59056b417d76e17509fda64fa955a674103606`; las mejoras descritas en este reporte son cambios posteriores que deben revisarse y aprobarse antes de publicar.

