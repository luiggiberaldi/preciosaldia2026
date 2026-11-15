# Auditoría · Lógica de licencias (permanentes, demos y mensuales)

**Fecha:** 2026-10-19
**Alcance:** Estación Maestra (`../estacion-maestra`, emisión y gestión) + POS (`preciosaldia-supervisor-production-alignment`, validación en campo)
**Objetivo:** que las tres clases de licencia se lleven de manera correcta y consistente entre ambos lados.

## Verificaciones ejecutadas

| Check | Comando | Resultado |
|---|---|---|
| Tests POS (seguridad/licencia) | `npx vitest run tests/backupEntitlement.test.js tests/security.test.js tests/licenseMonitoringHeartbeat.test.js` | ✅ **35 pasan, 8 skipped** |
| Tests Estación Maestra | `npx vitest run` | ✅ **114/114** |
| Typecheck Estación | `npx tsc --noEmit` | ✅ 0 errores |

Los tests pasan **y aun así hay contradicciones**: dos de los hallazgos están consagrados por tests en ambos lados, cada uno afirmando lo contrario del otro.

---

> ✅ **POLÍTICA UNIFICADA (2026-10-20):** existe un único módulo de política,
> `licensePolicy.js`, idéntico byte a byte en ambos proyectos
> (`src/config/licensePolicy.js` en el POS, `src/lib/licensePolicy.js` en la
> Estación) y anclado por SHA-256 en `tests/licensePolicy.test.js` (41 tests de
> paridad corriendo en los dos lados). Los hallazgos **LIC-03, LIC-04, LIC-06,
> LIC-10 y LIC-12 quedaron resueltos**; el detalle está al final de este documento.

## Mapa actual: quién decide qué

| Concepto | Estación Maestra | POS (campo) |
|---|---|---|
| Tipos válidos | `permanent`, `monthly`, `demo7`, `demo3`, `revoked`, `registered` | idénticos |
| Demo se corta | `deriveStatus`: **+5 días de gracia** | `applyLicenseState`: **seco, sin gracia** |
| Mensual se corta | `deriveStatus`: +5 días de gracia | `applyLicenseState`: +5 días de gracia ✅ |
| Permanente | sin `expires_at` | siempre premium |
| Respaldo remoto | `permanent` **y** `monthly` | **solo** `permanent` |
| Duración demo | `demo3` = 3 d, `demo7` = 7 d | `DEMO_DURATION_MS` = 72 h, escribe `demo3` |
| Precio permanente | **$80** (`products.ts`) / **$50** (plantillas WhatsApp) | **$50** (UI) |

---

## 🔴 CRÍTICO

### LIC-01 · Crear o editar una licencia **borra las licencias de otros productos** del mismo equipo

**Archivo:** `../estacion-maestra/src/lib/actions.ts:186-191`

```ts
// Limpiar cualquier fila duplicada de otro producto para este mismo deviceId…
await admin.from("licenses").delete()
  .eq("device_id", deviceId)
  .neq("product_id", "bodega");   // ← hardcodeado, debería ser `productId`
```

La intención es dejar una sola fila por equipo. El filtro está fijado a `"bodega"` en vez de la variable `productId`, así que el efecto es el opuesto según el producto:

- **Al crear/editar una licencia `bodega`** → borra las filas que **no** son bodega → **destruye la licencia `pro`** del equipo.
- **Al crear/editar una licencia `pro`** → borra las filas que **no** son bodega → **borra las filas `pro` existentes** (incluida la que va a reescribir) y deja intacta la `bodega`. Pierde `id` y `created_at` originales.

Se dispara desde los tres caminos de gestión: **Generar licencia**, **Cambiar tipo de cuenta** y **Registrar pago / Extender** de la vista de suscripciones. Un clic en "Registrar pago" mensual puede borrar la licencia permanente de otro producto del mismo equipo.

**Corrección:** `.neq("product_id", productId)`, o retirar el `delete` y depender de una restricción única `(device_id, product_id)`. Recomendada la segunda: el `delete` es una solución a un problema de esquema que debe resolverse en el esquema.

### LIC-02 · Un `code` repetido borra la licencia de **otro equipo**

**Archivo:** `../estacion-maestra/src/lib/actions.ts:193-199`

```ts
if (code && !code.startsWith("SIN-LICENCIA-")) {
  await admin.from("licenses").delete()
    .eq("code", code)
    .neq("device_id", deviceId);   // ← borra la fila del vecino
}
```

El código se deriva **solo** de los últimos 8 caracteres del `deviceId` (`ACTIV-XXXX-YYYY`). Dos equipos cuyos IDs compartan esos 8 caracteres → al activar uno se **borra la licencia del otro**, sin aviso ni registro.

**Corrección:** no borrar nunca filas ajenas. Si hay colisión de `code`, regenerar con sufijo o fallar con un error explícito al operador. Nunca resolver una colisión de clave única destruyendo datos de un cliente.

---

## 🟠 ALTO

### LIC-03 · Contrato de respaldo contradictorio: la mensual tiene respaldo en el servidor y no en la caja

| Lado | Archivo | Regla |
|---|---|---|
| Estación (elegibilidad) | `src/lib/backup-entitlement.ts:9` | `ELIGIBLE_TYPES = {permanent, monthly}` |
| Estación (solicitar) | `src/components/views/backups-view.tsx:171` | `permanent \|\| monthly` |
| Estación (acciones) | `src/lib/actions.ts:492, 616` | `permanent \|\| monthly` |
| **POS (campo)** | `src/services/backupEntitlement.js:21` | **`type !== 'permanent'` → rechazado** |
| POS (auto backup) | `src/hooks/useAutoBackup.js:144` | *"Backup remoto disponible solo con licencia permanente activa"* |

**Consecuencia:** la Estación manda solicitudes de respaldo a clientes mensuales que **nunca podrán subirlas**. El POS las marca `failed` con el motivo de arriba, y así aparecen en el panel como respaldos fallidos permanentes — el mismo síntoma de las "41 solicitudes zombies" de la bitácora.

El servidor ya valida mensuales (`evaluateBackupEntitlement`), y el propio docstring dice *"Lite de pago"*. El bloqueo está **solo en el cliente POS**, que se escribió antes de existir `monthly`. Y hay un test que lo consagra:

`tests/backupEntitlement.test.js:17` → `['monthly', { type: 'monthly', isActive: true }]` espera `allowed === false`.

**Decisión de negocio pendiente (luigi):** ¿el cliente mensual tiene derecho a respaldo remoto?
- **Sí** → corregir `backupEntitlement.js` para aceptar `permanent | monthly` y **actualizar el test**, que hoy codifica el bug. (Recomendado: el servidor ya lo permite.)
- **No** → corregir el lado Estación: quitar `monthly` de `ELIGIBLE_TYPES`, de `backups-view` y de `actions.ts`.

### LIC-04 · Las demos se cortan en seco en el campo pero con 5 días de gracia en la Estación

**Estación** — `src/lib/actions.ts:25-33`:
```ts
if (expires_at) {
  const graceEnd = new Date(expires_at).getTime() + 5 * 24 * 60 * 60 * 1000;
  if (Date.now() > graceEnd) return "expired";
}
return "active";
```
La gracia de 5 días se aplica a **todo** tipo con `expires_at`, incluidas las demos.

**POS** — `src/hooks/useSecurity.jsx:85-89` y `src/hooks/useLicenseMonitoring.js:61-68`: la demo se corta **seco** en `expires_at` (`Date.now() >= expiresAt` → revocada).

**Consecuencia:** durante 5 días la Estación muestra la demo como **"Activa"** mientras el equipo ya quedó bloqueado. Si luigi consulta el panel para verificar si el cliente sigue adentro, ve un dato falso.

Peor: dentro de la **misma** pantalla de la Estación conviven dos definiciones de "expirada".

| Qué | Definición | Ubicación |
|---|---|---|
| `deriveStatus()` → `status` | con gracia +5 d | `actions.ts:25-33` |
| `isLicenseExpired()` → badge y filtro | **seco** | `licenses-view.tsx:119-123` |

`licenses-view.tsx:343` filtra la pestaña de demos con `isLicenseExpired` (seco) pero el badge de la fila sale de `status` (con gracia) → **una misma licencia puede listar en "Expiradas" mostrando el badge "Activa"**. `demos-view.tsx:160` vuelve a calcular el expirado con el corte seco → tres criterios en dos pantallas.

**Corrección:** la gracia de 5 días es correcta **solo para `monthly`**. `deriveStatus` debe aplicarla condicionalmente:
```ts
const graceMs = type === "monthly" ? 5 * 86_400_000 : 0;
```
y `isLicenseExpired` debe derivar de `status`, no recalcular.

### LIC-05 · "Cambiar tipo de cuenta" convierte una mensual en **permanente de por vida** en un clic

**Archivos:** `../estacion-maestra/src/components/views/licenses-view.tsx:108-113` y `479-489`

```ts
function clampTypeForProduct(type, prod) {
  if (prod === "pro") return "permanent";
  if (type === "demo7") return "demo3";
  if (type === "monthly") return "permanent";   // ← preselecciona Permanente
  return type;
}
```
Al abrir el diálogo sobre una **mensual**, el selector arranca en `Permanente`. Y `handleChangeTypeSubmit` hace `expiresAt = null` para todo lo que no sea demo (línea 479-481) → al guardar, la suscripción **pierde su vencimiento y se vuelve permanente**.

Agravante: el Select de ese diálogo solo ofrece `Permanente` y `Demo` (líneas 1134-1139), **no `Mensual`** → una vez convertida no hay forma de volver desde esa vista; solo se recupera registrando un pago en la vista de suscripciones.

Impacto económico: un clic degrada un cliente de **$15/mes** a **$80 únicos**, y el equipo queda con acceso permanente.

**Corrección:**
1. Añadir `Mensual` al Select (o retirar la opción de cambiar tipo sobre una mensual).
2. Nunca preseleccionar un tipo distinto al actual: `clampTypeForProduct` debe devolver el tipo real o advertir la conversión.
3. Pedir confirmación explícita con el impacto ("pasará de $15/mes a permanente") antes de convertir.

### LIC-06 · El precio de la licencia permanente está en $50 y $80 a la vez

| Dónde | Valor |
|---|---|
| `../estacion-maestra/src/lib/products.ts:33` (`PRODUCT_PRICES.bodega.permanent`) | **80** |
| `../estacion-maestra/src/lib/actions.ts:735` (`totalRevenue` del dashboard) | usa **80** |
| `../estacion-maestra/src/components/views/messages-view.tsx:52,58` (plantillas WhatsApp) | **$50** |
| POS `src/components/Settings/tabs/SettingsTabLicencia.jsx:205,208,215` (UI de venta) | **$50** |

El **estimado de ingresos del dashboard está inflado un 60 %**. Si se usa ese número para reportar, está mal.

**Corrección:** unificar el precio real en `PRODUCT_PRICES` (hoy el anunciado es $50) y, mejor, derivar los textos de venta de esa constante en vez de repetir el número en cuatro sitios.

---

## 🟡 MEDIO

| # | Hallazgo | Archivo | Detalle |
|---|---|---|---|
| LIC-07 | `handleExtend` de demos **convierte `demo3` en `demo7`** | `demos-view.tsx:175-181` | Guarda siempre `type: "demo7"` y +7 días, aunque la demo original fuera de 3 días. La etiqueta y el badge de duración cambian sin que el operador lo pida. |
| LIC-08 | Se puede crear una `demo3` que dura 7 días | `licenses-view.tsx:414-415, 996-1000` | `formDays` es libre (default 3) pero el tipo se guarda como `demo3` pase lo que pase. |
| LIC-09 | Barra de progreso de demos con porcentajes imposibles | `demos-view.tsx:310-311` | `demoDurationDays = demo3 ? 3 : 7` no coincide con la duración real guardada → `daysRemaining / 3` supera el 100 %. Debe calcularse desde `createdAt`/`expiresAt` reales. |
| LIC-10 | `monthly` sin `expires_at` = **premium para siempre** | POS `useSecurity.jsx:101-103` | `else { isPrem = true; }`. Si una mensual llega sin fecha, nunca vence. Latente mientras el campo sea obligatorio, pero es un fallo abierto. |
| LIC-11 | `monthsPaid` es un número fabricado | `subscriptions-view.tsx:127` | `Math.floor((now - createdAt)/30d)` = antigüedad, no pagos. Un cliente que pagó 2 de 5 meses se muestra con "5 meses pagados". Es dato visible en la UI. |
| LIC-12 | `Math.ceil` en días restantes infla al alza | `actions.ts:135`, POS `useSecurity.jsx:99` | Una demo que expira en 2 minutos muestra "1 día"; el último día de gracia muestra "1 día" con 5 minutos por delante. Debe ser `Math.floor`. |
| LIC-13 | "Por expirar" sobre algo ya vencido | `licenses-view.tsx:131-139` | `statusBadge` usa 24 h (demo) / 7 días (resto) sobre `expiresAt`, pero `deriveStatus` sigue devolviendo `active` con la gracia → badge "Por expirar" o "Activa" para una mensual vencida hace 3 días. Se resuelve con LIC-04. |
| LIC-14 | `backups-view` pide respaldo a clientes vencidos | `backups-view.tsx:171` | Filtra `l.status === "active"`, que con LIC-04 incluye vencidos hace <5 días → la Estación solicita respaldo a quien ya no paga. Se resuelve con LIC-04. |
| LIC-15 | `cloud_licenses.is_active` es un espejo que nadie mantiene | `actions.ts` (`createOrUpdateLicense`) | `revokeLicense` lo recalcula mirando todas las licencias del equipo; `createOrUpdateLicense` escribe `is_active` con el valor de **esa** licencia. Dos productos activos → el espejo queda con el de la última escritura. Hoy nada lo lee para decidir, pero es una trampa. |
| LIC-16 | `PRODUCT_PRICES.pro = { permanent: 0, monthly: 0 }` | `products.ts:32-34` | Con Pro pausado el dashboard suma $0 por cliente Pro. TODO abierto en el propio archivo. |
| LIC-17 | `getDemos` filtra con `isDemoType` pero muestra `status` con gracia | `actions.ts:126-153` | Se combina con LIC-04: la vista de demos cuenta expiradas con el corte seco (`demos-view.tsx:160`) y lista con el corte con gracia. |

---

## ✅ Lo que está bien y no hay que tocar

- **`revokeLicense` y `deleteLicense`** (`actions.ts:339-399`): scoped por `product_id`, y `cloud_licenses` (que es metadata global del equipo) solo se toca si no queda ninguna licencia en ningún producto. Bien pensado.
- **Gracia de 5 días en `monthly`**, consistente en ambos lados (`useSecurity.jsx:90-103` ↔ `actions.ts`).
- **`applyLicenseState` con `expiresAt` obligatorio para demos** (`useSecurity.jsx:86`): una demo sin fecha no da acceso. Fail-closed correcto.
- **`useDemoCountdown`** (HOOK-039): callback en ref para evitar stale closure en el intervalo de 60 s.
- **`useAutoBackup`: la nube exige licencia permanente activa y `forceUpload` no salta la regla** (`useAutoBackup.js:142-144`) — bien como guarda, aunque su parámetro se llama `isPermanentLicense` y en realidad recibe un entitlement de respaldo (véase LIC-03).
- **Normalización de `deviceId`** (`createOrUpdateLicense:172`): sin espacios, mayúsculas — igual que en el POS.

---

## Plan de corrección (orden sugerido)

| Prioridad | Acción | Hallazgo | Riesgo de la corrección |
|---|---|---|---|
| 1 | Cambiar `.neq("product_id","bodega")` por `productId` (o eliminar el `delete`) | LIC-01 | **SIGUE ABIERTO** · evita pérdida de datos hoy mismo |
| 2 | Dejar de borrar filas ajenas por `code` repetido | LIC-02 | **SIGUE ABIERTO** · evita pérdida de datos |
| 3 | Decidir el respaldo mensual y unificar el contrato + test | LIC-03 | Requiere decisión de negocio |
| 4 | Gracia de 5 días solo para `monthly`; unificar `isLicenseExpired` con `status` | LIC-04, LIC-13, LIC-14, LIC-17 | Medio · cambia lo que ve el operador |
| 5 | Blindar "Cambiar tipo": añadir Mensual, sin preselección engañosa, confirmación con impacto | LIC-05 | Medio · toca UI |
| 6 | Unificar el precio en `PRODUCT_PRICES` y derivar los textos | LIC-06 | Bajo |
| 7 | Serie MED: duración de demos, `monthsPaid`, `Math.ceil`, `monthly` sin fecha | LIC-07…LIC-12, LIC-15, LIC-16 | Bajo |

---

## ✅ Lo resuelto con el módulo de política (2026-10-20)

Se creó `licensePolicy.js`, copia maestra en `src/config/licensePolicy.js` (POS)
y `src/lib/licensePolicy.js` (Estación), **byte a byte idénticas**. La identidad no
se confía a la disciplina: `tests/licensePolicy.test.js` (idéntico en ambos
proyectos) ancla el **SHA-256 del módulo** y además compara todas las copias que
encuentre en los checkouts vecinos. Si alguien edita una copia sin propagarla,
ese proyecto queda en rojo.

Contiene los tipos, duraciones de demo (3/7 días), período de gracia (5 días,
**solo mensual**), elegibilidad de respaldo y precios, más la regla pura
`resolveLicenseState()` que decide si una licencia está viva.

| Hallazgo | Decisión aplicada |
|---|---|
| **LIC-03** | El respaldo remoto es de los **planes de pago: permanente y mensual**. El POS ahora lo permite (`getBackupEntitlement` delega en la política); el test que codificaba el bloqueo fue reescrito. |
| **LIC-04** | La gracia de 5 días es **exclusiva del mensual**. Las demos se cortan en seco en el vencimiento, igual que en la caja. `deriveStatus` delega en `resolveLicenseState`. |
| **LIC-06** | Precio oficial: **Lite permanente $100, mensual $10** (decisión de luigi, 2026-10-19). La UI de venta y las plantillas de WhatsApp derivan de `productPrice()`; el dashboard de ingresos usa los mismos números. |
| **LIC-10** | Una **mensual sin vencimiento ya no es premium para siempre**: falla cerrada como `missing_expiry`. |
| **LIC-12** | Los días restantes redondean **a la baja** (`remainingDays`), sin inflar. |

Además la política fijó dos reglas que antes divergían en silencio:

- **Fail-closed en `is_active`**: solo el booleano literal `true` da acceso.
- **Un vencimiento ilegible no se convierte en "para siempre"**: corta el acceso.

**Verificación:** POS 1594 tests pasan (145 archivos, 0 fallos), Estación 158/158,
`npx tsc --noEmit` 0 errores, ESLint sin errores ni warnings nuevos.

**Sigue abierto (no era de este cambio):** LIC-01 y LIC-02, la pérdida de datos
por `delete` cruzado en `createOrUpdateLicense`. Ese es el siguiente paso urgente.

## Verificación posterior recomendada

1. Tests del POS y de la Estación en verde tras cada cambio (los de `backupEntitlement` y `security` son los sensibles).
2. Prueba de escritorio con cuatro equipos reales (una de cada tipo) comprobando lo que muestra **cada** pantalla de la Estación frente al estado real del POS.
3. Antes de tocar LIC-01/02, volcado de `licenses` para poder revertir si algún equipo ya perdió filas.
