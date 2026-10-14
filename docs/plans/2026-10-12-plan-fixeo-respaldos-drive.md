# Plan de fixeo — respaldos completos y verificables en Google Drive

**Fecha:** 12 de octubre de 2026  
**Estado:** supersedido por [plan de respaldo en Supabase Storage con retención de tres versiones](2026-10-12-plan-backups-supabase-storage-3-retained.md); no implementar Drive conforme a este plan anterior.  
**Objetivo:** que un respaldo solicitado se considere exitoso únicamente cuando el archivo correcto haya quedado guardado de forma verificable en Drive, y que el mismo negocio pueda localizarlo, validarlo y restaurarlo sin sobrescribir datos por error.

## 1. Diagnóstico y alcance

### Estado observado en el checkout

- `src/utils/driveBackupUploader.js` envía `{ action: 'upload_backup', deviceId, clientName, backupData }` al Google Apps Script configurado por `VITE_GOOGLE_SCRIPT_BACKUPS_URL` o `VITE_GOOGLE_SCRIPT_URL`.
- La petición usa `mode: 'no-cors'`; el browser recibe una respuesta opaca que no permite comprobar HTTP, respuesta JSON, ID del archivo ni errores de la función remota. El cliente devuelve `{ status: 'submitted' }` al resolverse `fetch`, lo cual acredita envío del request, no persistencia en Drive.
- `src/hooks/useAutoBackup.js` admite ese resultado como truthy. En la vía de solicitud forzada puede posteriormente llamar a `/api/backup/complete`; un 2xx de ese endpoint no prueba por sí solo que exista el archivo en Drive. Puede quedar una solicitud `completed` con carga no confirmada.
- `src/hooks/useCloudBackup.js` trata Drive como copia best-effort y guarda el payload completo en `cloud_backups`; ese respaldo de Supabase es distinto del archivo Drive. Hoy la UI puede informar éxito de nube aunque Drive haya fallado.
- Hay pruebas de estado/reintento con `uploadToGoogleDrive` mockeado y pruebas de compresión/restauración de payload. El E2E general intercepta Google Scripts y no contiene un escenario que suba, recupere o restaure un archivo Drive.
- El código del Google Apps Script no está en este repositorio. El cliente no permite deducir si el script autentica, guarda, actualiza/duplica archivos, valida el esquema, devuelve errores fiables o ofrece descarga.
- El `.env` local contiene la URL de script (no imprimirla ni incluirla en reportes/fixtures); `VITE_ESTACION_API_URL` no está configurada localmente. La URL por defecto del relay se usa solo en build de producción. No usar la configuración local para disparar una carga de datos reales durante el desarrollo.

### En alcance

1. Contrato de carga con confirmación verificable y estado persistido.
2. Idempotencia, reintentos, metadatos y diagnóstico honesto.
3. Descubrimiento/descarga controlada y restauración con validación/confirmación.
4. E2E seguro en entorno y carpeta de pruebas, además de tests unitarios y de contrato.
5. Configuración de Apps Script/servidor, secretos, despliegue y operación documentados.

### Fuera de alcance

- Cambiar el esquema de ventas, caja, inventario u otros datos de negocio.
- Usar una clave `VITE_*` como secreto: toda variable Vite de cliente puede terminar en el bundle y debe considerarse pública.
- Operar sobre Drive de clientes, datos reales, la base de producción o un Apps Script desplegado sin entorno/carpeta de pruebas y autorización explícitos.
- Afirmar que la sincronización Supabase, el relay de Estación Maestra y Drive son el mismo respaldo. Son capas diferentes y cada una necesita estado propio.

## 2. Decisiones que deben cerrarse antes de implementar

1. **Endpoint de confianza:** preferido, un endpoint server-side de Estación Maestra que hable con Drive desde el servidor usando credenciales protegidas. Responde JSON HTTP verificable al cliente. Evitar depender de la respuesta opaca de Apps Script en navegador. Si se conserva Apps Script como backend de Drive, definir antes cómo el servidor lo llama y cómo autentica su respuesta; habilitar CORS por sí solo no arregla necesariamente los redirects y restricciones de `script.google.com`.
2. **Identidad/aislamiento:** confirmar quién es dueño de cada archivo (negocio/dispositivo) y cómo se autoriza lectura, subida y restauración. No confiar en `deviceId` o `clientName` enviados por el browser como prueba de autorización. El endpoint debe autenticar/autorizar antes de acceder a Drive.
3. **Retención:** elegir si se conserva historial de versiones o solo un archivo vigente por dispositivo. Establecer límite de versiones, tamaño, cuota y limpieza aprobada; no borrar backups previos antes de verificar el reemplazo.
4. **Formato:** mantener compatibilidad con el JSON v2 comprimido actual (gzip + base64 donde aplique) y acordar `schemaVersion`, checksum y metadata estable. Confirmar límites reales de Apps Script/API/Drive para cargas grandes.
5. **Experiencia del producto:** diferenciar resultados: `Drive confirmado`, `Drive falló pero copia en nube confirmada`, `solo copia local`, y `ningún remoto confirmado`. La etiqueta “Sincronizar con la Nube” no debe sugerir que Drive está garantizado cuando fue solo Supabase.
6. **Restauración:** confirmar si debe ser desde un archivo elegido por usuario, desde la última versión de Drive, o ambas. El flujo no debe restaurar automáticamente sobre una instalación con datos sin una decisión/confirmación explícita.

## 3. Contrato propuesto para el flujo remoto

### Solicitud de subida

El cliente envía al endpoint autenticado:

```json
{
  "operationId": "uuid idempotente",
  "deviceId": "id validado por sesión",
  "backup": {
    "schemaVersion": "2.0",
    "timestamp": "ISO-8601",
    "encoding": "gzip+base64 | json",
    "payload": "...",
    "sha256": "...",
    "sizeBytes": 123
  }
}
```

El endpoint valida autorización, dispositivo asociado, tamaño, estructura y checksum antes de persistir. El secreto/credencial de Drive se mantiene solo en backend (Secret Manager/variables de servidor), nunca en Vite/browser.

### Confirmación de subida

Éxito HTTP solo si Drive confirmó la creación/actualización del objeto. La respuesta debe incluir como mínimo:

```json
{
  "ok": true,
  "operationId": "uuid",
  "fileId": "id no público",
  "updatedAt": "ISO-8601",
  "sizeBytes": 123,
  "sha256": "...",
  "version": "..."
}
```

Los errores deben incluir un código seguro y reintentable/no reintentable; no devolver stack, secretos ni contenido del backup. Repetir un mismo `operationId` no crea múltiples archivos/operaciones y devuelve el resultado ya confirmado.

### Lectura y restauración

- Un endpoint autenticado lista metadatos de backups autorizados y entrega un archivo por `fileId` validado; no aceptar URLs arbitrarias provistas por el cliente.
- Descargar, comprobar tamaño/checksum, descomprimir, parsear y validar el backup con `validateBackupJson` antes de aplicar cambios.
- Presentar fecha, dispositivo, versión y resumen; si hay datos locales, solicitar confirmación de conflicto y explicar consecuencias.
- Aplicar con el servicio común `applyBackupToStorage` y anti-eco; guardar log/auditoría con resultado sin incluir datos sensibles. Si cualquier validación falla, no borrar ni modificar datos actuales.

## 4. Fases de implementación

### Fase A — Descubrir y congelar contratos

1. Obtener acceso de solo lectura al proyecto del Apps Script y al repositorio/deploy de Estación Maestra; identificar handler `upload_backup`, endpoint `/api/backup/complete`, credenciales, scopes, formato de respuesta y mecanismo de lectura actual.
2. No imprimir URL con token, claves ni archivos de negocio. Registrar solo nombres de variables y estado configurado.
3. Documentar tabla de datos que guarda cada ruta: Drive, `cloud_backups`, `sync_documents`, `backup_requests`; aclarar cuál restaura cada una.
4. Confirmar despliegue y entornos activos; diferenciar configuración local, staging y producción sin ejecutar escrituras.
5. Probar contractualmente el límite de tamaño y determinar patrón estable de archivo/nombre/versiones.

**Gate A:** están identificados código/propietario/deploy de Apps Script y el backend, contratos y entornos; no se asume que algo remoto está disponible por la mera presencia de URL en `.env`.

### Fase B — Endpoint confiable y persistencia Drive

1. Implementar en servidor la autenticación/autorización del dispositivo y acceso a Drive con credenciales server-only; validar el vínculo negocio-dispositivo.
2. Crear una operación idempotente para carga; persistir en Drive antes de responder éxito. Aplicar límites de tamaño y un nombre/metadata estable sin colisiones entre negocios.
3. Asegurar historial/retención según la decisión aprobada; ningún borrado previo a la verificación del nuevo objeto.
4. Añadir endpoint de estado/listado y descarga protegidos. La respuesta no debe exponer una URL pública de Drive que evite autorización; preferir `fileId` opaco y proxy autenticado.
5. Añadir logs operativos con `operationId`, estado y códigos, sin token, payload ni PII.
6. Mantener las rutas actuales de Supabase independientes; registrar resultados por proveedor/copia, no colapsarlos en un único booleano.

**Gate B:** el servidor devuelve acuse solo después de confirmación de Drive; repetir la operación no duplica; otro dispositivo/negocio no puede leer ni sobrescribir el backup ajeno.

### Fase C — Cliente y UX de estado real

1. Sustituir `src/utils/driveBackupUploader.js` para usar el endpoint verificable, eliminar la falsa semántica `submitted` como éxito y propagar errores estructurados/timeouts.
2. Definir tipos/contrato claros de resultado (`ok`, `operationId`, `fileId`, `updatedAt`, `sizeBytes`, `sha256`, `error.code`, `retryable`). Un `fetch` opaco, respuesta vacía o JSON inválido es fallo/incierto, nunca éxito confirmado.
3. En `src/hooks/useAutoBackup.js`, persistir hash/fecha y marcar `backup_requests.completed` únicamente después de acuse válido de Drive (y de las otras dependencias requeridas por el producto). Fallo o timeout queda `failed`/reintentable y muestra estado preciso.
4. Añadir `operationId` estable a los reintentos para evitar crear varias copias si el servidor guardó el archivo pero se perdió la respuesta. Manejar resultado `unknown` consultando el estado de esa operación antes de repetir.
5. En `src/hooks/useCloudBackup.js`, separar la confirmación Drive de Supabase/relay. El toast debe especificar qué copias quedaron guardadas; preservar respaldo Supabase si Drive falla, pero no prometer respaldo externo completo.
6. Incorporar lectura/restauración desde Drive conforme a Fase 2. Validar y pedir confirmación antes de sobrescribir; no reutilizar `drive_url` como fuente sin validar autorización y contenido.
7. Añadir mensajes accesibles de progreso/fallo/último backup confirmado, tamaño y fecha; errores recuperables tienen acción concreta. No mostrar éxito antes del commit remoto.

**Gate C:** manual y automático usan el mismo resultado verificable; fallos no se convierten en completed ni se pierden tras recarga; el estado de Drive y el de nube quedan diferenciados.

### Fase D — Tests deterministas de cliente, backend y contrato

Pruebas unitarias de `driveBackupUploader`:

- URL/endpoints no configurados: no se hace request ni se informa éxito.
- HTTP 2xx con acuse válido: devuelve metadata exacta y estado confirmado.
- `no-cors`/respuesta opaque, cuerpo vacío/JSON inválido, 4xx, 5xx, error de red, timeout y checksum inconsistente: no se reporta éxito.
- Nombres inválidos, device ID, payload comprimido/raw, Unicode y tamaño máximo.
- Mismo `operationId`: resultado idempotente; fallo temporal sí reintenta con backoff; autorización/schema/size no se reintentan automáticamente.

Pruebas de flujo:

- `useAutoBackup`: pending → Drive confirmado → completed; Drive rechazado/timeout → failed; respuesta perdida tras persistencia → consultar status antes de repetir; error al actualizar completed sigue recuperable.
- `useCloudBackup`: confirmar mensajes/estado cuando Drive falla pero Supabase escribe, y cuando Drive funciona pero Supabase/relay falla. No dar el mismo éxito para ambos casos.
- Restore: backup válido recupera un fixture byte/valor-equivalente; archivo corrupto, checksum/schema incorrecto o no autorizado no cambia nada.
- Backend: autorización, aislamiento multi-dispositivo/negocio, idempotencia, limits, retención y respuesta después de persistencia. Preferir integración contra Drive de pruebas y cuenta restringida.

**Gate D:** tests simulan HTTP y persistencia con contratos completos; mocks no se presentan como evidencia de Drive en producción.

### Fase E — E2E aislado de extremo a extremo

Crear un spec específico, por ejemplo `tests/e2e/drive-backup.e2e.spec.js`, opt-in y deshabilitado por defecto. Configurar `DRIVE_BACKUP_E2E_BASE_URL`, secreto de entorno de CI protegido y dispositivo/negocio `e2e-*` dedicado. No usar variables `VITE_*` con credenciales. Sin configuración explícita, el test se omite con motivo visible o falla la selección del job de forma clara; nunca recurre al servicio real.

Escenario automatizado:

1. Crear/restaurar usuario/dispositivo sintético aislado en backend de staging y preparar carpeta Drive temporal, con identificador de corrida.
2. Sembrar en navegador fixtures deterministas (producto con stock decimal, venta, cliente y config no sensible), guardar fingerprint esperado.
3. Solicitar backup desde la UI/API pública de la app y verificar transición visible a “Drive confirmado”.
4. Consultar endpoint autenticado de estado y comprobar `operationId`, `fileId`, timestamp, tamaño y SHA-256; descargar el archivo por la misma API de lectura que usa restauración y validar checksum/compresión/JSON y fingerprint.
5. Limpiar el storage **solo** del perfil de browser efímero, ejecutar restore; validar los mismos valores en IndexedDB/localStorage tras reload y comprobar que el anti-eco no dispara una subida duplicada.
6. Ejecutar casos de red caída, Drive 5xx, respuesta perdida después del commit, doble evento, credencial expirada, archivo corrupto, usuario ajeno, límite excedido y restore cancelado; ninguno borra datos existentes ni marca falsamente completed.
7. Recoger trace/screenshot/log sanitizados; no guardar export de HAR con headers/tokens ni backup real. El cleanup de la carpeta sandbox debe tener ID de recurso explícito y no poder apuntar a producción.

**Gate E:** el mismo archivo aceptado por el endpoint se descarga y restaura con fingerprint idéntico, y las pruebas negativas prueban que no se sobrescriben datos ni se anuncian éxitos falsos.

### Fase F — Verificación, rollout y observabilidad

1. Suites dirigidas: nuevos tests de uploader/contract/backend, `tests/useAutoBackupRequests.test.jsx`, `tests/backupRestore.test.js`, `tests/backupRelay.test.js`, `tests/cloudSchemaContract.test.js`.
2. `bun run typecheck`, lint dirigido, test suite completa, build, E2E local mocks y E2E remoto opt-in solo contra staging Drive dedicado.
3. Revisar `git diff --check`, diff de cada archivo y estado del checkout compartido; no stagear ni sobrescribir cambios ajenos.
4. Desplegar primero endpoint en staging y probar autorizaciones y restauración. Producción requiere autorización separada; desplegar app/backend no forma parte de este plan.
5. Activar por feature flag/porcentaje tras observar tasa de éxito, latencia, tamaños, errores por proveedor, reintentos, duplicados y restauraciones satisfactorias. Definir rollback que conserve los backups actuales y no borre Drive.
6. Mantener el export/import JSON local como recuperación de emergencia durante transición.

**Gate F:** el rollout no empieza si un backup no puede ser leído/restaurado desde el mismo servicio o si no hay métricas y procedimiento de rollback.

## 5. Matriz de aceptación final

| Acción / condición | Resultado esperado | Evidencia necesaria |
|---|---|---|
| Carga Drive exitosa | ID/fecha/tamaño/checksum confirmados; UI dice Drive guardado | E2E de staging: respuesta autenticada + descarga de ese fileId |
| Rechazo de Drive | No `completed`; error reintentable/no reintentable visible; otras copias se reportan aparte | Tests de 4xx/5xx/red y UI |
| Timeout con estado remoto incierto | Consultar `operationId`; no duplicar ni declarar fracaso definitivo sin reconciliar | Test de commit realizado pero respuesta perdida |
| Backup vacío/corrupto/no válido | No se aplica ni borra almacenamiento local | Test unitario + E2E aislado |
| Restauración | Mismos datos canónicos, tras recarga, con confirmación ante conflicto | Fingerprint antes/después y checksum del archivo descargado |
| Aislamiento | Un dispositivo/negocio no puede leer/restaurar/modificar el de otro | Tests de autorización backend y E2E multi-identidad sintética |
| Backup periódico/request remoto | Completed solo con criterios contractuales verificados; retry idempotente | Estado persistido en backend + suite del hook |
| Pérdida de servicio de Drive | Continúa preservándose otra copia si existe, pero se identifica claramente que Drive falló | Prueba de estado parcial del flujo cloud |

## 6. Riesgos y condiciones de bloqueo

| Riesgo/bloqueo | Impacto | Resolución requerida |
|---|---|---|
| No está disponible el source del Apps Script | No se puede confirmar formato, permisos ni escritura real | Solicitar repo/código o acordar migración a endpoint de servidor mantenido |
| CORS/redirects de Apps Script | Browser no puede observar respuesta; falso positivo posible | No usar `no-cors` como comprobación. Llamada server-to-server preferida |
| Secreto incluido en bundle cliente | Cualquier usuario puede extraerlo y llamar el endpoint | Mover secreto/credencial a servidor; rotar si fue expuesto y revisar logs/historial |
| API de Drive no tiene scope mínimo/permisos | Subidas fallidas o acceso demasiado amplio | Cuenta/carpeta dedicada de staging; scopes mínimos y prueba de aislamiento |
| Límite de tamaño/tiempo de Apps Script | Payload grande truncado, timeout o proceso sin confirmar | Medir payload representativo, imponer límite, considerar upload resumible o dividir versiones si aplica |
| Diferentes copias se llaman “nube” indistintamente | Operador cree tener una copia que no existe | Estado UI por destino y copy confirmado; documentación operacional |
| Request se confirma pero Drive falla luego | Falsa durabilidad | Reordenar el commit de estado después del resultado persistido; reconciliar operaciones ambiguas |

## 7. Seguridad de ejecución y aprobación

- Ninguna etapa debe escribir en Google Drive/Supabase de producción como parte de pruebas locales.
- No ejecutar `scripts/e2e_upload.mjs` contra credenciales reales: ese script hace upsert con service-role a `cloud_backups` y `sync_documents` usando un device ID fijo.
- No imprimir ni copiar `.env`; no guardar URL/token/secret en test, fixture, screenshot, log, reporte ni variable Vite pública.
- Cualquier acceso a Drive, creación de carpeta de pruebas, cambio de Apps Script, migración remota, rotación de secretos y deploy requieren que el operador habilite explícitamente el entorno de prueba y autorice esa acción.
- Push/deploy a producción queda fuera de alcance y exige autorización independiente.

## 8. Entregables previstos

1. Contrato versionado de API Drive (upload/status/list/download) y nota de despliegue/credenciales.
2. Cliente uploader sin `no-cors` exitoso por inferencia, con idempotencia y errores tipados.
3. Flujos actualizados de backup manual, automático/request y restauración, con estado parcial Drive/Supabase claro.
4. Tests unitarios/contrato, tests backend y E2E opt-in aislado con fixture sintético y verificación de ida y vuelta.
5. Procedimiento de staging/rollout/rollback/monitoreo; lista explícita de lo aún no verificado en producción.

**Definición de terminado:** un fixture creado por la aplicación se persiste en el Drive de pruebas, el endpoint devuelve un acuse verificable, la misma aplicación recupera y valida ese archivo y lo restaura con datos equivalentes; los fallos no anuncian éxito ni borran el estado vigente. Hasta verificar ese circuito con staging autorizado, el estado de producción debe seguir declarado como no confirmado.
