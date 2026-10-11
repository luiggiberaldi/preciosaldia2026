# Plan de fixeo pre-publicación: ventas a granel y teléfono del negocio

**Fecha:** 11 de octubre de 2026
**Estado:** plan de trabajo; no se implementaron cambios ni se publicó nada.
**Objetivo:** cerrar los defectos de integridad de presentación/unidad en ventas y de consistencia del teléfono; reforzar la prueba del reintento remoto antes de considerar una publicación.

## 1. Alcance, aceptación y límites

### Criterios de aceptación

1. Una venta terminada conserva en su propio snapshot el modo de unidad de granel activo al cobrar (`kg_lt` o `gr_ml`). Recibos e historial no cambian de `750 ml` a `0.75 L` ni alteran la cantidad al cambiar después la preferencia global.
2. La unidad física y la cantidad canónica de cada producto siguen preservadas: sólido en kg y líquido en L; `qty`, precios, stock descontado y anulación no se convierten ni recalculan para resolver un problema de formato.
3. `business_phone` tiene una sola fuente de verdad coherente con sus consumidores síncronos. Exportar, restaurar o consultar una pantalla no debe migrar/borrar el valor y dejar divergentes Ajustes, Licencia, tickets o WhatsApp.
4. Existe una prueba del flujo de backup que modela la transición persistida `pending → failed → retry → completed`, respeta el backoff y prueba el filtro de estados consultados; el test no debe devolver artificialmente `pending` después del fallo.
5. Se preservan los formatos de ventas históricas que no tengan snapshot de modo/unidad: no inferir si eran litros o kilogramos cuando falte evidencia.
6. Todos los gates locales acordados abajo pasan o quedan atribuidos y aprobados explícitamente como bloqueos de baseline. No se hace push, deploy, migración ni escritura de datos externos dentro de este plan.

### Límites para proteger el checkout compartido

- Al iniciar el plan, `main` está `ahead 7` de `origin/main` y hay **39 archivos modificados** en el árbol de trabajo. Uno de ellos es el plan de integración previo; no reemplazarlo ni editar esos cambios como parte de este documento.
- No usar `git reset`, `checkout`, `restore`, `clean`, stash, rebase, merge, `git add -A` ni formato masivo. No cambiar de rama ni reconstruir el estado de los 39 archivos.
- En la implementación futura, aplicar hunks mínimos sobre los archivos afectados, inspeccionar cada diff y distinguir las nuevas líneas de todo el trabajo preexistente. No stagear ni commitear automáticamente.
- No ejecutar ni reemplazar el instalador de impresora. No tocar el `.exe`, `.bat` o instrucciones de distribución.
- No acceder a Supabase/Drive en modo escritura, desplegar o publicar. Cualquier push que pueda activar distribución necesita autorización explícita independiente.

## 2. Estado observado y no duplicar trabajo

La revisión del checkout muestra que algunos fundamentos ya están presentes en los cambios locales y deben conservarse, no volver a implementarse a ciegas:

- `checkoutProcessor` ya copia `unit`, `granelUnit` y `packagingType` a cada artículo de la venta. `granelSaleVoidE2E.test.js` ya incluye caso de líquido y comprobación de ticket; comprobar su validez y ampliarlo, no eliminarlo.
- `granel.js`, Quick/Wizard y `productProcessor` ya tienen helpers/conversión de umbrales g/ml a kg/L y una vía para valores canónicos. Confirmar con pruebas el comportamiento actual; no introducir una segunda conversión.
- `business_phone` ya aparece en `LS_KEYS` y en el servicio de backup/restauración. El riesgo residual concreto es que el exportador de `SettingsModal` usa `storageService.getItem('business_phone')`: dicho servicio migra claves de localStorage a IndexedDB y elimina la copia local, mientras Ajustes, Licencia, Terms y tickets siguen leyendo/escribiendo localStorage.
- Los recibos/tickets ya consultan `sale.granelUnitMode || getGranelUnitMode()`, pero la transacción observada aún no fija `granelUnitMode` en el objeto `sale`. Algunos historiales/reportes llaman `formatSaleItemQuantity(item)` sin el modo de la venta, por lo que dependen de la preferencia global al volver a renderizar.
- La prueba actual de reintento de backup usa un mock que muta la fila tras el update, pero el encadenamiento `.in(statuses)` no filtra de forma realista como Supabase. Endurecer el doble de datos para verificar explícitamente la transición y el conjunto consultado.

Si una inspección del diff o una prueba demuestra que cualquiera de estos puntos cambió desde esta lectura, actualizar el alcance antes de tocar código y preservar los cambios recientes.

## 3. Fase A — Congelar la línea base y acotar propiedad

1. Registrar rama, `HEAD`, `git status --short --branch`, nombres de los 39 archivos modificados y diffs de los archivos relevantes. Guardar fuera del checkout cualquier evidencia necesaria; no reescribir el documento de integración existente.
2. Revisar cambios propios contra `HEAD` solo en estos puntos: `SalesView`, `useCheckoutFlow`, `checkoutProcessor`, `granel.js`, formatos de ticket/recibo/historial, ajustes/exportación de negocio, backup keys/restauración y las pruebas señaladas.
3. Ejecutar primero las pruebas dirigidas existentes sin editar nada para saber qué ya pasa en este árbol. Registrar salida y código de retorno por comando; no atribuir fallos al fix nuevo.
4. Revisar el estado final de la clave de teléfono en IndexedDB/localStorage y el bootstrap de la app para elegir un punto de migración sin carrera. No borrar una copia anterior hasta verificar que la nueva copia fue escrita.

**Gate A:** el estado original permanece intacto; se conoce qué código local ya cubre parte de los hallazgos; existe una línea base registrada para cada suite afectada.

## 4. Fase B — Congelar el modo de unidad dentro de la venta

### Implementación recomendada

1. Seguir el flujo de `granelUnitMode` desde el contexto de producto a `SalesView` y al callback de `useCheckoutFlow`. Pasarlo como argumento explícito a `processSaleTransaction`; evitar acoplar el procesador financiero a `localStorage` o a un hook de React.
2. Persistir el valor validado (`kg_lt` / `gr_ml`) en el objeto de venta, junto con timestamp y los metadatos ya capturados por artículo. El dato describe el modo de presentación usado al cobrar; no representa una conversión del `qty` canónico.
3. Confirmar que receipt modal, WhatsApp, PDF/ticket térmico y formatos de historial, cierre diario, dashboard, clientes y reportes usan el modo guardado de esa venta. Donde el formateador solo recibe un artículo, pasarle explícitamente `sale.granelUnitMode` desde el componente padre o añadir una interfaz sin ambigüedad.
4. Mantener como fallback para registros antiguos la conducta legacy actual (preferencia disponible donde ya se usa); si faltan metadatos, no inventar si el artículo era líquido. Los carritos en curso y productos aún no vendidos pueden seguir usando la preferencia vigente.
5. Verificar especialmente `dailyCloseGenerator`, `dashboardActions`, `SalesHistory`, `DashboardModals`, `ReportsMetricsTab` y `CustomersView`, además de `ReceiptModal`, `ReceiptShareHelper`, `ticketGenerator` y `ticketHtmlTemplate`. No cambiar `HoldsModal` salvo que se demuestre que un hold cerrado necesita conservar el modo de la venta; un hold todavía no es una venta.

### Pruebas de aceptación

- Prueba de transacción: cobrar sólido a 0.350 kg y líquido a 0.750 L en ambos modos; confirmar en la venta persistida `granelUnitMode`, `unit`, `granelUnit`, `packagingType` y el mismo `qty` canónico.
- Capturar una venta en modo g/ml, cambiar la preferencia global a kg/L y volver a abrir recibo/historial/ticket/cierre: debe seguir mostrando 350 g y 750 ml. Repetir en sentido contrario: debe conservar 0.350 kg y 0.750 L.
- Confirmar que total, desglose, stock después de venta y reversión después de anulación son idénticos antes/después del cambio de formato.
- Añadir caso legacy sin `granelUnitMode` y sin metadatos de unidad; validar fallback documentado y que no se clasifique como líquido por inferencia.

**Gate B:** todos los consumidores de ventas cerradas presentan el snapshot; cantidades/valores canónicos no cambian; ventas viejas siguen legibles.

## 5. Fase C — Unificar la persistencia de `business_phone`

### Decisión de diseño

Usar **localStorage como fuente de verdad**, consistente con `business_name`, `business_rif`, la clave ya incluida en `LS_KEYS` y los consumidores síncronos (configuración, Licencia, Terms y generación de tickets). No trasladar todos esos consumidores a IndexedDB: hacerlo haría asíncrona la generación/impresión y ampliaría innecesariamente el cambio.

### Implementación recomendada

1. Eliminar del flujo de exportación manual la lectura de `business_phone` mediante `storageService.getItem`; leer la fuente canónica sin activar la migración genérica de localStorage a IndexedDB.
2. Revisar escritura/lectura de todos los consumidores encontrados: `SettingsModal`, `SettingsView`, `SettingsTabLicencia`, `ticketGenerator`, `TermsOverlay`, backup manual v1 y backup/restauración v2. Guardar el número normalizado en la misma fuente y no crear nuevas copias divergentes.
3. Cubrir la copia huérfana que pudo quedar en IndexedDB por una exportación anterior. Inspeccionar el arranque de `main.jsx`/`App.jsx` y colocar una migración de compatibilidad idempotente antes de habilitar las pantallas que consumen el número: si localStorage no tiene valor y existe el valor legado en IndexedDB, copiarlo a localStorage, verificar la copia y solo entonces eliminar la clave IDB sobrante. Si ya hay valor localStorage, conservarlo como autoridad y no sustituirlo silenciosamente. Si el bootstrap no permite garantizar el orden, definir un helper con estado de inicialización y fallback explícito antes de implementarlo.
4. Mantener la clave en `LS_KEYS`; comprobar que backups cloud, exportación local, restauración v2, formato legado y el exportador manual no la omiten. No meterla en `IDB_KEYS`.
5. Evitar una migración destructiva: ante error de lectura/escritura, conservar la copia original y reportar el error, sin limpiar la clave de IndexedDB.

### Pruebas de aceptación

- Con teléfono solo en localStorage: exportar backup manual y completo; Ajustes, Licencia y ticket siguen mostrando el número; no aparece migrado/eliminado de localStorage.
- Con teléfono legado solo en IndexedDB: migración recupera el valor a localStorage antes de lectura, sobrevive reload y exportación, y elimina IDB solo tras confirmar copia.
- Si ambas copias existen y difieren: localStorage gana; no se pierde la copia conflictiva sin una política revisada y una prueba.
- Guardar teléfono nuevo/editarlo/limpiarlo valida formato como hoy y produce el mismo valor normalizado en cada consumidor. Importar backup v1/v2 restaura la clave correctamente.
- Verificar el caso de error de migración y garantizar que el teléfono legado no desaparece.

**Gate C:** una sola fuente vigente, compatibilidad con datos ya migrados y backup/restore consistente; ningún consumidor hace lecturas que desencadenen una migración genérica inesperada.

## 6. Fase D — Hacer realista la prueba del retry remoto

1. Ajustar el mock de `tests/useAutoBackupRequests.test.jsx` para que represente una tabla persistente: `update({status:'failed'})` guarda el cambio, la consulta siguiente retorna esa fila en `failed`, y `.in('status', ['pending','failed'])` filtra como lo haría el backend. Evitar devolver la misma fila artificialmente como `pending`.
2. Probar la secuencia completa: `pending` provoca un intento; error temporal persiste `failed`; reconciliación anterior al vencimiento del backoff no sube de nuevo; al vencerse el backoff se consulta el estado `failed`, se reintenta y solo éxito más update persistente permite `completed`.
3. Añadir fallo de escritura de `failed`/lectura, varias solicitudes ordenadas, y fallo al marcar `completed` si no existe cobertura equivalente. Verificar que no se marca `completed` ni se crea un falso processed/session marker ante fallo.
4. Mantener deterministas reloj, estado de sesión y semáforo Realtime/polling. No simular una integración real: registrar que Supabase/Google Drive no quedan validados por el mock.

**Gate D:** el test demuestra la máquina de estados persistente y el backoff, sin relajar expectativas ni ocultar errores.

## 7. Fase E — Verificación local y pruebas por interfaz

Ejecutar en el checkout preservado, después de las modificaciones, y conservar el exit code de cada comando:

1. Foco de dominio: `bun run test -- tests/granelSaleVoidE2E.test.js tests/granelUnits.test.js tests/granelGuardrails.test.js tests/ticketWallet.test.js tests/backupRestore.test.js tests/useAutoBackupRequests.test.jsx tests/phoneValidation.test.js tests/settingsTabNegocio.test.jsx` (ajustar solo nombres existentes; no eliminar tests para que el comando pase).
2. Ejecutar pruebas E2E de interfaz de checkout, historial/recibo y ajustes/backup existentes. Si no hay spec de interfaz para la transición de preferencia, añadir una prueba browser apropiada al patrón actual o documentar qué interacción manual se verificó; no llamar “E2E” a una prueba unitaria del procesador.
3. Recorrer en la aplicación local: vender líquido/sólido, cambiar modo, abrir recibo e historial y comprobar unidades; exportar backup, confirmar que Ajustes conserva el teléfono, recargar y validar Licencia/ticket. Para importación, usar fixture local y restauración aislada, nunca datos reales.
4. `bun run typecheck`.
5. ESLint dirigido a los archivos realmente editados; reportar warnings aparte. No aplicar auto-fix al repo completo ni suprimir reglas.
6. `bun run test` completo.
7. `bun run build`.
8. `git diff --check`, revisión línea por línea de los hunks propios, `git diff --stat`, `git status --short --branch` y revisión explícita de staged/unstaged. Confirmar que el diff de los 39 archivos ajenos a la intervención no fue reemplazado ni reformatteado.

Si aparece un fallo en cartera/receivables como el visto en revisiones anteriores, compararlo con la baseline exacta del checkout y aislar causa antes de decidir. Nunca modificar fixtures/expectativas para hacerlo pasar. Un comando filtrado debe preservar su exit status; preferir ejecutar sin filtros.

**Gate E:** suites dirigidas, E2E de interfaz aplicables, typecheck, lint dirigido, suite completa, build y whitespace pasan; cualquier excepción está atribuida, visible y aceptada por quien autoriza publicar.

## 8. Riesgos, mitigación y decisión de publicación

| Riesgo | Impacto | Mitigación / condición de salida |
|---|---|---|
| Se captura el modo equivocado o el estado queda stale en checkout | Recibo/historial con unidad incorrecta | Pasar el modo actual de contexto al evento de checkout; probar ambos modos y cambiar preferencia tras la venta. |
| Migración del teléfono pisa el valor nuevo o elimina el legado antes de tiempo | Número perdido o divergencia entre pantallas | Fuente localStorage; migración de una sola vez, idempotente, prioriza el valor local y elimina IDB solo después de verificar escritura. |
| Fixtures viejos omiten `granelUnitMode`/unidad | Falsa clasificación de históricos | Fallback explícito compatible, sin inferir volumen; pruebas legacy. |
| Mock de Supabase diverge del filtro/estado real | Retry aparentemente correcto pero imposible en producción | Doblar estado y filtros; considerar staging solo con autorización separada. |
| Backup remoto/Drive tiene semántica o permisos distintos de mocks | Solicitudes pueden quedar sin completar o repetir trabajo | No afirmar éxito externo con unit tests. Validación contra sandbox/staging y política de reintentos requieren credenciales y autorización aparte. |
| Push distribuye automáticamente a comercios activos | Exposición de una regresión operativa | Revisar flujo CI/release sin ejecutarlo; no push hasta autorización explícita y decisión informada. |

### Gate final, separado de la implementación

No recomendar publicar hasta completar gates B–E y revisar el diff conjunto. Antes de solicitar un push:

1. Confirmar rama/base remota y commits que se publicarían; resolver divergencia solo en una tarea autorizada y sin sacrificar los 39 cambios.
2. Comprobar configuración de CI/release y si el push activa despliegue/distribución; no probarlo publicando.
3. Confirmar que el instalador que ya forma parte del cambio es el artefacto esperado y que no se modificó; la validación de firma/procedencia queda aparte si el paquete se distribuirá.
4. Informar checks locales frente a los no ejecutados: Supabase, Google Drive y API externa quedan sin verificar hasta disponer de sandbox y autorización.
5. Obtener autorización explícita independiente antes de push/deploy, especialmente si puede alcanzar cajas activas. No incluir staging amplio ni usar `git add -A`.

**Resultado esperado del plan:** dos correcciones de consistencia con datos retrocompatibles, prueba fiable del retry y evidencia local reproducible; sin alterar aritmética financiera/stock, instalador, datos reales, 39 cambios existentes ni publicación.
