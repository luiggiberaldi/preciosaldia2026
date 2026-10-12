# Plan de mitigación: prevención de pérdida de datos del usuario

**Fecha:** 2026-10-12
**Estado:** plan de trabajo; no se implementó ningún cambio todavía.
**Objetivo:** reducir los riesgos de pérdida de datos identificados en la auditoría a un nivel aceptable, atacando primero las brechas con mayor probabilidad × impacto.

Auditoría de origen: análisis del 2026-10-12 — "qué situación podría borrar los datos, cuáles situaciones son riesgosas". El failover existente ya fue verificado en staging ese mismo día (6 capas: escritura local-first, circuit breaker, shadow backup del catálogo, autobackup local cada 30 min, guardas de subida cloud, validación de import).

## 0. Resumen de riesgos y prioridades

| Riesgo | Qué se pierde | Protección hoy | Prioridad |
|---|---|---|---|
| R1. Botón "Limpiar datos críticos" en ErrorBoundary borra productos+ventas+carrito con `localforage.removeItem` directo (se salta circuit breaker y shadow) | productos, ventas, carrito | solo autobackup local ≤30 min | **P0** |
| R2. Evicción del origen por Chrome bajo presión de disco / "Borrar datos de navegación" / desinstalación de PWA | todo el dispositivo | solo backup cloud si es premium y logró subir | **P0** |
| R3. Cuota llena (`QuotaExceededError`): la escritura falla en silencio (ISSUES.md #360) | la venta de ese tick | ninguna (ni aviso) | **P1** |
| R4. Restaurar un backup viejo pisa datos nuevos (no hay comparación de frescura) | ventas posteriores al backup | validación de forma, no de frescura | **P1** |
| R5. Dos equipos con mismo `device_id`: last-writer-wins pisa recientes con snapshot atrasado | ventas/clientes del equipo activo | hash anti-eco, no anti-regresión | **P2** |
| R6. Shadow backup cubre solo el catálogo (no ventas ni ledger) | ventas/ledger tras restauración corta | circuit breaker solo catálogo | **P2** |

## 1. Alcance y límites

### Criterios de aceptación

1. El botón de recuperación de ErrorBoundary **no puede** borrar catálogo, ventas ni carrito sin crear antes una sombra con el contenido vigente.
2. La app solicita `navigator.storage.persist()` y muestra en Ajustes el estado real (`persisted()`), con aviso visible si no está concedido.
3. Un fallo de escritura por cuota produce un aviso visible (no silencioso) y la operación queda en cola de reintento (la cola ya existe: `getPendingRetries` / `flushRetries` en `storageService`).
4. Al importar un backup más viejo que el autobackup local, se advierte la diferencia de días antes de aplicar; el formato v2.0 no cambia (usa el campo `timestamp` ya existente).
5. El shadow backup cubre también `bodega_sales_v1` y `bodega_customer_ledger_v1` ante reducciones drásticas (circuit breaker generalizado).
6. Ningún cambio es destructivo con datos existentes: todas las protecciones se agregan, nada se migra ni se depura.
7. Este plan no toca Supabase, Estación Maestra ni licencias; no incluye push ni deploy.

### Límites

- No tocar `sync_documents`, `cloud_backups` ni ningún esquema de base de datos remota.
- No cambiar el formato v2.0 de backups (compatibilidad con los JSON ya descargados por clientes); solo se leen campos ya existentes.
- No rediseñar ErrorBoundary: solo el camino de borrado crítico.
- Cambios confinados a `src/`, `tests/` y `docs/plans/`. No editar otros planes existentes.

## 2. Estado actual verificado (no duplicar trabajo)

Ya existe y funciona (verificado en staging el 2026-10-12 y en tests del repo):

- Escritura local-first + cola de sync con debounce (`storageService.setItem` → `queueCloudSync`).
- Circuit breaker del catálogo con flag admin `confirm_bulk_delete_catalog_flag` (bloquea <10%).
- `shadowBackupService` espeja el catálogo en store aparte (`bodega_shadow_backups`); `restoreShadow` accesible desde ProductContext.
- `bodega_autobackup_v1` (30 s tras arranque, cada 30 min), incluido en `PROTECTED_KEYS`.
- `validateBackupJson` rechaza v2.0 sin `data.idb` o vacío **antes** de borrar nada (BACKUP-002).
- `clearAppKeysForRestore` (HOOK-025) preserva `PROTECTED_KEYS` y la sesión de auth.
- Cola de reintentos por cuota ya implementada en `storageService` (`_retryQueue`, `getPendingRetries`, `flushRetries`), pero **sin señal a la UI**.
- Health-check de backup en `systemConsciousnessService` (solo visible en el reporte IA).

Conclusión: las fases P0/P1 no construyen motores nuevos — **conectan** mecanismos ya existentes donde hoy se los salta.

## 3. Fase 1 (P0) — Cerrar los dos hoyos de borrado

### 3.1 ErrorBoundary pasa por las protecciones

**Cambio en `src/components/ErrorBoundary.jsx`:**

1. `_handleClearCriticalData` borra hoy con `localforage.removeItem('bodega_products_v1' / 'bodega_sales_v1' / 'bodega_pending_cart_v1')` directo. Reemplazar por:
   - **Antes de borrar nada**: leer el valor vigente de cada clave y guardar la sombra vía `shadowBackupService.saveShadow(key, value)` (funciona para cualquier clave, no solo catálogo).
   - **Luego** borrar con `storageService.removeItem(key)` en lugar de `localforage.removeItem`. Para el catálogo con >5 items, `storageService` activará el circuit breaker y exigirá el flag: colocar `localStorage.setItem('confirm_bulk_delete_catalog_flag', 'true')` **solo después** de la sombra exitosa (el propio `storageService` limpia el flag al consumirlo — comportamiento ya probado).
2. Mantener el `window.confirm` actual como primera barrera; el mensaje debe decir que se creó/crea una copia de seguridad antes de borrar.
3. Añadir en la misma pantalla de error un botón secundario "Restaurar copia de respaldo" que llame `restoreShadow` para las tres claves, para recuperar si el usuario se arrepiente (la sombra vive en IndexedDB y sobrevive a la recarga).

**Prueba nueva:** `tests/errorBoundaryShadowGuard.test.js`:

- mock de `window.confirm = true`; catálogo con 10 productos; 3 ventas;
- ejecutar el handler de borrado;
- asertar que existen las 3 sombras con los datos previos al borrado;
- asertar que `bodega_products_v1` ya no está en IndexedDB;
- restaurar y asertar que catálogo y ventas vuelven completos.

### 3.2 Almacenamiento persistente contra evicción (R2)

**Cambio en `src/App.jsx` (colocar tras el bootstrap de licencia):**

1. Una vez por instalación: `navigator.storage?.persist?.()`; guardar el resultado en `localStorage.setItem('pda_storage_persisted', 'granted' | 'denied' | 'unsupported')`.
2. En `SettingsTabSistema.jsx` (sección "Datos y Respaldo"), añadir una fila de estado: "Almacenamiento persistente: Protegido / El navegador puede borrar datos si falta espacio / No soportado". Si no está concedido, en rojo/ámbar con una línea explicando qué ayuda (instalar la PWA; liberar espacio del disco).
3. Fire-and-forget con `catch(() => {})`: la petición no bloquea el arranque.

**Prueba nueva:** `tests/storagePersistence.test.js`:

- sin `navigator.storage` (jsdom): la función aborta sin lanzar y marca `unsupported`;
- mock `persist → true` y `→ false`: el flag se escribe con el valor correcto.

## 4. Fase 2 (P1) — Visibilidad y frescura

### 4.1 Aviso no silencioso por cuota llena (R3)

**Cambio en `src/utils/storageService.js`:**

1. En el catch de cuota del `setItem`, además del `console.error` actual y el push a `_retryQueue`, disparar `window.dispatchEvent(new CustomEvent('pda_storage_quota_critical', { detail: { key } }))`.
2. Listener en `App.jsx` (mismo patrón existente que `circuit_breaker_triggered` en ProductContext): toast/banner como máximo 1 vez cada 5 min por clave — "No se pudo guardar <clave>: el almacenamiento del navegador está lleno. Exporta un backup en Ajustes y libera espacio."
3. La cola de reintentos ya reintenta en escrituras futuras: no duplicar esa lógica.

**Prueba:** ampliar `tests/hooks.test.js` (ya contiene el caso "IndexedDB quota exceeded"):

- al fallar, se emite el evento con `detail.key` correcto;
- la operación queda en `getPendingRetries()`;
- segundo fallo del mismo key en <5 min no emite otro evento (dedupe por ventana de tiempo).

### 4.2 Aviso de respaldo viejo

**Cambio en `SettingsTabSistema.jsx` (sección "Datos y Respaldo" ya existe):**

1. Leer `bodega_autobackup_v1.timestamp`; si tiene más de 48 h (o no existe), banner ámbar: "Último respaldo local: hace X días. Abre la app con internet para actualizarlo."
2. Si el equipo es premium y `pda_last_backup_timestamp` tiene más de 7 días, sugerir verificar la sesión de nube.
3. Solo lectura: la UI no regenera backups (el hook corre solo); `systemConsciousnessService` conserva su rol en el reporte IA.

**Prueba nueva:** `tests/backupAgeWarning.test.js`: función pura `getBackupFreshness(timestamp, now)` → `'fresh' | 'stale_48h' | 'stale_7d' | 'none'`, probando los 4 estados con `now` inyectado.

### 4.3 Aviso de anti-regresión al importar (R4)

**Cambio en `src/utils/backupRestoreService.js` + `src/hooks/useDataImportExport.js`:**

1. Nueva función pura `shouldWarnBackupRegression(backupJson, localAutobackup)` en `backupRestoreService`: si `backupJson.timestamp < localAutobackup.timestamp`, devuelve `{ warn: true, days }`; si no hay autobackup local, `{ warn: false }`.
2. En `useDataImportExport`, antes de `clearAppKeysForRestore`: si `warn`, el diálogo de confirmación indica "Este backup es de hace N días. Las ventas registradas desde entonces se reemplazarán. ¿Continuar?". Al aceptar, el flujo sigue idéntico al actual.
3. Sin cambios de formato: se compara el campo `timestamp` que ambos documentos ya traen.

**Prueba:** ampliar `tests/backupRestore.test.js`:

- backup 12 días más viejo → `{ warn: true, days: 12 }`;
- autobackup inexistente / backup más nuevo → `{ warn: false }`.

## 5. Fase 3 (P2) — Profundizar la red

### 5.1 Sombra para ventas y ledger (R6)

1. Generalizar el circuit breaker de `storageService.setItem`: para `bodega_products_v1` (>10%), `bodega_sales_v1` y `bodega_customer_ledger_v1` (>5%): bloquear la sobrescritura drástica sin flag admin, guardando primero la sombra de la clave afectada cuando el flag esté presente.
   - El ledger puede requerir cuidado extra: si la lógica de merge (`mergeLedgerEntries`) vive en useCloudSync, el circuit breaker actúa sobre la escritura final, no sobre el append incremental.
2. `restoreShadow` expuesto como acción de emergencia con confirmación etiquetada por clave.

**Prueba nueva:** `tests/shadowBackupExtended.test.js`: reducción de ventas 100 → 3 bloqueada sin flag; con flag se guarda la sombra de ventas y permite el cambio; appends (100 → 101) nunca bloquean.

### 5.2 Anti-regresión de snapshot cloud (R5)

Tema aparte, **no incluido** en este plan: `pushCloudSync(forceUnconditional=true)` debería rechazar el push si el documento remoto es más nuevo. Requiere lectura previa del doc remoto (1 read extra por push forzado; aceptable porque son raros). Se implementará solo si se confirma que hay clientes con 2+ equipos por `device_id`.

## 6. Orden de implementación y verificación

| Paso | Fase | Archivos | Verificación |
|---|---|---|---|
| 1 | Fase 1 | `ErrorBoundary.jsx` (+ tests) | `npx vitest run tests/errorBoundaryShadowGuard.test.js` |
| 2 | Fase 1 | `App.jsx`, `SettingsTabSistema.jsx` | `npx vitest run tests/storagePersistence.test.js` |
| 3 | Fase 2 | `storageService.js`, `App.jsx` | ampliar `tests/hooks.test.js` |
| 4 | Fase 2 | `SettingsTabSistema.jsx` | `npx vitest run tests/backupAgeWarning.test.js` |
| 5 | Fase 2 | `backupRestoreService.js`, `useDataImportExport.js` | ampliar `tests/backupRestore.test.js` |
| 6 | Fase 3 | `shadowBackupService.js`, `storageService.js` | `npx vitest run tests/shadowBackupExtended.test.js` |
| 7 | Cierre | — | `npx vitest run` suite completa; `npm run build`; lint de los archivos tocados |

Gates: Fase 1 completa con suite verde → recién entonces Fase 2 → suite verde → Fase 3 (opcional).

## 7. Riesgos del propio plan

- ErrorBoundary ejecutándose en estado de error: la creación de sombra puede fallar (IndexedDB corrupto). Mitigación: si la sombra falla, el borrado debe abortarse y mostrarse el mensaje actual de recuperación manual; nunca borrar sin sombra confirmada (`try { await saveShadow(...); shadowOk = true; }`).
- `navigator.storage.persist()` puede ser denegado; el plan no promete persistencia, solo pide y muestra el estado honesto.
- Generalizar circuit breaker a ventas/ledger puede dar falso positivo en restauraciones legítimas de datos cortos (negocio nuevo). Mitigación: el flag admin existente + umbrales (5%) menos agresivos que el de catálogo (10%).
- Los JSON de backup existentes no cambian de formato: el aviso de regresión solo lee `timestamp`. Cero migración.

## 8. Criterio de terminado

- Fases 1 y 2 implementadas con sus tests; Fase 3 recomendada.
- Suite completa `npx vitest run` exit 0 (o sin fallos nuevos vs baseline).
- `npm run build` exit 0; lint de archivos tocados sin errores nuevos.
- Recorrido manual en staging: (a) crash + "Limpiar datos" deja sombras y luego restaura; (b) Ajustes muestra el estado real de persistencia; (c) import de backup viejo advierte los días de diferencia antes de pisar.
- Actualizar ISSUES.md: cerrar #360 (cuota silenciosa) y anotar la ampliación de sombra.
