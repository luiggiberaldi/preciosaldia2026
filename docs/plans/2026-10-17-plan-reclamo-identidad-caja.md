# Plan — Reclamo de identidad de caja con prueba de posesión

**Fecha:** 2026-10-17 · **Estado:** migración aplicada en staging; cliente pendiente; producción sin aplicar · **Relacionado:** [desincronización y estado fantasma](2026-10-16-plan-fix-desincronizacion-estado-fantasma.md)

## 1. Problema

- Al cambiar de origen (p. ej. `localhost:4173` → `5174`), SEC-008 detecta un fingerprint distinto y `useSecurity.jsx` **regenera `pda_device_id` en silencio** (línea ~354).
- El ID nuevo no tiene fila de pairing ni `device_sessions` válida, así que la vinculación falla con `DEVICE_SESSION_NOT_BOUND`.
- La política `device_sessions_reclaim` (`supabase/migrations/001_device_own_row_rls.sql`, re-afirmada en `20261016_device_sessions_reclaim_repair.sql`) usa `using (true)`: cualquier sesión que conozca un `device_id` puede reasignarlo a sí misma. Es un riesgo de secuestro de caja.

## 2. Objetivo

1. Un cambio de fingerprint **no** regenera el ID: la caja queda en estado `requiere_revinculacion` con su ID original.
2. La re-vinculación exige **confirmación explícita** desde una sesión ya autorizada (el supervisor vinculado o el dueño de la caja).
3. El reclamo en la nube exige **prueba de posesión**, no solo visibilidad de la fila.
4. SEC-008 se mantiene: los tests de `tests/security.test.js` (rechazo de `PDA-DEAD`, anclas ajenas, strings malformados) siguen pasando sin cambios.

## 3. Diseño propuesto

### 3.1 Prueba de posesión (servidor)

- Al registrar la identidad por primera vez, la caja genera un secreto aleatorio local (≥ 256 bits) y guarda **solo su hash SHA-256** en `device_sessions.possession_hash`.
- El reclamo (`register_device_session` o el UPDATE) exige pasar el secreto; el servidor compara el hash.
- Sin secreto válido: `42501`.

### 3.2 Política

- Reemplazar `device_sessions_reclaim` (`using (true)`) por una política que solo permita reasignar cuando el reclamo llega por RPC con el secreto válido. El UPDATE directo queda sin efecto.
- Migración nueva e idempotente, con `drop policy if exists` y ventana de compatibilidad para filas sin `possession_hash` (migración de datos explícita, no automática).

### 3.3 Cliente

- `ensureDeviceSessionRegistered` deja de reclamar en silencio. En mismatch de fingerprint devuelve `{ code: 'REVINCULACION_REQUERIDA' }` y no toca `pda_device_id`.
- La UI muestra "Esta caja necesita confirmar su identidad" con acción de confirmación desde una sesión autorizada.
- `getPairingErrorMessage` ya mapea `DEVICE_SESSION_NOT_BOUND` (cambio aplicado y probado).

## 4. Criterios de aceptación

- [ ] Un fingerprint distinto no cambia `pda_device_id` en `localStorage`.
- [ ] Un reclamo sin secreto válido devuelve `42501` en staging.
- [ ] Dos cuentas de prueba: la cuenta B no puede leer ni reclamar filas de la cuenta A.
- [ ] Con secreto válido, la re-vinculación completa el pairing.
- [ ] `tests/security.test.js` y `tests/supervisorPairing.test.js` pasan sin cambiar aserciones.
- [ ] Suite completa de Vitest en exit 0.

## 5. Pruebas

1. **Local:** tests unitarios de la función de hash y del estado `REVINCULACION_REQUERIDA`.
2. **Staging (`tdfcpwctvumbdjmifypd`):** aplicar la migración, ejecutar reclamo sin secreto (debe fallar), con secreto (debe pasar), y con cuenta ajena (debe fallar).
3. **E2E de vinculación** contra staging con caja sintética `e2e-test-*`.

## 6. Reversión

- Migración con script de rollback: restaurar `device_sessions_reclaim` anterior y eliminar `possession_hash`.
- Revertir el cambio de cliente con un único commit.
- Antes de producción: snapshot de `device_sessions` y `device_pairings`.

## 7. Producción

**No se aplica a producción sin aprobación explícita** después de que staging pase todos los criterios. Impacto: cajas reales de clientes; un error en la política bloquea su sincronización.

## 8. Estado verificado (solo lectura, 2026-10-17)

Verificado con el conector de Supabase contra los dos proyectos:

| Elemento | Producción `sodgzkablshladvbtnes` | Staging `tdfcpwctvumbdjmifypd` |
|---|---|---|
| Política de reclamo `device_sessions_reclaim` | **Presente**, `qual = true` (abierta) | Ausente |
| Política INSERT/UPDATE de `device_sessions` | INSERT y UPDATE propios | Solo SELECT propio |
| `register_device_session` | Presente | Presente |
| `claim_device_session` (migración 20261017) | **Ausente** (no aplicada) | **Ausente** (no aplicada) |
| Migración `20261016_device_sessions_reclaim_repair` | **No aparece** en el historial | No aparece |

Conclusión: la política abierta sigue activa en producción. La migración `20261017` no está aplicada en ningún proyecto, y no hay que asumir lo contrario.

Fila de la caja `PDA-V2-9DB64A9FEA77801E4FC741E4A54371F1` (sin modificar): dueño `5ecf25bb...`, última actividad 2026-10-16.

## 9. Correcciones a la migración 20261017

- `digest()` requiere `pgcrypto`. Se añade `create extension if not exists pgcrypto with schema extensions`. Verificado con el conector: en staging ya existe en `extensions`.
- El secreto se fija solo en el alta. Un reclamo con otro secreto se rechaza (`POSSESSION_REQUIRED`).
- Filas legadas sin `possession_hash` no se reclaman automáticamente.

**Aplicada en staging (`tdfcpwctvumbdjmifypd`)** con el conector en modo escritura. Verificación posterior: columna `possession_hash` presente, políticas `device_sessions_owner_select` y `device_sessions_update_own`, función `claim_device_session` creada, 39 filas intactas. Producción no tocada.

## 10. Pendientes abiertos

- Confirmar si la migración `20261016` está aplicada en producción (no verificable con la API actual).
- Decidir cómo se migran las filas existentes sin `possession_hash`.
- Definir quién puede confirmar la re-vinculación (dueño vs. supervisor).
