# Modo Supervisor: plan de fixeo E2E y salida a producción

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Cerrar los bloqueos encontrados en la auditoría E2E y certificar el modo Supervisor mediante un flujo controlado de vinculación, sincronización, reconexión y desvinculación.

**Architecture:** La lógica de producción seguirá usando la sesión anónima de Supabase, el registro explícito de device_sessions y las RPC de pairing/unpair como fuente de autorización. Staging tendrá sus propios tests, fixtures, variables y migraciones; no se copiarán artefactos de staging a la raíz productiva. La validación final se hará en dos capas: pruebas deterministas locales y una prueba E2E contra una estación primaria y un monitor sintéticos.

**Tech Stack:** React 19, Vite, Supabase Auth/RPC/Realtime, Vitest, Playwright, Bun y html5-qrcode.

---

## Contexto y restricciones

La auditoría del 2026-10-14 dejó estos hechos:

- La entrada al modo Supervisor y el pairing manual funcionan.
- Un código inválido produce un rechazo de negocio manejable y la pantalla se recupera.
- El recorrido exitoso pair → live sync → unpair todavía no fue certificado.
- El runner test:supervisor:staging termina con No test files found porque faltan dos pruebas dentro del checkout de staging.
- El navegador automatizado no tenía cámara; el camino QR quedó parcial.
- El checkout productivo debe permanecer libre de variables, migraciones y tests exclusivos de staging.
- El arreglo existente en src/utils/deviceIdentity.js y src/components/Settings/PairingManager.jsx debe conservarse: la caja registra su sesión antes de consultar o ejecutar unpair_monitor.

## Criterios de aceptación globales

- La suite productiva de Supervisor pasa completa.
- El runner de staging encuentra y ejecuta sus pruebas desde la raíz de staging.
- Una caja primaria sintética puede generar un token y vincular un monitor.
- El monitor obtiene el snapshot inicial y recibe al menos un cambio por Realtime.
- La sesión se recupera después de recargar o reconectar.
- La caja autorizada puede desvincular el monitor y el estado remoto queda revocado.
- Un dispositivo no autorizado recibe rechazo y no altera el pairing.
- La ausencia o denegación de cámara muestra una explicación clara y deja disponible el código manual.
- No se ejecutan RPC mutantes contra producción durante las pruebas.
- El build, typecheck, lint y pruebas E2E pasan antes de liberar.

## Orden de ejecución

1. Reparar inventario y runner de staging.
2. Crear fixture backend determinista y pruebas de autorización.
3. Añadir pruebas del flujo completo pair → sync → unpair.
4. Mejorar el fallback de cámara y cubrirlo.
5. Verificar robustez de sesión, Realtime y reconexión.
6. Reducir ruido de observabilidad no bloqueante.
7. Ejecutar la matriz de salida y actualizar el reporte.

---

### Task 1: Congelar el baseline y separar los dos checkouts

**Files:**
- Inspect: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment
- Inspect: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-staging
- Reference: docs/reports/2026-10-14-auditoria-e2e-modo-supervisor.md

**Step 1: Registrar el estado actual**

Run from the production checkout:
git status --short
bun run test:supervisor -- --maxWorkers=1

Run from the staging checkout:
git status --short
bun install --frozen-lockfile

Expected: se conserva el trabajo existente, la suite productiva mantiene 14 archivos y 83 pruebas aprobadas y staging tiene dependencias instaladas sin modificar código fuente.

**Step 2: Confirmar la frontera de archivos**

Verificar que los siguientes elementos solo existan en staging o en su configuración local no versionada:

- .env.local y .env.staging.local con URLs de staging.
- supabase/staging-migrations/.
- tests de integración que mutan el proyecto de staging.
- helpers de sesiones anónimas de staging.

Expected: la raíz productiva no contiene migraciones, secretos ni fixtures exclusivos de staging.

**Step 3: Guardar este baseline en el reporte de trabajo**

Registrar comandos, commit base y cualquier modificación previa antes de implementar. No ejecutar git reset, git checkout ni operaciones destructivas.

**Step 4: Commit**

Crear un commit de preparación solo si el equipo usa commits por tarea:
git add docs/reports/2026-10-14-auditoria-e2e-modo-supervisor.md
git commit -m "docs: document supervisor e2e baseline"

---

### Task 2: Restaurar el runner ejecutable de staging

**Files:**
- Modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-staging/package.json
- Create/restore: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-staging/tests/supervisorPairingStaging.test.js
- Create/restore: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-staging/tests/supervisorSecretUnpairStaging.test.js
- Create/restore: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-staging/tests/helpers/stagingAnonymousSessions.js
- Reference source: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-staging/from-production-alignment-20261014/tests/

**Step 1: Restaurar las pruebas desde el archivo conservado**

Reponer los tests y helpers en sus rutas normales dentro de staging. Los imports relativos deben resolver desde staging/tests y no desde from-production-alignment-20261014.

Expected: los dos archivos declarados por test:supervisor:staging existen en staging/tests.

**Step 2: Añadir una prueba de inventario**

Crear una prueba que falle si el script apunta a rutas inexistentes o si faltan los helpers requeridos.

Expected: la prueba falla de forma explícita con una ruta útil cuando se rompe el inventario, en vez de terminar con No test files found.

**Step 3: Ejecutar el runner antes de tocar la lógica**

Run from staging:
bun run test:supervisor:staging

Expected: los archivos son descubiertos; si faltan variables o datos de staging, el fallo debe ser de configuración/credenciales y no de descubrimiento de archivos.

**Step 4: Verificar el entorno seguro**

Confirmar que las URLs usadas por los tests coinciden con el proyecto Supabase de staging y que no se heredan las variables de producción.

Expected: el test aborta antes de una mutación si SUPERVISOR_STAGING_PAIRING_E2E no está activo o si la URL no es la allowlist de staging.

**Step 5: Commit**

git add package.json tests/supervisorPairingStaging.test.js tests/supervisorSecretUnpairStaging.test.js tests/helpers/stagingAnonymousSessions.js
git commit -m "test: restore supervisor staging runner"

---

### Task 3: Crear un fixture backend seguro para pairing y autorización

**Files:**
- Create/modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-staging/tests/helpers/supervisorStagingScenario.js
- Modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-staging/tests/supervisorPairingStaging.test.js
- Modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-staging/tests/supervisorSecretUnpairStaging.test.js
- Reference: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/supabase/migrations/20261014_supervisor_seguridad_practica.sql
- Reference: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/supabase/migrations/20261015_supervisor_device_session_registration.sql

**Step 1: Definir IDs únicos por ejecución**

El fixture debe generar IDs con un prefijo de test y timestamp, por ejemplo supervisor-e2e-<run-id>-primary y supervisor-e2e-<run-id>-monitor.

Expected: dos ejecuciones concurrentes no comparten filas ni tokens.

**Step 2: Escribir la prueba de pairing válido**

Cubrir en orden:

1. Registrar la sesión anónima de la caja.
2. Generar token con generate_pairing_token.
3. Registrar la sesión anónima del monitor.
4. Ejecutar pair_monitor_device con el token.
5. Comprobar monitor_device_id, monitor_auth_id, primary_device_id y paired_at.
6. Confirmar que el token no puede reutilizarse.

Expected: una vinculación válida crea una única relación activa.

**Step 3: Ejecutar la prueba y confirmar que falla si el fixture está incompleto**

Run:
bunx vitest run tests/supervisorPairingStaging.test.js --maxWorkers=1

Expected: el test pasa cuando staging está configurado; si falta una RPC, sesión o migración, el mensaje identifica la operación exacta.

**Step 4: Escribir la prueba de desvinculación autorizada**

Cubrir:

1. La caja registra nuevamente su device session.
2. La caja llama unpair_monitor.
3. La consulta posterior confirma revoked_at o ausencia de pairing activo.
4. La interfaz puede consultar el estado y quedar en idle.

Expected: la caja propietaria no recibe el error “No autorizado para desvincular este supervisor”.

**Step 5: Escribir la prueba de propietario incorrecto**

Usar una tercera sesión anónima y llamar unpair_monitor sobre el device_id de la caja.

Expected: la RPC rechaza con el error de autorización y el pairing activo permanece intacto.

**Step 6: Añadir limpieza idempotente**

El fixture debe revocar/eliminar solo los IDs creados por su run, incluso si una aserción falla. No debe truncar tablas ni usar service_role contra producción.

**Step 7: Commit**

git add tests/helpers/supervisorStagingScenario.js tests/supervisorPairingStaging.test.js tests/supervisorSecretUnpairStaging.test.js
git commit -m "test: cover supervisor pairing authorization in staging"

---

### Task 4: Cubrir el flujo de sincronización y reconexión

**Files:**
- Create: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-staging/tests/e2e/supervisor-live-sync.e2e.spec.js
- Modify if needed: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/hooks/useMonitorSync.js
- Modify if needed: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/services/supervisorSyncService.js
- Test references: tests/supervisorSync.test.js, tests/supervisorLifecycle.test.js

**Step 1: Escribir la prueba E2E de dos contextos**

Crear un contexto para la caja y otro para el monitor. Ambos deben usar el mismo run-id y las credenciales anónimas aisladas del fixture de staging.

Expected: el monitor nunca reutiliza localStorage, cookies o sesión del contexto de la caja.

**Step 2: Vincular y abrir el monitor**

La caja genera token; el monitor lo canjea; el monitor espera supervisor-panel y un estado de sincronización conectado.

Expected: el monitor muestra datos solo después de pairing válido.

**Step 3: Publicar un cambio controlado**

Insertar o actualizar un sync_document de staging con envelope válido y updatedAt posterior.

Expected: el monitor refleja el cambio sin recarga completa y actualiza lastSync.

**Step 4: Probar payload inválido y documento antiguo**

Enviar un envelope inválido y uno con updatedAt anterior.

Expected: ambos son rechazados sin sobrescribir datos locales válidos.

**Step 5: Probar reconexión**

Cerrar el canal o simular pérdida de red, volver a conectarlo y verificar que no quedan canales duplicados.

Expected: el estado pasa por degraded o reconnecting y vuelve a connected sin duplicar callbacks.

**Step 6: Ejecutar las pruebas deterministas**

Run from production checkout:
bunx vitest run tests/supervisorSync.test.js tests/supervisorLifecycle.test.js --maxWorkers=1

Expected: PASS; cualquier ajuste debe conservar los guardrails de lifecycleId, removeChannel, initInFlightRef y lastSync.

**Step 7: Ejecutar el E2E de staging**

Run from staging with the approved environment:
SUPERVISOR_STAGING_PAIRING_E2E=true bunx playwright test tests/e2e/supervisor-live-sync.e2e.spec.js

Expected: pairing, snapshot inicial, evento Realtime y reconexión pasan en la misma ejecución.

---

### Task 5: Mejorar el fallback de cámara y probar QR

**Files:**
- Modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/components/PairingScanScreen.jsx
- Create/modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/pairingScanScreen.test.jsx
- Modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/supervisorLifecycle.test.js
- Optional E2E: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-staging/tests/e2e/supervisor-qr.e2e.spec.js

**Step 1: Escribir las pruebas del estado sin cámara**

Mockear Html5Qrcode.getCameras y hacer que rechace con NotFoundError.

Expected: la pantalla muestra un mensaje específico de cámara no disponible, detiene el scanner y deja visible la acción Código de vinculación.

**Step 2: Escribir la prueba de permiso denegado**

Mockear html5QrCode.start con NotAllowedError.

Expected: la pantalla diferencia permiso denegado de cámara ausente y conserva el fallback manual.

**Step 3: Ejecutar las pruebas para confirmar el fallo actual**

Run:
bunx vitest run tests/pairingScanScreen.test.jsx --maxWorkers=1

Expected: FAIL antes del cambio si la UI no expone el estado esperado.

**Step 4: Implementar el cambio mínimo**

En PairingScanScreen.jsx:

- Normalizar NotFoundError, NotAllowedError y errores de acceso.
- Mostrar un mensaje accionable.
- Evitar reintentos infinitos cuando no existen cámaras.
- Mantener el código manual habilitado.
- Limpiar scanner, timers y promesas al cambiar de método o desmontar.

Expected: ningún error de cámara deja la pantalla bloqueada en requesting.

**Step 5: Verificar la prueba y el lifecycle**

Run:
bunx vitest run tests/pairingScanScreen.test.jsx tests/supervisorLifecycle.test.js --maxWorkers=1

Expected: PASS sin perder las protecciones scanInFlightRef, restartTimerRef, startPromiseRef y mountedRef.

**Step 6: Validar en hardware o cámara virtual**

Probar Android/Chrome con cámara permitida, cámara denegada, cámara ausente y cambio frontal/trasera.

Expected: QR válido vincula; QR inválido reinicia de forma controlada; cualquier fallo ofrece código manual.

**Step 7: Commit**

git add src/components/PairingScanScreen.jsx tests/pairingScanScreen.test.jsx tests/supervisorLifecycle.test.js
git commit -m "fix: make supervisor qr fallback explicit"

---

### Task 6: Verificar y reforzar la desvinculación desde la caja

**Files:**
- Inspect/modify only if tests fail: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/utils/deviceIdentity.js
- Inspect/modify only if tests fail: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/components/Settings/PairingManager.jsx
- Modify tests: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/deviceIdentity.test.js
- Modify tests: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/supervisorLifecycle.test.js
- SQL reference: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/supabase/migrations/20261015_supervisor_device_session_registration.sql

**Step 1: Escribir una prueba de orden de operaciones**

Verificar que ensureDeviceSessionRegistered(deviceId) ocurre antes de unpair_monitor y antes de la consulta de confirmación.

Expected: el test falla si alguien reintroduce la llamada RPC sin registrar identidad.

**Step 2: Verificar RPC-first y fallback**

Cubrir:

- register_device_session exitoso.
- RPC no disponible con fallback compatible.
- sesión anónima ausente.
- device_id vacío o inválido.

Expected: el fallback no debilita autorización y los errores se muestran como estado recuperable.

**Step 3: Ejecutar la regresión**

Run:
bunx vitest run tests/deviceIdentity.test.js tests/supervisorLifecycle.test.js --maxWorkers=1

Expected: PASS y preservación del arreglo P0 existente.

**Step 4: Ejecutar el caso real en staging**

Desde el fixture de Task 3, hacer que la caja pulse desvincular o invocar la misma operación autorizada y comprobar que el frontend:

- muestra estado de carga.
- confirma el estado remoto.
- cambia a idle.
- no muestra falso éxito si el servidor sigue reportando pairing activo.

Expected: el error original “No autorizado para desvincular este supervisor” no aparece para la caja propietaria.

---

### Task 7: Reducir ruido de logs y solicitudes obsoletas

**Files:**
- Inspect/modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/hooks/useRemoteCommands.js
- Inspect/modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/hooks/useCloudSync.js
- Inspect/modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/hooks/useAutoBackup.js
- Inspect/modify: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/src/utils/backupStorageUpload.js
- Tests: C:/Users/luigg/Desktop/sistemas generales/precios al dia final/preciosaldia-supervisor-production-alignment/tests/useAutoBackupRequests.test.jsx

**Step 1: Clasificar logs esperables**

Separar logs de diagnóstico de logs de fallo:

- feature flag apagado.
- estación aún no emparejada.
- cámara ausente.
- fallo real de autenticación, RPC o Realtime.

Expected: los estados normales de una caja sin monitor no aparecen como errores de producción.

**Step 2: Añadir prueba para backup pendiente obsoleto**

Crear una prueba con solicitud pendiente y estación no configurada.

Expected: la solicitud queda reintentable o se marca con estado explicable, sin ruido repetido en cada arranque.

**Step 3: Ejecutar la regresión**

Run:
bunx vitest run tests/useAutoBackupRequests.test.jsx tests/supervisorLifecycle.test.js --maxWorkers=1

Expected: PASS y sin alterar el flujo de pairing.

**Step 4: Validar una carga inicial no emparejada**

Run:
bun run dev --host 127.0.0.1

Abrir la aplicación y revisar consola.

Expected: no hay errores rojos ni mensajes duplicados que parezcan fallos de Supervisor cuando el estado es simplemente “sin pairing”.

---

### Task 8: Ejecutar la matriz completa de salida

**Files:**
- Reference: docs/reports/2026-10-14-auditoria-e2e-modo-supervisor.md
- Modify: docs/reports/2026-10-14-auditoria-e2e-modo-supervisor.md
- Create: docs/reports/2026-10-14-supervisor-fixeo-validacion-final.md

**Step 1: Validar producción local**

Run:
bun run lint:supervisor
bun run typecheck
bun run test:supervisor -- --maxWorkers=1
bun run build

Expected: cero errores; advertencias de chunk documentadas si permanecen.

**Step 2: Validar staging**

Run from staging:
bun run test:supervisor:staging
SUPERVISOR_STAGING_PAIRING_E2E=true bunx playwright test tests/e2e/supervisor-live-sync.e2e.spec.js

Expected: el runner descubre pruebas, las credenciales apuntan solo a staging y el flujo completo pasa.

**Step 3: Ejecutar pruebas negativas**

Comprobar:

- token expirado.
- token reutilizado.
- sesión sin autorización.
- monitor no emparejado.
- caja no propietaria intentando desvincular.
- cámara ausente/denegada.
- Realtime interrumpido.
- documento viejo o inválido.

Expected: cada caso falla cerrado, conserva datos válidos y ofrece una recuperación clara.

**Step 4: Revisar evidencia**

Guardar screenshots, consola y resultados de red solo del entorno de staging. No guardar tokens, cookies, JWT ni secretos en el repositorio.

Expected: el reporte identifica commit, entorno, fecha, pruebas ejecutadas y resultado de cada caso.

**Step 5: Aplicar la puerta de producción**

No liberar si ocurre cualquiera de estas condiciones:

- runner de staging no ejecutable.
- pairing válido no confirmado.
- cambio Realtime no recibido.
- desvinculación autorizada falla.
- propietario incorrecto puede mutar el estado.
- errores de cámara dejan la pantalla bloqueada.
- pruebas productivas o build fallan.

**Step 6: Commit final**

Separar commits por intención y revisar cada diff antes de integrar:

- fix de UX QR.
- tests/fixtures E2E de staging.
- ajustes de observabilidad.
- documentación de validación final.

No mezclar archivos de staging con el checkout productivo.

## Definición de terminado

El fixeo queda terminado cuando:

- test:supervisor:staging ya no falla por archivos ausentes.
- Pairing, snapshot inicial, Realtime, reconexión y unpair pasan contra staging.
- La autorización de caja propietaria y el rechazo de terceros están comprobados en vivo.
- La UI QR tiene fallback claro para cámara ausente o permiso denegado.
- verify:supervisor pasa en producción.
- La documentación final declara evidencia PASS, limitaciones y commit probado.
- No quedan secretos ni artefactos exclusivos de staging en la raíz productiva.

@writing-plans

