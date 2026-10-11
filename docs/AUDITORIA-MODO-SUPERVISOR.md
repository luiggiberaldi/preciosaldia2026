# Auditoría completa del Modo Supervisor

**Fecha:** 10 de octubre de 2026  
**Alcance:** inspección estática local de pairing/Auth, RLS y SQL, sincronización, Realtime, comandos, inventario, revocación, ciclo de vida, UX y pruebas.  
**Resultado:** existen controles relevantes en el diseño local, pero el estado efectivo de producción no pudo validarse. Los riesgos P1 descritos aquí impiden considerar cerrada la auditoría de extremo a extremo.

## Límites y método

- Se inspeccionaron archivos del checkout; no se editaron archivos de implementación ni se ejecutaron migraciones, SQL o escrituras remotas.
- Se consultó el conector Supabase disponible, pero no estaba aprobado/habilitado. No se inspeccionaron tablas, policies, grants, funciones o flags reales del proyecto. Los datos de producción citados desde `M5-PRODUCTION-CANARY.md` y otros planes son evidencia documental del repositorio, no validación en vivo.
- La carpeta del checkout contenía conflictos Git preexistentes (`UU`) y cambios staged en archivos ajenos al Supervisor. No se tocaron.
- Las pruebas E2E de staging están omitidas por defecto y requieren configuración explícita; no se activaron.

## Resumen ejecutivo

| Prioridad | Hallazgo | Confianza | Estado |
|---|---|---|---|
| P1 | Datos en caché del monitor sobreviven a la revocación del pairing | Alta para retención local; efecto depende del acceso físico al monitor | Abierto |
| P1 | ACK antes de persistir deduplicación local permite ventana de replay | Alta | Abierto |
| P1 | Scripts SQL legado y endurecido no son una secuencia segura intercambiable | Alta | Mitigado solo si producción mantiene el estado endurecido |
| P1 | La RPC Auth puede reclamar un ID de caja arbitrario o una fila revocada sin prueba server-side de identidad | Alta | Abierto |
| P1 | Comandos pendientes entregados antes de la revocación pueden aplicarse después | Alta | Abierto |
| P1 | Flags de build, código local y política SQL no se pudieron cotejar contra producción | Alta como brecha de verificación | Pendiente de validación |
| P2 | El fallback del lock no coordina pestañas/dispositivos | Alta | Limitación de concurrencia |
| P2 | RPC/UI de desconexión del monitor no hacen cumplir el vínculo como requisito de éxito | Alta | Abierto |
| P2 | Ventana de TTL futuro más amplia que el TTL nominal | Media-alta | Requiere endurecimiento y prueba |
| P2 | Pull inicial y push de recuperación pueden competir | Media | Riesgo no medido |
| P2 | La E2E de “separación caja/monitor” no afirma realmente esa propiedad | Alta | Cobertura insuficiente |
| P3 | Warnings de lint y chunking dificultan mantener un gate limpio | Alta | Deuda, no bloqueo funcional demostrado |

## Hallazgos detallados

### P1 — La revocación no elimina la copia local del monitor

El monitor recibe documentos y los guarda en localStorage/IndexedDB en [useMonitorSync.js](../src/hooks/useMonitorSync.js#L98-L117). El cleanup del hook elimina listeners/timers/canales, pero no borra documentos en el teardown: [useMonitorSync.js](../src/hooks/useMonitorSync.js#L311-L322). La política de RLS puede impedir nuevas lecturas después de `revoked_at`, pero no borra lo que ya llegó al navegador.

La ruta de desconexión en [OwnerMonitorView.jsx](../src/views/OwnerMonitorView.jsx#L403-L433) borra `localforage` después de intentar el RPC. Si el RPC falla, el error se registra y el flujo aun así borra localmente, muestra “Dispositivo desvinculado con éxito” y recarga. La acción local no puede revocar una sesión remota que no se revocó en servidor.

**Impacto:** datos financieros/comerciales previamente descargados pueden seguir disponibles offline en un dispositivo que se desvinculó o cuya revocación falló. El bloqueo RLS no es borrado remoto ni control de copias existentes.

**Recomendación:** hacer que el resultado del RPC sea requisito para afirmar revocación; distinguir estado “revocación server-side confirmada” de limpieza local; al terminar o perder autorización, purgar datos de negocio locales del monitor con resultado verificable. Definir explícitamente qué sucede si el dispositivo está offline. No afirmar borrado remoto de datos sin un protocolo que lo garantice.

### P1 — ACK antes de persistir la deduplicación durable

El receptor aplica el comando y luego llama `ackCommand(..., 'applied')`; solo después guarda el registro en `supervisor_applied_commands_v1`: [useRemoteCommands.js](../src/hooks/useRemoteCommands.js#L257-L262) y [useRemoteCommands.js](../src/hooks/useRemoteCommands.js#L264-L305). Si la aplicación termina después del ACK servidor y antes de `rememberAppliedCommand`, el registro en servidor ya no está `pending`, pero el historial local puede no existir.

La tabla SQL evita cambiar un ACK terminal a otro estado, y el receptor tiene guardias en memoria y almacenamiento local. Sin embargo, no hay transacción atómica entre mutación POS, escritura del dedupe local y ACK remoto. Para inventario, el movimiento recibe un ID derivado de commandId y se valida `expectedStock`; además los fallos de sincronización intentan restaurar el snapshot local: [supervisorInventoryCommand.js](../src/services/supervisorInventoryCommand.js#L81-L108). Eso reduce algunos escenarios, pero no constituye una transacción remota; `Promise.all` puede haber aceptado un upsert antes de que falle el otro.

**Impacto:** replay, divergencia entre productos e historial o ACK que no corresponde a una operación durable. El riesgo y los síntomas varían por tipo de comando.

**Recomendación:** mover la idempotencia a una capa durable del dominio y ordenar el flujo para que un ACK “applied” implique que la operación y su clave de deduplicación quedaron persistidas; usar reconciliación/outbox y escrituras atómicas donde sea posible. Probar reinicio del proceso en cada frontera entre persistencia local, push y ACK, así como aceptación parcial de los dos documentos de inventario.

### P1 — Un SQL legado todavía reabre acceso público si se ejecuta por error

[supabase_pairing_setup.sql](../supabase_pairing_setup.sql#L114-L143) otorga CRUD de `sync_documents` a `anon` y crea una policy anónima que autoriza por mera existencia de pairing; también permite lectura pública de pairings. En contraste, [supabase_supervisor_auth_recovery.sql](../supabase_supervisor_auth_recovery.sql#L36-L86) revoca `anon`, restringe lecturas a Auth y permite escribir documentos del primary bajo RLS.

Los scripts de contención y recuperación son mejoras sobre el esquema legado, pero el repositorio conserva ambos modelos y el setup legado no está físicamente bloqueado contra ejecución. Los tests SQL inspeccionados comprueban algunos archivos seleccionados, no el estado efectivo de todas las policies/grants desplegadas ni todos los scripts que pudieran instalarse.

**Impacto:** reaplicar el setup antiguo puede reintroducir acceso anónimo; las policies permisivas de Postgres son aditivas, por lo que una policy permisiva adicional puede ampliar acceso incluso si existe otra restrictiva.

**Recomendación:** marcar inequívocamente el SQL antiguo como obsoleto/no ejecutable; mantener un procedimiento canónico de migración y una consulta post-migración de grants/policies; automatizar análisis de todos los scripts relevantes y validar el estado real con cliente `anon` y sesiones de dos identidades distintas antes de release.

### P1 — El RPC de generar QR permite reclamar un `primary_device_id` sin demostrar identidad server-side de la caja

`generate_pairing_token` recibe `p_device_id` del cliente y comprueba solo que sea un texto con longitud válida. Al insertar, asigna ese valor arbitrario a `primary_device_id` y `owner_auth_id = auth.uid()`: [supabase_supervisor_auth_recovery.sql](../supabase_supervisor_auth_recovery.sql#L139-L182). La RPC no consulta la fila de licencia, la identidad fingerprint validada por frontend ni una asociación server-side que demuestre que ese `auth.uid()` posee la caja. Además, cualquier sesión Auth puede actualizar una fila revocada debido al `OR revoked_at IS NOT NULL` del predicado.

El frontend revalida un fingerprint en [useSecurity.jsx](../src/hooks/useSecurity.jsx#L327-L350), pero esa comprobación no forma parte del límite de confianza de la RPC: un cliente autenticado anónimo puede invocar directamente `generate_pairing_token` con un `p_device_id` arbitrario.

**Impacto:** conocer/obtener el ID de una caja no debe ser suficiente para reclamar su fila, pero el SQL permite reclamar IDs libres o filas revocadas sin comprobar licencia o identidad del primary. Esto puede habilitar toma de pairing por una sesión anónima ajena si conoce el ID y la RPC desplegada coincide con el archivo inspeccionado.

**Recomendación:** autorizar generación desde una identidad server-side comprobada (p. ej. licencia/sesión de device registrada), hacer que reclaim de revocado exija la identidad previa del owner o un procedimiento de recuperación explícito, y probar con dos Auth anónimos que un ID ajeno/no registrado y un pairing revocado no son reclamables. Confirmar primero cuál es la fuente de identidad canónica que producción realmente mantiene.

### P1 — No fue posible conciliar flags publicados, policy local y backend productivo

La política local mantiene las mutaciones generales, la tasa y el egreso a false, y lee ingreso/egreso desde variables Vite: [supervisorPolicy.js](../src/config/supervisorPolicy.js#L1-L16). El listener del receptor se monta si `MUTATIONS`, `INCOME` o `RATE` está activo, pero no incluye el flag de egreso: [App.jsx](../src/App.jsx#L63-L68). Esto parece una limitación de disponibilidad si egress fuese activado solo; no es bypass de seguridad porque el frontend exige que la caja tenga receptor y el servicio de envío valida el flag egress. El servicio de envío tiene flags por capacidad: [supervisorCommandService.js](../src/services/supervisorCommandService.js#L115-L138).

[M5-PRODUCTION-CANARY.md](../M5-PRODUCTION-CANARY.md#L32-L73) dice que el backend productivo permitía ingreso general y que el flag de ingreso estaba true en Production; eso es historial documental y no se confirmó mediante dashboard/connector. El `.env` local no muestra valores configurados, lo que no dice nada concluyente del artefacto publicado. Además, los esquemas base y migraciones incrementales difieren en capacidades; la RPC y trigger de la migración egress-only no son equivalentes al SQL base.

**Impacto:** no puede afirmarse qué comandos están disponibles realmente en usuarios. Un flag frontend es un control UX, no una barrera de autorización; la seguridad efectiva depende de la función y trigger que estén instalados ahora.

**Recomendación:** después de habilitar el acceso de solo lectura, cotejar variables del deployment activo, definición SQL efectiva de RPC/trigger, grants, RLS, publicación Realtime, comandos pendientes y versión del cliente. Registrar timestamp/entorno y resultados sin datos personales. No activar ni cambiar flags como parte de esa inspección.

### P1 — Un comando pendiente puede aplicarse después de revocar el pairing

El trigger productivo autoriza el pairing al insertar el comando, y la RPC `unpair_monitor` marca el pairing revocado, pero no cancela ni expira las filas `pending`: [supabase_supervisor_inventory_egress_production.sql](../supabase_supervisor_inventory_egress_production.sql#L205-L258), [supabase_supervisor_auth_recovery.sql](../supabase_supervisor_auth_recovery.sql#L243-L270). El receptor valida la forma/target/actor de la fila, pero no vuelve a consultar la autorización vigente antes de ejecutar la mutación: [useRemoteCommands.js](../src/hooks/useRemoteCommands.js#L234-L264). El ACK posterior sí exige que el pairing siga activo: [supabase_supervisor_commands.sql](../supabase_supervisor_commands.sql#L277-L310). Por tanto, un comando ya entregado por Realtime puede aplicarse localmente después de la revocación y fallar solo al confirmarlo.

**Impacto:** una autorización revocada puede no detener de inmediato una orden en vuelo; la caja podría mutar stock/productos antes de que el ACK sea rechazado o falle. El TTL reduce la ventana, no elimina la carrera.

**Recomendación:** definir semántica de revocación para comandos pendientes y en vuelo; volver a validar antes de la mutación es útil pero necesita coordinación server-side para eliminar la carrera. Considerar cancelación/revocación de comandos pendientes en la misma transacción que la desvinculación y una comprobación de autorización/estado atómica en el punto de aplicación. Probar ordenamientos intercalados: insertar, entregar, desvincular, aplicar, ACK.

### P2 — El fallback del lock solo protege un tab, no procesos concurrentes

`withLock` usa Web Locks si están disponibles; si no, cae a un mutex en memoria que explícitamente no coordina pestañas: [withLock.js](../src/utils/withLock.js#L22-L40), [withLock.js](../src/utils/withLock.js#L57-L116). El receptor de comandos usa `withLock('pos_write_lock', ...)`: [useRemoteCommands.js](../src/hooks/useRemoteCommands.js#L148-L160). El monitor puede tener otros receptores/mounts según lifecycle y canal.

**Impacto:** dos tabs en navegadores sin Web Locks podrían procesar escrituras simultáneas. La clave durable llega después del procesamiento y no es un lock por comando antes de iniciar. No se verificó un escenario real que lo reproduzca.

**Recomendación:** probar dos tabs en navegadores representativos con Web Locks presente y ausente; introducir exclusión/idempotencia compartida a través de persistencia durable para las mutaciones remotas, sin depender del mutex de memoria.

### P2 — Desconectar el monitor permite terminar localmente aunque la revocación server-side falle

[OwnerMonitorView.jsx](../src/views/OwnerMonitorView.jsx#L403-L433) captura el error del RPC y continúa limpiando el storage, mostrando un toast de éxito. Esto produce estados ambiguos: el monitor queda localmente en la caja inicial pero el pairing en servidor puede seguir activo; la copia remota del monitor podría seguir intentando sync. La ruta de ajustes [PairingManager.jsx](../src/components/Settings/PairingManager.jsx#L248-L275) tiene verificación posterior y da error si sigue vinculado.

La RPC `unpair_monitor` no devuelve explícitamente un resultado de actualización; en caso de no hallar fila lanza excepción, pero el caller de la caja captura ese error y sigue hacia un toast de éxito. La ruta de ajustes del primary sí vuelve a consultar el estado y puede reportar fallo: [PairingManager.jsx](../src/components/Settings/PairingManager.jsx#L248-L275).

**Impacto:** la UI del monitor puede comunicar desconexión satisfactoria sin confirmar revocación del servidor. No se verificó un defecto de autorización en el predicado por ID: el monitor pasa el `primary_device_id` y la RPC también autoriza al `monitor_auth_id` vinculado.

**Recomendación:** no convertir el error del RPC en éxito; devolver/verificar estado final y mantener un error recuperable cuando el servidor no confirme. Añadir pruebas para ambos lados, caller no autorizado, target incorrecto, pairing ya revocado y fallo de red.

### P2 — Regenerar el QR invalida el pairing activo y genera una sesión `pending` sin receptor de sync

Cuando el owner genera otro token en una fila que ya posee, la RPC pone `monitor_device_id = NULL`, `monitor_auth_id = NULL`, `paired_at = NULL` y `revoked_at = NULL`, dejando `owner_auth_id` con el owner: [supabase_supervisor_auth_recovery.sql](../supabase_supervisor_auth_recovery.sql#L147-L164). La policy de lectura de `sync_documents` exige owner **o** monitor Auth, que exista un monitor Auth no nulo y que el pairing no esté revocado: [supabase_supervisor_auth_recovery.sql](../supabase_supervisor_auth_recovery.sql#L76-L92). El monitor antiguo, al dejar de ser el monitor Auth guardado, pierde lectura nueva; el owner no la conserva temporalmente mientras el QR está pendiente.

**Impacto:** regenerar/cancelar pairing interrumpe la sincronización de la caja antes de que un nuevo monitor consuma el QR. La policy de `sync_documents` exige `monitor_auth_id IS NOT NULL` incluso para `owner_auth_id`; `useCloudSync` apaga el sync si no hay monitor. Es un estado de disponibilidad/lifecycle: la fila con token activo está pendiente, no paired.

**Recomendación:** modelar `pending` de forma explícita y decidir si un QR de reemplazo revoca de inmediato o solo tras consumo exitoso. Asegurar que la política de lectura del primary no dependa de que haya un monitor vinculado si la caja debe seguir sincronizando en el intervalo. Probar re-generación, cancelación/expiración y pairing completado.

### P2 — La validación temporal admite `expires_at` bastante posterior a ahora

El SQL limita que el comando expire después de su emisión, que la duración no supere 60 segundos y que no haya expirado todavía; además admite `issued_at` con ±2 minutos: [supabase_supervisor_commands.sql](../supabase_supervisor_commands.sql#L186-L194). No fija `expires_at <= now() + 60 seconds`. Por tanto, una orden con `issued_at` futuro (hasta la tolerancia aceptada) y duración de 60 segundos puede expirar más de dos minutos después de ahora.

**Impacto:** el TTL efectivo no es siempre un minuto medido desde el servidor. El receptor vuelve a validar localmente, pero su reloj puede estar desfasado: [supervisorContracts.js](../src/services/supervisorContracts.js#L158-L186).

**Recomendación:** medir TTL contra el reloj del servidor y establecer un límite absoluto de expiración futuro con tolerancia documentada; cubrir issuedAt futuro/pasado, latencia, frontera exacta y reloj cliente desfasado mediante tests SQL/staging.

### P2 — El pull inicial y la recuperación de push pueden competir

En [useCloudSync.js](../src/hooks/useCloudSync.js#L383-L423) se activa sync y se lanza `forceSyncAllPOSData` en segundo plano sin esperarlo; a continuación comienza pull remoto. Más tarde hay un bucle que intenta re-subir claves locales: [useCloudSync.js](../src/hooks/useCloudSync.js#L443-L455). La lógica usa hashes para evitar algunas subidas y las rutas aplican envelopes/watermarks, pero el orden concurrente puede ser difícil de razonar si el dispositivo conserva cambios locales no enviados y existe una versión cloud divergente.

**Impacto:** potencial sobrescritura de snapshot o elección de versión no intencionada al iniciar, importar backup o reconectar. No se estableció una pérdida reproducible en esta auditoría.

**Recomendación:** probar escenarios con versiones local/cloud distintas, backup importado, caída de red y arranque simultáneo; definir política explícita de conflicto por clave y serializar la reconciliación antes de activar writes normales.

### P2 — Los E2E del Supervisor no verifican pairing/RLS/revocación en sistema real

Las E2E de lectura se omiten sin `SUPERVISOR_E2E_ENABLED`; la prueba M3 requiere entorno controlado: [supervisor-readonly.e2e.spec.js](../tests/e2e/supervisor-readonly.e2e.spec.js#L1-L44), [supervisor-m3.e2e.spec.js](../tests/e2e/supervisor-m3.e2e.spec.js#L1-L48). La prueba general de separación navega dos páginas y verifica URLs, sin afirmar las vistas separadas ni estado Auth: [supervisor.e2e.spec.js](../tests/e2e/supervisor.e2e.spec.js#L18-L44). La prueba staging de comandos también está skip por defecto y modifica fixtures sintéticos por Management API cuando se habilita: [supervisorStagingCommands.test.js](../tests/supervisorStagingCommands.test.js#L1-L18), [supervisorStagingCommands.test.js](../tests/supervisorStagingCommands.test.js#L85-L104).

**Impacto:** los 82 tests verdes ejecutados cubren contratos/guardrails locales, no prueban el proyecto desplegado, políticas reales, Auth anónimo configurado, dos cuentas aisladas ni aplicación de cambios entre dos clientes.

**Recomendación:** E2E aislado que compruebe dos sesiones reales sintéticas, caja A/B, RLS cruzada, revocación, reconexión y aplicación exacta de movimiento, asegurando cleanup incluso si falla la preparación. Mantener los E2E deshabilitados en runs ordinarios.

### P2 — El contrato de sync permite un legacy envelope sin timestamp y bloquea futuras escrituras por watermark

`readSyncEnvelope` permite documentos legacy `{ payload }` con `updatedAt = null`; `isNewerSyncDocument(null, previous)` solo lo acepta si no hay watermark previo: [supervisorSyncService.js](../src/services/supervisorSyncService.js#L22-L58). Tanto primary como monitor persisten el watermark únicamente cuando viene timestamp: [useCloudSync.js](../src/hooks/useCloudSync.js#L211-L231), [useMonitorSync.js](../src/hooks/useMonitorSync.js#L88-L117). Si un cliente legacy escribe sin `updatedAt` después de que otro cliente guardó watermark, el envelope puede ser rechazado por obsoleto/repetido indefinidamente.

**Impacto:** durante transición de formatos, datos válidos de un cliente legacy pueden no propagarse al receptor moderno. Es una posible incompatibilidad, no una pérdida reproducida.

**Recomendación:** decidir si se acepta legacy cuando no hay timestamp fiable, asignar una versión/orden de migración controlada, o rechazarlo con recuperación explícita en vez de aceptación ambigua. Añadir tests de intercambio legacy↔versionado con watermark existente.

### P3 — Deuda del gate local

La verificación local produjo 0 errores y 170 warnings de ESLint en el alcance supervisado; typecheck pasó. Build pasó, con chunk `groq` vacío y un chunk de más de 500 kB. Son advertencias, no pruebas de defecto funcional en este alcance, pero dificultan advertir regresiones nuevas.

## Controles positivos observados

- `ensureSupervisorSession` crea/recupera Auth anónimo y devuelve errores sin inventar una sesión: [supervisorAuth.js](../src/services/supervisorAuth.js#L1-L38).
- El token de pairing es largo, hashado, temporal y de un uso en el SQL endurecido.
- El modelo de comandos tiene tabla RLS, RPC `SECURITY DEFINER` con `search_path` fijo, allowlist de tipos, validación de payload y TTL, identidad del actor, ACK y clave primaria para `command_id`: [supabase_supervisor_commands.sql](../supabase_supervisor_commands.sql#L22-L84), [supabase_supervisor_commands.sql](../supabase_supervisor_commands.sql#L87-L125), [supabase_supervisor_commands.sql](../supabase_supervisor_commands.sql#L255-L319).
- La sincronización valida allowlist, envelope versionado y tipos antes de aplicar snapshots: [supervisorContracts.js](../src/services/supervisorContracts.js#L29-L56), [useMonitorSync.js](../src/hooks/useMonitorSync.js#L78-L117).
- La política de mutaciones generales, tasas y egresos está cerrada por defecto en el código local. El estado del flag de ingreso productivo no fue comprobable aquí.
- Gestión remota de PIN/usuarios queda explícitamente bloqueada en el SQL base y la caja rechaza esos comandos.

## Checks ejecutados

| Check | Resultado |
|---|---|
| `bun run test:supervisor` | **82 passed, 1 skipped**; la prueba omitida es el harness de staging. |
| `bun run lint:supervisor` | Terminó con **0 errores, 170 warnings**. |
| `bun run typecheck` | Pasó. |
| `bun run build` | Pasó; warning de chunk vacío `groq` y chunk >500 kB. |
| E2E real contra staging/producción | No ejecutado; requiere entorno configurado/autorizado. |
| Estado Supabase efectivo | No inspeccionado; el MCP no estaba aprobado/habilitado. |
| Git | Checkout con conflictos preexistentes `UU` y modificaciones staged no relacionadas; no se alteró. |

## Cierre y próximos pasos recomendados

1. Corregir y probar la semántica de desconexión/revocación y retención local.
2. Hacer durable y atómica la idempotencia de comandos antes de ACK; probar crash/replay y upserts parciales.
3. Establecer una sola secuencia SQL vigente y desactivar el setup legado como artefacto ejecutable.
4. Con acceso read-only aprobado, cotejar producción: flags activos, RPC/triggers reales, RLS/grants efectivos, publicación Realtime y comandos pending.
5. Validar que el receptor no aplique comandos que se insertaron antes de revocar el pairing.
6. Probar la RPC de generación con una sesión anónima distinta contra IDs de caja ajenos, libres y revocados.
5. Ejecutar E2E de staging sintético de dos clientes con aislamiento, re-pairing, revocación y falla de red.
6. Endurecer TTL y probar concurrencia del pull inicial y múltiples tabs.

**Conclusión:** el diseño local contiene mejoras sustanciales frente al modo inicial, pero el informe de producción sigue inconcluso. No se debe inferir que un build o una suite unitaria prueban la configuración Supabase desplegada o la destrucción de copias locales.
