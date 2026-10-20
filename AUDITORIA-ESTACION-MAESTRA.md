# Auditoría · Estación Maestra

**Fecha:** 2026-10-19
**Alcance:** `../estacion-maestra` (Next.js 16 · App Router · Supabase · Vercel) — 62 archivos fuente, ~8.500 líneas
**Método:** lectura de la totalidad de `src/` (rutas API, lib, middleware, componentes), `package.json`, migraciones SQL, `.gitignore`, historial git reciente y contraparte POS (`src/utils/backupRelay.js`, `src/utils/backupStorageUpload.js`, `src/config/cloudSchema.js`).

---

## Verificaciones automatizadas

| Check | Comando | Resultado |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | ✅ **0 errores** |
| Lint | `npx eslint .` | ⚠️ **0 errores, 49 warnings** |
| Tests | — | ❌ **No existe suite** (no hay `tests/`, ni `*.test.*`, ni `vitest`/`jest`/`playwright` en `package.json`) |
| Build | `npm run build` | ⚠️ no ejecutado (requiere variables de entorno del deploy) |

> **Dato clave:** `tsc` en verde no valida comportamiento. Los planes de `docs/plans/` prometen tests
> (`estacion-maestra/tests/backupAssignment.test.ts`, `backupUpload.test.ts`, `backup-storage-route.test.ts`,
> `backup-download-route.test.ts`) y **ninguno existe en el repo**.

---

## 🔴 CRÍTICO

### CRIT-01 · El panel administrativo está completamente abierto (sin autenticación)

**Archivos:** `src/middleware.ts:15-26`, `src/lib/auth-context.tsx:20-37`, `src/app/page.tsx:48-54`
**Introducido por:** commit `ae47e4e` — *"feat(auth): deshabilitar PIN de acceso para ingreso directo sin barrera"*

Tres cosas se combinan y dejan el panel sin puerta:

1. `middleware.ts` **ya no verifica la cookie de sesión**. Solo redirige `/login` → `/` y devuelve
   `NextResponse.next()` para todo lo demás. Su propio comentario dice *"Todo lo demás: exige cookie de
   sesión firmada válida; si no → /login"* — **el código no hace eso**. Documentación y código se contradicen.
2. `auth-context.tsx:27` inicializa `user` con `defaultAdminUser` fijo, así que el cliente cree estar
   autenticado desde el primer render sin pedir nada al servidor. `login()` no llama a `loginAction`.
3. `LoginView` **no se usa en ninguna parte** del proyecto (grep: 0 referencias fuera de su propio archivo).

**Impacto:** cualquiera que adivine la URL del deploy obtiene acceso de superadmin y puede, vía server
actions de `src/lib/actions.ts` (todas **sin guardia**, ver CRIT-02):

- leer todas las licencias, dispositivos, mensajes (con teléfonos) y visitas;
- **crear, modificar, revocar y borrar licencias** (`createOrUpdateLicense`, `revokeLicense`, `deleteLicense`);
- **descargar el respaldo completo de cualquier negocio** (`getBackupData`);
- forzar respaldos y comandos de recarga remotos sobre los POS en campo.

**Remediación:**
1. Restaurar el gate en `middleware.ts` (o, mejor, en `layout.tsx` / Server Components) contra
   `verifySession(cookie, ADMIN_SESSION_SECRET)`, fail-closed si el secreto falta.
2. Eliminar `defaultAdminUser` de `auth-context.tsx`; `user` debe empezar en `null` y poblarse desde
   `getSessionUser()`.
3. Registrar `LoginView` en `app/login/page.tsx` y retirar el redirect `/login → /`.
4. Añadir un test E2E que afirme: sin cookie → `/` redirige a `/login`.

---

### CRIT-02 · Ninguna server action de `actions.ts` exige sesión

**Archivo:** `src/lib/actions.ts` (18 acciones exportadas)

`getLicenses`, `createOrUpdateLicense`, `updateLicenseAlias`, `revokeLicense`, `deleteLicense`,
`getBackups`, `getBackupData`, `requestBackup`, `requestAllBackups`, `getPendingBackupRequests`,
`getFailedBackupRequests`, `sendRemoteReloadCommand`, `getDevices`, `updateDeviceAlias`,
`getDashboardStats`, `getDashboardData` — **ninguna** llama a `requireSessionEmail()`.

En Next.js App Router las server actions son endpoints HTTP invocables directamente, no funciones
privadas del cliente. La seguridad **no puede** residir solo en ocultar el botón.

En cambio, las rutas `api/backup/device-credential` y `api/backup/storage/versions` **sí** hacen
`requireSessionEmail()` — hay criterio y estándar en el repo, solo no se aplicó en `actions.ts`.

**Remediación:** añadir al inicio de cada acción mutadora (y de las que filtran datos personales) un
guardia `if (!(await requireSessionEmail())) throw new Error("No autorizado");`. Idealmente un wrapper
`requireAdmin(fn)` para no repetirlo 18 veces.

---

### CRIT-03 · `getBackupData` descarga el dump completo de cualquier negocio sin control de acceso

**Archivo:** `src/lib/actions.ts:459-469`, llamado desde `src/components/views/backups-view.tsx:256`

```ts
const { data, error } = await admin.from("cloud_backups")
  .select("backup_data").eq("id", backupId).single();
return decompressBackupData(data?.backup_data || null);
```

Con `getSupabaseAdmin()` (service-role, bypasea RLS) + sin sesión = **fuga masiva de datos de clientes**:
ventas, productos, precios, inventario, teléfonos de clientes. Además:

- `backupId` no se valida como UUID.
- `decompressBackupData` (`actions.ts:10-22`) hace `unzipSync` sobre base64 **sin límite de tamaño**:
  una carga corrupta o maliciosa puede agotar memoria y bloquear el event loop (es síncrono) en la
  lambda. Riesgo de DoS sobre el propio panel.

**Remediación:** exigir sesión (CRIT-02), validar UUID, limitar el tamaño del base64 antes de inflar
(usar `zlib.unzip` async con `maxOutputLength`), y auditar `backups-view.tsx` para no exponer la
descarga masiva en la UI.

---

## 🟠 ALTO

### ALTO-01 · `/api/backup/complete` **sobrescribe y destruye** el respaldo real del dispositivo

> ✅ **REMEDIADO (2026-10-19):** la ruta se reescribió como lápida `410 Gone` sin acceso a
> base de datos (ni import de Supabase). Verificado con `next dev` + curl: `POST` → 410 con
> mensaje accionable y CORS correcto, `OPTIONS` → 204. El POS quedó con guardia de
> no-dependencia (`tests/backupCompleteRetired.test.js`).

**Archivo:** `src/app/api/backup/complete/route.ts:42-46`

```ts
await admin.from('cloud_backups').upsert({
  device_id: cleanId,
  backup_data: metadataPayload,   // ← solo { size_bytes, product_count, sales_count, customer_count }
  ...
}, { onConflict: 'device_id' });
```

El contrato del propio POS (`src/hooks/useCloudBackup.js:23`, BACKUP-001) establece que
`cloud_backups.backup_data` guarda el **payload COMPLETO**. Este endpoint hace upsert de esa misma
columna con solo 4 números: si un equipo ya subió su dump y luego se llama a `complete`, **el backup se
pierde de forma irreversible**.

Peor: el commit `a4909cf` documenta *"retiro pendiente de complete"*, es decir, ya se sabe que hay que
retirarlo y **sigue desplegado y accesible**.

**Remediación:** retirar `/api/backup/complete` del despliegue (o al menos devolver `410 Gone`), y usar
las columnas reales creadas por `supabase_backups_summary_columns.sql` en vez de tocar `backup_data`.

---

### ALTO-02 · Discrepancia de esquema: columnas resumen vs. `backup_data->>…`

**Archivos:** `supabase_backups_summary_columns.sql`, `src/lib/actions.ts:411-418`, POS `src/config/cloudSchema.js:5,109`

El SQL crea columnas reales `size_bytes`, `product_count`, `sales_count`, `customer_count` en
`cloud_backups` para evitar traer el JSON entero (optimización de egress). Pero:

- `getBackups()` sigue leyendo `backup_data->>size_bytes` (path JSON), **no** las columnas.
- El POS (`cloudSchema.js`) dice explícitamente que `size_bytes` **no es escribible** porque "no existe",
  luego el POS **no** puebla esas columnas.

Resultado: columnas creadas, nadie las escribe, nadie las lee. La optimización está a medias y
`getBackups()` sigue dependiendo de la forma interna de `backup_data`, que es justo lo que rompe
ALTO-01.

**Remediación:** unificar — que el POS escriba las columnas reales (añadirlas a `CLOUD_BACKUPS_WRITABLE`),
que `getBackups()` lea esas columnas, y que `backup_data` sea exclusivamente el dump.

---

### ALTO-03 · `relay` acepta sobrescribir el backup de **cualquier** deviceId con un solo secreto compartido

**Archivos:** `src/app/api/backup/relay/route.ts:33-63`, `src/app/api/backup/_lib/backup-auth.ts`

`/api/backup/relay` (POST y GET) se autentica solo con `x-backup-secret`, un secreto **compartido por
todos los POS**. Con él se puede escribir o **leer** el `backup_data` de cualquier `device_id`.

Mientras tanto, `/api/backup/storage/upload` **sí** exige credencial por dispositivo
(`x-device-credential`, SHA-256, migración 004) — el patrón correcto ya existe en el repo pero no se
aplicó al relay.

**Remediación:** exigir `x-device-credential` también en `relay`, o retirar el relay (ya es "fallback
resiliente" según su propio comentario tras aplicar `001_device_own_row_rls.sql`).

---

### ALTO-04 · Identidad y revocación de sesión débiles

**Archivos:** `src/lib/session.ts`, `src/lib/auth-actions.ts:26-40`

- `logoutAction` solo borra la cookie: **no invalida el token**. Una cookie robada vive sus 12 h
  completas (no hay `jti` ni lista negra).
- El throttle anti-fuerza bruta vive en un `Map` **en memoria por instancia**. En Vercel (serverless)
  no sobrevive entre lambdas ni entre instancias: 10 intentos / 10 min por IP es ilusorio en producción.
- `getSessionUser` devuelve `{ email: "admin", name: "Luiggi Beraldi" }` hardcodeado; `ADMIN_IDENTITY`
  no es un email, contra el tipo `AdminSessionUser.email: string`.
- `signSession` no incluye `iat`/`jti`/versión de clave: al rotar `ADMIN_SESSION_SECRET` todas las
  sesiones caen de golpe sin aviso (aceptable, pero conviene documentarlo).

**Remediación:** throttle en KV/Postgres (o en el proxy de Vercel), `jti` + revocación por logout,
y `getSessionUser` derivado del payload real.

---

### ALTO-05 · Timeout de 5 s global aplica a subidas/descargas de hasta 50 MB

**Archivo:** `src/lib/supabase.ts:8-26, 29-33, 43-51`

`fetchWithTimeout(..., 5000)` se inyecta en **ambos** clientes, incluido `getSupabaseAdmin()`. Un
respaldo puede pesar `MAX_UPLOAD_BYTES = 50 MB`; cualquier operación de Storage o de `cloud_backups`
que pase por esos clientes aborta a los 5 s.

Nota: `buildStorageDeps` (`backup-storage-deps.ts:75`) crea su propio cliente **sin** el wrapper, así
que el upload a Storage escapa al timeout — inconsistencia, no solución.

**Remediación:** timeout corto (5 s) solo para queries de panel; timeout largo (60–120 s) o ninguno
para transferencia de objetos. Unificar criterio en `buildStorageDeps`.

---

## 🟡 MEDIO

| # | Hallazgo | Archivo | Detalle |
|---|---|---|---|
| MED-01 | `storagePathFor: () => ""` es código muerto | `api/backup/storage/upload/route.ts:103`, `lib/backup-upload.ts:15` | Se pasa una función que devuelve `""` y `runBackupUpload` **nunca la invoca** (el path viene del RPC `beginOperation`). Engaña al lector y al tipado. |
| MED-02 | Docstring falso en el endpoint de upload | `api/backup/storage/upload/route.ts:30-37` | Dice *"DESHABILITADO (fail-closed) … el endpoint responde 503"*. El código ejecuta el flujo completo desde `32d1f75`. Comentario desactualizado sobre seguridad = muy engañoso. |
| MED-03 | `unauthorized()` devuelve `corsHeadersFor("*")` | `_lib/backup-auth.ts:37-42` | Pasa el literal `"*"` como origin, que nunca está en el allowlist → `{}`. En un 401 el navegador no puede leer el cuerpo (error CORS opaco). Debe pasar el `Origin` real del request. |
| MED-04 | Allowlist CORS incluye localhost **en producción** | `_lib/backup-auth.ts:22-28` | `localhost:3000/5173/4173` están siempre. Amplía superficie en el deploy productivo; deberían salir de `BACKUP_ALLOWED_ORIGINS` o de `NODE_ENV`. |
| MED-05 | `createOrUpdateLicense` **borra filas de otros productos** | `lib/actions.ts:187-200` | `.delete().eq("device_id", …).neq("product_id","bodega")` y, peor, `.delete().eq("code", code).neq("device_id", deviceId)`: si dos devices comparten sufijo de 8 caracteres, **se borra la licencia de otro cliente**. Código `ACTIV-XXXX-YYYY` derivado solo del deviceId es colisionable. |
| MED-06 | Beacon `/api/track` sin rate-limit | `api/track/route.ts` | Público, escribe IP + ciudad + user-agent sin límite. Vector de spam/llenado de `visits` y tratamiento de datos personales sin control. |
| MED-07 | Cliente Supabase nuevo en cada llamada | `lib/supabase.ts:36-52` + usos en `backup-storage-deps`, `backup-assignment`, `storage/versions` | Sin reutilización de conexión ni de configuración; en serverless genera churn y descarta pooling. |
| MED-08 | `catch {}` silenciados en bloque | `lib/notifications.ts:88,128,149,168,182,195,208`, `api/track/route.ts:43-47` | Fallos reales de esquema/RLS quedan invisibles. Al menos `console.warn` con código de error. |
| MED-09 | 49 warnings de ESLint | `scripts/scrape-*.cjs`, `src/lib/actions.ts:128-209`, `src/lib/auth-context.tsx:7-8,28`, `src/components/views/messages-view.tsx:196` | `console.log` masivos; imports muertos en `auth-context` (`loginAction`, `logoutAction`, `getSessionUser`, `useEffect`, `setIsLoading`) que **confirman** que la auth fue desconectada; `template` sin usar. |
| MED-10 | `runtime` no declarado en `relay` y `complete` | `api/backup/relay/route.ts`, `api/backup/complete/route.ts` | Usan `Buffer`/`timingSafeEqual` de `node:crypto` vía `backup-auth.ts`. Funciona porque el default es Node, pero `device-credential/route.ts:8` sí declara `export const runtime = "nodejs"`. Sin declaración explícita, un cambio de default rompería el deploy en frío. |
| MED-11 | Validación de ruta laxa en `storage/versions` | `api/backup/storage/versions/route.ts:42-45` | `^[a-z0-9/_\-TZ.]+$` incluye `T` y `Z` sueltos (¿intención: timestamps?) y permite `//`. El guard real es `!includes("..")`. Redactar la regex con la forma exacta esperada. |

---

## 🟢 Mejoras (no son defectos)

1. **Tests.** Es la deuda más cara del proyecto: cero cobertura sobre lógica pura testeable
   (`backup-storage.ts`, `backup-entitlement.ts`, `backup-upload.ts`, `backup-assignment.ts`, `session.ts`).
   Esas cinco funciones son puras o con dependencias inyectables — se testean sin levantar Next.
   Objetivo razonable: Vitest + ~25 tests sobre `selectBackupsToDelete`, `buildBackupObjectPath`,
   `evaluateBackupEntitlement`, `readBackupStorageConfig`, `runBackupUpload` (éxito, SHA incorrecto,
   reintento idempotente, cleanup parcial) y `verifySession` (expirada, firma inválida, secreto ausente).
2. **Unificar la emisión de credencial por dispositivo.** `device-credential` requiere sesión (CRIT-01
   la anula). Hoy nadie puede emitir credenciales si el panel está cerrado — definir el flujo de
   emparejamiento real.
3. **`supabase.ts` usa `!` non-null assertion** sobre `NEXT_PUBLIC_SUPABASE_URL`: si falta, el error es
   un `undefined` tardío. Fail-fast con mensaje claro al arrancar.
4. **`products.ts:30`** — TODO abierto: precios oficiales de Pro sin definir. Cerrar o trackear.
5. **Separar `actions.ts` (751 líneas)** en `license-actions`, `backup-actions`, `device-actions`.
   Hoy mezcla CRUD, notificaciones, descompresión de gzip y estadísticas.
6. **Auditoría del `git status`**: 14 imágenes de `product-images/` modificadas sin commitear junto con
   una migración (`docs/migrations/004…sql` pasó de "BORRADOR, NO APLICADO" a "APLICADA EN PRODUCCIÓN").
   Esa nota de migración **sí debe commitearse** (es trazabilidad); las imágenes conviene decidirlas aparte.
7. **Declarar `backup-entitlement.ts` / `backup-storage.ts` como `import type`-only donde aplique**, para
   que el bundle de servidor no arrastre validaciones al cliente.

---

## Plan de remediación sugerido (orden)

| Prioridad | Acción | Esfuerzo |
|---|---|---|
| 1 | CRIT-01 + CRIT-02: restaurar auth en middleware y guardia en las 18 server actions | Medio |
| 2 | CRIT-03: control de acceso + límites de tamaño en `getBackupData` | Bajo |
| 3 | ~~ALTO-01: retirar `/api/backup/complete`~~ ✅ **hecho** (410 Gone + guardia en el POS) | — |
| 4 | ALTO-03: credencial por dispositivo en `relay` (o retirarlo) | Bajo |
| 5 | ALTO-02: unificar columnas resumen POS ↔ Estación | Medio |
| 6 | ALTO-05: timeouts diferenciados | Bajo |
| 7 | ALTO-04: throttle persistente + revocación de sesión | Medio |
| 8 | Serie MED-* + suite de tests | Medio |

---

## Lo que está bien hecho (para no romperlo al corregir)

- `backup-auth.ts`: comparación en tiempo constante, fail-closed si falta el secreto, CORS por
  allowlist con `Vary: Origin`. Patrón ejemplar dentro del repo.
- `device-credential.ts` + `device-credential-store.ts`: hash SHA-256, comparación en tiempo constante,
  revocación por `revoked_at`, devolución única del secreto. Es el estándar al que debería subir `relay`.
- `backup-upload.ts`: orden begin → put → verificar SHA-256 releyendo → finalize → cleanup, con
  idempotencia ante reintento y `failOperation` en cada aborto. Diseño correcto.
- `backup-assignment.ts`: manejo explícito de carrera (`23505`) releyendo el ganador. Bien pensado.
- `backup-storage.ts`: validación del `project ref` esperado, rutas solo con UUIDs, `selectBackupsToDelete`
  con desempate estable. Lógica pura y testeable.
- `session.ts`: Web Crypto (funciona en Node y Edge), HMAC-SHA256, fail-closed.
