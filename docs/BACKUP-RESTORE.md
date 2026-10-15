# Respaldo y Restauración — Caminos, Estado Real y Solución de Problemas

> Estado documentado: 2026-10-15, tras la auditoría de producción y la
> activación del camino automático comprimido para licencias permanentes.

---

## Resumen ejecutivo

| Camino | Estado en producción | Cuándo usarlo |
| :--- | :--- | :--- |
| **1. Archivo (export/import JSON)** | ✅ **Funciona hoy** — verificado round-trip completo | Respaldo diario del negocio, migración entre equipos, emergencia |
| **2. Nube directa (dispositivo ↔ `cloud_backups`)** | ✅ **Camino operativo** — payload completo comprimido; requiere licencia permanente activa y sesión del dispositivo | Backup automático y sincronización manual |
| **3. Relay Estación Maestra** | 🟡 **Fallback disponible** — depende del despliegue de Estación Maestra | Recuperación cuando RLS bloquee la ruta directa |

**Recomendación operativa hoy:** las cuentas con licencia permanente activa
pueden usar el backup automático comprimido hacia `cloud_backups`. Las demás
cuentas conservan únicamente el backup local y el export/import de archivo.
El Storage privado dedicado queda como segunda etapa; no bloquea el camino
actual.

---

## Camino 1: Archivo (export / import JSON) — ✅ Funciona hoy

**UI:** Configuración → Sistema → *"Exportar Backup"* / *"Importar Backup"*.

### Flujo de exportación
1. `useDataImportExport.handleExport` recolecta el payload canónico
   (`IDB_KEYS` + `LS_KEYS` de `src/config/backupKeys.js`).
2. Descarga `backup_tasasaldia_completo_YYYY-MM-DD.json`.

### Flujo de importación
1. `handleFileChange` **valida antes de borrar** (BACKUP-002): rechaza JSON
   inválido, v2.0 sin `data.idb` o backups vacíos. Si la validación falla,
   el dispositivo **no** pierde nada.
2. Limpieza selectiva (`clearAppKeysForRestore`): solo claves del catálogo,
   preservando `PROTECTED_KEYS` y la sesión de Supabase.
3. Restauración directa a localforage/localStorage + flag
   `pda_backup_imported_flag` para re-sincronizar a la nube tras recargar.

### Verificación
- Round-trip probado en `tests/backupRestore.test.js` (export → clear →
  import → datos bit a bit, incluidos decimales de granel).
- Legado pre-2.0 compatible.

---

## Camino 2: Nube directa (dispositivo ↔ `cloud_backups`) — ✅ Operativo

**UI:** Configuración → Sistema → *"Sincronizar con la Nube"*.

### Cómo funciona
1. `handleSyncCloud` establece sesión (`ensureSupervisorSession`) y registra
   la identidad del dispositivo en `device_sessions`
   (`ensureDeviceSessionRegistered`).
2. El backup automático solo continúa si la licencia local confirmada es
   `permanent` y está activa. Demo, mensual, vencida o sin licencia se detienen
   después de guardar la copia local.
3. Se genera el payload completo y se comprime con gzip+base64 antes de guardarlo
   en `cloud_backups.backup_data`.
4. Lectura de `cloud_backups` para el `pda_device_id` propio:
   - Nube con datos + dispositivo vacío → **restauración automática**.
   - Ambos con datos → **resolutor de conflictos** (elegir nube o local).
   - Nube vacía → sube el payload completo comprimido (gzip+base64).
5. Escritura vía `buildCloudBackupsRow` (contrato de esquema con allowlist;
   una columna inexistente lanza en desarrollo, no produce PGRST204 en
   producción).

### Requisitos de producción
La producción actual ya contiene las políticas own-row de `cloud_backups`,
`sync_documents` y `device_sessions`. La aplicación intenta usar la RPC
`register_device_session` y conserva un fallback compatible con instalaciones
anteriores que todavía no la tengan.

Si una instalación no tiene estas políticas, aplicar
`supabase/migrations/001_device_own_row_rls.sql` (idempotente):
- Tabla puente `device_sessions` (`device_id` ↔ `user_id` de la sesión
  anónima, con reclaim si la sesión se regenera).
- Políticas own-row (insert/update/select) para `cloud_backups` y
  `sync_documents`; el monitor del dueño conserva lectura vía
  `device_pairings`; DELETE queda solo para service_role.

```bash
supabase db push          # o pegar el SQL en el SQL Editor del proyecto
```

El registro recomendado de sesión está en
`supabase/migrations/20261015_supervisor_device_session_registration.sql`.
La restricción de servidor para aceptar únicamente licencias permanentes está
en `supabase/migrations/20261015_backup_permanent_license_rls.sql` y debe
aplicarse antes de publicar el backup automático para usuarios finales.

---

## Camino 3: Relay Estación Maestra — 🟡 Fallback

**Endpoint (lado Estación Maestra):** `src/app/api/backup/relay/route.ts`
- `POST { deviceId, backup_data }` → upsert en `cloud_backups` con
  service-role (bypasea RLS), mismo patrón que `api/backup/complete`.
- `GET ?deviceId=...` → devuelve `backup_data` de la fila.
- CORS abierto (`*`), normalización y validación de `deviceId`.

**Cliente (lado bodega):** `src/utils/backupRelay.js`
- URL base: `VITE_ESTACION_API_URL`. El default `https://estacion-2026.vercel.app`
  **solo aplica en builds de producción**: en dev/pruebas sin env configurado la URL
  queda vacía y el relay se salta (ningún entorno de prueba toca el backend real).

### Cuándo entra en juego
`useCloudBackup` lo usa **automáticamente** como fallback:
- **Escritura:** si la directa falla con 42501 → reintenta por relay.
- **Lectura:** si la directa devuelve error RLS **o 0 filas** (bloqueo
  silencioso) → sondea el relay antes de concluir que la nube está vacía.

> El sondeo por lectura vacía es deliberado: un SELECT bloqueado por RLS no
> lanza error, y sin el sondeo la app sobrescribiría un respaldo real de la
> nube creyendo que no existe.

### Activarlo
Desplegar la Estación Maestra a Vercel (el route viaja con el build). Nada
más: la app lo detecta y registra en consola
`[CloudBackup] Escritura realizada vía relay de Estación Maestra (RLS).`

---

## Diagnóstico de errores (UI)

Todo error de nube se clasifica en `src/utils/cloudError.js` y se muestra en
**Configuración → Sistema** con título, causa, acción recomendada y detalle
técnico (además del toast):

| Código | Significado | Acción sugerida |
| :--- | :--- | :--- |
| `42501` | RLS bloquea al dispositivo | Exportar archivo como respaldo inmediato; aplicar migración o usar relay |
| `PGRST204` | Columna inexistente (drift de esquema) | Actualizar app / migración en la base |
| `NETWORK` | Sin conexión con Supabase | Revisar internet |
| `401/403` | Sesión/credenciales inválidas | Reiniciar app para renovar sesión |

## Herramientas de verificación

```bash
npx vitest run tests/backupRestore.test.js     # round-trips de ambos caminos
npx vitest run tests/cloudSchemaContract.test.js  # contrato de columnas (PGRST204)
node scripts/check_cloud_schema.mjs            # drift real vs allowlist (OpenAPI)
node scripts/e2e_upload.mjs                    # arnés E2E (requiere .env de Estación Maestra)
```

## Preguntas frecuentes

**¿El backup local automático (`bodega_autobackup_v1`) sirve para restaurar?**
Sí — `restoreFromBackup()` (emergencias) valida, aplica con anti-eco y activa
la re-sincronización. Se guarda cada 30 min en el propio dispositivo.

**¿Compartir por código de 6 dígitos es un backup?**
Es transferencia puntual (24 h, `api/share` en Vercel + Upstash), no
respaldo histórico. Al importar activa la re-sincronización a la nube.

**¿Qué pasa si dos dispositivos suben con el mismo `device_id`?**
Se sobrescriben entre sí por diseño (una fila por dispositivo,
`onConflict: device_id`). El dispositivo es la unidad de respaldo, no el
usuario.
