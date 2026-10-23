# Plan de Fixeo: Ticket de Cierre de Caja Térmico Nativo (58mm / 80mm)

**Meta:** Reemplazar el renderizado de impresión del ticket de Cierre de Caja (que actualmente se imprime como un PDF embebido en un iframe, viéndose opaco y desalineado) por un generador HTML nativo idéntico al del ticket de venta, adaptado automáticamente a 58mm o 80mm según la configuración del usuario, manteniendo intacta la descarga del PDF en tamaño Carta.

**Arquitectura:**
1. Crear `src/utils/dailyCloseHtmlTemplate.js` que construye el HTML térmico de alta resolución con texto en negro puro (`#000`), usando los tokens y medidas de `getPaperConfig(paperWidth)`.
2. Crear la función `printThermalDailyClose(cierreData)` que extrae la configuración del negocio y envía el HTML a `openPrintWindow(html)` (el mismo mecanismo instantáneo y nítido del ticket de venta).
3. Conectar la acción de impresión en `CierreCajaSummaryModal.jsx`, `DashboardView.jsx` y `CierreHistoryCard.jsx`.
4. Mantener `generateDailyClosePDF({ action: 'download' })` sin modificaciones para que la descarga del reporte formal en hoja Carta siga funcionando exactamente igual.

---

### Tarea 1: Crear la plantilla HTML térmica para Cierre de Caja
**Archivos:**
* Crear: `src/utils/dailyCloseHtmlTemplate.js`

**Detalles de implementación:**
* Recibe: `(cierreData, paperConfig, settings)`.
* `paperConfig`: obtenido de `getPaperConfig(paperWidth)` (propiedades `cssPageSize`, `cssBodyWidth`, `cssLogoW`, `fTitle`, `fBase`, `fSmall`, `fTiny`, `fTotalU`, `fTotalB`, `fDisclaimer`).
* Estilos CSS:
  * `@page { size: ${cssPageSize}; margin: 0; }`
  * `body { width: ${cssBodyWidth}; margin: 0 auto; color: #000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif; }`
  * `.dash { border: none; border-top: 1px dashed #000 !important; }`
* Secciones del ticket:
  1. Logo (`./logo.png`) y datos fiscales del negocio (Nombre en mayúsculas, RIF, Dirección, Teléfono).
  2. Encabezado de Cierre: `CIERRE DE CAJA`, `Cierre #N`, Fecha y hora, Cajero/Turno.
  3. Fondo de Apertura (si existe): USD y Bs.
  4. Desglose de Ingresos: Tabla de 2 columnas con métodos de pago (Efectivo USD, Efectivo Bs con su desglose Bs, Pago Móvil, Punto de Venta, Cashea por cobrar, Fiado por cobrar).
  5. Egresos de Caja (si hubo): Gastos internos y pagos a proveedores.
  6. Totales Destacados:
     * `TOTAL USD`: centrado, tamaño `fTotalU`, font-weight 900.
     * `TOTAL Bs`: centrado, tamaño `fTotalB`, font-weight bold.
     * `TOTAL COP`: (si aplica en frontera).
     * Total Operaciones (tickets emitidos).
  7. Arqueo / Cuadre Físico (si `reconData` está presente): Efectivo esperado vs contado y diferencia.
  8. Pie de Ticket: `Reporte de Cierre de Caja · Sin valor fiscal` y `Precios Al Día Bodega`.

---

### Tarea 2: Crear el disparador `printThermalDailyClose`
**Archivos:**
* Modificar: `src/utils/dailyCloseGenerator.js` (o exponer helper en `src/utils/dailyClosePrinter.js`)

**Detalles de implementación:**
* Implementar:
  ```javascript
  export function printThermalDailyClose(cierreData) {
      const paperWidth = localStorage.getItem('printer_paper_width') || '58';
      const paperConfig = getPaperConfig(paperWidth);
      const settings = {
          name: localStorage.getItem('business_name') || 'Mi Bodega',
          rif: localStorage.getItem('business_rif') || '',
          address: localStorage.getItem('business_address') || '',
          phone: localStorage.getItem('business_phone') || '',
      };
      const html = buildDailyCloseHtml(cierreData, paperConfig, settings);
      openPrintWindow(html);
  }
  ```
* Asegurar que `openPrintWindow` maneje tanto la ventana emergente como el iframe de respaldo.

---

### Tarea 3: Conectar el nuevo disparador en el flujo de Cierre del POS
**Archivos:**
* Modificar: `src/views/DashboardView.jsx:967-969`
* Modificar: `src/components/Dashboard/CierreCajaSummaryModal.jsx`

**Detalles de implementación:**
* En `DashboardView.jsx`:
  * Al hacer clic en "Imprimir Ticket de Cierre" en el modal de resumen de cierre:
    ```javascript
    // ANTES:
    onPrint={() => generateDailyClosePDF({ ...cierreSummaryData, action: 'print' })}

    // AHORA:
    onPrint={() => printThermalDailyClose(cierreSummaryData)}
    ```
* La acción `onDownload` permanece inalterada llamando a `generateDailyClosePDF({ ... , action: 'download' })`.

---

### Tarea 4: Conectar el nuevo disparador en el Historial de Reportes
**Archivos:**
* Modificar: `src/components/Reports/CierreHistoryCard.jsx:56-73`

**Detalles de implementación:**
* En `CierreHistoryCard.jsx`:
  * En la acción de imprimir ticket térmico (`actionType === 'print'`):
    Llamar a `printThermalDailyClose(cierre)` en lugar de `generateDailyClosePDF({ ... , action: 'print' })`.
  * Mantener `actionType === 'download'` llamando a `generateDailyClosePDF` tamaño Carta.

---

### Tarea 5: Verificación y Pruebas
1. **Prueba en 58mm:**
   * Establecer en Configuración el ancho en `58mm`.
   * Realizar una venta y probar imprimir ticket de cierre.
   * Verificar que los textos sean negros sólidos (`#000`), sin bordes grises o borrosos, y que los márgenes no queden cortados.
2. **Prueba en 80mm:**
   * Cambiar a `80mm` en Configuración y verificar la expansión fluida de las fuentes y tablas.
3. **Prueba de Descarga PDF:**
   * Hacer clic en "Descargar PDF" y comprobar que descarga el documento Carta formal de múltiples páginas con gráficos y firmas.
