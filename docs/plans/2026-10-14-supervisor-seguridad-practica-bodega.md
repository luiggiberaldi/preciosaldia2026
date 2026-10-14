# Modo Supervisor: Plan de Seguridad Práctica para Bodega

> **Para el Desarrollador / Agente:** Implementación quirúrgica del Modo Supervisor con conexión directa por WhatsApp, validación por licencia permanente en servidor y modo de solo lectura. El script SQL fue auditado y corregido (v2).

**Meta:** Conectar el celular del dueño a su caja registradora en 1 solo clic desde WhatsApp en menos de 2 segundos, con la seguridad necesaria para una bodega comercial: protegido por licencia permanente, token de un solo uso que se quema al instante, y sin privilegios de borrado ni alteración contable.

**Arquitectura:**
1. **Base de Datos (Supabase):**
   - Tabla `device_pairings` con token hasheado SHA-256, expiración de 30 minutos y `monitor_auth_id` para validar desvinculación segura.
   - `generate_pairing_token(device_id)`: Verifica licencia permanente activa + rechaza si ya hay monitor activo.
   - `pair_monitor_device(token, monitor_id)`: Quema el token, asocia el celular con su `auth.uid()` y devuelve `business_name`.
   - `unpair_monitor(device_id)`: Solo puede ejecutarse por la caja (`is_own_device_row`) o el celular autorizado (`monitor_auth_id = auth.uid()`).
   - Políticas RLS existentes en `001_device_own_row_rls.sql`: el monitor lee `sync_documents` solo de su caja vinculada (política ya en producción — no tocar).
2. **Caja (Frontend POS — Emisor):**
   - [`PairingManager.jsx`](file:///c:/Users/luigg/Desktop/sistemas%20generales/precios%20al%20dia%20final/preciosaldia-bodega/src/components/Settings/PairingManager.jsx): botón WhatsApp, respaldo de copiar enlace y QR desplegable.
3. **Celular (Frontend Supervisor — Receptor):**
   - Hook `useMagicPairing.js` *(pendiente de crear)*: detecta `?pair=TOKEN` en la URL, ejecuta vinculación de fondo, limpia la URL y abre `OwnerMonitorView`.

**Stack:** PostgreSQL 17.6 (Supabase), PL/pgSQL, `pgcrypto`, React 19, Tailwind CSS, Lucide Icons.

---

## Estado del Script SQL

| Archivo | Estado |
|:---|:---|
| [`supabase/migrations/20261014_supervisor_seguridad_practica.sql`](file:///c:/Users/luigg/Desktop/sistemas%20generales/precios%20al%20dia%20final/preciosaldia-bodega/supabase/migrations/20261014_supervisor_seguridad_practica.sql) | ✅ Auditado y corregido (v2) |

### Correcciones aplicadas (v2)

| ID | Descripción | Dónde |
|:---|:---|:---|
| **C-1** | `GRANT EXECUTE` restringido a `authenticated` y `service_role`. El rol `anon` no puede ejecutar ninguna función de pairing. | Sección 6 del SQL |
| **C-2** | `generate_pairing_token` rechaza con excepción si ya existe un `monitor_device_id` activo (`revoked_at IS NULL`). Impide sobreescribir un vínculo activo sin desvinculación previa. | Función en sección 3 |
| **C-3** | `unpair_monitor` valida identidad del solicitante: acepta solo la caja (`is_own_device_row()`) o el celular autorizado (`monitor_auth_id = auth.uid()`). Cualquier otro sesión autenticada recibe excepción. | Función en sección 5 |
| **I-1** | `pair_monitor_device` almacena `monitor_auth_id = auth.uid()` y devuelve `business_name` leído de `sync_documents` (o `null` si la caja aún no sincronizó). | Función en sección 4 |
| **O-2** | `unpair_monitor` limpia `token_used_at = NULL` al desvincular para no dejar estado inconsistente. | Función en sección 5 |

---

## Prerrequisito antes de aplicar el SQL

> [!IMPORTANT]
> **Anonymous Auth debe estar habilitado en Supabase.**  
> Dashboard → Authentication → Providers → Anonymous → Enabled.  
> La caja y el celular usan `ensureSupervisorSession()` (ya implementado en [`supervisorAuth.js`](file:///c:/Users/luigg/Desktop/sistemas%20generales/precios%20al%20dia%20final/preciosaldia-bodega/src/services/supervisorAuth.js)) para crear una sesión anónima antes de llamar a las RPCs. Sin eso, `auth.uid()` retorna `NULL` y todas las funciones rechazan la solicitud.

---

## Columnas que agrega la migración

Todas con `IF NOT EXISTS` — seguras en bases de datos que ya tienen parte del esquema.

| Columna | Tipo | Propósito |
|:---|:---|:---|
| `token_hash` | `text` | SHA-256 del token; nunca se guarda en claro |
| `token_expires_at` | `timestamptz` | Expiración del token (30 min desde generación) |
| `token_used_at` | `timestamptz` | Marca de quemado al primer uso |
| `revoked_at` | `timestamptz` | Marca de desvinculación |
| `monitor_auth_id` | `uuid` | `auth.uid()` del celular al momento de vincularse |

---

## Flujo de Seguridad (secuencia de llamadas)

```
CAJA                                    SERVIDOR                        CELULAR
────────────────────────────────────────────────────────────────────────────────
1. ensureSupervisorSession()        →   Supabase Auth anon session
2. generate_pairing_token(deviceId) →   Verifica cloud_licenses
                                        Verifica sin monitor activo [C-2]
                                        Genera token + SHA-256
                                    ←   Devuelve token (texto claro, 1 vez)
3. Construye URL: ?pair=TOKEN
4. Abre WhatsApp con el enlace

                                                                5. Dueño toca el link
                                                                6. ensureSupervisorSession()
                                                                7. pair_monitor_device(token, monId)
                                        Valida auth.uid() [C-1]
                                        Busca token por SHA-256
                                        Verifica licencia activa
                                        Quema token (token_used_at)
                                        Guarda monitor_auth_id [I-1]
                                    ←   { success, primary_device_id, business_name }
                                                                8. Guarda pda_paired_device_id
                                                                9. Abre OwnerMonitorView
5. Realtime detecta paired_at       ←   INSERT/UPDATE evento
6. Muestra "¡Supervisor conectado!"
```

---

## Tareas Frontend Pendientes

### Tarea 1: Servicio Centralizado de Vinculación (`pairingService.js`)

**Archivos:**
- Crear: `src/services/pairingService.js`

**Funciones a implementar:**
```javascript
// Normaliza teléfono venezolano a formato WhatsApp internacional
export function formatWhatsAppPhone(phone)

// Construye la URL completa con el token para enviar por WhatsApp
export function buildPairingWhatsAppUrl({ phone, token, businessName })

// Ejecuta pair_monitor_device vía Supabase y guarda las credenciales locales
export async function executeAutoPairing(token)
```

---

### Tarea 2: Hook de Auto-Vinculación (`useMagicPairing.js`)

**Archivos:**
- Crear: `src/hooks/useMagicPairing.js`
- Modificar: `src/App.jsx`

**Comportamiento:**
1. Al montar la app, detectar si `window.location.search` contiene `?pair=` o `?token=`.
2. Si existe: mostrar overlay *"Conectando con tu caja..."*, llamar a `executeAutoPairing(token)`.
3. Al completar: limpiar URL con `window.history.replaceState`, activar modo monitor.
4. Al fallar (token expirado): mostrar mensaje claro con instrucción *"Pide un nuevo enlace desde la caja"*.

---

### Tarea 3: Rediseño de `PairingManager.jsx` (Experiencia WhatsApp-First)

**Archivos:**
- Modificar: [`src/components/Settings/PairingManager.jsx`](file:///c:/Users/luigg/Desktop/sistemas%20generales/precios%20al%20dia%20final/preciosaldia-bodega/src/components/Settings/PairingManager.jsx)

**Cambios:**
- ❌ Eliminar: lógica del código de reclamo de 10 minutos (`handleCreateClaimCode`).
- ✅ Agregar: campo de teléfono pre-llenado con `localStorage.getItem('pda_business_phone')`.
- ✅ Botón principal verde: **"📲 Enviar enlace a mi WhatsApp"**.
- ✅ Botón secundario: **"📋 Copiar enlace directo"** con feedback visual.
- ✅ Desplegable colapsable: **"📷 Mostrar Código QR"** como alternativa.
- ✅ Estado de espera: *"Esperando que abras el enlace en tu celular... ⏳"*.
- ✅ Detección Realtime cuando el celular se conecta → *"¡Supervisor conectado! ✅"*.

---

## Plan de Pruebas y Despliegue

### Fase 1: Staging (Validación completa)
1. Activar Anonymous Auth en Supabase de Staging.
2. Aplicar `20261014_supervisor_seguridad_practica.sql` en Staging (`tdfcpwctvumbdjmifypd`).
3. Abrir la app conectada a Staging.
4. En Ajustes → Conectar Supervisor → Enviar enlace a WhatsApp.
5. Tocar el enlace desde el celular del dueño.

**Checklist de validación:**
- [ ] ¿El celular entra al monitor sin escribir ningún código?
- [ ] ¿La pantalla de la caja detecta la conexión y se pone verde?
- [ ] Si se intenta generar un nuevo enlace con el monitor ya activo, ¿aparece el error claro *"Ya tiene supervisor conectado"*?
- [ ] ¿Al tocar *"Desvincular"* desde la caja, el celular pierde acceso al instante?
- [ ] ¿Al tocar *"Desvincular"* desde el celular, la caja queda liberada?
- [ ] ¿Un tercero con otro celular (sesión diferente) puede desvincular el monitor? **Debe fallar.**

### Fase 2: Respaldo preventivo de Producción
1. Exportar snapshot de `cloud_licenses` y `device_pairings` de Producción (`sodgzkablshladvbtnes`).
2. Verificar que no haya sincronización activa en curso.

### Fase 3: Producción
1. Activar Anonymous Auth en Supabase de Producción (si no está activo).
2. Aplicar el mismo script SQL probado en Staging.
3. `npm run build` → código de salida 0.
4. Prueba de humo final con la caja real.

> [!CAUTION]
> La migración reemplaza las funciones `generate_pairing_token` y `pair_monitor_device` existentes con `CREATE OR REPLACE`. Cualquier vínculo activo en Producción debe ser re-verificado después del despliegue porque la columna `monitor_auth_id` quedará `NULL` para los vínculos creados antes de esta migración. Estos vínculos siguen funcionando para leer datos, pero la desvinculación desde el celular requerirá re-vinculación.
