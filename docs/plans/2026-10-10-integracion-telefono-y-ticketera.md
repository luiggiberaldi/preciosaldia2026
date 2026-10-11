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
1. Ejecutar `npm run build` para garantizar cero errores en producción y empaquetado PWA.
2. Registrar el commit de unión (`Merge branch 'origin/main' into main`).
