# Plan de Integración: Teléfono del Negocio + Ticketera Consolidada

**Objetivo:**  
Unir los cambios remotos de GitHub (campo obligatorio de *Teléfono del negocio* venezolano y validaciones de licencia/respaldos) con las mejoras locales (consolidación del tamaño de papel en *Ticketera & Hardware* y sub-pestañas de ventas), asegurando que ambas funcionalidades convivan en perfecta armonía sin regresiones.

---

### Fase 1: Red de seguridad inicial
1. **Crear rama de respaldo local:**  
   Antes de hacer cualquier movimiento, crear un respaldo de seguridad del estado actual (`git branch backup-antes-de-integrar`) para poder regresar en 1 segundo si fuera necesario.

---

### Fase 2: Integración guiada (`git merge origin/main`)
Ejecutar la unión y resolver los 3 archivos de contacto:

#### 1. `src/views/SettingsView.jsx`
* **Lo que aporta GitHub:**
  * Importa validadores de teléfono venezolano (`normalizeVzlaPhone`, `isValidVzlaPhone`).
  * Estado y guardado en memoria de `business_phone`.
  * Validación al presionar "Guardar" (exige formato móvil venezolano 04XX).
* **Lo que aporta la versión local:**
  * Pasa `paperWidth` a `SettingsTabNegocio` para la vista previa de etiquetas de estante, pero **sin** la función `setPaperWidth` (porque el botón de cambio se movió a Ticketera).
* **Resultado unificado:**  
  Se incluye el teléfono del negocio y se mantiene la limpieza de la ticketera.

#### 2. `src/components/Settings/tabs/SettingsTabNegocio.jsx`
* **Lo que aporta GitHub:**
  * Recibe `businessPhone` y `setBusinessPhone`.
  * Renderiza el campo visual con input para escribir el número ("Ej: 0412 123 4567") y la nota explicativa de WhatsApp.
* **Lo que aporta la versión local:**
  * No tiene la tarjeta duplicada de "Tamaño de Ticket" (eliminada con éxito).
  * No importa `Printer` de forma innecesaria.
  * Mantiene el cálculo seguro de precios secundarios en etiquetas (`hasSecondaryPrice`).
* **Resultado unificado:**  
  La pantalla de *Mi Negocio* muestra Nombre, RIF y el nuevo **Teléfono**, sin la tarjeta repetida de la ticketera.

#### 3. `src/hooks/useAutoBackup.js`
* **Lo que aporta GitHub:**
  * Manejo honesto de errores: verifica `result?.ok` antes de marcar un respaldo como completado en Supabase, y reporta fallos reales si ocurren.
* **Lo que aporta la versión local:**
  * Uso de `startBackupRequestPolling` para ahorrar consultas y optimizar recursos.
* **Resultado unificado:**  
  El polling inteligente usa la validación honesta de éxito/error de los respaldos.

---

### Fase 3: Arnés de Pruebas Automatizadas
Verificar que todas las pruebas vinculadas pasen al 100%:
1. `tests/phoneValidation.test.js` (validaciones de número de teléfono venezolano).
2. `tests/settingsTabNegocio.test.jsx` (pantalla de Negocio limpia y sin duplicados).
3. `tests/settingsTabVentas.test.jsx` (sub-pestañas de Ventas y Ticketera).
4. `tests/useAutoBackupRequests.test.jsx` (respaldos automáticos).

---

### Fase 4: Verificación de Build y Cierre
1. Ejecutar `bun run build` para garantizar cero errores en producción y empaquetado PWA.
2. Registrar el commit de unión (`Merge branch 'origin/main' into main`).

---

## Revisión posterior al merge — 10 de octubre de 2026

Se revisó el commit de integración `c714d45` y el conjunto de siete commits locales que quedarían en el próximo push (`main` estaba `ahead 7`, sin commits pendientes de incorporar desde `origin/main`). El checkout estaba limpio al iniciar esta revisión. **Esta anotación documenta riesgos conocidos; no cambia el comportamiento ni autoriza un push.**

### Hallazgos funcionales conocidos

1. **P2 — Las solicitudes de backup que pasan a `failed` no tienen reintento automático.** El cliente marca el registro `failed`, pero la reconciliación consulta únicamente `pending`. La prueba de retry conserva un resultado mockeado `pending`, por lo que no reproduce la transición de estado de producción. Si ocurre un fallo temporal, la solicitud no se vuelve a procesar automáticamente. El resto de la app y los respaldos locales/manuales no dependen de ese retry remoto.
2. **P2 — `business_phone` no viaja en los respaldos.** La clave está ausente de `LS_KEYS` y del exportador manual. Si se restaura/migra un dispositivo, el teléfono del negocio puede requerir volver a ingresarse. No afecta ventas, cobros ni impresión mientras el dato siga guardado localmente.
3. **P2 — Las alertas de bajo stock de granel pueden quedar con la escala equivocada en modo gramos/ml.** Los formularios capturan el umbral visible en gramos/ml, pero `buildProductPayload` lo persiste directamente como valor canónico kg/L. Por ejemplo, una alerta de 500 g acaba comparándose como 500 kg contra stock almacenado en kg y mantiene la advertencia activada prácticamente siempre. No cambia la cantidad/stock ni bloquea vender; sí vuelve poco confiable una alerta importante de inventario.
4. **P2 — Las ventas nuevas pierden la clase/unidad de granel en el snapshot del recibo.** `processSaleTransaction` conserva `isWeight`, pero no `unit`, `granelUnit` ni `packagingType`; luego `isLiquidProduct` no puede reconocer líquidos en renderizadores que dependen del snapshot. Sumado a los reportes que etiquetan todo `isWeight` como kg, una venta por litros/ml puede aparecer como kg/g en ticket compartido, historial o cierre. Los cálculos monetarios/qty y la venta no se invalidan, pero los comprobantes y reportes pueden mostrar una unidad materialmente incorrecta.

Los hallazgos 3 y 4 se verificaron en código del alcance saliente; las pruebas ejecutadas no cubren los casos de alertas en gramos ni snapshots líquidos de punta a punta.

### Alcance e impacto para decidir el push

- Los hallazgos de backup remoto y teléfono no deshabilitan caja, ventas, inventario o impresión. Los dos hallazgos de granel sí afectan funciones auxiliares importantes: alarmas de reposición y exactitud de unidad en comprobantes/reportes, aunque no bloquean el checkout ni alteran las cantidades canónicas según la revisión estática.
- El conjunto saliente también incluye cambios de polling/heartbeat de Supabase y de ticketera. La revisión local no mide el efecto real sobre egress/cupos ni valida el ciclo remoto en staging/producción. **No tratar el push como libre de impacto funcional solo porque los tests dirigidos y el build pasan.**
- Se agrega al sitio un instalador Windows descargable (`public/drivers/Instalador_Impresora_POS.exe`, aprox. 2.8 MB). Esta revisión no ejecutó ni verificó la firma/procedencia del instalador; conviene validar ese artefacto antes de distribuirlo a clientes.
- Los tests dirigidos de respaldo y teléfono ejecutados en esta revisión pasaron (13/13). No se ejecutaron contra Supabase, Google Drive o la API externa en vivo. Este resultado no valida el ciclo remoto en producción.

### Recomendación y gates pendientes

No se hizo push. Recomendación: **no publicar todavía**; primero corregir/cubrir las alertas en escala canónica y el snapshot/unidad de líquidos. Los otros dos hallazgos pueden documentarse y aceptarse si el usuario prioriza publicar, entendiendo que requests remotos fallidos necesitarán recrearse/reencolarse y que teléfono se vuelve a ingresar tras restaurar. Completar además la verificación del [plan pre-push](2026-10-10-plan-correcciones-pre-push.md) (edición, checkout/anulación, recibos e historial para sólidos/líquidos). Confirmar que el instalador distribuido es el artefacto esperado y válido. Un push puede activar distribución/deploy automático; revisar el release configurado y obtener autorización explícita para publicar a usuarios activos.

**Decisión registrada:** los riesgos están documentados; no son todos iguales. Las regresiones de granel no impiden cobrar, pero pueden dar alertas inútiles y comprobantes/reportes con unidades incorrectas, así que sí afectan funciones importantes. La publicación todavía no se recomienda antes de resolverlas o aceptar conscientemente esos efectos.

### Evidencia de revisión

- Rama/alcance: `main`, `c714d45`, siete commits por delante de `origin/main`; sin cambios sin commit al inicio/fin de la revisión.
- Verificación ejecutada: `bun run test -- tests/useAutoBackupRequests.test.jsx tests/phoneValidation.test.js` — 13 pruebas aprobadas.
- No se ejecutó `git push`, build/deploy, instalador ni llamadas de escritura a servicios externos.

> Nota de entorno: el script del paquete usa Bun (`packageManager: bun@1.1.0`); por eso la instrucción de build anterior fue normalizada a `bun run build`.
