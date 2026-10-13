# PLAN — Proveedores y facturas en Lite (paridad con Pro)

Fecha: 2026-10-12
Repo: `preciosaldia-bodega` (Lite)
Referencia: `preciosaldia-multilocal` (Pro)
Auditoría de origen: [reports/auditoria-proveedores-lite-vs-pro.md](../../reports/auditoria-proveedores-lite-vs-pro.md)

## 0. Alcance

Solo proveedores y facturas, para **un solo equipo** (Lite no es multisede). **Fuera de alcance**: nómina (fase posterior, depende de roles, stock lock y sincronización que Lite no tiene), sincronización de proveedores a la nube, multisede (selector de negocio, `nb_<id>:` en claves) y cambios de esquema SQL.

Por ser de un solo equipo, la copia de Pro no necesita adaptar nada de multisede: el código de proveedores de Pro no depende de negocio activo (verificado: sin referencias a `negocio`/`sede` en los archivos de proveedores).

Objetivo: que Lite pueda (1) registrar facturas con su fecha real, (2) calcular vencimiento por plazo, (3) adjuntar foto local a la factura, (4) filtrar estado de cuenta y reportes por rango, (5) mostrar facturas vencidas.

## 1. Decisiones

- **Copiar, no reescribir**: `supplierReportRange.js` e `invoicePhotos.js` se copian de Pro tal cual (son utilidades puras o solo IndexedDB). Antes de copiar, verificar que sus imports (`calculatorUtils`, `syncDelta`, `ticketConstants`, `ticketHtmlTemplate`, `printerUtils`) existan en Lite con la misma firma. Si alguno falta, se porta el mínimo necesario, no el módulo completo.
- **Sin migración de datos**: las facturas viejas no tienen `invoiceDate` ni `hasPhoto`; el código debe tratarlas como hoy (`date` ya existe en todas).
- **Foto solo local**: IndexedDB `pda-invoice-photos`, nunca a la nube. En un solo equipo esto es suficiente: la foto vive en el mismo equipo donde se registró la factura. Respaldo entre equipos queda fuera (ver §5).
- **Plazo y fecha**: el vencimiento se guarda como `dueDate` (YYYY-MM-DD) igual que hoy; el plazo en días es solo un atajo de UI, no se persiste.
- **Estados de factura**: se derivan de monto y pagos aplicados; no confiar en `invoice.status` como fuente de verdad. Pagos anulados no aplican. Al completar el saldo, la factura se muestra como `PAGADA` sin mutar su monto original.
- **Excedente de pago (decisión confirmada 2026-10-12)**: bloquear el pago si supera el saldo de la factura seleccionada o la deuda total del proveedor; no crear saldo a favor. Validar en USD ya convertido con la tasa elegida, con tolerancia monetaria de centavos acordada durante implementación. Modo FIFO automático no debe exceder la deuda total.
- **Escala de UI**: el estado de cuenta se mantiene completo y filtrable, pero la selección de factura dentro de Registrar Pago debe priorizar solo pendientes, permitir búsqueda y plegar la lista larga para que no desplace el formulario.

## 2. Cambios por archivo

| # | Archivo (Lite) | Cambio | Origen en Pro |
|---|---|---|---|
| 1 | `src/utils/supplierReportRange.js` | **Nuevo**: `filterActivityByRange`, `rangeLabel`, `buildSupplierActivityLines` | copia de Pro |
| 2 | `src/utils/invoicePhotos.js` | **Nuevo**: `saveInvoicePhoto`, `getInvoicePhotoUrl`, `hasInvoicePhoto`, `deleteInvoicePhoto`, `compressImage` | copia de Pro |
| 3 | `src/components/Suppliers/SupplierModals.jsx` | `AddInvoiceModal`: campo `invoiceDate` (default hoy), plazo en días (7/15/30), foto con preview; `date` = mediodía local de `invoiceDate`; `SupplierDetailsSheet`: rango `desde/hasta`, estado VENCIDA/por vencer, miniatura de foto | Pro `SupplierModals.jsx:99-165, 430+` |
| 4 | `src/hooks/useSupplierManagement.js` | `handleAddInvoice`: guardar foto con `saveInvoicePhoto` y quitar `_photoBlob` antes de persistir | Pro `useSupplierManagement.js:67-70` |
| 5 | `src/components/Suppliers/SuppliersList.jsx` | filtro `desde/hasta` para reportes; pasar rango a `generateGlobalSuppliersPDF` | Pro `SuppliersList.jsx:22-27, 104-148` |
| 6 | `src/utils/supplierReportGenerator.js` | aceptar `desde/hasta` en `generateSupplierHistoryPDF` y `generateGlobalSuppliersPDF`; usar `buildSupplierActivityLines` | Pro `supplierReportGenerator.js` (527 líneas) |
| 7 | `src/config/backupKeys.js` | sin cambio (la foto vive en IndexedDB aparte; decidir si se incluye en backup local — ver §5) | — |

Nada de `useCloudSync.js`, `supervisorContracts.js` ni SQL.

## 3. Pasos de implementación

1. **Verificación previa** (sin editar): comparar `git diff` limpio de Lite; confirmar que `calculatorUtils`, `syncDelta`, `ticketConstants`, `ticketHtmlTemplate`, `printerUtils` exportan lo que `supplierReportRange.js` necesita.
2. Copiar `supplierReportRange.js` e `invoicePhotos.js`; ajustar imports si hace falta.
3. Actualizar `supplierReportGenerator.js` para aceptar rango (default: sin rango = comportamiento actual).
4. Actualizar `AddInvoiceModal` (fecha, plazo, foto) y el handler del hook.
5. Actualizar `SupplierDetailsSheet` (rango, vencidas, foto).
6. Actualizar `SuppliersList` (rango para reporte global).
7. Verificar.

## 4. Verificación

Comandos (en Lite, con Bun como indica `packageManager`):

- `bun run lint` — sin errores nuevos en los archivos tocados.
- `bun run typecheck` — o `tsc --noEmit` si el script existe; confirmar primero.
- `bun run test` — suite completa; comparar con la línea base antes de cambiar (anotar fallos previos).
- `bun run build` — compila.

Tests nuevos (deterministas, en Lite `tests/`):
- `supplierReportRange.test.js` (**nuevo**; hoy no existe en Lite): rango vacío = todo; `desde`/`hasta` inclusivos; factura sin fecha se excluye con rango; `netoUsd = facturas − pagos`.
- `supplierInvoiceDate.test.js`: `invoiceDate` `2026-10-01` se guarda como `2026-10-01T12:00` local; plazo 15 días → `dueDate` correcto; factura sin `dueDate` no marca vencida.
- `invoicePhotos.test.js`: solo si el entorno tiene `indexedDB` (jsdom/fake-indexeddb); si no, probar `compressImage` por separado y dejar la parte IndexedDB como prueba manual.

Prueba en navegador (agent-browser o Playwright):
- Registrar factura con fecha de hace 10 días → aparece con esa fecha en el historial.
- Adjuntar foto → miniatura visible tras recargar.
- Rango de fechas en estado de cuenta → solo facturas dentro del rango; el reporte PDF usa el mismo rango.

## 5. Decisiones (resueltas 2026-10-12)

1. **Backup de fotos**: NO se incluyen en el respaldo local. Igual que Pro. Las fotos viven solo en el navegador de este equipo; si se borra el almacenamiento se pierden. Documentar esto al usuario.
2. **Plazo**: botones 7/15/30 días (como Pro), más el campo de fecha de vencimiento editable para casos especiales.

## 6. Riesgos

- Facturas guardadas con `date` de hoy no se pueden corregir retroactivamente desde la UI: solo las nuevas usan la fecha real.
- `handleAddInvoice` escribe factura y proveedor en pasos separados; si falla la foto a mitad, la factura queda sin foto pero válida. Se acepta (igual que Pro) y se documenta.
- Si `invoicePhotos.js` usa `indexedDB` en un contexto sin soporte (algunos webviews), el guardado de foto debe fallar en silencio con toast, sin tumbar el registro de la factura.

## 7. Mejora propuesta — estado de cuenta y pagos con muchas facturas

### Problema observado

El detalle del proveedor muestra el historial completo en un sheet móvil y el modal de pago construye un selector con cada factura pendiente (`openInvoices`). Con decenas o cientos de facturas, ambos espacios crecen o se vuelven difíciles de navegar. El selector no ofrece búsqueda; el historial mezcla el contenido de todas las facturas y pagos aunque existan controles de fecha. Además, `allocatePaymentsToInvoices` calcula `unallocatedUsd` (sobrepago), pero el estado de cuenta no lo presenta como crédito. El estado que se pinta en cada factura ya se deriva del monto original y pagos no anulados; ese cálculo debe seguir siendo la fuente de verdad.

### UX recomendada

1. **Resumen compacto y persistente**: conservar encabezado del proveedor y deuda total; agrupar tarjetas de factura y pago bajo secciones con contador. Al abrir, mostrar facturas pendientes/vencidas y pagos recientes; las pagadas y movimientos antiguos se pueden plegar.
2. **Filtro por estado + búsqueda**: tabs/chips `Pendientes`, `Pagadas`, `Todas` y búsqueda por número de factura; combinar con rango de fecha del estado de cuenta. `Pendientes` muestra primero vencidas y luego las más antiguas por vencer. `Todas` conserva el historial completo (eventualmente paginado/“Cargar más”).
3. **Registrar pago escalable**: el formulario siempre cabe y ofrece modo `Automático (FIFO)` como predeterminado. Si se elige `Factura específica`, abrir una lista plegable/buscable de pendientes con número, fecha, vencimiento, saldo y estado. Al seleccionar, prellenar el monto del saldo pendiente en moneda actual/tasa activa. No incluir facturas pagadas en el selector.
4. **Completar factura**: al ingresar exactamente el saldo pendiente, preview “Esta factura quedará pagada”; persistir vínculo `invoiceId` para pago dirigido. Si automático cubre varias, distribuir FIFO y mostrar preview de facturas cubiertas/parciales antes de procesar. El historial calcula los estados a partir de pagos activos y sus vínculos.
5. **Pago superior al saldo**: bloquear antes de guardar si excede el saldo de la factura seleccionada o la deuda total del proveedor; mostrar el saldo máximo pagable en la moneda activa y permitir usar “Pagar saldo completo” para rellenarlo. No redistribuir excedente de una factura específica hacia otras facturas y no generar crédito. El modo automático FIFO tiene máximo igual a la deuda total.
6. **Rendimiento/legibilidad**: no desplegar cientos de opciones de golpe; búsqueda en lista derivada y virtualización solo si las mediciones de catálogo lo justifican. Mantener filtros/rango accesibles y resumen de resultados, no quitar movimientos de datos.

### Reglas de dominio que el plan debe respetar

- Asignación actual: pago con `invoiceId` va primero a esa factura; excedente pasa FIFO; pagos sin `invoiceId` se aplican FIFO; `ANULADA` no participa.
- La deuda no puede quedar negativa. Por decisión confirmada, exceso sobre saldo seleccionado o deuda total se rechaza en UI antes del guardado; no hay cuenta/crédito a favor que administrar. Si el flujo de guardado recibe un monto inválido por otra vía, el handler también debe validarlo para mantener el invariante.
- Estados visuales calculados: pendiente, parcial, pagada, vencida (vencimiento solo si todavía hay saldo); vencida es etiqueta temporal adicional, no estado de pago nuevo.
- Los nuevos pagos ya pueden llevar `invoiceId`, `exchangeRate` y `rateType`; datos históricos sin vínculo siguen aplicándose FIFO.
- El pago debe conservar la tasa de conversión elegida (BCV real predeterminado o tasa activa), independientemente de cómo se distribuya el equivalente USD.

### Fases propuestas

A. **Definir contratos**: implementar bloqueo de sobrepago tanto en UI como en handler y límites del monto automático.
B. Hacer el selector de facturas específico compacto, con búsqueda siempre visible al elegir `Factura específica`, saldo y vencimiento; auto-llenar saldo pendiente y bloquear montos mayores.
C. Agrupar, filtrar y buscar el estado de cuenta; abrir por defecto en pendientes/vencidas, añadir tabs/chips `Pendientes`, `Pagadas`, `Todas` y contadores. Mantener el historial completo disponible; cargar/paginar solo si las mediciones lo justifican.
D. Pruebas unitarias para asignación dirigida/FIFO/exceso/anulación/estado; pruebas de componente para búsqueda, lista grande y selección; E2E móvil para pago completo, parcial, múltiples facturas, bloqueos por exceso y filtros.

### Criterios de aceptación propuestos

- Cien facturas no hacen crecer el formulario fuera de la pantalla ni obligan a recorrer un selector extenso; encontrar factura por número es directo.
- Pago completo dirigido deja saldo cero y estado `PAGADA`; parcial deja el saldo correcto; FIFO mantiene comportamiento explícito y determinista.
- Los pagos superiores al máximo permitido se bloquean con mensaje claro; no se genera saldo a favor. Anular un pago restituye la deuda y recalcula los estados.
- Estado de cuenta permite volver de “Pendientes” a “Todas” y filtrar fechas sin alterar asignación contable.
- En pantalla móvil los botones de acción no quedan ocultos por la lista (footer/modal con scroll independiente si hace falta).

## 8. Decisiones de producto confirmadas (2026-10-12)

1. **Exceso sobre una factura seleccionada**: bloquear el pago. No redirigir el excedente a otras facturas.
2. **Exceso sobre deuda total**: bloquear el pago. No registrar ni acumular saldo a favor.
3. **Vista inicial de estado de cuenta**: `Pendientes`/vencidas primero, con acceso explícito a `Pagadas` y `Todas`.
4. **Selector de factura**: búsqueda disponible siempre en el modo de factura específica; no esperar a cruzar un umbral numérico.

## 10. Criterio de terminado

- Todos los puntos de la sección 0 funcionan en navegador.
- `lint`, `typecheck`, `test`, `build` pasan o los fallos previos quedan documentados sin cambios.
- Ningún cambio toca sincronización ni SQL.
