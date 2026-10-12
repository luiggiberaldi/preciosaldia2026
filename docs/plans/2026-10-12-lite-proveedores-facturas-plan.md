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

## 7. Criterio de terminado

- Todos los puntos de la sección 0 funcionan en navegador.
- `lint`, `typecheck`, `test`, `build` pasan o los fallos previos quedan documentados sin cambios.
- Ningún cambio toca sincronización ni SQL.
