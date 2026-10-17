# Plan de Fixeo — Desincronización y Estado Fantasma Caja ↔ Supervisor

**Fecha:** 2026-10-16 · **Estado:** propuesto · **Base:** auditoría del "Reporte Técnico Integral" (incidente `PDA-V2-9DB64…` caja vacía vs `PDA-V2-AD516…` monitor con 115 productos / turno sin cierre).

> ⚠️ Este plan corrige el reporte original. Dos correcciones estructurales:
> 1. **La Falla 2 del reporte es falsa**: la caja **sí** consulta `sync_documents` al arrancar (pull inicial + `_applyFromCloud`). No hay que "crear" rehidratación: hay que **diagnosticar por qué no se aplicó** (Fase D1).
> 2. **La Acción 3 del reporte no funciona como está escrita**: `forceSyncAllPOSData` omite claves `null` (`if (val !== null)`), así que un POS vacío **nunca** publica vacío y el snapshot fantasma sobrevive cualquier push. La solución real es la semántica de vacío/tombstone (Fase F3).

---

## 1. Causa raíz (versión corregida)

Secuencia verificada en código:

1. **El deviceId es determinista por máquina, no por instalación.** `_getSalt()` en [deviceFingerprint.js:117](../../src/security/deviceFingerprint.js#L117) es `VITE_LICENSE_SALT` del build (no persistida). Borrar cookies/IndexedDB o usar ventana privada **regenera el mismo `PDA-V2-…`** con almacenamiento local en cero. ✔ (Falla 1 del reporte, correcta.)
2. **El POS sí intenta rehidratarse**: [useCloudSync.js:447-491](../../src/hooks/useCloudSync.js#L447-L491) hace `SELECT sync_documents … WHERE device_id = <yo>` y aplica cada doc con `_applyFromCloud` (envelope + watermark `isNewerSyncDocument` + allowlist + schema). El monitor, al vincular, hace `pullDocuments({ full: true })` ([useMonitorSync.js:295](../../src/hooks/useMonitorSync.js#L295), full en [:416](../../src/hooks/useMonitorSync.js#L416)).
3. **El asunto real es que el pull del POS no aplicó nada y falló en silencio.** Candidatos, en orden de probabilidad:
   - **(H1) RLS own-row sin registro de sesión.** Las políticas own-row de `sync_documents` exigen `device_sessions` vinculado a la sesión actual; sin eso, lecturas/escrituras quedan bloqueadas (ver [deviceIdentity.js:1-27](../../src/utils/deviceIdentity.js#L1)). `ensureDeviceSessionRegistered` solo se invoca desde `createPairingToken` ([supervisorPairingService.js:65-88](../../src/services/supervisorPairingService.js#L65)), **no** antes del pull inicial de `initSync`. Un perfil recién borrado tiene una sesión nueva sin registrar → la SELECT devuelve 0 filas o 42501 y nada se aplica.
   - **(H2) `initSync` abortó antes**: `if (docsError) throw docsError` → catch con `console.error('[CloudSync] Fallo en inicialización')` → sin hidratar.
   - **(H3) Watermark**: `isNewerSyncDocument` rechaza el snapshot por metadata previa (improbable tras borrado total).
4. **El estado fantasma en la nube no puede purgarse desde un POS vacío**: `forceSyncAllPOSData` ([useCloudSync.js:174](../../src/hooks/useCloudSync.js#L174)) salta claves `null`, y `pushCloudSync` solo publica valores existentes. "Vacío" no es un estado publicable.
5. **El monitor no purga caché al re-vincular**: [PairingScanScreen.jsx:252-253](../../src/components/PairingScanScreen.jsx#L252) guarda `pda_paired_device_id`/`pda_pairing_mode` y recarga sin `clearMonitorCache`; los watermarks de una vida previa pueden bloquear el merge del nuevo vínculo (la única purga actual es ante revocación remota, [useMonitorSync.js:192](../../src/hooks/useMonitorSync.js#L192)).
6. **"Turno activo" es el flag `cajaCerrada`**, no el emparejamiento APERTURA↔REGISTRO_CIERRE: [OwnerMonitorView.jsx:186-189](../../src/views/OwnerMonitorView.jsx#L186) toma la última `APERTURA_CAJA` con `cajaCerrada !== true`. Un turno sin cerrar se muestra como activo **por diseño**; el bug es que el snapshot viejo se sirve, no la semántica.

## 2. Alcance

**Sí:** `useCloudSync` (pull inicial, push/vacío), `PairingScanScreen` (purga al vincular), `forceSyncAllPOSData`/`pushCloudSync` (semántica de vacío), UX de aviso de rehidratación, tests unit/e2e, runbook operativo.

**No:** receiver de comandos (`useRemoteCommands`), pipeline de comandos supervisor (Fase 10 batch v2), SQL fuera de los contratos ya aprobados (cualquier migración nueva requiere aprobación explícita aparte), lógica financiera de turnos.

## 3. Contratos que se respetan (sin cambios de esquema)

- `SUPERVISOR_SYNC_KEYS` / `SYNC_VALIDATORS` ([supervisorContracts.js:46-66](../../src/services/supervisorContracts.js#L46)) — la tombstone usa las mismas claves y validadores (arrays vacíos siguen siendo válidos: `Array.isArray`).
- Envelope/watermark `buildSyncEnvelope` / `readSyncEnvelope` / `isNewerSyncDocument` (supervisorSyncService) — la tombstone publica un envelope **más nuevo**, no rompe el watermark.
- `device_sessions(device_id PK, user_id, first_seen, last_seen)` + RLS own-row (001) — sin cambios; el fix registra la sesión antes de leer, no relaja políticas.
- `device_pairings`, RPCs `generate_pairing_token` / `pair_monitor_device` / `register_device_session` — sin cambios.

## 4. Fases

### Fase D1 — Diagnóstico del pull inicial (previo a cualquier fix)
**Objetivo:** distinguir H1/H2/H3 con evidencia, no adivinanza.
- Instrumentar `initSync` con logs estructurados: nº de docs leídos, `docsError` (código incluido), estado de `device_sessions`, watermark previo por clave.
- Repro mínimo: perfil limpio (borrar datos del sitio) en la PC → abrir app → observar el log `Pull inicial: N documentos aplicados.` vs `Fallo en inicialización` vs `0 filas`.
- **Salida esperada:** confirmación de H1 (probable) o identificación del candidato real. Si es H3, saltar a F3 con foco en watermark.

### Fase F1 — Hidratación confiable de la caja (corrige H1/H2)
- En `initSync`, **antes** del SELECT inicial: `ensureDeviceSessionRegistered(deviceId)` ([deviceIdentity.js:73](../../src/utils/deviceIdentity.js#L73)); si falla, no continuar en silencio.
- Convertir el fallo del pull inicial en **visible y accionable** (estado de sync degradado + toast con motivo), nunca silencioso.
- Si `docs.length > 0` y el almacenamiento local está vacío → aplicar (ya ocurre) y **avisar** que se restauró un respaldo previo (ver F4).

### Fase F2 — Purga de caché del monitor al re-vincular (Acción 1 del reporte, válida)
- En `executePairing` ([PairingScanScreen.jsx:252](../../src/components/PairingScanScreen.jsx#L252)): antes de escribir `pda_paired_device_id`/`pda_pairing_mode`, ejecutar `await clearMonitorCache({ idbStore, localStorage })` ([monitorUnpair.js:29](../../src/services/monitorUnpair.js#L29)).
- **Orden obligatorio:** purgar primero (la función borra también esas dos claves), luego escribir las nuevas, luego reload.
- `clearMonitorCache` no borra `pda_device_id` (identidad del monitor se preserva ✓). Purga `SUPERVISOR_SYNC_KEYS`, metadata/watermarks (`getSyncMetadataKey`) y hashes de push — exactamente lo que desbloquea merges futuros.
- Test: `executePairing` con estado heredado → tras vincular, 0 claves `SUPERVISOR_SYNC_KEYS` en idb/localStorage y las claves de vínculo apuntando al nuevo primary.

### Fase F3 — Semántica de vacío / tombstone (corrige el estado fantasma; reemplaza la Acción 3)
- Definir **"snapshot vacío publicable"**: para las claves críticas (`bodega_products_v1`, `bodega_sales_v1`, `bodega_customers_v1`, `bodega_customer_ledger_v1`, `bodega_accounts_v2`), un array vacío **es** un estado válido que debe publicarse.
- Ajustar `forceSyncAllPOSData`/`pushCloudSync`: distinguir `null` (clave ausente → no publicar) de `[]` (vacío confirmado → publicar), y ofrecer un flujo explícito "Empezar desde cero" que escriba `[]` localmente y publique (envelope más nuevo) purgando lo que el monitor ve.
- Decisión UX pendiente (ver §6): ¿confirmación obligatoria antes de publicar vacíos? (Recomendado: sí, con resumen de lo que se va a descartar en la nube.)

### Fase F4 — Aviso de rehidratación asistida (Opción A del reporte, sobre F1)
- Cuando el pull inicial encuentra snapshot remoto y el local está vacío: mostrar "Existe un respaldo previo de este equipo en la nube (N productos / M ventas). ¿Restaurarlo o empezar de base nueva?" — restaurar = comportamiento actual; empezar de cero = F3.
- Sin duplicar lógica: es UX sobre el pull ya existente.

### Fase F5 — Runbook operativo (desbloqueo de la instalación actual)
1. **Preferido (sin SQL):** en la PC, tras F1, el pull inicial restaura los 115 productos; luego cerrar el turno del 15/10 desde la caja (genera `REGISTRO_CIERRE` y marca `cajaCerrada`) para que el monitor deje de mostrarlo como activo.
2. **Alternativa "empezar de cero":** F3 con confirmación → nube queda vacía → en el celular, Desvincular (ya ejecuta `clearMonitorCache`) y re-escanear.
3. **Último recurso (requiere aprobación explícita):** DELETE manual de `sync_documents` para ese `device_id`. Es destructivo, salta el flujo/RLS de la app y no deja watermark coherente; documentar exactamente qué se borró si se hace.

## 5. Pruebas y verificación

| Fase | Test | Comando |
|---|---|---|
| D1 | log estructurado del pull (unit con cliente inyectado) | `npx vitest run tests/supervisorSync.test.js` |
| F1 | registro de sesión antes del SELECT; fallo visible (no silencioso) | nuevo `tests/cloudSyncRehydrate.test.js` |
| F2 | purga al vincular + orden clear→set | extender `tests/monitorUnpair.test.js` |
| F3 | `[]` publicable, `null` no; tombstone visible para el monitor | nuevo `tests/cloudSyncEmptySnapshot.test.js` |
| Global | suites supervisor + typecheck + lint | `npx vitest run supervisor` · `npx tsc --noEmit -p tsconfig.json` · `bun run lint:supervisor` |
| E2E | perfil limpio → vincular → caja recupera catálogo; "empezar de cero" → monitor deja de verlo | `npx playwright test tests/e2e/supervisor-*.e2e.spec.js` |

## 6. Criterios de aceptación

1. Perfil limpio en la PC + vínculo existente ⇒ la caja muestra el catálogo restaurado **o** un error visible con motivo (RLS/sesión/red); jamás vacío silencioso.
2. Re-vincular el monitor deja cero estado heredado (claves sync + watermarks) y el pull del nuevo vínculo aplica aunque existan timestamps previos.
3. Un POS confirmado "empezar de cero" publica vacío y el monitor, tras su pull, deja de mostrar productos/turno viejos.
4. El turno del 15/10 deja de aparecer como activo tras cerrarse desde la caja (sin tocar la semántica de `cajaCerrada`).
5. Suites en verde: `supervisor` completo + typecheck + lint sin errores.

## 7. Riesgos y decisiones pendientes

- **[Decisión]** F3: ¿publicar vacíos con confirmación obligatoria (recomendado) o automático al detectar caja vacía? Riesgo de pérdida de datos si se publica vacío sin querer.
- **[Riesgo]** F1: registrar la sesión en cada arranque añade un round-trip; mitigar con cache del registro y reintentos.
- **[Riesgo]** F2: purgar antes de confirmar el vínculo deja al monitor sin datos si el `pair_monitor_device` falla después; aceptable (mejor vacío que fantasma), pero mostrar el error.
- **[Cerrado 2026-10-16]** Verificación forense completada contra `sodgzkablshladvbtnes`: la fila de `device_pairings` (id `c1a46d51…`, `paired_at` 2026-10-16T17:29:43Z, `revoked_at` null), los counts (`bodega_products_v1` = 115 y `bodega_sales_v1` = 431, `updated_at` 2026-10-16T00:10:40Z) y `apertura_1792060754459` (`APERTURA_CAJA` 2026-10-15T10:39:14.459Z, `cajaCerrada: false`, sin `REGISTRO_CIERRE` posterior) coinciden **exactamente** con el reporte. Hallazgos adicionales: (a) el monitor conserva su propio estado de POS del 2026-08-10 (111 productos / 34 ventas / 1 cliente) bajo su `device_id` — confirma el supuesto de F2; (b) los `REGISTRO_CIERRE` del primary van del 2026-07-24 al 2026-08-14 y luego hay salto al 15/10: el turno del 15/10 es el único sin cerrar; (c) existen docs `local` escalares (strings: `bodega_rate_mode`, `tasa_cop`, …), no todos los `payload` son arrays — F3/F4 deben tratar `payload` array y escalar.
- **[Fuera de alcance]** El reporte omite el ancla de identidad (`verifyStoredFingerprint`) y el watermark como causantes de merges bloqueados; se cubren implícitamente en F2/F3.

## 8. Orden sugerido de ejecución

**D1 → F1 → F2** (desbloquea al usuario real) y luego **F3 → F4** (elimina la clase de bugs), con **F5** como guía operativa desde el día uno.
